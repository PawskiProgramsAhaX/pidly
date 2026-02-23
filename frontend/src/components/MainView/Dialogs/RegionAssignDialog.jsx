/**
 * RegionAssignDialog.jsx
 * 
 * Modal dialog for assigning a region type and sub-region name to a drawn shape.
 * Includes region type selector, sub-region name input, and color pickers.
 * Gunmetal grey theme to match the Objects panel draw-type UI.
 */

import { useState, useEffect } from 'react';

export default function RegionAssignDialog({
  isOpen,
  onClose,
  pendingShape,
  regionTypes,
  existingRegions,
  currentFile,
  onSave,
  onNavigateToRegions,
  getSubRegionColors
}) {
  const [regionType, setRegionType] = useState('');
  const [subRegionName, setSubRegionName] = useState('');
  const [fillColor, setFillColor] = useState('#3498db');
  const [borderColor, setBorderColor] = useState('#3498db');

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setRegionType('');
      setSubRegionName('');
      setFillColor('#3498db');
      setBorderColor('#3498db');
    }
  }, [isOpen]);

  if (!isOpen || !pendingShape) return null;

  const handleClose = () => {
    onClose();
  };

  const handleRegionTypeChange = (value) => {
    setRegionType(value);
    // Update colors based on new region type
    if (value && subRegionName.trim() && getSubRegionColors) {
      const colors = getSubRegionColors(value, subRegionName.trim());
      setFillColor(colors.fillColor);
      setBorderColor(colors.borderColor);
    }
  };

  const handleSubRegionNameChange = (value) => {
    setSubRegionName(value);
    // Update colors if this sub-region already exists
    if (regionType && value.trim() && getSubRegionColors) {
      const colors = getSubRegionColors(regionType, value.trim());
      setFillColor(colors.fillColor);
      setBorderColor(colors.borderColor);
    }
  };

  const handleSave = () => {
    if (!regionType || !subRegionName.trim()) return;

    const trimmedName = subRegionName.trim();

    // Create the new region object
    const newRegion = {
      id: `region_${Date.now()}`,
      regionType: regionType,
      subRegionName: trimmedName,
      page: pendingShape.page,
      bbox: {
        x: pendingShape.x,
        y: pendingShape.y,
        width: pendingShape.width,
        height: pendingShape.height,
      },
      shapeType: pendingShape.shapeType || 'rectangle',
      polylinePoints: pendingShape.polylinePoints || null,
      filename: currentFile?.backendFilename || currentFile?.name,
      fileId: currentFile?.id,
      createdAt: new Date().toISOString(),
      fillColor: fillColor,
      borderColor: borderColor,
    };

    onSave(newRegion, { fillColor, borderColor });
  };

  // Check if sub-region already exists
  const subRegionExists = regionType && subRegionName.trim() && existingRegions?.some(
    r => r.subRegionName === subRegionName.trim() && r.regionType === regionType
  );

  const hasNoRegionTypes = !regionTypes || regionTypes.length === 0;

  // SVG icon matching the one used in ProjectRegionsPage
  const regionIcon = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ verticalAlign: 'middle', marginRight: 8 }}>
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M3 9h18M9 21V9"/>
    </svg>
  );

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal region-assign-modal" onClick={(e) => e.stopPropagation()}>
        <div className="region-modal-header">
          <h2>{regionIcon} Assign Region</h2>
          <button className="region-modal-close" onClick={handleClose}>×</button>
        </div>
        
        {/* Check if any region types exist */}
        {hasNoRegionTypes ? (
          <div className="no-classes-warning region-no-types">
            <p>⚠️ No region types have been created yet.</p>
            <p>Please go to <strong>Regions</strong> page and create a region type first.</p>
            <div className="modal-actions">
              <button onClick={handleClose}>Close</button>
              <button 
                className="primary-btn"
                onClick={() => {
                  onNavigateToRegions?.();
                  handleClose();
                }}
              >
                Go to Regions
              </button>
            </div>
          </div>
        ) : (
          <div className="region-form">
            <div className="form-group">
              <label>Region Type</label>
              <select
                value={regionType}
                onChange={(e) => handleRegionTypeChange(e.target.value)}
                autoFocus
              >
                <option value="">-- Select region type --</option>
                {regionTypes.map(rt => (
                  <option key={rt.id} value={rt.name}>
                    {rt.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="form-group">
              <label>Sub-region Name</label>
              <input
                type="text"
                placeholder="e.g., Title Block, Legend, Area A..."
                value={subRegionName}
                onChange={(e) => handleSubRegionNameChange(e.target.value)}
              />
              {/* Show hint if sub-region exists */}
              {subRegionExists && (
                <span className="region-hint">
                  ℹ️ Existing sub-region — colors will apply to all regions with this name
                </span>
              )}
            </div>
            
            {/* Color controls */}
            <div className="form-group">
              <label>Colors</label>
              <div className="region-color-row">
                <div className="region-color-picker">
                  <span className="region-color-label">Fill</span>
                  <input
                    type="color"
                    value={fillColor}
                    onChange={(e) => setFillColor(e.target.value)}
                    className="region-color-input"
                  />
                </div>
                <div className="region-color-picker">
                  <span className="region-color-label">Line</span>
                  <input
                    type="color"
                    value={borderColor}
                    onChange={(e) => setBorderColor(e.target.value)}
                    className="region-color-input"
                  />
                </div>
              </div>
            </div>
            
            <div className="modal-actions">
              <button onClick={handleClose}>
                Cancel
              </button>
              <button 
                className="primary-btn"
                onClick={handleSave}
                disabled={!regionType || !subRegionName.trim()}
              >
                Save Region
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
