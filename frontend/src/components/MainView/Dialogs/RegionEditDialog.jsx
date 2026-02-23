/**
 * RegionEditDialog.jsx
 * 
 * Modal dialog for editing or deleting an existing region.
 * Shows region type (read-only) and allows editing sub-region name.
 */

import { useState, useEffect } from 'react';

export default function RegionEditDialog({
  isOpen,
  onClose,
  region,
  onSave,
  onDelete
}) {
  const [subRegionName, setSubRegionName] = useState('');

  // Initialize form when region changes
  useEffect(() => {
    if (region) {
      setSubRegionName(region.subRegionName || '');
    }
  }, [region]);

  if (!isOpen || !region) return null;

  const handleClose = () => {
    onClose();
  };

  const handleSave = () => {
    if (!subRegionName.trim()) return;
    onSave(region.id, subRegionName.trim());
  };

  const handleDelete = () => {
    const confirmMessage = `Delete this region?\n\n"${region.subRegionName}" on ${region.filename?.replace('.pdf', '')}`;
    if (!confirm(confirmMessage)) {
      return;
    }
    onDelete(region.id);
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal region-edit-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <h2>🗺️ Edit Region</h2>
        
        <div className="region-form">
          <div className="form-group">
            <label>Region Type:</label>
            <input
              type="text"
              value={region.regionType}
              disabled
              style={{ background: '#f5f5f5', color: '#666' }}
            />
          </div>
          
          <div className="form-group">
            <label>Sub-region Name:</label>
            <input
              type="text"
              value={subRegionName}
              onChange={(e) => setSubRegionName(e.target.value)}
              autoFocus
            />
          </div>
          
          <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
            <button 
              className="delete-btn"
              style={{ 
                background: '#fee', 
                color: '#c00', 
                border: '1px solid #fcc',
                padding: '8px 16px',
                borderRadius: 6,
                cursor: 'pointer'
              }}
              onClick={handleDelete}
            >
              🗑️ Delete
            </button>
            
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleClose}>
                Cancel
              </button>
              <button 
                className="primary-btn"
                onClick={handleSave}
                disabled={!subRegionName.trim()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
