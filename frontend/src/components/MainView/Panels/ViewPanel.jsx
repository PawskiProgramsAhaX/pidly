/**
 * ViewPanel.jsx
 * 
 * Panel for controlling view mode settings - page layout and view preferences.
 */

import { useState, useMemo } from 'react';

export default function ViewPanel({
  isOpen,
  onClose,
  viewMode,
  onViewModeChange,
  numPages,
  currentFile,
  currentPage,
  onOpenInfiniteView,
  pdfBackgroundColor,
  onBackgroundColorChange,
  showMarkupToolbar,
  onShowMarkupToolbarChange,
  hideLabels,
  onHideLabelsChange,
  onOpenZoomSettings,
  // Links visibility
  showLinksOnPdf,
  onShowLinksOnPdfChange,
  // Class/Region filters
  showRegionBoxes,
  onShowRegionBoxesChange,
  hiddenClasses,
  onHiddenClassesChange,
  uniqueObjectClasses,
}) {
  const [showContinuousOptions, setShowContinuousOptions] = useState(false);
  const [classSearch, setClassSearch] = useState('');

  const filteredClasses = useMemo(() => {
    if (!uniqueObjectClasses) return [];
    if (!classSearch.trim()) return uniqueObjectClasses;
    const q = classSearch.toLowerCase().trim();
    return uniqueObjectClasses.filter(cls => cls.toLowerCase().includes(q));
  }, [uniqueObjectClasses, classSearch]);

  if (!isOpen) return null;

  return (
    <div className="smart-links-panel">
      <div className="panel-header">
        <h3>View</h3>
        <button className="close-panel" onClick={onClose}>×</button>
      </div>
      <div className="panel-content">

        {/* Zoom & Navigation settings button */}
        {onOpenZoomSettings && (
          <div className="panel-section">
            <button className="pdfv-zoom-settings-btn" onClick={onOpenZoomSettings}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              Zoom &amp; Navigation
            </button>
          </div>
        )}

        <div className="panel-section">
          <h4>Page Layout</h4>
          <div className="view-mode-options-simple">
            <label 
              className={`view-mode-option-simple ${viewMode === 'single' ? 'selected' : ''}`}
              onClick={() => { onViewModeChange('single'); setShowContinuousOptions(false); }}
            >
              <input type="radio" name="viewMode" checked={viewMode === 'single'} onChange={() => {}} />
              <span>Single Page</span>
            </label>
            
            <label 
              className={`view-mode-option-simple ${(viewMode === 'continuous' || viewMode === 'sideBySide') ? 'selected' : ''} ${numPages <= 1 ? 'disabled' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                if (numPages > 1) setShowContinuousOptions(!showContinuousOptions);
              }}
            >
              <input type="radio" name="viewMode" checked={viewMode === 'continuous' || viewMode === 'sideBySide'} onChange={() => {}} disabled={numPages <= 1} />
              <span>Continuous</span>
              {numPages > 1 && (
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ marginLeft: 'auto', transform: showContinuousOptions ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                  <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </label>
            
            {showContinuousOptions && (
              <div className="continuous-sub-options">
                <label className={`view-mode-sub-option ${viewMode === 'continuous' ? 'selected' : ''}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onViewModeChange('continuous'); }}>
                  <input type="radio" name="continuousMode" checked={viewMode === 'continuous'} onChange={() => {}} />
                  <span>Vertical</span>
                </label>
                <label className={`view-mode-sub-option ${viewMode === 'sideBySide' ? 'selected' : ''}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onViewModeChange('sideBySide'); }}>
                  <input type="radio" name="continuousMode" checked={viewMode === 'sideBySide'} onChange={() => {}} />
                  <span>Horizontal</span>
                </label>
              </div>
            )}
            
            <label className="view-mode-option-simple" onClick={() => { if (onOpenInfiniteView) { onClose(); onOpenInfiniteView(currentFile, currentPage); } }}>
              <input type="radio" name="viewMode" checked={false} onChange={() => {}} />
              <span>Infinite Canvas</span>
            </label>
          </div>
          
          {numPages <= 1 && (
            <p className="view-mode-tip-small">Continuous view requires multi-page documents.</p>
          )}
        </div>

        {/* Toolbar */}
        <div className="panel-section">
          <label className="vp-check-row">
            <input 
              type="checkbox" 
              checked={showMarkupToolbar}
              onChange={(e) => onShowMarkupToolbarChange(e.target.checked)}
            />
            <span>Show Markup Toolbar</span>
          </label>
        </div>

        {/* Links */}
        {onShowLinksOnPdfChange && (
          <div className="panel-section">
            <label className="vp-check-row">
              <input 
                type="checkbox" 
                checked={showLinksOnPdf}
                onChange={(e) => onShowLinksOnPdfChange(e.target.checked)}
              />
              <span>Show Links on Document</span>
            </label>
          </div>
        )}

        {/* Objects & Regions */}
        {onHiddenClassesChange && (
          <div className="panel-section">
            <h4>Objects &amp; Regions</h4>
            <label className="vp-check-row">
              <input
                type="checkbox"
                checked={!hideLabels}
                onChange={(e) => onHideLabelsChange(!e.target.checked)}
              />
              <span>Show Labels on Boxes</span>
            </label>
            <label className="vp-check-row">
              <input
                type="checkbox"
                checked={showRegionBoxes}
                onChange={(e) => onShowRegionBoxesChange(e.target.checked)}
              />
              <span>Show Regions</span>
            </label>

            {uniqueObjectClasses && uniqueObjectClasses.length > 0 && (
              <>
                <div className="vp-class-header">
                  <span className="vp-class-count">
                    {uniqueObjectClasses.length - hiddenClasses.length}/{uniqueObjectClasses.length} visible
                  </span>
                  <div className="vp-class-actions">
                    <button onClick={() => onHiddenClassesChange([])}>All</button>
                    <button onClick={() => onHiddenClassesChange(uniqueObjectClasses)}>None</button>
                  </div>
                </div>
                {uniqueObjectClasses.length > 6 && (
                  <input
                    type="text"
                    className="vp-class-search"
                    placeholder="Search classes..."
                    value={classSearch}
                    onChange={(e) => setClassSearch(e.target.value)}
                  />
                )}
                <div className="vp-class-list">
                  {filteredClasses.map(cls => (
                    <label key={cls} className="vp-check-row">
                      <input
                        type="checkbox"
                        checked={!hiddenClasses.includes(cls)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            onHiddenClassesChange(hiddenClasses.filter(c => c !== cls));
                          } else {
                            onHiddenClassesChange([...hiddenClasses, cls]);
                          }
                        }}
                      />
                      <span>{cls}</span>
                    </label>
                  ))}
                  {filteredClasses.length === 0 && classSearch && (
                    <p style={{ fontSize: 11, color: '#666', margin: '6px 0 0', padding: 0 }}>No matches</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Background Colour */}
        <div className="panel-section">
          <div className="vp-bg-row">
            <label>Background Colour</label>
            <input 
              type="color" 
              value={pdfBackgroundColor}
              onChange={(e) => onBackgroundColorChange(e.target.value)}
              className="color-input-small"
            />
          </div>
        </div>

      </div>
    </div>
  );
}
