/**
 * renderSelectionHandles.jsx
 * 
 * Shared selection handle renderer for markup editing.
 * Extracted from SinglePageView's complete implementation.
 * 
 * Handles: bounding box, corner/edge resize, line endpoints,
 * arc 3-point handles, polyline vertex handles, rotate handles.
 * 
 * Usage:
 *   import { renderSelectionHandles } from './renderSelectionHandles';
 *   
 *   {renderSelectionHandles({ selectedMarkup, getMarkupBounds, scaledWidth, scaledHeight, ... })}
 */
import React from 'react';

/**
 * Rotation cursor – base64-encoded SVG for cross-browser reliability.
 * Import this in view components to set the cursor during active rotation.
 */
export const ROTATE_CURSOR = 'url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj4KICA8Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSI5IiBmaWxsPSJub25lIiBzdHJva2U9IiMyMjIiIHN0cm9rZS13aWR0aD0iMi41IiBzdHJva2UtZGFzaGFycmF5PSI0MiAxNCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiB0cmFuc2Zvcm09InJvdGF0ZSgtMzAgMTYgMTYpIi8+CiAgPHBvbHlnb24gcG9pbnRzPSIyNCw3IDI3LDEzIDIxLDEyIiBmaWxsPSIjMjIyIiB0cmFuc2Zvcm09InJvdGF0ZSgtMTUgMTYgMTYpIi8+Cjwvc3ZnPg==") 16 16, crosshair';

/**
 * Rotate a resize cursor direction to match the shape's visual rotation.
 * E.g. at 90° rotation, 'nw-resize' becomes 'ne-resize' because the 
 * top-left handle has visually moved to the top-right position.
 */
const CURSOR_DIRS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
function getRotatedCursor(baseCursor, rotation) {
  if (!rotation) return baseCursor;
  const dir = baseCursor.replace('-resize', '');
  const idx = CURSOR_DIRS.indexOf(dir);
  if (idx === -1) return baseCursor;
  const steps = Math.round(((rotation % 360) + 360) % 360 / 45);
  const newIdx = (idx + steps) % 8;
  return CURSOR_DIRS[newIdx] + '-resize';
}

/**
 * @param {Object} opts
 * @param {Object} opts.selectedMarkup - The selected markup object
 * @param {Function} opts.getMarkupBounds - (markup) => { minX, maxX, minY, maxY } | null
 * @param {number} opts.scaledWidth - SVG viewBox width (canvasSize.width * scale or pageWidth)
 * @param {number} opts.scaledHeight - SVG viewBox height
 * @param {number} opts.scale - Current zoom scale
 * 
 * Optional visual props:
 * @param {Object} [opts.gStyle] - Extra style for the outer <g> (e.g. { pointerEvents: 'all' })
 * @param {React.Ref} [opts.selectionRef] - Ref to attach to the outer <g>
 * 
 * Optional interaction callbacks (for SinglePageView's direct-handle interactions):
 * @param {Function} [opts.onArcHandleMouseDown] - (e, handleType: 'point1'|'point2'|'bulge') => void
 * @param {Function} [opts.onPolylinePointMouseDown] - (e, pointIndex) => void
 * @param {number} [opts.draggingPolylinePoint] - Currently dragged polyline point index (for highlight)
 * @param {Function} [opts.onRotateMouseDown] - (e, centerX, centerY, currentRotation) => void
 */
export function renderSelectionHandles(opts) {
  const {
    selectedMarkup,
    getMarkupBounds,
    scaledWidth, scaledHeight, scale,
    // Visual customization
    gStyle,
    selectionRef,
    // Interaction callbacks (optional - SinglePageView provides these)
    onArcHandleMouseDown,
    onPolylinePointMouseDown,
    draggingPolylinePoint,
    onRotateMouseDown,
  } = opts;

  if (!selectedMarkup) return null;

  const bounds = getMarkupBounds(selectedMarkup);
  if (!bounds) return null;

  const { minX, maxX, minY, maxY } = bounds;
  const handleSize = 14;
  const halfHandle = handleSize / 2;
  const hitSize = 28; // invisible touch target
  const halfHit = hitSize / 2;

  // Convert to pixel coordinates
  const pMinX = minX * scaledWidth;
  const pMaxX = maxX * scaledWidth;
  const pMinY = minY * scaledHeight;
  const pMaxY = maxY * scaledHeight;
  const pMidX = (pMinX + pMaxX) / 2;
  const pMidY = (pMinY + pMaxY) / 2;

  const canResize = !selectedMarkup.readOnly &&
    selectedMarkup.type !== 'pen' && selectedMarkup.type !== 'highlighter' &&
    selectedMarkup.type !== 'polyline' && selectedMarkup.type !== 'polylineArrow' &&
    selectedMarkup.type !== 'cloudPolyline' && selectedMarkup.type !== 'polygon' &&
    !(selectedMarkup.type === 'text' && selectedMarkup.x !== undefined && selectedMarkup.startX === undefined);

  const isLineType = selectedMarkup.type === 'arrow' || selectedMarkup.type === 'line';
  const isTextBox = selectedMarkup.type === 'text' && selectedMarkup.startX !== undefined;
  const rotation = selectedMarkup.rotation || 0;
  const centerX = pMidX;
  const centerY = pMidY;

  // Handle style - continuous/side-by-side views need explicit pointerEvents
  // For resize cursors, rotate them to match the shape's visual rotation
  const handleCursorStyle = (cursor) => {
    const adjustedCursor = cursor.includes('-resize') ? getRotatedCursor(cursor, rotation) : cursor;
    return gStyle?.pointerEvents === 'all'
      ? { cursor: adjustedCursor, pointerEvents: 'all' }
      : { cursor: adjustedCursor };
  };

  // ── Line / Arrow endpoint handles ────────────────────────────────────
  if (isLineType) {
    const p1X = selectedMarkup.startX * scaledWidth;
    const p1Y = selectedMarkup.startY * scaledHeight;
    const p2X = selectedMarkup.endX * scaledWidth;
    const p2Y = selectedMarkup.endY * scaledHeight;

    return (
      <g className="markup-selection" style={gStyle} ref={selectionRef}>
        <line
          x1={p1X} y1={p1Y} x2={p2X} y2={p2Y}
          stroke="#0066ff" strokeWidth={1} strokeDasharray="5,3"
          pointerEvents="none"
        />
        {!selectedMarkup.readOnly && (
          <>
            <circle cx={p1X} cy={p1Y} r={halfHit} fill="transparent" style={handleCursorStyle('move')} className="resize-handle" data-handle="start" />
            <circle
              cx={p1X} cy={p1Y} r={halfHandle}
              fill="#0066ff" stroke="#fff" strokeWidth={1.5}
              style={{ ...handleCursorStyle('move'), filter: 'drop-shadow(0 0 2px rgba(0, 0, 0, 0.5))' }} pointerEvents="none"
            />
            <circle cx={p2X} cy={p2Y} r={halfHit} fill="transparent" style={handleCursorStyle('move')} className="resize-handle" data-handle="end" />
            <circle
              cx={p2X} cy={p2Y} r={halfHandle}
              fill="#0066ff" stroke="#fff" strokeWidth={1.5}
              style={{ ...handleCursorStyle('move'), filter: 'drop-shadow(0 0 2px rgba(0, 0, 0, 0.5))' }} pointerEvents="none"
            />
          </>
        )}
      </g>
    );
  }

  // ── Arc 3-point handles ──────────────────────────────────────────────
  if (selectedMarkup.type === 'arc') {
    const p1X = selectedMarkup.point1X * scaledWidth;
    const p1Y = selectedMarkup.point1Y * scaledHeight;
    const p2X = selectedMarkup.point2X * scaledWidth;
    const p2Y = selectedMarkup.point2Y * scaledHeight;
    const bulge = selectedMarkup.arcBulge !== undefined ? selectedMarkup.arcBulge : 0.5;

    const midX = (p1X + p2X) / 2;
    const midY = (p1Y + p2Y) / 2;
    const chordDx = p2X - p1X;
    const chordDy = p2Y - p1Y;
    const chordLen = Math.sqrt(chordDx * chordDx + chordDy * chordDy);
    const perpX = chordLen > 0 ? -chordDy / chordLen : 0;
    const perpY = chordLen > 0 ? chordDx / chordLen : 1;
    const bulgeOffset = chordLen * bulge;
    const ctrlX = midX + perpX * bulgeOffset;
    const ctrlY = midY + perpY * bulgeOffset;

    return (
      <g className="markup-selection" style={gStyle} ref={selectionRef}>
        {/* Chord guide line */}
        <line
          x1={p1X} y1={p1Y} x2={p2X} y2={p2Y}
          stroke="#0066ff" strokeWidth={1} strokeDasharray="5,3" pointerEvents="none"
        />
        {/* Bulge direction guide */}
        <line
          x1={midX} y1={midY} x2={ctrlX} y2={ctrlY}
          stroke="#ff6600" strokeWidth={1} strokeDasharray="3,3" pointerEvents="none"
        />
        {!selectedMarkup.readOnly && (
          <>
            <circle cx={p1X} cy={p1Y} r={halfHit} fill="transparent" style={handleCursorStyle('move')} className="arc-handle" data-arc-handle="point1"
              onMouseDown={onArcHandleMouseDown ? (e) => { e.stopPropagation(); onArcHandleMouseDown(e, 'point1'); } : undefined} />
            <circle cx={p1X} cy={p1Y} r={halfHandle} fill="#0066ff" stroke="#fff" strokeWidth={1.5} pointerEvents="none" style={{ filter: 'drop-shadow(0 0 2px rgba(0, 0, 0, 0.5))' }} />
            <circle cx={p2X} cy={p2Y} r={halfHit} fill="transparent" style={handleCursorStyle('move')} className="arc-handle" data-arc-handle="point2"
              onMouseDown={onArcHandleMouseDown ? (e) => { e.stopPropagation(); onArcHandleMouseDown(e, 'point2'); } : undefined} />
            <circle cx={p2X} cy={p2Y} r={halfHandle} fill="#0066ff" stroke="#fff" strokeWidth={1.5} pointerEvents="none" style={{ filter: 'drop-shadow(0 0 2px rgba(0, 0, 0, 0.5))' }} />
            <circle cx={ctrlX} cy={ctrlY} r={halfHit} fill="transparent" style={handleCursorStyle('crosshair')} className="arc-handle" data-arc-handle="bulge"
              onMouseDown={onArcHandleMouseDown ? (e) => { e.stopPropagation(); onArcHandleMouseDown(e, 'bulge'); } : undefined} />
            <circle cx={ctrlX} cy={ctrlY} r={halfHandle} fill="#ff6600" stroke="#fff" strokeWidth={1.5} pointerEvents="none" style={{ filter: 'drop-shadow(0 0 2px rgba(0, 0, 0, 0.5))' }} />
          </>
        )}
      </g>
    );
  }

  // ── Polyline / polygon vertex handles ────────────────────────────────
  const isPolylineType = selectedMarkup.type === 'polyline' || selectedMarkup.type === 'polylineArrow' ||
                         selectedMarkup.type === 'cloudPolyline' || selectedMarkup.type === 'polygon';

  if (isPolylineType && selectedMarkup.points && selectedMarkup.points.length > 0) {
    const validPoints = selectedMarkup.points.filter(p => p && p.x !== undefined && p.y !== undefined);
    if (validPoints.length === 0) return null;

    return (
      <g className="markup-selection" style={gStyle} ref={selectionRef}>
        {/* Connecting lines between vertices */}
        {validPoints.map((point, i) => {
          if (i === 0) return null;
          const prevPoint = validPoints[i - 1];
          return (
            <line
              key={`line-${i}`}
              x1={prevPoint.x * scaledWidth} y1={prevPoint.y * scaledHeight}
              x2={point.x * scaledWidth} y2={point.y * scaledHeight}
              stroke="#0066ff" strokeWidth={1} strokeDasharray="5,3" pointerEvents="none"
            />
          );
        })}
        {/* Close polygon line */}
        {selectedMarkup.closed && validPoints.length > 2 && (
          <line
            x1={validPoints[validPoints.length - 1].x * scaledWidth}
            y1={validPoints[validPoints.length - 1].y * scaledHeight}
            x2={validPoints[0].x * scaledWidth}
            y2={validPoints[0].y * scaledHeight}
            stroke="#0066ff" strokeWidth={1} strokeDasharray="5,3" pointerEvents="none"
          />
        )}
        {/* Vertex point handles */}
        {!selectedMarkup.readOnly && validPoints.map((point, i) => {
          const originalIndex = selectedMarkup.points.indexOf(point);
          const px = point.x * scaledWidth;
          const py = point.y * scaledHeight;
          return (
            <g key={`point-${i}`}>
              <circle cx={px} cy={py} r={halfHit} fill="transparent" style={handleCursorStyle('move')} className="polyline-point-handle" data-point-index={originalIndex}
                onMouseDown={onPolylinePointMouseDown ? (e) => { e.stopPropagation(); onPolylinePointMouseDown(e, originalIndex); } : undefined} />
              <circle cx={px} cy={py} r={halfHandle} data-point-index={originalIndex}
                fill={draggingPolylinePoint === originalIndex ? '#ff6600' : '#0066ff'}
                stroke="#fff" strokeWidth={1.5} pointerEvents="none"
                style={{ filter: 'drop-shadow(0 0 2px rgba(0, 0, 0, 0.5))' }} />
            </g>
          );
        })}
      </g>
    );
  }

  // ── Bounding box with resize + rotate handles ────────────────────────
  // Fixed screen-pixel sizes for rotate handle
  const rotStem = 30;
  const rotRadius = 10;
  const rotHitRadius = 16;
  const rotStroke = 1.5;
  
  // Rotate handle position
  const rotHandleX = pMidX;
  const rotHandleY = pMinY - rotStem;
  
  // Custom rotation cursor
  const rotateCursor = ROTATE_CURSOR;
  
  // Rotate handle (shared JSX for text boxes, circles, rectangles)
  const rotateHandleJSX = (onRotateMouseDown && !selectedMarkup.readOnly) ? (
    <>
      {/* Stem line from shape top to rotate handle */}
      <line
        x1={pMidX} y1={pMinY} x2={rotHandleX} y2={rotHandleY}
        stroke="#0066ff" strokeWidth={rotStroke} strokeDasharray="3,2" pointerEvents="none"
        className="rotate-stem"
      />
      {/* Invisible hit area (larger than visual) */}
      <circle cx={rotHandleX} cy={rotHandleY} r={rotHitRadius} fill="transparent"
        style={{ cursor: rotateCursor }} className="rotate-handle"
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onRotateMouseDown(e, centerX, centerY, rotation); }} />
      {/* Visual circle */}
      <circle
        cx={rotHandleX} cy={rotHandleY} r={rotRadius}
        fill="#0066ff" stroke="#fff" strokeWidth={rotStroke} pointerEvents="none"
        className="rotate-visual"
      />
      {/* Rotation arrow icon inside the handle */}
      <g transform={`translate(${rotHandleX}, ${rotHandleY})`} pointerEvents="none" className="rotate-icon">
        <path
          d={`M 3.5 0 A 3.5 3.5 0 1 1 0.5 -3.2 M 3.5 0 L 5.5 -1.2 M 3.5 0 L 4.8 2`}
          fill="none" stroke="white" strokeWidth={1.2}
          strokeLinecap="round" strokeLinejoin="round"
        />
      </g>
    </>
  ) : null;

  // Check if this shape type supports rotation
  const canRotate = selectedMarkup.type === 'circle' || selectedMarkup.type === 'rectangle' || selectedMarkup.type === 'cloud' || selectedMarkup.type === 'symbol' || selectedMarkup.type === 'image' || isTextBox;

  return (
    <g className="markup-selection" transform={rotation ? `rotate(${rotation}, ${centerX}, ${centerY})` : undefined} style={gStyle} ref={selectionRef}>
      {/* Selection border */}
      <rect
        x={pMinX} y={pMinY}
        width={pMaxX - pMinX} height={pMaxY - pMinY}
        stroke="#0066ff" strokeWidth={2} strokeDasharray="5,3"
        fill="rgba(0, 102, 255, 0.05)"
        pointerEvents="none"
      />

      {/* Resize handles */}
      {canResize && (
        <>
          {/* Corner handles with hit areas */}
          <rect x={pMinX - halfHit} y={pMinY - halfHit} width={hitSize} height={hitSize} fill="transparent" style={handleCursorStyle('nw-resize')} className="resize-handle" data-handle="nw" />
          <rect x={pMinX - halfHandle} y={pMinY - halfHandle} width={handleSize} height={handleSize} fill="#0066ff" stroke="#fff" strokeWidth={1.5} rx={2} pointerEvents="none" className="resize-handle-visual" data-handle="nw" />
          <rect x={pMaxX - halfHit} y={pMinY - halfHit} width={hitSize} height={hitSize} fill="transparent" style={handleCursorStyle('ne-resize')} className="resize-handle" data-handle="ne" />
          <rect x={pMaxX - halfHandle} y={pMinY - halfHandle} width={handleSize} height={handleSize} fill="#0066ff" stroke="#fff" strokeWidth={1.5} rx={2} pointerEvents="none" className="resize-handle-visual" data-handle="ne" />
          <rect x={pMinX - halfHit} y={pMaxY - halfHit} width={hitSize} height={hitSize} fill="transparent" style={handleCursorStyle('sw-resize')} className="resize-handle" data-handle="sw" />
          <rect x={pMinX - halfHandle} y={pMaxY - halfHandle} width={handleSize} height={handleSize} fill="#0066ff" stroke="#fff" strokeWidth={1.5} rx={2} pointerEvents="none" className="resize-handle-visual" data-handle="sw" />
          <rect x={pMaxX - halfHit} y={pMaxY - halfHit} width={hitSize} height={hitSize} fill="transparent" style={handleCursorStyle('se-resize')} className="resize-handle" data-handle="se" />
          <rect x={pMaxX - halfHandle} y={pMaxY - halfHandle} width={handleSize} height={handleSize} fill="#0066ff" stroke="#fff" strokeWidth={1.5} rx={2} pointerEvents="none" className="resize-handle-visual" data-handle="se" />

          {/* Edge handles - not for text boxes */}
          {!isTextBox && (
            <>
              <rect x={pMidX - halfHit} y={pMinY - halfHit} width={hitSize} height={hitSize} fill="transparent" style={handleCursorStyle('n-resize')} className="resize-handle" data-handle="n" />
              <rect x={pMidX - halfHandle} y={pMinY - halfHandle} width={handleSize} height={handleSize} fill="#0066ff" stroke="#fff" strokeWidth={1.5} rx={2} pointerEvents="none" className="resize-handle-visual" data-handle="n" />
              <rect x={pMidX - halfHit} y={pMaxY - halfHit} width={hitSize} height={hitSize} fill="transparent" style={handleCursorStyle('s-resize')} className="resize-handle" data-handle="s" />
              <rect x={pMidX - halfHandle} y={pMaxY - halfHandle} width={handleSize} height={handleSize} fill="#0066ff" stroke="#fff" strokeWidth={1.5} rx={2} pointerEvents="none" className="resize-handle-visual" data-handle="s" />
              <rect x={pMinX - halfHit} y={pMidY - halfHit} width={hitSize} height={hitSize} fill="transparent" style={handleCursorStyle('w-resize')} className="resize-handle" data-handle="w" />
              <rect x={pMinX - halfHandle} y={pMidY - halfHandle} width={handleSize} height={handleSize} fill="#0066ff" stroke="#fff" strokeWidth={1.5} rx={2} pointerEvents="none" className="resize-handle-visual" data-handle="w" />
              <rect x={pMaxX - halfHit} y={pMidY - halfHit} width={hitSize} height={hitSize} fill="transparent" style={handleCursorStyle('e-resize')} className="resize-handle" data-handle="e" />
              <rect x={pMaxX - halfHandle} y={pMidY - halfHandle} width={handleSize} height={handleSize} fill="#0066ff" stroke="#fff" strokeWidth={1.5} rx={2} pointerEvents="none" className="resize-handle-visual" data-handle="e" />
            </>
          )}
        </>
      )}

      {/* Rotate handle - rendered LAST so it's on top of resize handles in SVG stacking order */}
      {canRotate && rotateHandleJSX}
    </g>
  );
}
