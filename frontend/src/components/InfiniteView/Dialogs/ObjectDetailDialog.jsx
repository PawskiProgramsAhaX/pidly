/**
 * ObjectDetailDialog.jsx
 * 
 * Modal dialog for viewing/editing a detected object's metadata.
 * Extracted from InfiniteView for maintainability.
 */
import React from 'react';

export default function ObjectDetailDialog({
  selectedObject,
  setSelectedObject,
  objectThumbnail,
  project,
  onSave,
  onClose,
}) {
  if (!selectedObject) return null;

  const className = selectedObject.label || selectedObject.className;
  const parentClass = (project?.classes || []).find(c => c.name === className && !c.parentId);
  const subclasses = parentClass ? (project?.classes || []).filter(c => c.parentId === parentClass.id) : [];
  const hasSubclasses = subclasses.length > 0 || (selectedObject.subclassValues && Object.keys(selectedObject.subclassValues).length > 0);

  // Gather all subclass names from class definition + object's existing values
  const subclassNames = hasSubclasses
    ? (() => {
        const names = new Set(subclasses.map(s => s.name));
        if (selectedObject.subclassValues) {
          Object.keys(selectedObject.subclassValues).forEach(k => names.add(k));
        }
        return Array.from(names);
      })()
    : [];

  const classColumns = project?.classColumns?.[className] || [];

  return (
    <div className="object-dialog-overlay" onClick={onClose}>
      <div className="object-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="object-dialog-header">
          <h3>Edit Object</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="object-dialog-content">
          {/* Thumbnail */}
          <div className="object-thumbnail-container">
            {objectThumbnail ? (
              <img src={objectThumbnail} alt="Object thumbnail" className="object-thumbnail" />
            ) : (
              <div className="object-thumbnail-placeholder">Loading...</div>
            )}
          </div>
          
          {/* Class selector - only show parent classes */}
          <div className="object-detail-row">
            <label>Class:</label>
            <select
              value={className || ''}
              onChange={(e) => setSelectedObject(prev => ({ ...prev, label: e.target.value }))}
            >
              <option value="">Select class...</option>
              {(project?.classes || []).filter(c => !c.parentId).map(cls => (
                <option key={cls.id || cls.name} value={cls.name}>{cls.name}</option>
              ))}
              {/* Keep current class if not in list */}
              {selectedObject.label && !(project?.classes || []).find(c => c.name === selectedObject.label && !c.parentId) && (
                <option value={selectedObject.label}>{selectedObject.label}</option>
              )}
            </select>
          </div>
          
          {/* Subclass fields or Tag field */}
          {hasSubclasses ? (
            <>
              <div className="subclass-fields-divider">Subclass Fields</div>
              {subclassNames.map(subName => (
                <div className="object-detail-row" key={subName}>
                  <label>{subName}:</label>
                  <input
                    type="text"
                    value={selectedObject.subclassValues?.[subName] || ''}
                    onChange={(e) => setSelectedObject(prev => ({ 
                      ...prev, 
                      subclassValues: {
                        ...(prev.subclassValues || {}),
                        [subName]: e.target.value
                      }
                    }))}
                    placeholder={`Enter ${subName}...`}
                  />
                </div>
              ))}
            </>
          ) : (
            <div className="object-detail-row">
              <label>Tag:</label>
              <input
                type="text"
                value={selectedObject.ocr_text || ''}
                onChange={(e) => setSelectedObject(prev => ({ ...prev, ocr_text: e.target.value }))}
                placeholder="Enter tag..."
              />
            </div>
          )}
          
          {/* Custom columns from project - per class */}
          {classColumns.length > 0 && (
            <>
              <div className="subclass-fields-divider">Custom Fields</div>
              {classColumns.map(col => (
                <div className="object-detail-row" key={col.id}>
                  <label>{col.name}:</label>
                  <input
                    type="text"
                    value={selectedObject[col.id] || ''}
                    onChange={(e) => setSelectedObject(prev => ({ ...prev, [col.id]: e.target.value }))}
                    placeholder={`Enter ${col.name}...`}
                  />
                </div>
              ))}
            </>
          )}
          
          <div className="object-detail-row">
            <label>File:</label>
            <span>{selectedObject.filename}</span>
          </div>
          <div className="object-detail-row">
            <label>Page:</label>
            <span>{(selectedObject.page || 0) + 1}</span>
          </div>
          <div className="object-detail-row">
            <label>Confidence:</label>
            <span>{selectedObject.confidence ? `${(selectedObject.confidence * 100).toFixed(1)}%` : 'N/A'}</span>
          </div>
          
          {/* Actions */}
          <div className="object-dialog-actions">
            <button className="save-btn" onClick={onSave}>
              Save Changes
            </button>
            <button className="cancel-btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
