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
  const handleSize = 12;
  const halfHandle = handleSize / 2;
  const hitSize = 24; // invisible touch target
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
  const handleCursorStyle = (cursor) => gStyle?.pointerEvents === 'all'
    ? { cursor, pointerEvents: 'all' }
    : { cursor };

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
              fill="#0066ff" stroke="#fff" strokeWidth={1}
              style={handleCursorStyle('move')} pointerEvents="none"
            />
            <circle cx={p2X} cy={p2Y} r={halfHit} fill="transparent" style={handleCursorStyle('move')} className="resize-handle" data-handle="end" />
            <circle
              cx={p2X} cy={p2Y} r={halfHandle}
              fill="#0066ff" stroke="#fff" strokeWidth={1}
              style={handleCursorStyle('move')} pointerEvents="none"
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
            <circle cx={p1X} cy={p1Y} r={halfHandle} fill="#0066ff" stroke="#fff" strokeWidth={1} pointerEvents="none" />
            <circle cx={p2X} cy={p2Y} r={halfHit} fill="transparent" style={handleCursorStyle('move')} className="arc-handle" data-arc-handle="point2"
              onMouseDown={onArcHandleMouseDown ? (e) => { e.stopPropagation(); onArcHandleMouseDown(e, 'point2'); } : undefined} />
            <circle cx={p2X} cy={p2Y} r={halfHandle} fill="#0066ff" stroke="#fff" strokeWidth={1} pointerEvents="none" />
            <circle cx={ctrlX} cy={ctrlY} r={halfHit} fill="transparent" style={handleCursorStyle('crosshair')} className="arc-handle" data-arc-handle="bulge"
              onMouseDown={onArcHandleMouseDown ? (e) => { e.stopPropagation(); onArcHandleMouseDown(e, 'bulge'); } : undefined} />
            <circle cx={ctrlX} cy={ctrlY} r={halfHandle} fill="#ff6600" stroke="#fff" strokeWidth={1} pointerEvents="none" />
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
              <circle cx={px} cy={py} r={halfHandle}
                fill={draggingPolylinePoint === originalIndex ? '#ff6600' : '#0066ff'}
                stroke="#fff" strokeWidth={1} pointerEvents="none" />
            </g>
          );
        })}
      </g>
    );
  }

  // ── Bounding box with resize + rotate handles ────────────────────────
  // Rotate handle (shared JSX for text boxes, circles, rectangles)
  const rotateHandleJSX = (onRotateMouseDown && !selectedMarkup.readOnly) ? (
    <>
      <line
        x1={pMidX} y1={pMinY} x2={pMidX} y2={pMinY - 25}
        stroke="#0066ff" strokeWidth={1} pointerEvents="none"
      />
      <circle cx={pMidX} cy={pMinY - 25} r={halfHit} fill="transparent"
        style={{ cursor: 'grab' }} className="rotate-handle"
        onMouseDown={(e) => { e.stopPropagation(); onRotateMouseDown(e, centerX, centerY, rotation); }} />
      <circle
        cx={pMidX} cy={pMinY - 25} r={8}
        fill="#0066ff" stroke="#fff" strokeWidth={1} pointerEvents="none"
      />
      <text
        x={pMidX} y={pMinY - 21}
        textAnchor="middle" fill="white" fontSize="10"
        pointerEvents="none" style={{ userSelect: 'none' }}
      >↻</text>
    </>
  ) : null;

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

      {/* Rotate handle for text boxes */}
      {isTextBox && rotateHandleJSX}

      {/* Rotate handle for circles and rectangles */}
      {(selectedMarkup.type === 'circle' || selectedMarkup.type === 'rectangle') && rotateHandleJSX}

      {/* Resize handles */}
      {canResize && (
        <>
          {/* Corner handles with hit areas */}
          <rect x={pMinX - halfHit} y={pMinY - halfHit} width={hitSize} height={hitSize} fill="transparent" style={handleCursorStyle('nw-resize')} className="resize-handle" data-handle="nw" />
          <rect x={pMinX - halfHandle} y={pMinY - halfHandle} width={handleSize} height={handleSize} fill="#0066ff" stroke="#fff" strokeWidth={1} pointerEvents="none" />
          <rect x={pMaxX - halfHit} y={pMinY - halfHit} width={hitSize} height={hitSize} fill="transparent" style={handleCursorStyle('ne-resize')} className="resize-handle" data-handle="ne" />
          <rect x={pMaxX - halfHandle} y={pMinY - halfHandle} width={handleSize} height={handleSize} fill="#0066ff" stroke="#fff" strokeWidth={1} pointerEvents="none" />
          <rect x={pMinX - halfHit} y={pMaxY - halfHit} width={hitSize} height={hitSize} fill="transparent" style={handleCursorStyle('sw-resize')} className="resize-handle" data-handle="sw" />
          <rect x={pMinX - halfHandle} y={pMaxY - halfHandle} width={handleSize} height={handleSize} fill="#0066ff" stroke="#fff" strokeWidth={1} pointerEvents="none" />
          <rect x={pMaxX - halfHit} y={pMaxY - halfHit} width={hitSize} height={hitSize} fill="transparent" style={handleCursorStyle('se-resize')} className="resize-handle" data-handle="se" />
          <rect x={pMaxX - halfHandle} y={pMaxY - halfHandle} width={handleSize} height={handleSize} fill="#0066ff" stroke="#fff" strokeWidth={1} pointerEvents="none" />

          {/* Edge handles - not for text boxes */}
          {!isTextBox && (
            <>
              <rect x={pMidX - halfHit} y={pMinY - halfHit} width={hitSize} height={hitSize} fill="transparent" style={handleCursorStyle('n-resize')} className="resize-handle" data-handle="n" />
              <rect x={pMidX - halfHandle} y={pMinY - halfHandle} width={handleSize} height={handleSize} fill="#0066ff" stroke="#fff" strokeWidth={1} pointerEvents="none" />
              <rect x={pMidX - halfHit} y={pMaxY - halfHit} width={hitSize} height={hitSize} fill="transparent" style={handleCursorStyle('s-resize')} className="resize-handle" data-handle="s" />
              <rect x={pMidX - halfHandle} y={pMaxY - halfHandle} width={handleSize} height={handleSize} fill="#0066ff" stroke="#fff" strokeWidth={1} pointerEvents="none" />
              <rect x={pMinX - halfHit} y={pMidY - halfHit} width={hitSize} height={hitSize} fill="transparent" style={handleCursorStyle('w-resize')} className="resize-handle" data-handle="w" />
              <rect x={pMinX - halfHandle} y={pMidY - halfHandle} width={handleSize} height={handleSize} fill="#0066ff" stroke="#fff" strokeWidth={1} pointerEvents="none" />
              <rect x={pMaxX - halfHit} y={pMidY - halfHit} width={hitSize} height={hitSize} fill="transparent" style={handleCursorStyle('e-resize')} className="resize-handle" data-handle="e" />
              <rect x={pMaxX - halfHandle} y={pMidY - halfHandle} width={handleSize} height={handleSize} fill="#0066ff" stroke="#fff" strokeWidth={1} pointerEvents="none" />
            </>
          )}
        </>
      )}
    </g>
  );
}
