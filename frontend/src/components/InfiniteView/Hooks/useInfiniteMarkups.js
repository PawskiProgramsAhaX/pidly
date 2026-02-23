/**
 * useInfiniteMarkups.js
 * 
 * Centralized markup state management for InfiniteView.
 * Equivalent to PDFViewer's useMarkups.js but adapted for the multi-slot infinite canvas model.
 * 
 * KEY DIFFERENCES FROM INLINE STATE:
 * - All coordinates are normalized 0→1 (fraction of slot canvas dimensions)
 * - Field names match PDFViewer: startX/startY/endX/endY (not x1/y1/x2/y2)
 * - Provides getMarkupBounds() compatible with shared renderSelectionHandles
 * - Per-tool defaults are stored and restored on tool switch
 * 
 * COORDINATE SYSTEM:
 *   Normalized: { startX: 0.125, startY: 0.2 }  → fraction of canvas width/height
 *   Pixel:      { x: 100, y: 200 }               → actual pixels in SVG space
 *   
 *   Mouse input (pixels) → pixelToNorm() → stored normalized → renderMarkupShape multiplies by scaledWidth/Height → pixels for SVG
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

const MAX_HISTORY = 50;

export default function useInfiniteMarkups() {
  // ═══════════════════════════════════════════════════════════════════════
  // TOOL STATE
  // ═══════════════════════════════════════════════════════════════════════
  const [markupMode, setMarkupMode] = useState(null);
  const [showMarkupsToolbar, setShowMarkupsToolbar] = useState(true);

  // ═══════════════════════════════════════════════════════════════════════
  // ANNOTATION STORAGE — normalized 0→1 coords, keyed by slotId
  // ═══════════════════════════════════════════════════════════════════════
  const [slotAnnotations, setSlotAnnotations] = useState({}); // { slotId: [markups] }
  const slotAnnotationsRef = useRef({});
  useEffect(() => { slotAnnotationsRef.current = slotAnnotations; }, [slotAnnotations]);

  // ═══════════════════════════════════════════════════════════════════════
  // DRAWING STATE
  // ═══════════════════════════════════════════════════════════════════════
  const [currentMarkup, setCurrentMarkup] = useState(null);
  const [isDrawingMarkup, setIsDrawingMarkup] = useState(false);

  // ═══════════════════════════════════════════════════════════════════════
  // SELECTION STATE
  // ═══════════════════════════════════════════════════════════════════════
  const [selectedMarkup, setSelectedMarkup] = useState(null);
  const [selectedMarkups, setSelectedMarkups] = useState([]); // multi-select (future)
  const selectedMarkupRef = useRef(null);
  useEffect(() => { selectedMarkupRef.current = selectedMarkup; }, [selectedMarkup]);

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [resizeHandle, setResizeHandle] = useState(null);
  const [draggingPolylinePoint, setDraggingPolylinePoint] = useState(null);
  const [activeArcHandle, setActiveArcHandle] = useState(null);
  const [dragStart, setDragStart] = useState(null); // { x, y, markup: {...} }

  // ═══════════════════════════════════════════════════════════════════════
  // TEXT EDITING
  // ═══════════════════════════════════════════════════════════════════════
  const [editingTextMarkupId, setEditingTextMarkupId] = useState(null);
  const [textEditValue, setTextEditValue] = useState('');
  const textInputRef = useRef(null);

  // ═══════════════════════════════════════════════════════════════════════
  // UNDO / REDO HISTORY — stores full snapshots of slotAnnotations
  // ═══════════════════════════════════════════════════════════════════════
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);

  const saveHistory = useCallback(() => {
    const current = slotAnnotationsRef.current;
    setHistory(prev => [...prev.slice(-(MAX_HISTORY - 1)), JSON.parse(JSON.stringify(current))]);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));
    setFuture(prev => [JSON.parse(JSON.stringify(slotAnnotationsRef.current)), ...prev].slice(0, MAX_HISTORY));
    setSlotAnnotations(previous);
    setSelectedMarkup(null);
  }, [history]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture(prev => prev.slice(1));
    setHistory(prev => [...prev.slice(-(MAX_HISTORY - 1)), JSON.parse(JSON.stringify(slotAnnotationsRef.current))]);
    setSlotAnnotations(next);
    setSelectedMarkup(null);
  }, [future]);

  // Jump to specific history index (for history panel)
  const jumpToHistory = useCallback((index) => {
    if (index < 0 || index >= history.length) return;
    const target = history[index];
    const currentSnapshot = JSON.parse(JSON.stringify(slotAnnotationsRef.current));
    // Everything after index becomes future, current state goes to front of future
    const newFuture = [currentSnapshot, ...history.slice(index + 1).reverse(), ...future].slice(0, MAX_HISTORY);
    const newHistory = history.slice(0, index);
    setHistory(newHistory);
    setFuture(newFuture);
    setSlotAnnotations(target);
    setSelectedMarkup(null);
  }, [history, future]);

  // ═══════════════════════════════════════════════════════════════════════
  // ANNOTATION CRUD — history-aware
  // ═══════════════════════════════════════════════════════════════════════

  const addMarkupWithHistory = useCallback((slotId, markup) => {
    saveHistory();
    const markupWithMeta = {
      ...markup,
      createdDate: markup.createdDate || new Date().toISOString(),
    };
    setSlotAnnotations(prev => ({
      ...prev,
      [slotId]: [...(prev[slotId] || []), markupWithMeta]
    }));
  }, [saveHistory]);

  const deleteMarkupWithHistory = useCallback((slotId, markupId) => {
    saveHistory();
    setSlotAnnotations(prev => ({
      ...prev,
      [slotId]: (prev[slotId] || []).filter(m => m.id !== markupId)
    }));
  }, [saveHistory]);

  const updateMarkupWithHistory = useCallback((slotId, markupId, updates) => {
    saveHistory();
    setSlotAnnotations(prev => ({
      ...prev,
      [slotId]: (prev[slotId] || []).map(m =>
        m.id === markupId ? { ...m, ...updates, modified: true } : m
      )
    }));
  }, [saveHistory]);

  // Update WITHOUT pushing history (for real-time drag/resize)
  const updateMarkupLive = useCallback((slotId, markupId, updates) => {
    setSlotAnnotations(prev => ({
      ...prev,
      [slotId]: (prev[slotId] || []).map(m =>
        m.id === markupId ? { ...m, ...updates } : m
      )
    }));
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // CLIPBOARD (copy/paste)
  // ═══════════════════════════════════════════════════════════════════════
  const [clipboard, setClipboard] = useState(null); // { markups: [...], sourceSlotId }

  const copyMarkups = useCallback(() => {
    const target = selectedMarkup;
    if (!target) return;
    // Deep clone and store
    setClipboard({
      markups: [JSON.parse(JSON.stringify(target))],
      sourceSlotId: target.slotId,
    });
  }, [selectedMarkup]);

  const pasteMarkups = useCallback((targetSlotId) => {
    if (!clipboard || !clipboard.markups.length) return;
    saveHistory();
    const offset = 0.02; // Small offset so paste is visible
    const pasted = clipboard.markups.map(m => ({
      ...m,
      id: `${m.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      slotId: targetSlotId,
      fromPdf: false,
      modified: false,
      createdDate: new Date().toISOString(),
      // Offset position
      ...(m.points ? {
        points: m.points.map(p => ({ x: p.x + offset, y: p.y + offset }))
      } : {}),
      ...(m.startX !== undefined ? {
        startX: m.startX + offset,
        startY: m.startY + offset,
        endX: m.endX + offset,
        endY: m.endY + offset,
      } : {}),
    }));
    setSlotAnnotations(prev => ({
      ...prev,
      [targetSlotId]: [...(prev[targetSlotId] || []), ...pasted]
    }));
    // Select the pasted markup
    if (pasted.length === 1) {
      setSelectedMarkup(pasted[0]);
    }
  }, [clipboard, saveHistory]);

  // ═══════════════════════════════════════════════════════════════════════
  // MARKUP STYLING — per-tool defaults with localStorage persistence
  // ═══════════════════════════════════════════════════════════════════════
  const [markupColor, setMarkupColor] = useState('#ff0000');
  const [markupStrokeWidth, setMarkupStrokeWidth] = useState(2);
  const [markupOpacity, setMarkupOpacity] = useState(0.4); // highlighter
  const [markupFillColor, setMarkupFillColor] = useState('none');
  const [markupFillOpacity, setMarkupFillOpacity] = useState(0.3);
  const [markupStrokeOpacity, setMarkupStrokeOpacity] = useState(1);
  const [markupArrowHeadSize, setMarkupArrowHeadSize] = useState(12);
  const [markupLineStyle, setMarkupLineStyle] = useState('solid');

  // Text
  const [markupFontSize, setMarkupFontSize] = useState(14);
  const [markupFontFamily, setMarkupFontFamily] = useState('Arial');
  const [markupTextAlign, setMarkupTextAlign] = useState('left');
  const [markupVerticalAlign, setMarkupVerticalAlign] = useState('top');
  const [markupTextPadding, setMarkupTextPadding] = useState(4);
  const [markupLineSpacing, setMarkupLineSpacing] = useState(1.2);

  // Border
  const [markupBorderColor, setMarkupBorderColor] = useState('none');
  const [markupBorderWidth, setMarkupBorderWidth] = useState(1);
  const [markupBorderStyle, setMarkupBorderStyle] = useState('solid');
  const [markupBorderOpacity, setMarkupBorderOpacity] = useState(1);

  // Cloud
  const [markupCloudArcSize, setMarkupCloudArcSize] = useState(15);
  const [markupCloudIntensity, setMarkupCloudIntensity] = useState(1);
  const [markupCloudInverted, setMarkupCloudInverted] = useState(false);
  const [markupCloudBulge, setMarkupCloudBulge] = useState(0.5);

  // UI preference
  const [penHighlighterUIMode, setPenHighlighterUIMode] = useState(() => {
    try { return localStorage.getItem('penHighlighterUIMode') || 'slider'; } catch { return 'slider'; }
  });

  // ─── Per-tool defaults persistence ────────────────────────────────────

  const loadToolDefaults = useCallback((tool) => {
    try {
      const saved = localStorage.getItem(`infiniteView_${tool}Defaults`);
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  }, []);

  const saveToolDefaults = useCallback((tool, settings) => {
    try {
      localStorage.setItem(`infiniteView_${tool}Defaults`, JSON.stringify(settings));
    } catch (e) {
      console.warn('Failed to save tool defaults:', e);
    }
  }, []);

  // Per-tool fallback defaults — every property a tool uses must be listed to prevent bleed
  const TOOL_FALLBACKS = useMemo(() => ({
    pen:            { color: '#ff0000', strokeWidth: 3, opacity: 1, strokeOpacity: 1, lineStyle: 'solid' },
    highlighter:    { color: '#ffff00', strokeWidth: 8, opacity: 0.4, strokeOpacity: 1, lineStyle: 'solid' },
    arrow:          { color: '#ff0000', strokeWidth: 2, opacity: 1, strokeOpacity: 1, lineStyle: 'solid', arrowHeadSize: 10 },
    line:           { color: '#ff0000', strokeWidth: 2, opacity: 1, strokeOpacity: 1, lineStyle: 'solid' },
    rectangle:      { color: '#ff0000', strokeWidth: 2, opacity: 1, strokeOpacity: 1, fillColor: 'none', fillOpacity: 0, lineStyle: 'solid' },
    circle:         { color: '#ff0000', strokeWidth: 2, opacity: 1, strokeOpacity: 1, fillColor: 'none', fillOpacity: 0, lineStyle: 'solid' },
    arc:            { color: '#ff0000', strokeWidth: 2, opacity: 1, strokeOpacity: 1, lineStyle: 'solid' },
    cloud:          { color: '#ff0000', strokeWidth: 2, opacity: 1, strokeOpacity: 1, fillColor: 'none', fillOpacity: 0, cloudArcSize: 15, cloudIntensity: 1, cloudInverted: false, cloudBulge: 0.5 },
    polyline:       { color: '#ff0000', strokeWidth: 2, opacity: 1, strokeOpacity: 1, fillColor: 'none', fillOpacity: 0, lineStyle: 'solid' },
    polylineArrow:  { color: '#ff0000', strokeWidth: 2, opacity: 1, strokeOpacity: 1, lineStyle: 'solid', arrowHeadSize: 10 },
    cloudPolyline:  { color: '#ff0000', strokeWidth: 2, opacity: 1, strokeOpacity: 1, fillColor: 'none', fillOpacity: 0, cloudArcSize: 15, cloudIntensity: 1, cloudInverted: false },
    text:           { color: '#ff0000', opacity: 1, strokeOpacity: 1, fillColor: 'none', fillOpacity: 0, fontSize: 16, fontFamily: 'sans-serif', textAlign: 'left', verticalAlign: 'top', lineSpacing: 1.2, textPadding: 4, borderColor: 'none', borderWidth: 1, borderStyle: 'solid', borderOpacity: 1 },
    callout:        { color: '#ff0000', opacity: 1, strokeOpacity: 1, fillColor: '#ffffcc', fillOpacity: 1, fontSize: 14 },
    note:           { color: '#ffff00', opacity: 1, strokeOpacity: 1 },
    eraser:         { opacity: 1 },
  }), []);

  // Apply saved defaults when tool changes — ALWAYS reset every property to prevent bleed
  useEffect(() => {
    if (!markupMode) return;
    const saved = loadToolDefaults(markupMode) || {};
    const fb = TOOL_FALLBACKS[markupMode] || {};

    // Color — only apply if user has saved a default for this tool, otherwise keep current
    if (saved.color !== undefined) setMarkupColor(saved.color);

    // Stroke
    setMarkupStrokeWidth(saved.strokeWidth ?? fb.strokeWidth ?? 2);
    setMarkupOpacity(saved.opacity ?? fb.opacity ?? 1);
    setMarkupStrokeOpacity(saved.strokeOpacity ?? fb.strokeOpacity ?? 1);
    setMarkupLineStyle(saved.lineStyle ?? fb.lineStyle ?? 'solid');

    // Fill
    setMarkupFillColor(saved.fillColor ?? fb.fillColor ?? 'none');
    setMarkupFillOpacity(saved.fillOpacity ?? fb.fillOpacity ?? 0);

    // Arrow
    setMarkupArrowHeadSize(saved.arrowHeadSize ?? fb.arrowHeadSize ?? 10);

    // Text
    setMarkupFontSize(saved.fontSize ?? fb.fontSize ?? 16);
    setMarkupFontFamily(saved.fontFamily ?? fb.fontFamily ?? 'sans-serif');
    setMarkupTextAlign(saved.textAlign ?? fb.textAlign ?? 'left');
    setMarkupVerticalAlign(saved.verticalAlign ?? fb.verticalAlign ?? 'top');
    setMarkupLineSpacing(saved.lineSpacing ?? fb.lineSpacing ?? 1.2);
    setMarkupTextPadding(saved.textPadding ?? fb.textPadding ?? 4);

    // Cloud
    setMarkupCloudArcSize(saved.cloudArcSize ?? fb.cloudArcSize ?? 15);
    setMarkupCloudIntensity(saved.cloudIntensity ?? fb.cloudIntensity ?? 1);
    setMarkupCloudInverted(saved.cloudInverted ?? fb.cloudInverted ?? false);
    setMarkupCloudBulge(saved.cloudBulge ?? fb.cloudBulge ?? 0.5);

    // Border
    setMarkupBorderColor(saved.borderColor ?? fb.borderColor ?? 'none');
    setMarkupBorderWidth(saved.borderWidth ?? fb.borderWidth ?? 1);
    setMarkupBorderStyle(saved.borderStyle ?? fb.borderStyle ?? 'solid');
    setMarkupBorderOpacity(saved.borderOpacity ?? fb.borderOpacity ?? 1);
  }, [markupMode, loadToolDefaults]);

  // ═══════════════════════════════════════════════════════════════════════
  // SYMBOLS
  // ═══════════════════════════════════════════════════════════════════════
  const [savedSymbols, setSavedSymbols] = useState(() => {
    try { return JSON.parse(localStorage.getItem('markup_symbols') || '[]'); } catch { return []; }
  });
  const [pendingPlacement, setPendingPlacement] = useState(null);
  const [symbolSearchQuery, setSymbolSearchQuery] = useState('');
  const [symbolsViewMode, setSymbolsViewMode] = useState('grid');
  const [defaultSignatureId, setDefaultSignatureId] = useState(null);

  // Persist symbols
  useEffect(() => {
    try { localStorage.setItem('markup_symbols', JSON.stringify(savedSymbols)); } catch {}
  }, [savedSymbols]);

  /**
   * Place a symbol on a slot at a given normalized position.
   * @param {Object} symbol - Symbol data (image or vector markups)
   * @param {string} slotId - Target slot
   * @param {number} normX - Normalized X center (0→1)
   * @param {number} normY - Normalized Y center (0→1)
   */
  const placeSymbol = useCallback((symbol, slotId, normX, normY) => {
    if (!symbol) return;
    saveHistory();

    if (symbol.image) {
      // Image symbol
      const normW = symbol.originalWidth || 0.1;
      const normH = symbol.originalHeight || (0.1 / (symbol.aspectRatio || 1));
      const sx = normX - normW / 2;
      const sy = normY - normH / 2;

      const imageMarkup = {
        id: `image_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'image',
        image: symbol.image,
        startX: sx,
        startY: sy,
        endX: sx + normW,
        endY: sy + normH,
        aspectRatio: symbol.aspectRatio || (normW / normH),
        slotId,
      };
      setSlotAnnotations(prev => ({
        ...prev,
        [slotId]: [...(prev[slotId] || []), imageMarkup]
      }));
    } else if (symbol.markups) {
      // Vector symbol — markups are already in normalized coords
      const normW = symbol.originalWidth || 0.1;
      const normH = symbol.originalHeight || (0.1 / (symbol.aspectRatio || 1));
      const originX = normX - normW / 2;
      const originY = normY - normH / 2;

      const newMarkups = symbol.markups.map(m => {
        const mk = {
          ...m,
          id: `${m.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          slotId,
        };

        if (m.points) {
          mk.points = m.points.map(p => ({
            x: originX + p.x * normW,
            y: originY + p.y * normH
          }));
        }
        if (m.startX !== undefined) {
          mk.startX = originX + m.startX * normW;
          mk.startY = originY + m.startY * normH;
          mk.endX = originX + m.endX * normW;
          mk.endY = originY + m.endY * normH;
        }
        return mk;
      });

      setSlotAnnotations(prev => ({
        ...prev,
        [slotId]: [...(prev[slotId] || []), ...newMarkups]
      }));
    }
    setPendingPlacement(null);
  }, [saveHistory]);

  // ═══════════════════════════════════════════════════════════════════════
  // SLOT LOCKING (which slots are editable)
  // ═══════════════════════════════════════════════════════════════════════
  const [unlockedSlots, setUnlockedSlots] = useState(new Set());

  // Track which PDF annotations we've "taken over"
  const [ownedAnnotationIds, setOwnedAnnotationIds] = useState({}); // { slotId: Set<id> }

  // ═══════════════════════════════════════════════════════════════════════
  // UI PANEL VISIBILITY (symbols, history, views panels)
  // ═══════════════════════════════════════════════════════════════════════
  const [showSymbolsPanel, setShowSymbolsPanel] = useState(false);
  const [showMarkupHistoryPanel, setShowMarkupHistoryPanel] = useState(false);
  const [showViewsPanel, setShowViewsPanel] = useState(false);

  // Close panels when all slots locked
  useEffect(() => {
    if (unlockedSlots.size === 0) {
      setShowSymbolsPanel(false);
      setShowMarkupHistoryPanel(false);
    }
  }, [unlockedSlots.size]);

  // ═══════════════════════════════════════════════════════════════════════
  // COORDINATE CONVERSION HELPERS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Convert pixel coordinates to normalized 0→1.
   * Use at mouse input boundaries (mouseDown/Move/Up).
   */
  const pixelToNorm = useCallback((px, py, canvasWidth, canvasHeight) => ({
    x: px / canvasWidth,
    y: py / canvasHeight
  }), []);

  /**
   * Convert normalized 0→1 to pixel coordinates.
   * Rarely needed directly since renderMarkupShape handles this,
   * but useful for hit-testing and bounds checking.
   */
  const normToPixel = useCallback((nx, ny, canvasWidth, canvasHeight) => ({
    x: nx * canvasWidth,
    y: ny * canvasHeight
  }), []);

  // ═══════════════════════════════════════════════════════════════════════
  // BOUNDS CALCULATION — returns normalized { minX, minY, maxX, maxY }
  // Compatible with renderSelectionHandles
  // ═══════════════════════════════════════════════════════════════════════

  const getMarkupBounds = useCallback((markup) => {
    if (!markup) return null;

    // Points-based types (pen, highlighter, polyline, polygon, etc.)
    if (markup.points && markup.points.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      markup.points.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
      return { minX, minY, maxX, maxY };
    }

    // Rect-based types (rectangle, circle, arrow, line, text, cloud, arc, image)
    if (markup.startX !== undefined) {
      return {
        minX: Math.min(markup.startX, markup.endX),
        minY: Math.min(markup.startY, markup.endY),
        maxX: Math.max(markup.startX, markup.endX),
        maxY: Math.max(markup.startY, markup.endY),
      };
    }

    // Point-based types (note, caret)
    if (markup.x !== undefined) {
      return { minX: markup.x, minY: markup.y, maxX: markup.x, maxY: markup.y };
    }

    return null;
  }, []);

  /**
   * Get bounds in pixel space for hit-testing within InfiniteSlot.
   * @param {Object} markup - Markup with normalized coords
   * @param {number} canvasWidth - Slot canvas width in pixels
   * @param {number} canvasHeight - Slot canvas height in pixels
   * @returns {{ x, y, width, height }} in pixels, or null
   */
  const getMarkupBoundsPixel = useCallback((markup, canvasWidth, canvasHeight) => {
    const norm = getMarkupBounds(markup);
    if (!norm) return null;
    return {
      x: norm.minX * canvasWidth,
      y: norm.minY * canvasHeight,
      width: (norm.maxX - norm.minX) * canvasWidth,
      height: (norm.maxY - norm.minY) * canvasHeight,
    };
  }, [getMarkupBounds]);

  // ═══════════════════════════════════════════════════════════════════════
  // MOVE / RESIZE HELPERS — work in normalized coords
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Move a markup by a normalized delta.
   */
  const moveMarkup = useCallback((slotId, markupId, deltaNormX, deltaNormY) => {
    setSlotAnnotations(prev => ({
      ...prev,
      [slotId]: (prev[slotId] || []).map(m => {
        if (m.id !== markupId) return m;
        if (m.points) {
          return {
            ...m,
            points: m.points.map(p => ({ x: p.x + deltaNormX, y: p.y + deltaNormY })),
            modified: true,
          };
        }
        if (m.startX !== undefined) {
          return {
            ...m,
            startX: m.startX + deltaNormX,
            startY: m.startY + deltaNormY,
            endX: m.endX + deltaNormX,
            endY: m.endY + deltaNormY,
            modified: true,
          };
        }
        return m;
      })
    }));
  }, []);

  /**
   * Resize a markup by updating specific coordinates based on handle.
   * @param {string} handle - 'nw','ne','sw','se','n','s','e','w','start','end'
   * @param {number} normX - New normalized X position
   * @param {number} normY - New normalized Y position
   * @param {Object} origMarkup - Original markup state before resize started
   */
  const resizeMarkup = useCallback((slotId, markupId, handle, normX, normY, origMarkup) => {
    setSlotAnnotations(prev => ({
      ...prev,
      [slotId]: (prev[slotId] || []).map(m => {
        if (m.id !== markupId) return m;

        let newStartX = origMarkup.startX;
        let newStartY = origMarkup.startY;
        let newEndX = origMarkup.endX;
        let newEndY = origMarkup.endY;

        switch (handle) {
          // Line/arrow endpoints
          case 'start': newStartX = normX; newStartY = normY; break;
          case 'end':   newEndX = normX;   newEndY = normY;   break;
          // Rectangle corners
          case 'nw': newStartX = normX; newStartY = normY; break;
          case 'ne': newEndX = normX;   newStartY = normY; break;
          case 'sw': newStartX = normX; newEndY = normY;   break;
          case 'se': newEndX = normX;   newEndY = normY;   break;
          // Rectangle edges
          case 'n': newStartY = normY; break;
          case 's': newEndY = normY;   break;
          case 'w': newStartX = normX; break;
          case 'e': newEndX = normX;   break;
          default: break;
        }

        return {
          ...m,
          startX: newStartX,
          startY: newStartY,
          endX: newEndX,
          endY: newEndY,
          modified: true,
        };
      })
    }));
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // TEXT EDITING
  // ═══════════════════════════════════════════════════════════════════════

  const startTextEdit = useCallback((markup) => {
    setEditingTextMarkupId(markup.id);
    setTextEditValue(markup.text || '');
    setSelectedMarkup(markup);
  }, []);

  const saveTextEdit = useCallback((slotId) => {
    if (!editingTextMarkupId) return;
    const text = textInputRef.current?.value ?? textEditValue;
    updateMarkupLive(slotId, editingTextMarkupId, { text });
    setEditingTextMarkupId(null);
    setTextEditValue('');
  }, [editingTextMarkupId, textEditValue, updateMarkupLive]);

  const cancelTextEdit = useCallback(() => {
    setEditingTextMarkupId(null);
    setTextEditValue('');
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // LINE DASH ARRAY HELPER — needed by renderMarkupShape
  // ═══════════════════════════════════════════════════════════════════════

  const getLineDashArray = useCallback((style, strokeWidth) => {
    const sw = strokeWidth || 2;
    switch (style) {
      case 'dashed':   return [sw * 4, sw * 2];
      case 'dotted':   return [sw, sw * 2];
      case 'dashdot':  return [sw * 4, sw * 2, sw, sw * 2];
      case 'longdash': return [sw * 8, sw * 4];
      default:         return null;
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // CURRENT STYLING SNAPSHOT — used when creating new markups
  // ═══════════════════════════════════════════════════════════════════════

  const getCurrentStyle = useCallback(() => ({
    color: markupColor,
    strokeWidth: markupStrokeWidth,
    opacity: markupOpacity,
    fillColor: markupFillColor,
    fillOpacity: markupFillOpacity,
    strokeOpacity: markupStrokeOpacity,
    arrowHeadSize: markupArrowHeadSize,
    lineStyle: markupLineStyle,
    fontSize: markupFontSize,
    fontFamily: markupFontFamily,
    textAlign: markupTextAlign,
    verticalAlign: markupVerticalAlign,
    textPadding: markupTextPadding,
    lineSpacing: markupLineSpacing,
    borderColor: markupBorderColor,
    borderWidth: markupBorderWidth,
    borderStyle: markupBorderStyle,
    borderOpacity: markupBorderOpacity,
    cloudArcSize: markupCloudArcSize,
    cloudIntensity: markupCloudIntensity,
    cloudInverted: markupCloudInverted,
    cloudBulge: markupCloudBulge,
  }), [
    markupColor, markupStrokeWidth, markupOpacity,
    markupFillColor, markupFillOpacity, markupStrokeOpacity,
    markupArrowHeadSize, markupLineStyle,
    markupFontSize, markupFontFamily, markupTextAlign, markupVerticalAlign,
    markupTextPadding, markupLineSpacing,
    markupBorderColor, markupBorderWidth, markupBorderStyle, markupBorderOpacity,
    markupCloudArcSize, markupCloudIntensity, markupCloudInverted, markupCloudBulge,
  ]);

  // ═══════════════════════════════════════════════════════════════════════
  // APPLY SELECTED MARKUP PROPERTIES — load properties from a selected markup into the toolbar
  // ═══════════════════════════════════════════════════════════════════════

  const applyMarkupProperties = useCallback((markup) => {
    if (!markup) return;
    if (markup.color) setMarkupColor(markup.color);
    if (markup.strokeWidth) setMarkupStrokeWidth(markup.strokeWidth);
    if (markup.opacity) setMarkupOpacity(markup.opacity);
    if (markup.fillColor) setMarkupFillColor(markup.fillColor);
    if (markup.fillOpacity !== undefined) setMarkupFillOpacity(markup.fillOpacity);
    if (markup.strokeOpacity !== undefined) setMarkupStrokeOpacity(markup.strokeOpacity);
    if (markup.arrowHeadSize) setMarkupArrowHeadSize(markup.arrowHeadSize);
    if (markup.lineStyle) setMarkupLineStyle(markup.lineStyle);
    if (markup.fontSize) setMarkupFontSize(markup.fontSize);
    if (markup.fontFamily) setMarkupFontFamily(markup.fontFamily);
    if (markup.textAlign) setMarkupTextAlign(markup.textAlign);
    if (markup.verticalAlign) setMarkupVerticalAlign(markup.verticalAlign);
    if (markup.textPadding !== undefined) setMarkupTextPadding(markup.textPadding);
    if (markup.lineSpacing !== undefined) setMarkupLineSpacing(markup.lineSpacing);
    if (markup.borderColor) setMarkupBorderColor(markup.borderColor);
    if (markup.borderWidth !== undefined) setMarkupBorderWidth(markup.borderWidth);
    if (markup.borderStyle) setMarkupBorderStyle(markup.borderStyle);
    if (markup.borderOpacity !== undefined) setMarkupBorderOpacity(markup.borderOpacity);
    if (markup.cloudArcSize) setMarkupCloudArcSize(markup.cloudArcSize);
    if (markup.cloudIntensity !== undefined) setMarkupCloudIntensity(markup.cloudIntensity);
    if (markup.cloudInverted !== undefined) setMarkupCloudInverted(markup.cloudInverted);
    if (markup.cloudBulge !== undefined) setMarkupCloudBulge(markup.cloudBulge);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // UNSAVED CHANGES CHECK
  // ═══════════════════════════════════════════════════════════════════════

  const hasUnsavedChanges = useCallback((slots) => {
    for (const slot of (slots || [])) {
      const markups = slotAnnotations[slot.id] || [];
      const ownedIds = ownedAnnotationIds[slot.id] || new Set();
      if (markups.some(m => !m.fromPdf) || ownedIds.size > 0) return true;
    }
    return false;
  }, [slotAnnotations, ownedAnnotationIds]);

  // ═══════════════════════════════════════════════════════════════════════
  // RETURN PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════

  return {
    // ── Tool ──
    markupMode, setMarkupMode,
    showMarkupsToolbar, setShowMarkupsToolbar,

    // ── Annotations (normalized 0→1 coords) ──
    slotAnnotations, setSlotAnnotations,
    slotAnnotationsRef,

    // ── Drawing ──
    currentMarkup, setCurrentMarkup,
    isDrawingMarkup, setIsDrawingMarkup,

    // ── Selection ──
    selectedMarkup, setSelectedMarkup,
    selectedMarkups, setSelectedMarkups,
    selectedMarkupRef,

    // ── Interaction ──
    isDragging, setIsDragging,
    isResizing, setIsResizing,
    isRotating, setIsRotating,
    resizeHandle, setResizeHandle,
    draggingPolylinePoint, setDraggingPolylinePoint,
    activeArcHandle, setActiveArcHandle,
    dragStart, setDragStart,

    // ── Text editing ──
    editingTextMarkupId, setEditingTextMarkupId,
    textEditValue, setTextEditValue,
    textInputRef,
    startTextEdit, saveTextEdit, cancelTextEdit,

    // ── History ──
    history, future,
    saveHistory, undo, redo, jumpToHistory,

    // ── CRUD ──
    addMarkupWithHistory,
    deleteMarkupWithHistory,
    updateMarkupWithHistory,
    updateMarkupLive,
    moveMarkup, resizeMarkup,

    // ── Clipboard ──
    clipboard, copyMarkups, pasteMarkups,

    // ── Bounds ──
    getMarkupBounds,
    getMarkupBoundsPixel,

    // ── Styling ──
    markupColor, setMarkupColor,
    markupStrokeWidth, setMarkupStrokeWidth,
    markupOpacity, setMarkupOpacity,
    markupFillColor, setMarkupFillColor,
    markupFillOpacity, setMarkupFillOpacity,
    markupStrokeOpacity, setMarkupStrokeOpacity,
    markupArrowHeadSize, setMarkupArrowHeadSize,
    markupLineStyle, setMarkupLineStyle,
    markupFontSize, setMarkupFontSize,
    markupFontFamily, setMarkupFontFamily,
    markupTextAlign, setMarkupTextAlign,
    markupVerticalAlign, setMarkupVerticalAlign,
    markupTextPadding, setMarkupTextPadding,
    markupLineSpacing, setMarkupLineSpacing,
    markupBorderColor, setMarkupBorderColor,
    markupBorderWidth, setMarkupBorderWidth,
    markupBorderStyle, setMarkupBorderStyle,
    markupBorderOpacity, setMarkupBorderOpacity,
    markupCloudArcSize, setMarkupCloudArcSize,
    markupCloudIntensity, setMarkupCloudIntensity,
    markupCloudInverted, setMarkupCloudInverted,
    markupCloudBulge, setMarkupCloudBulge,
    penHighlighterUIMode, setPenHighlighterUIMode,
    getCurrentStyle, applyMarkupProperties,
    loadToolDefaults, saveToolDefaults,

    // ── Symbols ──
    savedSymbols, setSavedSymbols,
    pendingPlacement, setPendingPlacement,
    symbolSearchQuery, setSymbolSearchQuery,
    symbolsViewMode, setSymbolsViewMode,
    defaultSignatureId, setDefaultSignatureId,
    placeSymbol,

    // ── Slot locking ──
    unlockedSlots, setUnlockedSlots,
    ownedAnnotationIds, setOwnedAnnotationIds,

    // ── Panels ──
    showSymbolsPanel, setShowSymbolsPanel,
    showMarkupHistoryPanel, setShowMarkupHistoryPanel,
    showViewsPanel, setShowViewsPanel,

    // ── Conversion helpers ──
    pixelToNorm, normToPixel,
    getLineDashArray,

    // ── Checks ──
    hasUnsavedChanges,
  };
}
