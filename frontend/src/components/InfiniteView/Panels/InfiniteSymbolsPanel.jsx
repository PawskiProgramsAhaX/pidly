/**
 * InfiniteSymbolsPanel.jsx
 * 
 * Symbols panel adapted for InfiniteView.
 * Tabbed panel for managing reusable assets:
 * - Symbols: Upload image
 * - Stamps: Custom text stamps, uploaded stamps
 * - Signatures: Draw on pad, type with cursive fonts, upload image
 * 
 * All items stored in savedSymbols[] with a `category` field.
 * All items drag-and-drop onto canvas slots via the same mechanism.
 */

import { useState, useRef, useEffect, useCallback } from 'react';

// ─── Signature fonts ─────────────────────────────────────────────────────────
const SIGNATURE_FONTS = [
  { name: 'Dancing Script', label: 'Script' },
  { name: 'Pacifico', label: 'Pacifico' },
  { name: 'Caveat', label: 'Caveat' },
  { name: 'Playfair Display', label: 'Playfair' },
];

// ─── Helper: render a text stamp to a data URL ──────────────────────────────
function renderStampToDataURL(text, color, borderColor, bg, fontSize = 28) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // Measure text
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  const textHeight = fontSize;
  
  const padX = fontSize * 0.6;
  const padY = fontSize * 0.4;
  const borderWidth = 3;
  
  canvas.width = Math.ceil(textWidth + padX * 2 + borderWidth * 2);
  canvas.height = Math.ceil(textHeight + padY * 2 + borderWidth * 2);
  
  // Background
  ctx.fillStyle = bg || 'rgba(255,255,255,0.9)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Border
  ctx.strokeStyle = borderColor || color;
  ctx.lineWidth = borderWidth;
  ctx.strokeRect(borderWidth / 2, borderWidth / 2, canvas.width - borderWidth, canvas.height - borderWidth);
  
  // Text
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  
  return {
    dataURL: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height
  };
}

// ─── Helper: render typed signature to data URL ─────────────────────────────
function renderSignatureToDataURL(text, fontFamily, color, fontSize = 48) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  ctx.font = `${fontSize}px '${fontFamily}', cursive`;
  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  
  const padX = 20;
  const padY = 16;
  canvas.width = Math.ceil(textWidth + padX * 2);
  canvas.height = Math.ceil(fontSize * 1.4 + padY * 2);
  
  // Transparent background
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  ctx.font = `${fontSize}px '${fontFamily}', cursive`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  
  return {
    dataURL: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height
  };
}

export default function InfiniteSymbolsPanel({
  isOpen,
  onClose,
  // Symbols list
  savedSymbols,
  setSavedSymbols,
  symbolSearchQuery,
  onSearchQueryChange,
  symbolsViewMode,
  onViewModeChange,
  onDeleteSymbol,
  // Drag state
  onDragStart,
  onDragEnd,
  // For drag image sizing
  canvasSize,
  scale,
  // Default signature
  defaultSignatureId,
  onSetDefaultSignature,
  // Click-to-place
  onStartPlacement,
}) {
  // ─── Tab state ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('symbols');
  
  // ─── Cleanup editor state (shared by all upload/capture flows) ────────────
  const [isEditingSymbol, setIsEditingSymbol] = useState(false);
  const [capturedImage, setCapturedImage] = useState(null);
  const [editTool, setEditTool] = useState('eraser');
  const [editBrushSize, setEditBrushSize] = useState(10);
  const [symbolColor, setSymbolColor] = useState('#000000');
  const [symbolName, setSymbolName] = useState('');
  const [isDrawingOnEdit, setIsDrawingOnEdit] = useState(false);
  const [editSaveCategory, setEditSaveCategory] = useState('symbol'); // which tab initiated the editor
  // Crop sliders: percentage from each edge (0-50%)
  const [cropTop, setCropTop] = useState(0);
  const [cropBottom, setCropBottom] = useState(0);
  const [cropLeft, setCropLeft] = useState(0);
  const [cropRight, setCropRight] = useState(0);
  const editCanvasRef = useRef(null);
  const editCanvasContainerRef = useRef(null);
  const uploadInputRef = useRef(null);

  // ─── Custom stamp state ───────────────────────────────────────────────────
  const [showStampCreator, setShowStampCreator] = useState(false);
  const [stampText, setStampText] = useState('');
  const [stampColor, setStampColor] = useState('#dc2626');
  const [stampBg, setStampBg] = useState('#fef2f2');

  // ─── Signature state ──────────────────────────────────────────────────────
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [showTypeSignature, setShowTypeSignature] = useState(false);
  const [sigText, setSigText] = useState('');
  const [sigFont, setSigFont] = useState('Dancing Script');
  const [sigColor, setSigColor] = useState('#000000');
  const [sigPenSize, setSigPenSize] = useState(3);
  const sigCanvasRef = useRef(null);
  const sigDrawingRef = useRef(false);
  const sigLastPointRef = useRef(null);
  const sigPathsRef = useRef([]);  // for undo

  // ─── Initialize edit canvas when captured image changes ───────────────────
  useEffect(() => {
    if (capturedImage && editCanvasRef.current) {
      const ctx = editCanvasRef.current.getContext('2d');
      ctx.drawImage(capturedImage.canvas, 0, 0);
    }
  }, [capturedImage]);

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Draw markups onto a canvas context
  // ═══════════════════════════════════════════════════════════════════════════
  
  const drawMarkupsOnCanvas = useCallback(async (ctx, markupsList, minX, minY, viewportWidth, viewportHeight, extractionScale) => {
    // Helper: convert 0-1 page coord to pixel coord in cropped canvas
    const px = (nx) => (nx - minX) * viewportWidth;
    const py = (ny) => (ny - minY) * viewportHeight;
    const sw = (strokeWidth) => Math.max(1.5, (strokeWidth || 2) * extractionScale);
    
    // Helper: load an image from a data URL or SVG string
    const loadImage = (src) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      // If it's SVG markup, convert to data URL
      if (src.trim().startsWith('<svg') || src.trim().startsWith('<?xml')) {
        const blob = new Blob([src], { type: 'image/svg+xml' });
        img.src = URL.createObjectURL(blob);
      } else {
        img.src = src;
      }
    });

    for (const m of markupsList) {
      ctx.save();
      const lineW = sw(m.strokeWidth);
      ctx.lineWidth = lineW;
      ctx.strokeStyle = m.color || '#000000';
      ctx.fillStyle = m.color || '#000000';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = m.strokeOpacity !== undefined ? m.strokeOpacity : 1;

      if (m.type === 'pen' || m.type === 'highlighter') {
        if (m.points && m.points.length > 1) {
          if (m.type === 'highlighter') {
            ctx.globalAlpha = m.opacity || 0.3;
            ctx.lineWidth = lineW * 5;
          }
          ctx.beginPath();
          ctx.moveTo(px(m.points[0].x), py(m.points[0].y));
          for (let i = 1; i < m.points.length; i++) ctx.lineTo(px(m.points[i].x), py(m.points[i].y));
          ctx.stroke();
        }
      } else if (m.type === 'rectangle' || m.type === 'cloud' || m.type === 'callout') {
        if (m.startX == null || m.endX == null || m.startY == null || m.endY == null) { ctx.restore(); return; }
        const rx = px(Math.min(m.startX, m.endX)), ry = py(Math.min(m.startY, m.endY));
        const rw = px(Math.max(m.startX, m.endX)) - rx, rh = py(Math.max(m.startY, m.endY)) - ry;
        const rotationDeg = m.rotation || 0;
        const centerX = rx + rw / 2;
        const centerY = ry + rh / 2;
        
        // Apply rotation around center (matches SVG transform)
        if (rotationDeg !== 0) {
          ctx.translate(centerX, centerY);
          ctx.rotate(rotationDeg * Math.PI / 180);
          ctx.translate(-centerX, -centerY);
        }
        
        // Dash array support
        if (m.lineStyle === 'dashed') {
          ctx.setLineDash([lineW * 3, lineW * 2]);
        } else if (m.lineStyle === 'dotted') {
          ctx.setLineDash([lineW, lineW * 2]);
        } else if (m.dashArray) {
          ctx.setLineDash(m.dashArray.map(d => d * extractionScale));
        }
        
        // Fill (match SVG: default opacity is markup.opacity || 1, not 0.3)
        if (m.fillColor && m.fillColor !== 'none' && m.fillColor !== 'transparent') {
          ctx.fillStyle = m.fillColor;
          const fillOpacity = m.fillOpacity !== undefined ? m.fillOpacity : (m.opacity || 1);
          ctx.globalAlpha = fillOpacity;
          if (m.borderRadius) {
            ctx.beginPath();
            const r = m.borderRadius * extractionScale;
            ctx.roundRect(rx, ry, rw, rh, r);
            ctx.fill();
          } else {
            ctx.fillRect(rx, ry, rw, rh);
          }
        }
        
        // Stroke (match SVG: default color 'red', opacity fallback to markup.opacity)
        const strokeColor = m.color === 'none' ? 'transparent' : (m.color || 'red');
        if (strokeColor !== 'transparent') {
          ctx.strokeStyle = strokeColor;
          const strokeOpacity = m.strokeOpacity !== undefined ? m.strokeOpacity : (m.opacity || 1);
          ctx.globalAlpha = strokeOpacity;
          ctx.lineWidth = m.color === 'none' ? 0 : lineW;
          if (m.borderRadius) {
            ctx.beginPath();
            ctx.roundRect(rx, ry, rw, rh, m.borderRadius * extractionScale);
            ctx.stroke();
          } else {
            ctx.strokeRect(rx, ry, rw, rh);
          }
        }
        
        // Reset dash
        ctx.setLineDash([]);
        
        if (m.text && m.text.trim()) {
          const fs = Math.min(rh * 0.6, rw * 0.1, 72);
          ctx.fillStyle = m.textColor || m.color || '#000';
          ctx.font = `${m.fontWeight || 'normal'} ${fs}px ${m.fontFamily || 'Arial, sans-serif'}`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.globalAlpha = 1;
          ctx.fillText(m.text, rx + rw / 2, ry + rh / 2, rw - 10);
        }
      } else if (m.type === 'circle') {
        const cx = (px(m.startX) + px(m.endX)) / 2, cy = (py(m.startY) + py(m.endY)) / 2;
        const rrx = Math.abs(px(m.endX) - px(m.startX)) / 2, rry = Math.abs(py(m.endY) - py(m.startY)) / 2;
        const rotationDeg = m.rotation || 0;
        
        // Apply rotation around center
        if (rotationDeg !== 0) {
          ctx.translate(cx, cy);
          ctx.rotate(rotationDeg * Math.PI / 180);
          ctx.translate(-cx, -cy);
        }
        
        // Dash array
        if (m.lineStyle === 'dashed') {
          ctx.setLineDash([lineW * 3, lineW * 2]);
        } else if (m.lineStyle === 'dotted') {
          ctx.setLineDash([lineW, lineW * 2]);
        } else if (m.dashArray) {
          ctx.setLineDash(m.dashArray.map(d => d * extractionScale));
        }
        
        // Fill
        if (m.fillColor && m.fillColor !== 'none' && m.fillColor !== 'transparent') {
          ctx.fillStyle = m.fillColor;
          const fillOpacity = m.fillOpacity !== undefined ? m.fillOpacity : (m.opacity || 1);
          ctx.globalAlpha = fillOpacity;
          ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(1, rrx), Math.max(1, rry), 0, 0, Math.PI * 2); ctx.fill();
        }
        
        // Stroke
        const strokeColor = m.color === 'none' ? 'transparent' : (m.color || 'red');
        if (strokeColor !== 'transparent') {
          ctx.strokeStyle = strokeColor;
          const strokeOpacity = m.strokeOpacity !== undefined ? m.strokeOpacity : (m.opacity || 1);
          ctx.globalAlpha = strokeOpacity;
          ctx.lineWidth = m.color === 'none' ? 0 : lineW;
          ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(1, rrx), Math.max(1, rry), 0, 0, Math.PI * 2); ctx.stroke();
        }
        
        ctx.setLineDash([]);
        
        if (m.text && m.text.trim()) {
          const fs = Math.min(rry * 0.6, rrx * 0.2, 72);
          ctx.fillStyle = m.textColor || m.color || '#000';
          ctx.font = `${fs}px ${m.fontFamily || 'Arial, sans-serif'}`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.globalAlpha = 1;
          ctx.fillText(m.text, cx, cy, rrx * 1.8);
        }
      } else if (m.type === 'line') {
        const strokeOpacity = m.strokeOpacity !== undefined ? m.strokeOpacity : (m.opacity || 1);
        ctx.globalAlpha = strokeOpacity;
        if (m.lineStyle === 'dashed') { ctx.setLineDash([lineW * 3, lineW * 2]); }
        else if (m.lineStyle === 'dotted') { ctx.setLineDash([lineW, lineW * 2]); }
        else if (m.dashArray) { ctx.setLineDash(m.dashArray.map(d => d * extractionScale)); }
        ctx.beginPath();
        ctx.moveTo(px(m.startX), py(m.startY));
        ctx.lineTo(px(m.endX), py(m.endY));
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (m.type === 'arrow') {
        const strokeOpacity = m.strokeOpacity !== undefined ? m.strokeOpacity : (m.opacity || 1);
        ctx.globalAlpha = strokeOpacity;
        if (m.lineStyle === 'dashed') { ctx.setLineDash([lineW * 3, lineW * 2]); }
        else if (m.lineStyle === 'dotted') { ctx.setLineDash([lineW, lineW * 2]); }
        else if (m.dashArray) { ctx.setLineDash(m.dashArray.map(d => d * extractionScale)); }
        const x1 = px(m.startX), y1 = py(m.startY), x2 = px(m.endX), y2 = py(m.endY);
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const headLen = Math.min(lineW * 5, 30);
        const aa = Math.PI / 7;
        ctx.beginPath(); ctx.moveTo(x1, y1);
        ctx.lineTo(x2 - headLen * 0.7 * Math.cos(angle), y2 - headLen * 0.7 * Math.sin(angle));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headLen * Math.cos(angle - aa), y2 - headLen * Math.sin(angle - aa));
        ctx.lineTo(x2 - headLen * Math.cos(angle + aa), y2 - headLen * Math.sin(angle + aa));
        ctx.closePath(); ctx.fill();
      } else if (m.type === 'polyline' || m.type === 'polygon' || m.type === 'polylineArrow' || m.type === 'cloudPolyline') {
        if (m.points && m.points.length > 1) {
          const strokeOpacity = m.strokeOpacity !== undefined ? m.strokeOpacity : (m.opacity || 1);
          if (m.lineStyle === 'dashed') { ctx.setLineDash([lineW * 3, lineW * 2]); }
          else if (m.lineStyle === 'dotted') { ctx.setLineDash([lineW, lineW * 2]); }
          else if (m.dashArray) { ctx.setLineDash(m.dashArray.map(d => d * extractionScale)); }
          ctx.beginPath();
          ctx.moveTo(px(m.points[0].x), py(m.points[0].y));
          for (let i = 1; i < m.points.length; i++) ctx.lineTo(px(m.points[i].x), py(m.points[i].y));
          if (m.type === 'polygon') ctx.closePath();
          if (m.type === 'polygon' && m.fillColor && m.fillColor !== 'none') {
            ctx.fillStyle = m.fillColor;
            const fillOpacity = m.fillOpacity !== undefined ? m.fillOpacity : (m.opacity || 1);
            ctx.globalAlpha = fillOpacity;
            ctx.fill();
          }
          ctx.globalAlpha = strokeOpacity;
          ctx.stroke();
          ctx.setLineDash([]);
          // Arrowhead for polylineArrow
          if (m.type === 'polylineArrow' && m.points.length >= 2) {
            const last = m.points[m.points.length - 1], prev = m.points[m.points.length - 2];
            const ex = px(last.x), ey = py(last.y), sx = px(prev.x), sy = py(prev.y);
            const angle = Math.atan2(ey - sy, ex - sx);
            const headLen = Math.min(lineW * 5, 24);
            const aa = Math.PI / 7;
            ctx.beginPath(); ctx.moveTo(ex, ey);
            ctx.lineTo(ex - headLen * Math.cos(angle - aa), ey - headLen * Math.sin(angle - aa));
            ctx.lineTo(ex - headLen * Math.cos(angle + aa), ey - headLen * Math.sin(angle + aa));
            ctx.closePath(); ctx.fill();
          }
        }
      } else if (m.type === 'text') {
        const isTextBox = m.startX !== undefined && m.endX !== undefined;
        if (isTextBox) {
          const bx = px(Math.min(m.startX, m.endX));
          const by = py(Math.min(m.startY, m.endY));
          const bw = Math.abs(px(m.endX) - px(m.startX));
          const bh = Math.abs(py(m.endY) - py(m.startY));
          const padding = (m.padding !== undefined ? m.padding : 4) * extractionScale;
          const borderW = (m.borderWidth || 1) * extractionScale;

          // Background fill
          const fillColor = (!m.fillColor || m.fillColor === 'none' || m.fillColor === 'transparent') ? null : m.fillColor;
          if (fillColor) {
            ctx.fillStyle = fillColor;
            ctx.globalAlpha = m.fillOpacity !== undefined ? m.fillOpacity : 1;
            ctx.fillRect(bx, by, bw, bh);
          }

          // Border
          const borderColor = m.borderColor === 'none' ? null : (m.borderColor || m.color || '#333');
          if (borderColor && borderColor !== 'transparent') {
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = borderW;
            ctx.globalAlpha = m.strokeOpacity !== undefined ? m.strokeOpacity : 1;
            ctx.strokeRect(bx, by, bw, bh);
          }

          // Text content — match foreignObject: pre-wrap, padding, lineHeight, textAlign, verticalAlign
          if (m.text) {
            const fs = (m.fontSize || 12) * extractionScale;
            const lineHeight = (m.lineSpacing || 1.2) * fs;
            const fontFamily = (m.fontFamily || 'Helvetica') + ', Arial, sans-serif';
            const fontWeight = m.fontWeight || 'normal';
            ctx.font = `${fontWeight} ${fs}px ${fontFamily}`;
            ctx.fillStyle = m.color || '#000';
            ctx.globalAlpha = m.opacity !== undefined ? m.opacity : 1;
            ctx.textBaseline = 'top';

            const contentX = bx + padding;
            const contentW = bw - padding * 2;
            const align = m.textAlign || 'left';
            ctx.textAlign = align;

            // Compute textX based on alignment
            const textX = align === 'center' ? bx + bw / 2
                        : align === 'right' ? bx + bw - padding
                        : contentX;

            // Pre-wrap: split on newlines, then word-wrap each paragraph
            const paragraphs = m.text.split('\n');
            const wrappedLines = [];
            paragraphs.forEach(paragraph => {
              if (paragraph === '') {
                wrappedLines.push('');
                return;
              }
              const words = paragraph.split(' ');
              let line = '';
              words.forEach(word => {
                const testLine = line ? line + ' ' + word : word;
                if (line && ctx.measureText(testLine).width > contentW) {
                  wrappedLines.push(line);
                  line = word;
                } else {
                  line = testLine;
                }
              });
              if (line) wrappedLines.push(line);
            });

            // Vertical alignment
            const totalTextHeight = wrappedLines.length * lineHeight;
            const contentH = bh - padding * 2;
            let startY;
            if (m.verticalAlign === 'middle') {
              startY = by + padding + (contentH - totalTextHeight) / 2;
            } else if (m.verticalAlign === 'bottom') {
              startY = by + padding + contentH - totalTextHeight;
            } else {
              startY = by + padding;
            }

            wrappedLines.forEach((line, i) => {
              if (line !== '') {
                ctx.fillText(line, textX, startY + i * lineHeight, contentW);
              }
            });
          }
        } else {
          // Single-point text (old PDF format)
          const textX = px(m.x || 0);
          const textY = py(m.y || 0);
          const fs = (m.fontSize || 12) * extractionScale;
          ctx.font = `${m.fontWeight || 'normal'} ${fs}px ${(m.fontFamily || 'Helvetica') + ', Arial, sans-serif'}`;
          ctx.fillStyle = m.color || '#000';
          ctx.globalAlpha = m.opacity !== undefined ? m.opacity : 1;
          ctx.textBaseline = 'alphabetic';
          ctx.textAlign = m.textAlign === 'center' ? 'center' : m.textAlign === 'right' ? 'right' : 'left';
          if (m.text) ctx.fillText(m.text, textX, textY);
        }
      } else if (m.type === 'symbol' && m.symbolData) {
        // Placed symbol/stamp/signature — render image or SVG
        if (m.startX == null || m.endX == null) { ctx.restore(); continue; }
        const sx = px(Math.min(m.startX, m.endX));
        const sy = py(Math.min(m.startY, m.endY));
        const sw2 = Math.abs(px(m.endX) - px(m.startX));
        const sh = Math.abs(py(m.endY) - py(m.startY));
        if (sw2 > 0 && sh > 0) {
          const rotationDeg = m.rotation || 0;
          if (rotationDeg !== 0) {
            const cx = sx + sw2 / 2, cy = sy + sh / 2;
            ctx.translate(cx, cy);
            ctx.rotate(rotationDeg * Math.PI / 180);
            ctx.translate(-cx, -cy);
          }
          ctx.globalAlpha = m.opacity !== undefined ? m.opacity : 1;
          try {
            const img = await loadImage(m.symbolData);
            if (img) ctx.drawImage(img, sx, sy, sw2, sh);
          } catch(e) { /* skip if image fails */ }
        }
      } else if (m.type === 'image' && m.image) {
        // Placed image markup
        if (m.startX == null || m.endX == null) { ctx.restore(); continue; }
        const ix = px(Math.min(m.startX, m.endX));
        const iy = py(Math.min(m.startY, m.endY));
        const iw = Math.abs(px(m.endX) - px(m.startX));
        const ih = Math.abs(py(m.endY) - py(m.startY));
        if (iw > 0 && ih > 0) {
          const rotationDeg = m.rotation || 0;
          if (rotationDeg !== 0) {
            const cx = ix + iw / 2, cy = iy + ih / 2;
            ctx.translate(cx, cy);
            ctx.rotate(rotationDeg * Math.PI / 180);
            ctx.translate(-cx, -cy);
          }
          ctx.globalAlpha = m.opacity !== undefined ? m.opacity : 1;
          try {
            const img = await loadImage(m.image);
            if (img) ctx.drawImage(img, ix, iy, iw, ih);
          } catch(e) { /* skip if image fails */ }
        }
      } else if (m.type === 'stamp') {
        // Placeholder stamp (dashed border + label)
        if (m.startX == null || m.endX == null) { ctx.restore(); continue; }
        const stx = px(Math.min(m.startX, m.endX));
        const sty = py(Math.min(m.startY, m.endY));
        const stw = Math.abs(px(m.endX) - px(m.startX));
        const sth = Math.abs(py(m.endY) - py(m.startY));
        const rotationDeg = m.rotation || 0;
        if (rotationDeg !== 0) {
          const cx = stx + stw / 2, cy = sty + sth / 2;
          ctx.translate(cx, cy);
          ctx.rotate(rotationDeg * Math.PI / 180);
          ctx.translate(-cx, -cy);
        }
        ctx.globalAlpha = m.opacity || 1;
        ctx.strokeStyle = m.color || '#9333ea';
        ctx.lineWidth = 2 * extractionScale;
        ctx.setLineDash([5 * extractionScale, 3 * extractionScale]);
        ctx.fillStyle = 'rgba(147, 51, 234, 0.1)';
        ctx.fillRect(stx, sty, stw, sth);
        ctx.strokeRect(stx, sty, stw, sth);
        ctx.setLineDash([]);
        // Label
        const fs = 10 * extractionScale;
        ctx.fillStyle = m.color || '#9333ea';
        ctx.font = `${fs}px Arial, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`📎 ${m.stampName || 'Stamp'}`, stx + stw / 2, sty + sth / 2, stw - 10);
      } else if (m.type === 'textHighlight') {
        // Text highlight rectangle
        if (m.startX == null || m.endX == null) { ctx.restore(); continue; }
        const hx = px(Math.min(m.startX, m.endX));
        const hy = py(Math.min(m.startY, m.endY));
        const hw = Math.abs(px(m.endX) - px(m.startX));
        const hh = Math.abs(py(m.endY) - py(m.startY));
        ctx.fillStyle = m.color || '#ffff00';
        ctx.globalAlpha = m.opacity || 0.3;
        ctx.fillRect(hx, hy, hw, hh);
      }
      ctx.restore();
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // CAPTURE FROM PDF — Not available in InfiniteView
  // ═══════════════════════════════════════════════════════════════════════════
  
  const captureRegionFromPdf = useCallback(async () => {
    // Not supported in InfiniteView
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // CAPTURE SELECTED MARKUPS — Not available in InfiniteView
  // ═══════════════════════════════════════════════════════════════════════════

  const captureMarkupsAsStamp = useCallback(async () => {
    // Not supported in InfiniteView
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // UPLOAD IMAGE
  // ═══════════════════════════════════════════════════════════════════════════

  const handleUploadImage = useCallback((category) => {
    setEditSaveCategory(category);
    uploadInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        setCapturedImage({
          canvas,
          width: img.width,
          height: img.height,
          originalData: ctx.getImageData(0, 0, img.width, img.height),
          normalizedWidth: 0.15,  // default size on page
          normalizedHeight: 0.15 * (img.height / img.width),
        });
        setIsEditingSymbol(true);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    
    // Reset input so same file can be selected again
    e.target.value = '';
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // EDIT CANVAS TOOLS (eraser, fill)
  // ═══════════════════════════════════════════════════════════════════════════

  const handleEditCanvasMouseDown = (e) => {
    if (!editCanvasRef.current || !capturedImage || editTool === 'crop') return;
    setIsDrawingOnEdit(true);
    handleEditCanvasDraw(e);
  };

  const handleEditCanvasMouseMove = (e) => {
    if (!isDrawingOnEdit || !editCanvasRef.current) return;
    handleEditCanvasDraw(e);
  };

  const handleEditCanvasMouseUp = () => setIsDrawingOnEdit(false);

  const handleEditCanvasDraw = (e) => {
    if (!editCanvasRef.current || !capturedImage) return;
    const canvas = editCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const ctx = canvas.getContext('2d');
    
    if (editTool === 'eraser') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(x, y, editBrushSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (editTool === 'fill') {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(x, y, editBrushSize, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP ACTIONS (shared)
  // ═══════════════════════════════════════════════════════════════════════════

  const removeBackground = useCallback((tolerance = 240) => {
    if (!editCanvasRef.current) return;
    const canvas = editCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > tolerance && data[i+1] > tolerance && data[i+2] > tolerance) {
        data[i+3] = 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, []);

  const removeNoise = useCallback((threshold = 200) => {
    if (!editCanvasRef.current) return;
    const canvas = editCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = (data[i] + data[i+1] + data[i+2]) / 3;
      if (gray > threshold) {
        data[i+3] = 0;
      } else {
        data[i] = data[i+1] = data[i+2] = 0;
        data[i+3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, []);

  const removeSpecks = useCallback((minSize = 30) => {
    if (!editCanvasRef.current) return;
    const canvas = editCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = imageData;
    
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const alpha = data[i * 4 + 3];
      const gray = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
      mask[i] = (alpha > 128 && gray < 200) ? 1 : 0;
    }
    
    const labels = new Int32Array(width * height);
    const sizes = new Map();
    let labelCount = 0;
    
    const floodFill = (startX, startY, label) => {
      const stack = [[startX, startY]];
      let size = 0;
      while (stack.length > 0) {
        const [x, y] = stack.pop();
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const idx = y * width + x;
        if (mask[idx] === 0 || labels[idx] !== 0) continue;
        labels[idx] = label;
        size++;
        stack.push([x+1, y], [x-1, y], [x, y+1], [x, y-1]);
      }
      return size;
    };
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (mask[idx] === 1 && labels[idx] === 0) {
          labelCount++;
          sizes.set(labelCount, floodFill(x, y, labelCount));
        }
      }
    }
    
    for (let i = 0; i < width * height; i++) {
      const label = labels[i];
      if (label > 0 && sizes.get(label) < minSize) data[i * 4 + 3] = 0;
    }
    ctx.putImageData(imageData, 0, 0);
  }, []);

  const recolorSymbol = useCallback((newColor) => {
    if (!editCanvasRef.current) return;
    const canvas = editCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const hex = newColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i+3];
      const gray = (data[i] + data[i+1] + data[i+2]) / 3;
      if (alpha > 10 && gray < 200) {
        const darkness = 1 - (gray / 200);
        data[i] = r; data[i+1] = g; data[i+2] = b;
        data[i+3] = Math.min(255, Math.round(255 * darkness));
      } else if (alpha > 10 && gray >= 200) {
        data[i+3] = 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, []);

  const invertColors = useCallback(() => {
    if (!editCanvasRef.current) return;
    const canvas = editCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i+3] > 0) { data[i] = 255-data[i]; data[i+1] = 255-data[i+1]; data[i+2] = 255-data[i+2]; }
    }
    ctx.putImageData(imageData, 0, 0);
  }, []);

  const trimTransparent = useCallback(() => {
    if (!editCanvasRef.current || !capturedImage) return;
    const canvas = editCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const w = canvas.width, h = canvas.height;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 0) {
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
    }
    if (maxX < minX) return;
    const trimW = maxX - minX + 1, trimH = maxY - minY + 1;
    const trimmedData = ctx.getImageData(minX, minY, trimW, trimH);
    const widthRatio = trimW / w, heightRatio = trimH / h;
    canvas.width = trimW; canvas.height = trimH;
    ctx.putImageData(trimmedData, 0, 0);
    setCapturedImage(prev => ({
      ...prev, width: trimW, height: trimH,
      normalizedWidth: (prev.normalizedWidth || 0.1) * widthRatio,
      normalizedHeight: (prev.normalizedHeight || 0.1) * heightRatio,
    }));
  }, [capturedImage]);

  const resetToOriginal = useCallback(() => {
    if (!editCanvasRef.current || !capturedImage) return;
    const ctx = editCanvasRef.current.getContext('2d');
    editCanvasRef.current.width = capturedImage.originalData.width;
    editCanvasRef.current.height = capturedImage.originalData.height;
    ctx.putImageData(capturedImage.originalData, 0, 0);
  }, [capturedImage]);

  // Apply crop from sliders (percentages from each edge)
  const applyCrop = useCallback(() => {
    if (!editCanvasRef.current || !capturedImage) return;
    const canvas = editCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    
    const x = Math.round(w * cropLeft / 100);
    const y = Math.round(h * cropTop / 100);
    const cw = Math.round(w * (100 - cropLeft - cropRight) / 100);
    const ch = Math.round(h * (100 - cropTop - cropBottom) / 100);
    
    if (cw < 2 || ch < 2) return;
    
    const croppedData = ctx.getImageData(x, y, cw, ch);
    const widthRatio = cw / w, heightRatio = ch / h;
    canvas.width = cw; canvas.height = ch;
    ctx.putImageData(croppedData, 0, 0);
    
    setCapturedImage(prev => ({
      ...prev, width: cw, height: ch,
      normalizedWidth: (prev.normalizedWidth || 0.1) * widthRatio,
      normalizedHeight: (prev.normalizedHeight || 0.1) * heightRatio,
    }));
    setCropTop(0); setCropBottom(0); setCropLeft(0); setCropRight(0);
    setEditTool('eraser');
  }, [capturedImage, cropTop, cropBottom, cropLeft, cropRight]);

  // Auto-detect content bounds and set sliders
  const autoCropDetect = useCallback((tolerance = 240) => {
    if (!editCanvasRef.current) return;
    const canvas = editCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const w = canvas.width, h = canvas.height;
    
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const alpha = data[i + 3];
        const isWhiteish = data[i] > tolerance && data[i+1] > tolerance && data[i+2] > tolerance;
        if (alpha > 10 && !isWhiteish) {
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
    }
    if (maxX < minX) return;
    
    // Add small margin and convert to percentages
    const margin = Math.max(4, w * 0.005);
    const left = Math.max(0, ((minX - margin) / w) * 100);
    const top = Math.max(0, ((minY - margin) / h) * 100);
    const right = Math.max(0, ((w - 1 - maxX - margin) / w) * 100);
    const bottom = Math.max(0, ((h - 1 - maxY - margin) / h) * 100);
    
    setCropLeft(Math.round(left * 10) / 10);
    setCropTop(Math.round(top * 10) / 10);
    setCropRight(Math.round(right * 10) / 10);
    setCropBottom(Math.round(bottom * 10) / 10);
    setEditTool('crop');
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // SAVE FROM EDITOR
  // ═══════════════════════════════════════════════════════════════════════════

  const saveEditedSymbol = useCallback(() => {
    if (!editCanvasRef.current) return;
    const canvas = editCanvasRef.current;
    const dataUrl = canvas.toDataURL('image/png');
    
    const defaultNames = { symbol: 'Symbol', stamp: 'Stamp', signature: 'Signature' };
    const catItems = savedSymbols.filter(s => (s.category || 'symbol') === editSaveCategory);
    
    const newSymbol = {
      id: `${editSaveCategory}_${Date.now()}`,
      name: symbolName || `${defaultNames[editSaveCategory]} ${catItems.length + 1}`,
      category: editSaveCategory,
      type: 'image',
      image: dataUrl,
      preview: dataUrl,
      width: canvas.width,
      height: canvas.height,
      originalWidth: capturedImage?.normalizedWidth || 0.15,
      originalHeight: capturedImage?.normalizedHeight || 0.1,
      aspectRatio: canvas.width / canvas.height,
      createdAt: new Date().toISOString()
    };
    
    const updated = [...savedSymbols, newSymbol];
    setSavedSymbols(updated);
    try { localStorage.setItem('markup_symbols', JSON.stringify(updated)); } catch(e) {}
    
    setCapturedImage(null);
    setIsEditingSymbol(false);
    setSymbolName('');
  }, [symbolName, savedSymbols, setSavedSymbols, capturedImage, editSaveCategory]);

  const cancelEditing = useCallback(() => {
    setCapturedImage(null);
    setIsEditingSymbol(false);
    setSymbolName('');
    setCropTop(0); setCropBottom(0); setCropLeft(0); setCropRight(0);
    setEditTool('eraser');
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOM STAMP CREATION
  // ═══════════════════════════════════════════════════════════════════════════

  const saveCustomStamp = useCallback(() => {
    if (!stampText.trim()) return;
    const { dataURL, width, height } = renderStampToDataURL(stampText.trim().toUpperCase(), stampColor, stampColor, stampBg);
    
    const newSymbol = {
      id: `stamp_${Date.now()}`,
      name: stampText.trim().toUpperCase(),
      category: 'stamp',
      type: 'image',
      image: dataURL,
      preview: dataURL,
      width, height,
      originalWidth: 0.2,
      originalHeight: 0.2 * (height / width),
      aspectRatio: width / height,
      createdAt: new Date().toISOString()
    };
    
    const updated = [...savedSymbols, newSymbol];
    setSavedSymbols(updated);
    try { localStorage.setItem('markup_symbols', JSON.stringify(updated)); } catch(e) {}
    
    setShowStampCreator(false);
    setStampText('');
  }, [stampText, stampColor, stampBg, savedSymbols, setSavedSymbols]);

  // ═══════════════════════════════════════════════════════════════════════════
  // SIGNATURE PAD
  // ═══════════════════════════════════════════════════════════════════════════

  const initSignaturePad = useCallback(() => {
    if (!sigCanvasRef.current) return;
    const canvas = sigCanvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    sigPathsRef.current = [];
  }, []);

  useEffect(() => {
    if (showSignaturePad) {
      // Small delay to let the modal render
      setTimeout(initSignaturePad, 50);
    }
  }, [showSignaturePad, initSignaturePad]);

  const handleSigMouseDown = (e) => {
    if (!sigCanvasRef.current) return;
    sigDrawingRef.current = true;
    const rect = sigCanvasRef.current.getBoundingClientRect();
    const scaleX = sigCanvasRef.current.width / rect.width;
    const scaleY = sigCanvasRef.current.height / rect.height;
    sigLastPointRef.current = {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
    // Save snapshot for undo
    const ctx = sigCanvasRef.current.getContext('2d');
    sigPathsRef.current.push(ctx.getImageData(0, 0, sigCanvasRef.current.width, sigCanvasRef.current.height));
  };

  const handleSigMouseMove = (e) => {
    if (!sigDrawingRef.current || !sigCanvasRef.current || !sigLastPointRef.current) return;
    const canvas = sigCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = sigColor;
    ctx.lineWidth = sigPenSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(sigLastPointRef.current.x, sigLastPointRef.current.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    
    sigLastPointRef.current = { x, y };
  };

  const handleSigMouseUp = () => {
    sigDrawingRef.current = false;
    sigLastPointRef.current = null;
  };

  const undoSignature = () => {
    if (!sigCanvasRef.current || sigPathsRef.current.length === 0) return;
    const ctx = sigCanvasRef.current.getContext('2d');
    const prev = sigPathsRef.current.pop();
    ctx.putImageData(prev, 0, 0);
  };

  const clearSignature = () => {
    initSignaturePad();
  };

  const saveSignature = useCallback(() => {
    if (!sigCanvasRef.current) return;
    const canvas = sigCanvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Auto-cleanup: remove white bg, trim
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 240 && data[i+1] > 240 && data[i+2] > 240) {
        data[i+3] = 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    
    // Trim
    const imgData2 = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData2.data;
    let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (d[(y * canvas.width + x) * 4 + 3] > 0) {
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
    }
    
    if (maxX <= minX || maxY <= minY) return; // Empty canvas
    
    const pad = 10;
    const tX = Math.max(0, minX - pad);
    const tY = Math.max(0, minY - pad);
    const tW = Math.min(canvas.width - tX, maxX - minX + 1 + pad * 2);
    const tH = Math.min(canvas.height - tY, maxY - minY + 1 + pad * 2);
    
    const trimCanvas = document.createElement('canvas');
    trimCanvas.width = tW;
    trimCanvas.height = tH;
    const tCtx = trimCanvas.getContext('2d');
    tCtx.drawImage(canvas, tX, tY, tW, tH, 0, 0, tW, tH);
    
    const dataUrl = trimCanvas.toDataURL('image/png');
    const sigSymbols = savedSymbols.filter(s => (s.category || 'symbol') === 'signature');
    
    const newSymbol = {
      id: `signature_${Date.now()}`,
      name: `Signature ${sigSymbols.length + 1}`,
      category: 'signature',
      type: 'image',
      image: dataUrl,
      preview: dataUrl,
      width: tW,
      height: tH,
      originalWidth: 0.15,
      originalHeight: 0.15 * (tH / tW),
      aspectRatio: tW / tH,
      createdAt: new Date().toISOString()
    };
    
    const updated = [...savedSymbols, newSymbol];
    setSavedSymbols(updated);
    try { localStorage.setItem('markup_symbols', JSON.stringify(updated)); } catch(e) {}
    
    setShowSignaturePad(false);
  }, [savedSymbols, setSavedSymbols]);

  // ═══════════════════════════════════════════════════════════════════════════
  // TYPED SIGNATURE
  // ═══════════════════════════════════════════════════════════════════════════

  const saveTypedSignature = useCallback(() => {
    if (!sigText.trim()) return;
    const { dataURL, width, height } = renderSignatureToDataURL(sigText.trim(), sigFont, sigColor);
    const sigSymbols = savedSymbols.filter(s => (s.category || 'symbol') === 'signature');
    
    const newSymbol = {
      id: `signature_${Date.now()}`,
      name: sigText.trim(),
      category: 'signature',
      type: 'image',
      image: dataURL,
      preview: dataURL,
      width, height,
      originalWidth: 0.15,
      originalHeight: 0.15 * (height / width),
      aspectRatio: width / height,
      createdAt: new Date().toISOString()
    };
    
    const updated = [...savedSymbols, newSymbol];
    setSavedSymbols(updated);
    try { localStorage.setItem('markup_symbols', JSON.stringify(updated)); } catch(e) {}
    
    setShowTypeSignature(false);
    setSigText('');
  }, [sigText, sigFont, sigColor, savedSymbols, setSavedSymbols]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  if (!isOpen) return null;

  // Filter symbols by category and search
  const getFilteredByCategory = (cat) => savedSymbols.filter(s =>
    (s.category || 'symbol') === cat &&
    (!symbolSearchQuery || s.name.toLowerCase().includes(symbolSearchQuery.toLowerCase()))
  );

  const symbols = getFilteredByCategory('symbol');
  const stamps = getFilteredByCategory('stamp');
  const signatures = getFilteredByCategory('signature');

  // (Selection-based creation and PDF capture not available in InfiniteView)

  // ─── Shared symbol card renderer ─────────────────────────────────────────
  const renderSymbolCard = (symbol, isGrid, showDefaultStar = false) => {
    const isDefault = showDefaultStar && defaultSignatureId === symbol.id;
    return (
    <div 
      key={symbol.id}
      draggable
      onClick={(e) => {
        // Click to activate placement mode (rubber-band draw on canvas)
        if (onStartPlacement) {
          e.stopPropagation();
          const category = symbol.category || 'symbol';
          onStartPlacement({ symbol, isSignature: category === 'signature' });
        }
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/json', JSON.stringify(symbol));
        onDragStart(symbol);
        
        if (canvasSize.width && canvasSize.height) {
          const w = (symbol.originalWidth || 0.1) * canvasSize.width * scale;
          const h = (symbol.originalHeight || 0.1) * canvasSize.height * scale;
          const dragImg = document.createElement('div');
          dragImg.style.cssText = `position:fixed;top:-10000px;left:-10000px;width:${w}px;height:${h}px;pointer-events:none;`;
          if (symbol.image) {
            dragImg.innerHTML = `<img src="${symbol.image}" style="width:100%;height:100%;object-fit:contain" />`;
          } else if (symbol.preview) {
            dragImg.innerHTML = symbol.preview.replace(/<svg/, `<svg style="width:${w}px;height:${h}px"`);
          }
          document.body.appendChild(dragImg);
          e.dataTransfer.setDragImage(dragImg, w / 2, h / 2);
          setTimeout(() => document.body.removeChild(dragImg), 0);
        }
      }}
      onDragEnd={() => onDragEnd()}
      style={isGrid ? {
        display: 'flex', flexDirection: 'column', position: 'relative',
        padding: '4px', background: '#252525', borderRadius: '6px',
        cursor: 'pointer', border: isDefault ? '2px solid #f39c12' : '1px solid #333', transition: 'border-color 0.15s',
      } : {
        display: 'flex', flexDirection: 'row', alignItems: 'center', position: 'relative',
        padding: '6px 8px', background: '#252525', borderRadius: '6px',
        cursor: 'pointer', border: isDefault ? '2px solid #f39c12' : '1px solid #333', transition: 'border-color 0.15s',
        gap: '10px',
      }}
      onMouseEnter={(e) => { if (!isDefault) e.currentTarget.style.borderColor = '#555'; }}
      onMouseLeave={(e) => { if (!isDefault) e.currentTarget.style.borderColor = '#333'; }}
    >
      {/* Default signature star (only for signatures) */}
      {showDefaultStar && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            if (onSetDefaultSignature) {
              onSetDefaultSignature(isDefault ? null : symbol.id);
            }
          }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: '2px', left: '2px', zIndex: 2,
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '12px', padding: '1px 3px', lineHeight: 1,
            color: isDefault ? '#f39c12' : '#555',
            opacity: isDefault ? 1 : 0.5,
            transition: 'color 0.15s, opacity 0.15s',
          }}
          onMouseEnter={(e) => { e.target.style.opacity = '1'; e.target.style.color = '#f39c12'; }}
          onMouseLeave={(e) => { if (!isDefault) { e.target.style.opacity = '0.5'; e.target.style.color = '#555'; } }}
          title={isDefault ? 'Default signature (S key) — click to unset' : 'Set as default signature (S key)'}
        >★</button>
      )}
      {/* Preview */}
      {isGrid ? (
        <div style={{
          width: '100%', paddingBottom: '70%', position: 'relative',
          background: '#f0f0f0', borderRadius: '4px', overflow: 'hidden',
          backgroundImage: 'linear-gradient(45deg, #e0e0e0 25%, transparent 25%), linear-gradient(-45deg, #e0e0e0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e0e0e0 75%), linear-gradient(-45deg, transparent 75%, #e0e0e0 75%)',
          backgroundSize: '10px 10px', backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0px',
        }}>
          <div style={{
            position: 'absolute', top: '3px', left: '3px', right: '3px', bottom: '3px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {(symbol.type === 'image' || symbol.image) ? (
              <img src={symbol.image} alt={symbol.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            ) : symbol.preview ? (
              <div dangerouslySetInnerHTML={{ __html: symbol.preview.replace(/<svg/, '<svg style="width:100%;height:100%"') }} style={{ width: '100%', height: '100%' }} />
            ) : (
              <span style={{ fontSize: '20px', opacity: 0.4 }}>📌</span>
            )}
          </div>
        </div>
      ) : (
        <div style={{
          width: '40px', height: '28px', flexShrink: 0, background: '#f0f0f0',
          borderRadius: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
          {(symbol.type === 'image' || symbol.image) ? (
            <img src={symbol.image} alt={symbol.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : symbol.preview ? (
            <div dangerouslySetInnerHTML={{ __html: symbol.preview.replace(/<svg/, '<svg style="width:100%;height:100%"') }} style={{ width: '100%', height: '100%' }} />
          ) : (
            <span style={{ fontSize: '14px', opacity: 0.4 }}>📌</span>
          )}
        </div>
      )}
      
      {/* Name + delete */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', minWidth: 0, flex: isGrid ? undefined : 1, marginTop: isGrid ? '3px' : 0 }}>
        <span style={{ fontSize: isGrid ? '9px' : '11px', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0, color: '#bbb' }} title={symbol.name}>
          {symbol.name}
        </span>
        <button
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (window.confirm(`Delete "${symbol.name}"?`)) onDeleteSymbol(symbol.id); }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', padding: '2px 4px', opacity: 0.3, flexShrink: 0, borderRadius: '2px', lineHeight: 1, color: '#888' }}
            onMouseEnter={(e) => { e.target.style.opacity = '1'; e.target.style.color = '#e74c3c'; }}
            onMouseLeave={(e) => { e.target.style.opacity = '0.3'; e.target.style.color = '#888'; }}
            title="Delete"
          >✕</button>
      </div>
    </div>
    );
  };

  // ─── Item grid/list ───────────────────────────────────────────────────────
  const renderItemList = (items, cols = 3, emptyMsg = 'No items yet', showDefaultStar = false) => (
    items.length > 0 ? (
      <div style={{
        display: symbolsViewMode === 'grid' ? 'grid' : 'flex',
        gridTemplateColumns: symbolsViewMode === 'grid' ? `repeat(${cols}, 1fr)` : undefined,
        flexDirection: symbolsViewMode === 'list' ? 'column' : undefined,
        gap: '4px', padding: '2px', alignContent: 'start',
      }}>
        {items.map(s => renderSymbolCard(s, symbolsViewMode === 'grid', showDefaultStar))}
      </div>
    ) : (
      <p style={{ fontSize: '11px', color: '#555', margin: '12px 0', textAlign: 'center', fontStyle: 'italic' }}>{emptyMsg}</p>
    )
  );

  // ─── Action button style (reusable) ───────────────────────────────────────
  const actionBtn = (label, onClick, opts = {}) => (
    <button
      onClick={onClick}
      disabled={opts.disabled}
      style={{
        flex: opts.flex || 1,
        padding: '7px 10px',
        background: opts.disabled ? '#333' : (opts.bg || '#333'),
        color: opts.disabled ? '#555' : (opts.color || '#ccc'),
        border: '1px solid #444',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: '500',
        cursor: opts.disabled ? 'not-allowed' : 'pointer',
        transition: 'background 0.15s',
        ...opts.style,
      }}
      title={opts.title}
    >
      {label}
    </button>
  );

  const sectionLabel = (text) => (
    <div style={{ fontSize: '10px', fontWeight: '600', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', marginTop: '12px' }}>
      {text}
    </div>
  );

  return (
    <>
      {/* Hidden file input for upload */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />

      <div className="smart-links-panel right-panel">
        <div className="panel-header" style={{ paddingBottom: '8px' }}>
          <h3>Library</h3>
          <button className="close-panel" onClick={onClose}>×</button>
        </div>

        {/* ─── Tabs ────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', padding: '0 12px 8px', gap: '2px', flexShrink: 0 }}>
          {[
            { id: 'symbols', label: 'Symbols', count: symbols.length },
            { id: 'stamps', label: 'Stamps', count: stamps.length },
            { id: 'signatures', label: 'Signatures', count: signatures.length },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id);  setShowStampCreator(false);  setShowTypeSignature(false); }}
              style={{
                flex: 1,
                padding: '6px 4px',
                background: activeTab === tab.id ? '#333' : 'transparent',
                color: activeTab === tab.id ? '#fff' : '#777',
                border: 'none',
                borderBottom: activeTab === tab.id ? '2px solid #3498db' : '2px solid transparent',
                fontSize: '11px',
                fontWeight: activeTab === tab.id ? '600' : '400',
                cursor: 'pointer',
                transition: 'all 0.15s',
                borderRadius: '4px 4px 0 0',
              }}
            >
              {tab.label}
              {tab.count > 0 && <span style={{ marginLeft: '4px', fontSize: '9px', opacity: 0.6 }}>({tab.count})</span>}
            </button>
          ))}
        </div>

        <div className="panel-content">

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* SYMBOLS TAB */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {activeTab === 'symbols' && (
            <>
              {/* Creation buttons */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
                {actionBtn('📁 Upload', () => handleUploadImage('symbol'), { title: 'Upload image file' })}
              </div>

              {/* Search + view toggle */}
              {symbols.length > 0 && (
                <>
                  {sectionLabel('Saved Symbols')}
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexShrink: 0 }}>
                    <input
                      type="text" placeholder="Search..." value={symbolSearchQuery}
                      onChange={(e) => onSearchQueryChange(e.target.value)}
                      className="search-input"
                      style={{ flex: 1, padding: '5px 8px', border: '1px solid #333', borderRadius: '4px', fontSize: '11px', background: '#252525', color: '#ccc', boxSizing: 'border-box' }}
                    />
                    <div style={{ display: 'flex', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
                      {['grid', 'list'].map(mode => (
                        <button key={mode} onClick={() => { onViewModeChange(mode); localStorage.setItem('symbols_view_mode', mode); }}
                          style={{ padding: '4px 8px', background: symbolsViewMode === mode ? '#3498db' : '#252525', color: symbolsViewMode === mode ? '#fff' : '#666', border: 'none', cursor: 'pointer', fontSize: '11px' }}
                        >{mode === 'grid' ? '⊞' : '☰'}</button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                {renderItemList(symbols, 3, 'No symbols yet. Use the buttons above to create one.')}
              </div>

              {symbols.length > 0 && (
                <p style={{ fontSize: '9px', color: '#444', marginTop: '6px', textAlign: 'center', flexShrink: 0, fontStyle: 'italic' }}>
                  Click to place on PDF • Drag also works
                </p>
              )}
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* STAMPS TAB */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {activeTab === 'stamps' && (
            <>
              {/* Stamp creation buttons */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
                {actionBtn('Aa Custom Text', () => setShowStampCreator(!showStampCreator), { bg: showStampCreator ? '#3498db' : '#333', color: showStampCreator ? '#fff' : '#ccc' })}
                {actionBtn('📁 Upload', () => handleUploadImage('stamp'))}
              </div>

              {/* Custom stamp creator */}
              {showStampCreator && (
                <div style={{ padding: '10px', background: '#252525', borderRadius: '6px', marginBottom: '8px', border: '1px solid #444', flexShrink: 0 }}>
                  <input
                    type="text" placeholder="Stamp text..." value={stampText}
                    onChange={(e) => setStampText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveCustomStamp(); }}
                    style={{ width: '100%', padding: '7px 8px', background: '#333', border: '1px solid #444', borderRadius: '4px', color: '#fff', fontSize: '12px', boxSizing: 'border-box', marginBottom: '8px' }}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
                    <label style={{ fontSize: '10px', color: '#888' }}>Text:</label>
                    <input type="color" value={stampColor} onChange={(e) => setStampColor(e.target.value)} style={{ width: '28px', height: '24px', border: 'none', borderRadius: '3px', cursor: 'pointer', padding: 0 }} />
                    <label style={{ fontSize: '10px', color: '#888', marginLeft: '8px' }}>Fill:</label>
                    <input type="color" value={stampBg} onChange={(e) => setStampBg(e.target.value)} style={{ width: '28px', height: '24px', border: 'none', borderRadius: '3px', cursor: 'pointer', padding: 0 }} />
                    <div style={{ flex: 1 }} />
                    {actionBtn('Save', saveCustomStamp, { disabled: !stampText.trim(), bg: '#27ae60', color: '#fff', flex: 'none', style: { padding: '5px 14px' } })}
                  </div>
                  {/* Preview */}
                  {stampText.trim() && (
                    <div style={{ textAlign: 'center', padding: '8px', background: '#1a1a1a', borderRadius: '4px' }}>
                      <span style={{ fontSize: '14px', fontWeight: '700', color: stampColor, border: `2px solid ${stampColor}`, padding: '4px 12px', background: stampBg, letterSpacing: '0.5px' }}>
                        {stampText.trim().toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* User-created stamps */}
              {stamps.length > 0 && sectionLabel('Saved Stamps')}
              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                {renderItemList(stamps, 2, 'No stamps yet. Create from selection, text, or upload.')}
              </div>

              <p style={{ fontSize: '9px', color: '#444', marginTop: '6px', textAlign: 'center', flexShrink: 0, fontStyle: 'italic' }}>
                Click to place on PDF • Drag also works
              </p>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* SIGNATURES TAB */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {activeTab === 'signatures' && (
            <>
              <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
                {actionBtn('✍️ Draw', () => setShowSignaturePad(true), { title: 'Draw your signature' })}
                {actionBtn('Aa Type', () => setShowTypeSignature(true), { title: 'Type your signature' })}
                {actionBtn('📁 Upload', () => handleUploadImage('signature'), { title: 'Upload signature image' })}
              </div>

              {/* Type signature inline */}
              {showTypeSignature && (
                <div style={{ padding: '10px', background: '#252525', borderRadius: '6px', marginBottom: '8px', border: '1px solid #444', flexShrink: 0 }}>
                  <input
                    type="text" placeholder="Type your name..." value={sigText}
                    onChange={(e) => setSigText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveTypedSignature(); if (e.key === 'Escape') setShowTypeSignature(false); }}
                    style={{ width: '100%', padding: '7px 8px', background: '#333', border: '1px solid #444', borderRadius: '4px', color: '#fff', fontSize: '12px', boxSizing: 'border-box', marginBottom: '8px' }}
                    autoFocus
                  />
                  {/* Font selection */}
                  <div style={{ display: 'flex', gap: '3px', marginBottom: '8px', flexWrap: 'wrap' }}>
                    {SIGNATURE_FONTS.map(f => (
                      <button
                        key={f.name}
                        onClick={() => setSigFont(f.name)}
                        style={{
                          flex: 1, padding: '4px 6px',
                          background: sigFont === f.name ? '#3498db' : '#333',
                          color: sigFont === f.name ? '#fff' : '#aaa',
                          border: 'none', borderRadius: '3px', cursor: 'pointer',
                          fontSize: '10px', fontFamily: `'${f.name}', cursive`,
                          minWidth: '60px',
                        }}
                      >{f.label}</button>
                    ))}
                  </div>
                  {/* Color */}
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
                    <label style={{ fontSize: '10px', color: '#888' }}>Color:</label>
                    <input type="color" value={sigColor} onChange={(e) => setSigColor(e.target.value)} style={{ width: '28px', height: '24px', border: 'none', borderRadius: '3px', cursor: 'pointer', padding: 0 }} />
                    {['#000000', '#1a237e', '#b71c1c'].map(c => (
                      <button key={c} onClick={() => setSigColor(c)} style={{ width: '22px', height: '22px', background: c, border: sigColor === c ? '2px solid #3498db' : '2px solid #555', borderRadius: '3px', cursor: 'pointer', padding: 0 }} />
                    ))}
                    <div style={{ flex: 1 }} />
                    {actionBtn('Save', saveTypedSignature, { disabled: !sigText.trim(), bg: '#27ae60', color: '#fff', flex: 'none', style: { padding: '5px 14px' } })}
                  </div>
                  {/* Preview */}
                  {sigText.trim() && (
                    <div style={{ textAlign: 'center', padding: '12px 8px', background: '#1a1a1a', borderRadius: '4px' }}>
                      <span style={{ fontFamily: `'${sigFont}', cursive`, fontSize: '28px', color: sigColor }}>
                        {sigText}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Saved signatures */}
              {signatures.length > 0 && sectionLabel('Saved Signatures')}
              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                {renderItemList(signatures, 2, 'No signatures yet. Draw, type, or upload one above.', true)}
              </div>

              <p style={{ fontSize: '9px', color: '#444', marginTop: '6px', textAlign: 'center', flexShrink: 0, fontStyle: 'italic' }}>
                Click to place on PDF • ★ = default (S key) • Drag also works
              </p>
            </>
          )}

        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SIGNATURE PAD MODAL */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {showSignaturePad && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}
          onClick={() => setShowSignaturePad(false)}
        >
          <div style={{ background: '#1e1e1e', borderRadius: '12px', width: '520px', maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', border: '1px solid #333' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid #333' }}>
              <h3 style={{ margin: 0, color: '#fff', fontSize: '16px' }}>Draw Signature</h3>
              <button onClick={() => setShowSignaturePad(false)} style={{ background: 'none', border: 'none', color: '#888', fontSize: '24px', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
            </div>

            {/* Canvas */}
            <div style={{ padding: '16px 18px' }}>
              <div style={{ background: '#fff', borderRadius: '8px', overflow: 'hidden', border: '2px solid #444', marginBottom: '12px' }}>
                <canvas
                  ref={sigCanvasRef}
                  width={600}
                  height={200}
                  style={{ width: '100%', height: 'auto', cursor: 'crosshair', display: 'block' }}
                  onMouseDown={handleSigMouseDown}
                  onMouseMove={handleSigMouseMove}
                  onMouseUp={handleSigMouseUp}
                  onMouseLeave={handleSigMouseUp}
                />
              </div>

              {/* Tools row */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
                <label style={{ fontSize: '10px', color: '#888' }}>Color:</label>
                <input type="color" value={sigColor} onChange={(e) => setSigColor(e.target.value)} style={{ width: '28px', height: '24px', border: 'none', borderRadius: '3px', cursor: 'pointer', padding: 0 }} />
                {['#000000', '#1a237e', '#b71c1c'].map(c => (
                  <button key={c} onClick={() => setSigColor(c)} style={{ width: '22px', height: '22px', background: c, border: sigColor === c ? '2px solid #3498db' : '2px solid #555', borderRadius: '3px', cursor: 'pointer', padding: 0 }} />
                ))}
                <div style={{ width: '1px', height: '20px', background: '#444', margin: '0 4px' }} />
                <label style={{ fontSize: '10px', color: '#888' }}>Size:</label>
                <input type="range" min="1" max="8" value={sigPenSize} onChange={(e) => setSigPenSize(parseInt(e.target.value))} style={{ width: '80px' }} />
                <span style={{ fontSize: '10px', color: '#666', minWidth: '16px' }}>{sigPenSize}</span>
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 18px', borderTop: '1px solid #333' }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={undoSignature} style={{ padding: '8px 14px', background: '#333', border: 'none', borderRadius: '6px', color: '#ccc', fontSize: '12px', cursor: 'pointer' }}>↩ Undo</button>
                <button onClick={clearSignature} style={{ padding: '8px 14px', background: '#333', border: 'none', borderRadius: '6px', color: '#ccc', fontSize: '12px', cursor: 'pointer' }}>Clear</button>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => setShowSignaturePad(false)} style={{ padding: '8px 16px', background: '#444', border: 'none', borderRadius: '6px', color: '#ccc', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
                <button onClick={saveSignature} style={{ padding: '8px 20px', background: '#27ae60', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>Save Signature</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* CLEANUP EDITOR MODAL (shared by capture + upload) */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {isEditingSymbol && capturedImage && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: '20px' }}
          onClick={cancelEditing}
        >
          <div style={{ background: '#1e1e1e', borderRadius: '12px', width: '90%', maxWidth: '900px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', border: '1px solid #333' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #333' }}>
              <h3 style={{ margin: 0, color: '#fff', fontSize: '18px' }}>
                Edit {editSaveCategory === 'stamp' ? 'Stamp' : editSaveCategory === 'signature' ? 'Signature' : 'Symbol'} Image
              </h3>
              <button onClick={cancelEditing} style={{ background: 'none', border: 'none', color: '#888', fontSize: '28px', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
            </div>
            
            {/* Body */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', padding: '20px', gap: '20px' }}>
              {/* Canvas with crop overlay */}
              <div ref={editCanvasContainerRef} style={{
                flex: 1, background: '#fff', border: '2px solid #444', borderRadius: '8px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', minHeight: '300px',
                position: 'relative',
                backgroundImage: 'linear-gradient(45deg, #ddd 25%, transparent 25%), linear-gradient(-45deg, #ddd 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ddd 75%), linear-gradient(-45deg, transparent 75%, #ddd 75%)',
                backgroundSize: '20px 20px', backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
              }}>
                <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', maxHeight: '100%' }}>
                  <canvas
                    ref={editCanvasRef}
                    width={capturedImage.width} height={capturedImage.height}
                    style={{ maxWidth: '100%', maxHeight: '100%', display: 'block', cursor: editTool === 'crop' ? 'default' : 'crosshair' }}
                    onMouseDown={handleEditCanvasMouseDown}
                    onMouseMove={handleEditCanvasMouseMove}
                    onMouseUp={handleEditCanvasMouseUp}
                    onMouseLeave={handleEditCanvasMouseUp}
                  />
                  {/* Crop overlay - 4 dark bars on each edge */}
                  {editTool === 'crop' && (cropTop > 0 || cropBottom > 0 || cropLeft > 0 || cropRight > 0) && (
                    <>
                      {/* Top bar */}
                      {cropTop > 0 && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: `${cropTop}%`, background: 'rgba(0,0,0,0.5)', pointerEvents: 'none', borderBottom: '2px dashed #ff4444' }} />}
                      {/* Bottom bar */}
                      {cropBottom > 0 && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${cropBottom}%`, background: 'rgba(0,0,0,0.5)', pointerEvents: 'none', borderTop: '2px dashed #ff4444' }} />}
                      {/* Left bar */}
                      {cropLeft > 0 && <div style={{ position: 'absolute', top: `${cropTop}%`, bottom: `${cropBottom}%`, left: 0, width: `${cropLeft}%`, background: 'rgba(0,0,0,0.5)', pointerEvents: 'none', borderRight: '2px dashed #ff4444' }} />}
                      {/* Right bar */}
                      {cropRight > 0 && <div style={{ position: 'absolute', top: `${cropTop}%`, bottom: `${cropBottom}%`, right: 0, width: `${cropRight}%`, background: 'rgba(0,0,0,0.5)', pointerEvents: 'none', borderLeft: '2px dashed #ff4444' }} />}
                    </>
                  )}
                </div>
              </div>
              
              {/* Tools Panel */}
              <div style={{ width: '240px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' }}>
                {/* Name */}
                <div style={{ background: '#252525', borderRadius: '8px', padding: '10px' }}>
                  <label style={{ display: 'block', color: '#888', fontSize: '10px', marginBottom: '4px' }}>Name:</label>
                  <input type="text" value={symbolName} onChange={(e) => setSymbolName(e.target.value)} placeholder="Enter name..."
                    style={{ width: '100%', padding: '7px', background: '#333', border: '1px solid #444', borderRadius: '4px', color: '#fff', fontSize: '12px', boxSizing: 'border-box' }}
                  />
                </div>

                {/* Tools */}
                <div style={{ background: '#252525', borderRadius: '8px', padding: '10px' }}>
                  <label style={{ display: 'block', color: '#888', fontSize: '10px', marginBottom: '4px' }}>Tools:</label>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {[['eraser', '🧹 Eraser'], ['fill', '⬜ Fill'], ['crop', '✂️ Crop']].map(([tool, label]) => (
                      <button key={tool} onClick={() => { setEditTool(tool); if (tool !== 'crop') { setCropTop(0); setCropBottom(0); setCropLeft(0); setCropRight(0); } }}
                        style={{ flex: 1, padding: '6px', background: editTool === tool ? '#3498db' : '#333', border: '1px solid #444', borderRadius: '4px', color: editTool === tool ? '#fff' : '#ccc', fontSize: '11px', cursor: 'pointer' }}
                      >{label}</button>
                    ))}
                  </div>
                  
                  {/* Brush size (eraser/fill only) */}
                  {editTool !== 'crop' && (
                    <div style={{ marginTop: '6px' }}>
                      <label style={{ display: 'block', color: '#666', fontSize: '9px', marginBottom: '2px' }}>Brush: {editBrushSize}px</label>
                      <input type="range" min="2" max="50" value={editBrushSize} onChange={(e) => setEditBrushSize(parseInt(e.target.value))} style={{ width: '100%' }} />
                    </div>
                  )}
                  
                  {/* Crop sliders */}
                  {editTool === 'crop' && (
                    <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      {[
                        ['Top', cropTop, setCropTop],
                        ['Bottom', cropBottom, setCropBottom],
                        ['Left', cropLeft, setCropLeft],
                        ['Right', cropRight, setCropRight],
                      ].map(([label, value, setter]) => (
                        <div key={label}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ color: '#999', fontSize: '9px' }}>{label}</label>
                            <span style={{ color: '#ccc', fontSize: '9px', fontFamily: 'monospace' }}>{value.toFixed(1)}%</span>
                          </div>
                          <input type="range" min="0" max="49" step="0.5" value={value}
                            onChange={(e) => setter(parseFloat(e.target.value))}
                            style={{ width: '100%' }}
                          />
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                        <button onClick={autoCropDetect}
                          style={{ flex: 1, padding: '5px', background: '#555', border: '1px solid #666', borderRadius: '4px', color: '#fff', fontSize: '10px', cursor: 'pointer' }}
                        >🎯 Auto-detect</button>
                        <button onClick={() => { setCropTop(0); setCropBottom(0); setCropLeft(0); setCropRight(0); }}
                          style={{ flex: 1, padding: '5px', background: '#444', border: '1px solid #555', borderRadius: '4px', color: '#ccc', fontSize: '10px', cursor: 'pointer' }}
                        >↩️ Reset</button>
                      </div>
                      <button onClick={applyCrop}
                        style={{ padding: '7px', background: '#27ae60', border: 'none', borderRadius: '4px', color: '#fff', fontSize: '11px', fontWeight: '500', cursor: 'pointer', marginTop: '2px' }}
                      >✅ Apply Crop</button>
                    </div>
                  )}
                </div>
                
                {/* Quick Actions */}
                <div style={{ background: '#252525', borderRadius: '8px', padding: '10px' }}>
                  <label style={{ display: 'block', color: '#888', fontSize: '10px', marginBottom: '4px' }}>Quick Actions:</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px' }}>
                    {[
                      ['🔲 Remove BG', () => removeBackground(240)],
                      ['✨ Threshold', () => removeNoise(200)],
                      ['🧹 Specks', () => removeSpecks(30)],
                      ['🔄 Invert', invertColors],
                      ['✂️ Trim', trimTransparent],
                      ['↩️ Reset', resetToOriginal],
                    ].map(([label, fn]) => (
                      <button key={label} onClick={fn} style={{ padding: '5px 4px', background: '#333', border: '1px solid #444', borderRadius: '4px', color: '#ccc', fontSize: '10px', cursor: 'pointer' }}>{label}</button>
                    ))}
                  </div>
                </div>
                
                {/* Recolor */}
                <div style={{ background: '#252525', borderRadius: '8px', padding: '10px' }}>
                  <label style={{ display: 'block', color: '#888', fontSize: '10px', marginBottom: '4px' }}>Recolor:</label>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '6px' }}>
                    <input type="color" value={symbolColor} onChange={(e) => setSymbolColor(e.target.value)} style={{ width: '32px', height: '26px', border: 'none', borderRadius: '4px', cursor: 'pointer' }} />
                    <button onClick={() => recolorSymbol(symbolColor)} style={{ flex: 1, padding: '5px', background: '#444', border: '1px solid #555', borderRadius: '4px', color: '#fff', fontSize: '11px', cursor: 'pointer' }}>Apply</button>
                  </div>
                  <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                    {['#000000', '#ff0000', '#0000ff', '#00aa00', '#ff6600', '#9900cc'].map(color => (
                      <button key={color} onClick={() => { setSymbolColor(color); recolorSymbol(color); }}
                        style={{ width: '24px', height: '24px', background: color, border: '2px solid #444', borderRadius: '3px', cursor: 'pointer' }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '14px 20px', borderTop: '1px solid #333' }}>
              <button onClick={cancelEditing} style={{ padding: '10px 20px', background: '#444', border: 'none', borderRadius: '6px', color: '#ccc', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveEditedSymbol} style={{ padding: '10px 24px', background: '#27ae60', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '13px', fontWeight: '500', cursor: 'pointer' }}>
                💾 Save {editSaveCategory === 'stamp' ? 'Stamp' : editSaveCategory === 'signature' ? 'Signature' : 'Symbol'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
