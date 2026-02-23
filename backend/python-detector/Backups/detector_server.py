#!/usr/bin/env python3
"""
Persistent Detector Server
Flask server that keeps PaddleOCR loaded in memory for fast OCR.
Handles detection requests and saves results incrementally.
"""

# Disable oneDNN/MKLDNN before importing paddle (fixes compatibility issues)
import os
os.environ['FLAGS_use_mkldnn'] = '0'
os.environ['PADDLE_DISABLE_MKLDNN'] = '1'
os.environ['FLAGS_use_onednn'] = '0'
os.environ['FLAGS_enable_pir_api'] = '0'
os.environ['FLAGS_enable_pir_in_executor'] = '0'

import sys
import json
import warnings
warnings.filterwarnings('ignore')

from flask import Flask, request, jsonify
from flask_cors import CORS
import pickle
import numpy as np
import cv2
from pdf2image import convert_from_path
from PIL import Image
from typing import List, Dict
from datetime import datetime

# Import the detector
from detector import TemplateDetector, OCR_AVAILABLE, run_paddle_ocr, POPPLER_PATH, fix_ocr_with_format, get_paddle_ocr

# Configure paths
MODELS_DIR = 'models'
OBJECTS_DIR = '../objects'

app = Flask(__name__)
CORS(app)

# ============ Global State ============
loaded_detectors = {}  # Cache loaded detector models

def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)

def cross_model_nms(detections, iou_threshold=0.5):
    """
    Remove duplicate detections across models using center-distance and IoU.
    Groups by page, then applies NMS.
    """
    if not detections:
        return []
    
    # Group detections by page
    by_page = {}
    for det in detections:
        page = det.get('page', 0)
        if page not in by_page:
            by_page[page] = []
        by_page[page].append(det)
    
    # Apply NMS per page
    filtered = []
    for page, page_dets in by_page.items():
        # Sort by confidence
        page_dets = sorted(page_dets, key=lambda x: x.get('confidence', 0), reverse=True)
        
        keep = []
        while page_dets:
            best = page_dets.pop(0)
            keep.append(best)
            
            # Calculate center of best detection
            best_bbox = best['bbox']
            best_cx = best_bbox['x'] + best_bbox['width'] / 2
            best_cy = best_bbox['y'] + best_bbox['height'] / 2
            best_size = max(best_bbox['width'], best_bbox['height'])
            
            # Filter out duplicates
            remaining = []
            for d in page_dets:
                d_bbox = d['bbox']
                d_cx = d_bbox['x'] + d_bbox['width'] / 2
                d_cy = d_bbox['y'] + d_bbox['height'] / 2
                
                # Center distance
                center_dist = ((best_cx - d_cx) ** 2 + (best_cy - d_cy) ** 2) ** 0.5
                
                # If centers are very close, it's a duplicate (regardless of class)
                if center_dist < best_size * 0.5:
                    continue
                
                # IoU check
                iou = calculate_iou(best_bbox, d_bbox)
                if iou >= iou_threshold:
                    continue
                
                remaining.append(d)
            
            page_dets = remaining
        
        filtered.extend(keep)
    
    return filtered

def calculate_iou(box1, box2):
    """Calculate Intersection over Union between two boxes"""
    x1_1, y1_1 = box1['x'], box1['y']
    x2_1, y2_1 = x1_1 + box1['width'], y1_1 + box1['height']
    
    x1_2, y1_2 = box2['x'], box2['y']
    x2_2, y2_2 = x1_2 + box2['width'], y1_2 + box2['height']
    
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

# ============ Detector Loading ============
def load_detector(model_id):
    """Load a detector model, with caching"""
    if model_id in loaded_detectors:
        return loaded_detectors[model_id]
    
    model_path = os.path.join(MODELS_DIR, f'{model_id}.pkl')
    metadata_path = os.path.join(MODELS_DIR, f'{model_id}_metadata.json')
    
    if not os.path.exists(model_path):
        eprint(f"Model not found: {model_path}")
        return None, None
    
    with open(model_path, 'rb') as f:
        detector = pickle.load(f)
    
    metadata = {}
    if os.path.exists(metadata_path):
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)
    
    loaded_detectors[model_id] = (detector, metadata)
    eprint(f"Loaded model: {model_id}")
    return detector, metadata

# ============ Detection with OCR ============
def detect_in_pdf(pdf_path, model_ids, confidence_threshold=0.65, pages=None, 
                  per_class_settings=None, enable_ocr=True, ocr_padding=1.0,
                  per_class_formats=None):
    """
    Run detection on a PDF with OCR.
    Returns list of detections with OCR text and confidence.
    """
    all_detections = []
    shape_types = {}
    model_subclass_regions = {}  # Track subclassRegions per class
    model_training_box_sizes = {}  # Track training box sizes for subclass scaling
    
    # Extract per-subclass formats from perClassSettings
    per_subclass_formats = {}
    if per_class_settings:
        for model_id, settings in per_class_settings.items():
            if settings.get('subclassFormats') and settings.get('className'):
                sub_formats = {}
                for subclass_name, fmt in settings['subclassFormats'].items():
                    if fmt:
                        sub_formats[subclass_name] = fmt
                if sub_formats:
                    per_subclass_formats[settings['className']] = sub_formats
    
    if per_subclass_formats:
        eprint(f"Per-subclass OCR formats: {per_subclass_formats}")
    
    # Load all models
    detectors = []
    for model_id in model_ids:
        detector, metadata = load_detector(model_id)
        if detector:
            detectors.append((model_id, detector, metadata))
            # Collect shape types
            if metadata.get('shapeTypes'):
                shape_types.update(metadata['shapeTypes'])
            # Collect subclassRegions
            if metadata.get('subclassRegions'):
                for class_name, regions in metadata['subclassRegions'].items():
                    if regions:
                        model_subclass_regions[class_name] = regions
                        eprint(f"  Loaded subclassRegions for '{class_name}': {list(regions.keys())}")
            # Collect trainingBoxSizes
            if metadata.get('trainingBoxSizes'):
                for class_name, box_size in metadata['trainingBoxSizes'].items():
                    if box_size:
                        model_training_box_sizes[class_name] = box_size
    
    if not detectors:
        return [], {}
    
    if model_subclass_regions:
        eprint(f"SubclassRegions for: {list(model_subclass_regions.keys())}")
    
    # Convert PDF to images (must match training DPI of 150)
    # Optimize by only converting requested pages when specified
    pages_to_process = []  # List of (page_idx, page_image) tuples
    
    if pages and len(pages) > 0:
        # Only convert specific pages - much faster for single-page detection
        min_page = min(pages)
        max_page = max(pages)
        eprint(f"Converting pages {min_page}-{max_page} (requested: {pages})...")
        
        pdf_pages = convert_from_path(
            pdf_path, 
            dpi=150, 
            poppler_path=POPPLER_PATH,
            first_page=min_page,
            last_page=max_page
        )
        
        # Map converted pages: pdf_pages[0] is min_page, pdf_pages[1] is min_page+1, etc.
        for p in pages:
            if min_page <= p <= max_page:
                pdf_pages_idx = p - min_page
                if pdf_pages_idx < len(pdf_pages):
                    page_idx = p - 1  # 0-indexed page number
                    pages_to_process.append((page_idx, np.array(pdf_pages[pdf_pages_idx])))
        
        total_pages = max_page
    else:
        # Convert all pages
        eprint(f"Converting PDF to images...")
        pdf_pages = convert_from_path(pdf_path, dpi=150, poppler_path=POPPLER_PATH)
        total_pages = len(pdf_pages)
        pages_to_process = [(i, np.array(pdf_pages[i])) for i in range(total_pages)]
    
    eprint(f"Processing {len(pages_to_process)} page(s)...")
    
    # Run detection on each page
    for page_idx, page_img in pages_to_process:
        h, w = page_img.shape[:2]
        
        for model_id, detector, metadata in detectors:
            # Get per-class settings
            model_conf = confidence_threshold
            model_ocr = enable_ocr
            if per_class_settings and model_id in per_class_settings:
                settings = per_class_settings[model_id]
                model_conf = settings.get('confidence', confidence_threshold)
                model_ocr = settings.get('enableOCR', enable_ocr)
            
            # Run template matching
            page_detections = detector.detect(page_img, threshold=model_conf)
            
            for det in page_detections:
                det['page'] = page_idx
                det['model_id'] = model_id
                
                label = det.get('label', '')
                
                # Check if this class has subclass regions defined
                if model_ocr and label in model_subclass_regions and model_subclass_regions[label]:
                    # Use subclass OCR (targeted regions)
                    regions = model_subclass_regions[label]
                    training_box_size = model_training_box_sizes.get(label, None)
                    class_subclass_formats = per_subclass_formats.get(label, {})
                    
                    eprint(f"  Running subclass OCR for '{label}', regions: {list(regions.keys())}")
                    
                    try:
                        result = detector.extract_subclass_values(
                            [det], pdf_path, regions, 
                            training_box_size=training_box_size,
                            per_subclass_formats=class_subclass_formats
                        )
                        if result:
                            det.update(result[0])
                            # Use first subclass value as ocr_text for display
                            if det.get('subclassValues'):
                                # Prefer 'Tag' subclass if available, otherwise use first value
                                if 'Tag' in det['subclassValues']:
                                    det['ocr_text'] = det['subclassValues']['Tag'] or ''
                                else:
                                    first_val = list(det['subclassValues'].values())[0]
                                    det['ocr_text'] = first_val or ''
                                eprint(f"    Subclass values: {det['subclassValues']}")
                            else:
                                det['ocr_text'] = ''
                    except Exception as e:
                        eprint(f"    Subclass OCR error: {e}")
                        det['ocr_text'] = ''
                        det['subclassValues'] = {}
                    
                    det['ocr_confidence'] = 0.8  # Default confidence for subclass OCR
                    
                elif model_ocr:
                    # Standard OCR on whole detection box
                    bbox = det['bbox']
                    
                    # Extract region with padding
                    center_x = bbox['x'] + bbox['width'] / 2
                    center_y = bbox['y'] + bbox['height'] / 2
                    expanded_w = bbox['width'] * ocr_padding
                    expanded_h = bbox['height'] * ocr_padding
                    
                    x1 = int(max(0, (center_x - expanded_w / 2) * w))
                    y1 = int(max(0, (center_y - expanded_h / 2) * h))
                    x2 = int(min(w, (center_x + expanded_w / 2) * w))
                    y2 = int(min(h, (center_y + expanded_h / 2) * h))
                    
                    region = page_img[y1:y2, x1:x2]
                    
                    # Normalize rotation and inversion for OCR
                    rotation = det.get('detected_rotation', 0)
                    inverted = det.get('detected_inverted', False)
                    
                    # Handle horizontal inversion first
                    if inverted:
                        region = cv2.flip(region, 1)  # Horizontal flip
                    
                    # Then handle rotation
                    if rotation != 0:
                        if rotation == 90:
                            region = cv2.rotate(region, cv2.ROTATE_90_COUNTERCLOCKWISE)
                        elif rotation == 180:
                            region = cv2.rotate(region, cv2.ROTATE_180)
                        elif rotation == 270:
                            region = cv2.rotate(region, cv2.ROTATE_90_CLOCKWISE)
                    
                    # Only read left-to-right - template matching has already normalized orientation
                    # Don't try rotations as it can misread (e.g., "LI" becomes "17" when flipped)
                    ocr_text, ocr_conf = run_paddle_ocr(region, return_confidence=True, try_rotations=False)
                    raw_text = ocr_text.replace('\n', ' ').strip()
                    det['ocr_raw'] = raw_text
                    
                    # Apply format correction if per_class_formats provided
                    if per_class_formats and raw_text:
                        # Look up format by model className (derived from model_id)
                        model_class_name = det.get('model_id', '').split('_')[0]  # e.g., "test_20260114_..." -> "test"
                        format_template = per_class_formats.get(model_class_name)
                        # Also try label as fallback
                        if not format_template:
                            format_template = per_class_formats.get(det.get('label', ''))
                        # Check for global format (from Smart Links)
                        if not format_template:
                            format_template = per_class_formats.get('__global__')
                        # If still nothing and only one format, apply to all
                        if not format_template and len(per_class_formats) == 1:
                            format_template = list(per_class_formats.values())[0]
                        if format_template:
                            corrected = fix_ocr_with_format(raw_text, format_template)
                            det['ocr_text'] = corrected
                            if corrected != raw_text:
                                eprint(f"  OCR corrected: '{raw_text}' → '{corrected}'")
                        else:
                            det['ocr_text'] = raw_text
                    else:
                        det['ocr_text'] = raw_text
                    det['ocr_confidence'] = ocr_conf
                else:
                    det['ocr_text'] = ''
                    det['ocr_raw'] = ''
                    det['ocr_confidence'] = 0.0
                
                all_detections.append(det)
    
    # Apply cross-model NMS to remove duplicates across models
    eprint(f"Before cross-model NMS: {len(all_detections)} detections")
    all_detections = cross_model_nms(all_detections, iou_threshold=0.5)
    eprint(f"After cross-model NMS: {len(all_detections)} detections")
    
    return all_detections, shape_types

# ============ Save Objects ============
def save_objects(project_id, objects):
    """Save objects to project file"""
    if not os.path.exists(OBJECTS_DIR):
        os.makedirs(OBJECTS_DIR)
    
    filepath = os.path.join(OBJECTS_DIR, f'{project_id}.json')
    with open(filepath, 'w') as f:
        json.dump(objects, f, indent=2)
    eprint(f"Saved {len(objects)} objects to {filepath}")

def load_objects(project_id):
    """Load existing objects for a project"""
    filepath = os.path.join(OBJECTS_DIR, f'{project_id}.json')
    if os.path.exists(filepath):
        with open(filepath, 'r') as f:
            return json.load(f)
    return []

# ============ API Endpoints ============

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'ocr_available': OCR_AVAILABLE,
        'models_cached': len(loaded_detectors)
    })

@app.route('/warmup', methods=['POST'])
def warmup():
    """Pre-load PaddleOCR"""
    get_paddle_ocr()
    return jsonify({'status': 'ok', 'message': 'PaddleOCR loaded'})

@app.route('/detect', methods=['POST'])
def detect():
    """
    Run detection on a single PDF.
    
    Body:
    {
        "pdfPath": "path/to/file.pdf",
        "modelIds": ["model1", "model2"],
        "confidence": 0.65,
        "pages": [1, 2, 3] or null for all,
        "perClassSettings": {"model1": {"confidence": 0.7, "enableOCR": true}},
        "enableOCR": true,
        "ocrPadding": 1.0,
        "projectId": "project123",  // Optional: if provided, saves incrementally
        "filename": "file.pdf",  // Used for object ID
        "formatTemplate": "FI-12345"  // Optional global format for Smart Links
    }
    """
    data = request.json
    
    pdf_path = data.get('pdfPath')
    model_ids = data.get('modelIds', [])
    confidence = data.get('confidence', 0.65)
    pages = data.get('pages')
    per_class_settings = data.get('perClassSettings')
    enable_ocr = data.get('enableOCR', True)
    ocr_padding = data.get('ocrPadding', 1.0)
    project_id = data.get('projectId')
    filename = data.get('filename', os.path.basename(pdf_path))
    format_template = data.get('formatTemplate')  # Global format for Smart Links
    
    # Extract per-class OCR formats (keyed by className)
    per_class_formats = {}
    if per_class_settings:
        for model_id, settings in per_class_settings.items():
            if settings.get('ocrFormat') and settings.get('className'):
                per_class_formats[settings['className']] = settings['ocrFormat']
    
    # If global format template provided and no per-class formats, apply to all
    if format_template and not per_class_formats:
        # Apply global format as a fallback - it will be applied to all classes
        per_class_formats['__global__'] = format_template
        eprint(f"Using global format template: {format_template}")
    
    if not pdf_path or not os.path.exists(pdf_path):
        return jsonify({'error': f'PDF not found: {pdf_path}'}), 400
    
    if not model_ids:
        return jsonify({'error': 'No models specified'}), 400
    
    try:
        # Run detection
        detections, shape_types = detect_in_pdf(
            pdf_path, model_ids, confidence, pages,
            per_class_settings, enable_ocr, ocr_padding, per_class_formats
        )
        
        # Add IDs and filename to detections
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        for i, det in enumerate(detections):
            det['id'] = f'det_{filename}_{timestamp}_{i}'
            det['filename'] = filename
        
        # If projectId provided, save incrementally
        if project_id:
            existing = load_objects(project_id)
            # Remove old detections for this file
            existing = [o for o in existing if o.get('filename') != filename]
            # Add new detections
            existing.extend(detections)
            save_objects(project_id, existing)
        
        return jsonify({
            'success': True,
            'detections': detections,
            'shapeTypes': shape_types,
            'count': len(detections)
        })
        
    except Exception as e:
        eprint(f"Detection error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/detect-batch', methods=['POST'])
def detect_batch():
    """
    Run detection on multiple PDFs, saving after each one.
    
    Body:
    {
        "files": [{"path": "...", "filename": "..."}],
        "modelIds": ["model1"],
        "confidence": 0.65,
        "perClassSettings": {...},
        "enableOCR": true,
        "ocrPadding": 1.0,
        "projectId": "project123",
        "formatTemplate": "FI-12345"  // Optional global format
    }
    """
    data = request.json
    
    files = data.get('files', [])
    model_ids = data.get('modelIds', [])
    confidence = data.get('confidence', 0.65)
    per_class_settings = data.get('perClassSettings')
    enable_ocr = data.get('enableOCR', True)
    ocr_padding = data.get('ocrPadding', 1.0)
    project_id = data.get('projectId')
    format_template = data.get('formatTemplate')  # Global format for Smart Links
    
    # Extract per-class OCR formats (keyed by className)
    per_class_formats = {}
    if per_class_settings:
        for model_id, settings in per_class_settings.items():
            if settings.get('ocrFormat') and settings.get('className'):
                per_class_formats[settings['className']] = settings['ocrFormat']
    
    # If global format template provided and no per-class formats, apply to all
    if format_template and not per_class_formats:
        per_class_formats['__global__'] = format_template
        eprint(f"Using global format template: {format_template}")
    
    if not files:
        return jsonify({'error': 'No files specified'}), 400
    
    if not model_ids:
        return jsonify({'error': 'No models specified'}), 400
    
    results = []
    total_detections = 0
    all_shape_types = {}
    
    for file_info in files:
        pdf_path = file_info.get('path')
        filename = file_info.get('filename', os.path.basename(pdf_path))
        
        if not pdf_path or not os.path.exists(pdf_path):
            eprint(f"Skipping missing file: {pdf_path}")
            continue
        
        eprint(f"Processing: {filename}")
        
        try:
            detections, shape_types = detect_in_pdf(
                pdf_path, model_ids, confidence, None,
                per_class_settings, enable_ocr, ocr_padding, per_class_formats
            )
            
            # Add IDs and filename
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            for i, det in enumerate(detections):
                det['id'] = f'det_{filename}_{timestamp}_{i}'
                det['filename'] = filename
            
            all_shape_types.update(shape_types)
            total_detections += len(detections)
            
            # Save incrementally after each file
            if project_id:
                existing = load_objects(project_id)
                # Remove old detections for this file
                existing = [o for o in existing if o.get('filename') != filename]
                # Add new detections
                existing.extend(detections)
                save_objects(project_id, existing)
            
            results.append({
                'filename': filename,
                'count': len(detections),
                'success': True
            })
            
        except Exception as e:
            eprint(f"Error processing {filename}: {e}")
            results.append({
                'filename': filename,
                'error': str(e),
                'success': False
            })
    
    return jsonify({
        'success': True,
        'results': results,
        'totalDetections': total_detections,
        'shapeTypes': all_shape_types
    })

@app.route('/clear-cache', methods=['POST'])
def clear_cache():
    """Clear cached detector models"""
    global loaded_detectors
    loaded_detectors = {}
    return jsonify({'status': 'ok', 'message': 'Cache cleared'})

# ============ Example Management Endpoints ============

@app.route('/models/<model_id>/examples', methods=['GET'])
def get_model_examples(model_id):
    """
    Get training examples for a model.
    Returns list of examples with bbox info for thumbnail generation.
    """
    metadata_path = os.path.join(MODELS_DIR, f'{model_id}_metadata.json')
    
    if not os.path.exists(metadata_path):
        return jsonify({'error': 'Model not found'}), 404
    
    with open(metadata_path, 'r') as f:
        metadata = json.load(f)
    
    examples = metadata.get('trainingExamples', [])
    
    # Add model info to response
    return jsonify({
        'success': True,
        'modelId': model_id,
        'className': metadata.get('className', ''),
        'pdfFilename': metadata.get('pdfFilename', ''),
        'examples': examples,
        'count': len(examples)
    })

@app.route('/models/<model_id>/examples/<example_id>', methods=['DELETE'])
def remove_example(model_id, example_id):
    """
    Remove an example from a model and retrain.
    """
    import subprocess
    
    metadata_path = os.path.join(MODELS_DIR, f'{model_id}_metadata.json')
    model_path = os.path.join(MODELS_DIR, f'{model_id}.pkl')
    
    if not os.path.exists(metadata_path):
        return jsonify({'error': 'Model not found'}), 404
    
    with open(metadata_path, 'r') as f:
        metadata = json.load(f)
    
    examples = metadata.get('trainingExamples', [])
    
    # Find and remove the example
    original_count = len(examples)
    examples = [ex for ex in examples if ex.get('id') != example_id]
    
    if len(examples) == original_count:
        return jsonify({'error': 'Example not found'}), 404
    
    # If no examples left, delete the model entirely
    if len(examples) == 0:
        if os.path.exists(model_path):
            os.remove(model_path)
        if os.path.exists(metadata_path):
            os.remove(metadata_path)
        
        # Clear from cache
        if model_id in loaded_detectors:
            del loaded_detectors[model_id]
        
        return jsonify({
            'success': True,
            'message': 'Model deleted (no examples remaining)',
            'modelDeleted': True,
            'remainingExamples': 0
        })
    
    # Get PDF path for retraining
    pdf_path = metadata.get('pdfPath')
    if not pdf_path or not os.path.exists(pdf_path):
        # Try to find PDF in uploads folder
        pdf_filename = metadata.get('pdfFilename')
        if pdf_filename:
            pdf_path = os.path.join('..', 'uploads', pdf_filename)
        if not pdf_path or not os.path.exists(pdf_path):
            return jsonify({'error': f'PDF not found for retraining: {pdf_filename}'}), 400
    
    # Build boxes from remaining examples
    boxes = []
    for ex in examples:
        box = {
            'x': ex['bbox']['x'],
            'y': ex['bbox']['y'],
            'width': ex['bbox']['width'],
            'height': ex['bbox']['height'],
            'page': ex.get('page', 0),
            'className': ex.get('className', metadata.get('className', '')),
            'label': ex.get('className', metadata.get('className', '')),
            'shapeType': ex.get('shapeType', 'rectangle'),
            'subclassRegions': ex.get('subclassRegions')
        }
        boxes.append(box)
    
    # Delete old model files
    if os.path.exists(model_path):
        os.remove(model_path)
    
    # Clear from cache
    if model_id in loaded_detectors:
        del loaded_detectors[model_id]
    
    # Retrain using train_detector.py
    try:
        multi_orientation = metadata.get('multiOrientation', False)
        include_inverted = metadata.get('includeInverted', False)
        model_type = metadata.get('modelType', 'object')
        
        # We need to create a new model with the same ID
        # For simplicity, we'll directly retrain here
        from detector import TemplateDetector
        
        training_data = {
            'pdf': pdf_path,
            'annotations': [{
                'page': box.get('page', 0),
                'bbox': {
                    'x': box['x'],
                    'y': box['y'],
                    'width': box['width'],
                    'height': box['height'],
                    'label': box.get('className', box.get('label', ''))
                }
            } for box in boxes]
        }
        
        temp_file = f'temp_retrain_{model_id}.json'
        with open(temp_file, 'w') as f:
            json.dump(training_data, f)
        
        detector = TemplateDetector()
        detector.load_training_data(temp_file, pdf_path, 
                                   multi_orientation=multi_orientation, 
                                   include_inverted=include_inverted)
        
        # Save retrained model with SAME model_id
        with open(model_path, 'wb') as f:
            pickle.dump(detector, f)
        
        os.remove(temp_file)
        
        # Update metadata
        metadata['trainingExamples'] = examples
        metadata['numExamples'] = len(examples)
        metadata['numTemplates'] = sum(len(v) for v in detector.templates.values())
        metadata['lastUpdated'] = datetime.now().isoformat()
        
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)
        
        eprint(f"Retrained model {model_id}: {len(examples)} examples, {metadata['numTemplates']} templates")
        
        return jsonify({
            'success': True,
            'message': f'Example removed and model retrained',
            'modelDeleted': False,
            'remainingExamples': len(examples),
            'numTemplates': metadata['numTemplates']
        })
        
    except Exception as e:
        eprint(f"Retrain error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Retrain failed: {str(e)}'}), 500

# ============ Model Export/Import Endpoints ============

@app.route('/models/export', methods=['GET'])
def export_models():
    """
    Export all models as a downloadable zip file.
    Includes .pkl files and metadata.
    """
    import zipfile
    from io import BytesIO
    from flask import send_file
    
    if not os.path.exists(MODELS_DIR):
        return jsonify({'error': 'Models directory not found'}), 404
    
    # Find all model files
    model_files = []
    for filename in os.listdir(MODELS_DIR):
        if filename.endswith('.pkl') or filename.endswith('_metadata.json'):
            model_files.append(filename)
    
    if not model_files:
        return jsonify({'error': 'No models to export'}), 404
    
    # Create zip in memory
    zip_buffer = BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for filename in model_files:
            filepath = os.path.join(MODELS_DIR, filename)
            zf.write(filepath, filename)
        
        # Add export metadata
        export_info = {
            'exportDate': datetime.now().isoformat(),
            'modelCount': len([f for f in model_files if f.endswith('.pkl')]),
            'files': model_files
        }
        zf.writestr('export_info.json', json.dumps(export_info, indent=2))
    
    zip_buffer.seek(0)
    
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f'models_export_{timestamp}.zip'
    
    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name=filename
    )

@app.route('/models/export/<model_id>', methods=['GET'])
def export_single_model(model_id):
    """
    Export a single model as a downloadable zip file.
    """
    import zipfile
    from io import BytesIO
    from flask import send_file
    
    pkl_path = os.path.join(MODELS_DIR, f'{model_id}.pkl')
    metadata_path = os.path.join(MODELS_DIR, f'{model_id}_metadata.json')
    
    if not os.path.exists(pkl_path):
        return jsonify({'error': 'Model not found'}), 404
    
    # Create zip in memory
    zip_buffer = BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.write(pkl_path, f'{model_id}.pkl')
        if os.path.exists(metadata_path):
            zf.write(metadata_path, f'{model_id}_metadata.json')
    
    zip_buffer.seek(0)
    
    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name=f'{model_id}.zip'
    )

@app.route('/models/import', methods=['POST'])
def import_models():
    """
    Import models from an uploaded zip file.
    """
    import zipfile
    from io import BytesIO
    
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    if not file.filename.endswith('.zip'):
        return jsonify({'error': 'File must be a .zip'}), 400
    
    # Read zip into memory
    zip_buffer = BytesIO(file.read())
    
    try:
        imported_models = []
        skipped_models = []
        
        with zipfile.ZipFile(zip_buffer, 'r') as zf:
            # Get list of files in zip
            filenames = zf.namelist()
            
            # Find all .pkl files (these are the models)
            pkl_files = [f for f in filenames if f.endswith('.pkl')]
            
            for pkl_file in pkl_files:
                model_id = pkl_file.replace('.pkl', '')
                metadata_file = f'{model_id}_metadata.json'
                
                pkl_dest = os.path.join(MODELS_DIR, pkl_file)
                metadata_dest = os.path.join(MODELS_DIR, metadata_file)
                
                # Check if model already exists
                if os.path.exists(pkl_dest):
                    skipped_models.append(model_id)
                    continue
                
                # Extract .pkl file
                with zf.open(pkl_file) as src, open(pkl_dest, 'wb') as dst:
                    dst.write(src.read())
                
                # Extract metadata if exists
                if metadata_file in filenames:
                    with zf.open(metadata_file) as src, open(metadata_dest, 'wb') as dst:
                        dst.write(src.read())
                
                imported_models.append(model_id)
                eprint(f"Imported model: {model_id}")
        
        # Clear cache so new models are loaded fresh
        global loaded_detectors
        loaded_detectors = {}
        
        return jsonify({
            'success': True,
            'imported': imported_models,
            'skipped': skipped_models,
            'message': f'Imported {len(imported_models)} model(s), skipped {len(skipped_models)} existing'
        })
        
    except zipfile.BadZipFile:
        return jsonify({'error': 'Invalid zip file'}), 400
    except Exception as e:
        eprint(f"Import error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/models/import-overwrite', methods=['POST'])
def import_models_overwrite():
    """
    Import models from an uploaded zip file, overwriting existing models.
    """
    import zipfile
    from io import BytesIO
    
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    if not file.filename.endswith('.zip'):
        return jsonify({'error': 'File must be a .zip'}), 400
    
    zip_buffer = BytesIO(file.read())
    
    try:
        imported_models = []
        overwritten_models = []
        
        with zipfile.ZipFile(zip_buffer, 'r') as zf:
            filenames = zf.namelist()
            pkl_files = [f for f in filenames if f.endswith('.pkl')]
            
            for pkl_file in pkl_files:
                model_id = pkl_file.replace('.pkl', '')
                metadata_file = f'{model_id}_metadata.json'
                
                pkl_dest = os.path.join(MODELS_DIR, pkl_file)
                metadata_dest = os.path.join(MODELS_DIR, metadata_file)
                
                was_existing = os.path.exists(pkl_dest)
                
                # Extract .pkl file (overwrite if exists)
                with zf.open(pkl_file) as src, open(pkl_dest, 'wb') as dst:
                    dst.write(src.read())
                
                # Extract metadata if exists
                if metadata_file in filenames:
                    with zf.open(metadata_file) as src, open(metadata_dest, 'wb') as dst:
                        dst.write(src.read())
                
                if was_existing:
                    overwritten_models.append(model_id)
                else:
                    imported_models.append(model_id)
                    
                eprint(f"Imported model: {model_id} {'(overwritten)' if was_existing else ''}")
        
        # Clear cache
        global loaded_detectors
        loaded_detectors = {}
        
        return jsonify({
            'success': True,
            'imported': imported_models,
            'overwritten': overwritten_models,
            'message': f'Imported {len(imported_models)} new, overwritten {len(overwritten_models)} existing'
        })
        
    except zipfile.BadZipFile:
        return jsonify({'error': 'Invalid zip file'}), 400
    except Exception as e:
        eprint(f"Import error: {e}")
        return jsonify({'error': str(e)}), 500

# ============ Main ============
if __name__ == '__main__':
    # Pre-load PaddleOCR on startup
    eprint("Starting Detector Server...")
    get_paddle_ocr()
    
    # Run Flask server
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
