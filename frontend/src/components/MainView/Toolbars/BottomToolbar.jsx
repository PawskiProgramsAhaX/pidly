/**
 * BottomToolbar.jsx
 * 
 * Bottom toolbar with mode selection, zoom controls, rotation, and page navigation.
 * Positioned over the PDF container, centered accounting for panel width.
 */

export default function BottomToolbar({
  // Panel visibility (for positioning)
  openPanelWidth = 0,
  // Mode state
  selectMode,
  panMode,
  zoomMode,
  onSelectMode,
  onPanMode,
  onZoomMode,
  // Zoom controls
  zoomInput,
  onZoomInputChange,
  onZoomIn,
  onZoomOut,
  onApplyZoomInput,
  // Rotation
  onRotate,
  // Page navigation
  currentPage,
  numPages,
  pageInput,
  onPageInputChange,
  onPageInputFocus,
  onPageInputBlur,
  onPageInputKeyDown,
  onPreviousPage,
  onNextPage,
  // File navigation
  allFiles,
  currentFileIndex,
  onNavigateFile,
  currentFolderFileIndex,
  currentFolderInfo,
  // View mode
  viewMode,
  containerRef,
  // Refresh
  onRefresh
}) {
  const canGoPrevPage = currentPage > 1 || (onNavigateFile && allFiles?.length > 1 && currentFileIndex > 0);
  const canGoNextPage = currentPage < numPages || (onNavigateFile && allFiles?.length > 1 && currentFileIndex < allFiles.length - 1);

  return (
    <div 
      className="pdf-toolbar pdf-toolbar-bottom"
      style={{
        left: openPanelWidth > 0 ? `calc((100% - ${openPanelWidth}px) / 2)` : '50%',
        transform: 'translateX(-50%)'
      }}
    >
      {/* Mode buttons */}
      <div className="toolbar-group toolbar-mode-buttons">
        <button 
          onClick={onSelectMode}
          className={selectMode && !panMode && !zoomMode ? 'active' : ''}
          title="Select (V)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
            <path d="M13 13l6 6"/>
          </svg>
        </button>
        
        <button 
          onClick={onPanMode}
          className={panMode ? 'active' : ''}
          title="Pan (Shift+V)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/>
            <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/>
            <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/>
            <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
          </svg>
        </button>
        
        <button 
          onClick={onZoomMode}
          className={zoomMode ? 'active' : ''}
          title="Zoom (Z)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="11" y1="8" x2="11" y2="14"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
      </div>
      
      <div className="toolbar-divider" />
      
      {/* Zoom controls */}
      <div className="toolbar-group">
        <button onClick={onZoomOut} title="Zoom out" style={{ color: 'white', fontSize: '18px', fontWeight: 'bold', padding: '2px 8px' }}>−</button>
        <input 
          type="text" 
          className="zoom-input"
          value={zoomInput}
          onChange={(e) => onZoomInputChange(e.target.value)}
          onBlur={onApplyZoomInput}
          onKeyDown={(e) => e.key === 'Enter' && onApplyZoomInput()}
          style={{ border: 'none', background: 'transparent', color: 'white', textAlign: 'center', width: '50px', outline: 'none' }}
        />
        <button onClick={onZoomIn} title="Zoom in" style={{ color: 'white', fontSize: '18px', fontWeight: 'bold', padding: '2px 8px' }}>+</button>
      </div>
      
      <div className="toolbar-divider" />
      
      {/* Rotation */}
      <div className="toolbar-group">
        <button onClick={onRotate} title="Rotate" style={{ color: 'white' }}>↻</button>
      </div>
      
      <div className="toolbar-divider" />
      
      {/* Page navigation */}
      <div className="toolbar-group" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <button 
          onClick={onPreviousPage} 
          disabled={!canGoPrevPage} 
          title={currentPage <= 1 && allFiles?.length > 1 ? "Previous Document" : "Previous Page"}
          style={{ color: 'white', opacity: canGoPrevPage ? 1 : 0.4 }}
        >◀</button>
        
        {/* Page Input */}
        {numPages > 1 ? (
          <span className="page-info" style={{ display: 'inline-flex', alignItems: 'baseline', justifyContent: 'center', color: 'white', fontSize: '12px', fontFamily: 'inherit' }}>
            <input
              type="text"
              value={pageInput !== null ? pageInput : (viewMode === 'sideBySide' ? `${currentPage}-${Math.min(currentPage + 1, numPages)}` : currentPage)}
              onChange={(e) => onPageInputChange(e.target.value)}
              onFocus={onPageInputFocus}
              onBlur={onPageInputBlur}
              onKeyDown={onPageInputKeyDown}
              style={{
                width: `${String(numPages).length}ch`,
                textAlign: 'right',
                background: 'transparent',
                border: 'none',
                color: 'white',
                padding: 0,
                margin: 0,
                fontSize: 'inherit',
                fontFamily: 'inherit',
                outline: 'none',
                lineHeight: 1
              }}
            />
            <span style={{ color: 'rgba(255,255,255,0.6)', margin: '0 1px' }}>/</span>
            <span style={{ lineHeight: 1 }}>{numPages}</span>
          </span>
        ) : (
          <span className="page-info" style={{ color: 'white', fontSize: '12px' }}>
            {currentFolderFileIndex + 1}/{currentFolderInfo.folderFileCount || 1}
          </span>
        )}
        
        <button 
          onClick={onNextPage} 
          disabled={!canGoNextPage} 
          title={currentPage >= numPages && allFiles?.length > 1 ? "Next Document" : "Next Page"}
          style={{ color: 'white', opacity: canGoNextPage ? 1 : 0.4 }}
        >▶</button>
      </div>
      
      {/* View mode indicator */}
      {numPages > 1 && viewMode !== 'single' && (
        <>
          <div className="toolbar-divider" />
          <div className="toolbar-group">
            <span 
              className="view-mode-indicator" 
              title={viewMode === 'continuous' ? 'Continuous Vertical View' : 'Side by Side View'}
              style={{ color: 'white' }}
            >
              {viewMode === 'continuous' ? '∥' : '⊞'}
            </span>
          </div>
        </>
      )}
      
      <div className="toolbar-divider" />
      
      {/* Refresh */}
      <div className="toolbar-group">
        <button onClick={onRefresh} title="Refresh data" style={{ color: 'white' }}>⟳</button>
      </div>
    </div>
  );
}
