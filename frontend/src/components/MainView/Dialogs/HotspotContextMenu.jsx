/**
 * HotspotContextMenu.jsx
 * 
 * Right-click context menu for Smart Link hotspots.
 * Shows link status, target info, and actions (assign, navigate, delete).
 */

export default function HotspotContextMenu({
  isOpen,
  position,
  hotspot,
  targetFile,
  isLinked,
  isBroken,
  onClose,
  onAssign,
  onNavigate,
  onDelete
}) {
  if (!isOpen || !hotspot) return null;

  return (
    <div 
      className="hotspot-context-menu-overlay"
      onClick={onClose}
    >
      <div 
        className="hotspot-context-menu"
        style={{
          left: position.x,
          top: position.y
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="context-menu-header">
          {hotspot.label || 'Smart Link'}
        </div>
        
        <div className="context-menu-section">
          <div className="context-menu-label">Status</div>
          <div className={`context-menu-status ${isLinked ? 'linked' : isBroken ? 'broken' : 'unlinked'}`}>
            {isLinked 
              ? '✓ Linked' 
              : isBroken 
                ? '⚠ Broken' 
                : '○ Unassigned'}
          </div>
        </div>
        
        {(isLinked || hotspot.propertyName || hotspot.assignmentMode) && (
          <div className="context-menu-section">
            <div className="context-menu-label">Match By</div>
            <div className="context-menu-value">
              {hotspot.assignmentMode === 'property' && hotspot.propertyName 
                ? `Detector - Document Property: ${hotspot.propertyName}`
                : hotspot.assignmentMode === 'drawn'
                ? 'Assigned on Document'
                : hotspot.assignmentMode === 'manual'
                ? 'Target Document Changed'
                : 'Detector - Document Name'}
            </div>
          </div>
        )}
        
        {isLinked && targetFile && (
          <div className="context-menu-section">
            <div className="context-menu-label">Target</div>
            <div className="context-menu-value">{targetFile.name}</div>
          </div>
        )}
        
        {isBroken && (
          <div className="context-menu-section">
            <div className="context-menu-label">Original Target</div>
            <div className="context-menu-value broken">
              {hotspot.targetFilename || 'Unknown'} (deleted)
            </div>
          </div>
        )}
        
        {hotspot.confidence && (
          <div className="context-menu-section">
            <div className="context-menu-label">Confidence</div>
            <div className="context-menu-value">{Math.round(hotspot.confidence * 100)}%</div>
          </div>
        )}
        
        <div className="context-menu-divider" />
        
        <button 
          className="context-menu-item"
          onClick={() => {
            onAssign();
            onClose();
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          {isLinked ? 'Change Target' : 'Assign Target'}
        </button>
        
        {isLinked && (
          <button 
            className="context-menu-item"
            onClick={() => {
              onNavigate();
              onClose();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Go to Document
          </button>
        )}
        
        <button 
          className="context-menu-item delete"
          onClick={() => {
            onDelete();
            onClose();
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          Delete Link
        </button>
      </div>
    </div>
  );
}
