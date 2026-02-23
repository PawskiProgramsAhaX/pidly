/**
 * drawMarkupToCanvas.js
 *
 * Canvas-based rendering for markup shapes. Mirrors the rendering logic in
 * renderMarkupShape.jsx (SVG) but paints to a 2D canvas context instead.
 *
 * Each markup type handler returns `true` if it successfully rendered,
 * or `false` if the type is unsupported (caller should fall back to SVG).
 *
 * Usage:
 *   import { drawAllMarkups } from './drawMarkupToCanvas';
 *   drawAllMarkups(ctx, markups, opts);
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Apply a rotation transform around a center point, execute `fn`, then restore.
 */
function withRotation(ctx, centerX, centerY, angleDeg, fn) {
  if (!angleDeg) { fn(); return; }
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate((angleDeg * Math.PI) / 180);
  ctx.translate(-centerX, -centerY);
  fn();
  ctx.restore();
}

/**
 * Set ctx.setLineDash from a lineStyle name using the provided getLineDashArray.
 */
function applyDash(ctx, markup, scaledStrokeWidth, scale, getLineDashArray) {
  if (markup.lineStyle && getLineDashArray) {
    const arr = getLineDashArray(markup.lineStyle, scaledStrokeWidth);
    if (arr) { ctx.setLineDash(arr); return; }
  }
  if (markup.dashArray) {
    ctx.setLineDash(markup.dashArray.map(d => d * scale));
    return;
  }
  ctx.setLineDash([]);
}

// ─── Individual type renderers ──────────────────────────────────────────────

function drawPen(ctx, markup, opts) {
  const { scaledWidth, scaledHeight, scaledStrokeWidth, tx } = opts;
  if (!markup.points || markup.points.length < 2) return true;

  ctx.save();
  ctx.strokeStyle = markup.color;
  ctx.lineWidth = scaledStrokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = markup.opacity || 1;
  ctx.beginPath();
  markup.points.forEach((p, i) => {
    const tp = tx(p.x, p.y);
    const x = tp.x * scaledWidth;
    const y = tp.y * scaledHeight;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
  return true;
}

function drawRectangle(ctx2d, markup, opts) {
  const { scaledWidth, scaledHeight, scaledStrokeWidth, scale, getLineDashArray, tx } = opts;

  // Named line style pattern → fall back to SVG
  if (markup.lineStylePattern && markup.lineStyleName) return false;

  const p1 = tx(markup.startX, markup.startY);
  const p2 = tx(markup.endX, markup.endY);
  const x = Math.min(p1.x, p2.x) * scaledWidth;
  const y = Math.min(p1.y, p2.y) * scaledHeight;
  const w = Math.abs(p2.x - p1.x) * scaledWidth;
  const h = Math.abs(p2.y - p1.y) * scaledHeight;

  const fillColor = markup.fillColor === 'none' ? null : (markup.fillColor || null);
  const strokeColor = markup.color === 'none' ? null : (markup.color || 'red');
  const rotationDeg = markup.rotation || 0;
  const centerX = x + w / 2;
  const centerY = y + h / 2;
  const strokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
  const fillOpacity = markup.fillOpacity !== undefined ? markup.fillOpacity : (markup.opacity || 1);

  ctx2d.save();
  applyDash(ctx2d, markup, scaledStrokeWidth, scale, getLineDashArray);

  withRotation(ctx2d, centerX, centerY, rotationDeg, () => {
    // Fill
    if (fillColor && markup.fillColor !== 'none') {
      ctx2d.globalAlpha = fillOpacity;
      ctx2d.fillStyle = fillColor;
      ctx2d.fillRect(x, y, w, h);
    }
    // Stroke
    if (strokeColor) {
      ctx2d.globalAlpha = strokeOpacity;
      ctx2d.strokeStyle = strokeColor;
      ctx2d.lineWidth = scaledStrokeWidth;
      ctx2d.strokeRect(x, y, w, h);
    }
  });

  ctx2d.restore();
  return true;
}

function drawCircle(ctx2d, markup, opts) {
  const { scaledWidth, scaledHeight, scaledStrokeWidth, scale, getLineDashArray, tx } = opts;

  if (markup.lineStylePattern && markup.lineStyleName) return false;

  const p1 = tx(markup.startX, markup.startY);
  const p2 = tx(markup.endX, markup.endY);
  const cx = ((p1.x + p2.x) / 2) * scaledWidth;
  const cy = ((p1.y + p2.y) / 2) * scaledHeight;
  const rx = Math.abs(p2.x - p1.x) * scaledWidth / 2;
  const ry = Math.abs(p2.y - p1.y) * scaledHeight / 2;
  if (rx < 0.5 && ry < 0.5) return true;

  const fillColor = markup.fillColor === 'none' ? null : (markup.fillColor || null);
  const strokeColor = markup.color === 'none' ? null : (markup.color || 'red');
  const rotationDeg = markup.rotation || 0;
  const strokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
  const fillOpacity = markup.fillOpacity !== undefined ? markup.fillOpacity : (markup.opacity || 1);

  ctx2d.save();
  applyDash(ctx2d, markup, scaledStrokeWidth, scale, getLineDashArray);

  withRotation(ctx2d, cx, cy, rotationDeg, () => {
    ctx2d.beginPath();
    ctx2d.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);

    if (fillColor && markup.fillColor !== 'none') {
      ctx2d.globalAlpha = fillOpacity;
      ctx2d.fillStyle = fillColor;
      ctx2d.fill();
    }
    if (strokeColor) {
      ctx2d.globalAlpha = strokeOpacity;
      ctx2d.strokeStyle = strokeColor;
      ctx2d.lineWidth = markup.color === 'none' ? 0 : scaledStrokeWidth;
      ctx2d.stroke();
    }
  });

  ctx2d.restore();
  return true;
}

function drawArrow(ctx2d, markup, opts) {
  const { scaledWidth, scaledHeight, scaledStrokeWidth, scale, getLineDashArray, tx } = opts;

  if (markup.lineStylePattern && markup.lineStyleName) return false;

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

  const strokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);

  ctx2d.save();
  ctx2d.globalAlpha = strokeOpacity;
  applyDash(ctx2d, markup, scaledStrokeWidth, scale, getLineDashArray);

  // Shaft
  ctx2d.strokeStyle = markup.color;
  ctx2d.lineWidth = scaledStrokeWidth;
  ctx2d.beginPath();
  ctx2d.moveTo(tailX, tailY);
  ctx2d.lineTo(lineEndX, lineEndY);
  ctx2d.stroke();

  // Arrowhead (filled polygon)
  ctx2d.setLineDash([]);
  ctx2d.fillStyle = markup.color;
  ctx2d.beginPath();
  ctx2d.moveTo(headX, headY);
  ctx2d.lineTo(headX - arrowLength * Math.cos(angle - arrowAngle), headY - arrowLength * Math.sin(angle - arrowAngle));
  ctx2d.lineTo(headX - arrowLength * Math.cos(angle + arrowAngle), headY - arrowLength * Math.sin(angle + arrowAngle));
  ctx2d.closePath();
  ctx2d.fill();

  ctx2d.restore();
  return true;
}

function drawLine(ctx2d, markup, opts) {
  const { scaledWidth, scaledHeight, scaledStrokeWidth, scale, getLineDashArray, tx } = opts;

  if (markup.lineStylePattern && markup.lineStyleName) return false;

  const p1 = tx(markup.startX, markup.startY);
  const p2 = tx(markup.endX, markup.endY);
  const strokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);

  ctx2d.save();
  ctx2d.globalAlpha = strokeOpacity;
  ctx2d.strokeStyle = markup.color;
  ctx2d.lineWidth = scaledStrokeWidth;
  applyDash(ctx2d, markup, scaledStrokeWidth, scale, getLineDashArray);

  ctx2d.beginPath();
  ctx2d.moveTo(p1.x * scaledWidth, p1.y * scaledHeight);
  ctx2d.lineTo(p2.x * scaledWidth, p2.y * scaledHeight);
  ctx2d.stroke();
  ctx2d.restore();
  return true;
}

function drawText(ctx2d, markup, opts) {
  const { scaledWidth, scaledHeight, scale, tx, selectedMarkup, editingTextMarkupId } = opts;

  if (editingTextMarkupId === markup.id) return true; // being edited in SVG

  const fontSize = (markup.fontSize || 12) * scale;
  const isTextBox = markup.startX !== undefined && markup.endX !== undefined;
  const rotationDeg = markup.rotation || 0;

  if (isTextBox) {
    const isSelectedMarkup = selectedMarkup && markup.id === selectedMarkup.id;
    const useTx = opts.rotation !== 0 && !isSelectedMarkup;
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

    const borderColor = markup.borderColor === 'none' ? null : (markup.borderColor || markup.color || '#333');
    const fillColor = markup.fillColor === 'none' || !markup.fillColor ? null : markup.fillColor;
    const textBoxOpacity = markup.opacity !== undefined ? markup.opacity : 1;

    ctx2d.save();
    ctx2d.globalAlpha = textBoxOpacity;

    withRotation(ctx2d, centerX, centerY, rotationDeg, () => {
      // Background fill
      if (fillColor) {
        ctx2d.fillStyle = fillColor;
        ctx2d.fillRect(boxX, boxY, boxW, boxH);
      }

      // Border
      if (borderColor) {
        ctx2d.strokeStyle = borderColor;
        ctx2d.lineWidth = borderWidth * scale;
        ctx2d.setLineDash([]);
        ctx2d.strokeRect(boxX, boxY, boxW, boxH);
      }

      // Text
      const text = markup.text || '';
      if (text) {
        ctx2d.fillStyle = markup.color || '#000';
        const fontFamily = (markup.fontFamily || 'Helvetica') + ', Arial, sans-serif';
        ctx2d.font = `${fontSize}px ${fontFamily}`;

        // Text alignment
        const textAlign = markup.textAlign || 'left';
        ctx2d.textAlign = textAlign;

        // Clip to box
        ctx2d.save();
        ctx2d.beginPath();
        ctx2d.rect(boxX, boxY, boxW, boxH);
        ctx2d.clip();

        const lineHeight = fontSize * (markup.lineSpacing || 1.2);
        const lines = text.split('\n');

        // Wrap lines to fit box width
        const maxWidth = boxW - padding * 2;
        const wrappedLines = [];
        for (const line of lines) {
          if (!line) { wrappedLines.push(''); continue; }
          const words = line.split(' ');
          let currentLine = '';
          for (const word of words) {
            const testLine = currentLine ? currentLine + ' ' + word : word;
            const metrics = ctx2d.measureText(testLine);
            if (metrics.width > maxWidth && currentLine) {
              wrappedLines.push(currentLine);
              currentLine = word;
            } else {
              currentLine = testLine;
            }
          }
          wrappedLines.push(currentLine);
        }

        // Vertical alignment
        const totalTextHeight = wrappedLines.length * lineHeight;
        let startY;
        const vertAlign = markup.verticalAlign || 'top';
        if (vertAlign === 'middle') {
          startY = boxY + (boxH - totalTextHeight) / 2 + fontSize * 0.85;
        } else if (vertAlign === 'bottom') {
          startY = boxY + boxH - totalTextHeight + fontSize * 0.85 - padding;
        } else {
          startY = boxY + padding + fontSize * 0.85;
        }

        // Horizontal position
        let textX;
        if (textAlign === 'center') textX = boxX + boxW / 2;
        else if (textAlign === 'right') textX = boxX + boxW - padding;
        else textX = boxX + padding;

        for (let i = 0; i < wrappedLines.length; i++) {
          ctx2d.fillText(wrappedLines[i], textX, startY + i * lineHeight);
        }

        ctx2d.restore(); // unclip
      }
    });

    ctx2d.restore();
    return true;
  } else {
    // Single-point text (from PDF)
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

    ctx2d.save();
    ctx2d.fillStyle = markup.color || 'blue';
    const fontFamily = markup.fontFamily || 'Arial, sans-serif';
    ctx2d.font = `${fontSize}px ${fontFamily}`;

    const textAlign = markup.textAlign === 'center' ? 'center' : markup.textAlign === 'right' ? 'right' : 'left';
    ctx2d.textAlign = textAlign;
    ctx2d.textBaseline = 'top';

    withRotation(ctx2d, cX, cY, rotationDeg, () => {
      ctx2d.fillText(markup.text || '[NO TEXT]', textX, textY);
    });

    ctx2d.restore();
    return true;
  }
}

function drawPolyline(ctx2d, markup, opts) {
  const { scaledWidth, scaledHeight, scaledStrokeWidth, scale, getLineDashArray, tx } = opts;

  if (markup.lineStylePattern && markup.lineStyleName) return false;

  if (!markup.points || markup.points.length < 2) return true;
  const validPoints = markup.points
    .filter(p => p && p.x !== undefined && p.y !== undefined)
    .map(p => tx(p.x, p.y));
  if (validPoints.length < 2) return true;

  const fillColor = markup.fillColor === 'none' ? null : (markup.fillColor || null);
  const showFill = markup.closed && fillColor;
  const strokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
  const fillOpacity = markup.fillOpacity !== undefined ? markup.fillOpacity : (markup.opacity || 1);

  ctx2d.save();
  applyDash(ctx2d, markup, scaledStrokeWidth, scale, getLineDashArray);

  ctx2d.beginPath();
  validPoints.forEach((p, i) => {
    const x = p.x * scaledWidth;
    const y = p.y * scaledHeight;
    if (i === 0) ctx2d.moveTo(x, y);
    else ctx2d.lineTo(x, y);
  });
  if (markup.closed) ctx2d.closePath();

  // Fill first (behind stroke)
  if (showFill) {
    ctx2d.globalAlpha = fillOpacity;
    ctx2d.fillStyle = fillColor;
    ctx2d.fill();
  }

  // Stroke
  ctx2d.globalAlpha = strokeOpacity;
  ctx2d.strokeStyle = markup.color;
  ctx2d.lineWidth = scaledStrokeWidth;
  ctx2d.stroke();

  ctx2d.restore();
  return true;
}

function drawPolylineArrow(ctx2d, markup, opts) {
  const { scaledWidth, scaledHeight, scaledStrokeWidth, scale, getLineDashArray, tx } = opts;

  if (markup.lineStylePattern && markup.lineStyleName) return false;

  if (!markup.points || markup.points.length < 2) return true;
  const validPoints = markup.points
    .filter(p => p && p.x !== undefined && p.y !== undefined)
    .map(p => tx(p.x, p.y));
  if (validPoints.length < 2) return true;

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

  const strokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : 1;

  ctx2d.save();
  ctx2d.globalAlpha = strokeOpacity;
  applyDash(ctx2d, markup, scaledStrokeWidth, scale, getLineDashArray);

  // Path: all points except last gets shortened to lineEnd, with optional close
  ctx2d.strokeStyle = markup.color;
  ctx2d.lineWidth = scaledStrokeWidth;
  ctx2d.beginPath();
  for (let i = 0; i < validPoints.length; i++) {
    const p = validPoints[i];
    if (i === 0) ctx2d.moveTo(p.x * scaledWidth, p.y * scaledHeight);
    else if (i === validPoints.length - 1) ctx2d.lineTo(lineEndX, lineEndY);
    else ctx2d.lineTo(p.x * scaledWidth, p.y * scaledHeight);
  }
  if (isClosed && validPoints.length >= 2) {
    const firstPt = validPoints[0];
    ctx2d.lineTo(endX, endY);
    ctx2d.lineTo(firstPt.x * scaledWidth, firstPt.y * scaledHeight);
  }
  ctx2d.stroke();

  // Arrowhead
  ctx2d.setLineDash([]);
  ctx2d.fillStyle = markup.color;
  ctx2d.beginPath();
  ctx2d.moveTo(endX, endY);
  ctx2d.lineTo(endX - arrowLength * Math.cos(angle - arrowAngle), endY - arrowLength * Math.sin(angle - arrowAngle));
  ctx2d.lineTo(endX - arrowLength * Math.cos(angle + arrowAngle), endY - arrowLength * Math.sin(angle + arrowAngle));
  ctx2d.closePath();
  ctx2d.fill();

  ctx2d.restore();
  return true;
}

function drawPolygon(ctx2d, markup, opts) {
  const { scaledWidth, scaledHeight, scaledStrokeWidth, scale, tx } = opts;

  if (markup.lineStylePattern && markup.lineStyleName) return false;

  if (!markup.points || markup.points.length < 3) return true;
  const transformedPoints = markup.points.map(p => tx(p.x, p.y));

  const fillColor = markup.fillColor === 'none' ? null : (markup.fillColor || null);
  const strokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
  const fillOpacity = markup.fillOpacity !== undefined ? markup.fillOpacity : (markup.opacity || 1);

  ctx2d.save();
  if (markup.dashArray) {
    ctx2d.setLineDash(markup.dashArray.map(d => d * scale));
  }

  ctx2d.beginPath();
  transformedPoints.forEach((p, i) => {
    const x = p.x * scaledWidth;
    const y = p.y * scaledHeight;
    if (i === 0) ctx2d.moveTo(x, y);
    else ctx2d.lineTo(x, y);
  });
  ctx2d.closePath();

  // Fill
  if (fillColor) {
    ctx2d.globalAlpha = fillOpacity;
    ctx2d.fillStyle = fillColor;
    ctx2d.fill();
  }

  // Stroke
  ctx2d.globalAlpha = strokeOpacity;
  ctx2d.strokeStyle = markup.color;
  ctx2d.lineWidth = scaledStrokeWidth;
  ctx2d.stroke();

  ctx2d.restore();
  return true;
}

function drawCloud(ctx2d, markup, opts) {
  const { scaledWidth, scaledHeight, scaledStrokeWidth, tx } = opts;

  const cp1 = tx(markup.startX, markup.startY);
  const cp2 = tx(markup.endX, markup.endY);
  const x = Math.min(cp1.x, cp2.x) * scaledWidth;
  const y = Math.min(cp1.y, cp2.y) * scaledHeight;
  const w = Math.abs(cp2.x - cp1.x) * scaledWidth;
  const h = Math.abs(cp2.y - cp1.y) * scaledHeight;
  const inverted = markup.inverted || false;
  const rotationDeg = markup.rotation || 0;
  const centerX = x + w / 2;
  const centerY = y + h / 2;

  // Calculate arc parameters (same as SVG version)
  const refSize = 800;
  const normW = Math.abs(cp2.x - cp1.x) * refSize;
  const normH = Math.abs(cp2.y - cp1.y) * refSize;
  const targetArcDiameter = markup.arcSize || 15;
  const normPerimeter = 2 * (normW + normH);
  const totalArcs = Math.max(4, Math.round(normPerimeter / targetArcDiameter));
  const screenPerimeter = 2 * (w + h);
  const uniformArcDiameter = screenPerimeter / totalArcs;
  const arcRadius = uniformArcDiameter / 2;
  const numArcsX = Math.max(1, Math.round(w / uniformArcDiameter));
  const numArcsY = Math.max(1, Math.round(h / uniformArcDiameter));
  const spacingX = w / numArcsX;
  const spacingY = h / numArcsY;
  const sweepFlag = inverted ? 0 : 1; // 0=counterclockwise, 1=clockwise

  const fillColor = markup.fillColor === 'none' ? null : (markup.fillColor || null);
  const strokeColor = markup.color === 'none' ? null : (markup.color || '#ff0000');
  const strokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : 1;
  const fillOpacity = markup.fillOpacity !== undefined ? markup.fillOpacity : 0.3;

  ctx2d.save();

  withRotation(ctx2d, centerX, centerY, rotationDeg, () => {
    // Build path from arc segments using the SVG-like arc approach
    // Canvas doesn't have SVG-style arc commands, so we approximate each arc
    // with a half-circle between consecutive points
    const buildCloudPath = () => {
      ctx2d.beginPath();
      ctx2d.moveTo(x, y);

      // Top edge: left to right
      for (let i = 0; i < numArcsX; i++) {
        const sx = x + i * spacingX;
        const ex = x + (i + 1) * spacingX;
        const midX = (sx + ex) / 2;
        const midY = y - arcRadius * (sweepFlag ? 1 : -1);
        ctx2d.quadraticCurveTo(midX, midY, ex, y);
      }
      // Right edge: top to bottom
      for (let i = 0; i < numArcsY; i++) {
        const sy = y + i * spacingY;
        const ey = y + (i + 1) * spacingY;
        const midX = x + w + arcRadius * (sweepFlag ? 1 : -1);
        const midY = (sy + ey) / 2;
        ctx2d.quadraticCurveTo(midX, midY, x + w, ey);
      }
      // Bottom edge: right to left
      for (let i = numArcsX - 1; i >= 0; i--) {
        const ex = x + i * spacingX;
        const sx = x + (i + 1) * spacingX;
        const midX = (sx + ex) / 2;
        const midY = y + h + arcRadius * (sweepFlag ? 1 : -1);
        ctx2d.quadraticCurveTo(midX, midY, ex, y + h);
      }
      // Left edge: bottom to top
      for (let i = numArcsY - 1; i >= 0; i--) {
        const ey = y + i * spacingY;
        const sy = y + (i + 1) * spacingY;
        const midX = x - arcRadius * (sweepFlag ? 1 : -1);
        const midY = (sy + ey) / 2;
        ctx2d.quadraticCurveTo(midX, midY, x, ey);
      }
      ctx2d.closePath();
    };

    buildCloudPath();

    // Fill
    if (fillColor && markup.fillColor !== 'none') {
      ctx2d.globalAlpha = fillOpacity;
      ctx2d.fillStyle = fillColor;
      ctx2d.fill();
    }

    // Stroke
    if (strokeColor) {
      ctx2d.globalAlpha = markup.color === 'none' ? 0 : strokeOpacity;
      ctx2d.strokeStyle = strokeColor;
      ctx2d.lineWidth = markup.color === 'none' ? 0 : scaledStrokeWidth;
      ctx2d.stroke();
    }
  });

  ctx2d.restore();
  return true;
}

function drawCloudPolyline(ctx2d, markup, opts) {
  const { scaledWidth, scaledHeight, scaledStrokeWidth, tx } = opts;

  if (!markup.points || markup.points.length < 2) return true;
  const validPoints = markup.points
    .filter(p => p && p.x !== undefined && p.y !== undefined)
    .map(p => tx(p.x, p.y));
  if (validPoints.length < 2) return true;

  const inverted = markup.inverted || false;
  const sweepFlag = inverted ? 0 : 1;
  const isClosed = markup.closed || false;
  const baseSize = 800;
  const normArcDiameter = markup.arcSize || 15;
  const numSegments = isClosed ? validPoints.length : validPoints.length - 1;

  const fillColor = isClosed && markup.fillColor && markup.fillColor !== 'none' ? markup.fillColor : null;
  const fillOpacity = markup.fillOpacity !== undefined ? markup.fillOpacity : 0.3;
  const strokeColor = markup.color === 'none' ? null : (markup.color || '#ff0000');

  ctx2d.save();
  ctx2d.beginPath();

  let firstPoint = true;
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
    // Perpendicular: rotate unit vector 90 degrees
    const perpX = -uy;
    const perpY = ux;

    if (firstPoint) {
      ctx2d.moveTo(x1, y1);
      firstPoint = false;
    }

    for (let j = 0; j < numArcs; j++) {
      const arcStartX = x1 + ux * actualArcDiameter * j;
      const arcStartY = y1 + uy * actualArcDiameter * j;
      const arcEndX = x1 + ux * actualArcDiameter * (j + 1);
      const arcEndY = y1 + uy * actualArcDiameter * (j + 1);
      const midX = (arcStartX + arcEndX) / 2 + perpX * arcRadius * (sweepFlag ? 1 : -1);
      const midY = (arcStartY + arcEndY) / 2 + perpY * arcRadius * (sweepFlag ? 1 : -1);
      ctx2d.quadraticCurveTo(midX, midY, arcEndX, arcEndY);
    }
  }

  if (isClosed) ctx2d.closePath();

  // Fill
  if (fillColor) {
    ctx2d.globalAlpha = fillOpacity;
    ctx2d.fillStyle = fillColor;
    ctx2d.fill();
  }

  // Stroke
  if (strokeColor) {
    ctx2d.globalAlpha = markup.color === 'none' ? 0 : (markup.strokeOpacity !== undefined ? markup.strokeOpacity : 1);
    ctx2d.strokeStyle = strokeColor;
    ctx2d.lineWidth = markup.color === 'none' ? 0 : scaledStrokeWidth;
    ctx2d.stroke();
  }

  ctx2d.restore();
  return true;
}

function drawTextHighlight(ctx2d, markup, opts) {
  const { scaledWidth, scaledHeight } = opts;
  const x = Math.min(markup.startX, markup.endX) * scaledWidth;
  const y = Math.min(markup.startY, markup.endY) * scaledHeight;
  const w = Math.abs(markup.endX - markup.startX) * scaledWidth;
  const h = Math.abs(markup.endY - markup.startY) * scaledHeight;

  ctx2d.save();
  ctx2d.globalAlpha = markup.opacity || 0.3;
  ctx2d.globalCompositeOperation = 'multiply';
  ctx2d.fillStyle = markup.color || '#ffff00';
  ctx2d.fillRect(x, y, w, h);
  ctx2d.restore();
  return true;
}

function drawTextMarkup(ctx2d, markup, opts) {
  const { scaledWidth, scaledHeight, scaledStrokeWidth, scale } = opts;
  const x1 = markup.startX * scaledWidth;
  const y1 = markup.startY * scaledHeight;
  const x2 = markup.endX * scaledWidth;
  const y2 = markup.endY * scaledHeight;

  ctx2d.save();
  ctx2d.globalAlpha = markup.opacity || 1;
  ctx2d.strokeStyle = markup.color;
  ctx2d.lineWidth = scaledStrokeWidth;

  if (markup.subtype === 'Squiggly') {
    const amplitude = 2 * scale;
    const wavelength = 4 * scale;
    const length = x2 - x1;
    const steps = Math.floor(length / wavelength);

    ctx2d.beginPath();
    ctx2d.moveTo(x1, y1);
    for (let i = 0; i < steps; i++) {
      const xMid = x1 + (i + 0.5) * wavelength;
      const xEnd = x1 + (i + 1) * wavelength;
      const yOffset = (i % 2 === 0) ? amplitude : -amplitude;
      ctx2d.quadraticCurveTo(xMid, y1 + yOffset, xEnd, y1);
    }
    ctx2d.stroke();
  } else {
    // Underline or Strikeout
    ctx2d.beginPath();
    ctx2d.moveTo(x1, y1);
    ctx2d.lineTo(x2, y2);
    ctx2d.stroke();
  }

  ctx2d.restore();
  return true;
}

function drawCaret(ctx2d, markup, opts) {
  const { scaledWidth, scaledHeight, scale } = opts;
  const x = markup.x * scaledWidth;
  const y = markup.y * scaledHeight;
  const size = 8 * scale;

  ctx2d.save();
  ctx2d.globalAlpha = markup.opacity || 1;
  ctx2d.fillStyle = markup.color;
  ctx2d.beginPath();
  ctx2d.moveTo(x, y);
  ctx2d.lineTo(x - size / 2, y + size);
  ctx2d.lineTo(x + size / 2, y + size);
  ctx2d.closePath();
  ctx2d.fill();
  ctx2d.restore();
  return true;
}

function drawRedact(ctx2d, markup, opts) {
  const { scaledWidth, scaledHeight, scale } = opts;
  const x = Math.min(markup.startX, markup.endX) * scaledWidth;
  const y = Math.min(markup.startY, markup.endY) * scaledHeight;
  const w = Math.abs(markup.endX - markup.startX) * scaledWidth;
  const h = Math.abs(markup.endY - markup.startY) * scaledHeight;

  ctx2d.save();
  ctx2d.globalAlpha = markup.opacity || 0.8;

  // Black fill
  ctx2d.fillStyle = markup.fillColor || '#000000';
  ctx2d.fillRect(x, y, w, h);

  // Dashed border
  ctx2d.strokeStyle = markup.color || '#ff0000';
  ctx2d.lineWidth = 2 * scale;
  ctx2d.setLineDash([4 * scale, 2 * scale]);
  ctx2d.strokeRect(x, y, w, h);

  // X cross lines
  ctx2d.globalAlpha = 0.5;
  ctx2d.setLineDash([]);
  ctx2d.lineWidth = 1 * scale;
  ctx2d.beginPath();
  ctx2d.moveTo(x, y);
  ctx2d.lineTo(x + w, y + h);
  ctx2d.moveTo(x + w, y);
  ctx2d.lineTo(x, y + h);
  ctx2d.stroke();

  ctx2d.restore();
  return true;
}


// ─── Main entry points ─────────────────────────────────────────────────────

/**
 * Draw a single markup to a canvas context.
 *
 * @param {CanvasRenderingContext2D} ctx - The canvas 2D context
 * @param {Object} markup - The markup object
 * @param {Object} opts
 * @param {number} opts.scaledWidth - Canvas width in pixels
 * @param {number} opts.scaledHeight - Canvas height in pixels
 * @param {number} opts.scale - Current zoom scale
 * @param {number} opts.rotation - Page rotation (0, 90, 180, 270)
 * @param {Function} [opts.transformCoordinate] - (x,y) => {x,y} for PDF rotation
 * @param {Function} opts.getLineDashArray - (style, strokeWidth) => array|null
 * @param {Object} [opts.selectedMarkup] - Currently selected markup
 * @param {string} [opts.editingTextMarkupId] - ID of text markup being edited
 * @returns {boolean} true if rendered, false if unsupported (needs SVG fallback)
 */
export function drawMarkupToCanvas(ctx, markup, opts) {
  if (!markup) return true;

  const { scaledWidth, scaledHeight, scale, rotation = 0, transformCoordinate } = opts;

  // Guard against NaN
  if (!scaledWidth || !scaledHeight || isNaN(scaledWidth) || isNaN(scaledHeight)) return true;

  // Build transform helper (same as SVG version)
  const shouldTransform = rotation !== 0;
  const tx = (x, y) => shouldTransform && transformCoordinate ? transformCoordinate(x, y) : { x, y };

  const scaledStrokeWidth = (markup.strokeWidth || 2) * scale;

  const fullOpts = { ...opts, scaledStrokeWidth, tx };

  switch (markup.type) {
    case 'pen':
    case 'highlighter':
      return drawPen(ctx, markup, fullOpts);
    case 'rectangle':
      return drawRectangle(ctx, markup, fullOpts);
    case 'circle':
      return drawCircle(ctx, markup, fullOpts);
    case 'arrow':
      return drawArrow(ctx, markup, fullOpts);
    case 'line':
      return drawLine(ctx, markup, fullOpts);
    case 'text':
      return drawText(ctx, markup, fullOpts);
    case 'polyline':
      return drawPolyline(ctx, markup, fullOpts);
    case 'polylineArrow':
      return drawPolylineArrow(ctx, markup, fullOpts);
    case 'polygon':
      return drawPolygon(ctx, markup, fullOpts);
    case 'cloud':
      return drawCloud(ctx, markup, fullOpts);
    case 'cloudPolyline':
      return drawCloudPolyline(ctx, markup, fullOpts);
    case 'textHighlight':
      return drawTextHighlight(ctx, markup, fullOpts);
    case 'textMarkup':
      return drawTextMarkup(ctx, markup, fullOpts);
    case 'caret':
      return drawCaret(ctx, markup, fullOpts);
    case 'redact':
      return drawRedact(ctx, markup, fullOpts);
    // Unsupported types — fall back to SVG
    case 'arc':
    case 'callout':
    case 'stamp':
    case 'image':
    case 'symbol':
    case 'note':
    case 'fileAttachment':
    case 'sound':
    case 'unknown':
      return false;
    default:
      return false;
  }
}

/**
 * Draw all markups to a canvas, skipping the selected markup (rendered in SVG).
 *
 * @param {CanvasRenderingContext2D} ctx - The canvas 2D context
 * @param {Array} markups - Array of markup objects for the current page
 * @param {Object} opts - Same opts as drawMarkupToCanvas
 * @param {string} [selectedMarkupId] - ID to skip (rendered interactively in SVG)
 * @returns {Set<string>} Set of markup IDs that couldn't be canvas-rendered (need SVG fallback)
 */
export function drawAllMarkups(ctx, markups, opts, selectedMarkupId) {
  const { scaledWidth, scaledHeight } = opts;
  const fallbackIds = new Set();

  // Clear the canvas
  ctx.clearRect(0, 0, scaledWidth, scaledHeight);

  if (!markups || markups.length === 0) return fallbackIds;

  for (const markup of markups) {
    // Skip the selected markup — it's rendered interactively in SVG
    if (selectedMarkupId && markup.id === selectedMarkupId) continue;

    try {
      ctx.save();
      const rendered = drawMarkupToCanvas(ctx, markup, opts);
      ctx.restore();

      if (!rendered) {
        fallbackIds.add(markup.id);
      }
    } catch (err) {
      ctx.restore();
      console.warn('drawMarkupToCanvas failed for markup', markup.id, markup.type, err);
      fallbackIds.add(markup.id);
    }
  }

  return fallbackIds;
}
