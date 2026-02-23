/**
 * InfiniteViewsPanel.jsx
 * 
 * Right-side panel for managing saved views, canvas shapes, and saved batches.
 */
import React, { useState, useRef, useMemo } from 'react';

export default function InfiniteViewsPanel({
  isOpen,
  onClose,
  // Canvas shapes
  canvasShapes,
  selectedCanvasShapeId,
  onUpdateShape,
  onDeleteShape,
  onSelectShape,
  onAddShape,
  onStartDrawPolyline,
  isDrawingPolyline,
  // Saved views
  savedViews = [],
  onSaveView,
  onLoadView,
  onDeleteView,
  onRenameView,
  // Saved batches
  savedBatches = [],
  onSaveBatch,
  onLoadBatch,
  onDeleteBatch,
  onRenameBatch,
  // Selection state for "save selection as batch"
  selectedSlotIds,
  selectedShapeIds,
  slots,
  // View lock
  viewLocked,
  onToggleViewLock,
}) {
  const [saveName, setSaveName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editingViewId, setEditingViewId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [viewSearch, setViewSearch] = useState('');
  const [confirmLoadViewId, setConfirmLoadViewId] = useState(null);

  const [batchSaveName, setBatchSaveName] = useState('');
  const [isSavingBatch, setIsSavingBatch] = useState(false);
  const [editingBatchId, setEditingBatchId] = useState(null);
  const [editingBatchName, setEditingBatchName] = useState('');
  const [confirmDeleteBatchId, setConfirmDeleteBatchId] = useState(null);
  const [batchSearch, setBatchSearch] = useState('');

  if (!isOpen) return null;

  const selectedShape = canvasShapes.find(s => s.id === selectedCanvasShapeId);
  const selSlotCount = selectedSlotIds?.size || 0;
  const selShapeCount = selectedShapeIds?.size || 0;
  const totalSelected = selSlotCount + selShapeCount;

  const filteredViews = viewSearch.trim()
    ? savedViews.filter(v => v.name.toLowerCase().includes(viewSearch.toLowerCase()))
    : savedViews;

  const filteredBatches = batchSearch.trim()
    ? savedBatches.filter(b => b.name.toLowerCase().includes(batchSearch.toLowerCase()))
    : savedBatches;

  // ─── Shape Tools ───────────────────────────────────────
  const shapeTools = [
    { type: 'rectangle', label: 'Rectangle', icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    )},
    { type: 'circle', label: 'Circle', icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    )},
    { type: 'arrow', label: 'Arrow', icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M3 13L13 3M13 3H7M13 3V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )},
    { type: 'line', label: 'Line', icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <line x1="2" y1="13" x2="14" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    )},
    { type: 'polyline', label: 'Polyline', icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <polyline points="2,12 6,4 10,10 14,3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )},
    { type: 'text', label: 'Text', icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M4 4H12M8 4V12M6 12H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    )},
  ];

  const updateProp = (prop, value) => {
    if (!selectedShape) return;
    onUpdateShape(selectedShape.id, { [prop]: value });
  };

  const handleSaveView = () => {
    if (!saveName.trim()) return;
    onSaveView(saveName.trim());
    setSaveName('');
    setIsSaving(false);
  };

  const handleRename = (viewId) => {
    if (!editingName.trim()) return;
    onRenameView(viewId, editingName.trim());
    setEditingViewId(null);
    setEditingName('');
  };

  const handleSaveBatch = () => {
    if (!batchSaveName.trim() || totalSelected === 0) return;
    onSaveBatch(batchSaveName.trim());
    setBatchSaveName('');
    setIsSavingBatch(false);
  };

  const handleRenameBatch = (batchId) => {
    if (!editingBatchName.trim()) return;
    onRenameBatch(batchId, editingBatchName.trim());
    setEditingBatchId(null);
    setEditingBatchName('');
  };

  // ─── Inline style helpers ──────────────────────────────
  const inputStyle = {
    width: '100%', padding: '6px 8px', borderRadius: 4,
    border: '1px solid #333', background: '#111', color: '#fff', fontSize: 12,
    outline: 'none', boxSizing: 'border-box',
  };
  const selectStyle = {
    padding: '4px 6px', borderRadius: 4, border: '1px solid #333',
    background: '#111', color: '#ccc', fontSize: 11, cursor: 'pointer',
    outline: 'none',
  };
  const labelStyle = { fontSize: 11, color: '#999', display: 'block', marginBottom: 3 };
  const cardStyle = {
    padding: '10px 12px', borderRadius: 6,
    border: '1px solid #333', background: 'transparent',
    transition: 'background 0.15s',
  };
  const sectionScrollStyle = {
    maxHeight: 220, overflowY: 'auto', overflowX: 'hidden',
    marginBottom: 8, paddingRight: 2,
  };

  return (
    <div className="smart-links-panel right-panel">
      {/* Header */}
      <div className="panel-header" style={{ padding: '12px 16px', borderBottom: '1px solid #333' }}>
        <span style={{ fontWeight: 600, fontSize: '14px', color: '#fff' }}>Views & Batches</span>
        <button onClick={onClose} className="close-panel">×</button>
      </div>

      <div className="panel-content" style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>

        {/* ═══ Current View Lock ═══ */}
        <div className="iv-vp-section">
          <h4 className="iv-vp-heading">Current View</h4>
          <button
            onClick={onToggleViewLock}
            className={`iv-vp-lock-btn ${viewLocked ? 'locked' : ''}`}
            title={viewLocked
              ? 'View is locked — click to unlock'
              : 'Lock view to prevent changes'}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              {viewLocked ? (
                <>
                  <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <circle cx="8" cy="10.5" r="1" fill="currentColor"/>
                </>
              ) : (
                <>
                  <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M5.5 7V5a2.5 2.5 0 015 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </>
              )}
            </svg>
            {viewLocked ? 'View Locked' : 'Lock View'}
          </button>
          {viewLocked && (
            <div style={{ fontSize: 10, color: '#888', marginTop: 5, textAlign: 'center', lineHeight: 1.4 }}>
              Adding, removing, and moving documents &amp; shapes is disabled
            </div>
          )}
        </div>

        {/* ═══ Canvas Shapes Section ═══ */}
        <div className="iv-vp-section" style={{ opacity: viewLocked ? 0.45 : 1, transition: 'opacity 0.2s' }}>
          <h4 className="iv-vp-heading">Canvas Shapes</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, pointerEvents: viewLocked ? 'none' : 'auto' }}>
            {shapeTools.map(tool => {
              const isPolyline = tool.type === 'polyline';
              const isActive = isPolyline && isDrawingPolyline && !viewLocked;
              return (
              <div
                key={tool.type}
                draggable={!isPolyline}
                onDragStart={(e) => {
                  if (isPolyline) { e.preventDefault(); return; }
                  e.dataTransfer.setData('application/iv-shape', JSON.stringify({ type: tool.type }));
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => {
                  if (isPolyline) {
                    if (onStartDrawPolyline) onStartDrawPolyline();
                  } else {
                    if (onAddShape) onAddShape(tool.type);
                  }
                }}
                className={`iv-vp-shape-btn ${isActive ? 'active' : ''}`}
              >
                {tool.icon}
                {tool.label}
              </div>
              );
            })}
          </div>
          <div style={{ fontSize: 10, color: '#555', marginTop: 6, textAlign: 'center' }}>
            {isDrawingPolyline
              ? <span style={{ color: '#3498db' }}>Click to place points · Double-click to finish · Esc to cancel</span>
              : 'Click to add · Drag onto canvas · Shift snaps angles'
            }
          </div>
        </div>

        {/* ═══ Selected Shape Properties ═══ */}
        {selectedShape && (() => {
          const isLinear = selectedShape.type === 'arrow' || selectedShape.type === 'line' || selectedShape.type === 'polyline';
          const hasFill = !isLinear;
          const hasText = selectedShape.type === 'text';
          return (
          <div className="iv-vp-section" style={{
            padding: 10, background: '#1a1a1a', borderRadius: 8, border: '1px solid #333',
            opacity: viewLocked ? 0.5 : 1, pointerEvents: viewLocked ? 'none' : 'auto', transition: 'opacity 0.2s',
          }}>
            <h4 className="iv-vp-heading" style={{ marginBottom: 10 }}>
              {selectedShape.type === 'text' ? 'Text Box' : selectedShape.type.charAt(0).toUpperCase() + selectedShape.type.slice(1)} Properties
            </h4>

            {/* Title */}
            <div style={{ marginBottom: 8 }}>
              <label style={labelStyle}>Title</label>
              <input type="text" placeholder="Add a title..." value={selectedShape.title || ''}
                onChange={e => updateProp('title', e.target.value)} style={inputStyle} />
            </div>

            {/* Text content */}
            {hasText && (
              <div style={{ marginBottom: 8 }}>
                <label style={labelStyle}>Content</label>
                <textarea value={selectedShape.text || ''} onChange={e => updateProp('text', e.target.value)} rows={2}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
            )}

            {/* Fill & Border row */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
              {hasFill && (
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>{hasText ? 'Background' : 'Fill'}</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="color" value={selectedShape.fillColor && selectedShape.fillColor !== 'none' ? selectedShape.fillColor : '#3498db'}
                      onChange={e => updateProp('fillColor', e.target.value)}
                      style={{ width: 26, height: 26, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} />
                    <input type="number" min="0" max="100" value={selectedShape.fillOpacity ?? 15}
                      onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n)) updateProp('fillOpacity', Math.max(0, Math.min(100, n))); }}
                      style={{ ...selectStyle, width: 52, textAlign: 'center' }} /><span style={{ fontSize: 10, color: '#888' }}>%</span>
                  </div>
                </div>
              )}
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>{isLinear ? 'Color' : 'Border'}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="color" value={selectedShape.borderColor || '#3498db'}
                    onChange={e => updateProp('borderColor', e.target.value)}
                    style={{ width: 26, height: 26, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} />
                  <input type="number" min="0" max="50" value={selectedShape.borderWidth ?? 2}
                    onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n)) updateProp('borderWidth', Math.max(0, Math.min(50, n))); }}
                    style={{ ...selectStyle, width: 52, textAlign: 'center' }} /><span style={{ fontSize: 10, color: '#888' }}>px</span>
                </div>
              </div>
            </div>

            {/* Line style */}
            <div style={{ marginBottom: 8 }}>
              <label style={labelStyle}>Style</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {[['solid','━'],['dashed','╌'],['dotted','┄']].map(([s, sym]) => (
                  <button key={s} onClick={() => updateProp('borderStyle', s)}
                    className={`iv-vp-style-btn ${(selectedShape.borderStyle || 'solid') === s ? 'active' : ''}`}>
                    {sym}
                  </button>
                ))}
              </div>
            </div>

            {/* Text-specific */}
            {hasText && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Text Color</label>
                  <input type="color" value={selectedShape.textColor || '#ffffff'}
                    onChange={e => updateProp('textColor', e.target.value)}
                    style={{ width: 26, height: 26, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Font Size</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="number" min="1" max="200" value={selectedShape.fontSize || 18}
                      onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n)) updateProp('fontSize', Math.max(1, Math.min(200, n))); }}
                      style={{ ...selectStyle, width: 52, textAlign: 'center' }} /><span style={{ fontSize: 10, color: '#888' }}>px</span>
                  </div>
                </div>
              </div>
            )}

            {selectedShape.type === 'polyline' && (
              <div style={{ fontSize: 10, color: '#666', fontStyle: 'italic', marginBottom: 4 }}>
                Double-click a segment midpoint to add a point
              </div>
            )}
            <button onClick={() => onDeleteShape(selectedShape.id)} className="iv-vp-delete-btn">
              Delete Shape
            </button>
          </div>
          );
        })()}

        {/* ═══ Saved Batches Section ═══ */}
        <div className="iv-vp-section">
          <h4 className="iv-vp-heading">Saved Batches</h4>

          {/* Search */}
          {savedBatches.length > 2 && (
            <div className="iv-vp-search">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ color: '#555', flexShrink: 0 }}>
                <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M10 10L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <input type="text" placeholder="Search batches..." value={batchSearch}
                onChange={e => setBatchSearch(e.target.value)} />
              {batchSearch && <button onClick={() => setBatchSearch('')}>×</button>}
            </div>
          )}

          <div style={sectionScrollStyle}>
            {filteredBatches.length === 0 && !isSavingBatch && (
              <div className="iv-vp-empty">{batchSearch ? 'No matching batches' : 'No saved batches yet'}</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredBatches.map(batch => {
                const slotCount = (batch.items || []).filter(i => i.type === 'slot').length;
                const shapeCount = (batch.items || []).filter(i => i.type === 'shape').length;
                return (
                  <div key={batch.id} draggable={!viewLocked}
                    onDragStart={(e) => {
                      if (viewLocked) { e.preventDefault(); return; }
                      e.dataTransfer.setData('application/iv-batch', JSON.stringify({ batchId: batch.id }));
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    className="iv-vp-card"
                  >
                    <div className="iv-vp-card-header">
                      {editingBatchId === batch.id ? (
                        <input autoFocus value={editingBatchName}
                          onChange={e => setEditingBatchName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleRenameBatch(batch.id); if (e.key === 'Escape') { setEditingBatchId(null); setEditingBatchName(''); } }}
                          onBlur={() => handleRenameBatch(batch.id)}
                          onClick={e => e.stopPropagation()}
                          className="iv-vp-rename-input" />
                      ) : (
                        <span className="iv-vp-card-name" onDoubleClick={() => { setEditingBatchId(batch.id); setEditingBatchName(batch.name); }}>
                          {batch.name}
                        </span>
                      )}
                      <div className="iv-vp-card-actions">
                        <button onClick={(e) => { e.stopPropagation(); setEditingBatchId(batch.id); setEditingBatchName(batch.name); }} title="Rename">✏️</button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirmDeleteBatchId === batch.id) { onDeleteBatch(batch.id); setConfirmDeleteBatchId(null); }
                            else { setConfirmDeleteBatchId(batch.id); setTimeout(() => setConfirmDeleteBatchId(null), 3000); }
                          }}
                          title={confirmDeleteBatchId === batch.id ? 'Click again to confirm' : 'Delete'}
                          style={{ color: confirmDeleteBatchId === batch.id ? '#e74c3c' : undefined }}
                        >{confirmDeleteBatchId === batch.id ? '⚠️' : '🗑️'}</button>
                      </div>
                    </div>
                    <div className="iv-vp-card-meta">
                      <span>{slotCount} doc{slotCount !== 1 ? 's' : ''}</span>
                      {shapeCount > 0 && <span>{shapeCount} shape{shapeCount !== 1 ? 's' : ''}</span>}
                      <span>·</span>
                      <span>{new Date(batch.createdDate).toLocaleDateString()}</span>
                    </div>
                    <button className="iv-vp-action-btn"
                      onClick={(e) => { e.stopPropagation(); if (!viewLocked) onLoadBatch(batch.id); }}
                      disabled={viewLocked}
                    >Add to Canvas</button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Save selection as batch */}
          {isSavingBatch ? (
            <div className="iv-vp-save-row">
              <input autoFocus placeholder="Batch name..." value={batchSaveName}
                onChange={e => setBatchSaveName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveBatch(); if (e.key === 'Escape') { setIsSavingBatch(false); setBatchSaveName(''); } }}
                style={inputStyle} />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button onClick={handleSaveBatch} disabled={!batchSaveName.trim() || totalSelected === 0}
                  className="iv-vp-action-btn" style={{ flex: 1 }}>Save</button>
                <button onClick={() => { setIsSavingBatch(false); setBatchSaveName(''); }}
                  className="iv-vp-cancel-btn">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setIsSavingBatch(true)} disabled={totalSelected === 0}
              className="iv-vp-dashed-btn" style={{ opacity: totalSelected === 0 ? 0.4 : 1 }}>
              {totalSelected > 0
                ? `Save Selection as Batch (${selSlotCount} doc${selSlotCount !== 1 ? 's' : ''}${selShapeCount > 0 ? ` + ${selShapeCount} shape${selShapeCount !== 1 ? 's' : ''}` : ''})`
                : 'Select items to save as batch'
              }
            </button>
          )}
        </div>

        {/* ═══ Saved Views Section ═══ */}
        <div className="iv-vp-section">
          <h4 className="iv-vp-heading">Saved Views</h4>

          {/* Search */}
          {savedViews.length > 2 && (
            <div className="iv-vp-search">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ color: '#555', flexShrink: 0 }}>
                <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M10 10L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <input type="text" placeholder="Search views..." value={viewSearch}
                onChange={e => setViewSearch(e.target.value)} />
              {viewSearch && <button onClick={() => setViewSearch('')}>×</button>}
            </div>
          )}

          <div style={sectionScrollStyle}>
            {filteredViews.length === 0 && !isSaving && (
              <div className="iv-vp-empty">{viewSearch ? 'No matching views' : 'No saved views yet'}</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredViews.map(view => (
                <div key={view.id} className="iv-vp-card">
                  <div className="iv-vp-card-header">
                    {editingViewId === view.id ? (
                      <input autoFocus value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRename(view.id); if (e.key === 'Escape') { setEditingViewId(null); setEditingName(''); } }}
                        onBlur={() => handleRename(view.id)}
                        className="iv-vp-rename-input" />
                    ) : (
                      <span className="iv-vp-card-name" onDoubleClick={() => { setEditingViewId(view.id); setEditingName(view.name); }}>
                        {view.name}
                      </span>
                    )}
                    <div className="iv-vp-card-actions">
                      <button onClick={(e) => { e.stopPropagation(); setEditingViewId(view.id); setEditingName(view.name); }} title="Rename">✏️</button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirmDeleteId === view.id) { onDeleteView(view.id); setConfirmDeleteId(null); }
                          else { setConfirmDeleteId(view.id); setTimeout(() => setConfirmDeleteId(null), 3000); }
                        }}
                        title={confirmDeleteId === view.id ? 'Click again to confirm' : 'Delete'}
                        style={{ color: confirmDeleteId === view.id ? '#e74c3c' : undefined }}
                      >{confirmDeleteId === view.id ? '⚠️' : '🗑️'}</button>
                    </div>
                  </div>
                  <div className="iv-vp-card-meta">
                    <span>{view.slotCount || 0} doc{(view.slotCount || 0) !== 1 ? 's' : ''}</span>
                    {(view.shapeCount || 0) > 0 && <span>{view.shapeCount} shape{view.shapeCount !== 1 ? 's' : ''}</span>}
                    <span>·</span>
                    <span>{new Date(view.createdDate).toLocaleDateString()}</span>
                  </div>

                  {/* Load with confirmation */}
                  {confirmLoadViewId === view.id ? (
                    <div className="iv-vp-confirm">
                      <div style={{ fontSize: 11, color: '#ccc', marginBottom: 6, lineHeight: 1.4 }}>
                        This will replace your current canvas. Unsaved changes will be lost.
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="iv-vp-action-btn danger" style={{ flex: 1 }}
                          onClick={(e) => { e.stopPropagation(); onLoadView(view.id); setConfirmLoadViewId(null); }}>
                          Replace Current View
                        </button>
                        <button className="iv-vp-cancel-btn"
                          onClick={(e) => { e.stopPropagation(); setConfirmLoadViewId(null); }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button className="iv-vp-action-btn" style={{ marginTop: 6 }}
                      onClick={(e) => { e.stopPropagation(); setConfirmLoadViewId(view.id); }}>
                      Load View
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Save current view */}
          {isSaving ? (
            <div className="iv-vp-save-row">
              <input autoFocus placeholder="View name..." value={saveName}
                onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveView(); if (e.key === 'Escape') { setIsSaving(false); setSaveName(''); } }}
                style={inputStyle} />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button onClick={handleSaveView} disabled={!saveName.trim()}
                  className="iv-vp-action-btn" style={{ flex: 1 }}>Save</button>
                <button onClick={() => { setIsSaving(false); setSaveName(''); }}
                  className="iv-vp-cancel-btn">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setIsSaving(true)} className="iv-vp-dashed-btn">
              Save Current View
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
