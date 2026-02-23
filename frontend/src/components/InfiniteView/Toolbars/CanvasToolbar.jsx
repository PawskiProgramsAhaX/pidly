/**
 * CanvasToolbar.jsx
 * 
 * Bottom toolbar for the infinite canvas: tool selection, zoom controls, fit-all, refresh.
 * Extracted from InfiniteView for maintainability.
 */
import React from 'react';

const btnStyle = (isActive, isDisabled) => ({
  padding: '6px 10px',
  fontSize: 14,
  minWidth: 32,
  background: 'transparent',
  border: 'none',
  borderRadius: 6,
  color: isDisabled ? '#555' : isActive ? '#3498db' : '#fff',
  cursor: isDisabled ? 'not-allowed' : 'pointer',
  outline: 'none',
  opacity: isDisabled ? 0.35 : 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

export default function CanvasToolbar({
  currentTool,
  setCurrentTool,
  zoom,
  setZoom,
  onZoomToFitAll,
  onRefresh,
  viewLocked,
}) {
  return (
    <div className="infinite-toolbar-bottom">
      <div className="toolbar-group">
        <button 
          onClick={() => setCurrentTool('select')}
          style={btnStyle(currentTool === 'select')}
          title="Select (V) — Drag on canvas to box-select"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
            <path d="M13 13l6 6"/>
          </svg>
        </button>
        <button 
          onClick={() => setCurrentTool('pan')}
          style={btnStyle(currentTool === 'pan')}
          title="Pan View (Shift+V)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/>
            <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/>
            <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/>
            <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
          </svg>
        </button>
        <button 
          onClick={() => setCurrentTool('zoom')}
          style={btnStyle(currentTool === 'zoom')}
          title="Zoom Tool (Z) — Drag to zoom to area"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="11" y1="8" x2="11" y2="14"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
      </div>
      
      <div className="toolbar-divider" />
      
      <div className="toolbar-group">
        <button onClick={() => setZoom(prev => Math.max(0.05, prev / 1.4))} style={btnStyle(false)} title="Zoom out">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
        <span className="zoom-value">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(prev => Math.min(10, prev * 1.4))} style={btnStyle(false)} title="Zoom in">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>
      
      <div className="toolbar-divider" />
      
      <div className="toolbar-group">
        <button 
          onClick={() => { if (!viewLocked) setCurrentTool('move'); }}
          style={btnStyle(currentTool === 'move', viewLocked)}
          title={viewLocked ? "Move Pages — disabled (view locked)" : "Move Pages (M)"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="5 9 2 12 5 15"/>
            <polyline points="9 5 12 2 15 5"/>
            <polyline points="15 19 12 22 9 19"/>
            <polyline points="19 9 22 12 19 15"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <line x1="12" y1="2" x2="12" y2="22"/>
          </svg>
        </button>
        <button onClick={onZoomToFitAll} style={btnStyle(false)} title="Fit all documents">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 3h6v6"/>
            <path d="M9 21H3v-6"/>
            <path d="M21 3l-7 7"/>
            <path d="M3 21l7-7"/>
          </svg>
        </button>
      </div>
      
      <div className="toolbar-divider" />
      
      <div className="toolbar-group">
        <button onClick={onRefresh} style={btnStyle(false)} title="Refresh">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="23 4 23 10 17 10"/>
            <polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
      </div>
      
      {viewLocked && (
        <>
          <div className="toolbar-divider" />
          <div className="toolbar-group" style={{ color: '#e67e22', fontSize: 11, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4, padding: '0 4px' }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <circle cx="8" cy="10.5" r="1" fill="currentColor"/>
            </svg>
            Locked
          </div>
        </>
      )}
    </div>
  );
}
