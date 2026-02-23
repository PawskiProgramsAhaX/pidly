/**
 * LoadBatchDialog.jsx
 * 
 * Dialog for placing a saved batch onto the canvas.
 * Reuses placement map / snap-to-edge concepts from BatchAddDialog.
 * 
 * Behavior:
 * - Items already on canvas → skipped (navigated to instead if desired)
 * - Files missing from project → added as empty placeholders
 * - New items → added at the computed grid positions
 */
import React, { useState, useMemo, useCallback, useRef } from 'react';

const FALLBACK_W = 900;
const FALLBACK_H = 1270;
const SNAP_THRESHOLD_RATIO = 0.025;

export default function LoadBatchDialog({
  batch,           // The saved batch object to load
  slots,           // Current canvas slots
  canvasShapes,    // Current canvas shapes
  project,         // Project (to resolve files)
  onLoadBatch,     // ({ batch, originX, originY }) => void
  onClose,
}) {
  if (!batch) return null;

  // ── Resolve batch items against current state ─────────────────────────
  const allFiles = useMemo(() => {
    const files = [...(project?.files || [])];
    const getFolderFiles = (folders) => {
      let result = [];
      (folders || []).forEach(f => {
        result = [...result, ...(f.files || []), ...getFolderFiles(f.children || f.folders || [])];
      });
      return result;
    };
    return [...files, ...getFolderFiles(project?.folders || [])];
  }, [project]);

  const onCanvasSet = useMemo(() => new Set(slots.map(s => `${s.fileId}:${s.page}`)), [slots]);

  const resolvedItems = useMemo(() => {
    return (batch.items || []).map(item => {
      if (item.type === 'shape') {
        return { ...item, status: 'new' };
      }
      // Slot item
      const key = `${item.fileId}:${item.page}`;
      if (onCanvasSet.has(key)) {
        return { ...item, status: 'exists' };
      }
      const file = allFiles.find(f => f.id === item.fileId);
      if (!file) {
        return { ...item, status: 'missing' };
      }
      return { ...item, status: 'new' };
    });
  }, [batch.items, onCanvasSet, allFiles]);

  const newSlotItems = resolvedItems.filter(i => i.type === 'slot' && i.status !== 'exists');
  const existingItems = resolvedItems.filter(i => i.type === 'slot' && i.status === 'exists');
  const newShapeItems = resolvedItems.filter(i => i.type === 'shape');
  const totalNewItems = newSlotItems.length + newShapeItems.length;

  // ── Reference dimensions ──────────────────────────────────────────────
  const { refW, refH } = useMemo(() => {
    // Use batch item dimensions if available, else canvas slot dims, else fallback
    let maxW = 0, maxH = 0;
    (batch.items || []).filter(i => i.type === 'slot').forEach(i => {
      if (i.width > maxW) maxW = i.width;
      if (i.height > maxH) maxH = i.height;
    });
    if (maxW === 0) {
      slots.forEach(s => {
        if (s.width > maxW) maxW = s.width;
        if (s.height > maxH) maxH = s.height;
      });
    }
    return { refW: maxW || FALLBACK_W, refH: maxH || FALLBACK_H };
  }, [batch.items, slots]);

  const [gap, setGap] = useState(batch.gap || 50);
  const [placementMode, setPlacementMode] = useState('auto');
  const [manualOrigin, setManualOrigin] = useState(null);

  // ── Grid layout from saved batch ──────────────────────────────────────
  const cols = batch.cols || Math.ceil(Math.sqrt(newSlotItems.length || 1));
  const rows = Math.ceil((newSlotItems.length || 0) / cols) || 0;

  const cellW = refW + gap;
  const cellH = refH + gap;
  const gridW = cols > 0 ? cols * cellW - gap : 0;
  const gridH = rows > 0 ? rows * cellH - gap : 0;

  // ── Slot edges for snap guides ────────────────────────────────────────
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

  // ── Bounding box of existing slots ────────────────────────────────────
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

  // ── Quick-place presets ───────────────────────────────────────────────
  const quickPlaces = useMemo(() => {
    const places = [{ id: 'origin', label: 'Origin', icon: '⊕', x: 0, y: 0 }];
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

  // ── Auto placement ────────────────────────────────────────────────────
  const autoOrigin = useMemo(() => {
    if (!slotBounds) return { x: 0, y: 0 };
    return { x: slotBounds.maxX + Math.max(gap, 80), y: slotBounds.minY };
  }, [slotBounds, gap]);

  const origin = placementMode === 'manual' && manualOrigin ? manualOrigin : autoOrigin;

  // ── Collision detection ───────────────────────────────────────────────
  const checkCollision = useCallback((ox, oy) => {
    if (newSlotItems.length === 0) return false;
    const PAD = 10;
    for (let idx = 0; idx < newSlotItems.length; idx++) {
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
  }, [newSlotItems.length, cols, cellW, cellH, slots, refW, refH]);

  const hasCollision = useMemo(() => checkCollision(origin.x, origin.y), [checkCollision, origin]);

  // ── Confirm ───────────────────────────────────────────────────────────
  const handleAdd = () => {
    if (totalNewItems === 0 || hasCollision) return;
    onLoadBatch({
      batch,
      originX: origin.x,
      originY: origin.y,
      gap,
      cols,
    });
    onClose();
  };

  // ── Status label helper ───────────────────────────────────────────────
  const statusIcon = (status) => {
    if (status === 'exists') return '🔗';
    if (status === 'missing') return '⬜';
    return '✓';
  };

  const statusLabel = (status) => {
    if (status === 'exists') return 'Already on canvas';
    if (status === 'missing') return 'File missing — placeholder';
    return 'Will be added';
  };

  return (
    <div className="batch-dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="batch-dialog" style={{ width: 700 }}>
        {/* Header */}
        <div className="batch-dialog-header">
          <h3>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ marginRight: 8, verticalAlign: -3 }}>
              <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
              <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
              <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M12 9V15M9 12H15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            Add Batch — {batch.name}
          </h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="batch-dialog-body" style={{ flexDirection: 'column', padding: 0 }}>
          {/* ── Item summary ─────────────────────────────────────── */}
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #2a2a3a' }}>
            <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>
              {batch.items?.length || 0} items in batch
              {existingItems.length > 0 && (
                <span style={{ color: '#f39c12', marginLeft: 8 }}>
                  · {existingItems.length} already on canvas (skipped)
                </span>
              )}
            </div>

            {/* Item list */}
            <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {resolvedItems.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '4px 8px', borderRadius: 4,
                    background: item.status === 'exists' ? '#2a2a1e' : item.status === 'missing' ? '#2a1e1e' : '#1e2a1e',
                    fontSize: 11, color: item.status === 'exists' ? '#888' : '#ccc',
                    opacity: item.status === 'exists' ? 0.6 : 1,
                  }}
                >
                  <span>{statusIcon(item.status)}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.type === 'shape'
                      ? `${item.shapeType || 'Shape'}: ${item.title || 'Untitled'}`
                      : `${item.fileName || 'Unknown'} · p${item.page}`
                    }
                  </span>
                  <span style={{ fontSize: 10, color: '#666' }}>{statusLabel(item.status)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Placement section ────────────────────────────────── */}
          <div style={{ padding: '12px 20px', flex: 1, overflow: 'auto' }}>
            <div className="batch-placement">
              <div className="batch-placement-header">
                <h4>Placement</h4>
                <div className="batch-placement-mode">
                  <button
                    className={`batch-mode-btn ${placementMode === 'auto' ? 'active' : ''}`}
                    onClick={() => { setPlacementMode('auto'); setManualOrigin(null); }}
                  >Auto</button>
                  <button
                    className={`batch-mode-btn ${placementMode === 'manual' ? 'active' : ''}`}
                    onClick={() => setPlacementMode('manual')}
                    disabled={totalNewItems === 0}
                  >Manual</button>
                </div>
              </div>

              {/* Quick-place buttons */}
              {totalNewItems > 0 && (
                <div className="batch-quick-places">
                  {quickPlaces.map(qp => (
                    <button
                      key={qp.id}
                      className={`batch-quick-btn ${placementMode === 'manual' && manualOrigin?.x === qp.x && manualOrigin?.y === qp.y ? 'active' : ''}`}
                      onClick={() => { setPlacementMode('manual'); setManualOrigin({ x: qp.x, y: qp.y }); }}
                      title={qp.label}
                    >
                      <span className="batch-quick-icon">{qp.icon}</span>
                      {qp.label}
                    </button>
                  ))}
                </div>
              )}

              {placementMode === 'auto' && (
                <div className="batch-placement-auto-info">
                  {slots.length === 0 ? 'Will be placed at canvas origin' : 'Will be placed to the right of existing documents'}
                </div>
              )}
              {placementMode === 'manual' && (
                <div className="batch-placement-hint">Click the map to place · snaps to document edges</div>
              )}

              {/* Gap control */}
              <div className="batch-gap-control" style={{ margin: '8px 0' }}>
                <label>Spacing</label>
                <input type="range" min="0" max="400" value={gap} onChange={(e) => setGap(Number(e.target.value))} />
                <span className="batch-gap-value">{gap}px</span>
              </div>

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
                isManual={placementMode === 'manual'}
                onSetOrigin={(x, y) => { setPlacementMode('manual'); setManualOrigin({ x, y }); }}
                itemCount={newSlotItems.length}
                slotEdges={slotEdges}
                checkCollision={checkCollision}
                refW={refW}
                refH={refH}
              />

              {hasCollision && totalNewItems > 0 && (
                <div className="batch-collision-warning">⚠ Overlaps existing documents — choose another position</div>
              )}

              {totalNewItems > 0 && (
                <div className="batch-preview-info">
                  {newSlotItems.length} document{newSlotItems.length !== 1 ? 's' : ''}
                  {newShapeItems.length > 0 && ` + ${newShapeItems.length} shape${newShapeItems.length !== 1 ? 's' : ''}`}
                  {' '}· {cols} col{cols !== 1 ? 's' : ''} × {rows} row{rows !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="batch-dialog-footer">
          <button className="batch-cancel-btn" onClick={onClose}>Cancel</button>
          <button
            className="batch-add-btn"
            disabled={totalNewItems === 0 || hasCollision}
            onClick={handleAdd}
          >
            Add {totalNewItems || ''} to Canvas
          </button>
        </div>
      </div>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════
   PlacementMap — interactive mini-map with snap-to-edge alignment
   (Shared logic with BatchAddDialog)
   ══════════════════════════════════════════════════════════════════════════ */
function PlacementMap({
  slots, batchCols, batchRows, cellW, cellH, gridW, gridH,
  origin, hasCollision, isManual, onSetOrigin, itemCount,
  slotEdges, checkCollision, refW, refH,
}) {
  const svgRef = useRef(null);
  const [hoverPos, setHoverPos] = useState(null);
  const [activeSnaps, setActiveSnaps] = useState({ x: null, y: null });

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

    const positions = [origin];
    if (hoverPos) positions.push(hoverPos);
    positions.forEach(pos => {
      if (itemCount > 0) {
        if (pos.x < minX) minX = pos.x;
        if (pos.x + gridW > maxX) maxX = pos.x + gridW;
        if (pos.y < minY) minY = pos.y;
        if (pos.y + gridH > maxY) maxY = pos.y + gridH;
      }
    });

    if (minX === Infinity) { minX = -500; maxX = 500; minY = -500; maxY = 500; }

    const pad = Math.max(maxX - minX, maxY - minY) * 0.3;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const w = maxX - minX, h = maxY - minY;

    return { viewBox: `${minX} ${minY} ${w} ${h}`, world: { minX, minY, w, h } };
  }, [slots, origin, gridW, gridH, itemCount, hoverPos, refW, refH]);

  const snapThreshold = Math.max(world.w, world.h) * SNAP_THRESHOLD_RATIO;

  const snapPosition = useCallback((rawX, rawY) => {
    let snappedX = rawX, snappedY = rawY;
    let snapXEdge = null, snapYEdge = null;

    for (const edge of slotEdges.x) {
      if (Math.abs(rawX - edge) < snapThreshold) {
        snappedX = edge; snapXEdge = edge; break;
      }
      if (Math.abs((rawX + gridW) - edge) < snapThreshold) {
        snappedX = edge - gridW; snapXEdge = edge; break;
      }
    }

    for (const edge of slotEdges.y) {
      if (Math.abs(rawY - edge) < snapThreshold) {
        snappedY = edge; snapYEdge = edge; break;
      }
      if (Math.abs((rawY + gridH) - edge) < snapThreshold) {
        snappedY = edge - gridH; snapYEdge = edge; break;
      }
    }

    return { x: snappedX, y: snappedY, snapX: snapXEdge, snapY: snapYEdge };
  }, [slotEdges, snapThreshold, gridW, gridH]);

  const mouseToCanvas = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    return {
      x: world.minX + mx * world.w - gridW / 2,
      y: world.minY + my * world.h - gridH / 2,
    };
  }, [world, gridW, gridH]);

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

  const displayPos = hoverPos || origin;
  const displayCollision = hoverPos ? hoverCollision : hasCollision;
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
      <defs>
        <pattern id="load-batch-bg-grid" width={refW} height={refH} patternUnits="userSpaceOnUse">
          <path d={`M ${refW} 0 L 0 0 0 ${refH}`} fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth={2} />
        </pattern>
      </defs>
      <rect x={world.minX} y={world.minY} width={world.w} height={world.h} fill="url(#load-batch-bg-grid)" />

      {/* Existing slots */}
      {slots.map(s => {
        const sw = s.width || refW;
        const sh = s.height || refH;
        return (
          <g key={s.id}>
            <rect x={s.x} y={s.y} width={sw} height={sh} rx={4} fill="#2a2a3a" stroke="#555" strokeWidth={2} />
            <text
              x={s.x + sw / 2} y={s.y + sh / 2}
              textAnchor="middle" dominantBaseline="central"
              fill="#888" fontSize={Math.max(14, sw * 0.02)} fontFamily="system-ui"
            >
              {s.fileName?.replace(/\.pdf$/i, '').substring(0, 12)}
            </text>
          </g>
        );
      })}

      {/* Snap guide lines */}
      {displaySnaps.x != null && (
        <line
          x1={displaySnaps.x} y1={world.minY} x2={displaySnaps.x} y2={world.minY + world.h}
          stroke="#f39c12" strokeWidth={2} strokeDasharray="10 6" opacity={0.7}
        />
      )}
      {displaySnaps.y != null && (
        <line
          x1={world.minX} y1={displaySnaps.y} x2={world.minX + world.w} y2={displaySnaps.y}
          stroke="#f39c12" strokeWidth={2} strokeDasharray="10 6" opacity={0.7}
        />
      )}

      {/* Batch grid preview */}
      {itemCount > 0 && (
        <g opacity={hoverPos ? 0.5 : 1}>
          {Array.from({ length: itemCount }, (_, idx) => {
            const c = idx % batchCols;
            const r = Math.floor(idx / batchCols);
            return (
              <rect
                key={idx}
                x={displayPos.x + c * cellW} y={displayPos.y + r * cellH}
                width={refW} height={refH} rx={4}
                fill={displayCollision ? 'rgba(231,76,60,0.12)' : 'rgba(46,204,113,0.12)'}
                stroke={displayCollision ? '#e74c3c' : '#2ecc71'}
                strokeWidth={2}
                strokeDasharray={hoverPos ? '8 4' : 'none'}
              />
            );
          })}
        </g>
      )}

      {/* Origin marker */}
      {itemCount > 0 && !hoverPos && (
        <circle
          cx={origin.x} cy={origin.y}
          r={Math.max(8, world.w * 0.005)}
          fill={hasCollision ? '#e74c3c' : '#2ecc71'} opacity={0.8}
        />
      )}
    </svg>
  );
}
