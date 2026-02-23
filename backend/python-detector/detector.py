"""
Template Matching Based Instrument Detector
Simple approach that works with 1-5 examples per class
WITH INTEGRATED PADDLEOCR
"""

# Disable oneDNN/MKLDNN before importing paddle (fixes compatibility issues)
import os
os.environ['FLAGS_use_mkldnn'] = '0'
os.environ['PADDLE_DISABLE_MKLDNN'] = '1'
os.environ['FLAGS_use_onednn'] = '0'
os.environ['MKLDNN_DISABLE'] = '1'
os.environ['DNNL_VERBOSE'] = '0'
os.environ['FLAGS_enable_pir_api'] = '0'
os.environ['FLAGS_enable_pir_in_executor'] = '0'

import cv2
import numpy as np
from pdf2image import convert_from_path
import json
from PIL import Image
from typing import List, Dict, Tuple
import csv
import sys

# Configure Poppler path for Windows
POPPLER_PATH = r"C:\Program Files\poppler\Library\bin"  # Adjust this if your path is different

# Helper to print to stderr instead of stdout
def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)

# DPI constants
DETECTION_DPI = 150
OCR_DPI = 300

# ==========================================
# Page rendering cache — avoids re-rendering PDFs
# ==========================================
_page_cache = {}  # Key: (pdf_path, page_num, dpi) -> numpy array
_page_cache_max_size = 20  # Max cached pages (to avoid memory bloat)

def render_pdf_page_cached(pdf_path: str, page_num: int, dpi: int = OCR_DPI) -> np.ndarray:
    """
    Render a single PDF page to numpy array, with caching.
    Much faster than convert_from_path for repeated access.
    """
    cache_key = (os.path.abspath(pdf_path), page_num, dpi)
    
    if cache_key in _page_cache:
        return _page_cache[cache_key]
    
    # Evict oldest entries if cache is full
    if len(_page_cache) >= _page_cache_max_size:
        oldest_key = next(iter(_page_cache))
        del _page_cache[oldest_key]
    
    # Render just this one page
    pages = convert_from_path(
        pdf_path, 
        dpi=dpi, 
        poppler_path=POPPLER_PATH,
        first_page=page_num + 1,  # pdf2image is 1-indexed
        last_page=page_num + 1
    )
    
    if not pages:
        eprint(f"WARNING: Could not render page {page_num} of {pdf_path}")
        return None
    
    page_img = np.array(pages[0])
    _page_cache[cache_key] = page_img
    
    return page_img

def clear_page_cache():
    """Clear the page rendering cache (call after processing a PDF)."""
    global _page_cache
    _page_cache = {}

# PaddleOCR import (replaces Tesseract)
try:
    import warnings
    warnings.filterwarnings('ignore')
    
    from paddleocr import PaddleOCR
    OCR_AVAILABLE = True
    # Initialize PaddleOCR once (lazy loaded on first use)
    _paddle_ocr_instance = None
    
    def get_paddle_ocr():
        global _paddle_ocr_instance
        if _paddle_ocr_instance is None:
            eprint("Initializing PaddleOCR...")
            # PaddleOCR v4 - keep default thresholds, they work well
            _paddle_ocr_instance = PaddleOCR(
                lang='en',
                ocr_version='PP-OCRv4',
                enable_hpi=False,  # Disable high-performance inference
                use_doc_orientation_classify=False,  # Disable document orientation
                use_doc_unwarping=False,  # Disable document unwarping
                use_textline_orientation=False,  # Disable text line orientation
            )
            eprint("PaddleOCR initialized")
        return _paddle_ocr_instance
    
    def preprocess_for_ocr(region):
        """
        Light preprocessing - just upscale small regions.
        Keep it minimal to avoid distorting character shapes.
        """
        # Ensure it's the right format
        if len(region.shape) == 2:
            region = cv2.cvtColor(region, cv2.COLOR_GRAY2RGB)
        
        # Only upscale very small regions
        h, w = region.shape[:2]
        min_height = 24
        if h < min_height:
            scale = min_height / h
            scale = min(scale, 3.0)  # Cap at 3x
            region = cv2.resize(region, None, fx=scale, fy=scale, interpolation=cv2.INTER_LANCZOS4)
        
        return region
    
    def run_paddle_ocr_single(image, ocr):
        """Run OCR on a single image orientation, returns (text, confidence)"""
        try:
            # PaddleOCR 2.x uses .ocr() method, 3.x uses .predict()
            if hasattr(ocr, 'ocr'):
                result = ocr.ocr(image, cls=False)
            else:
                result = ocr.predict(image)
            
            # Debug: print result structure
            eprint(f"    [OCR DEBUG] Result type: {type(result)}")
            if result:
                eprint(f"    [OCR DEBUG] Result length: {len(result)}")
                if result[0]:
                    eprint(f"    [OCR DEBUG] First item: {str(result[0][:2] if len(result[0]) > 2 else result[0])[:300]}")
            
            texts = []
            confidences = []
            if result:
                # PaddleOCR 2.x returns: [[box, (text, conf)], ...] for each page
                # PaddleOCR 3.x returns objects with rec_texts attribute
                for page_result in result:
                    if page_result is None:
                        continue
                    for item in page_result:
                        if isinstance(item, (list, tuple)) and len(item) >= 2:
                            # Format: [box_coords, (text, confidence)]
                            text_conf = item[1] if len(item) > 1 else item
                            if isinstance(text_conf, (list, tuple)) and len(text_conf) >= 2:
                                texts.append(str(text_conf[0]))
                                confidences.append(float(text_conf[1]))
                            elif isinstance(text_conf, str):
                                texts.append(text_conf)
                        elif hasattr(item, 'rec_texts') and item.rec_texts:
                            texts.extend(item.rec_texts)
                            if hasattr(item, 'rec_scores') and item.rec_scores:
                                confidences.extend(item.rec_scores)
                        elif isinstance(item, dict):
                            if 'rec_texts' in item:
                                texts.extend(item['rec_texts'])
                            if 'rec_scores' in item:
                                confidences.extend(item['rec_scores'])
            
            eprint(f"    [OCR DEBUG] Extracted texts: {texts}")
            text = ' '.join(texts).strip() if texts else ''
            avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
            return text, avg_conf
        except Exception as e:
            eprint(f"    [OCR DEBUG] Exception: {e}")
            return '', 0.0
    
    def run_paddle_ocr_two_stage(image, ocr):
        """
        Two-stage OCR: detect text regions first, then recognize on tight crops.
        This reduces noise from surrounding graphics/lines.
        
        NOTE: This requires the older PaddleOCR API with .ocr(det=, rec=) parameters.
        The newer PP-OCRv4 uses .predict() which doesn't support this.
        Currently disabled by default (use_two_stage=False).
        
        Returns: (text, confidence)
        """
        try:
            # Stage 1: Detection only - find text bounding boxes
            det_result = ocr.ocr(image, det=True, rec=False, cls=False)
            
            if not det_result or not det_result[0]:
                # No text detected, fall back to standard OCR
                eprint("    [two-stage] No text detected, falling back to standard")
                return run_paddle_ocr_single(image, ocr)
            
            num_boxes = len(det_result[0])
            eprint(f"    [two-stage] Detected {num_boxes} text region(s)")
            
            all_texts = []
            all_confs = []
            
            # Stage 2: For each detected text box, crop and recognize
            for i, box in enumerate(det_result[0]):
                # box is 4 corner points [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
                x_coords = [int(p[0]) for p in box]
                y_coords = [int(p[1]) for p in box]
                
                x1, x2 = max(0, min(x_coords)), min(image.shape[1], max(x_coords))
                y1, y2 = max(0, min(y_coords)), min(image.shape[0], max(y_coords))
                
                # Skip invalid crops
                if x2 <= x1 or y2 <= y1:
                    continue
                
                # Crop tightly to just this text region
                tight_crop = image[y1:y2, x1:x2]
                
                # Skip tiny crops
                if tight_crop.shape[0] < 5 or tight_crop.shape[1] < 5:
                    continue
                
                # Recognition only on the clean crop
                rec_result = ocr.ocr(tight_crop, det=False, rec=True, cls=False)
                
                if rec_result and rec_result[0]:
                    for line in rec_result[0]:
                        if isinstance(line, tuple) and len(line) >= 2:
                            text, conf = line[0], line[1]
                            if text:
                                all_texts.append(text)
                                all_confs.append(conf)
            
            if all_texts:
                final_text = ' '.join(all_texts)
                avg_conf = sum(all_confs) / len(all_confs)
                eprint(f"    [two-stage] Result: '{final_text}' (conf: {avg_conf:.2f})")
                return final_text, avg_conf
            else:
                # No text recognized, fall back to standard
                eprint("    [two-stage] No text recognized, falling back to standard")
                return run_paddle_ocr_single(image, ocr)
                
        except Exception as e:
            eprint(f"    [two-stage] API incompatible ({e}), using standard OCR")
            return run_paddle_ocr_single(image, ocr)
    
    def run_paddle_ocr(image, return_confidence=False, try_rotations=False, use_preprocessing=True, use_two_stage=False):
        """
        Run PaddleOCR on an image (numpy array or PIL Image)
        
        Args:
            image: Input image
            return_confidence: If True, returns (text, confidence) tuple
            try_rotations: If True, tries multiple orientations and picks best confidence
            use_preprocessing: If True, applies light preprocessing (upscaling)
            use_two_stage: If True, uses two-stage OCR (currently disabled - API incompatible)
            
        Returns:
            If return_confidence: (text, confidence) tuple
            Otherwise: just text string
        """
        ocr = get_paddle_ocr()
        
        # Ensure it's a numpy array
        if isinstance(image, Image.Image):
            image = np.array(image)
        
        # Ensure image is RGB (3 channels)
        if len(image.shape) == 2:
            image = cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
        elif image.shape[2] == 4:
            image = cv2.cvtColor(image, cv2.COLOR_RGBA2RGB)
        
        # Apply preprocessing for better OCR accuracy
        if use_preprocessing:
            processed_image = preprocess_for_ocr(image)
        else:
            processed_image = image
        
        # If try_rotations enabled, try multiple orientations and pick best
        if try_rotations:
            best_text = ''
            best_conf = 0.0
            best_orientation = "0°"
            
            # Try rotations - prioritize horizontal text (0° and 180°)
            # Also try flipped variants for mirrored text
            variants = [
                (processed_image, "0°"),
                (cv2.rotate(processed_image, cv2.ROTATE_180), "180°"),
                (cv2.flip(processed_image, 1), "0° hflip"),  # Horizontal flip
                (cv2.flip(cv2.rotate(processed_image, cv2.ROTATE_180), 1), "180° hflip"),
                (cv2.rotate(processed_image, cv2.ROTATE_90_CLOCKWISE), "90°"),
                (cv2.rotate(processed_image, cv2.ROTATE_90_COUNTERCLOCKWISE), "270°"),
            ]
            
            for variant_img, variant_name in variants:
                if use_two_stage:
                    text, conf = run_paddle_ocr_two_stage(variant_img, ocr)
                else:
                    text, conf = run_paddle_ocr_single(variant_img, ocr)
                if conf > best_conf and text:
                    best_conf = conf
                    best_text = text
                    best_orientation = variant_name
                    # Early exit if we get very high confidence
                    if conf > 0.95:
                        break
            
            if best_text:
                eprint(f"    -> Best OCR orientation: {best_orientation} (conf: {best_conf:.2f})")
            
            if return_confidence:
                return best_text, round(best_conf, 3)
            return best_text
        
        # Standard OCR (two-stage by default for better accuracy on noisy regions)
        try:
            if use_two_stage:
                text, avg_conf = run_paddle_ocr_two_stage(processed_image, ocr)
            else:
                text, avg_conf = run_paddle_ocr_single(processed_image, ocr)
            
            if return_confidence:
                return text, round(avg_conf, 3)
            return text
            
        except Exception as e:
            eprint(f"PaddleOCR error: {e}")
            if return_confidence:
                return '', 0.0
            return ''
    
    eprint("✓ PaddleOCR loaded")
    
    def fix_ocr_with_format(text, format_template, extra_letters=2, extra_digits=1, trailing_letters=1):
        """
        Fix OCR mistakes based on a format template.
        Works with ANY pattern of letters and numbers.
        
        Args:
            text: OCR result to fix
            format_template: Example format like "FI-12345", "ABC123", "XX-99-YY"
            extra_letters: How many extra letters are allowed in letter sections
            extra_digits: How many extra/fewer digits are allowed in number sections
            trailing_letters: How many trailing letters are allowed
            
        The format template is parsed character by character:
        - A-Z positions expect letters (1→I, 0→O)
        - 0-9 positions expect numbers (I→1, O→0)
        - Other chars are delimiters (kept as-is)
        
        Special handling:
        - If template has 2+ letters but only 1 found, adds 'I' (commonly missed)
        """
        if not text or not format_template:
            return text
        
        import re
        
        # Parse format template into sections
        # Each section is either: ('L', count), ('N', count), or ('D', delimiter_char)
        sections = []
        current_type = None
        current_count = 0
        
        for char in format_template.upper():
            if char.isalpha():
                if current_type == 'L':
                    current_count += 1
                else:
                    if current_type:
                        sections.append((current_type, current_count if current_type != 'D' else current_count))
                    current_type = 'L'
                    current_count = 1
            elif char.isdigit():
                if current_type == 'N':
                    current_count += 1
                else:
                    if current_type:
                        sections.append((current_type, current_count if current_type != 'D' else current_count))
                    current_type = 'N'
                    current_count = 1
            else:
                # Delimiter
                if current_type:
                    sections.append((current_type, current_count if current_type != 'D' else current_count))
                sections.append(('D', char))
                current_type = None
                current_count = 0
        
        if current_type:
            sections.append((current_type, current_count))
        
        # Convert input to uppercase
        text = text.upper()
        
        # Now process the text based on sections
        result = []
        text_idx = 0
        
        for sec_idx, section in enumerate(sections):
            sec_type, sec_value = section
            
            if sec_type == 'D':
                # Delimiter - look for it or skip
                if text_idx < len(text) and text[text_idx] == sec_value:
                    result.append(sec_value)
                    text_idx += 1
                elif text_idx < len(text) and not text[text_idx].isalnum():
                    # Different delimiter, keep original
                    result.append(text[text_idx])
                    text_idx += 1
                # If no delimiter found, continue without it
                continue
            
            # Calculate allowed range for this section
            base_count = sec_value
            is_last_letter_section = sec_type == 'L' and sec_idx == len(sections) - 1
            is_last_number_section = sec_type == 'N' and sec_idx == len(sections) - 1
            
            if sec_type == 'L':
                # First letter section gets extra_letters allowance
                if sec_idx == 0 or (sec_idx > 0 and sections[sec_idx-1][0] == 'D'):
                    max_count = base_count + extra_letters
                else:
                    max_count = base_count + trailing_letters if is_last_letter_section else base_count
                min_count = base_count
            else:  # N
                max_count = base_count + extra_digits
                min_count = max(1, base_count - extra_digits)
            
            # Consume characters for this section
            section_chars = []
            consumed = 0
            
            while text_idx < len(text) and consumed < max_count:
                char = text[text_idx]
                
                # Check if we hit a delimiter (next section)
                if not char.isalnum():
                    break
                
                # Check if this looks like wrong type and we have enough chars
                if sec_type == 'L':
                    # If we've consumed the expected letter count, stop on any digit
                    # Only convert 1/0 to I/O if we haven't reached expected count yet
                    if char.isdigit():
                        if consumed >= base_count:
                            # We have enough letters, this digit belongs to next section
                            break
                        elif char not in '10':
                            # Definitely a digit, not a confusable char
                            break
                    # Apply letter correction (only 1→I and 0→O)
                    if char == '1':
                        section_chars.append('I')
                    elif char == '0':
                        section_chars.append('O')
                    else:
                        section_chars.append(char)
                else:  # N
                    # If we've consumed the expected number count, stop on any letter
                    # Only convert I/O to 1/0 if we haven't reached expected count yet
                    if char.isalpha():
                        if consumed >= base_count:
                            # We have enough digits, this letter belongs to next section
                            break
                        elif char not in 'IO':
                            # Definitely a letter, not a confusable char
                            break
                    # Apply number correction (only I→1 and O→0)
                    if char == 'I':
                        section_chars.append('1')
                    elif char == 'O':
                        section_chars.append('0')
                    else:
                        section_chars.append(char)
                
                consumed += 1
                text_idx += 1
            
            # If letter section expects 2+ but only got 1, pad with 'I'
            # (common case: 'I' was missed or misread)
            if sec_type == 'L' and base_count >= 2 and len(section_chars) == 1:
                section_chars.append('I')
            
            result.extend(section_chars)
        
        # Handle any remaining characters (trailing letters)
        while text_idx < len(text):
            char = text[text_idx]
            if char.isalpha() or char == '1' or char == '0':
                # Treat remaining as trailing letters
                if char == '1':
                    result.append('I')
                elif char == '0':
                    result.append('O')
                else:
                    result.append(char)
            else:
                result.append(char)
            text_idx += 1
        
        return ''.join(result)
    
    # Keep backward compatible function
    def fix_pid_tag_ocr(text):
        """Simple P&ID tag fix without format template (backward compatibility)"""
        if not text:
            return text
        text = text.upper()
        import re
        match = re.match(r'^([A-Z0-9]+?)([-_\s]?)(\d.*)$', text)
        if match:
            letter_part = match.group(1).replace('1', 'I').replace('0', 'O')
            delimiter = match.group(2)
            number_part = match.group(3).replace('I', '1').replace('O', '0')
            return letter_part + delimiter + number_part
        return text

except ImportError as e:
    OCR_AVAILABLE = False
    eprint(f"Warning: PaddleOCR not installed. OCR functionality disabled. Install with: pip install paddleocr paddlepaddle")
    
    # Fallback versions when OCR module not loaded
    def fix_ocr_with_format(text, format_template, extra_letters=2, extra_digits=1, trailing_letters=1):
        return text
    
    def fix_pid_tag_ocr(text):
        return text

# Shape removal and OCR cleanup modules (kept for backward compatibility but not used with PaddleOCR)
SHAPE_REMOVAL_AVAILABLE = False
MULTI_PASS_OCR_AVAILABLE = False

class TemplateDetector:
    """
    Simple template matching detector for P&ID instruments
    Works well with consistent symbol styles
    """
    
    def __init__(self):
        self.templates = {}  # {label: [{'image': template, 'rotation': angle, 'inverted': bool}]}
        self.multi_orientation = False  # Flag for detecting multiple orientations
        self.include_inverted = False  # Flag for including horizontally flipped templates
        
    def load_training_data(self, json_path: str, pdf_path: str, multi_orientation: bool = False, include_inverted: bool = False, pages: List[int] = None):
        """
        Load training examples from annotation JSON
        
        Args:
            json_path: Path to training_data.json
            pdf_path: Path to the annotated PDF
            multi_orientation: Whether to create rotated templates (90°, 180°, 270°)
            include_inverted: Whether to create horizontally flipped (mirrored) templates
            pages: List of specific page numbers (0-indexed) that have annotations, or None for all pages
        """
        # Set the flags before loading
        self.multi_orientation = multi_orientation
        self.include_inverted = include_inverted
        
        eprint(f"Loading training data from {json_path}")
        eprint(f"Multi-orientation: {multi_orientation}")
        eprint(f"Include inverted: {include_inverted}")
        
        # Load annotations
        with open(json_path, 'r') as f:
            data = json.load(f)
            
        annotations = data['annotations']
        
        # Convert PDF to images - optimize by only converting pages that have annotations
        if pages and len(pages) > 0:
            # Only convert specific pages - much faster for training on subset of pages
            min_page = min(pages) + 1  # convert_from_path uses 1-indexed
            max_page = max(pages) + 1
            eprint(f"Converting pages {min_page}-{max_page} (0-indexed: {pages})...")
            
            converted_pages = convert_from_path(
                pdf_path,
                dpi=DETECTION_DPI,
                thread_count=4,
                poppler_path=POPPLER_PATH,
                first_page=min_page,
                last_page=max_page
            )

            # Create a mapping from page number to converted image
            # converted_pages[0] is min_page-1 (0-indexed), etc.
            page_images = {}
            for p in pages:
                idx = p - (min_page - 1)  # Index into converted_pages
                if 0 <= idx < len(converted_pages):
                    page_images[p] = converted_pages[idx]
        else:
            # Convert all pages (original behavior)
            eprint(f"Converting PDF to images...")
            all_pages = convert_from_path(pdf_path, dpi=DETECTION_DPI, thread_count=4, poppler_path=POPPLER_PATH)
            page_images = {i: all_pages[i] for i in range(len(all_pages))}
        
        # Helper function to add a template and optionally its inverted version
        def add_template_variants(label, template_img, rotation, inverted_base=False):
            """Add template and optionally its horizontally flipped version"""
            # Add the template as-is
            self.templates[label].append({
                'image': template_img, 
                'rotation': rotation,
                'inverted': inverted_base
            })
            
            # If include_inverted is enabled and this isn't already inverted, add flipped version
            if self.include_inverted and not inverted_base:
                flipped = cv2.flip(template_img, 1)  # 1 = horizontal flip
                self.templates[label].append({
                    'image': flipped,
                    'rotation': rotation,
                    'inverted': True
                })
        
        # Extract template images for each annotation
        for ann in annotations:
            page_num = ann['page']
            bbox = ann['bbox']
            label = bbox['label']
            
            # Get page image from our mapping
            if page_num not in page_images:
                eprint(f"Warning: Page {page_num} not loaded, skipping annotation")
                continue
            page_img = np.array(page_images[page_num])
            
            # Calculate pixel coordinates
            h, w = page_img.shape[:2]
            x = int(bbox['x'] * w)
            y = int(bbox['y'] * h)
            box_w = int(bbox['width'] * w)
            box_h = int(bbox['height'] * h)
            
            # Extract template
            template = page_img[y:y+box_h, x:x+box_w]
            
            # Convert to grayscale
            template_gray = cv2.cvtColor(template, cv2.COLOR_RGB2GRAY)
            
            # Apply preprocessing to make it more robust
            # 1. Normalize contrast
            template_gray = cv2.equalizeHist(template_gray)
            
            # 2. Apply slight blur to reduce noise
            template_gray = cv2.GaussianBlur(template_gray, (3, 3), 0)
            
            # Initialize label storage
            if label not in self.templates:
                self.templates[label] = []
            
            # Store original template with rotation=0, inverted=False (+ inverted if enabled)
            add_template_variants(label, template_gray, rotation=0, inverted_base=False)
            
            # Add 90°, 180°, 270° rotations if multi-orientation is enabled
            if self.multi_orientation:
                # Use cv2.rotate for clean 90/180/270 rotations (no clipping issues)
                rotation_configs = [
                    (90, cv2.ROTATE_90_CLOCKWISE),
                    (180, cv2.ROTATE_180),
                    (270, cv2.ROTATE_90_COUNTERCLOCKWISE)
                ]
                
                for base_angle, cv_rotation in rotation_configs:
                    # Create the base rotated template using cv2.rotate (clean, no clipping)
                    base_rotated = cv2.rotate(template_gray, cv_rotation)
                    
                    # Store the exact rotation (+ inverted if enabled)
                    add_template_variants(label, base_rotated, rotation=base_angle, inverted_base=False)
                
                eprint(f"  Created rotated templates for '{label}': 0°, 90°, 180°, 270°")
            
            if self.include_inverted:
                eprint(f"  Created inverted (mirrored) templates for '{label}'")
            
        eprint(f"Loaded {sum(len(v) for v in self.templates.values())} templates (including augmentations)")
        eprint(f"Classes: {list(self.templates.keys())}")
        eprint(f"Templates per class: {[(k, len(v)) for k, v in self.templates.items()]}")
        if self.multi_orientation:
            eprint("Multi-orientation detection enabled (0°, 90°, 180°, 270°)")
        if self.include_inverted:
            eprint("Inverted (horizontally flipped) templates enabled")
        
    def detect(self, image: np.ndarray, threshold: float = 0.7) -> List[Dict]:
        """
        Detect instruments in an image using template matching
        
        Args:
            image: Input image (numpy array)
            threshold: Matching threshold (0-1)
            
        Returns:
            List of detections with bbox, label, detected_rotation, and detected_inverted
        """
        detections = []
        
        # Convert to grayscale
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        
        # Preprocess image same as templates
        gray = cv2.equalizeHist(gray)
        gray = cv2.GaussianBlur(gray, (3, 3), 0)
        
        h, w = gray.shape
        
        # For each template class
        for label, templates in self.templates.items():
            for template_data in templates:
                # Handle both old format (just image) and new format (dict with image, rotation, inverted)
                if isinstance(template_data, dict):
                    template = template_data['image']
                    rotation = template_data.get('rotation', 0)
                    inverted = template_data.get('inverted', False)
                else:
                    # Backward compatibility with old pickled models
                    template = template_data
                    rotation = 0
                    inverted = False
                
                # Only use scale 1.0 since that's where all matches are found
                scale = 1.0
                
                # Resize template (even though scale is 1.0, keep for consistency)
                t_h, t_w = template.shape
                resized = cv2.resize(
                    template, 
                    (int(t_w * scale), int(t_h * scale))
                )
                
                # Skip if template larger than image
                if resized.shape[0] > h or resized.shape[1] > w:
                    continue
                
                # Template matching
                result = cv2.matchTemplate(gray, resized, cv2.TM_CCOEFF_NORMED)
                
                # Find matches above threshold
                locations = np.where(result >= threshold)
                
                num_matches = len(locations[0])
                inv_str = " [INV]" if inverted else ""
                eprint(f"  Checking {label} (rot={rotation}°{inv_str}): {num_matches} matches")
                
                # Skip if too many matches (likely a bad template)
                if num_matches > 1000:
                    eprint(f"  WARNING: Too many matches ({num_matches}), skipping this template")
                    continue
                
                for pt in zip(*locations[::-1]):
                    detections.append({
                        'bbox': {
                            'x': pt[0] / w,
                            'y': pt[1] / h,
                            'width': resized.shape[1] / w,
                            'height': resized.shape[0] / h
                        },
                        'label': label,
                        'confidence': float(result[pt[1], pt[0]]),
                        'detected_rotation': rotation,  # Track which rotation matched
                        'detected_inverted': inverted   # Track if detected from inverted template
                    })
        
        # Non-maximum suppression to remove duplicates
        # Uses center-distance for same-class (handles rotated templates) and IoU for cross-class
        detections = self.non_max_suppression(detections, iou_threshold=0.5)
        
        return detections
    
    def non_max_suppression(self, detections: List[Dict], iou_threshold: float = 0.5) -> List[Dict]:
        """
        Remove overlapping detections using both IoU and center-distance
        
        Args:
            detections: List of detection dictionaries
            iou_threshold: IoU threshold for suppression
            
        Returns:
            Filtered detections
        """
        if not detections:
            return []
        
        # Sort by confidence
        detections = sorted(detections, key=lambda x: x['confidence'], reverse=True)
        
        keep = []
        
        while detections:
            # Keep highest confidence detection
            best = detections.pop(0)
            keep.append(best)
            
            # Calculate center of best detection
            best_cx = best['bbox']['x'] + best['bbox']['width'] / 2
            best_cy = best['bbox']['y'] + best['bbox']['height'] / 2
            best_size = max(best['bbox']['width'], best['bbox']['height'])
            
            # Remove overlapping detections
            filtered = []
            for d in detections:
                # Calculate center of this detection
                d_cx = d['bbox']['x'] + d['bbox']['width'] / 2
                d_cy = d['bbox']['y'] + d['bbox']['height'] / 2
                
                # Center distance (normalized by box size)
                center_dist = ((best_cx - d_cx) ** 2 + (best_cy - d_cy) ** 2) ** 0.5
                
                # If same class and centers are very close, it's a duplicate
                # (handles rotated template detections with different aspect ratios)
                if d['label'] == best['label'] and center_dist < best_size * 0.5:
                    continue  # Skip this duplicate
                
                # Also check IoU for different classes or farther detections
                if self.iou(best['bbox'], d['bbox']) >= iou_threshold:
                    continue  # Skip overlapping detection
                
                filtered.append(d)
            
            detections = filtered
        
        return keep
    
    @staticmethod
    def iou(box1: Dict, box2: Dict) -> float:
        """Calculate Intersection over Union"""
        x1_1 = box1['x']
        y1_1 = box1['y']
        x2_1 = box1['x'] + box1['width']
        y2_1 = box1['y'] + box1['height']
        
        x1_2 = box2['x']
        y1_2 = box2['y']
        x2_2 = box2['x'] + box2['width']
        y2_2 = box2['y'] + box2['height']
        
        # Intersection
        x1_i = max(x1_1, x1_2)
        y1_i = max(y1_1, y1_2)
        x2_i = min(x2_1, x2_2)
        y2_i = min(y2_1, y2_2)
        
        if x2_i < x1_i or y2_i < y1_i:
            return 0.0
        
        intersection = (x2_i - x1_i) * (y2_i - y1_i)
        
        # Union
        area1 = (x2_1 - x1_1) * (y2_1 - y1_1)
        area2 = (x2_2 - x1_2) * (y2_2 - y1_2)
        union = area1 + area2 - intersection
        
        return intersection / union if union > 0 else 0.0
    
    def normalize_region_for_ocr(self, region: np.ndarray, detected_rotation: int, detected_inverted: bool = False) -> np.ndarray:
        """
        Normalize a detected region back to original orientation for OCR
        
        NOTE: We do NOT flip the image for inversion because text on the PDF is always 
        readable as printed. However, when inverted+rotated, the effective rotation
        direction is reversed, so we use the opposite rotation to normalize.
        
        Args:
            region: The extracted image region (numpy array)
            detected_rotation: The rotation angle at which this was detected (0, 90, 180, 270)
            detected_inverted: Whether detected from inverted template (affects rotation direction)
            
        Returns:
            Normalized image in original orientation
        """
        result = region
        
        # NOTE: Do NOT flip for inversion - text is always readable on the page
        # But we DO need to use opposite rotation when inverted
        
        # When inverted, rotation direction is effectively reversed
        # So use the opposite rotation to normalize back to readable
        effectiveRotation = detected_rotation
        if detected_inverted:
            if detected_rotation == 90:
                effectiveRotation = 270
            elif detected_rotation == 270:
                effectiveRotation = 90
            # 180 and 0 stay the same
        
        # Handle rotation
        if effectiveRotation == 0:
            return result
        
        # Rotate back by the negative of the effective rotation
        if effectiveRotation == 90:
            return cv2.rotate(result, cv2.ROTATE_90_COUNTERCLOCKWISE)
        elif effectiveRotation == 180:
            return cv2.rotate(result, cv2.ROTATE_180)
        elif effectiveRotation == 270:
            return cv2.rotate(result, cv2.ROTATE_90_CLOCKWISE)
        
        return result
    
    # Backward compatibility alias
    def rotate_region_to_upright(self, region: np.ndarray, detected_rotation: int) -> np.ndarray:
        """Alias for normalize_region_for_ocr (backward compatibility)"""
        return self.normalize_region_for_ocr(region, detected_rotation, False)
    
    def extract_text_from_detections(self, pdf_path: str, detections: List[Dict], 
                                     expand_box: float = 1.15, class_patterns: dict = None,
                                     per_class_formats: dict = None) -> List[Dict]:
        """
        Extract text using OCR from detected instrument regions
        
        Args:
            pdf_path: Path to PDF
            detections: List of detections with bbox and label
            expand_box: Factor to expand bounding box to capture nearby text (default 1.15)
            class_patterns: Dict of {className: regexPattern} for class-specific filtering
            per_class_formats: Dict of {modelId: formatTemplate} for per-class 1/I, 0/O correction
            
        Returns:
            List of detections with added 'ocr_text' field and confidence info
        """
        if not OCR_AVAILABLE:
            eprint("OCR not available - install paddleocr and paddlepaddle")
            return detections
        
        eprint(f"Extracting text from {len(detections)} detected instruments...")
        if class_patterns:
            eprint(f"Using class-specific patterns: {class_patterns}")
        if per_class_formats:
            eprint(f"Per-class OCR formats: {per_class_formats}")
        
        # Find which pages we actually need (don't render all pages)
        needed_pages = set(det['page'] for det in detections)
        eprint(f"Pages needed for OCR: {sorted(needed_pages)}")
        
        # Render pages on demand using cache
        
        # Group detections by page
        for i, det in enumerate(detections):
            page_num = det['page']
            bbox = det['bbox']
            detected_rotation = det.get('detected_rotation', 0)
            detected_inverted = det.get('detected_inverted', False)
            
            # Get page image (cached — only renders once per page)
            page_img = render_pdf_page_cached(pdf_path, page_num, OCR_DPI)
            if page_img is None:
                det['ocr_text'] = ''
                det['ocr_raw'] = ''
                det['ocr_confidence'] = 0.0
                det['format_score'] = 0
                det['text_touching_border'] = False
                det['touch_confidence'] = 0.0
                continue
            
            h, w = page_img.shape[:2]
            
            # Convert bbox to pixels and expand to capture nearby text
            center_x = bbox['x'] + bbox['width'] / 2
            center_y = bbox['y'] + bbox['height'] / 2
            expanded_w = bbox['width'] * expand_box
            expanded_h = bbox['height'] * expand_box
            
            x1 = int(max(0, (center_x - expanded_w / 2) * w))
            y1 = int(max(0, (center_y - expanded_h / 2) * h))
            x2 = int(min(w, (center_x + expanded_w / 2) * w))
            y2 = int(min(h, (center_y + expanded_h / 2) * h))
            
            # Extract region
            region = page_img[y1:y2, x1:x2]
            
            # Normalize region back to original orientation if rotated (or inverted+rotated)
            # NOTE: We DON'T flip for inversion - text is always readable on the PDF
            # But we DO use opposite rotation when inverted
            if detected_rotation != 0:
                eprint(f"  [{i+1}] Normalizing region from {detected_rotation}° (inverted={detected_inverted}) for OCR")
                region = self.normalize_region_for_ocr(region, detected_rotation, detected_inverted)
            
            # Convert RGB to BGR for OpenCV
            region_bgr = cv2.cvtColor(region, cv2.COLOR_RGB2BGR)
            
            # Run OCR
            try:
                # Only read left-to-right - template matching has already normalized orientation
                # Don't try rotations as it can misread (e.g., "LI" becomes "17" when flipped)
                raw_text, ocr_conf = run_paddle_ocr(region, return_confidence=True, try_rotations=False)
                
                # Clean whitespace and newlines
                raw_text = raw_text.replace('\n', ' ').strip()
                det['ocr_raw'] = raw_text
                
                # Look up format template for this class (keyed by className)
                format_template = None
                if per_class_formats:
                    label = det.get('label', '')
                    # Direct lookup by className
                    if label in per_class_formats:
                        format_template = per_class_formats[label]
                    # If no match and only one format, apply to all
                    elif len(per_class_formats) == 1:
                        format_template = list(per_class_formats.values())[0]
                
                # Apply format-based correction if template found (fix 1/I and 0/O confusion)
                if format_template and raw_text:
                    corrected_text = fix_ocr_with_format(raw_text, format_template)
                else:
                    corrected_text = raw_text
                det['ocr_text'] = corrected_text
                det['ocr_confidence'] = ocr_conf  # Numeric confidence from PaddleOCR
                det['format_score'] = 0
                det['text_touching_border'] = False
                det['touch_confidence'] = 0.0
                
                if corrected_text:
                    if format_template and corrected_text != raw_text:
                        eprint(f"  [{i+1}/{len(detections)}] ✓ OCR: '{raw_text}' → '{corrected_text}' (conf: {ocr_conf:.2f})")
                    else:
                        eprint(f"  [{i+1}/{len(detections)}] ✓ OCR: '{raw_text}' (conf: {ocr_conf:.2f})")
                else:
                    eprint(f"  [{i+1}/{len(detections)}] ✗ OCR: (empty)")
                
            except Exception as e:
                det['ocr_text'] = ''
                det['ocr_raw'] = ''
                det['ocr_confidence'] = 0.0  # Numeric confidence
                det['format_score'] = 0
                det['text_touching_border'] = False
                det['touch_confidence'] = 0.0
                eprint(f"  [{i+1}/{len(detections)}] OCR error: {e}")
        
        return detections
    
    def extract_subclass_values(self, detections: List[Dict], pdf_path: str, 
                                 subclass_regions: Dict[str, Dict], expand_box: float = 1.0,
                                 training_box_size: Dict = None,
                                 per_subclass_formats: Dict[str, str] = None) -> List[Dict]:
        """
        Extract OCR values for each subclass region within detected objects.
        
        Subclass regions should contain ABSOLUTE page coordinates (not relative to detection).
        This eliminates coordinate transformation issues.
        
        Args:
            detections: List of detection results
            pdf_path: Path to PDF file
            subclass_regions: Dict mapping subclass name to ABSOLUTE page coords (0-1)
                              e.g., {"Tag": {"x": 0.5, "y": 0.1, "width": 0.02, "height": 0.01}}
            per_subclass_formats: Dict of {subclassName: formatTemplate} for OCR correction
            
        Returns:
            List of detections with added 'subclassValues' field
        """
        if not OCR_AVAILABLE:
            eprint("OCR not available for subclass extraction")
            return detections
            
        if not subclass_regions:
            return detections
            
        eprint(f"=== Extracting subclass values ===")
        eprint(f"Detections: {len(detections)}")
        eprint(f"Subclass regions: {list(subclass_regions.keys())}")
        if per_subclass_formats:
            eprint(f"Subclass OCR formats: {per_subclass_formats}")
        
        # Render pages on demand using cache
        
        for i, det in enumerate(detections):
            page_num = det['page']
            det_bbox = det['bbox']
            detected_rotation = det.get('detected_rotation', 0)
            detected_inverted = det.get('detected_inverted', False)
            
            # Get page image (cached — only renders once per page)
            page_img = render_pdf_page_cached(pdf_path, page_num, OCR_DPI)
            if page_img is None:
                det['subclassValues'] = {name: '' for name in subclass_regions}
                continue
            
            h, w = page_img.shape[:2]
            
            eprint(f"Page size at 300 DPI: {w}x{h}")
            eprint(f"Detection bbox: x={det_bbox['x']:.4f}, y={det_bbox['y']:.4f}, w={det_bbox['width']:.4f}, h={det_bbox['height']:.4f}")
            
            # Detection center for offset calculation
            det_center_x = det_bbox['x'] + det_bbox['width'] / 2
            det_center_y = det_bbox['y'] + det_bbox['height'] / 2
            
            subclass_values = {}
            
            for subclass_name, region in subclass_regions.items():
                try:
                    # Check if we have absolute coords (new format) or relative coords (old format)
                    if 'relativeX' in region:
                        # NEW FORMAT: Absolute page coordinates stored
                        # We need to offset them based on detection vs training position
                        
                        # The subclass regions are stored relative to training box position
                        # Get relative coords (0-1 within training box)
                        rel_x = region['relativeX']
                        rel_y = region['relativeY']
                        rel_w = region['relativeWidth']
                        rel_h = region['relativeHeight']
                        
                        eprint(f"  [{subclass_name}] Using NEW format - relative coords: x={rel_x:.4f}, y={rel_y:.4f}, w={rel_w:.4f}, h={rel_h:.4f}")
                        eprint(f"  [{subclass_name}] Detection: rotation={detected_rotation}°, inverted={detected_inverted}")
                        
                        # For coordinate mapping, use the ACTUAL rotation (not opposite)
                        # The transforms map from training coords to detection coords
                        
                        # First apply rotation transform
                        if detected_rotation == 90:
                            new_x = 1 - rel_y - rel_h
                            new_y = rel_x
                            new_w = rel_h
                            new_h = rel_w
                            rel_x, rel_y, rel_w, rel_h = new_x, new_y, new_w, new_h
                            eprint(f"  [{subclass_name}] After 90° rotation: x={rel_x:.4f}, y={rel_y:.4f}")
                        elif detected_rotation == 180:
                            new_x = 1 - rel_x - rel_w
                            new_y = 1 - rel_y - rel_h
                            rel_x, rel_y = new_x, new_y
                            eprint(f"  [{subclass_name}] After 180° rotation: x={rel_x:.4f}, y={rel_y:.4f}")
                        elif detected_rotation == 270:
                            new_x = rel_y
                            new_y = 1 - rel_x - rel_w
                            new_w = rel_h
                            new_h = rel_w
                            rel_x, rel_y, rel_w, rel_h = new_x, new_y, new_w, new_h
                            eprint(f"  [{subclass_name}] After 270° rotation: x={rel_x:.4f}, y={rel_y:.4f}")
                        
                        # Then apply inversion (flip X) if detected from inverted template
                        if detected_inverted:
                            rel_x = 1 - rel_x - rel_w
                            eprint(f"  [{subclass_name}] After inversion: x={rel_x:.4f}")
                        
                        # Apply to detection bbox
                        region_x = int((det_bbox['x'] + rel_x * det_bbox['width']) * w)
                        region_y = int((det_bbox['y'] + rel_y * det_bbox['height']) * h)
                        region_w = int(rel_w * det_bbox['width'] * w)
                        region_h = int(rel_h * det_bbox['height'] * h)
                        
                    else:
                        # OLD FORMAT: Relative coords only (0-1 within detection box)
                        rel_x = region['x']
                        rel_y = region['y']
                        rel_w = region['width']
                        rel_h = region['height']
                        
                        eprint(f"  [{subclass_name}] Using OLD format - relative coords: x={rel_x:.4f}, y={rel_y:.4f}, w={rel_w:.4f}, h={rel_h:.4f}")
                        
                        # Apply rotation transform (actual rotation, not opposite)
                        if detected_rotation == 90:
                            new_x = 1 - rel_y - rel_h
                            new_y = rel_x
                            new_w = rel_h
                            new_h = rel_w
                            rel_x, rel_y, rel_w, rel_h = new_x, new_y, new_w, new_h
                        elif detected_rotation == 180:
                            rel_x = 1 - rel_x - rel_w
                            rel_y = 1 - rel_y - rel_h
                        elif detected_rotation == 270:
                            new_x = rel_y
                            new_y = 1 - rel_x - rel_w
                            new_w = rel_h
                            new_h = rel_w
                            rel_x, rel_y, rel_w, rel_h = new_x, new_y, new_w, new_h
                        
                        # Apply inversion (flip X)
                        if detected_inverted:
                            rel_x = 1 - rel_x - rel_w
                        
                        # Apply to detection bbox
                        region_x = int((det_bbox['x'] + rel_x * det_bbox['width']) * w)
                        region_y = int((det_bbox['y'] + rel_y * det_bbox['height']) * h)
                        region_w = int(rel_w * det_bbox['width'] * w)
                        region_h = int(rel_h * det_bbox['height'] * h)
                    
                    eprint(f"  [{subclass_name}] Region on page: x={region_x}, y={region_y}, w={region_w}, h={region_h}")
                    
                    # Small padding for OCR clarity
                    padding = 5
                    region_x = region_x - padding
                    region_y = region_y - padding
                    region_w = region_w + padding * 2
                    region_h = region_h + padding * 2
                    
                    # Clamp to page bounds
                    region_x = max(0, region_x)
                    region_y = max(0, region_y)
                    region_w = min(w - region_x, region_w)
                    region_h = min(h - region_y, region_h)
                    
                    # DEBUG: Save image of full detection box with subclass region marked
                    try:
                        debug_dir = 'debug_subclass_regions'
                        import os
                        if not os.path.exists(debug_dir):
                            os.makedirs(debug_dir)
                        
                        # Get detection box area
                        det_x_px = int(det_bbox['x'] * w)
                        det_y_px = int(det_bbox['y'] * h)
                        det_w_px = int(det_bbox['width'] * w)
                        det_h_px = int(det_bbox['height'] * h)
                        
                        # Crop detection box (with padding)
                        pad = 20
                        full_x = max(0, det_x_px - pad)
                        full_y = max(0, det_y_px - pad)
                        full_x2 = min(w, det_x_px + det_w_px + pad)
                        full_y2 = min(h, det_y_px + det_h_px + pad)
                        full_crop = page_img[full_y:full_y2, full_x:full_x2].copy()
                        
                        # Draw rectangle showing where subclass region will be extracted
                        # Coords relative to full_crop
                        rect_x = region_x - full_x
                        rect_y = region_y - full_y
                        cv2.rectangle(full_crop, 
                                     (rect_x, rect_y), 
                                     (rect_x + region_w, rect_y + region_h),
                                     (255, 0, 0), 2)  # Red rectangle
                        
                        # Also draw detection box boundary in green
                        det_rect_x = det_x_px - full_x
                        det_rect_y = det_y_px - full_y
                        cv2.rectangle(full_crop,
                                     (det_rect_x, det_rect_y),
                                     (det_rect_x + det_w_px, det_rect_y + det_h_px),
                                     (0, 255, 0), 1)  # Green rectangle
                        
                        debug_path = os.path.join(debug_dir, f'det{i}_{subclass_name}_overlay.png')
                        cv2.imwrite(debug_path, cv2.cvtColor(full_crop, cv2.COLOR_RGB2BGR))
                        eprint(f"  [{subclass_name}] Saved overlay image: {debug_path}")
                    except Exception as de:
                        eprint(f"  [{subclass_name}] Could not save overlay image: {de}")
                    
                    # Crop the region
                    region_img = page_img[region_y:region_y+region_h, region_x:region_x+region_w]
                    
                    if region_img.size == 0:
                        eprint(f"  [{i+1}] {subclass_name}: Empty region, skipping")
                        subclass_values[subclass_name] = ""
                        continue
                    
                    # DEBUG: Save cropped region for inspection
                    try:
                        debug_path = os.path.join(debug_dir, f'det{i}_{subclass_name}_raw.png')
                        cv2.imwrite(debug_path, cv2.cvtColor(region_img, cv2.COLOR_RGB2BGR))
                        eprint(f"  [{subclass_name}] Saved raw image: {debug_path}")
                    except Exception as de:
                        eprint(f"  [{subclass_name}] Could not save debug image: {de}")
                    
                    # Normalize region orientation for OCR (rotate only, no flip)
                    # NOTE: We DON'T flip for inversion because text is always readable on the PDF
                    # But we DO use opposite rotation when inverted
                    if detected_rotation != 0:
                        region_img = self.normalize_region_for_ocr(region_img, detected_rotation, detected_inverted)
                    
                    # Preprocess for OCR
                    if len(region_img.shape) == 3:
                        gray = cv2.cvtColor(region_img, cv2.COLOR_RGB2GRAY)
                    else:
                        gray = region_img
                    
                    # Upscale for better OCR
                    scale_factor = 3
                    upscaled = cv2.resize(gray, (gray.shape[1] * scale_factor, gray.shape[0] * scale_factor))
                    
                    # Threshold
                    _, thresh = cv2.threshold(upscaled, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
                    
                    # OCR with PaddleOCR (handles text in shapes better)
                    # Use the upscaled image for better results
                    ocr_text = run_paddle_ocr(upscaled)
                    
                    # Clean up
                    ocr_text = ocr_text.replace('\n', ' ').strip()
                    
                    # Apply format correction if available for this subclass
                    raw_text = ocr_text
                    if per_subclass_formats and ocr_text:
                        # Look up format by subclass name (e.g., "Tag", "Value")
                        format_template = per_subclass_formats.get(subclass_name)
                        if format_template:
                            ocr_text = fix_ocr_with_format(ocr_text, format_template)
                            if ocr_text != raw_text:
                                eprint(f"  [{i+1}] {subclass_name}: OCR corrected '{raw_text}' → '{ocr_text}'")
                    
                    subclass_values[subclass_name] = ocr_text
                    eprint(f"  [{i+1}] {subclass_name}: '{ocr_text}' (rot={detected_rotation}°, inv={detected_inverted})")
                    
                except Exception as e:
                    eprint(f"  [{i+1}] {subclass_name} OCR error: {e}")
                    subclass_values[subclass_name] = ""
            
            det['subclassValues'] = subclass_values
        
        return detections
    
    def export_to_csv(self, detections: List[Dict], output_path: str = 'instrument_data.csv'):
        """
        Export detections with OCR text and touch detection status to CSV
        
        Args:
            detections: List of detections with ocr_text
            output_path: Path to output CSV file
        """
        eprint(f"Exporting {len(detections)} detections to {output_path}")
        
        with open(output_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            
            # Header
            writer.writerow([
                'Index',
                'Label', 
                'Page',
                'X', 
                'Y', 
                'Width', 
                'Height',
                'Confidence',
                'Tag',
                'OCR_Raw',
                'OCR_Confidence',
                'Format_Score',
                'Text_Touching_Border',
                'Touch_Confidence'
            ])
            
            # Data
            for i, det in enumerate(detections):
                writer.writerow([
                    i + 1,
                    det.get('label', 'instrument'),
                    det.get('page', 0) + 1,  # 1-indexed for users
                    f"{det['bbox']['x']:.4f}",
                    f"{det['bbox']['y']:.4f}",
                    f"{det['bbox']['width']:.4f}",
                    f"{det['bbox']['height']:.4f}",
                    f"{det.get('confidence', 0):.4f}",
                    det.get('ocr_text', ''),
                    det.get('ocr_raw', ''),
                    det.get('ocr_confidence', 'low'),
                    det.get('format_score', 0),
                    det.get('text_touching_border', False),
                    f"{det.get('touch_confidence', 0.0):.2f}"
                ])
        
        eprint(f"CSV saved to {output_path}")
    
    def detect_in_pdf(self, pdf_path: str, threshold: float = 0.7, pages: List[int] = None) -> List[Dict]:
        """
        Run detection on all pages of a PDF
        
        Args:
            pdf_path: Path to PDF file
            threshold: Detection threshold
            pages: List of specific page numbers to process (1-indexed), or None for all pages
            
        Returns:
            List of detections with page numbers
        """
        eprint(f"Running detection on {pdf_path}")
        
        all_detections = []
        
        # Optimize PDF conversion based on requested pages
        if pages and len(pages) > 0:
            # Only convert specific pages - much faster for single-page detection
            min_page = min(pages)
            max_page = max(pages)
            eprint(f"Converting pages {min_page}-{max_page} (requested: {pages})")
            
            converted_pages = convert_from_path(
                pdf_path,
                dpi=DETECTION_DPI,
                thread_count=4,
                poppler_path=POPPLER_PATH,
                first_page=min_page,
                last_page=max_page
            )

            # Map converted pages to their actual page numbers
            # converted_pages[0] is min_page, converted_pages[1] is min_page+1, etc.
            pages_to_process = []
            for p in pages:
                if min_page <= p <= max_page:
                    idx = p - min_page  # Index into converted_pages
                    if idx < len(converted_pages):
                        pages_to_process.append((p - 1, converted_pages[idx]))  # p-1 for 0-indexed page number

            eprint(f"Processing {len(pages_to_process)} specific page(s): {pages}")
            total_pages = max_page  # For logging purposes
        else:
            # Convert all pages
            eprint("Converting all pages...")
            all_pages = convert_from_path(pdf_path, dpi=DETECTION_DPI, thread_count=4, poppler_path=POPPLER_PATH)
            pages_to_process = list(enumerate(all_pages))
            total_pages = len(all_pages)
            eprint(f"Processing all {len(pages_to_process)} pages")
        
        for page_num, page in pages_to_process:
            eprint(f"Processing page {page_num + 1}/{total_pages}")
            
            # Convert to numpy array
            page_img = np.array(page)
            
            # Detect
            detections = self.detect(page_img, threshold)
            
            # Add page number
            for det in detections:
                det['page'] = page_num
                all_detections.append(det)
        
        eprint(f"Found {len(all_detections)} instruments")
        
        return all_detections
    
    def visualize_detections(self, pdf_path: str, detections: List[Dict], output_path: str = None):
        """
        Visualize detections on PDF pages
        
        Args:
            pdf_path: Path to PDF
            detections: List of detections
            output_path: Output directory for images (optional)
        """
        import matplotlib.pyplot as plt
        
        # Convert PDF to images
        pages = convert_from_path(pdf_path, dpi=DETECTION_DPI, thread_count=4, poppler_path=POPPLER_PATH)
        
        if output_path and not os.path.exists(output_path):
            os.makedirs(output_path)
        
        # Group detections by page
        for page_num, page in enumerate(pages):
            page_img = np.array(page)
            
            # Get detections for this page
            page_dets = [d for d in detections if d['page'] == page_num]
            
            if not page_dets:
                continue
            
            # Draw boxes
            h, w = page_img.shape[:2]
            
            for det in page_dets:
                bbox = det['bbox']
                x = int(bbox['x'] * w)
                y = int(bbox['y'] * h)
                box_w = int(bbox['width'] * w)
                box_h = int(bbox['height'] * h)
                
                # Color code based on OCR confidence
                ocr_conf = det.get('ocr_confidence', 'low')
                if det.get('text_touching_border', False):
                    color = (255, 0, 0)  # Red for touching
                elif ocr_conf == 'high':
                    color = (0, 255, 0)  # Green for high confidence
                elif ocr_conf == 'medium':
                    color = (255, 255, 0)  # Yellow for medium
                else:
                    color = (255, 165, 0)  # Orange for low
                
                # Draw rectangle
                cv2.rectangle(page_img, (x, y), (x + box_w, y + box_h), color, 3)
                
                # Add label
                label_text = f"{det['label']} ({det['confidence']:.2f})"
                cv2.putText(
                    page_img, label_text, (x, y - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, color, 2
                )
            
            # Display or save
            if output_path:
                output_file = os.path.join(output_path, f'page_{page_num}.png')
                Image.fromarray(page_img).save(output_file)
                eprint(f"Saved: {output_file}")
            else:
                plt.figure(figsize=(12, 16))
                plt.imshow(page_img)
                plt.title(f'Page {page_num + 1} - {len(page_dets)} detections')
                plt.axis('off')
                plt.show()


# Example usage
if __name__ == '__main__':
    # Initialize detector
    detector = TemplateDetector()
    
    # Load training data
    detector.load_training_data(
        'training_data.json',
        'example_pid.pdf'
    )
    
    # Run detection on new PDF
    detections = detector.detect_in_pdf(
        'test_pid.pdf',
        threshold=0.75
    )
    
    # Extract text with OCR (now with multi-pass and format matching)
    detections = detector.extract_text_from_detections(
        'test_pid.pdf',
        detections,
        format_template='XI-12345',  # Example format
        extra_letters=2,
        extra_digits=1,
        trailing_letters=1
    )
    
    # Export to CSV (includes confidence columns)
    detector.export_to_csv(detections, 'instrument_data.csv')
    
    # Visualize results (green=high, yellow=medium, orange=low, red=touching)
    detector.visualize_detections(
        'test_pid.pdf',
        detections,
        output_path='detection_results'
    )
    
    # Save detections to JSON
    with open('detections.json', 'w') as f:
        json.dump(detections, f, indent=2)
    
    eprint(f"Detection complete! Found {len(detections)} instruments")
