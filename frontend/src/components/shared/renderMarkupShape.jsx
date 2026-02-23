/**
 * renderMarkupShape.js
 * 
 * Shared markup shape renderer - handles all markup types.
 * Extracted from SinglePageView's complete implementation to eliminate
 * duplication across SinglePageView, ContinuousView, and SideBySideView.
 * 
 * Usage:
 *   import { renderMarkupShape } from './renderMarkupShape';
 *   
 *   {pageMarkups.map(markup => renderMarkupShape(markup, opts))}
 */
import React from 'react';

/**
 * Render a single markup shape as SVG JSX.
 * 
 * @param {Object} markup - The markup object to render
 * @param {Object} opts - Rendering options
 * @param {number} opts.scaledWidth - SVG viewBox width (canvasSize.width * scale or pageWidth)
 * @param {number} opts.scaledHeight - SVG viewBox height (canvasSize.height * scale or pageHeight)
 * @param {number} opts.scale - Current zoom scale
 * @param {number} opts.scaledStrokeWidth - Pre-computed (markup.strokeWidth || 2) * scale
 * @param {number} [opts.rotation=0] - Page rotation in degrees (0, 90, 180, 270)
 * @param {Function} [opts.transformCoordinate] - (x, y) => {x, y} for PDF annotation rotation
 * @param {Function} opts.getLineDashArray - (style, strokeWidth) => array|null
 * @param {Object} [opts.selectedMarkup] - Currently selected markup (for conditional rendering)
 * @param {string} [opts.markupMode] - Current markup tool mode
 * @param {boolean} [opts.selectMode] - Whether in select mode
 * @param {boolean} [opts.markupEditMode] - Whether in edit mode
 * @param {string} [opts.editingTextMarkupId] - ID of markup being text-edited (skip rendering)
 * @param {Set} [opts.expandedNotes] - Set of expanded note IDs
 * @param {Function} [opts.toggleNoteExpanded] - Toggle note expansion
 * @param {Function} [opts.setEditingNoteId] - Set note editing ID
 * @param {Function} [opts.setNoteText] - Set note text
 * @param {Function} [opts.setNoteDialogPosition] - Set note dialog position
 * @param {Function} [opts.setShowNoteDialog] - Show note dialog
 * @param {Object} [opts.canvasSize] - {width, height} for note position calculation
 * @returns {React.ReactElement|null}
 */
export function renderMarkupShape(markup, opts) {
  const {
    scaledWidth, scaledHeight, scale,
    scaledStrokeWidth,
    rotation = 0,
    transformCoordinate,
    getLineDashArray,
    selectedMarkup,
    markupMode, selectMode, markupEditMode,
    editingTextMarkupId,
    expandedNotes,
    toggleNoteExpanded,
    setEditingNoteId, setNoteText, setNoteDialogPosition, setShowNoteDialog,
    canvasSize,
  } = opts;

  // Guard against NaN values when canvas isn't ready
  if (!scaledWidth || !scaledHeight || isNaN(scaledWidth) || isNaN(scaledHeight)) return null;

  // Helper to transform coordinates for PDF annotations when page is rotated
  const shouldTransform = rotation !== 0;
  const tx = (x, y) => shouldTransform && transformCoordinate ? transformCoordinate(x, y) : { x, y };

  // ── Pen / Highlighter ────────────────────────────────────────────────
  if (markup.type === 'pen' || markup.type === 'highlighter') {
    if (!markup.points || markup.points.length < 2) return null;
    const pathData = markup.points
      .map((p, i) => {
        const tp = tx(p.x, p.y);
        return `${i === 0 ? 'M' : 'L'} ${tp.x * scaledWidth} ${tp.y * scaledHeight}`;
      })
      .join(' ');
    return (
      <g key={markup.id} data-markup-id={markup.id}>
        <path
          d={pathData}
          stroke={markup.color}
          strokeWidth={scaledStrokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={markup.opacity || 1}
        />
      </g>
    );
  }

  // ── Rectangle ────────────────────────────────────────────────────────
  if (markup.type === 'rectangle') {
    const p1 = tx(markup.startX, markup.startY);
    const p2 = tx(markup.endX, markup.endY);
    const x = Math.min(p1.x, p2.x) * scaledWidth;
    const y = Math.min(p1.y, p2.y) * scaledHeight;
    const w = Math.abs(p2.x - p1.x) * scaledWidth;
    const h = Math.abs(p2.y - p1.y) * scaledHeight;
    const fillColor = markup.fillColor === 'none' ? 'transparent' : (markup.fillColor || 'none');
    const strokeColor = markup.color === 'none' ? 'transparent' : (markup.color || 'red');
    const rotationDeg = markup.rotation || 0;
    const centerX = x + w / 2;
    const centerY = y + h / 2;
    const transform = rotationDeg !== 0 ? `rotate(${rotationDeg}, ${centerX}, ${centerY})` : undefined;
    const strokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
    const fillOpacity = markup.fillOpacity !== undefined ? markup.fillOpacity : (markup.opacity || 1);
    const dashArray = markup.lineStyle ? getLineDashArray(markup.lineStyle, scaledStrokeWidth) : (markup.dashArray ? markup.dashArray.map(d => d * scale) : null);

    return (
      <g key={markup.id} data-markup-id={markup.id} transform={transform}>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          stroke={strokeColor}
          strokeWidth={markup.color === 'none' ? 0 : scaledStrokeWidth}
          strokeDasharray={dashArray ? dashArray.join(',') : undefined}
          strokeOpacity={strokeOpacity}
          fill={fillColor}
          fillOpacity={markup.fillColor === 'none' ? 0 : fillOpacity}
        />
      </g>
    );
  }

  // ── Arrow ────────────────────────────────────────────────────────────
  if (markup.type === 'arrow') {
    const p1 = tx(markup.startX, markup.startY);
    const p2 = tx(markup.endX, markup.endY);
    const x1 = p1.x * scaledWidth;
    const y1 = p1.y * scaledHeight;
    const x2 = p2.x * scaledWidth;
    const y2 = p2.y * scaledHeight;

    const arrowAtStart = markup.fromPdf && markup.hasArrowAtEnd && !markup.hasArrowAtStart;
    const tailX = arrowAtStart ? x2 : x1;
    const tailY = arrowAtStart ? y2 : y1;
    const headX = arrowAtStart ? x1 : x2;
    const headY = arrowAtStart ? y1 : y2;

    const angle = Math.atan2(headY - tailY, headX - tailX);
    const arrowLength = (markup.arrowHeadSize || 12) * scale;
    const arrowAngle = Math.PI / 7;
    const lineEndX = headX - arrowLength * 0.7 * Math.cos(angle);
    const lineEndY = headY - arrowLength * 0.7 * Math.sin(angle);

    const dashArray = markup.lineStyle ? getLineDashArray(markup.lineStyle, scaledStrokeWidth) : null;
    const strokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);

    return (
      <g key={markup.id} data-markup-id={markup.id}>
        <line
          x1={tailX} y1={tailY}
          x2={lineEndX} y2={lineEndY}
          stroke={markup.color}
          strokeWidth={scaledStrokeWidth}
          strokeDasharray={dashArray ? dashArray.join(',') : undefined}
          opacity={strokeOpacity}
        />
        <polygon
          points={`
            ${headX},${headY}
            ${headX - arrowLength * Math.cos(angle - arrowAngle)},${headY - arrowLength * Math.sin(angle - arrowAngle)}
            ${headX - arrowLength * Math.cos(angle + arrowAngle)},${headY - arrowLength * Math.sin(angle + arrowAngle)}
          `}
          fill={markup.color}
          opacity={strokeOpacity}
        />
      </g>
    );
  }

  // ── Text ─────────────────────────────────────────────────────────────
  if (markup.type === 'text') {
    const fontSize = (markup.fontSize || 12) * scale;
    const isTextBox = markup.startX !== undefined && markup.endX !== undefined;
    const rotationDeg = markup.rotation || 0;

    if (isTextBox) {
      const isSelectedMarkup = selectedMarkup && markup.id === selectedMarkup.id;
      const useTx = rotation !== 0 && !isSelectedMarkup;
      const p1 = useTx ? tx(markup.startX, markup.startY) : { x: markup.startX, y: markup.startY };
      const p2 = useTx ? tx(markup.endX, markup.endY) : { x: markup.endX, y: markup.endY };

      const boxX = Math.min(p1.x, p2.x) * scaledWidth;
      const boxY = Math.min(p1.y, p2.y) * scaledHeight;
      const boxW = Math.abs(p2.x - p1.x) * scaledWidth;
      const boxH = Math.abs(p2.y - p1.y) * scaledHeight;
      const padding = (markup.padding !== undefined ? markup.padding : 4) * scale;
      const borderWidth = markup.borderWidth || 1;
      const centerX = boxX + boxW / 2;
      const centerY = boxY + boxH / 2;

      if (editingTextMarkupId === markup.id) return null;

      const borderColor = markup.borderColor === 'none' ? 'transparent' : (markup.borderColor || markup.color || '#333');
      const fillColor = markup.fillColor === 'none' || !markup.fillColor ? 'transparent' : markup.fillColor;
      const textBoxOpacity = markup.opacity !== undefined ? markup.opacity : 1;
      const isVerticalText = rotationDeg === 90 || rotationDeg === 270 || rotationDeg === -90;
      const cursorStyle = (markupMode === 'select' || selectMode) ? 'pointer' : 'default';

      if (isVerticalText) {
        const textRotation = rotationDeg === 90 ? 90 : -90;
        const textWidth = boxH;
        const textHeight = boxW;

        return (
          <g key={markup.id} data-markup-id={markup.id} opacity={textBoxOpacity}>
            <rect
              x={boxX} y={boxY} width={boxW} height={boxH}
              stroke={borderColor}
              strokeWidth={borderColor === 'transparent' ? 0 : borderWidth * scale}
              fill={fillColor}
              style={{ cursor: cursorStyle }}
            />
            <g transform={`rotate(${textRotation}, ${centerX}, ${centerY})`}>
              <foreignObject
                x={centerX - textWidth / 2}
                y={centerY - textHeight / 2}
                width={textWidth}
                height={textHeight}
              >
                <div
                  xmlns="http://www.w3.org/1999/xhtml"
                  style={{
                    width: '100%', height: '100%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: `${fontSize}px`,
                    fontFamily: (markup.fontFamily || 'Helvetica') + ', Arial, sans-serif',
                    color: markup.color || '#000',
                    whiteSpace: 'nowrap', overflow: 'visible',
                    cursor: cursorStyle, userSelect: 'none',
                  }}
                >
                  {markup.text || ''}
                </div>
              </foreignObject>
            </g>
          </g>
        );
      }

      const transform = rotationDeg !== 0 ? `rotate(${rotationDeg}, ${centerX}, ${centerY})` : undefined;

      return (
        <g key={markup.id} data-markup-id={markup.id} transform={transform} opacity={textBoxOpacity}>
          <rect
            x={boxX} y={boxY} width={boxW} height={boxH}
            stroke={borderColor}
            strokeWidth={borderColor === 'transparent' ? 0 : borderWidth * scale}
            fill={fillColor}
            style={{ cursor: cursorStyle }}
          />
          <foreignObject x={boxX} y={boxY} width={boxW} height={boxH}>
            <div
              xmlns="http://www.w3.org/1999/xhtml"
              style={{
                width: '100%', height: '100%',
                padding: `${padding}px`,
                fontSize: `${fontSize}px`,
                fontFamily: (markup.fontFamily || 'Helvetica') + ', Arial, sans-serif',
                color: markup.color || '#000',
                overflow: 'hidden', wordWrap: 'break-word', whiteSpace: 'pre-wrap',
                lineHeight: markup.lineSpacing || 1.2,
                boxSizing: 'border-box',
                cursor: cursorStyle, userSelect: 'none',
                textAlign: markup.textAlign || 'left',
                display: 'flex', flexDirection: 'column',
                justifyContent: markup.verticalAlign === 'middle' ? 'center' : markup.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
              }}
            >
              <span style={{ display: 'block' }}>{markup.text || ''}</span>
            </div>
          </foreignObject>
        </g>
      );
    } else {
      // Old format (from PDF) - single point text with origBounds
      const tp = tx(markup.x, markup.y);
      const textX = tp.x * scaledWidth;
      const textY = tp.y * scaledHeight;
      let cX = textX, cY = textY;
      if (markup.origBounds) {
        const ob1 = tx(markup.origBounds.x1, markup.origBounds.y1);
        const ob2 = tx(markup.origBounds.x2, markup.origBounds.y2);
        cX = ((ob1.x + ob2.x) / 2) * scaledWidth;
        cY = ((ob1.y + ob2.y) / 2) * scaledHeight;
      }
      const transform = rotationDeg !== 0 ? `rotate(${rotationDeg}, ${cX}, ${cY})` : undefined;

      return (
        <g key={markup.id} data-markup-id={markup.id} transform={transform}>
          <text
            x={textX} y={textY}
            fill={markup.color || 'blue'}
            fontSize={fontSize}
            fontFamily={markup.fontFamily || 'Arial, sans-serif'}
            dominantBaseline="hanging"
            textAnchor={markup.textAlign === 'center' ? 'middle' : markup.textAlign === 'right' ? 'end' : 'start'}
            style={{ cursor: (markupMode === 'select' || selectMode) ? 'pointer' : 'default' }}
          >
            {markup.text || '[NO TEXT]'}
          </text>
        </g>
      );
    }
  }

  // ── Circle / Ellipse ─────────────────────────────────────────────────
  if (markup.type === 'circle') {
    const p1 = tx(markup.startX, markup.startY);
    const p2 = tx(markup.endX, markup.endY);
    const cx = ((p1.x + p2.x) / 2) * scaledWidth;
    const cy = ((p1.y + p2.y) / 2) * scaledHeight;
    const rx = Math.abs(p2.x - p1.x) * scaledWidth / 2;
    const ry = Math.abs(p2.y - p1.y) * scaledHeight / 2;
    const fillColor = markup.fillColor === 'none' ? 'transparent' : (markup.fillColor || 'none');
    const strokeColor = markup.color === 'none' ? 'transparent' : (markup.color || 'red');
    const rotationDeg = markup.rotation || 0;
    const transform = rotationDeg !== 0 ? `rotate(${rotationDeg}, ${cx}, ${cy})` : undefined;
    const strokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
    const fillOpacity = markup.fillOpacity !== undefined ? markup.fillOpacity : (markup.opacity || 1);
    const dashArray = markup.lineStyle ? getLineDashArray(markup.lineStyle, scaledStrokeWidth) : (markup.dashArray ? markup.dashArray.map(d => d * scale) : null);

    return (
      <g key={markup.id} data-markup-id={markup.id} transform={transform}>
        <ellipse
          cx={cx} cy={cy} rx={rx} ry={ry}
          stroke={strokeColor}
          strokeWidth={markup.color === 'none' ? 0 : scaledStrokeWidth}
          strokeDasharray={dashArray ? dashArray.join(',') : undefined}
          strokeOpacity={strokeOpacity}
          fill={fillColor}
          fillOpacity={markup.fillColor === 'none' ? 0 : fillOpacity}
        />
      </g>
    );
  }

  // ── Arc ──────────────────────────────────────────────────────────────
  if (markup.type === 'arc') {
    if (markup.point1X === undefined) return null;
    const ap1 = tx(markup.point1X, markup.point1Y);
    const ap2 = tx(markup.point2X, markup.point2Y);
    const p1x = ap1.x * scaledWidth;
    const p1y = ap1.y * scaledHeight;
    const p2x = ap2.x * scaledWidth;
    const p2y = ap2.y * scaledHeight;
    const bulge = markup.arcBulge !== undefined ? markup.arcBulge : 0.5;
    const strokeColor = markup.color || '#ff0000';
    const strokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : 1;
    const dashArray = markup.lineStyle ? getLineDashArray(markup.lineStyle, scaledStrokeWidth) : null;

    const midX = (p1x + p2x) / 2;
    const midY = (p1y + p2y) / 2;
    const chordDx = p2x - p1x;
    const chordDy = p2y - p1y;
    const chordLen = Math.sqrt(chordDx * chordDx + chordDy * chordDy);
    const perpX = chordLen > 0 ? -chordDy / chordLen : 0;
    const perpY = chordLen > 0 ? chordDx / chordLen : 1;
    const bulgeOffset = chordLen * bulge;
    const ctrlX = midX + perpX * bulgeOffset;
    const ctrlY = midY + perpY * bulgeOffset;
    const arcPath = `M ${p1x} ${p1y} Q ${ctrlX} ${ctrlY} ${p2x} ${p2y}`;

    return (
      <path
        key={markup.id}
        data-markup-id={markup.id}
        d={arcPath}
        stroke={strokeColor}
        strokeWidth={scaledStrokeWidth}
        strokeOpacity={strokeOpacity}
        strokeDasharray={dashArray ? dashArray.join(',') : undefined}
        fill="none"
        strokeLinecap="round"
      />
    );
  }

  // ── Stamp ────────────────────────────────────────────────────────────
  if (markup.type === 'stamp') {
    const p1 = tx(markup.startX, markup.startY);
    const p2 = tx(markup.endX, markup.endY);
    const x = Math.min(p1.x, p2.x) * scaledWidth;
    const y = Math.min(p1.y, p2.y) * scaledHeight;
    const w = Math.abs(p2.x - p1.x) * scaledWidth;
    const h = Math.abs(p2.y - p1.y) * scaledHeight;
    const rotationDeg = markup.rotation || 0;
    const centerX = x + w / 2;
    const centerY = y + h / 2;
    const transform = rotationDeg !== 0 ? `rotate(${rotationDeg}, ${centerX}, ${centerY})` : undefined;

    return (
      <g key={markup.id} transform={transform} opacity={markup.opacity || 1}>
        <rect
          x={x} y={y} width={w} height={h}
          stroke={markup.color || '#9333ea'}
          strokeWidth={2 * scale}
          strokeDasharray={`${5 * scale},${3 * scale}`}
          fill="rgba(147, 51, 234, 0.1)"
        />
        <text
          x={x + w / 2} y={y + h / 2}
          fill={markup.color || '#9333ea'}
          fontSize={10 * scale}
          fontFamily="Arial, sans-serif"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          📎 {markup.stampName || 'Stamp'}
        </text>
      </g>
    );
  }

  // ── Line ─────────────────────────────────────────────────────────────
  if (markup.type === 'line') {
    const p1 = tx(markup.startX, markup.startY);
    const p2 = tx(markup.endX, markup.endY);
    const dashArray = markup.lineStyle ? getLineDashArray(markup.lineStyle, scaledStrokeWidth) : null;
    const strokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
    return (
      <g key={markup.id} data-markup-id={markup.id}>
        <line
          x1={p1.x * scaledWidth} y1={p1.y * scaledHeight}
          x2={p2.x * scaledWidth} y2={p2.y * scaledHeight}
          stroke={markup.color}
          strokeWidth={scaledStrokeWidth}
          strokeDasharray={dashArray ? dashArray.join(',') : undefined}
          opacity={strokeOpacity}
        />
      </g>
    );
  }

  // ── Note (Sticky Note) ──────────────────────────────────────────────
  if (markup.type === 'note') {
    const tp = tx(markup.x, markup.y);
    const x = tp.x * scaledWidth;
    const y = tp.y * scaledHeight;
    const isExpanded = expandedNotes && expandedNotes.has(markup.id);
    const noteSize = 24 * scale;
    const noteOffset = 12 * scale;
    return (
      <g
        key={markup.id}
        data-markup-id={markup.id}
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          toggleNoteExpanded && toggleNoteExpanded(markup.id);
        }}
      >
        <rect
          x={x - noteOffset} y={y - noteOffset}
          width={noteSize} height={noteSize}
          rx={3 * scale}
          fill={markup.color || '#ffeb3b'}
          stroke={selectedMarkup?.id === markup.id ? '#0066ff' : 'rgba(0,0,0,0.2)'}
          strokeWidth={selectedMarkup?.id === markup.id ? 2 * scale : 1 * scale}
        />
        <text
          x={x} y={y + 4 * scale}
          fontSize={14 * scale} textAnchor="middle"
          fill="rgba(0,0,0,0.6)"
        >
          📝
        </text>
        {isExpanded && (
          <foreignObject
            x={x + 15 * scale} y={y - 10 * scale}
            width={200 * scale} height={150 * scale}
            style={{ overflow: 'visible' }}
          >
            <div
              xmlns="http://www.w3.org/1999/xhtml"
              style={{
                background: markup.color || '#ffeb3b',
                padding: `${8 * scale}px`,
                borderRadius: `${4 * scale}px`,
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                fontSize: `${12 * scale}px`,
                maxWidth: `${200 * scale}px`,
                wordWrap: 'break-word',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontWeight: 'bold', marginBottom: `${4 * scale}px`, fontSize: `${10 * scale}px`, color: 'rgba(0,0,0,0.5)' }}>
                {markup.author || 'Note'} • {markup.createdDate ? new Date(markup.createdDate).toLocaleDateString() : ''}
              </div>
              {markup.text || '(empty note)'}
              <div style={{ marginTop: `${6 * scale}px`, display: 'flex', gap: `${4 * scale}px` }}>
                <button
                  style={{ fontSize: `${10 * scale}px`, padding: `${2 * scale}px ${6 * scale}px`, cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingNoteId && setEditingNoteId(markup.id);
                    setNoteText && setNoteText(markup.text || '');
                    setNoteDialogPosition && canvasSize && setNoteDialogPosition({ x: markup.x * canvasSize.width, y: markup.y * canvasSize.height });
                    setShowNoteDialog && setShowNoteDialog(true);
                  }}
                >
                  Edit
                </button>
              </div>
            </div>
          </foreignObject>
        )}
      </g>
    );
  }

  // ── Cloud ────────────────────────────────────────────────────────────
  if (markup.type === 'cloud') {
    const cp1 = tx(markup.startX, markup.startY);
    const cp2 = tx(markup.endX, markup.endY);
    const x = Math.min(cp1.x, cp2.x) * scaledWidth;
    const y = Math.min(cp1.y, cp2.y) * scaledHeight;
    const w = Math.abs(cp2.x - cp1.x) * scaledWidth;
    const h = Math.abs(cp2.y - cp1.y) * scaledHeight;
    const inverted = markup.inverted ?? markup.cloudInverted ?? false;

    const refSize = 800;
    const normW = Math.abs(cp2.x - cp1.x) * refSize;
    const normH = Math.abs(cp2.y - cp1.y) * refSize;
    const targetArcDiameter = markup.arcSize || markup.cloudArcSize || 15;

    const normPerimeter = 2 * (normW + normH);
    const totalArcs = Math.max(4, Math.round(normPerimeter / targetArcDiameter));
    const screenPerimeter = 2 * (w + h);
    const uniformArcDiameter = screenPerimeter / totalArcs;
    const arcRadius = uniformArcDiameter / 2;
    const numArcsX = Math.max(1, Math.round(w / uniformArcDiameter));
    const numArcsY = Math.max(1, Math.round(h / uniformArcDiameter));
    const spacingX = w / numArcsX;
    const spacingY = h / numArcsY;
    const sweepOut = inverted ? 0 : 1;

    let cloudPath = `M ${x} ${y}`;
    for (let i = 0; i < numArcsX; i++) cloudPath += ` A ${arcRadius} ${arcRadius} 0 0 ${sweepOut} ${x + (i + 1) * spacingX} ${y}`;
    for (let i = 0; i < numArcsY; i++) cloudPath += ` A ${arcRadius} ${arcRadius} 0 0 ${sweepOut} ${x + w} ${y + (i + 1) * spacingY}`;
    for (let i = numArcsX - 1; i >= 0; i--) cloudPath += ` A ${arcRadius} ${arcRadius} 0 0 ${sweepOut} ${x + i * spacingX} ${y + h}`;
    for (let i = numArcsY - 1; i >= 0; i--) cloudPath += ` A ${arcRadius} ${arcRadius} 0 0 ${sweepOut} ${x} ${y + i * spacingY}`;
    cloudPath += ' Z';

    const fillColor = markup.fillColor === 'none' ? 'transparent' : (markup.fillColor || 'none');
    const strokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : 1;
    const fillOpacity = markup.fillOpacity !== undefined ? markup.fillOpacity : 0.3;

    return (
      <path
        key={markup.id}
        data-markup-id={markup.id}
        d={cloudPath}
        stroke={markup.color}
        strokeWidth={scaledStrokeWidth}
        strokeOpacity={strokeOpacity}
        fill={fillColor}
        fillOpacity={markup.fillColor === 'none' ? 0 : fillOpacity}
      />
    );
  }

  // ── Callout ──────────────────────────────────────────────────────────
  if (markup.type === 'callout') {
    const cp1 = tx(markup.startX, markup.startY);
    const cp2 = tx(markup.endX, markup.endY);
    const x = Math.min(cp1.x, cp2.x) * scaledWidth;
    const y = Math.min(cp1.y, cp2.y) * scaledHeight;
    const w = Math.abs(cp2.x - cp1.x) * scaledWidth;
    const h = Math.abs(cp2.y - cp1.y) * scaledHeight;

    return (
      <g key={markup.id} data-markup-id={markup.id}>
        <rect
          x={x} y={y} width={w} height={h}
          rx={4 * scale}
          stroke={markup.color}
          strokeWidth={scaledStrokeWidth}
          fill="rgba(255,255,255,0.9)"
        />
        <polygon
          points={`${x},${y + h - 5 * scale} ${x},${y + h + 15 * scale} ${x + 20 * scale},${y + h}`}
          fill="rgba(255,255,255,0.9)"
          stroke={markup.color}
          strokeWidth={scaledStrokeWidth}
        />
        {markup.text && (
          <text
            x={x + 5 * scale} y={y + 15 * scale}
            fill={markup.color} fontSize={12 * scale}
            fontFamily="Arial, sans-serif"
          >
            {markup.text}
          </text>
        )}
      </g>
    );
  }

  // ── Polyline ─────────────────────────────────────────────────────────
  if (markup.type === 'polyline') {
    if (!markup.points || markup.points.length < 2) return null;
    const validPoints = markup.points
      .filter(p => p && p.x !== undefined && p.y !== undefined)
      .map(p => tx(p.x, p.y));
    if (validPoints.length < 2) return null;
    const pathData = validPoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * scaledWidth} ${p.y * scaledHeight}`)
      .join(' ') + (markup.closed ? ' Z' : '');
    const fillColor = markup.fillColor === 'none' ? 'transparent' : (markup.fillColor || 'none');
    const showFill = markup.closed && fillColor !== 'transparent' && fillColor !== 'none';
    const dashArray = markup.lineStyle ? getLineDashArray(markup.lineStyle, scaledStrokeWidth) : (markup.dashArray ? markup.dashArray.map(d => d * scale) : null);
    return (
      <path
        key={markup.id}
        data-markup-id={markup.id}
        d={pathData}
        stroke={markup.color}
        strokeWidth={scaledStrokeWidth}
        strokeOpacity={markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1)}
        strokeDasharray={dashArray ? dashArray.join(',') : undefined}
        fill={showFill ? fillColor : 'none'}
        fillOpacity={showFill ? (markup.fillOpacity !== undefined ? markup.fillOpacity : 0.3) : 0}
      />
    );
  }

  // ── Polyline with Arrow ──────────────────────────────────────────────
  if (markup.type === 'polylineArrow') {
    if (!markup.points || markup.points.length < 2) return null;
    const validPoints = markup.points
      .filter(p => p && p.x !== undefined && p.y !== undefined)
      .map(p => tx(p.x, p.y));
    if (validPoints.length < 2) return null;

    const isClosed = markup.closed || false;
    const lastPt = validPoints[validPoints.length - 1];
    const prevPt = validPoints[validPoints.length - 2];
    const endX = lastPt.x * scaledWidth;
    const endY = lastPt.y * scaledHeight;
    const startX = prevPt.x * scaledWidth;
    const startY = prevPt.y * scaledHeight;

    const angle = Math.atan2(endY - startY, endX - startX);
    const arrowLength = (markup.arrowHeadSize || 12) * scale;
    const arrowAngle = Math.PI / 7;
    const lineEndX = endX - arrowLength * 0.7 * Math.cos(angle);
    const lineEndY = endY - arrowLength * 0.7 * Math.sin(angle);

    let pathData = '';
    for (let i = 0; i < validPoints.length; i++) {
      const p = validPoints[i];
      if (i === 0) pathData += `M ${p.x * scaledWidth} ${p.y * scaledHeight}`;
      else if (i === validPoints.length - 1) pathData += ` L ${lineEndX} ${lineEndY}`;
      else pathData += ` L ${p.x * scaledWidth} ${p.y * scaledHeight}`;
    }
    if (isClosed && validPoints.length >= 2) {
      const firstPt = validPoints[0];
      pathData += ` L ${endX} ${endY} L ${firstPt.x * scaledWidth} ${firstPt.y * scaledHeight}`;
    }

    const dashArray = markup.lineStyle ? getLineDashArray(markup.lineStyle, scaledStrokeWidth) : null;

    return (
      <g key={markup.id} data-markup-id={markup.id}>
        <path
          d={pathData}
          stroke={markup.color}
          strokeWidth={scaledStrokeWidth}
          strokeOpacity={markup.strokeOpacity !== undefined ? markup.strokeOpacity : 1}
          strokeDasharray={dashArray ? dashArray.join(',') : undefined}
          fill="none"
        />
        <polygon
          points={`
            ${endX},${endY}
            ${endX - arrowLength * Math.cos(angle - arrowAngle)},${endY - arrowLength * Math.sin(angle - arrowAngle)}
            ${endX - arrowLength * Math.cos(angle + arrowAngle)},${endY - arrowLength * Math.sin(angle + arrowAngle)}
          `}
          fill={markup.color}
          fillOpacity={markup.strokeOpacity !== undefined ? markup.strokeOpacity : 1}
        />
      </g>
    );
  }

  // ── Cloud Polyline ───────────────────────────────────────────────────
  if (markup.type === 'cloudPolyline') {
    if (!markup.points || markup.points.length < 2) return null;
    const validPoints = markup.points
      .filter(p => p && p.x !== undefined && p.y !== undefined)
      .map(p => tx(p.x, p.y));
    if (validPoints.length < 2) return null;

    const inverted = markup.inverted ?? markup.cloudInverted ?? false;
    const sweepDir = inverted ? 0 : 1;
    const isClosed = markup.closed || false;
    const baseSize = 800;
    const normArcDiameter = markup.arcSize || markup.cloudArcSize || 15;
    const numSegments = isClosed ? validPoints.length : validPoints.length - 1;

    let cloudPath = '';
    for (let i = 0; i < numSegments; i++) {
      const pt1 = validPoints[i];
      const pt2 = validPoints[(i + 1) % validPoints.length];
      const normDx = (pt2.x - pt1.x) * baseSize;
      const normDy = (pt2.y - pt1.y) * baseSize;
      const normSegmentLength = Math.sqrt(normDx * normDx + normDy * normDy);
      const x1 = pt1.x * scaledWidth;
      const y1 = pt1.y * scaledHeight;
      const x2 = pt2.x * scaledWidth;
      const y2 = pt2.y * scaledHeight;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const segmentLength = Math.sqrt(dx * dx + dy * dy);
      if (segmentLength < 1) continue;
      const numArcs = Math.max(1, Math.round(normSegmentLength / normArcDiameter));
      const actualArcDiameter = segmentLength / numArcs;
      const arcRadius = actualArcDiameter / 2;
      const ux = dx / segmentLength;
      const uy = dy / segmentLength;
      if (i === 0) cloudPath += `M ${x1} ${y1}`;
      for (let j = 0; j < numArcs; j++) {
        const eX = x1 + ux * actualArcDiameter * (j + 1);
        const eY = y1 + uy * actualArcDiameter * (j + 1);
        cloudPath += ` A ${arcRadius} ${arcRadius} 0 0 ${sweepDir} ${eX} ${eY}`;
      }
    }
    if (isClosed) cloudPath += ' Z';

    const fillColor = isClosed && markup.fillColor && markup.fillColor !== 'none' ? markup.fillColor : 'none';
    const fillOpacity = markup.fillOpacity !== undefined ? markup.fillOpacity : 0.3;

    return (
      <path
        key={markup.id}
        data-markup-id={markup.id}
        d={cloudPath}
        stroke={markup.color}
        strokeWidth={scaledStrokeWidth}
        strokeOpacity={markup.strokeOpacity !== undefined ? markup.strokeOpacity : 1}
        fill={fillColor}
        fillOpacity={fillColor !== 'none' ? fillOpacity : 0}
      />
    );
  }

  // ── Polygon ──────────────────────────────────────────────────────────
  if (markup.type === 'polygon') {
    if (!markup.points || markup.points.length < 3) return null;
    const transformedPoints = markup.points.map(p => tx(p.x, p.y));
    const pathData = transformedPoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * scaledWidth} ${p.y * scaledHeight}`)
      .join(' ') + ' Z';
    const fillColor = markup.fillColor === 'none' ? 'transparent' : (markup.fillColor || 'none');
    const strokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
    const fillOpacity = markup.fillOpacity !== undefined ? markup.fillOpacity : (markup.opacity || 1);
    return (
      <path
        key={markup.id}
        data-markup-id={markup.id}
        d={pathData}
        stroke={markup.color}
        strokeWidth={scaledStrokeWidth}
        strokeDasharray={markup.dashArray ? markup.dashArray.map(d => d * scale).join(',') : undefined}
        strokeOpacity={strokeOpacity}
        fill={fillColor}
        fillOpacity={fillColor === 'transparent' ? 0 : fillOpacity}
      />
    );
  }

  // ── Symbol ───────────────────────────────────────────────────────────
  if (markup.type === 'symbol' && markup.symbolData) {
    const x = Math.min(markup.startX, markup.endX) * scaledWidth;
    const y = Math.min(markup.startY, markup.endY) * scaledHeight;
    const w = Math.abs(markup.endX - markup.startX) * scaledWidth;
    const h = Math.abs(markup.endY - markup.startY) * scaledHeight;
    return (
      <g key={markup.id} data-markup-id={markup.id}>
        <foreignObject x={x} y={y} width={w} height={h}>
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}
            dangerouslySetInnerHTML={{
              __html: markup.symbolData.includes('<svg')
                ? markup.symbolData.replace(/<svg/, '<svg style="width:100%;height:100%;display:block"')
                : `<img src="${markup.symbolData}" style="width:100%;height:100%;object-fit:contain" />`
            }}
          />
        </foreignObject>
      </g>
    );
  }

  // ── Image ────────────────────────────────────────────────────────────
  if (markup.type === 'image' && markup.image) {
    const x = Math.min(markup.startX, markup.endX) * scaledWidth;
    const y = Math.min(markup.startY, markup.endY) * scaledHeight;
    const w = Math.abs(markup.endX - markup.startX) * scaledWidth;
    const h = Math.abs(markup.endY - markup.startY) * scaledHeight;
    return (
      <image
        key={markup.id}
        data-markup-id={markup.id}
        href={markup.image}
        x={x} y={y} width={w} height={h}
        preserveAspectRatio="none"
      />
    );
  }

  // ── Text Highlight ───────────────────────────────────────────────────
  if (markup.type === 'textHighlight') {
    const x = Math.min(markup.startX, markup.endX) * scaledWidth;
    const y = Math.min(markup.startY, markup.endY) * scaledHeight;
    const w = Math.abs(markup.endX - markup.startX) * scaledWidth;
    const h = Math.abs(markup.endY - markup.startY) * scaledHeight;
    return (
      <rect
        key={markup.id}
        x={x} y={y} width={w} height={h}
        fill={markup.color || '#ffff00'}
        stroke="none"
        opacity={markup.opacity || 0.3}
        style={{ mixBlendMode: 'multiply' }}
      />
    );
  }

  // ── Text Markup (underline, strikeout, squiggly) ─────────────────────
  if (markup.type === 'textMarkup') {
    const x1 = markup.startX * scaledWidth;
    const y1 = markup.startY * scaledHeight;
    const x2 = markup.endX * scaledWidth;
    const y2 = markup.endY * scaledHeight;

    if (markup.subtype === 'Squiggly') {
      const amplitude = 2 * scale;
      const wavelength = 4 * scale;
      let pathD = `M ${x1} ${y1}`;
      const length = x2 - x1;
      const steps = Math.floor(length / wavelength);
      for (let i = 0; i < steps; i++) {
        const xMid = x1 + (i + 0.5) * wavelength;
        const xEnd = x1 + (i + 1) * wavelength;
        const yOffset = (i % 2 === 0) ? amplitude : -amplitude;
        pathD += ` Q ${xMid} ${y1 + yOffset} ${xEnd} ${y1}`;
      }
      return (
        <path
          key={markup.id}
          d={pathD}
          stroke={markup.color}
          strokeWidth={scaledStrokeWidth}
          fill="none"
          opacity={markup.opacity || 1}
        />
      );
    } else {
      return (
        <line
          key={markup.id}
          x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={markup.color}
          strokeWidth={scaledStrokeWidth}
          opacity={markup.opacity || 1}
        />
      );
    }
  }

  // ── Caret ────────────────────────────────────────────────────────────
  if (markup.type === 'caret') {
    const x = markup.x * scaledWidth;
    const y = markup.y * scaledHeight;
    const size = 8 * scale;
    return (
      <g key={markup.id} opacity={markup.opacity || 1}>
        <polygon
          points={`${x},${y} ${x - size / 2},${y + size} ${x + size / 2},${y + size}`}
          fill={markup.color}
          stroke="none"
        />
      </g>
    );
  }

  // ── File Attachment ──────────────────────────────────────────────────
  if (markup.type === 'fileAttachment') {
    const x = Math.min(markup.startX, markup.endX) * scaledWidth;
    const y = Math.min(markup.startY, markup.endY) * scaledHeight;
    const w = Math.abs(markup.endX - markup.startX) * scaledWidth || 24 * scale;
    const h = Math.abs(markup.endY - markup.startY) * scaledHeight || 24 * scale;
    return (
      <g key={markup.id} opacity={markup.opacity || 1}>
        <rect
          x={x} y={y} width={w} height={h}
          fill="rgba(52, 152, 219, 0.1)"
          stroke={markup.color || '#3498db'}
          strokeWidth={1 * scale}
          rx={4 * scale}
        />
        <text x={x + w / 2} y={y + h / 2} fontSize={12 * scale} textAnchor="middle" dominantBaseline="middle" fill={markup.color || '#3498db'}>
          📎
        </text>
        {markup.fileName && (
          <text x={x + w / 2} y={y + h + 10 * scale} fontSize={8 * scale} textAnchor="middle" fill="#666">
            {markup.fileName.length > 15 ? markup.fileName.substring(0, 12) + '...' : markup.fileName}
          </text>
        )}
      </g>
    );
  }

  // ── Sound ────────────────────────────────────────────────────────────
  if (markup.type === 'sound') {
    const x = markup.x * scaledWidth;
    const y = markup.y * scaledHeight;
    const size = 24 * scale;
    return (
      <g key={markup.id} opacity={markup.opacity || 1}>
        <circle cx={x} cy={y} r={size / 2} fill="rgba(233, 30, 99, 0.1)" stroke={markup.color || '#e91e63'} strokeWidth={1 * scale} />
        <text x={x} y={y + 4 * scale} fontSize={14 * scale} textAnchor="middle" fill={markup.color || '#e91e63'}>🔊</text>
      </g>
    );
  }

  // ── Redact ───────────────────────────────────────────────────────────
  if (markup.type === 'redact') {
    const x = Math.min(markup.startX, markup.endX) * scaledWidth;
    const y = Math.min(markup.startY, markup.endY) * scaledHeight;
    const w = Math.abs(markup.endX - markup.startX) * scaledWidth;
    const h = Math.abs(markup.endY - markup.startY) * scaledHeight;
    return (
      <g key={markup.id}>
        <rect
          x={x} y={y} width={w} height={h}
          fill={markup.fillColor || '#000000'}
          stroke={markup.color || '#ff0000'}
          strokeWidth={2 * scale}
          strokeDasharray={`${4 * scale},${2 * scale}`}
          opacity={markup.opacity || 0.8}
        />
        <line x1={x} y1={y} x2={x + w} y2={y + h} stroke={markup.color || '#ff0000'} strokeWidth={1 * scale} opacity={0.5} />
        <line x1={x + w} y1={y} x2={x} y2={y + h} stroke={markup.color || '#ff0000'} strokeWidth={1 * scale} opacity={0.5} />
      </g>
    );
  }

  // ── Unknown ──────────────────────────────────────────────────────────
  if (markup.type === 'unknown') {
    const x = Math.min(markup.startX, markup.endX) * scaledWidth;
    const y = Math.min(markup.startY, markup.endY) * scaledHeight;
    const w = Math.abs(markup.endX - markup.startX) * scaledWidth;
    const h = Math.abs(markup.endY - markup.startY) * scaledHeight;
    return (
      <g key={markup.id} opacity={markup.opacity || 0.6}>
        <rect
          x={x} y={y} width={w} height={h}
          fill="rgba(153, 153, 153, 0.1)"
          stroke={markup.color || '#999'}
          strokeWidth={1 * scale}
          strokeDasharray={`${3 * scale},${3 * scale}`}
        />
        <text x={x + w / 2} y={y + h / 2} fontSize={10 * scale} textAnchor="middle" dominantBaseline="middle" fill="#666">
          {markup.subtype || '?'}
        </text>
      </g>
    );
  }

  return null;
}
