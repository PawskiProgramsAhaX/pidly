/**
 * MarkupToolbar.jsx
 *
 * Secondary toolbar with markup drawing tools - pen, highlighter, shapes, text, etc.
 * Also includes undo/redo and symbols panel toggle.
 * Tools are always accessible. Lock/unlock only affects editing existing markups.
 */

export default function MarkupToolbar({
  // Edit mode
  markupEditMode,
  // Current mode
  markupMode,
  onSetMarkupMode,
  // Selection
  onClearSelection,
  // Highlighter opacity
  onSetHighlighterOpacity,
  currentOpacity,
  // Undo/Redo
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  // Symbols panel
  showMarkupsPanel,
  onToggleMarkupsPanel,
  // History panel
  showMarkupHistoryPanel,
  onToggleMarkupHistoryPanel,
  // Document name
  documentName,
  // Placement mode
  pendingPlacement
}) {
  const handleToolClick = (tool) => {
    if (tool === 'highlighter') {
      onSetMarkupMode(markupMode === 'highlighter' ? null : 'highlighter');
      onClearSelection();
      if (markupMode !== 'highlighter') onSetHighlighterOpacity(0.4);
      else onSetHighlighterOpacity(1.0);
    } else {
      onSetMarkupMode(markupMode === tool ? null : tool);
      onClearSelection();
    }
  };

  return (
    <div className="pdf-toolbar pdf-toolbar-markup">
      {/* Left - empty spacer */}
      <div className="markup-toolbar-left"></div>

      {/* Center - Markup tools */}
      <div className="markup-toolbar-tools">
        {/* Pen */}
        <button
          className={`markup-tb-btn ${markupMode === 'pen' && !pendingPlacement ? 'active' : ''}`}
          onClick={() => handleToolClick('pen')}
          title="Pen (P)"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <path d="M11.5 1.5L14.5 4.5L5 14H2V11L11.5 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M9 4L12 7" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
        </button>

        {/* Highlighter */}
        <button
          className={`markup-tb-btn ${markupMode === 'highlighter' && !pendingPlacement ? 'active' : ''}`}
          onClick={() => handleToolClick('highlighter')}
          title="Highlighter (H)"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <rect x="4" y="2" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M6 12V14H10V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="6" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Arrow */}
        <button
          className={`markup-tb-btn ${markupMode === 'arrow' && !pendingPlacement ? 'active' : ''}`}
          onClick={() => handleToolClick('arrow')}
          title="Arrow (A)"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <line x1="2" y1="14" x2="12" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M12 4L12 9M12 4L7 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Line */}
        <button
          className={`markup-tb-btn ${markupMode === 'line' && !pendingPlacement ? 'active' : ''}`}
          onClick={() => handleToolClick('line')}
          title="Line (L)"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <line x1="2" y1="14" x2="14" y2="2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Rectangle */}
        <button
          className={`markup-tb-btn ${markupMode === 'rectangle' && !pendingPlacement ? 'active' : ''}`}
          onClick={() => handleToolClick('rectangle')}
          title="Rectangle (R)"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
        </button>

        {/* Circle/Ellipse */}
        <button
          className={`markup-tb-btn ${markupMode === 'circle' && !pendingPlacement ? 'active' : ''}`}
          onClick={() => handleToolClick('circle')}
          title="Circle/Ellipse (E)"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <ellipse cx="8" cy="8" rx="6" ry="5" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
        </button>

        {/* Arc */}
        <button
          className={`markup-tb-btn ${markupMode === 'arc' && !pendingPlacement ? 'active' : ''}`}
          onClick={() => handleToolClick('arc')}
          title="Arc"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <path d="M3 12C3 12 5 4 13 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
          </svg>
        </button>

        {/* Cloud */}
        <button
          className={`markup-tb-btn ${markupMode === 'cloud' && !pendingPlacement ? 'active' : ''}`}
          onClick={() => handleToolClick('cloud')}
          title="Cloud (C)"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <path d="M4 11C2.5 11 2 9.5 3 8.5C2 7.5 3 6 4.5 6C4.5 4 6 3 8 3C10 3 11.5 4 11.5 6C13 6 14 7.5 13 8.5C14 9.5 13.5 11 12 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M4 11C5 12 7 12 8 12C9 12 11 12 12 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Polyline */}
        <button
          className={`markup-tb-btn ${markupMode === 'polyline' && !pendingPlacement ? 'active' : ''}`}
          onClick={() => handleToolClick('polyline')}
          title="Polyline (Shift+L)"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <polyline points="2,12 5,5 9,10 14,3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
        </button>

        {/* Polyline Arrow */}
        <button
          className={`markup-tb-btn ${markupMode === 'polylineArrow' && !pendingPlacement ? 'active' : ''}`}
          onClick={() => handleToolClick('polylineArrow')}
          title="Polyline Arrow (Shift+A)"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <polyline points="2,12 5,5 9,10 13,4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            <path d="M13 4L13 7.5M13 4L9.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Cloud Polyline */}
        <button
          className={`markup-tb-btn ${markupMode === 'cloudPolyline' && !pendingPlacement ? 'active' : ''}`}
          onClick={() => handleToolClick('cloudPolyline')}
          title="Cloud Polyline (Shift+C)"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <path d="M2 12 Q3.5 10 5 12 Q6.5 14 8 12 Q9.5 10 11 12 Q12.5 14 14 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
            <path d="M2 7 Q3.5 5 5 7 Q6.5 9 8 7 Q9.5 5 11 7 Q12.5 9 14 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
          </svg>
        </button>

        <span className="markup-tb-divider"></span>

        {/* Text Box */}
        <button
          className={`markup-tb-btn ${markupMode === 'text' && !pendingPlacement ? 'active' : ''}`}
          onClick={() => handleToolClick('text')}
          title="Text Box (T)"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <text x="4" y="12" fill="currentColor" fontSize="12" fontWeight="bold" fontFamily="Arial">T</text>
          </svg>
        </button>

        {/* Callout - disabled */}
        <button
          className="markup-tb-btn"
          onClick={() => {}}
          title="Callout (coming soon)"
          disabled={true}
          style={{ opacity: 0.4, cursor: 'not-allowed' }}
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <path d="M2 3H14V10H6L3 13V10H2V3Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Sticky Note - disabled */}
        <button
          className="markup-tb-btn"
          onClick={() => {}}
          title="Sticky Note (coming soon)"
          disabled={true}
          style={{ opacity: 0.4, cursor: 'not-allowed' }}
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10 2V6H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="4" y1="7" x2="8" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="4" y1="10" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

        <span className="markup-tb-divider"></span>

        {/* Eraser - disabled */}
        <button
          className="markup-tb-btn"
          onClick={() => {}}
          title="Eraser (coming soon)"
          disabled={true}
          style={{ opacity: 0.4, cursor: 'not-allowed' }}
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <path d="M6 14H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M2 10L6 14L14 6L10 2L2 10Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 6L10 10" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
        </button>

        <span className="markup-tb-divider"></span>

        {/* Undo */}
        <button
          className="markup-tb-btn"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <path d="M4 6H11C12.5 6 14 7.5 14 9C14 10.5 12.5 12 11 12H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 3L3 6L6 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Redo */}
        <button
          className="markup-tb-btn"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <path d="M12 6H5C3.5 6 2 7.5 2 9C2 10.5 3.5 12 5 12H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M10 3L13 6L10 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        <span className="markup-tb-divider"></span>

        {/* Symbols Panel toggle */}
        <button
          className={`markup-tb-btn ${showMarkupsPanel ? 'active' : ''}`}
          onClick={onToggleMarkupsPanel}
          title="Symbols Library"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
            <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
            <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
            <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
        </button>

        {/* Markup History Panel toggle */}
        <button
          className={`markup-tb-btn ${showMarkupHistoryPanel ? 'active' : ''}`}
          onClick={onToggleMarkupHistoryPanel}
          title="Markup History"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
            <polyline points="8,4 8,8 11,10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Right - Document name */}
      <span className="markup-toolbar-docname">{documentName}</span>
    </div>
  );
}
