#!/usr/bin/env python3
"""
Train Detector Script
Called by backend to train the AI model
Saves model with unique ID and metadata
"""
import argparse
import json
import pickle
import sys
import os
from datetime import datetime

# Redirect print statements to stderr so only JSON goes to stdout
def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pdf', required=True, help='Path to PDF file')
    parser.add_argument('--boxes', required=True, help='JSON string of training boxes')
    parser.add_argument('--multi-orientation', action='store_true', help='Enable multi-orientation')
    parser.add_argument('--include-inverted', action='store_true', help='Include horizontally flipped templates')
    parser.add_argument('--mode', default='separate', choices=['separate', 'combined'], 
                        help='Training mode: separate (one model per class) or combined (multi-class model)')
    parser.add_argument('--model-type', type=str, default='object', help='Type of model: Smart Link or object')
    parser.add_argument('--add-to-model', type=str, default=None, help='Model ID to add templates to (for incremental training)')
    
    args = parser.parse_args()
    
    try:
        boxes = json.loads(args.boxes)
        
        # Debug: Log subclassRegions info
        boxes_with_regions = [b for b in boxes if b.get('subclassRegions')]
        eprint(f"Received {len(boxes)} boxes, {len(boxes_with_regions)} have subclassRegions")
        for i, box in enumerate(boxes):
            if box.get('subclassRegions'):
                eprint(f"  Box {i} ({box.get('className')}): regions = {list(box['subclassRegions'].keys())}")
        
        # Group boxes by class name
        boxes_by_class = {}
        for box in boxes:
            class_name = box.get('className') or box.get('label')
            if class_name not in boxes_by_class:
                boxes_by_class[class_name] = []
            boxes_by_class[class_name].append(box)
        
        # Helper function to get box coordinates (handles nested bbox or flat)
        def get_box_coords(box):
            if 'bbox' in box and isinstance(box['bbox'], dict):
                return box['bbox']
            return {
                'x': box.get('x'),
                'y': box.get('y'),
                'width': box.get('width'),
                'height': box.get('height')
            }
        
        # Create models directory if it doesn't exist
        models_dir = 'models'
        if not os.path.exists(models_dir):
            os.makedirs(models_dir)
        
        created_models = []
        model_type = getattr(args, 'model_type', 'object')
        
        # Handle adding templates to existing model
        if args.add_to_model:
            eprint(f"Adding templates to existing model: {args.add_to_model}")
            
            model_id = args.add_to_model
            model_path = os.path.join(models_dir, f'{model_id}.pkl')
            metadata_path = os.path.join(models_dir, f'{model_id}_metadata.json')
            
            if not os.path.exists(model_path) or not os.path.exists(metadata_path):
                raise Exception(f"Model not found: {model_id}")
            
            # Load existing model
            with open(model_path, 'rb') as f:
                existing_detector = pickle.load(f)
            
            with open(metadata_path, 'r') as f:
                existing_metadata = json.load(f)
            
            eprint(f"Existing model has {existing_metadata.get('numTemplates', 0)} templates")
            
            # Create training data for new templates
            training_data = {
                'pdf': args.pdf,
                'annotations': [{
                    'page': box.get('page', 0),
                    'bbox': {
                        'x': get_box_coords(box)['x'],
                        'y': get_box_coords(box)['y'],
                        'width': get_box_coords(box)['width'],
                        'height': get_box_coords(box)['height'],
                        'label': box.get('originalClassName') or box.get('parentClass') or box.get('label') or box.get('className')
                    }
                } for box in boxes]
            }
            
            temp_file = 'temp_training_add.json'
            with open(temp_file, 'w') as f:
                json.dump(training_data, f)
            
            # Calculate which pages have training examples
            pages_with_boxes = list(set(box.get('page', 0) for box in boxes))
            eprint(f"Training on pages: {pages_with_boxes}")
            
            # Create new detector and train with new templates
            from detector import TemplateDetector
            new_detector = TemplateDetector()
            new_detector.load_training_data(temp_file, args.pdf, 
                                           multi_orientation=args.multi_orientation, 
                                           include_inverted=args.include_inverted,
                                           pages=pages_with_boxes)
            
            os.remove(temp_file)
            
            # Merge templates: add new templates to existing detector
            new_template_count = 0
            for label, templates in new_detector.templates.items():
                if label not in existing_detector.templates:
                    existing_detector.templates[label] = []
                existing_detector.templates[label].extend(templates)
                new_template_count += len(templates)
                eprint(f"  Added {len(templates)} templates for class '{label}'")
            
            # Save updated model
            with open(model_path, 'wb') as f:
                pickle.dump(existing_detector, f)
            
            # Update metadata
            total_templates = sum(len(v) for v in existing_detector.templates.values())
            existing_metadata['numTemplates'] = total_templates
            existing_metadata['numExamples'] = existing_metadata.get('numExamples', 0) + len(boxes)
            existing_metadata['lastUpdated'] = datetime.now().isoformat()
            
            # Add new training examples to metadata
            if 'trainingExamples' not in existing_metadata:
                existing_metadata['trainingExamples'] = []
            
            # Get next example ID
            existing_ids = [ex.get('id', '') for ex in existing_metadata['trainingExamples']]
            next_idx = len(existing_metadata['trainingExamples'])
            
            for idx, box in enumerate(boxes):
                class_name = box.get('originalClassName') or box.get('parentClass') or box.get('label') or box.get('className')
                existing_metadata['trainingExamples'].append({
                    'id': f'ex_{next_idx + idx}',
                    'bbox': get_box_coords(box),
                    'page': box.get('page', 0),
                    'className': class_name,
                    'shapeType': box.get('shapeType', 'rectangle'),
                    'subclassRegions': box.get('subclassRegions'),
                    'addedAt': datetime.now().isoformat()
                })
            
            # Update subclassRegions if new boxes have them
            for box in boxes:
                class_name = box.get('originalClassName') or box.get('parentClass') or box.get('label') or box.get('className')
                if class_name and box.get('subclassRegions'):
                    if 'subclassRegions' not in existing_metadata:
                        existing_metadata['subclassRegions'] = {}
                    if class_name not in existing_metadata['subclassRegions']:
                        existing_metadata['subclassRegions'][class_name] = box.get('subclassRegions')
                        existing_metadata.setdefault('trainingBoxSizes', {})[class_name] = {
                            'width': box.get('width', 0),
                            'height': box.get('height', 0)
                        }
                        eprint(f"  Added subclass regions for '{class_name}'")
            
            with open(metadata_path, 'w') as f:
                json.dump(existing_metadata, f, indent=2)
            
            eprint(f"Updated model now has {total_templates} templates (+{new_template_count} new)")
            
            result = {
                'success': True,
                'models': [{
                    'modelId': model_id,
                    'className': existing_metadata.get('className', ''),
                    'numTemplates': total_templates,
                    'numExamples': existing_metadata.get('numExamples', 0),
                    'addedTemplates': new_template_count,
                    'isMultiClass': existing_metadata.get('isMultiClass', False),
                    'modelType': existing_metadata.get('modelType', 'object')
                }],
                'totalModels': 1,
                'message': f"Added {new_template_count} templates to {existing_metadata.get('className', model_id)}",
                'mode': 'add-to-existing',
                'modelType': existing_metadata.get('modelType', 'object')
            }
            
            print(json.dumps(result), flush=True)
            sys.exit(0)
        
        if args.mode == 'combined':
            # COMBINED MODE: Create ONE multi-class model
            all_classes = list(boxes_by_class.keys())
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
            model_id = f"{'_'.join(sorted(all_classes))}_{timestamp}"
            
            # Create training JSON with ALL classes - use originalClassName for label
            training_data = {
                'pdf': args.pdf,
                'annotations': [{
                    'page': box.get('page', 0),
                    'bbox': {
                        'x': get_box_coords(box)['x'],
                        'y': get_box_coords(box)['y'],
                        'width': get_box_coords(box)['width'],
                        'height': get_box_coords(box)['height'],
                        # Use original class name, not model title
                        'label': box.get('originalClassName') or box.get('parentClass') or box.get('label') or box.get('className')
                    }
                } for box in boxes]
            }
            
            temp_file = 'temp_training_combined.json'
            with open(temp_file, 'w') as f:
                json.dump(training_data, f)
            
            # Calculate which pages have training examples
            pages_with_boxes = list(set(box.get('page', 0) for box in boxes))
            eprint(f"Training on pages: {pages_with_boxes}")
            
            from detector import TemplateDetector
            detector = TemplateDetector()
            detector.load_training_data(temp_file, args.pdf, multi_orientation=args.multi_orientation, include_inverted=args.include_inverted, pages=pages_with_boxes)
            
            # Save model
            model_path = os.path.join(models_dir, f'{model_id}.pkl')
            with open(model_path, 'wb') as f:
                pickle.dump(detector, f)
            
            # Build shapeTypes map per class
            class_shape_types = {}
            for box in boxes:
                class_name = box.get('originalClassName') or box.get('parentClass') or box.get('label') or box.get('className')
                if class_name and class_name not in class_shape_types:
                    class_shape_types[class_name] = box.get('shapeType', 'rectangle')
            
            # Build subclassRegions map per class (for targeted OCR)
            # Also store training box dimensions for proper scaling
            class_subclass_regions = {}
            class_training_box_size = {}  # Store training box dimensions
            for box in boxes:
                class_name = box.get('originalClassName') or box.get('parentClass') or box.get('label') or box.get('className')
                if class_name and box.get('subclassRegions') and class_name not in class_subclass_regions:
                    class_subclass_regions[class_name] = box.get('subclassRegions')
                    # Store normalized width/height of training box
                    # This is used to scale subclass regions correctly even if detection box differs
                    class_training_box_size[class_name] = {
                        'width': box.get('width', 0),
                        'height': box.get('height', 0)
                    }
                    eprint(f"Stored training box size for {class_name}: {class_training_box_size[class_name]}")
            
            # Save metadata
            metadata = {
                'id': model_id,
                'className': ', '.join(sorted(all_classes)),  # Show all classes
                'classes': all_classes,  # List of all classes
                'isMultiClass': True,
                'modelType': model_type,  # 'Smart Link' or 'object'
                'shapeTypes': class_shape_types,  # Shape type per class
                'subclassRegions': class_subclass_regions,  # Subclass OCR regions per class
                'trainingBoxSizes': class_training_box_size,  # Training box dimensions for scaling
                'created': datetime.now().isoformat(),
                'numTemplates': sum(len(v) for v in detector.templates.values()),
                'numExamples': len(boxes),
                'multiOrientation': args.multi_orientation,
                'includeInverted': args.include_inverted,
                'pdfFilename': os.path.basename(args.pdf),
                'pdfPath': args.pdf,  # Full path for retraining
                # Store training examples for viewing/removal/retraining
                'trainingExamples': [{
                    'id': f'ex_{idx}',
                    'bbox': get_box_coords(box),
                    'page': box.get('page', 0),
                    'className': box.get('originalClassName') or box.get('parentClass') or box.get('label') or box.get('className'),
                    'shapeType': box.get('shapeType', 'rectangle'),
                    'subclassRegions': box.get('subclassRegions')
                } for idx, box in enumerate(boxes)]
            }
            
            metadata_path = os.path.join(models_dir, f'{model_id}_metadata.json')
            with open(metadata_path, 'w') as f:
                json.dump(metadata, f, indent=2)
            
            os.remove(temp_file)
            
            created_models.append({
                'modelId': model_id,
                'className': metadata['className'],
                'numTemplates': metadata['numTemplates'],
                'numExamples': len(boxes),
                'isMultiClass': True,
                'modelType': model_type
            })
            
            eprint(f"Created COMBINED model: {model_id} with classes: {all_classes}, type: {model_type}")
            
        else:
            # SEPARATE MODE: Create one model per class (original behavior)
            for class_name, class_boxes in boxes_by_class.items():
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
                model_id = f"{class_name}_{timestamp}"
                
                # Get original class name from first box
                original_class = class_boxes[0].get('originalClassName') or class_boxes[0].get('parentClass') or class_name
                
                training_data = {
                    'pdf': args.pdf,
                    'annotations': [{
                        'page': box.get('page', 0),
                        'bbox': {
                            'x': get_box_coords(box)['x'],
                            'y': get_box_coords(box)['y'],
                            'width': get_box_coords(box)['width'],
                            'height': get_box_coords(box)['height'],
                            # Use original class name for label
                            'label': box.get('originalClassName') or box.get('parentClass') or box.get('label') or box.get('className')
                        }
                    } for box in class_boxes]
                }
                
                temp_file = f'temp_training_{class_name}.json'
                with open(temp_file, 'w') as f:
                    json.dump(training_data, f)
                
                # Calculate which pages have training examples for this class
                pages_with_boxes = list(set(box.get('page', 0) for box in class_boxes))
                eprint(f"Training {class_name} on pages: {pages_with_boxes}")
                
                from detector import TemplateDetector
                detector = TemplateDetector()
                detector.load_training_data(temp_file, args.pdf, multi_orientation=args.multi_orientation, include_inverted=args.include_inverted, pages=pages_with_boxes)
                
                model_path = os.path.join(models_dir, f'{model_id}.pkl')
                with open(model_path, 'wb') as f:
                    pickle.dump(detector, f)
                
                # Get shapeType from first box of this class
                shape_type = class_boxes[0].get('shapeType', 'rectangle') if class_boxes else 'rectangle'
                
                # Get subclassRegions and training box size from first box that has them
                subclass_regions = None
                training_box_size = None
                for box in class_boxes:
                    if box.get('subclassRegions'):
                        subclass_regions = box.get('subclassRegions')
                        training_box_size = {
                            'width': box.get('width', 0),
                            'height': box.get('height', 0)
                        }
                        eprint(f"Stored training box size for {original_class}: {training_box_size}")
                        break
                
                metadata = {
                    'id': model_id,
                    'className': class_name,
                    'originalClassName': original_class,  # Store original class name
                    'isMultiClass': False,
                    'modelType': model_type,  # 'Smart Link' or 'object'
                    'shapeType': shape_type,  # Shape type for rendering
                    'shapeTypes': {original_class: shape_type},  # Also as map for consistency
                    'subclassRegions': {original_class: subclass_regions} if subclass_regions else {},
                    'trainingBoxSizes': {original_class: training_box_size} if training_box_size else {},
                    'created': datetime.now().isoformat(),
                    'numTemplates': sum(len(v) for v in detector.templates.values()),
                    'numExamples': len(class_boxes),
                    'multiOrientation': args.multi_orientation,
                    'includeInverted': args.include_inverted,
                    'pdfFilename': os.path.basename(args.pdf),
                    'pdfPath': args.pdf,  # Full path for retraining
                    # Store training examples for viewing/removal/retraining
                    'trainingExamples': [{
                        'id': f'ex_{idx}',
                        'bbox': get_box_coords(box),
                        'page': box.get('page', 0),
                        'className': box.get('originalClassName') or box.get('parentClass') or box.get('label') or box.get('className'),
                        'shapeType': box.get('shapeType', 'rectangle'),
                        'subclassRegions': box.get('subclassRegions')
                    } for idx, box in enumerate(class_boxes)]
                }
                
                metadata_path = os.path.join(models_dir, f'{model_id}_metadata.json')
                with open(metadata_path, 'w') as f:
                    json.dump(metadata, f, indent=2)
                
                os.remove(temp_file)
                
                created_models.append({
                    'modelId': model_id,
                    'className': class_name,
                    'numTemplates': metadata['numTemplates'],
                    'numExamples': len(class_boxes),
                    'isMultiClass': False,
                    'modelType': model_type
                })
                
                eprint(f"Created model: {model_id} ({class_name}) with {metadata['numTemplates']} templates, type: {model_type}")
        
        # Output result
        result = {
            'success': True,
            'models': created_models,
            'totalModels': len(created_models),
            'message': f"Created {len(created_models)} model(s) from {len(boxes)} examples",
            'mode': args.mode,
            'modelType': model_type
        }
        
        print(json.dumps(result), flush=True)
        sys.exit(0)
        
    except Exception as e:
        eprint(f"Training error: {e}")
        import traceback
        eprint(traceback.format_exc())
        
        error_result = {
            'success': False,
            'error': str(e)
        }
        print(json.dumps(error_result), flush=True)
        sys.exit(1)

if __name__ == '__main__':
    main()
