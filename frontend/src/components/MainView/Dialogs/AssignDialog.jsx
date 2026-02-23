/**
 * AssignDialog.jsx
 * 
 * Modal dialog for assigning a target document to a Smart Link hotspot.
 * Shows a searchable list of project files for the user to select from.
 */

import { useState } from 'react';

export default function AssignDialog({
  isOpen,
  onClose,
  pendingHotspot,
  allFiles,
  currentFileId,
  onAssign
}) {
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const handleClose = () => {
    setSearchQuery('');
    onClose();
  };

  const handleAssign = (fileId, fileName) => {
    onAssign(fileId, fileName);
    setSearchQuery('');
  };

  const filteredFiles = allFiles.filter(file => 
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal assign-modal dark-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Assign Target Document</h2>
          <button className="modal-close-btn" onClick={handleClose}>×</button>
        </div>
        
        {pendingHotspot?.label && (
          <div className="link-label-preview">
            <span className="label-text">{pendingHotspot.label}</span>
          </div>
        )}
        
        <p>Select the target document for this link:</p>
        
        <input
          type="text"
          className="target-search-input dark"
          placeholder="Search files..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoFocus
        />
        
        <div className="pdf-list dark">
          {filteredFiles.map(file => (
            <div
              key={file.id}
              className={`pdf-option ${file.id === currentFileId ? 'current' : ''}`}
              onClick={() => handleAssign(file.id, file.name)}
            >
              <span>{file.name}</span>
              {file.id === currentFileId && <span className="badge">Current</span>}
            </div>
          ))}
          {filteredFiles.length === 0 && (
            <div className="no-results">No files match "{searchQuery}"</div>
          )}
        </div>
        
        <div className="modal-actions">
          <button className="cancel-btn" onClick={handleClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
