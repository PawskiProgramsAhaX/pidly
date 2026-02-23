/**
 * BatchAddDialog.jsx
 * 
 * Modal for batch-adding documents to the canvas in grid patterns.
 * 
 * Features:
 * - File/page picker with search and checkboxes
 * - Preset + custom layout patterns (X×n, n×X, arbitrary cols)
 * - Interactive placement map with snap-to-edge alignment
 * - Quick-place presets (Right of, Below, Origin, etc.)
 * - Collision detection prevents overlapping
 */
import React, { useState, useMemo, useCallback, useRef } from 'react';
import { sortByName, getAllNestedFiles } from '../../../utils/fileUtils';

// Fallback page size when no slots exist
const FALLBACK_W = 900;
const FALLBACK_H = 1270;

// Snap threshold in canvas units (how close before snapping)
const SNAP_THRESHOLD_RATIO = 0.015; // 1.5% of visible world size

export default function BatchAddDialog({
  project,
  slots,
  filePageCounts,
  onFetchPageCount,
  onBatchAdd,
  onClose,
}) {
  // Compute reference cell size from actual slot dimensions on canvas
  const { refW, refH } = useMemo(() => {
    if (slots.length === 0) return { refW: FALLBACK_W, refH: FALLBACK_H };
    let maxW = 0, maxH = 0;
    slots.forEach(s => {
      if (s.width && s.width > maxW) maxW = s.width;
      if (s.height && s.height > maxH) maxH = s.height;
    });
    return {
      refW: maxW > 0 ? maxW : FALLBACK_W,
      refH: maxH > 0 ? maxH : FALLBACK_H,
    };
  }, [slots]);
  const [selected, setSelected] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [gap, setGap] = useState(50);
  const [expandedFiles, setExpandedFiles] = useState(new Set());
  const [loadingCounts, setLoadingCounts] = useState(new Set());
  const [manualOrigin, setManualOrigin] = useState(null);

  // Layout state
  const [layoutMode, setLayoutMode] = useState('preset'); // 'preset' | 'custom'
  const [presetId, setPresetId] = useState('2xn');
  const [customCols, setCustomCols] = useState('3');

  // ── File data ──────────────────────────────────────────────────────────

  const flatFiles = useMemo(() => {
    const files = [...(project?.files || [])];
    const nested = getAllNestedFiles(project?.folders || []);
    return sortByName([...files, ...nested]);
  }, [project?.files, project?.folders]);

  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return flatFiles;
    const q = searchQuery.toLowerCase();
    return flatFiles.filter(f => f.name.toLowerCase().includes(q));
  }, [flatFiles, searchQuery]);

  const onCanvas = useMemo(() => new Set(slots.map(s => `${s.fileId}:${s.page}`)), [slots]);

  // ── Selection helpers ──────────────────────────────────────────────────

  const toggleItem = useCallback((fileId, page) => {
    setSelected(prev => {
      const next = new Set(prev);
      const key = `${fileId}:${page}`;
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const toggleFile = useCallback((file) => {
    const count = filePageCounts[file.id] || 1;
    const fileKeys = [];
    for (let p = 1; p <= count; p++) {
      const key = `${file.id}:${p}`;
      if (!onCanvas.has(key)) fileKeys.push(key);
    }
    setSelected(prev => {
      const next = new Set(prev);
      const allSelected = fileKeys.length > 0 && fileKeys.every(k => next.has(k));
      if (allSelected) fileKeys.forEach(k => next.delete(k));
      else fileKeys.forEach(k => next.add(k));
      return next;
    });
  }, [filePageCounts, onCanvas]);

  const toggleExpand = useCallback(async (file) => {
    const count = filePageCounts[file.id];
    if (count !== undefined && count <= 1) return;
    setExpandedFiles(prev => {
      const next = new Set(prev);
      next.has(file.id) ? next.delete(file.id) : next.add(file.id);
      return next;
    });
    if (!filePageCounts[file.id] && onFetchPageCount) {
      setLoadingCounts(prev => new Set(prev).add(file.id));
      await onFetchPageCount(file);
      setLoadingCounts(prev => { const n = new Set(prev); n.delete(file.id); return n; });
    }
  }, [filePageCounts, onFetchPageCount]);

  const selectAll = useCallback(() => {
    const keys = [];
    filteredFiles.forEach(f => {
      const count = filePageCounts[f.id] || 1;
      for (let p = 1; p <= count; p++) {
        const key = `${f.id}:${p}`;
        if (!onCanvas.has(key)) keys.push(key);
      }
    });
    setSelected(new Set(keys));
  }, [filteredFiles, filePageCounts, onCanvas]);

  const clearAll = useCallback(() => setSelected(new Set()), []);

  const selectedItems = useMemo(() => {
    const items = [];
    flatFiles.forEach(file => {
      const count = filePageCounts[file.id] || 1;
      for (let p = 1; p <= count; p++) {
        if (selected.has(`${file.id}:${p}`)) items.push({ file, page: p });
      }
    });
    return items;
  }, [selected, flatFiles, filePageCounts]);

  // ── Layout computation ─────────────────────────────────────────────────

  const PRESETS = [
    { id: '1xn', label: '1 × n', cols: () => 1 },
    { id: 'nx1', label: 'n × 1', cols: (n) => n },
    { id: '2xn', label: '2 × n', cols: () => 2 },
  ];

  const n = selectedItems.length;
  const parsedCustomCols = parseInt(customCols) || 1;
  const cols = layoutMode === 'custom'
    ? Math.max(1, Math.min(parsedCustomCols, n || 1))
    : (PRESETS.find(p => p.id === presetId) || PRESETS[2]).cols(n);
  const rows = Math.ceil(n / cols) || 0;

  const cellW = refW + gap;
  const cellH = refH + gap;
  const gridW = cols > 0 ? cols * cellW - gap : 0;
  const gridH = rows > 0 ? rows * cellH - gap : 0;

  // ── Slot edges for snap guides ─────────────────────────────────────────

  const slotEdges = useMemo(() => {
    const xEdges = new Set();
    const yEdges = new Set();
    slots.forEach(s => {
      const w = s.width || refW;
      const h = s.height || refH;
      xEdges.add(s.x);
      xEdges.add(s.x + w);
      yEdges.add(s.y);
      yEdges.add(s.y + h);
    });
    return { x: [...xEdges].sort((a, b) => a - b), y: [...yEdges].sort((a, b) => a - b) };
  }, [slots, refW, refH]);

  // ── Bounding box of existing slots ─────────────────────────────────────

  const slotBounds = useMemo(() => {
    if (slots.length === 0) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    slots.forEach(s => {
      const w = s.width || refW;
      const h = s.height || refH;
      if (s.x < minX) minX = s.x;
      if (s.x + w > maxX) maxX = s.x + w;
      if (s.y < minY) minY = s.y;
      if (s.y + h > maxY) maxY = s.y + h;
    });
    return { minX, maxX, minY, maxY };
  }, [slots, refW, refH]);

  // ── Quick-place presets ────────────────────────────────────────────────

  const quickPlaces = useMemo(() => {
    const places = [];
    if (slotBounds) {
      const b = slotBounds;
      const spacing = Math.max(gap, 80);
      places.push({ id: 'right',  label: 'Right of all',  icon: '→', x: b.maxX + spacing, y: b.minY });
      places.push({ id: 'below',  label: 'Below all',     icon: '↓', x: b.minX,            y: b.maxY + spacing });
      places.push({ id: 'left',   label: 'Left of all',   icon: '←', x: b.minX - gridW - spacing, y: b.minY });
      places.push({ id: 'above',  label: 'Above all',     icon: '↑', x: b.minX,            y: b.minY - gridH - spacing });
    }
    return places;
  }, [slotBounds, gap, gridW, gridH]);

  // ── Auto placement ─────────────────────────────────────────────────────

  const autoOrigin = useMemo(() => {
    if (!slotBounds) return { x: 0, y: 0 };
    return { x: slotBounds.maxX + Math.max(gap, 80), y: slotBounds.minY };
  }, [slotBounds, gap]);

  const origin = manualOrigin || autoOrigin;

  // ── Collision detection ────────────────────────────────────────────────

  const checkCollision = useCallback((ox, oy) => {
    if (n === 0) return false;
    const PAD = 10;
    for (let idx = 0; idx < n; idx++) {
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      const bx = ox + c * cellW;
      const by = oy + r * cellH;
      const bRight = bx + refW;
      const bBottom = by + refH;
      for (const s of slots) {
        const sw = s.width || refW;
        const sh = s.height || refH;
        if (bx < s.x + sw + PAD && bRight + PAD > s.x && by < s.y + sh + PAD && bBottom + PAD > s.y) {
          return true;
        }
      }
    }
    return false;
  }, [n, cols, cellW, cellH, slots, refW, refH]);

  const hasCollision = useMemo(() => checkCollision(origin.x, origin.y), [checkCollision, origin]);

  // ── Confirm ────────────────────────────────────────────────────────────

  const handleAdd = () => {
    if (n === 0 || hasCollision) return;
    onBatchAdd({ items: selectedItems, cols, gap, originX: origin.x, originY: origin.y });
    onClose();
  };

  const getFileCheckState = (file) => {
    const count = filePageCounts[file.id] || 1;
    let total = 0, checked = 0;
    for (let p = 1; p <= count; p++) {
      const key = `${file.id}:${p}`;
      if (!onCanvas.has(key)) { total++; if (selected.has(key)) checked++; }
    }
    if (total === 0) return 'disabled';
    if (checked === 0) return 'none';
    if (checked === total) return 'all';
    return 'partial';
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="batch-dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="batch-dialog">
        {/* Header */}
        <div className="batch-dialog-header">
          <h3>
            Batch Add Documents
          </h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="batch-dialog-body">
          {/* ── Left: File Picker ─────────────────────────────────────── */}
          <div className="batch-picker">
            <div className="batch-picker-header">
              <div className="batch-search">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M10 10L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <input
                  type="text"
                  placeholder="Search files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
                {searchQuery && <button className="batch-search-clear" onClick={() => setSearchQuery('')}>×</button>}
              </div>
              <div className="batch-select-actions">
                <button onClick={selectAll}>Select All</button>
                <span className="batch-divider">·</span>
                <button onClick={clearAll}>Clear</button>
              </div>
            </div>

            <div className="batch-file-list">
              {filteredFiles.length === 0 ? (
                <div className="batch-empty">No files found</div>
              ) : (
                filteredFiles.map(file => {
                  const pageCount = filePageCounts[file.id] || 1;
                  const isMultiPage = pageCount > 1;
                  const isExpanded = expandedFiles.has(file.id);
                  const isLoading = loadingCounts.has(file.id);
                  const checkState = getFileCheckState(file);
                  return (
                    <div key={file.id} className="batch-file-item">
                      <div className="batch-file-row">
                        <button
                          className="batch-expand-toggle"
                          onClick={() => toggleExpand(file)}
                          style={{ visibility: isMultiPage ? 'visible' : 'hidden' }}
                        >
                          <svg className={`batch-chevron ${isExpanded ? 'expanded' : ''}`} viewBox="0 0 16 16" fill="none">
                            <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        <label className="batch-checkbox">
                          <input
                            type="checkbox"
                            checked={checkState === 'all'}
                            ref={(el) => { if (el) el.indeterminate = checkState === 'partial'; }}
                            disabled={checkState === 'disabled'}
                            onChange={() => toggleFile(file)}
                          />
                        </label>
                        <span className="batch-file-name" title={file.name}>{file.name}</span>
                        {isMultiPage && <span className="batch-page-badge">{pageCount}p</span>}
                        {checkState === 'disabled' && <span className="batch-on-canvas-badge">On Canvas</span>}
                      </div>
                      {isExpanded && (
                        <div className="batch-page-list">
                          {isLoading ? (
                            <div className="batch-page-loading">Loading…</div>
                          ) : (
                            Array.from({ length: pageCount }, (_, i) => i + 1).map(p => {
                              const key = `${file.id}:${p}`;
                              const isOnCanvas = onCanvas.has(key);
                              return (
                                <div key={p} className={`batch-page-row ${isOnCanvas ? 'disabled' : ''}`}>
                                  <label className="batch-checkbox">
                                    <input type="checkbox" checked={selected.has(key)} disabled={isOnCanvas} onChange={() => toggleItem(file.id, p)} />
                                  </label>
                                  <span className="batch-page-label">Page {p}</span>
                                  {isOnCanvas && <span className="batch-on-canvas-badge">On Canvas</span>}
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── Right: Layout & Placement ─────────────────────────────── */}
          <div className="batch-layout-section">
            {/* Layout pattern — single row */}
            <div className="batch-layout-picker">
              <h4>Layout Pattern</h4>
              <div className="batch-layout-row">
                {PRESETS.map(preset => {
                  const pCols = preset.cols(6);
                  const pRows = Math.ceil(6 / pCols);
                  const isActive = layoutMode === 'preset' && presetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      className={`batch-layout-chip ${isActive ? 'active' : ''}`}
                      onClick={() => { setLayoutMode('preset'); setPresetId(preset.id); }}
                      title={preset.label}
                    >
                      <LayoutIcon cols={pCols} rows={pRows} />
                      <span>{preset.label}</span>
                    </button>
                  );
                })}
                <button
                  className={`batch-layout-chip ${layoutMode === 'custom' ? 'active' : ''}`}
                  onClick={() => setLayoutMode('custom')}
                  title="Custom columns"
                >
                  <LayoutIcon cols={Math.min(customCols, 6)} rows={Math.ceil(6 / Math.min(customCols, 6))} />
                  <span>Custom</span>
                </button>
              </div>

              {/* Custom cols input */}
              {layoutMode === 'custom' && (
                <div className="batch-custom-layout">
                  <label>Columns</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={customCols}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '');
                      setCustomCols(val);
                    }}
                    onBlur={() => {
                      const parsed = parseInt(customCols);
                      if (!parsed || parsed < 1) setCustomCols('1');
                    }}
                    className="batch-custom-input"
                  />
                  <span className="batch-custom-result">
                    = {cols} × {rows} grid
                  </span>
                </div>
              )}

              <div className="batch-gap-control">
                <label>Spacing between Documents</label>
                <input type="range" min="0" max="400" value={gap} onChange={(e) => setGap(Number(e.target.value))} />
                <span className="batch-gap-value">{gap}px</span>
              </div>
            </div>

            {/* Placement */}
            <div className="batch-placement">
              <div className="batch-placement-header">
                <h4>Placement</h4>
              </div>

              {/* Quick-place chips */}
              {n > 0 ? (
                <div className="batch-quick-row">
                  {quickPlaces.map(qp => (
                    <button
                      key={qp.id}
                      className={`batch-quick-chip ${manualOrigin?.x === qp.x && manualOrigin?.y === qp.y ? 'active' : ''}`}
                      onClick={() => { setManualOrigin({ x: qp.x, y: qp.y }); }}
                      title={qp.label}
                    >
                      <span className="batch-quick-icon">{qp.icon}</span>
                      {qp.label}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="batch-placement-hint">Click the map to place · snaps to document edges</div>

              {/* Canvas mini-map */}
              <PlacementMap
                slots={slots}
                batchCols={cols}
                batchRows={rows}
                cellW={cellW}
                cellH={cellH}
                gridW={gridW}
                gridH={gridH}
                origin={origin}
                hasCollision={hasCollision}
                isManual={true}
                onSetOrigin={(x, y) => { setManualOrigin({ x, y }); }}
                itemCount={n}
                slotEdges={slotEdges}
                checkCollision={checkCollision}
                refW={refW}
                refH={refH}
              />

              {hasCollision && n > 0 && (
                <div className="batch-collision-warning">⚠ Overlaps existing documents — choose another position</div>
              )}

              {n > 0 && (
                <div className="batch-preview-info">
                  {n} document{n !== 1 ? 's' : ''} · {cols} col{cols !== 1 ? 's' : ''} × {rows} row{rows !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="batch-dialog-footer">
          <button className="batch-cancel-btn" onClick={onClose}>Cancel</button>
          <button className="batch-add-btn" disabled={n === 0 || hasCollision} onClick={handleAdd}>
            Add {n || ''} to Canvas
          </button>
        </div>
      </div>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════
   PlacementMap — interactive mini-map with snap-to-edge alignment
   ══════════════════════════════════════════════════════════════════════════ */
function PlacementMap({
  slots, batchCols, batchRows, cellW, cellH, gridW, gridH,
  origin, hasCollision, isManual, onSetOrigin, itemCount,
  slotEdges, checkCollision, refW, refH,
}) {
  const svgRef = useRef(null);
  const [hoverPos, setHoverPos] = useState(null);
  const [activeSnaps, setActiveSnaps] = useState({ x: null, y: null });

  // World bounds — stable viewBox that doesn't depend on hoverPos to avoid feedback loop
  const { viewBox, world } = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    slots.forEach(s => {
      const w = s.width || refW;
      const h = s.height || refH;
      if (s.x < minX) minX = s.x;
      if (s.x + w > maxX) maxX = s.x + w;
      if (s.y < minY) minY = s.y;
      if (s.y + h > maxY) maxY = s.y + h;
    });

    // Include committed origin batch grid
    if (itemCount > 0) {
      if (origin.x < minX) minX = origin.x;
      if (origin.x + gridW > maxX) maxX = origin.x + gridW;
      if (origin.y < minY) minY = origin.y;
      if (origin.y + gridH > maxY) maxY = origin.y + gridH;
    }

    if (minX === Infinity) { minX = -500; maxX = 500; minY = -500; maxY = 500; }

    // Extra generous padding so mouse can drag outside existing bounds
    const span = Math.max(maxX - minX, maxY - minY);
    const pad = span * 0.5;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const w = maxX - minX, h = maxY - minY;

    return { viewBox: `${minX} ${minY} ${w} ${h}`, world: { minX, minY, w, h } };
  }, [slots, origin, gridW, gridH, itemCount]);

  const snapThreshold = Math.max(world.w, world.h) * SNAP_THRESHOLD_RATIO;

  // Snap a position to nearby edges
  const snapPosition = useCallback((rawX, rawY) => {
    let snappedX = rawX, snappedY = rawY;
    let snapXEdge = null, snapYEdge = null;

    // Check batch grid's left edge against slot edges
    for (const edge of slotEdges.x) {
      if (Math.abs(rawX - edge) < snapThreshold) {
        snappedX = edge;
        snapXEdge = edge;
        break;
      }
      // Also snap batch right edge to slot edges
      if (Math.abs((rawX + gridW) - edge) < snapThreshold) {
        snappedX = edge - gridW;
        snapXEdge = edge;
        break;
      }
    }

    // Check batch grid's top edge against slot edges
    for (const edge of slotEdges.y) {
      if (Math.abs(rawY - edge) < snapThreshold) {
        snappedY = edge;
        snapYEdge = edge;
        break;
      }
      // Also snap batch bottom edge to slot edges
      if (Math.abs((rawY + gridH) - edge) < snapThreshold) {
        snappedY = edge - gridH;
        snapYEdge = edge;
        break;
      }
    }

    return { x: snappedX, y: snappedY, snapX: snapXEdge, snapY: snapYEdge };
  }, [slotEdges, snapThreshold, gridW, gridH]);

  // Mouse → canvas coords using SVG's own coordinate transform (handles aspect ratio correctly)
  const mouseToCanvas = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());
    return {
      x: svgPt.x - gridW / 2,
      y: svgPt.y - gridH / 2,
    };
  }, [gridW, gridH]);

  const handleClick = (e) => {
    if (itemCount === 0) return;
    const raw = mouseToCanvas(e);
    if (!raw) return;
    const snapped = snapPosition(raw.x, raw.y);
    onSetOrigin(Math.round(snapped.x), Math.round(snapped.y));
  };

  const handleMouseMove = (e) => {
    if (!isManual || itemCount === 0) { setHoverPos(null); setActiveSnaps({ x: null, y: null }); return; }
    const raw = mouseToCanvas(e);
    if (!raw) return;
    const snapped = snapPosition(raw.x, raw.y);
    setHoverPos({ x: Math.round(snapped.x), y: Math.round(snapped.y) });
    setActiveSnaps({ x: snapped.snapX, y: snapped.snapY });
  };

  const hoverCollision = useMemo(() => {
    if (!hoverPos || itemCount === 0) return false;
    return checkCollision(hoverPos.x, hoverPos.y);
  }, [hoverPos, itemCount, checkCollision]);

  // The position to render for the batch (hover takes priority)
  const displaySnaps = hoverPos ? activeSnaps : { x: null, y: null };

  return (
    <svg
      ref={svgRef}
      className={`batch-canvas-map ${isManual ? 'manual' : ''}`}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { setHoverPos(null); setActiveSnaps({ x: null, y: null }); }}
    >
      {/* Background grid */}
      <defs>
        <pattern id="batch-bg-grid" width={refW} height={refH} patternUnits="userSpaceOnUse">
          <path d={`M ${refW} 0 L 0 0 0 ${refH}`} fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth={2} />
        </pattern>
      </defs>
      <rect x={world.minX} y={world.minY} width={world.w} height={world.h} fill="url(#batch-bg-grid)" />

      {/* Existing slots — use actual dimensions */}
      {slots.map(s => {
        const sw = s.width || refW;
        const sh = s.height || refH;
        return (
          <g key={s.id}>
            <rect
              x={s.x} y={s.y}
              width={sw} height={sh}
              rx={4} fill="#353739" stroke="#5a5d62" strokeWidth={2}
            />
            <text
              x={s.x + sw / 2}
              y={s.y + sh / 2}
              textAnchor="middle" dominantBaseline="central"
              fill="#888" fontSize={Math.max(14, sw * 0.02)} fontFamily="system-ui"
            >
              {s.fileName?.replace(/\.pdf$/i, '').substring(0, 12)}
            </text>
          </g>
        );
      })}

      {/* ── Snap guide lines ── */}
      {displaySnaps.x != null && (
        <line
          x1={displaySnaps.x} y1={world.minY}
          x2={displaySnaps.x} y2={world.minY + world.h}
          stroke="#f39c12" strokeWidth={2} strokeDasharray="10 6" opacity={0.7}
        />
      )}
      {displaySnaps.y != null && (
        <line
          x1={world.minX} y1={displaySnaps.y}
          x2={world.minX + world.w} y2={displaySnaps.y}
          stroke="#f39c12" strokeWidth={2} strokeDasharray="10 6" opacity={0.7}
        />
      )}

      {/* Committed batch grid — always visible at origin */}
      {itemCount > 0 && (
        <g opacity={hoverPos ? 0.35 : 1}>
          {Array.from({ length: itemCount }, (_, idx) => {
            const c = idx % batchCols;
            const r = Math.floor(idx / batchCols);
            return (
              <rect
                key={idx}
                x={origin.x + c * cellW}
                y={origin.y + r * cellH}
                width={refW} height={refH}
                rx={4}
                fill={hasCollision ? 'rgba(231,76,60,0.12)' : 'rgba(52,152,219,0.15)'}
                stroke={hasCollision ? '#e74c3c' : '#3498db'}
                strokeWidth={2}
              />
            );
          })}
        </g>
      )}

      {/* Hover ghost — preview where it would go */}
      {itemCount > 0 && hoverPos && (
        <g opacity={0.85}>
          {Array.from({ length: itemCount }, (_, idx) => {
            const c = idx % batchCols;
            const r = Math.floor(idx / batchCols);
            return (
              <rect
                key={`hover-${idx}`}
                x={hoverPos.x + c * cellW}
                y={hoverPos.y + r * cellH}
                width={refW} height={refH}
                rx={4}
                fill={hoverCollision ? 'rgba(231,76,60,0.15)' : 'rgba(52,152,219,0.25)'}
                stroke={hoverCollision ? '#e74c3c' : '#5dccff'}
                strokeWidth={2.5}
                strokeDasharray="8 4"
              />
            );
          })}
        </g>
      )}

      {/* Origin marker */}
      {itemCount > 0 && (
        <circle
          cx={origin.x} cy={origin.y}
          r={Math.max(8, world.w * 0.005)}
          fill={hasCollision ? '#e74c3c' : '#3498db'} opacity={hoverPos ? 0.4 : 0.8}
        />
      )}
    </svg>
  );
}


/* ── Layout Icon ──────────────────────────────────────────────────────── */
function LayoutIcon({ cols, rows }) {
  const maxCols = Math.min(cols, 6);
  const maxRows = Math.min(rows, 5);
  const cw = 5, ch = 4, g = 2;
  const w = maxCols * cw + (maxCols - 1) * g;
  const h = maxRows * ch + (maxRows - 1) * g;
  return (
    <svg width={28} height={22} viewBox={`0 0 ${Math.max(w, 8)} ${Math.max(h, 8)}`}>
      {Array.from({ length: maxRows }, (_, r) =>
        Array.from({ length: maxCols }, (_, c) => (
          <rect key={`${r}-${c}`} x={c * (cw + g)} y={r * (ch + g)} width={cw} height={ch} rx={0.5} fill="currentColor" opacity={0.65} />
        ))
      )}
    </svg>
  );
}
