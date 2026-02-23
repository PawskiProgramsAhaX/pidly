#!/usr/bin/env python3
"""
Run trained detector on a PDF and return detections with OCR
NOW WITH MULTI-PASS OCR AND FORMAT TEMPLATE MATCHING
"""

import argparse
import json
import pickle
import sys
import os

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from detector import TemplateDetector

def main():
    parser = argparse.ArgumentParser(description='Run detector on PDF')
    parser.add_argument('--pdf', required=True, help='Path to PDF file')
    parser.add_argument('--confidence', type=float, default=0.7, help='Detection confidence threshold')
    parser.add_argument('--model-ids', required=True, help='JSON array of model IDs to use')
    parser.add_argument('--ocr', action='store_true', help='Enable OCR')
    parser.add_argument('--padding', type=float, default=1.15, help='OCR bounding box padding')
    parser.add_argument('--class-patterns', help='JSON object of class-specific regex patterns')
    # Global format template (for Smart Links - applies to all classes)
    parser.add_argument('--format-template', help='Global OCR format template (e.g., FI-12345)')
    # Per-class settings (confidence, OCR per model)
    parser.add_argument('--per-class-settings', help='JSON object of per-class settings')
    parser.add_argument('--per-class-ocr', help='JSON object of per-class OCR enable/disable')
    parser.add_argument('--per-class-format', help='JSON object of per-class OCR format templates')
    parser.add_argument('--per-subclass-format', help='JSON object of per-subclass OCR format templates')
    # Page-specific detection
    parser.add_argument('--pages', help='JSON array of page numbers (1-indexed) to process, or omit for all pages')
    
    args = parser.parse_args()
    
    # Parse model IDs
    model_ids = json.loads(args.model_ids)
    
    # Load and combine models
    detector = TemplateDetector()
    model_shape_types = {}  # Track shapeType per class
    model_subclass_regions = {}  # Track subclassRegions per class
    model_training_box_sizes = {}  # Track training box sizes for subclass scaling
    class_to_model = {}  # Track which model each class came from (for format lookup)
    
    for model_id in model_ids:
        pkl_path = os.path.join('models', f'{model_id}.pkl')
        metadata_path = os.path.join('models', f'{model_id}_metadata.json')
        
        if not os.path.exists(pkl_path):
            print(json.dumps({'error': f'Model not found: {model_id}'}))
            sys.exit(1)
        
        # Load metadata to get shapeTypes and subclassRegions
        if os.path.exists(metadata_path):
            with open(metadata_path, 'r') as f:
                metadata = json.load(f)
                # Use shapeTypes map if available (new format), fallback to shapeType (old format)
                if 'shapeTypes' in metadata:
                    for class_name, shape_type in metadata['shapeTypes'].items():
                        model_shape_types[class_name] = shape_type
                elif 'shapeType' in metadata:
                    # Old format - apply to all classes in this model
                    shape_type = metadata.get('shapeType', 'rectangle')
                    class_name = metadata.get('originalClassName') or metadata.get('className', model_id.split('_')[0])
                    model_shape_types[class_name] = shape_type
                
                # Load subclassRegions if available
                if 'subclassRegions' in metadata and metadata['subclassRegions']:
                    for class_name, regions in metadata['subclassRegions'].items():
                        if regions:
                            model_subclass_regions[class_name] = regions
                
                # Load trainingBoxSizes if available (for proper subclass region scaling)
                if 'trainingBoxSizes' in metadata and metadata['trainingBoxSizes']:
                    for class_name, box_size in metadata['trainingBoxSizes'].items():
                        if box_size:
                            model_training_box_sizes[class_name] = box_size
        
        # Load model
        with open(pkl_path, 'rb') as f:
            loaded_model = pickle.load(f)
        
        # Check if it's a TemplateDetector object or just templates dict
        if isinstance(loaded_model, TemplateDetector):
            # It's a full detector object - extract templates
            model_templates = loaded_model.templates
        else:
            # It's just a templates dict
            model_templates = loaded_model
        
        # Merge templates and track which model each class belongs to
        for label, templates in model_templates.items():
            if label not in detector.templates:
                detector.templates[label] = []
            detector.templates[label].extend(templates)
            # Track model association for this class label
            if label not in class_to_model:
                class_to_model[label] = model_id
    
    print(f"Loaded {len(detector.templates)} classes from {len(model_ids)} model(s)", file=sys.stderr)
    print(f"ShapeTypes: {model_shape_types}", file=sys.stderr)
    if model_subclass_regions:
        print(f"SubclassRegions for: {list(model_subclass_regions.keys())}", file=sys.stderr)
    
    # Parse per-class settings if provided
    per_class_settings = {}
    if args.per_class_settings:
        per_class_settings = json.loads(args.per_class_settings)
        print(f"Using per-class settings for {len(per_class_settings)} model(s)", file=sys.stderr)
    
    # Parse per-class OCR settings if provided
    per_class_ocr = {}
    if args.per_class_ocr:
        per_class_ocr = dict(json.loads(args.per_class_ocr))
        print(f"Per-class OCR settings: {per_class_ocr}", file=sys.stderr)
    
    # Determine detection threshold - use minimum from per-class settings or default
    min_confidence = args.confidence
    for model_key, settings in per_class_settings.items():
        class_conf = settings.get('confidence', args.confidence)
        if class_conf < min_confidence:
            min_confidence = class_conf
    
    # Parse pages parameter if provided
    pages_to_detect = None
    if args.pages:
        pages_to_detect = json.loads(args.pages)
        print(f"Detecting on specific pages: {pages_to_detect}", file=sys.stderr)
    
    # Run detection with calculated threshold
    detections = detector.detect_in_pdf(args.pdf, threshold=min_confidence, pages=pages_to_detect)
    
    # Filter detections by per-class confidence (only if per-class settings differ)
    if per_class_settings:
        filtered_detections = []
        for det in detections:
            label = det.get('label', '')
            # Find matching per-class setting (check if label matches any key)
            class_conf = args.confidence  # Default
            for model_key, settings in per_class_settings.items():
                # Model key might be like "ClassName_timestamp" - check if label is in it
                if label in model_key or model_key.startswith(label):
                    class_conf = settings.get('confidence', args.confidence)
                    break
            
            if det.get('confidence', 0) >= class_conf:
                filtered_detections.append(det)
        
        print(f"Filtered to {len(filtered_detections)} detections (from {len(detections)})", file=sys.stderr)
        detections = filtered_detections
    
    # Add OCR if requested
    if args.ocr:
        # Parse class patterns if provided
        class_patterns = None
        if args.class_patterns:
            class_patterns = json.loads(args.class_patterns)
        
        # Parse per-class format templates (keyed by model className)
        per_class_formats_by_model = {}
        if args.per_class_format:
            per_class_formats_by_model = json.loads(args.per_class_format)
            print(f"Per-class OCR formats: {per_class_formats_by_model}", file=sys.stderr)
        
        # Parse per-subclass format templates (keyed by className -> subclassName -> format)
        per_subclass_formats = {}
        if args.per_subclass_format:
            per_subclass_formats = json.loads(args.per_subclass_format)
            print(f"Per-subclass OCR formats: {per_subclass_formats}", file=sys.stderr)
        
        # Handle global format template (for Smart Links - applies to all classes)
        global_format = args.format_template
        if global_format:
            print(f"Global OCR format: {global_format}", file=sys.stderr)
        
        # Convert from model-based formats to label-based formats
        # e.g., {"test": "PDAHH"} -> {"Instrument": "PDAHH", "IO": "PDAHH"}
        per_class_formats = {}
        for label, model_id in class_to_model.items():
            # Get model className from the model_id
            model_class_name = model_id.split('_')[0]  # e.g., "test_20260114_..." -> "test"
            if model_class_name in per_class_formats_by_model:
                per_class_formats[label] = per_class_formats_by_model[model_class_name]
            elif global_format:
                # Apply global format to all classes that don't have a per-class format
                per_class_formats[label] = global_format
        
        if per_class_formats:
            print(f"Label-based OCR formats: {per_class_formats}", file=sys.stderr)
        
        # Build OCR options
        ocr_options = {
            'expand_box': args.padding,
            'class_patterns': class_patterns,
            'per_class_formats': per_class_formats,
        }
        
        # per_subclass_formats is passed separately to extract_subclass_values()
        
        # If per-class OCR is set, only OCR detections where OCR is enabled for that class
        if per_class_ocr:
            ocr_detections = []
            no_ocr_detections = []
            
            for det in detections:
                label = det.get('label', '')
                # Check if this detection's class has OCR enabled
                ocr_enabled = True  # default
                for model_key, enabled in per_class_ocr.items():
                    # Get className from per_class_settings if available
                    class_name = per_class_settings.get(model_key, {}).get('className', '')
                    if label == class_name or label in model_key or model_key.startswith(label + '_'):
                        ocr_enabled = enabled
                        break
                
                if ocr_enabled:
                    ocr_detections.append(det)
                else:
                    no_ocr_detections.append(det)
            
            print(f"OCR enabled for {len(ocr_detections)} detections, disabled for {len(no_ocr_detections)}", file=sys.stderr)
            
            # Run OCR only on enabled detections
            if ocr_detections:
                # Split into subclass OCR and standard OCR
                subclass_ocr_dets = []
                standard_ocr_dets = []
                
                for det in ocr_detections:
                    label = det.get('label', '')
                    if label in model_subclass_regions and model_subclass_regions[label]:
                        subclass_ocr_dets.append(det)
                    else:
                        standard_ocr_dets.append(det)
                
                # Run subclass OCR (targeted regions)
                if subclass_ocr_dets:
                    print(f"Running subclass OCR on {len(subclass_ocr_dets)} detections", file=sys.stderr)
                    # Get subclass formats for these detections
                    subclass_formats_for_class = per_subclass_formats if per_subclass_formats else {}
                    for det in subclass_ocr_dets:
                        label = det.get('label', '')
                        regions = model_subclass_regions.get(label, {})
                        training_box_size = model_training_box_sizes.get(label, None)
                        # Get subclass-specific formats for this class
                        class_subclass_formats = subclass_formats_for_class.get(label, {})
                        print(f"  Detection label='{label}', regions available: {list(regions.keys()) if regions else 'None'}", file=sys.stderr)
                        if class_subclass_formats:
                            print(f"  Subclass formats: {class_subclass_formats}", file=sys.stderr)
                        if training_box_size:
                            print(f"  Training box size: {training_box_size}", file=sys.stderr)
                        result = detector.extract_subclass_values([det], args.pdf, regions, training_box_size=training_box_size, per_subclass_formats=class_subclass_formats)
                        if result:
                            det.update(result[0])
                            # Use first subclass value as ocr_text
                            if det.get('subclassValues'):
                                first_val = list(det['subclassValues'].values())[0]
                                det['ocr_text'] = first_val or ''
                
                # Run standard OCR
                if standard_ocr_dets:
                    standard_ocr_dets = detector.extract_text_from_detections(
                        args.pdf,
                        standard_ocr_dets,
                        **ocr_options
                    )
                
                ocr_detections = subclass_ocr_dets + standard_ocr_dets
            
            # Combine results
            detections = ocr_detections + no_ocr_detections
        else:
            # Split into subclass OCR and standard OCR
            subclass_ocr_dets = []
            standard_ocr_dets = []
            
            for det in detections:
                label = det.get('label', '')
                if label in model_subclass_regions and model_subclass_regions[label]:
                    subclass_ocr_dets.append(det)
                else:
                    standard_ocr_dets.append(det)
            
            # Run subclass OCR (targeted regions)
            if subclass_ocr_dets:
                print(f"Running subclass OCR on {len(subclass_ocr_dets)} detections", file=sys.stderr)
                # Get subclass formats for these detections
                subclass_formats_for_class = per_subclass_formats if per_subclass_formats else {}
                for det in subclass_ocr_dets:
                    label = det.get('label', '')
                    regions = model_subclass_regions.get(label, {})
                    training_box_size = model_training_box_sizes.get(label, None)
                    # Get subclass-specific formats for this class
                    class_subclass_formats = subclass_formats_for_class.get(label, {})
                    print(f"  Detection label='{label}', regions available: {list(regions.keys()) if regions else 'None'}", file=sys.stderr)
                    if class_subclass_formats:
                        print(f"  Subclass formats: {class_subclass_formats}", file=sys.stderr)
                    if training_box_size:
                        print(f"  Training box size: {training_box_size}", file=sys.stderr)
                    result = detector.extract_subclass_values([det], args.pdf, regions, training_box_size=training_box_size, per_subclass_formats=class_subclass_formats)
                    if result:
                        det.update(result[0])
                        # Use first subclass value as ocr_text
                        if det.get('subclassValues'):
                            first_val = list(det['subclassValues'].values())[0]
                            det['ocr_text'] = first_val or ''
            
            # Run standard OCR
            if standard_ocr_dets:
                standard_ocr_dets = detector.extract_text_from_detections(
                    args.pdf,
                    standard_ocr_dets,
                    **ocr_options
                )
            
            detections = subclass_ocr_dets + standard_ocr_dets
    
    # Convert detections to frontend format with color coding
    result_detections = []
    for det in detections:
        # Determine OCR confidence level
        ocr_confidence = det.get('ocr_confidence', 'low')
        format_score = det.get('format_score', 0)
        
        # Determine box color based on confidence
        if det.get('text_touching_border', False):
            box_color = 'red'
            color_reason = 'text_touching'
        elif ocr_confidence == 'high' or format_score >= 90:
            box_color = 'green'
            color_reason = 'high_confidence'
        elif ocr_confidence == 'medium' or format_score >= 70:
            box_color = 'yellow'
            color_reason = 'medium_confidence'
        else:
            box_color = 'orange'
            color_reason = 'low_confidence'
        
        result_det = {
            'bbox': det['bbox'],
            'label': det.get('label', 'instrument'),
            'confidence': det.get('confidence', 0),
            'page': det.get('page', 0),
            'ocr_text': det.get('ocr_text', ''),
            'ocr_raw': det.get('ocr_raw', ''),
            'ocr_confidence': ocr_confidence,  # NEW: high/medium/low
            'format_score': format_score,  # NEW: 0-100
            'box_color': box_color,
            'text_touching_border': det.get('text_touching_border', False),
            'touch_confidence': det.get('touch_confidence', 0.0),
            'shapeType': model_shape_types.get(det.get('label', ''), 'rectangle'),  # Shape type from model
            'subclassValues': det.get('subclassValues', {}),  # Subclass OCR values
            'detected_rotation': det.get('detected_rotation', 0),  # Rotation at which object was detected
            'detected_inverted': det.get('detected_inverted', False)  # Whether detected from inverted template
        }
        
        result_detections.append(result_det)
    
    # Count rotated and inverted detections for stats
    rotated_counts = {}
    inverted_count = 0
    for d in result_detections:
        rot = d.get('detected_rotation', 0)
        rotated_counts[rot] = rotated_counts.get(rot, 0) + 1
        if d.get('detected_inverted', False):
            inverted_count += 1
    
    # Output JSON result
    result = {
        'success': True,
        'detections': result_detections,
        'stats': {
            'total': len(result_detections),
            'with_ocr': sum(1 for d in result_detections if d['ocr_text']),
            'high_confidence': sum(1 for d in result_detections if d['ocr_confidence'] == 'high'),
            'medium_confidence': sum(1 for d in result_detections if d['ocr_confidence'] == 'medium'),
            'low_confidence': sum(1 for d in result_detections if d['ocr_confidence'] == 'low'),
            'touching_border': sum(1 for d in result_detections if d['text_touching_border']),
            'by_rotation': rotated_counts,  # Count by detected rotation
            'inverted': inverted_count  # Count of detections from inverted templates
        }
    }
    
    print(json.dumps(result))

if __name__ == '__main__':
    main()
