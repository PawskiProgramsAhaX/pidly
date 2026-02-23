/**
 * ObjectClassDialog.jsx
 * 
 * Modal dialog for assigning a class to a drawn object box.
 * Supports both training mode (adding examples) and create mode (manual objects).
 * Features hierarchical class selection with dynamic dropdowns.
 */

import { useState, useEffect, useCallback } from 'react';

/**
 * Build hierarchical class selector levels
 */
function buildClassLevels(classes, objectClassInput, mode) {
  const rootClasses = classes.filter(c => !c.parentId);
  
  // Get subclasses of a parent
  const getSubclasses = (parentId) => classes.filter(c => c.parentId === parentId);
  
  // Parse current selection (format: "Parent > Child > Grandchild")
  const selectedParts = objectClassInput ? objectClassInput.split(' > ') : [];
  
  // Find class by name at each level
  const findClassByName = (name, parentId = null) => {
    return classes.find(c => c.name === name && c.parentId === parentId);
  };
  
  // Build the selection chain
  let currentParentId = null;
  const selectionChain = [];
  for (const part of selectedParts) {
    const cls = findClassByName(part, currentParentId);
    if (cls) {
      selectionChain.push(cls);
      currentParentId = cls.id;
    }
  }
  
  // Get available options at each level
  const levels = [];
  
  // First level is always root classes
  levels.push({
    options: rootClasses,
    selected: selectionChain[0]?.name || '',
    label: 'Class',
    depth: 0
  });
  
  // Add subsequent levels based on selection
  // BUT: In training mode, stop showing dropdowns once we reach a class with subclasses
  // because we train on the parent class and OCR determines subclass
  for (let i = 0; i < selectionChain.length; i++) {
    const subclasses = getSubclasses(selectionChain[i].id);
    if (subclasses.length > 0) {
      // In training mode, don't show subclass dropdown - we train on parent
      if (mode === 'train') {
        break; // Stop adding levels
      }
      levels.push({
        options: subclasses,
        selected: selectionChain[i + 1]?.name || '',
        label: i === 0 ? 'Subclass' : `Sub-subclass`,
        depth: i + 1
      });
    }
  }
  
  return { levels, selectionChain, getSubclasses };
}

export default function ObjectClassDialog({
  isOpen,
  onClose,
  mode, // 'train' or 'create'
  pendingBox,
  classes,
  classColumns,
  currentFileIdentifier,
  // Callbacks
  onAddTrainingBox,
  onCreateObject,
  onOpenSubclassRegionDialog,
  captureObjectImage
}) {
  const [classInput, setClassInput] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [descInput, setDescInput] = useState('');
  const [customFields, setCustomFields] = useState({});

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setClassInput('');
      setTagInput('');
      setDescInput('');
      setCustomFields({});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    setClassInput('');
    setTagInput('');
    setDescInput('');
    setCustomFields({});
    onClose();
  };

  const hasNoClasses = !classes || classes.length === 0;
  
  const { levels, selectionChain, getSubclasses } = buildClassLevels(classes || [], classInput, mode);
  const selectedParts = classInput ? classInput.split(' > ') : [];

  // Handle selection change at a level
  const handleLevelChange = (levelIndex, value) => {
    if (!value) {
      // Clear this level and all below
      const newParts = selectedParts.slice(0, levelIndex);
      setClassInput(newParts.join(' > '));
    } else {
      // Set this level and clear below
      const newParts = selectedParts.slice(0, levelIndex);
      newParts.push(value);
      const newClassInput = newParts.join(' > ');
      setClassInput(newClassInput);
      
      // In create mode (not train), immediately create object and open edit dialog
      if (mode === 'create' && levelIndex === 0 && pendingBox) {
        // Get the class definition
        const classDefinition = classes.find(c => c.name === value && !c.parentId);
        const subclasses = classDefinition ? classes.filter(c => c.parentId === classDefinition.id) : [];
        
        // Use the drawn shape type, not the class shape type
        const drawnShapeType = pendingBox.shapeType || 'rectangle';
        
        // Build the new object
        const newObject = {
          id: `obj_${Date.now()}`,
          className: value,
          label: value,
          parentClass: value,
          fullClassPath: value,
          hasSubclasses: subclasses.length > 0,
          availableSubclasses: subclasses.map(s => s.name),
          ocr_text: '',
          description: '',
          confidence: 1.0,
          isManual: true,
          page: pendingBox.page,
          bbox: {
            x: pendingBox.x,
            y: pendingBox.y,
            width: pendingBox.width,
            height: pendingBox.height,
          },
          shapeType: drawnShapeType,
          polylinePoints: pendingBox.polylinePoints || null,
          filename: currentFileIdentifier,
          // Initialize subclassValues if class has subclasses
          subclassValues: subclasses.length > 0 ? 
            subclasses.reduce((acc, s) => ({ ...acc, [s.name]: '' }), {}) : undefined,
        };
        
        onCreateObject(newObject, true); // true = open edit dialog
        handleClose();
      }
    }
  };

  const handleSave = () => {
    if (!pendingBox || !classInput) return;
    
    // Check if selected class has subclasses
    let currentParentId = null;
    let selectedClassObj = null;
    
    for (const part of selectedParts) {
      const cls = classes.find(c => c.name === part && c.parentId === currentParentId);
      if (cls) {
        selectedClassObj = cls;
        currentParentId = cls.id;
      }
    }
    
    const subclasses = selectedClassObj ? classes.filter(c => c.parentId === selectedClassObj.id) : [];
    
    // Use the drawn shape type, not the class's shape type
    const trainingClassName = classInput.split(' > ')[0];
    const drawnShapeType = pendingBox.shapeType || 'rectangle';
    
    // If training mode and class has subclasses, prompt for subclass region
    if (mode === 'train' && subclasses.length > 0 && !pendingBox.subclassRegions) {
      onOpenSubclassRegionDialog({
        ...pendingBox,
        className: classInput,
        label: classInput,
        shapeType: drawnShapeType,
        subclasses: subclasses.map(s => s.name),
        hasSubclasses: true
      });
      handleClose();
      return;
    }
    
    // Build object with all custom fields
    const newObject = {
      id: `obj_${Date.now()}`,
      className: trainingClassName, // Use parent class for model training
      label: classInput, // Keep full path for display
      parentClass: trainingClassName,
      fullClassPath: classInput,
      hasSubclasses: subclasses.length > 0,
      availableSubclasses: subclasses.map(s => s.name),
      ocr_text: tagInput.trim(),
      description: descInput.trim(),
      confidence: 1.0,
      isManual: true,
      page: pendingBox.page,
      bbox: {
        x: pendingBox.x,
        y: pendingBox.y,
        width: pendingBox.width,
        height: pendingBox.height,
      },
      shapeType: drawnShapeType,
      polylinePoints: pendingBox.polylinePoints || null,
      filename: currentFileIdentifier,
      subclassRegion: pendingBox.subclassRegion || null,
      ...customFields
    };
    
    if (mode === 'train') {
      onAddTrainingBox(newObject);
    } else {
      onCreateObject(newObject, true);
    }
    
    handleClose();
  };

  // Get selected class info for display
  const getSelectedClassInfo = () => {
    if (!classInput) return null;
    const rootClassName = classInput.split(' > ')[0];
    const classObj = classes.find(c => c.name === rootClassName && !c.parentId);
    const shapeIcon = classObj?.shapeType === 'circle' ? '○' : classObj?.shapeType === 'polyline' ? '⬡' : '▢';
    const shapeName = classObj?.shapeType === 'circle' ? 'Circle' : classObj?.shapeType === 'polyline' ? 'Polygon' : 'Rectangle';
    return { shapeIcon, shapeName };
  };

  // Get subclass info for training mode
  const getSubclassTrainingInfo = () => {
    if (mode !== 'train' || !classInput) return null;
    const lastClass = selectionChain[selectionChain.length - 1];
    if (!lastClass) return null;
    const subs = getSubclasses(lastClass.id);
    if (subs.length === 0) return null;
    return { className: lastClass.name, subclasses: subs };
  };

  const selectedClassInfo = getSelectedClassInfo();
  const subclassInfo = getSubclassTrainingInfo();
  const currentClassColumns = classColumns?.[classInput] || [];

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal object-class-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{mode === 'train' ? 'Add Training Example' : 'Create Object'}</h2>
        
        {/* Check if any classes exist */}
        {hasNoClasses ? (
          <div className="no-classes-warning">
            <p>⚠️ No classes have been created yet.</p>
            <p>Please go to <strong>Project Classes</strong> and create a class first.</p>
            <div className="modal-actions">
              <button onClick={handleClose}>Close</button>
            </div>
          </div>
        ) : (
          <div className="object-form">
            {/* Hierarchical Class Selector */}
            <div className="hierarchical-class-selector">
              {levels.map((level, idx) => (
                <div className="form-row" key={idx} style={{ marginLeft: level.depth * 12 }}>
                  <label>{level.label}:</label>
                  <select
                    value={level.selected}
                    onChange={(e) => handleLevelChange(idx, e.target.value)}
                    autoFocus={idx === 0}
                  >
                    <option value="">-- Select {level.label.toLowerCase()} --</option>
                    {level.options.map(cls => {
                      const subCount = getSubclasses(cls.id).length;
                      return (
                        <option key={cls.id || cls.name} value={cls.name}>
                          {cls.name}{subCount > 0 ? ` (${subCount} subclasses)` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              ))}
              
              {/* Selected class display */}
              {classInput && selectedClassInfo && (
                <div className="selected-class-display">
                  <span className="class-path-label">Selected:</span>
                  <span className="class-path">{classInput}</span>
                  <span className="class-shape-badge" title={`Shape: ${selectedClassInfo.shapeName}`}>
                    {selectedClassInfo.shapeIcon} {selectedClassInfo.shapeName}
                  </span>
                </div>
              )}
              
              {/* Show subclass info for training mode */}
              {subclassInfo && (
                <div className="subclass-training-info">
                  <p>ℹ️ <strong>{subclassInfo.className}</strong> has {subclassInfo.subclasses.length} subclass(es):</p>
                  <div className="subclass-chips">
                    {subclassInfo.subclasses.map(s => (
                      <span key={s.id} className="subclass-chip">{s.name}</span>
                    ))}
                  </div>
                  <p className="subclass-hint">
                    During detection, OCR will automatically classify objects into the correct subclass based on the text pattern (e.g., "FI-123" → Flow Indicator).
                  </p>
                </div>
              )}
            </div>
            
            {/* Only show fields for Create mode (not training) AND after class is selected */}
            {mode !== 'train' && classInput && (
              <div className="object-details-section">
                {/* Tag field - always shown */}
                <div className="form-row">
                  <label>Tag:</label>
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                  />
                </div>
                
                {/* Dynamic custom columns based on selected class */}
                {currentClassColumns.length > 0 && currentClassColumns.map(col => (
                  <div className="form-row" key={col.id}>
                    <label>{col.name}:</label>
                    <input
                      type="text"
                      value={customFields[col.id] || ''}
                      onChange={(e) => setCustomFields(prev => ({
                        ...prev,
                        [col.id]: e.target.value
                      }))}
                    />
                  </div>
                ))}
              </div>
            )}
          
            <div className="modal-actions">
              <button onClick={handleClose}>Cancel</button>
              <button 
                className="primary-btn"
                onClick={handleSave}
                disabled={!classInput}
              >
                {mode === 'train' ? 'Add to Training' : 'Save Object'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
