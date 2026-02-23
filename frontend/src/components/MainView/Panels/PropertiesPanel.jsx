/**
 * PropertiesPanel.jsx
 * 
 * Panel for document properties and settings.
 */

export default function PropertiesPanel({
  isOpen,
  onClose,
  onNavigateToDocProps,
  currentFile
}) {
  if (!isOpen) return null;

  return (
    <div className="smart-links-panel">
      <div className="panel-header">
        <h3>Properties</h3>
        <button className="close-panel" onClick={onClose}>×</button>
      </div>
      <div className="panel-content">
        <div className="panel-section">
          <h4>Current Document</h4>
          {currentFile ? (
            <div className="view-preferences">
              <div className="view-pref-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                <label style={{ color: '#888', fontSize: '11px' }}>Filename</label>
                <span style={{ fontSize: '13px', color: '#ccc', wordBreak: 'break-all' }}>{currentFile.name}</span>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: '12px', color: '#888' }}>No document selected</p>
          )}
        </div>
        
        <div className="panel-section">
          <h4>Document Properties</h4>
          <p style={{ fontSize: '12px', color: '#888', marginBottom: '12px' }}>
            View and edit extracted properties, revision info, and metadata for all project documents.
          </p>
          <button 
            className="primary-btn"
            onClick={onNavigateToDocProps}
            style={{ width: '100%' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ marginRight: '8px', verticalAlign: 'middle' }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="1.5"/>
              <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="1.5"/>
              <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" strokeWidth="1.5"/>
              <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" strokeWidth="1.5"/>
              <line x1="10" y1="9" x2="8" y2="9" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
            Open Document Properties
          </button>
        </div>
      </div>
    </div>
  );
}
