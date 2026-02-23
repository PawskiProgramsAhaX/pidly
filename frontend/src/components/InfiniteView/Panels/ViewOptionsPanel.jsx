/**
 * ViewOptionsPanel.jsx
 * 
 * Right-side panel for view settings.
 * Sections: Zoom & Nav, Objects, Links, Markups, Display, Background
 */
import React, { useState, useMemo } from 'react';

const BG_MODES = [
  { key: 'grid',  label: 'Grid',  icon: '⊞' },
  { key: 'stars', label: 'Stars', icon: '✦' },
  { key: 'blank', label: 'Blank', icon: '◻' },
];

export default function ViewOptionsPanel({
  // Objects
  showObjects,
  setShowObjects,
  showObjectTags,
  setShowObjectTags,
  availableClasses = [],
  hiddenClasses,
  setHiddenClasses,
  // Links
  showLinks,
  setShowLinks,
  // Markups
  showMarkupsToolbar,
  setShowMarkupsToolbar,
  // Display
  cropRegion,
  cropEnabled,
  setCropEnabled,
  isDrawingCrop,
  onStartCropDraw,
  onClearCrop,
  showShadows,
  setShowShadows,
  // Zoom settings
  onOpenZoomSettings,
  // Background
  backgroundStyle,
  setBackgroundStyle,
  bgColors,
  setBgColors,
  // Panel
  onClose,
}) {
  const [classSearch, setClassSearch] = useState('');

  const filteredClasses = useMemo(() => {
    if (!classSearch.trim()) return availableClasses;
    const q = classSearch.toLowerCase();
    return availableClasses.filter(c => c.toLowerCase().includes(q));
  }, [availableClasses, classSearch]);

  const visibleCount = availableClasses.filter(c => !hiddenClasses.has(c)).length;
  const allVisible = availableClasses.length > 0 && visibleCount === availableClasses.length;
  const noneVisible = availableClasses.length > 0 && visibleCount === 0;

  const handleColorChange = (mode, color) => {
    setBgColors(prev => ({ ...prev, [mode]: color }));
  };

  return (
    <div className="view-options-sidebar">
      <div className="panel-header">
        <h3>Options</h3>
        <button className="close-panel" onClick={onClose}>×</button>
      </div>
      <div className="panel-content">

        {/* Zoom & Navigation */}
        <div className="panel-section">
          <button className="iv-zoom-settings-btn" onClick={onOpenZoomSettings}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            Zoom &amp; Navigation
          </button>
        </div>

        <div className="panel-divider" />

        {/* ── Objects ── */}
        <div className="panel-section">
          <h4>Objects</h4>
          <label className="view-option-toggle">
            <input
              type="checkbox"
              checked={showObjectTags}
              onChange={(e) => setShowObjectTags(e.target.checked)}
            />
            <span>Show object tags</span>
          </label>

          {/* Class visibility list */}
          {availableClasses.length > 0 && (
            <div className="iv-class-filter">
              <div className="iv-class-filter-header">
                <span className="iv-class-filter-title">Object Classes</span>
                <span className="iv-class-filter-count">{visibleCount}/{availableClasses.length} visible</span>
              </div>
              <div className="iv-class-filter-toolbar">
                <button
                  className={`iv-class-bulk-btn ${allVisible ? 'active' : ''}`}
                  onClick={() => setHiddenClasses(new Set())}
                  disabled={allVisible}
                >Show All</button>
                <button
                  className={`iv-class-bulk-btn ${noneVisible ? 'active' : ''}`}
                  onClick={() => setHiddenClasses(new Set(availableClasses))}
                  disabled={noneVisible}
                >Hide All</button>
              </div>
              {availableClasses.length > 8 && (
                <div className="iv-class-search">
                  <input
                    type="text"
                    placeholder="Search classes..."
                    value={classSearch}
                    onChange={(e) => setClassSearch(e.target.value)}
                  />
                  {classSearch && (
                    <button className="iv-class-search-clear" onClick={() => setClassSearch('')}>×</button>
                  )}
                </div>
              )}
              <div className="iv-class-list">
                {filteredClasses.length === 0 ? (
                  <div className="iv-class-empty">No matches</div>
                ) : (
                  filteredClasses.map(className => (
                    <label key={className} className="iv-class-item">
                      <input
                        type="checkbox"
                        checked={!hiddenClasses.has(className)}
                        onChange={(e) => {
                          const next = new Set(hiddenClasses);
                          if (e.target.checked) next.delete(className);
                          else next.add(className);
                          setHiddenClasses(next);
                        }}
                      />
                      <span className="iv-class-name">{className}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="panel-divider" />

        {/* ── Links ── */}
        <div className="panel-section">
          <h4>Links</h4>
          <label className="view-option-toggle">
            <input
              type="checkbox"
              checked={showLinks}
              onChange={(e) => setShowLinks(e.target.checked)}
            />
            <span>Show links</span>
          </label>
        </div>

        <div className="panel-divider" />

        {/* ── Markups ── */}
        <div className="panel-section">
          <h4>Markups</h4>
          <label className="view-option-toggle">
            <input
              type="checkbox"
              checked={showMarkupsToolbar}
              onChange={(e) => setShowMarkupsToolbar(e.target.checked)}
            />
            <span>Show markups toolbar</span>
          </label>
        </div>

        <div className="panel-divider" />

        {/* ── Display ── */}
        <div className="panel-section">
          <h4>Display</h4>
          <label className="view-option-toggle">
            <input
              type="checkbox"
              checked={showShadows}
              onChange={(e) => setShowShadows(e.target.checked)}
            />
            <span>Show borders &amp; shadows</span>
          </label>

          {/* Crop Region */}
          <div className="iv-crop-section">
            <span className="iv-crop-label">Crop Region</span>
            <p className="section-description">
              Select a region of the PDF to display. Useful for hiding headers, footers, or revision borders.
            </p>
            <div className="crop-controls">
              {!cropRegion ? (
                <>
                  <button 
                    className={`crop-action-btn ${isDrawingCrop ? 'active' : ''}`}
                    onClick={onStartCropDraw}
                  >
                    {isDrawingCrop ? 'Click and drag on a PDF...' : 'Draw Crop Region'}
                  </button>
                  {isDrawingCrop && (
                    <p className="crop-hint">
                      Click and drag on any PDF to select the region you want to show. Press Escape to cancel.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="crop-preview">
                    <div className="crop-preview-label">Current Crop:</div>
                    <div className="crop-preview-values">
                      X: {(cropRegion.x * 100).toFixed(1)}% | 
                      Y: {(cropRegion.y * 100).toFixed(1)}%<br/>
                      W: {(cropRegion.width * 100).toFixed(1)}% | 
                      H: {(cropRegion.height * 100).toFixed(1)}%
                    </div>
                  </div>
                  <label className="crop-toggle">
                    <input
                      type="checkbox"
                      checked={cropEnabled}
                      onChange={(e) => setCropEnabled(e.target.checked)}
                    />
                    <span>Apply crop to all PDFs</span>
                  </label>
                  <div className="crop-actions">
                    <button className="crop-action-btn secondary" onClick={onStartCropDraw}>Redraw</button>
                    <button className="crop-action-btn danger" onClick={onClearCrop}>🗑️ Clear</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="panel-divider" />

        {/* ── Background ── */}
        <div className="panel-section">
          <h4>Background</h4>
          <div className="bg-mode-options">
            {BG_MODES.map(({ key, label, icon }) => (
              <div
                key={key}
                className={`bg-mode-row ${backgroundStyle === key ? 'active' : ''}`}
                onClick={() => setBackgroundStyle(key)}
              >
                <div className="bg-mode-label">
                  <span className="bg-mode-icon">{icon}</span>
                  <span>{label}</span>
                </div>
                <input
                  type="color"
                  value={bgColors[key] || '#000000'}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => handleColorChange(key, e.target.value)}
                  className="bg-color-picker"
                  title={`${label} background color`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
