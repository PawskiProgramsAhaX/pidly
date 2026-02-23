import { useState, useRef, useCallback, useMemo, useEffect } from 'react';

/**
 * useMarkups - Markup state management hook for PDFViewerArea
 * 
 * Extracts all markup-related state, refs, and functions from PDFViewerArea.
 * This includes:
 * - Markup styling (colors, stroke, fonts, etc.)
 * - Markup data (markups array, selection, history)
 * - Markup interaction state (dragging, resizing, drawing)
 * - Symbol/stamp library
 * - Notes and comments
 * - Core manipulation functions
 * 
 * Dependencies passed in:
 * - currentPage, setCurrentPage - for navigation
 * - currentFileIdentifier - for per-file markup tracking  
 * - scale - for coordinate transforms
 * - canvasSize - for drawing calculations
 * - containerRef - for scrolling to markups
 * - allPageDimensions - for page-specific sizing
 */
export default function useMarkups({
  currentPage,
  setCurrentPage,
  currentFileIdentifier,
  scale,
  canvasSize,
  containerRef,
  allPageDimensions,
  viewMode,
  scrollToPagePosition, // For continuous view navigation
}) {
  // ═══════════════════════════════════════════════════════════════════════════
  // PER-TOOL DEFAULT SETTINGS
  // ═══════════════════════════════════════════════════════════════════════════
  // Each tool remembers its own settings independently.
  // Changing pen stroke width won't affect arrow stroke width, etc.
  
  const TOOL_DEFAULTS = useMemo(() => ({
    pen:            { color: '#ff0000', strokeWidth: 3,  opacity: 1.0,  strokeOpacity: 1.0, lineStyle: 'solid' },
    highlighter:    { color: '#ffff00', strokeWidth: 20, opacity: 0.4,  strokeOpacity: 1.0, lineStyle: 'solid' },
    arrow:          { color: '#ff0000', strokeWidth: 2,  opacity: 1.0,  strokeOpacity: 1.0, lineStyle: 'solid', arrowHeadSize: 12 },
    line:           { color: '#ff0000', strokeWidth: 2,  opacity: 1.0,  strokeOpacity: 1.0, lineStyle: 'solid' },
    rectangle:      { color: '#ff0000', strokeWidth: 2,  opacity: 1.0,  strokeOpacity: 1.0, fillColor: 'none', fillOpacity: 0.3, lineStyle: 'solid' },
    circle:         { color: '#ff0000', strokeWidth: 2,  opacity: 1.0,  strokeOpacity: 1.0, fillColor: 'none', fillOpacity: 0.3, lineStyle: 'solid' },
    text:           { color: '#000000', fontSize: 12, fontFamily: 'Helvetica', textAlign: 'left', verticalAlign: 'top', lineSpacing: 1.2, fillColor: 'none', borderColor: '#000000', borderWidth: 1, textPadding: 4 },
    callout:        { color: '#000000', fontSize: 12, fontFamily: 'Helvetica', textAlign: 'left', verticalAlign: 'top', lineSpacing: 1.2, fillColor: '#ffffcc', borderColor: '#000000', borderWidth: 1, textPadding: 4, strokeWidth: 1 },
    cloud:          { color: '#ff0000', strokeWidth: 2,  opacity: 1.0,  strokeOpacity: 1.0, fillColor: 'none', fillOpacity: 0.3, cloudInverted: false, cloudIntensity: 1.0, cloudBulge: 0.8, cloudArcSize: 15 },
    polyline:       { color: '#ff0000', strokeWidth: 2,  opacity: 1.0,  strokeOpacity: 1.0, lineStyle: 'solid' },
    polylineArrow:  { color: '#ff0000', strokeWidth: 2,  opacity: 1.0,  strokeOpacity: 1.0, lineStyle: 'solid', arrowHeadSize: 12 },
    cloudPolyline:  { color: '#ff0000', strokeWidth: 2,  opacity: 1.0,  strokeOpacity: 1.0, cloudInverted: false, cloudIntensity: 1.0, cloudBulge: 0.8, cloudArcSize: 15 },
    arc:            { color: '#ff0000', strokeWidth: 2,  opacity: 1.0,  strokeOpacity: 1.0, lineStyle: 'solid', arcStartAngle: 0, arcEndAngle: 270 },
    image:          {},
    select:         {},
  }), []);

  // Ref storing per-tool overrides — initialize from localStorage
  const perToolSettingsRef = useRef(null);
  if (perToolSettingsRef.current === null) {
    const stored = {};
    try {
      const tools = ['pen', 'highlighter', 'arrow', 'line', 'rectangle', 'circle', 'text', 'callout', 'cloud', 'polyline', 'polylineArrow', 'cloudPolyline', 'arc'];
      for (const tool of tools) {
        const raw = localStorage.getItem('markup_' + tool + '_defaults');
        if (raw) {
          const d = JSON.parse(raw);
          // Map localStorage names to internal state names
          if (d.arcSize !== undefined) { d.cloudArcSize = d.arcSize; delete d.arcSize; }
          if (d.inverted !== undefined) { d.cloudInverted = d.inverted; delete d.inverted; }
          if (d.padding !== undefined) { d.textPadding = d.padding; delete d.padding; }
          if (d.startAngle !== undefined) { d.arcStartAngle = d.startAngle; delete d.startAngle; }
          if (d.endAngle !== undefined) { d.arcEndAngle = d.endAngle; delete d.endAngle; }
          stored[tool] = d;
        }
      }
    } catch {}
    perToolSettingsRef.current = stored;
  }
  const prevMarkupModeRef = useRef(null);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // MARKUP STYLING STATE
  // ═══════════════════════════════════════════════════════════════════════════
  
  const [markupColor, setMarkupColor] = useState('#ff0000');
  const [markupStrokeWidth, setMarkupStrokeWidth] = useState(3);
  const [markupFillColor, setMarkupFillColor] = useState('none');
  const [markupBorderColor, setMarkupBorderColor] = useState('#000000');
  const [markupBorderWidth, setMarkupBorderWidth] = useState(1);
  const [markupBorderStyle, setMarkupBorderStyle] = useState('solid');
  const [markupBorderOpacity, setMarkupBorderOpacity] = useState(1.0);
  const [markupTextPadding, setMarkupTextPadding] = useState(4);
  const [markupFontSize, setMarkupFontSize] = useState(12);
  const [markupFontFamily, setMarkupFontFamily] = useState('Helvetica');
  const [markupTextAlign, setMarkupTextAlign] = useState('left');
  const [markupVerticalAlign, setMarkupVerticalAlign] = useState('top');
  const [markupLineSpacing, setMarkupLineSpacing] = useState(1.2);
  const [markupOpacity, setMarkupOpacity] = useState(1.0);
  const [markupArrowHeadSize, setMarkupArrowHeadSize] = useState(12);
  const [markupLineStyle, setMarkupLineStyle] = useState('solid');
  const [markupStrokeOpacity, setMarkupStrokeOpacity] = useState(1.0);
  const [markupFillOpacity, setMarkupFillOpacity] = useState(0.3);
  const [markupCloudInverted, setMarkupCloudInverted] = useState(false);
  const [markupCloudIntensity, setMarkupCloudIntensity] = useState(1.0);
  const [markupCloudBulge, setMarkupCloudBulge] = useState(0.8);
  const [markupCloudArcSize, setMarkupCloudArcSize] = useState(15);
  const [markupArcStartAngle, setMarkupArcStartAngle] = useState(0);
  const [markupArcEndAngle, setMarkupArcEndAngle] = useState(270);
  
  // UI mode for pen/highlighter size controls
  const [penHighlighterUIMode, setPenHighlighterUIMode] = useState(() => {
    try {
      const saved = localStorage.getItem('penHighlighterUIMode');
      return saved || 'slider';
    } catch { return 'slider'; }
  });

  
  // ═══════════════════════════════════════════════════════════════════════════
  // MARKUP DATA STATE
  // ═══════════════════════════════════════════════════════════════════════════
  
  const [markups, setMarkups] = useState([]);
  const markupsRef = useRef(markups); // Always-current ref for use in event handlers
  markupsRef.current = markups;
  const [currentMarkup, setCurrentMarkup] = useState(null);
  const [selectedMarkup, setSelectedMarkup] = useState(null);
  const [selectedMarkups, setSelectedMarkups] = useState([]);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // MARKUP MODE & UI STATE
  // ═══════════════════════════════════════════════════════════════════════════
  
  const [showMarkupsPanel, setShowMarkupsPanel] = useState(false);
  const [markupMode, setMarkupMode] = useState(null);
  const [hasLoadedAnnotations, setHasLoadedAnnotations] = useState(false);

  // Drawing state
  const [isDrawingMarkup, setIsDrawingMarkup] = useState(false);
  const [isSavingMarkups, setIsSavingMarkups] = useState(false);
  
  // Unsaved changes tracking
  const [unsavedMarkupFiles, setUnsavedMarkupFiles] = useState(new Set());
  const lastSavedMarkupsRef = useRef({});
  
  // Track PDF annotations that were deleted (so backend can remove them on save)
  // Map<filename, Set<pdfAnnotId>>
  const [deletedPdfAnnotations, setDeletedPdfAnnotations] = useState(new Map());
  
  // ═══════════════════════════════════════════════════════════════════════════
  // MARKUP INTERACTION STATE
  // ═══════════════════════════════════════════════════════════════════════════
  
  const [isDraggingMarkup, setIsDraggingMarkup] = useState(false);
  const [isResizingMarkup, setIsResizingMarkup] = useState(false);
  const [isRotatingMarkup, setIsRotatingMarkup] = useState(false);
  const [draggingPolylinePoint, setDraggingPolylinePoint] = useState(null);
  const [resizeHandle, setResizeHandle] = useState(null);
  const [markupDragStart, setMarkupDragStart] = useState(null);
  const [dragStart, setDragStart] = useState(null);
  const [rotationStart, setRotationStart] = useState(null);
  const [activeResizeHandle, setActiveResizeHandle] = useState(null);
  const [activeArcHandle, setActiveArcHandle] = useState(null);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // POLYLINE/CLOUD DRAWING STATE
  // ═══════════════════════════════════════════════════════════════════════════
  
  const [cloudPoints, setCloudPoints] = useState([]);
  const [polylinePoints, setPolylinePoints] = useState([]);
  const [polylineMousePos, setPolylineMousePos] = useState(null);
  const [markupPolylineMousePos, setMarkupPolylineMousePos] = useState(null);
  const [isNearStartPoint, setIsNearStartPoint] = useState(false);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TEXT EDITING STATE
  // ═══════════════════════════════════════════════════════════════════════════
  
  const [editingTextMarkupId, setEditingTextMarkupId] = useState(null);
  const [textEditValue, setTextEditValue] = useState('');
  const [editingMarkupText, setEditingMarkupText] = useState(null);
  const textInputRef = useRef(null);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // HISTORY STATE (UNDO/REDO) — per document
  // ═══════════════════════════════════════════════════════════════════════════
  
  const [markupHistory, setMarkupHistory] = useState([]);
  const [markupFuture, setMarkupFuture] = useState([]);
  const clipboardRef = useRef([]); // Stores deep-cloned markups for Ctrl+C/V
  
  // Per-file history storage: Map<fileId, { history: [], future: [] }>
  const perFileHistoryRef = useRef(new Map());
  const prevFileIdRef = useRef(currentFileIdentifier);
  
  // Swap history when switching documents
  useEffect(() => {
    const prevFileId = prevFileIdRef.current;
    if (prevFileId === currentFileIdentifier) return;
    
    // Save current history for the previous file
    if (prevFileId) {
      perFileHistoryRef.current.set(prevFileId, {
        history: markupHistory,
        future: markupFuture,
      });
    }
    
    // Load history for the new file (or empty)
    const saved = perFileHistoryRef.current.get(currentFileIdentifier);
    if (saved) {
      setMarkupHistory(saved.history);
      setMarkupFuture(saved.future);
    } else {
      setMarkupHistory([]);
      setMarkupFuture([]);
    }
    
    prevFileIdRef.current = currentFileIdentifier;
  }, [currentFileIdentifier]); // eslint-disable-line react-hooks/exhaustive-deps
  
  // ═══════════════════════════════════════════════════════════════════════════
  // NOTES & COMMENTS STATE
  // ═══════════════════════════════════════════════════════════════════════════
  
  const [showNoteDialog, setShowNoteDialog] = useState(false);
  const [noteDialogPosition, setNoteDialogPosition] = useState({ x: 0, y: 0 });
  const [noteText, setNoteText] = useState('');
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [expandedNotes, setExpandedNotes] = useState(new Set());
  const [markupComments, setMarkupComments] = useState({});
  const [showCommentInput, setShowCommentInput] = useState(null);
  const [commentInputText, setCommentInputText] = useState('');
  const [markupAuthor, setMarkupAuthor] = useState('User');
  const [hoveredMarkupId, setHoveredMarkupId] = useState(null);
  const hoveredMarkupIdRef = useRef(null);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CALLOUT STATE
  // ═══════════════════════════════════════════════════════════════════════════
  
  const [calloutTailPosition, setCalloutTailPosition] = useState(null);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // MARKUP LIST/FILTER STATE
  // ═══════════════════════════════════════════════════════════════════════════
  
  const [showMarkupsList, setShowMarkupsList] = useState(false);
  const [markupListFilter, setMarkupListFilter] = useState('all');
  const [markupListTypeFilter, setMarkupListTypeFilter] = useState(null);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CONTEXT MENU STATE
  // ═══════════════════════════════════════════════════════════════════════════
  
  const [showMarkupContextMenu, setShowMarkupContextMenu] = useState(false);
  const [markupContextMenuPos, setMarkupContextMenuPos] = useState({ x: 0, y: 0 });
  const [markupContextMenuTarget, setMarkupContextMenuTarget] = useState(null);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SYMBOL/STAMP LIBRARY STATE
  // ═══════════════════════════════════════════════════════════════════════════
  
  const [savedSymbols, setSavedSymbols] = useState(() => {
    try {
      const saved = localStorage.getItem('markup_symbols');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [showSaveSymbolDialog, setShowSaveSymbolDialog] = useState(false);
  const [symbolNameInput, setSymbolNameInput] = useState('');
  const [draggingSymbol, setDraggingSymbol] = useState(null);
  const [symbolCreationMode, setSymbolCreationMode] = useState(false);
  const [symbolCaptureMode, setSymbolCaptureMode] = useState(false);
  const [captureRegion, setCaptureRegion] = useState(null);
  const [symbolSearchQuery, setSymbolSearchQuery] = useState('');
  const [symbolsViewMode, setSymbolsViewMode] = useState(() => {
    try {
      return localStorage.getItem('symbols_view_mode') || 'grid';
    } catch { return 'grid'; }
  });

  // Default signature — the signature placed by pressing S
  const [defaultSignatureId, setDefaultSignatureId] = useState(() => {
    try {
      return localStorage.getItem('markup_default_signature') || null;
    } catch { return null; }
  });

  // Persist default signature ID
  useEffect(() => {
    try {
      if (defaultSignatureId) {
        localStorage.setItem('markup_default_signature', defaultSignatureId);
      } else {
        localStorage.removeItem('markup_default_signature');
      }
    } catch (e) {}
  }, [defaultSignatureId]);

  // Pending placement — symbol/signature waiting to be rubber-band drawn on canvas
  // Shape: { symbol: <symbol object>, isSignature: bool } or null
  const [pendingPlacement, setPendingPlacement] = useState(null);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // REFS FOR PERFORMANCE (avoid re-renders during drag/draw)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const markupCanvasRef = useRef(null);
  const isDraggingMarkupRef = useRef(false);
  const isResizingMarkupRef = useRef(false);
  const isRotatingMarkupRef = useRef(false);
  const isDrawingMarkupRef = useRef(false);
  const currentMarkupRef = useRef(null);
  const drawingOverlayRef = useRef(null);
  const drawingPageRef = useRef(null);
  const rafIdRef = useRef(null);
  const draggingPolylinePointRef = useRef(null);
  const didDragMoveRef = useRef(false);
  const wasAlreadySelectedRef = useRef(false);
  const selectedMarkupRef = useRef(null);
  const selectedMarkupsRef = useRef([]);
  const markupDragStartRef = useRef(null);
  const dragStartRef = useRef(null);
  const resizeHandleRef = useRef(null);
  const rotationStartRef = useRef(null);
  const dragDeltaRef = useRef({ x: 0, y: 0 });
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const markupDragRafRef = useRef(null);
  const pendingMarkupUpdateRef = useRef(null);
  const lastHitTestTimeRef = useRef(0);
  const pendingPolylinePointRef = useRef(null);
  const continuousSelectionRef = useRef({ pageIndex: null, startX: null, startY: null });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PER-TOOL SETTINGS SAVE/RESTORE
  // ═══════════════════════════════════════════════════════════════════════════
  // When switching tools, save current settings → old tool, restore → new tool.
  // Each tool independently remembers color, strokeWidth, opacity, etc.

  // Snapshot current global state into settings object
  const snapshotCurrentSettings = useCallback(() => ({
    color: markupColor,
    strokeWidth: markupStrokeWidth,
    opacity: markupOpacity,
    strokeOpacity: markupStrokeOpacity,
    fillColor: markupFillColor,
    fillOpacity: markupFillOpacity,
    lineStyle: markupLineStyle,
    arrowHeadSize: markupArrowHeadSize,
    fontSize: markupFontSize,
    fontFamily: markupFontFamily,
    textAlign: markupTextAlign,
    verticalAlign: markupVerticalAlign,
    lineSpacing: markupLineSpacing,
    borderColor: markupBorderColor,
    borderWidth: markupBorderWidth,
    textPadding: markupTextPadding,
    cloudInverted: markupCloudInverted,
    cloudIntensity: markupCloudIntensity,
    cloudBulge: markupCloudBulge,
    cloudArcSize: markupCloudArcSize,
    arcStartAngle: markupArcStartAngle,
    arcEndAngle: markupArcEndAngle,
  }), [
    markupColor, markupStrokeWidth, markupOpacity, markupStrokeOpacity,
    markupFillColor, markupFillOpacity, markupLineStyle, markupArrowHeadSize,
    markupFontSize, markupFontFamily, markupTextAlign, markupVerticalAlign,
    markupLineSpacing, markupBorderColor, markupBorderWidth, markupTextPadding,
    markupCloudInverted, markupCloudIntensity, markupCloudBulge, markupCloudArcSize,
    markupArcStartAngle, markupArcEndAngle,
  ]);

  // Keep a ref to the latest snapshot function so the effect can call it without stale closure
  const snapshotRef = useRef(snapshotCurrentSettings);
  snapshotRef.current = snapshotCurrentSettings;

  // Apply settings from a stored tool config to global state
  const applyToolSettings = useCallback((settings) => {
    if (!settings) return;
    if (settings.color !== undefined)          setMarkupColor(settings.color);
    if (settings.strokeWidth !== undefined)    setMarkupStrokeWidth(settings.strokeWidth);
    if (settings.opacity !== undefined)        setMarkupOpacity(settings.opacity);
    if (settings.strokeOpacity !== undefined)  setMarkupStrokeOpacity(settings.strokeOpacity);
    if (settings.fillColor !== undefined)      setMarkupFillColor(settings.fillColor);
    if (settings.fillOpacity !== undefined)    setMarkupFillOpacity(settings.fillOpacity);
    if (settings.lineStyle !== undefined)      setMarkupLineStyle(settings.lineStyle);
    if (settings.arrowHeadSize !== undefined)  setMarkupArrowHeadSize(settings.arrowHeadSize);
    if (settings.fontSize !== undefined)       setMarkupFontSize(settings.fontSize);
    if (settings.fontFamily !== undefined)     setMarkupFontFamily(settings.fontFamily);
    if (settings.textAlign !== undefined)      setMarkupTextAlign(settings.textAlign);
    if (settings.verticalAlign !== undefined)  setMarkupVerticalAlign(settings.verticalAlign);
    if (settings.lineSpacing !== undefined)    setMarkupLineSpacing(settings.lineSpacing);
    if (settings.borderColor !== undefined)    setMarkupBorderColor(settings.borderColor);
    if (settings.borderWidth !== undefined)    setMarkupBorderWidth(settings.borderWidth);
    if (settings.textPadding !== undefined)    setMarkupTextPadding(settings.textPadding);
    if (settings.cloudInverted !== undefined)  setMarkupCloudInverted(settings.cloudInverted);
    if (settings.cloudIntensity !== undefined) setMarkupCloudIntensity(settings.cloudIntensity);
    if (settings.cloudBulge !== undefined)     setMarkupCloudBulge(settings.cloudBulge);
    if (settings.cloudArcSize !== undefined)   setMarkupCloudArcSize(settings.cloudArcSize);
    if (settings.arcStartAngle !== undefined)  setMarkupArcStartAngle(settings.arcStartAngle);
    if (settings.arcEndAngle !== undefined)    setMarkupArcEndAngle(settings.arcEndAngle);
  }, []);

  // Save/restore on tool switch
  useEffect(() => {
    const prevMode = prevMarkupModeRef.current;
    
    // Save settings for the tool we're leaving (if it was a drawing tool)
    if (prevMode && prevMode !== 'select' && TOOL_DEFAULTS[prevMode]) {
      perToolSettingsRef.current[prevMode] = snapshotRef.current();
    }
    
    // Restore settings for the tool we're switching to
    if (markupMode && markupMode !== 'select' && TOOL_DEFAULTS[markupMode]) {
      const saved = perToolSettingsRef.current[markupMode];
      const defaults = TOOL_DEFAULTS[markupMode];
      // Use saved settings if available, otherwise use tool defaults
      applyToolSettings(saved || defaults);
    }
    
    prevMarkupModeRef.current = markupMode;
  }, [markupMode, TOOL_DEFAULTS, applyToolSettings]);

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Line style dash patterns (scaled by strokeWidth)
  const getLineDashArray = useCallback((style, strokeWidth) => {
    const sw = strokeWidth || 1;
    switch (style) {
      case 'dashed': return [sw * 6, sw * 4];
      case 'dotted': return [sw * 1.5, sw * 3];
      case 'dashdot': return [sw * 6, sw * 3, sw * 1.5, sw * 3];
      case 'longdash': return [sw * 12, sw * 4];
      default: return null;
    }
  }, []);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CURSOR GENERATION
  // ═══════════════════════════════════════════════════════════════════════════
  
  const penCursor = useMemo(() => {
    const size = Math.max(32, Math.min(128, markupStrokeWidth * 2 + 32));
    const tipSize = Math.max(3, Math.min(markupStrokeWidth, 32));
    // Pen vertical (tip bottom), rotate(50) CW — right-handed grip
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <g transform="rotate(50, ${size/2}, ${size/2})">
          <rect x="${size * 0.42}" y="${size * 0.15}" width="${size * 0.16}" height="${size * 0.45}" fill="#555" rx="2"/>
          <rect x="${size * 0.40}" y="${size * 0.45}" width="${size * 0.20}" height="${size * 0.15}" fill="#444" rx="1"/>
          <polygon points="${size * 0.42},${size * 0.60} ${size * 0.58},${size * 0.60} ${size * 0.54},${size * 0.75} ${size * 0.46},${size * 0.75}" fill="#888"/>
          <polygon points="${size * 0.46},${size * 0.75} ${size * 0.54},${size * 0.75} ${size * 0.50},${size * 0.85}" fill="${markupColor}"/>
          <circle cx="${size * 0.50}" cy="${size * 0.85}" r="${tipSize * 0.5}" fill="${markupColor}"/>
        </g>
      </svg>
    `;
    const encoded = encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22');
    // SVG rotate(θ) matrix: x'= x*cosθ - y*sinθ, y'= x*sinθ + y*cosθ
    // Tip relative to center: (0, +0.35). rotate(50) CW:
    // x'= -0.35*sin50 = -0.268 → 0.5-0.268 = 0.232
    // y'= +0.35*cos50 = +0.225 → 0.5+0.225 = 0.725
    const hotspotX = Math.max(0, Math.min(size - 1, Math.round(size * 0.232)));
    const hotspotY = Math.max(0, Math.min(size - 1, Math.round(size * 0.725)));
    return `url("data:image/svg+xml,${encoded}") ${hotspotX} ${hotspotY}, crosshair`;
  }, [markupStrokeWidth, markupColor]);
  
  const highlighterCursor = useMemo(() => {
    const size = Math.max(32, Math.min(128, markupStrokeWidth * 1.5 + 32));
    const tipWidth = Math.max(8, Math.min(markupStrokeWidth * 0.8, 40));
    // Highlighter vertical (tip bottom), rotate(50) CW — right-handed grip
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <g transform="rotate(50, ${size/2}, ${size/2})">
          <rect x="${size * 0.35}" y="${size * 0.10}" width="${size * 0.30}" height="${size * 0.50}" fill="#333" rx="3"/>
          <rect x="${size * 0.30}" y="${size * 0.45}" width="${size * 0.40}" height="${size * 0.15}" fill="${markupColor}" opacity="0.8" rx="2"/>
          <rect x="${size/2 - tipWidth/2}" y="${size * 0.60}" width="${tipWidth}" height="${size * 0.20}" fill="${markupColor}" opacity="0.9"/>
          <rect x="${size/2 - tipWidth/2}" y="${size * 0.78}" width="${tipWidth}" height="${size * 0.04}" fill="${markupColor}" opacity="0.5"/>
        </g>
      </svg>
    `;
    const encoded = encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22');
    // SVG rotate(θ) matrix: x'= x*cosθ - y*sinθ, y'= x*sinθ + y*cosθ
    // Tip relative to center: (0, +0.32). rotate(50) CW:
    // x'= -0.32*sin50 = -0.245 → 0.5-0.245 = 0.255
    // y'= +0.32*cos50 = +0.206 → 0.5+0.206 = 0.706
    const hotspotX = Math.min(size - 1, Math.round(size * 0.255));
    const hotspotY = Math.min(size - 1, Math.round(size * 0.706));
    return `url("data:image/svg+xml,${encoded}") ${hotspotX} ${hotspotY}, crosshair`;
  }, [markupStrokeWidth, markupColor]);
  
  const getMarkupCursor = useCallback(() => {
    if (markupMode === 'pen') return penCursor;
    if (markupMode === 'highlighter') return highlighterCursor;
    return 'crosshair';
  }, [markupMode, penCursor, highlighterCursor]);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // MARKUP BOUNDS CALCULATION
  // ═══════════════════════════════════════════════════════════════════════════
  
  const getMarkupBounds = useCallback((markup) => {
    if (!markup) return null;
    
    if (markup.type === 'pen' || markup.type === 'highlighter') {
      const xs = markup.points.map(p => p.x);
      const ys = markup.points.map(p => p.y);
      return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
      };
    } else if (markup.type === 'arc') {
      const p1x = markup.point1X;
      const p1y = markup.point1Y;
      const p2x = markup.point2X;
      const p2y = markup.point2Y;
      const bulge = markup.arcBulge !== undefined ? markup.arcBulge : 0.5;
      
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
      
      return {
        minX: Math.min(p1x, p2x, ctrlX),
        maxX: Math.max(p1x, p2x, ctrlX),
        minY: Math.min(p1y, p2y, ctrlY),
        maxY: Math.max(p1y, p2y, ctrlY),
      };
    } else if (markup.type === 'rectangle' || markup.type === 'arrow' || markup.type === 'circle' || 
               markup.type === 'stamp' || markup.type === 'line' || markup.type === 'cloud' || 
               markup.type === 'callout' || markup.type === 'symbol' || markup.type === 'image') {
      return {
        minX: Math.min(markup.startX, markup.endX),
        maxX: Math.max(markup.startX, markup.endX),
        minY: Math.min(markup.startY, markup.endY),
        maxY: Math.max(markup.startY, markup.endY),
      };
    } else if (markup.type === 'text') {
      if (markup.startX !== undefined && markup.endX !== undefined) {
        return {
          minX: Math.min(markup.startX, markup.endX),
          maxX: Math.max(markup.startX, markup.endX),
          minY: Math.min(markup.startY, markup.endY),
          maxY: Math.max(markup.startY, markup.endY),
        };
      } else {
        const fontSize = (markup.fontSize || 16) / 800;
        const textWidth = Math.max(0.1, (markup.text?.length || 10) * fontSize * 0.6);
        const textHeight = fontSize * 1.5;
        return {
          minX: markup.x,
          maxX: markup.x + textWidth,
          minY: markup.y,
          maxY: markup.y + textHeight,
        };
      }
    } else if (markup.type === 'note') {
      const noteSize = 0.025;
      return {
        minX: markup.x - noteSize,
        maxX: markup.x + noteSize,
        minY: markup.y - noteSize,
        maxY: markup.y + noteSize,
      };
    } else if (markup.type === 'polyline' || markup.type === 'polylineArrow' || 
               markup.type === 'cloudPolyline' || markup.type === 'polygon') {
      if (markup.points && markup.points.length > 0) {
        const xs = markup.points.map(p => p.x);
        const ys = markup.points.map(p => p.y);
        return {
          minX: Math.min(...xs),
          maxX: Math.max(...xs),
          minY: Math.min(...ys),
          maxY: Math.max(...ys),
        };
      }
    } else if (markup.type === 'textHighlight' || markup.type === 'redact' || 
               markup.type === 'fileAttachment' || markup.type === 'unknown') {
      return {
        minX: Math.min(markup.startX, markup.endX),
        maxX: Math.max(markup.startX, markup.endX),
        minY: Math.min(markup.startY, markup.endY),
        maxY: Math.max(markup.startY, markup.endY),
      };
    } else if (markup.type === 'textMarkup') {
      return {
        minX: Math.min(markup.startX, markup.endX),
        maxX: Math.max(markup.startX, markup.endX),
        minY: Math.min(markup.startY, markup.endY),
        maxY: Math.max(markup.startY, markup.endY),
      };
    } else if (markup.type === 'caret' || markup.type === 'sound') {
      const size = 0.02;
      return {
        minX: markup.x - size,
        maxX: markup.x + size,
        minY: markup.y - size,
        maxY: markup.y + size,
      };
    }
    return null;
  }, []);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // MARKUP MANIPULATION FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  
  const moveMarkup = useCallback((markupId, deltaX, deltaY) => {
    setMarkups(prev => prev.map(m => {
      if (m.id !== markupId) return m;
      
      const modified = m.fromPdf ? true : m.modified;
      
      if (m.type === 'pen' || m.type === 'highlighter') {
        return {
          ...m,
          modified,
          points: m.points.map(p => ({ x: p.x + deltaX, y: p.y + deltaY }))
        };
      } else if (m.type === 'polyline' || m.type === 'polylineArrow' || m.type === 'cloudPolyline' || m.type === 'polygon') {
        const newPoints = m.points.map(p => ({ x: p.x + deltaX, y: p.y + deltaY }));
        return {
          ...m,
          modified,
          points: newPoints,
          startX: m.startX + deltaX,
          startY: m.startY + deltaY,
          endX: m.endX + deltaX,
          endY: m.endY + deltaY,
        };
      } else if (m.type === 'arc') {
        return {
          ...m,
          modified,
          point1X: m.point1X + deltaX,
          point1Y: m.point1Y + deltaY,
          point2X: m.point2X + deltaX,
          point2Y: m.point2Y + deltaY,
        };
      } else if (m.type === 'rectangle' || m.type === 'arrow' || m.type === 'circle' || m.type === 'stamp' || 
                 m.type === 'line' || m.type === 'cloud' || m.type === 'callout' ||
                 m.type === 'textHighlight' || m.type === 'textMarkup' || m.type === 'redact' ||
                 m.type === 'fileAttachment' || m.type === 'unknown' || m.type === 'symbol' || m.type === 'image') {
        return {
          ...m,
          modified,
          startX: m.startX + deltaX,
          startY: m.startY + deltaY,
          endX: m.endX + deltaX,
          endY: m.endY + deltaY,
        };
      } else if (m.type === 'text') {
        if (m.startX !== undefined && m.endX !== undefined) {
          return {
            ...m,
            modified,
            startX: m.startX + deltaX,
            startY: m.startY + deltaY,
            endX: m.endX + deltaX,
            endY: m.endY + deltaY,
          };
        } else {
          return {
            ...m,
            modified,
            x: m.x + deltaX,
            y: m.y + deltaY,
          };
        }
      } else if (m.type === 'note' || m.type === 'caret' || m.type === 'sound') {
        return {
          ...m,
          modified,
          x: m.x + deltaX,
          y: m.y + deltaY,
        };
      }
      return m;
    }));
  }, []);
  
  const resizeMarkup = useCallback((markupId, handle, deltaX, deltaY, bounds) => {
    setMarkups(prev => prev.map(m => {
      if (m.id !== markupId) return m;
      
      if (m.type === 'pen' || m.type === 'highlighter') return m;
      if (m.type === 'text' && m.x !== undefined && m.startX === undefined) return m;
      
      // Handle arrow/line endpoint dragging
      if ((m.type === 'arrow' || m.type === 'line') && (handle === 'start' || handle === 'end')) {
        if (handle === 'start') {
          return {
            ...m,
            modified: m.fromPdf ? true : m.modified,
            startX: m.startX + deltaX,
            startY: m.startY + deltaY,
          };
        } else {
          return {
            ...m,
            modified: m.fromPdf ? true : m.modified,
            endX: m.endX + deltaX,
            endY: m.endY + deltaY,
          };
        }
      }
      
      // Handle arc point dragging
      if (m.type === 'arc' && (handle === 'point1' || handle === 'point2' || handle === 'bulge')) {
        if (handle === 'point1') {
          return { ...m, modified: true, point1X: m.point1X + deltaX, point1Y: m.point1Y + deltaY };
        } else if (handle === 'point2') {
          return { ...m, modified: true, point2X: m.point2X + deltaX, point2Y: m.point2Y + deltaY };
        } else if (handle === 'bulge') {
          // For bulge, deltaY controls the arc height
          const newBulge = Math.max(-2, Math.min(2, (m.arcBulge || 0.5) + deltaY * 2));
          return { ...m, modified: true, arcBulge: newBulge };
        }
      }
      
      let newStartX = m.startX, newStartY = m.startY;
      let newEndX = m.endX, newEndY = m.endY;
      
      const wasMinX = m.startX < m.endX ? 'start' : 'end';
      const wasMinY = m.startY < m.endY ? 'start' : 'end';
      
      if (handle.includes('w')) {
        if (wasMinX === 'start') newStartX += deltaX;
        else newEndX += deltaX;
      }
      if (handle.includes('e')) {
        if (wasMinX === 'end') newStartX += deltaX;
        else newEndX += deltaX;
      }
      if (handle.includes('n')) {
        if (wasMinY === 'start') newStartY += deltaY;
        else newEndY += deltaY;
      }
      if (handle.includes('s')) {
        if (wasMinY === 'end') newStartY += deltaY;
        else newEndY += deltaY;
      }
      
      return {
        ...m,
        modified: m.fromPdf ? true : m.modified,
        startX: newStartX,
        startY: newStartY,
        endX: newEndX,
        endY: newEndY,
      };
    }));
  }, []);
  
  const updateMarkupProperties = useCallback((markupId, updates) => {
    setMarkups(prev => prev.map(m => {
      if (m.id !== markupId) return m;
      return { ...m, ...updates, modified: m.fromPdf ? true : m.modified };
    }));
    // Also update selected markup if it's the one being modified
    setSelectedMarkup(prev => {
      if (prev && prev.id === markupId) {
        const updated = { ...prev, ...updates };
        selectedMarkupRef.current = updated;
        return updated;
      }
      return prev;
    });
  }, []);
  
  const deleteSelectedMarkup = useCallback(() => {
    // Helper: track deleted PDF annotations so save can tell backend to remove them
    const trackDeletedPdfAnnotations = (markupsToDelete) => {
      const pdfAnnotsToTrack = markupsToDelete.filter(m => m.fromPdf && m.pdfAnnotId);
      if (pdfAnnotsToTrack.length > 0) {
        setDeletedPdfAnnotations(prev => {
          const next = new Map(prev);
          pdfAnnotsToTrack.forEach(m => {
            const filename = m.filename;
            if (!next.has(filename)) next.set(filename, new Set());
            next.get(filename).add(m.pdfAnnotId);
          });
          return next;
        });
      }
    };

    if (selectedMarkups.length > 0) {
      // Multi-selection delete
      const idsToDelete = new Set(selectedMarkups.map(m => m.id));
      setMarkupHistory(prev => [...prev.slice(-(MAX_HISTORY - 1)), markups]);
      setMarkupFuture([]);
      trackDeletedPdfAnnotations(selectedMarkups);
      setMarkups(prev => prev.filter(m => !idsToDelete.has(m.id)));
      setSelectedMarkups([]);
      setSelectedMarkup(null);
      selectedMarkupsRef.current = [];
      selectedMarkupRef.current = null;
    } else if (selectedMarkup) {
      // Single selection delete
      setMarkupHistory(prev => [...prev.slice(-(MAX_HISTORY - 1)), markups]);
      setMarkupFuture([]);
      trackDeletedPdfAnnotations([selectedMarkup]);
      setMarkups(prev => prev.filter(m => m.id !== selectedMarkup.id));
      setSelectedMarkup(null);
      selectedMarkupRef.current = null;
    }
  }, [selectedMarkup, selectedMarkups, markups]);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // HISTORY (UNDO/REDO) — 50-step limit, in-memory only
  // ═══════════════════════════════════════════════════════════════════════════
  
  const MAX_HISTORY = 50;
  
  // Snapshot current markups to history (call BEFORE an operation that mutates markups)
  // Uses ref so it works correctly even in stale closures (e.g. mouseup handlers)
  const saveHistory = useCallback(() => {
    const current = markupsRef.current;
    setMarkupHistory(prev => [...prev.slice(-(MAX_HISTORY - 1)), current]);
    setMarkupFuture([]);
  }, []);
  
  const undoMarkup = useCallback(() => {
    if (markupHistory.length === 0) return;
    const previous = markupHistory[markupHistory.length - 1];
    setMarkupHistory(prev => prev.slice(0, -1));
    setMarkupFuture(prev => [markups, ...prev].slice(0, MAX_HISTORY));
    setMarkups(previous);
    setSelectedMarkup(null);
  }, [markupHistory, markups]);
  
  const redoMarkup = useCallback(() => {
    if (markupFuture.length === 0) return;
    const next = markupFuture[0];
    setMarkupFuture(prev => prev.slice(1));
    setMarkupHistory(prev => [...prev.slice(-(MAX_HISTORY - 1)), markups]);
    setMarkups(next);
    setSelectedMarkup(null);
  }, [markupFuture, markups]);
  
  const addMarkupWithHistory = useCallback((newMarkup) => {
    // Auto-stamp creation date if not already set (PDF-imported markups already have it)
    const stamped = newMarkup.createdDate ? newMarkup : { ...newMarkup, createdDate: new Date().toISOString() };
    setMarkupHistory(prev => [...prev.slice(-(MAX_HISTORY - 1)), markups]);
    setMarkupFuture([]);
    setMarkups(prev => [...prev, stamped]);
  }, [markups]);
  
  // Jump to a specific history entry (for the history panel)
  // index refers to markupHistory[index]
  const jumpToHistory = useCallback((targetIndex) => {
    if (targetIndex < 0 || targetIndex >= markupHistory.length) return;
    const target = markupHistory[targetIndex];
    
    // Everything after targetIndex in history stays as history
    // Current + everything that was between targetIndex and current becomes future
    const newHistory = markupHistory.slice(0, targetIndex);
    const statesBetween = markupHistory.slice(targetIndex + 1); // states after target but before current
    const newFuture = [...statesBetween, markups, ...markupFuture];
    
    setMarkupHistory(newHistory);
    setMarkupFuture(newFuture.slice(0, MAX_HISTORY));
    setMarkups(target);
    setSelectedMarkup(null);
  }, [markupHistory, markupFuture, markups]);
  
  // Jump to a specific future entry (for the history panel)
  // index refers to markupFuture[index]
  const jumpToFuture = useCallback((targetIndex) => {
    if (targetIndex < 0 || targetIndex >= markupFuture.length) return;
    const target = markupFuture[targetIndex];
    
    // Everything before targetIndex in future stays as future
    // Current + everything between current and targetIndex becomes history
    const statesBetween = markupFuture.slice(0, targetIndex); // states between current and target
    const newHistory = [...markupHistory, markups, ...statesBetween];
    const newFuture = markupFuture.slice(targetIndex + 1);
    
    setMarkupHistory(newHistory.slice(-MAX_HISTORY));
    setMarkupFuture(newFuture);
    setMarkups(target);
    setSelectedMarkup(null);
  }, [markupHistory, markupFuture, markups]);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CLIPBOARD (COPY / PASTE)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const copyMarkups = useCallback((markupsToCopy) => {
    if (!markupsToCopy || markupsToCopy.length === 0) return;
    // Deep clone to avoid reference issues
    clipboardRef.current = JSON.parse(JSON.stringify(markupsToCopy));
  }, []);
  
  const pasteMarkups = useCallback((targetPage, targetFile) => {
    if (clipboardRef.current.length === 0) return;
    
    // Save history before paste (use ref for stale-closure safety)
    const current = markupsRef.current;
    setMarkupHistory(prev => [...prev.slice(-(MAX_HISTORY - 1)), current]);
    setMarkupFuture([]);
    
    // Slight offset so pasted markups don't exactly overlap originals
    const PASTE_OFFSET = 0.02; // 2% of page
    
    const newMarkups = clipboardRef.current.map(m => {
      const newId = `${m.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const pasted = {
        ...m,
        id: newId,
        page: targetPage,
        file: targetFile,
        filename: targetFile,
        fromPdf: false,
        pdfAnnotId: undefined,
        modified: undefined,
      };
      
      // Offset coordinates
      if (pasted.startX !== undefined) {
        pasted.startX += PASTE_OFFSET;
        pasted.startY += PASTE_OFFSET;
      }
      if (pasted.endX !== undefined) {
        pasted.endX += PASTE_OFFSET;
        pasted.endY += PASTE_OFFSET;
      }
      if (pasted.x !== undefined) {
        pasted.x += PASTE_OFFSET;
        pasted.y += PASTE_OFFSET;
      }
      if (pasted.points) {
        pasted.points = pasted.points.map(p => ({ ...p, x: p.x + PASTE_OFFSET, y: p.y + PASTE_OFFSET }));
      }
      if (pasted.point1X !== undefined) {
        pasted.point1X += PASTE_OFFSET;
        pasted.point1Y += PASTE_OFFSET;
        pasted.point2X += PASTE_OFFSET;
        pasted.point2Y += PASTE_OFFSET;
      }
      
      return pasted;
    });
    
    setMarkups(prev => [...prev, ...newMarkups]);
    
    // Select the pasted markups
    if (newMarkups.length === 1) {
      setSelectedMarkup(newMarkups[0]);
      selectedMarkupRef.current = newMarkups[0];
      setSelectedMarkups([]);
      selectedMarkupsRef.current = [];
    } else {
      setSelectedMarkup(null);
      selectedMarkupRef.current = null;
      setSelectedMarkups(newMarkups);
      selectedMarkupsRef.current = newMarkups;
    }
    
    return newMarkups;
  }, []);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // COMMENTS
  // ═══════════════════════════════════════════════════════════════════════════
  
  const addCommentToMarkup = useCallback((markupId, commentText) => {
    if (!commentText.trim()) return;
    
    const newComment = {
      id: `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      text: commentText.trim(),
      author: markupAuthor,
      date: new Date().toISOString(),
    };
    
    setMarkupComments(prev => ({
      ...prev,
      [markupId]: [...(prev[markupId] || []), newComment],
    }));
    setCommentInputText('');
    setShowCommentInput(null);
  }, [markupAuthor]);
  
  const deleteComment = useCallback((markupId, commentId) => {
    setMarkupComments(prev => ({
      ...prev,
      [markupId]: (prev[markupId] || []).filter(c => c.id !== commentId),
    }));
  }, []);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TEXT EDITING
  // ═══════════════════════════════════════════════════════════════════════════
  
  const startTextEdit = useCallback((markup) => {
    if (markup.type !== 'text' && markup.type !== 'callout') return;
    setEditingTextMarkupId(markup.id);
    setTextEditValue(markup.text || '');
  }, []);
  
  const saveTextEdit = useCallback((staySelected = false) => {
    if (!editingTextMarkupId) return;
    
    const textValue = textInputRef.current ? textInputRef.current.value : textEditValue;
    
    setMarkups(prev => prev.map(m => {
      if (m.id === editingTextMarkupId) {
        return { ...m, text: textValue, modified: m.fromPdf ? true : m.modified };
      }
      return m;
    }));
    
    // Update selected markup too
    if (selectedMarkup?.id === editingTextMarkupId) {
      setSelectedMarkup(prev => prev ? { ...prev, text: textValue } : null);
    }
    
    setEditingTextMarkupId(null);
    setTextEditValue('');
    
    if (!staySelected) {
      setSelectedMarkup(null);
    }
  }, [editingTextMarkupId, textEditValue, selectedMarkup]);
  
  const cancelTextEdit = useCallback(() => {
    setEditingTextMarkupId(null);
    setTextEditValue('');
  }, []);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // NAVIGATION
  // ═══════════════════════════════════════════════════════════════════════════
  
  const navigateToMarkup = useCallback((markup, convertToEditableFormat) => {
    // Change page if needed
    if (markup.page !== currentPage - 1) {
      setCurrentPage(markup.page + 1);
    }
    
    // Convert if needed (conversion function passed from PDFViewerArea)
    let editableMarkup = markup;
    const needsConversion = 
      (markup.hasCustomAppearance && !markup.modified) ||
      (markup.type === 'text' && markup.x !== undefined && markup.startX === undefined) ||
      (markup.type === 'textHighlight' && !markup.modified) ||
      (markup.type === 'textMarkup' && !markup.modified);
    
    if (needsConversion && convertToEditableFormat) {
      editableMarkup = convertToEditableFormat(markup);
      setMarkups(prev => prev.map(m => m.id === markup.id ? editableMarkup : m));
    }
    
    // Select the markup
    setSelectedMarkup(editableMarkup);
    setMarkupMode('select');
    
    // Scroll into view
    setTimeout(() => {
      const bounds = getMarkupBounds(editableMarkup);
      if (bounds && containerRef?.current && canvasSize) {
        const centerX = ((bounds.minX + bounds.maxX) / 2) * (canvasSize.width || 800) * scale;
        const centerY = ((bounds.minY + bounds.maxY) / 2) * (canvasSize.height || 1000) * scale;
        
        containerRef.current.scrollTo({
          left: centerX - containerRef.current.clientWidth / 2,
          top: centerY - containerRef.current.clientHeight / 2,
          behavior: 'smooth'
        });
      }
    }, 100);
  }, [currentPage, setCurrentPage, canvasSize, scale, getMarkupBounds, containerRef]);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SYMBOL MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════
  
  const saveAsSymbol = useCallback((name) => {
    if (!selectedMarkups.length && !selectedMarkup) return;
    
    const markupsToSave = selectedMarkups.length > 0 ? selectedMarkups : [selectedMarkup];
    
    // Calculate bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    markupsToSave.forEach(m => {
      const bounds = getMarkupBounds(m);
      if (bounds) {
        minX = Math.min(minX, bounds.minX);
        minY = Math.min(minY, bounds.minY);
        maxX = Math.max(maxX, bounds.maxX);
        maxY = Math.max(maxY, bounds.maxY);
      }
    });
    
    // Normalize positions
    const normalizedMarkups = markupsToSave.map(m => {
      const normalized = { ...m };
      delete normalized.id;
      delete normalized.filename;
      delete normalized.page;
      
      if (m.type === 'pen' || m.type === 'highlighter') {
        normalized.points = m.points.map(p => ({
          x: p.x - minX,
          y: p.y - minY
        }));
      } else if (m.type === 'polyline' || m.type === 'polylineArrow' || m.type === 'cloudPolyline') {
        normalized.points = m.points.map(p => ({
          x: p.x - minX,
          y: p.y - minY
        }));
        normalized.startX = m.startX - minX;
        normalized.startY = m.startY - minY;
        normalized.endX = m.endX - minX;
        normalized.endY = m.endY - minY;
      } else if (m.startX !== undefined) {
        normalized.startX = m.startX - minX;
        normalized.startY = m.startY - minY;
        normalized.endX = m.endX - minX;
        normalized.endY = m.endY - minY;
      } else if (m.x !== undefined) {
        normalized.x = m.x - minX;
        normalized.y = m.y - minY;
      }
      
      return normalized;
    });
    
    const newSymbol = {
      id: `symbol_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: name || 'Untitled Symbol',
      markups: normalizedMarkups,
      width: maxX - minX,
      height: maxY - minY,
      createdAt: new Date().toISOString(),
    };
    
    setSavedSymbols(prev => {
      const updated = [...prev, newSymbol];
      try {
        localStorage.setItem('markup_symbols', JSON.stringify(updated));
      } catch (e) {
        console.warn('Could not save symbols to localStorage:', e);
      }
      return updated;
    });
    
    setShowSaveSymbolDialog(false);
    setSymbolNameInput('');
    setSymbolCreationMode(false);
  }, [selectedMarkup, selectedMarkups, getMarkupBounds]);
  
  const placeSymbol = useCallback((symbol, centerX, centerY) => {
    if (!symbol || !symbol.markups) return;
    
    const pageIndex = currentPage - 1;
    
    // Center the symbol at drop position
    const offsetX = centerX - symbol.width / 2;
    const offsetY = centerY - symbol.height / 2;
    
    const newMarkups = symbol.markups.map(m => {
      const newId = `markup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const newMarkup = { ...m, id: newId, filename: currentFileIdentifier, page: pageIndex };
      
      if (m.type === 'pen' || m.type === 'highlighter') {
        newMarkup.points = m.points.map(p => ({
          x: p.x + offsetX,
          y: p.y + offsetY
        }));
      } else if (m.type === 'polyline' || m.type === 'polylineArrow' || m.type === 'cloudPolyline') {
        newMarkup.points = m.points.map(p => ({
          x: p.x + offsetX,
          y: p.y + offsetY
        }));
        newMarkup.startX = m.startX + offsetX;
        newMarkup.startY = m.startY + offsetY;
        newMarkup.endX = m.endX + offsetX;
        newMarkup.endY = m.endY + offsetY;
      } else if (m.startX !== undefined) {
        newMarkup.startX = m.startX + offsetX;
        newMarkup.startY = m.startY + offsetY;
        newMarkup.endX = m.endX + offsetX;
        newMarkup.endY = m.endY + offsetY;
      } else if (m.x !== undefined) {
        newMarkup.x = m.x + offsetX;
        newMarkup.y = m.y + offsetY;
      }
      
      return newMarkup;
    });
    
    // Add all markups with history
    setMarkupHistory(prev => [...prev.slice(-50), markups]);
    setMarkupFuture([]);
    setMarkups(prev => [...prev, ...newMarkups]);
    
    // Select the placed markups
    if (newMarkups.length === 1) {
      setSelectedMarkup(newMarkups[0]);
      setSelectedMarkups([]);
    } else {
      setSelectedMarkup(null);
      setSelectedMarkups(newMarkups);
    }
    
    setDraggingSymbol(null);
  }, [currentPage, currentFileIdentifier, markups]);
  
  const placeImageSymbol = useCallback((symbol, centerX, centerY) => {
    if (!symbol || !symbol.imageData) return;
    
    const pageIndex = currentPage - 1;
    
    // Calculate placement
    const halfWidth = symbol.width / 2;
    const halfHeight = symbol.height / 2;
    
    const newMarkup = {
      id: `markup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'image',
      filename: currentFileIdentifier,
      page: pageIndex,
      startX: centerX - halfWidth,
      startY: centerY - halfHeight,
      endX: centerX + halfWidth,
      endY: centerY + halfHeight,
      imageData: symbol.imageData,
      originalWidth: symbol.originalWidth,
      originalHeight: symbol.originalHeight,
    };
    
    addMarkupWithHistory(newMarkup);
    setSelectedMarkup(newMarkup);
    setDraggingSymbol(null);
  }, [currentPage, currentFileIdentifier, addMarkupWithHistory]);
  
  const deleteSymbol = useCallback((symbolId) => {
    setSavedSymbols(prev => {
      const updated = prev.filter(s => s.id !== symbolId);
      try {
        localStorage.setItem('markup_symbols', JSON.stringify(updated));
      } catch (e) {
        console.warn('Could not save symbols to localStorage:', e);
      }
      return updated;
    });
  }, []);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // MARKUP FILTERING
  // ═══════════════════════════════════════════════════════════════════════════
  
  const getFilteredMarkups = useCallback(() => {
    let filtered = markups.filter(m => m.filename === currentFileIdentifier);
    
    if (markupListFilter === 'current') {
      filtered = filtered.filter(m => m.page === currentPage - 1);
    } else if (markupListFilter === 'type' && markupListTypeFilter) {
      filtered = filtered.filter(m => m.type === markupListTypeFilter);
    }
    
    return filtered;
  }, [markups, currentFileIdentifier, markupListFilter, markupListTypeFilter, currentPage]);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // COMPUTED VALUES (MEMOS)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const markupsByPageIndex = useMemo(() => {
    const byPage = {};
    markups.forEach(m => {
      if (m.filename === currentFileIdentifier) {
        if (!byPage[m.page]) byPage[m.page] = [];
        byPage[m.page].push(m);
      }
    });
    return byPage;
  }, [markups, currentFileIdentifier]);
  
  const currentPageMarkups = useMemo(() => {
    return markupsByPageIndex[currentPage - 1] || [];
  }, [markupsByPageIndex, currentPage]);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // RETURN ALL STATE AND FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  
  return {
    // Styling state
    markupColor, setMarkupColor,
    markupStrokeWidth, setMarkupStrokeWidth,
    markupFillColor, setMarkupFillColor,
    markupBorderColor, setMarkupBorderColor,
    markupBorderWidth, setMarkupBorderWidth,
    markupBorderStyle, setMarkupBorderStyle,
    markupBorderOpacity, setMarkupBorderOpacity,
    markupTextPadding, setMarkupTextPadding,
    markupFontSize, setMarkupFontSize,
    markupFontFamily, setMarkupFontFamily,
    markupTextAlign, setMarkupTextAlign,
    markupVerticalAlign, setMarkupVerticalAlign,
    markupLineSpacing, setMarkupLineSpacing,
    markupOpacity, setMarkupOpacity,
    markupArrowHeadSize, setMarkupArrowHeadSize,
    markupLineStyle, setMarkupLineStyle,
    markupStrokeOpacity, setMarkupStrokeOpacity,
    markupFillOpacity, setMarkupFillOpacity,
    markupCloudInverted, setMarkupCloudInverted,
    markupCloudIntensity, setMarkupCloudIntensity,
    markupCloudBulge, setMarkupCloudBulge,
    markupCloudArcSize, setMarkupCloudArcSize,
    markupArcStartAngle, setMarkupArcStartAngle,
    markupArcEndAngle, setMarkupArcEndAngle,
    penHighlighterUIMode, setPenHighlighterUIMode,
    
    // Data state
    markups, setMarkups,
    currentMarkup, setCurrentMarkup,
    selectedMarkup, setSelectedMarkup,
    selectedMarkups, setSelectedMarkups,
    
    // Mode/UI state
    showMarkupsPanel, setShowMarkupsPanel,
    markupMode, setMarkupMode,
    hasLoadedAnnotations, setHasLoadedAnnotations,
    isDrawingMarkup, setIsDrawingMarkup,
    isSavingMarkups, setIsSavingMarkups,
    unsavedMarkupFiles, setUnsavedMarkupFiles,
    deletedPdfAnnotations, setDeletedPdfAnnotations,
    
    // Interaction state
    isDraggingMarkup, setIsDraggingMarkup,
    isResizingMarkup, setIsResizingMarkup,
    isRotatingMarkup, setIsRotatingMarkup,
    draggingPolylinePoint, setDraggingPolylinePoint,
    resizeHandle, setResizeHandle,
    markupDragStart, setMarkupDragStart,
    dragStart, setDragStart,
    rotationStart, setRotationStart,
    activeResizeHandle, setActiveResizeHandle,
    activeArcHandle, setActiveArcHandle,
    
    // Polyline/cloud state
    cloudPoints, setCloudPoints,
    polylinePoints, setPolylinePoints,
    polylineMousePos, setPolylineMousePos,
    markupPolylineMousePos, setMarkupPolylineMousePos,
    isNearStartPoint, setIsNearStartPoint,
    isShiftPressed, setIsShiftPressed,
    
    // Text editing state
    editingTextMarkupId, setEditingTextMarkupId,
    textEditValue, setTextEditValue,
    editingMarkupText, setEditingMarkupText,
    textInputRef,
    
    // History state
    markupHistory, setMarkupHistory,
    markupFuture, setMarkupFuture,
    
    // Notes/comments state
    showNoteDialog, setShowNoteDialog,
    noteDialogPosition, setNoteDialogPosition,
    noteText, setNoteText,
    editingNoteId, setEditingNoteId,
    expandedNotes, setExpandedNotes,
    markupComments, setMarkupComments,
    showCommentInput, setShowCommentInput,
    commentInputText, setCommentInputText,
    markupAuthor, setMarkupAuthor,
    hoveredMarkupId, setHoveredMarkupId,
    
    // Callout state
    calloutTailPosition, setCalloutTailPosition,
    
    // List/filter state
    showMarkupsList, setShowMarkupsList,
    markupListFilter, setMarkupListFilter,
    markupListTypeFilter, setMarkupListTypeFilter,
    
    // Context menu state
    showMarkupContextMenu, setShowMarkupContextMenu,
    markupContextMenuPos, setMarkupContextMenuPos,
    markupContextMenuTarget, setMarkupContextMenuTarget,
    
    // Symbol state
    savedSymbols, setSavedSymbols,
    showSaveSymbolDialog, setShowSaveSymbolDialog,
    symbolNameInput, setSymbolNameInput,
    draggingSymbol, setDraggingSymbol,
    symbolCreationMode, setSymbolCreationMode,
    symbolCaptureMode, setSymbolCaptureMode,
    captureRegion, setCaptureRegion,
    symbolSearchQuery, setSymbolSearchQuery,
    symbolsViewMode, setSymbolsViewMode,
    defaultSignatureId, setDefaultSignatureId,
    pendingPlacement, setPendingPlacement,
    
    // Refs
    markupCanvasRef,
    isDraggingMarkupRef,
    isResizingMarkupRef,
    isRotatingMarkupRef,
    isDrawingMarkupRef,
    currentMarkupRef,
    drawingOverlayRef,
    drawingPageRef,
    rafIdRef,
    draggingPolylinePointRef,
    didDragMoveRef,
    wasAlreadySelectedRef,
    selectedMarkupRef,
    selectedMarkupsRef,
    markupDragStartRef,
    dragStartRef,
    resizeHandleRef,
    rotationStartRef,
    dragDeltaRef,
    dragOffsetRef,
    markupDragRafRef,
    pendingMarkupUpdateRef,
    lastHitTestTimeRef,
    lastSavedMarkupsRef,
    pendingPolylinePointRef,
    continuousSelectionRef,
    hoveredMarkupIdRef,
    
    // Utility functions
    getLineDashArray,
    getMarkupCursor,
    penCursor,
    highlighterCursor,
    
    // Core functions
    getMarkupBounds,
    moveMarkup,
    resizeMarkup,
    updateMarkupProperties,
    deleteSelectedMarkup,
    undoMarkup,
    redoMarkup,
    addMarkupWithHistory,
    saveHistory,
    copyMarkups,
    pasteMarkups,
    clipboardRef,
    jumpToHistory,
    jumpToFuture,
    
    // Comments
    addCommentToMarkup,
    deleteComment,
    
    // Text editing
    startTextEdit,
    saveTextEdit,
    cancelTextEdit,
    
    // Navigation
    navigateToMarkup,
    
    // Symbols
    saveAsSymbol,
    placeSymbol,
    placeImageSymbol,
    deleteSymbol,
    
    // Filtering
    getFilteredMarkups,
    
    // Computed values
    markupsByPageIndex,
    currentPageMarkups,
  };
}
