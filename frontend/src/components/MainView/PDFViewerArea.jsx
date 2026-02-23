import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { trainDetector, runDetection, getModels, deleteModel, getObjectsFromBackend, saveObjectsToBackend, getRegionsFromBackend, saveRegionsToBackend, getPdfFromBackend, runFullPageOcr, getProjectLineStyles, addProjectLineStyle, removeProjectLineStyle } from '../../utils/storage';
import { BACKEND_URL } from '../../utils/config';
import { AssignDialog, HotspotContextMenu, MarkupContextMenu, NoteDialog, SaveSymbolDialog, RegionAssignDialog, RegionEditDialog, ObjectClassDialog, ZoomSettingsDialog, loadZoomSettings, saveZoomSettings } from './Dialogs';
import { ViewPanel, SearchPanel, LinksPanel, SymbolsPanel, OCRPanel, PropertiesPanel, MarkupHistoryPanel } from './Panels';
import { TopToolbar, MarkupToolbar, BottomToolbar } from './Toolbars';
import ToolOptionsBar from './Toolbars/ToolOptionsBar';
import SinglePageView from './Views/SinglePageView';
import ContinuousView from './Views/ContinuousView';
// SideBySideView removed — now handled by ContinuousView with memoized pages
import useZoomPan from './Hooks/useZoomPan';
import usePdfRenderer from './Hooks/usePdfRenderer';
import useContinuousLayout, { isContinuousView } from './Hooks/useContinuousLayout';
import useMarkups from './Hooks/useMarkups';
import { useSaveMarkups } from './Hooks/useSaveMarkups';
import { deleteAnnotationsFromPdf, parseAnnotationsFromPdf, dumpAllAnnotationData, stripAllAnnotations } from './pdfAnnotationUtils';
import './PDFViewerArea.css';

// DEBUG_ANNOTATIONS, extractRawAnnotationData, deleteAnnotationsFromPdf, and 
// parseAnnotationsFromPdf are now imported from ./pdfAnnotationUtils

// Pattern matching helpers for OCR-to-Objects (shared with OCRPanel logic)
function ocrFormatExampleToRegex(fmt) {
  if (!fmt) return null;
  let p = '';
  for (const ch of fmt) {
    if (/[A-Za-z]/.test(ch)) p += '[A-Za-z]';
    else if (/[0-9]/.test(ch)) p += '[0-9]';
    else p += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return p;
}

function ocrMatchText(text, searchText, matchType) {
  if (!text || !searchText) return false;
  if (matchType === 'pattern') {
    const pattern = ocrFormatExampleToRegex(searchText);
    if (!pattern) return false;
    try { return new RegExp(pattern, 'i').test(text); } catch { return false; }
  }
  const nt = text.toLowerCase(), ns = searchText.toLowerCase();
  switch (matchType) {
    case 'starts': return nt.startsWith(ns);
    case 'ends': return nt.endsWith(ns);
    case 'exact': return nt === ns;
    case 'contains': default: return nt.includes(ns);
  }
}

function ocrExtractMatch(text, searchText, matchType) {
  if (!text || !searchText) return text;
  if (matchType === 'pattern') {
    const pattern = ocrFormatExampleToRegex(searchText);
    if (!pattern) return text;
    try {
      const m = text.match(new RegExp(pattern, 'i'));
      return m ? m[0] : text;
    } catch { return text; }
  }
  return text;
}

function ocrFormatToDisplay(fmt) {
  if (!fmt) return '';
  return fmt.replace(/[A-Za-z]/g, 'L').replace(/[0-9]/g, 'N');
}

export default function PDFViewerArea({ 
  currentFile, 
  pdfUrl, 
  isLoadingPdf,
  project, 
  allFiles, 
  onFileSelect,
  onNavigateFile, 
  onProjectUpdate,
  pendingNavigation,
  onNavigationComplete,
  onRefresh,
  onOpenInfiniteView,
  onPanelStateChange,
  onUnsavedChangesUpdate, // Callback to report files with unsaved markup changes
  onRegisterSaveHandler, // Callback to register save function
  onRegisterDownloadHandler, // Callback to register download function
  onSavingStateChange, // Callback to report when saving is in progress
  refreshKey = 0,  // Increment to force reload of objects
  initialShowSearchPanel = false,
  initialShowObjectFinder = false,
  initialShowSmartLinks = false,
  initialShowViewPanel = false,
  initialShowOcrPanel = false,
  unlockedFiles = new Set(),
  onUnlockFile,
  onLockFile,
}) {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const currentPageRef = useRef(1);
  const [numPages, setNumPages] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [pageInput, setPageInput] = useState(null); // For editable page number input
  const [selectMode, setSelectMode] = useState(true); // Default to select mode (arrow cursor)
  const [panMode, setPanMode] = useState(false);
  const [zoomMode, setZoomMode] = useState(false);
  const isPanningRef = useRef(false); // Written by pan handlers, read by useContinuousLayout for scroll debouncing
  const [isPanning, _setIsPanning] = useState(false);
  const setIsPanning = useCallback((val) => {
    const v = typeof val === 'function' ? val(isPanningRef.current) : val;
    isPanningRef.current = v;
    _setIsPanning(v);
  }, []);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  
  // Note: continuous view uses `scale` directly for layout — no deferred commit needed.
  // The isZooming flag still gates expensive canvas re-renders during rapid zoom.
  
  // Performance: Defer overlay rendering until PDF is ready (faster file switching)
  const [overlaysReady, setOverlaysReady] = useState(false);
  const overlayDelayRef = useRef(null);

  // View mode state
  const [showViewPanel, setShowViewPanel] = useState(initialShowViewPanel);
  const [viewMode, setViewMode] = useState('single'); // 'single', 'continuous', 'continuousHorizontal', 'sideBySide'
  const [showContinuousOptions, setShowContinuousOptions] = useState(false);
  const [pdfBackgroundColor, setPdfBackgroundColor] = useState(() => {
    try {
      return localStorage.getItem('pdfBackgroundColor') || '#525659';
    } catch {
      return '#525659';
    }
  });
  const [showMarkupToolbar, setShowMarkupToolbar] = useState(() => {
    try {
      const saved = localStorage.getItem('showMarkupToolbar');
      return saved === null ? true : saved === 'true'; // Default to true (visible)
    } catch {
      return true;
    }
  });
  const [visiblePages, setVisiblePages] = useState(new Set([1, 2, 3])); // Shared state: written by useContinuousLayout, read by usePdfRenderer
  const visiblePagesRef = useRef(new Set([1, 2, 3])); // Shared ref mirror
  const CONTINUOUS_VIEW_BUFFER = 3; // Number of pages to mount above/below viewport

  // --- Zoom & Navigation settings ---
  const [zoomSettings, setZoomSettings] = useState(() => loadZoomSettings());
  const [showZoomSettingsDialog, setShowZoomSettingsDialog] = useState(false);
  const zoomSettingsRef = useRef(zoomSettings);
  // Crosshair refs — direct DOM manipulation, no React re-renders on mouse move
  const crosshairHRef = useRef(null);
  const crosshairVRef = useRef(null);
  const coordsRef = useRef(null);
  const pdfvMousePosRef = useRef(null);

  // --- Shared refs (used by multiple hooks) ---
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const continuousLayoutRef = useRef({ positions: [], totalHeight: 0, gap: 10, padding: 20, maxPageWidth: 800 });
  const isZoomingRef = useRef(false); // Written by useZoomPan, read by usePdfRenderer + useContinuousLayout
  const isScrollingRef = useRef(false); // Written by useContinuousLayout, read by usePdfRenderer

  // --- PDF rendering engine (extracted hook) ---
  const {
    isRendering, canvasSize, pdfPageRotation, pageBaseDimensions, allPageDimensions,
    renderedPages, continuousCanvasRefs, renderedPagesRef,
    renderAllPagesRef, precomputedPageDimsRef,
    renderPage, renderAllPages, resetRenderedPages,
  } = usePdfRenderer({
    pdfDoc, numPages, currentPage, currentPageRef,
    rotation, viewMode, visiblePages,
    isZoomingRef, isScrollingRef, containerRef, canvasRef,
    continuousLayoutRef, CONTINUOUS_VIEW_BUFFER,
  });

  // --- Zoom/pan engine (extracted hook) ---
  const {
    scale, setScale,
    zoomInput, setZoomInput,
    isZooming,
    scaleRef, pendingScrollRef,
    continuousWrapperRef, zoomInnerRef,
    singleScrollContentRef, singleCanvasContainerRef,
    zoomWithScrollAdjust, applyZoomInput,
  } = useZoomPan({
    containerRef, viewMode, canvasSize, zoomMode,
    continuousLayoutRef, visiblePagesRef,
    renderedPagesRef, renderAllPagesRef,
    isZoomingRef, zoomSettingsRef,
  });

  // --- Continuous view layout engine (extracted hook) ---
  const {
    continuousLayout,
    scrollToPagePosition,
  } = useContinuousLayout({
    viewMode, numPages, scale, setCurrentPage, currentPageRef,
    canvasSize, allPageDimensions, precomputedPageDimsRef,
    containerRef, continuousLayoutRef, isZoomingRef,
    setVisiblePages, visiblePagesRef, isPanningRef, isScrollingRef,
  });

  // --- Markup engine (extracted hook) - Phase 2: COMPLETE - all state from hook ---
  const {
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
    isDraggingMarkupRef, isResizingMarkupRef, isRotatingMarkupRef,
    isDrawingMarkupRef, currentMarkupRef,
    drawingOverlayRef, drawingPageRef, rafIdRef,
    draggingPolylinePointRef, didDragMoveRef, wasAlreadySelectedRef,
    selectedMarkupRef, selectedMarkupsRef,
    markupDragStartRef, dragStartRef, resizeHandleRef, rotationStartRef,
    dragDeltaRef, dragOffsetRef,
    markupDragRafRef, pendingMarkupUpdateRef,
    lastHitTestTimeRef, lastSavedMarkupsRef,
    pendingPolylinePointRef, continuousSelectionRef,
    hoveredMarkupIdRef,
    
    // Utility functions
    getLineDashArray, getMarkupCursor, penCursor, highlighterCursor,
    
    // Core functions
    getMarkupBounds, moveMarkup, resizeMarkup,
    updateMarkupProperties, deleteSelectedMarkup,
    undoMarkup, redoMarkup, addMarkupWithHistory,
    saveHistory, copyMarkups, pasteMarkups, clipboardRef,
    jumpToHistory, jumpToFuture,
    
    // Comments
    addCommentToMarkup, deleteComment,
    
    // Text editing
    startTextEdit, saveTextEdit, cancelTextEdit,
    
    // Symbols (NOTE: placeSymbol, placeImageSymbol, saveAsSymbol kept in PDFViewerArea due to field name differences)
    deleteSymbol,
    
    // Filtering (NOTE: getFilteredMarkups, markupsByPageIndex, currentPageMarkups kept in PDFViewerArea)
  } = useMarkups({
    currentPage,
    setCurrentPage,
    currentFileIdentifier: currentFile?.isLocal ? currentFile?.id : currentFile?.backendFilename || null,
    scale,
    canvasSize,
    containerRef,
    allPageDimensions,
    viewMode,
    scrollToPagePosition,
  });

  // Get the identifier for the current file (used for tracking markups, lock state, etc.)
  const currentFileIdentifier = useMemo(() => {
    if (!currentFile) return null;
    return currentFile.backendFilename || null;
  }, [currentFile]);

  // Derive markupEditMode from the per-file unlockedFiles set
  const markupEditMode = unlockedFiles.has(currentFileIdentifier);
  const setMarkupEditMode = useCallback((value) => {
    if (!currentFileIdentifier) return;
    if (value) {
      onUnlockFile?.(currentFileIdentifier);
    } else {
      onLockFile?.(currentFileIdentifier);
    }
  }, [currentFileIdentifier, onUnlockFile, onLockFile]);

  // Track which category (symbol/stamp) the save dialog is saving for
  const [symbolSaveCategory, setSymbolSaveCategory] = useState('symbol');
  
  // Named/custom line style state for drawing tools (ephemeral per session)
  const [markupLineStyleName, setMarkupLineStyleName] = useState(null);
  const [markupLineStylePattern, setMarkupLineStylePattern] = useState(null);
  const [markupLineStyleRaw, setMarkupLineStyleRaw] = useState(null);
  
  // Project-scoped saved line styles (persisted in IndexedDB on project object)
  const [projectLineStyles, setProjectLineStyles] = useState([]);
  
  // Load project line styles on mount / project change
  useEffect(() => {
    if (!projectId) return;
    getProjectLineStyles(projectId).then(styles => {
      setProjectLineStyles(styles || []);
    }).catch(err => console.error('Failed to load project line styles:', err));
  }, [projectId]);
  
  // Save a new line style to the project
  const handleSaveLineStyle = useCallback(async (style) => {
    if (!projectId) return 'error';
    const result = await addProjectLineStyle(projectId, style);
    if (result === 'saved') {
      const updated = await getProjectLineStyles(projectId);
      setProjectLineStyles(updated);
    }
    return result;
  }, [projectId]);
  
  // Remove a line style from the project
  const handleRemoveLineStyle = useCallback(async (styleName) => {
    if (!projectId) return;
    await removeProjectLineStyle(projectId, styleName);
    const updated = await getProjectLineStyles(projectId);
    setProjectLineStyles(updated);
  }, [projectId]);

  // --- Memoize mounted page range for continuous view (avoids recomputing on every render) ---
  const prevMountedRangeRef = useRef({ min: 1, max: 1 });
  const mountedPageRange = useMemo(() => {
    if (!isContinuousView(viewMode) || numPages === 0) return prevMountedRangeRef.current;
    const visibleArr = [...visiblePages];
    const min = visibleArr.length > 0
      ? Math.max(1, Math.min(...visibleArr) - CONTINUOUS_VIEW_BUFFER)
      : Math.max(1, currentPage - CONTINUOUS_VIEW_BUFFER);
    const max = visibleArr.length > 0
      ? Math.min(numPages, Math.max(...visibleArr) + CONTINUOUS_VIEW_BUFFER)
      : Math.min(numPages, currentPage + CONTINUOUS_VIEW_BUFFER);
    // Return SAME reference if range unchanged — prevents downstream re-renders
    const prev = prevMountedRangeRef.current;
    if (prev.min === min && prev.max === max) return prev;
    prevMountedRangeRef.current = { min, max };
    return prevMountedRangeRef.current;
  }, [viewMode, numPages, visiblePages, currentPage]);

  // Smart Links state
  const [showSmartLinks, setShowSmartLinks] = useState(initialShowSmartLinks);
  const [linkMode, setLinkMode] = useState(null);
  const [trainingBoxes, setTrainingBoxes] = useState([]);
  const [hotspots, setHotspots] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState(null);
  const [currentRect, setCurrentRect] = useState(null);
  const [savedModels, setSavedModels] = useState([]);
  const [selectedModels, setSelectedModels] = useState([]);
  const [confidence, setConfidence] = useState(0.65);
  const [enableOCR, setEnableOCR] = useState(true);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [pendingHotspot, setPendingHotspot] = useState(null);
  const [hoveredHotspot, setHoveredHotspot] = useState(null);
  const [hotspotContextMenu, setHotspotContextMenu] = useState(null); // { hotspot, x, y, targetFile, isLinked, isBroken }
  const [isDetecting, setIsDetecting] = useState(false);
  const [smartLinksProgress, setSmartLinksProgress] = useState({
    phase: '', // 'detecting', 'extracting', 'saving', 'complete'
    currentFile: '',
    currentFileIndex: 0,
    totalFiles: 0,
    percent: 0
  });
  const [smartLinksDisplayPercent, setSmartLinksDisplayPercent] = useState(0); // Smooth animated percent
  const [isTraining, setIsTraining] = useState(false);
  const [detectionScope, setDetectionScope] = useState('current');
  const [detectionPageScope, setDetectionPageScope] = useState('all'); // 'current' or 'all' pages for Smart Links
  const [ocrFormat, setOcrFormat] = useState('');
  const [ocrFormatParsed, setOcrFormatParsed] = useState(null);
  const [extraLetters, setExtraLetters] = useState(2);
  const [extraDigits, setExtraDigits] = useState(1);
  const [trailingLetters, setTrailingLetters] = useState(1);
  const [targetSearchQuery, setTargetSearchQuery] = useState('');
  const [showLinksOnPdf, setShowLinksOnPdf] = useState(true);
  const [ocrTestResult, setOcrTestResult] = useState(null);
  const [isOcrTesting, setIsOcrTesting] = useState(false);
  const [ocrPadding, setOcrPadding] = useState(1.0);
  
  // Object Finder state
  const [showObjectFinder, setShowObjectFinder] = useState(initialShowObjectFinder);
  const [objectFinderMode, setObjectFinderMode] = useState(null); // 'train' or 'create'
  const [showDrawTypePopup, setShowDrawTypePopup] = useState(false); // Show popup to select object vs region
  const [objectDrawType, setObjectDrawType] = useState('object'); // 'object' or 'region'
  const [objectTrainingBoxes, setObjectTrainingBoxes] = useState([]);
  const [objectClassName, setObjectClassName] = useState('');
  const [objectModels, setObjectModels] = useState([]);
  const [selectedObjectModels, setSelectedObjectModels] = useState([]);
  const [objectModelSearch, setObjectModelSearch] = useState(''); // Search for models
  const [objectConfidence, setObjectConfidence] = useState(0.65);
  const [detectedObjects, setDetectedObjects] = useState([]);
  const [isObjectTraining, setIsObjectTraining] = useState(false);
  const [isObjectDetecting, setIsObjectDetecting] = useState(false);
  const [detectionProgress, setDetectionProgress] = useState({
    phase: '', // 'detecting', 'extracting', 'saving', 'complete'
    currentFile: '',
    currentFileIndex: 0,
    totalFiles: 0,
    percent: 0
  });
  const [detectionDisplayPercent, setDetectionDisplayPercent] = useState(0); // Smooth animated percent
  const [showObjectBoxes, setShowObjectBoxes] = useState(true);
  const [objectDetectionScope, setObjectDetectionScope] = useState('current');
  const [objectDetectionPageScope, setObjectDetectionPageScope] = useState('all'); // 'current' or 'all' pages
  const [objectEnableOCR, setObjectEnableOCR] = useState(true);
  const [objectOcrPadding, setObjectOcrPadding] = useState(1.0);
  const [objectModelMode, setObjectModelMode] = useState('separate'); // 'separate' or 'combined'
  const [showObjectClassDialog, setShowObjectClassDialog] = useState(false);
  const [pendingObjectBox, setPendingObjectBox] = useState(null);
  const [objectClassInput, setObjectClassInput] = useState('');
  const [objectTagInput, setObjectTagInput] = useState('');
  const [objectDescInput, setObjectDescInput] = useState('');
  const [savedObjects, setSavedObjects] = useState([]); // Objects drawn directly on PDF
  const [hoveredObject, setHoveredObject] = useState(null);
  
  // Objects panel resizable sections
  const [objectsPanelModelsHeight, setObjectsPanelModelsHeight] = useState(() => {
    try {
      const saved = localStorage.getItem('objectsPanelModelsHeight');
      return saved ? parseInt(saved, 10) : 200;
    } catch (e) {
      return 200;
    }
  });
  
  // Links panel resizable sections
  const [linksPanelModelsHeight, setLinksPanelModelsHeight] = useState(() => {
    try {
      const saved = localStorage.getItem('linksPanelModelsHeight');
      return saved ? parseInt(saved, 10) : 200;
    } catch (e) {
      return 200;
    }
  });
  const [linksModelSearch, setLinksModelSearch] = useState('');
  
  // OCR Panel state
  const [showOcrPanel, setShowOcrPanel] = useState(initialShowOcrPanel);
  const [showOcrOnPdf, setShowOcrOnPdf] = useState(false); // Default OFF - toggle to show OCR boxes
  const [ocrScope, setOcrScope] = useState('document');
  const [isRunningOcr, setIsRunningOcr] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(null);
  const ocrCancelRef = useRef(false); // For cancelling OCR operation
  
  // OCR results persisted in localStorage
  const [ocrResultsByFile, setOcrResultsByFile] = useState(() => {
    try {
      const saved = localStorage.getItem(`ocr_results_${projectId}`);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  
  // Persist OCR results to localStorage
  useEffect(() => {
    if (projectId && Object.keys(ocrResultsByFile).length > 0) {
      try {
        localStorage.setItem(`ocr_results_${projectId}`, JSON.stringify(ocrResultsByFile));
      } catch (e) {
        console.warn('Failed to persist OCR results:', e);
      }
    }
  }, [ocrResultsByFile, projectId]);
  
  // Search integration - include OCR in search (default OFF)
  const [includeOcrInSearch, setIncludeOcrInSearch] = useState(false);
  
  // Properties Panel state
  const [showPropertiesPanel, setShowPropertiesPanel] = useState(false);
  const [showMarkupHistoryPanel, setShowMarkupHistoryPanel] = useState(false);
  const [symbolsPanelWidth, setSymbolsPanelWidth] = useState(() => {
    const saved = localStorage.getItem('symbolsPanelWidth');
    return saved ? Math.max(320, Math.min(800, parseInt(saved))) : 320;
  });
  
  // Close markup history panel when switching documents
  useEffect(() => {
    setShowMarkupHistoryPanel(false);
  }, [currentFile?.id]);
  
  // Get OCR results for current file only
  const ocrResults = useMemo(() => {
    if (!currentFile?.backendFilename) return [];
    return ocrResultsByFile[currentFile.backendFilename] || [];
  }, [ocrResultsByFile, currentFile?.backendFilename]);
  
  // Total OCR results count across all files
  const ocrResultsCount = useMemo(() => {
    return Object.values(ocrResultsByFile).reduce((sum, results) => sum + (results?.length || 0), 0);
  }, [ocrResultsByFile]);
  
  const [ocrFilter, setOcrFilter] = useState('');
  const [ocrFilterType, setOcrFilterType] = useState('contains');
  
  // Drawn Regions state (separate from subclassRegions which is for training)
  const [drawnRegions, setDrawnRegions] = useState([]); // All drawn regions across all files
  const [showRegionAssignDialog, setShowRegionAssignDialog] = useState(false); // Dialog to assign region type
  const [pendingRegionShape, setPendingRegionShape] = useState(null); // Shape waiting to be assigned
  const [regionTypeInput, setRegionTypeInput] = useState(''); // Selected region type
  const [subRegionNameInput, setSubRegionNameInput] = useState(''); // Sub-region name input
  const [regionFillColorInput, setRegionFillColorInput] = useState('#3498db'); // Fill color for new region
  const [regionBorderColorInput, setRegionBorderColorInput] = useState('#3498db'); // Border color for new region
  const [showRegionBoxes, setShowRegionBoxes] = useState(() => {
    // Initialize from sessionStorage to persist filter state across navigation
    try {
      const saved = sessionStorage.getItem(`showRegionBoxes_${projectId}`);
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  }); // Toggle region visibility
  const [hoveredRegion, setHoveredRegion] = useState(null); // Currently hovered region
  const [showRegionEditDialog, setShowRegionEditDialog] = useState(false); // Dialog to edit/delete region
  const [editingRegion, setEditingRegion] = useState(null); // Region being edited
  const [editRegionName, setEditRegionName] = useState(''); // Edited name for region
  
  // Markup context menu state
  
  // Shape drawing state
  const [drawingShapeType, setDrawingShapeType] = useState('rectangle'); // 'rectangle', 'circle', 'polyline'
  const [pendingShape, setPendingShape] = useState(null); // Shape awaiting confirmation
  // Detection settings popup
  const [showDetectionSettings, setShowDetectionSettings] = useState(false);
  const [classDetectionSettings, setClassDetectionSettings] = useState({}); // {classId: {confidence, enableOCR}}
  // OCR-to-Objects settings (in Find Objects flow)
  const [ocrToObjectsEnabled, setOcrToObjectsEnabled] = useState(false);
  const [ocrToObjectsClasses, setOcrToObjectsClasses] = useState([
    { id: 1, className: '', useExisting: false, patterns: [''] }
  ]);
  const [expandedDetectionModels, setExpandedDetectionModels] = useState({});
  // Smart Links detection settings popup
  const [showSmartLinksSettings, setShowSmartLinksSettings] = useState(false);
  const [smartLinksClassSettings, setSmartLinksClassSettings] = useState({}); // Per-class settings for Smart Links;
  // Training options
  const [showTrainingOptions, setShowTrainingOptions] = useState(false);
  const [trainingModelTitle, setTrainingModelTitle] = useState('');
  const [addToExistingModel, setAddToExistingModel] = useState(null); // model ID or null for new
  const [selectedObject, setSelectedObject] = useState(null);
  const [showObjectEditDialog, setShowObjectEditDialog] = useState(false);
  const [objectImagePreview, setObjectImagePreview] = useState(null);
  const [showSearchPanel, setShowSearchPanel] = useState(initialShowSearchPanel);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState('all'); // 'current', 'folder', 'all'
  const [searchPageScope, setSearchPageScope] = useState('all'); // 'current' or 'all' pages within document
  const [hiddenClasses, setHiddenClasses] = useState(() => {
    // Initialize from sessionStorage to persist filter state across navigation
    try {
      const saved = sessionStorage.getItem(`hiddenClasses_${projectId}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [hideLabels, setHideLabels] = useState(true);
  const [highlightedObjectId, setHighlightedObjectId] = useState(null);
  const [objectViewMode, setObjectViewMode] = useState('subclass'); // 'parent' or 'subclass'
  const [collapsedResultClasses, setCollapsedResultClasses] = useState(new Set());
  
  // Hierarchical training state
  const [hierarchicalTrainingMode, setHierarchicalTrainingMode] = useState(false);
  const [parentClassForTraining, setParentClassForTraining] = useState(null);
  const [showSubclassTrainingDialog, setShowSubclassTrainingDialog] = useState(false);
  const [pendingParentDetections, setPendingParentDetections] = useState([]);
  const [currentParentDetection, setCurrentParentDetection] = useState(null);
  const [subclassTrainingStep, setSubclassTrainingStep] = useState(0); // Which detection we're on
  const [subclassMode, setSubclassMode] = useState('ocr'); // 'ocr' or 'manual'
  
  // Subclass region training - for marking where subclass identifier appears within parent
  const [pendingParentBox, setPendingParentBox] = useState(null); // The parent box awaiting subclass region
  const [subclassRegions, setSubclassRegions] = useState({}); // Map of subclass name -> region
  const [currentSubclassIndex, setCurrentSubclassIndex] = useState(0); // Which subclass we're marking
  const [isDrawingSubclassRegion, setIsDrawingSubclassRegion] = useState(false);
  const [showSubclassRegionDialog, setShowSubclassRegionDialog] = useState(false);
  const [parentBoxImage, setParentBoxImage] = useState(null); // Cropped image of parent box
  const [subclassDrawStart, setSubclassDrawStart] = useState(null);
  const [subclassCurrentRect, setSubclassCurrentRect] = useState(null);
  const [subclassDialogSize, setSubclassDialogSize] = useState({ width: 600, height: 700 });
  const [isResizingDialog, setIsResizingDialog] = useState(false);
  const [subclassImageZoom, setSubclassImageZoom] = useState(1.0);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const subclassCanvasRef = useRef(null);
  const subclassDialogRef = useRef(null);

  
  // Track the ID of selected PDF annotation - only this triggers re-renders, not position changes
  const [editingPdfAnnotationId, setEditingPdfAnnotationId] = useState(null);
  
  // Track which PDF annotations we've "taken over" (clicked in edit mode)
  // These have been deleted from PDF.js rendering, we render them in SVG
  const [ownedPdfAnnotationIds, setOwnedPdfAnnotationIds] = useState(new Set());
  
  // Store the original PDF bytes for modification
  const originalPdfBytesRef = useRef(null);
  // Store the current (potentially modified) PDF bytes
  const currentPdfBytesRef = useRef(null);
  
  // Save background color to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem('pdfBackgroundColor', pdfBackgroundColor);
    } catch (e) {
      console.warn('Could not save background color to localStorage:', e);
    }
  }, [pdfBackgroundColor]);
  
  // Save showMarkupToolbar to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem('showMarkupToolbar', showMarkupToolbar.toString());
    } catch (e) {
      console.warn('Could not save showMarkupToolbar to localStorage:', e);
    }
  }, [showMarkupToolbar]);
  
  // Browser zoom prevention is handled by useZoomPan hook

  // Keep zoom settings ref in sync with state
  useEffect(() => {
    zoomSettingsRef.current = zoomSettings;
  }, [zoomSettings]);

  // Update editingPdfAnnotationId only when selection changes (not during drag)
  useEffect(() => {
    const newId = (selectedMarkup?.fromPdf && markupEditMode) ? selectedMarkup.id : null;
    if (newId !== editingPdfAnnotationId) {
      setEditingPdfAnnotationId(newId);
    }
  }, [selectedMarkup?.id, selectedMarkup?.fromPdf, markupEditMode, editingPdfAnnotationId]);
  
  // Function to take ownership of a PDF annotation (delete from PDF, render in SVG)
  const takeOwnershipOfAnnotation = useCallback(async (annotationId) => {
    if (!annotationId || ownedPdfAnnotationIds.has(annotationId)) {
      return; // Already owned or invalid
    }
    
    const pdfBytes = currentPdfBytesRef.current || originalPdfBytesRef.current;
    if (!pdfBytes) {
      console.warn('No PDF bytes available for annotation deletion');
      return;
    }
    
    // Add to owned set immediately for UI responsiveness
    const newOwnedIds = new Set(ownedPdfAnnotationIds);
    newOwnedIds.add(annotationId);
    setOwnedPdfAnnotationIds(newOwnedIds);
    
    // Delete annotation from PDF
    const modifiedBytes = await deleteAnnotationsFromPdf(pdfBytes, newOwnedIds);
    
    if (modifiedBytes) {
      currentPdfBytesRef.current = modifiedBytes;
      
      // Reload PDF.js with modified PDF
      const blob = new Blob([modifiedBytes], { type: 'application/pdf' });
      const newUrl = URL.createObjectURL(blob);
      
      // Store old URL to revoke
      const oldUrl = modifiedPdfUrlRef.current;
      modifiedPdfUrlRef.current = newUrl;
      
      // Load the modified PDF using window.pdfjsLib
      try {
        const loadingTask = window.pdfjsLib.getDocument({ url: newUrl, verbosity: 0 });
        const newPdfDoc = await loadingTask.promise;
        setPdfDoc(newPdfDoc);
        setNumPages(newPdfDoc.numPages);
        
        // Clear rendered pages to force re-render
        resetRenderedPages();
        
        console.log('PDF reloaded after deleting annotation:', annotationId);
      } catch (error) {
        console.error('Error reloading PDF after annotation deletion:', error);
      }
      
      // Revoke old URL
      if (oldUrl) {
        URL.revokeObjectURL(oldUrl);
      }
    }
  }, [ownedPdfAnnotationIds]);
  
  // Ref to store modified PDF URL for cleanup
  const modifiedPdfUrlRef = useRef(null);
  
  // Clean up modified PDF URL on unmount
  useEffect(() => {
    return () => {
      if (modifiedPdfUrlRef.current) {
        URL.revokeObjectURL(modifiedPdfUrlRef.current);
      }
    };
  }, []);
  
  // Shared delete handler: removes markup from state, tracks PDF deletions,
  // and reloads the PDF so canvas-rendered annotations disappear.
  // Used by both keyboard Delete and Markup History Panel delete button.
  const deleteMarkupFull = useCallback(async (markupsToDelete) => {
    if (!markupsToDelete || markupsToDelete.length === 0) return;
    
    // Save history for undo
    setMarkupHistory(prev => [...prev.slice(-49), markups]);
    setMarkupFuture([]);
    
    const idsToDelete = new Set(markupsToDelete.map(m => m.id));
    
    // Track deleted PDF annotations (for save)
    const pdfMarkups = markupsToDelete.filter(m => m.fromPdf && m.pdfAnnotId);
    if (pdfMarkups.length > 0) {
      setDeletedPdfAnnotations(prev => {
        const next = new Map(prev);
        pdfMarkups.forEach(m => {
          const filename = m.filename;
          if (!next.has(filename)) next.set(filename, new Set());
          next.get(filename).add(m.pdfAnnotId);
        });
        return next;
      });
    }
    
    // Remove from state
    setMarkups(prev => prev.filter(mk => !idsToDelete.has(mk.id)));
    if (selectedMarkup && idsToDelete.has(selectedMarkup.id)) {
      setSelectedMarkup(null);
      selectedMarkupRef.current = null;
    }
    setSelectedMarkups(prev => prev.filter(mk => !idsToDelete.has(mk.id)));
    selectedMarkupsRef.current = selectedMarkupsRef.current.filter(mk => !idsToDelete.has(mk.id));
    
    // For PDF-origin markups: delete from PDF bytes and reload so canvas clears
    const hasPdfMarkups = markupsToDelete.some(m => m.fromPdf);
    if (hasPdfMarkups) {
      const pdfBytes = currentPdfBytesRef.current || originalPdfBytesRef.current;
      if (pdfBytes) {
        try {
          const idsToRemove = new Set(ownedPdfAnnotationIds);
          markupsToDelete.forEach(m => { if (m.fromPdf && m.id) idsToRemove.add(m.id); });
          
          const modifiedBytes = await deleteAnnotationsFromPdf(pdfBytes, idsToRemove);
          if (modifiedBytes) {
            currentPdfBytesRef.current = modifiedBytes;
            
            const blob = new Blob([modifiedBytes], { type: 'application/pdf' });
            const newUrl = URL.createObjectURL(blob);
            const oldUrl = modifiedPdfUrlRef.current;
            modifiedPdfUrlRef.current = newUrl;
            
            const loadingTask = window.pdfjsLib.getDocument({ url: newUrl, verbosity: 0 });
            const newPdfDoc = await loadingTask.promise;
            setPdfDoc(newPdfDoc);
            setNumPages(newPdfDoc.numPages);
            resetRenderedPages();
            
            if (oldUrl) URL.revokeObjectURL(oldUrl);
            console.log('PDF reloaded after deleting', markupsToDelete.length, 'markup(s)');
          }
        } catch (err) {
          console.warn('Failed to delete annotations from PDF:', err);
        }
      }
    }
  }, [markups, selectedMarkup, ownedPdfAnnotationIds]);
  
  // Clear owned annotations when file changes
  useEffect(() => {
    setOwnedPdfAnnotationIds(new Set());
    originalPdfBytesRef.current = null;
    currentPdfBytesRef.current = null;
    if (modifiedPdfUrlRef.current) {
      URL.revokeObjectURL(modifiedPdfUrlRef.current);
      modifiedPdfUrlRef.current = null;
    }
  }, [currentFile]);
  
  const [isDrawingSelectionBox, setIsDrawingSelectionBox] = useState(false); // Drawing selection box
  const [selectionBox, setSelectionBox] = useState(null); // {startX, startY, endX, endY} normalized
  const [isDrawingZoomBox, setIsDrawingZoomBox] = useState(false); // Drawing zoom area box
  const [zoomBox, setZoomBox] = useState(null); // {startX, startY, endX, endY} normalized for zoom-to-area
  
  const zoomBoxRef = useRef(null);
  
  
  // Generate custom cursor for pen tool - pen icon that scales with stroke width
  // Generate custom cursor for highlighter tool - highlighter icon that scales with stroke width
  // Persist hiddenClasses to sessionStorage when it changes
  useEffect(() => {
    try {
      sessionStorage.setItem(`hiddenClasses_${projectId}`, JSON.stringify(hiddenClasses));
    } catch (e) {
      console.warn('Failed to save hiddenClasses:', e);
    }
  }, [hiddenClasses, projectId]);

  // Persist showRegionBoxes to sessionStorage when it changes
  useEffect(() => {
    try {
      sessionStorage.setItem(`showRegionBoxes_${projectId}`, JSON.stringify(showRegionBoxes));
    } catch (e) {
      console.warn('Failed to save showRegionBoxes:', e);
    }
  }, [showRegionBoxes, projectId]);

  // Save objects panel models section height to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('objectsPanelModelsHeight', objectsPanelModelsHeight.toString());
    } catch (e) {
      console.warn('Failed to save objectsPanelModelsHeight:', e);
    }
  }, [objectsPanelModelsHeight]);

  // Save links panel models section height to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('linksPanelModelsHeight', linksPanelModelsHeight.toString());
    } catch (e) {
      console.warn('Failed to save linksPanelModelsHeight:', e);
    }
  }, [linksPanelModelsHeight]);

  // Smooth animation for Object detection progress bar
  useEffect(() => {
    if (!detectionProgress.phase) {
      setDetectionDisplayPercent(0);
      return;
    }
    
    const targetPercent = detectionProgress.percent;
    
    // Animate toward target
    const interval = setInterval(() => {
      setDetectionDisplayPercent(current => {
        if (current >= targetPercent) {
          return targetPercent;
        }
        // Move 2% closer each tick, or jump if very close
        const diff = targetPercent - current;
        const step = Math.max(0.5, diff * 0.15);
        return Math.min(current + step, targetPercent);
      });
    }, 50);
    
    return () => clearInterval(interval);
  }, [detectionProgress.phase, detectionProgress.percent]);

  // Smooth animation for Smart Links progress bar
  useEffect(() => {
    if (!smartLinksProgress.phase) {
      setSmartLinksDisplayPercent(0);
      return;
    }
    
    const targetPercent = smartLinksProgress.percent;
    
    // Animate toward target
    const interval = setInterval(() => {
      setSmartLinksDisplayPercent(current => {
        if (current >= targetPercent) {
          return targetPercent;
        }
        // Move 2% closer each tick, or jump if very close
        const diff = targetPercent - current;
        const step = Math.max(0.5, diff * 0.15);
        return Math.min(current + step, targetPercent);
      });
    }, 50);
    
    return () => clearInterval(interval);
  }, [smartLinksProgress.phase, smartLinksProgress.percent]);

  
  const annotationLayerRef = useRef(null); // Reserved for future annotation layer use
  const isSavingDetectedObjectsRef = useRef(false);
  const polylineClickTimeoutRef = useRef(null); // For distinguishing single/double clicks in polyline mode
  const pdfLoadingTaskRef = useRef(null); // Track PDF.js loading task for cancellation

  // Report panel state changes to parent component
  useEffect(() => {
    if (onPanelStateChange) {
      onPanelStateChange({
        search: showSearchPanel,
        objectFinder: showObjectFinder,
        smartLinks: showSmartLinks,
        view: showViewPanel,
        ocr: showOcrPanel
      });
    }
  }, [showSearchPanel, showObjectFinder, showSmartLinks, showViewPanel, showOcrPanel, onPanelStateChange]);

  // Performance: Visible pages are now tracked by position-based scroll handler (see below)
  // This avoids expensive DOM queries (getBoundingClientRect) on every scroll event

  // Helper functions for class hierarchy
  const getSubclassesOf = useCallback((parentId) => {
    return (project?.classes || []).filter(c => c.parentId === parentId);
  }, [project?.classes]);

  const getClassById = useCallback((classId) => {
    return (project?.classes || []).find(c => c.id === classId);
  }, [project?.classes]);

  const getClassByName = useCallback((name) => {
    return (project?.classes || []).find(c => c.name === name);
  }, [project?.classes]);

  const hasSubclasses = useCallback((classId) => {
    return getSubclassesOf(classId).length > 0;
  }, [getSubclassesOf]);

  const getFullClassPath = useCallback((cls) => {
    if (!cls) return '';
    const path = [cls.name];
    let current = cls;
    while (current.parentId) {
      const parent = getClassById(current.parentId);
      if (parent) {
        path.unshift(parent.name);
        current = parent;
      } else {
        break;
      }
    }
    return path.join(' > ');
  }, [getClassById]);

  // Get color for a class from project settings (legacy - returns single color)
  const getClassColor = useCallback((classNameOrNames) => {
    // Accept single name or array of names to try
    const namesToTry = Array.isArray(classNameOrNames) 
      ? classNameOrNames.filter(Boolean) 
      : [classNameOrNames].filter(Boolean);
    
    if (namesToTry.length === 0) return '#3498db';
    
    const classes = project?.classes || [];
    const colors = project?.classColors || {};
    
    // Helper to generate hash-based color
    const getHashColor = (name) => {
      const defaultColors = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];
      let hash = 0;
      for (let i = 0; i < (name || '').length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
      }
      return defaultColors[Math.abs(hash) % defaultColors.length];
    };
    
    // Try each name
    for (const className of namesToTry) {
      // Try exact match in project.classes FIRST - prefer root classes (no parentId) since they have the color
      let cls = classes.find(c => c.name === className && !c.parentId);
      
      // If not found as root, try any match
      if (!cls) {
        cls = classes.find(c => c.name === className);
      }
      
      // If not found, try matching the first part of a path
      if (!cls && className.includes(' > ')) {
        const parentName = className.split(' > ')[0];
        cls = classes.find(c => c.name === parentName && !c.parentId);
      }
      
      // If still not found, try case-insensitive match
      if (!cls) {
        cls = classes.find(c => c.name?.toLowerCase() === className?.toLowerCase());
      }
      
      // If found in project.classes, return its color
      if (cls?.color) {
        return cls.color;
      }
      
      // Fall back to legacy classColors map
      if (colors[className]) {
        return colors[className];
      }
      
      // If class found but no color, generate one
      if (cls) {
        return getHashColor(cls.name);
      }
    }
    
    // Generate a consistent default color based on first name
    return getHashColor(namesToTry[0]);
  }, [project?.classColors, project?.classes]);

  // Get fill and border colors separately for a class
  const getClassColors = useCallback((classNameOrNames) => {
    const namesToTry = Array.isArray(classNameOrNames) 
      ? classNameOrNames.filter(Boolean) 
      : [classNameOrNames].filter(Boolean);
    
    const defaultColor = '#3498db';
    if (namesToTry.length === 0) return { fillColor: defaultColor, borderColor: defaultColor };
    
    const classes = project?.classes || [];
    const colors = project?.classColors || {};
    
    const getHashColor = (name) => {
      const defaultColors = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];
      let hash = 0;
      for (let i = 0; i < (name || '').length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
      }
      return defaultColors[Math.abs(hash) % defaultColors.length];
    };
    
    for (const className of namesToTry) {
      let cls = classes.find(c => c.name === className && !c.parentId);
      if (!cls) cls = classes.find(c => c.name === className);
      if (!cls && className.includes(' > ')) {
        const parentName = className.split(' > ')[0];
        cls = classes.find(c => c.name === parentName && !c.parentId);
      }
      if (!cls) cls = classes.find(c => c.name?.toLowerCase() === className?.toLowerCase());
      
      if (cls) {
        // Use new fillColor/borderColor if set, otherwise fall back to legacy 'color'
        const legacyColor = cls.color || colors[className] || getHashColor(cls.name);
        return {
          fillColor: cls.fillColor !== undefined ? cls.fillColor : legacyColor,
          borderColor: cls.borderColor !== undefined ? cls.borderColor : legacyColor
        };
      }
      
      if (colors[className]) {
        return { fillColor: colors[className], borderColor: colors[className] };
      }
    }
    
    const hashColor = getHashColor(namesToTry[0]);
    return { fillColor: hashColor, borderColor: hashColor };
  }, [project?.classColors, project?.classes]);

  // Get colors for a region type
  const getRegionTypeColors = useCallback((regionTypeName) => {
    const defaultColor = '#9b59b6';
    if (!regionTypeName) return { fillColor: defaultColor, borderColor: defaultColor };
    
    const regionTypes = project?.regionTypes || [];
    const rt = regionTypes.find(r => r.name === regionTypeName);
    
    if (rt) {
      return {
        fillColor: rt.fillColor !== undefined ? rt.fillColor : defaultColor,
        borderColor: rt.borderColor !== undefined ? rt.borderColor : defaultColor
      };
    }
    
    return { fillColor: defaultColor, borderColor: defaultColor };
  }, [project?.regionTypes]);

  // Get colors for a sub-region (checks existing regions first, then falls back to region type)
  const getSubRegionColorsForDialog = useCallback((regionTypeName, subRegionName) => {
    const defaultColor = '#3498db';
    if (!regionTypeName || !subRegionName) {
      // Fall back to region type colors
      const rtColors = getRegionTypeColors(regionTypeName);
      return {
        fillColor: rtColors.fillColor !== 'none' ? rtColors.fillColor : defaultColor,
        borderColor: rtColors.borderColor !== 'none' ? rtColors.borderColor : defaultColor
      };
    }
    
    // Check if there's an existing region with this name
    const existingRegion = drawnRegions.find(
      r => r.subRegionName === subRegionName && r.regionType === regionTypeName
    );
    
    if (existingRegion && (existingRegion.fillColor !== undefined || existingRegion.borderColor !== undefined)) {
      return {
        fillColor: existingRegion.fillColor !== undefined && existingRegion.fillColor !== 'none' 
          ? existingRegion.fillColor : defaultColor,
        borderColor: existingRegion.borderColor !== undefined && existingRegion.borderColor !== 'none'
          ? existingRegion.borderColor : defaultColor
      };
    }
    
    // Fall back to region type colors
    const rtColors = getRegionTypeColors(regionTypeName);
    return {
      fillColor: rtColors.fillColor !== 'none' ? rtColors.fillColor : defaultColor,
      borderColor: rtColors.borderColor !== 'none' ? rtColors.borderColor : defaultColor
    };
  }, [drawnRegions, getRegionTypeColors]);

  // Get shape type for a class (from class definition)
  const getClassShapeType = useCallback((classNameOrNames) => {
    // Accept single name or array of names to try
    const namesToTry = Array.isArray(classNameOrNames) 
      ? classNameOrNames.filter(Boolean) 
      : [classNameOrNames].filter(Boolean);
    
    if (namesToTry.length === 0) return 'rectangle';
    
    const classes = project?.classes || [];
    
    // Try each name
    for (const className of namesToTry) {
      // Try exact match first
      let cls = classes.find(c => c.name === className);
      
      // If not found, try matching the first part of a path
      if (!cls && className.includes(' > ')) {
        const parentName = className.split(' > ')[0];
        cls = classes.find(c => c.name === parentName);
      }
      
      // If still not found, try case-insensitive match
      if (!cls) {
        cls = classes.find(c => c.name?.toLowerCase() === className?.toLowerCase());
      }
      
      if (cls?.shapeType) return cls.shapeType;
    }
    
    return 'rectangle';
  }, [project?.classes]);

  // ============ LOCAL FILE HANDLING ============
  // Track temporary backend filenames for local files (uploaded on-demand for detection)
  const [tempBackendFiles, setTempBackendFiles] = useState({}); // localFileId -> backendFilename
  
  // Performance: Pre-index markups by page to avoid O(pages × markups) filtering
  const markupsByPageIndex = useMemo(() => {
    const index = new Map();
    markups.forEach(m => {
      if (m.filename !== currentFileIdentifier) return;
      const page = m.page; // 0-indexed
      if (!index.has(page)) index.set(page, []);
      index.get(page).push(m);
    });
    return index;
  }, [markups, currentFileIdentifier]);

  // Performance: Compute cumulative page layout positions for virtualization
  // continuousLayout memo and scrollToPagePosition are now in useContinuousLayout hook
  
  // Save notification state — { type: 'success'|'error', message: string } or null
  const [saveNotification, setSaveNotification] = useState(null);
  const saveNotifTimerRef = useRef(null);

  // ensureFileOnBackend, getEffectiveBackendFilename, and all save/export logic
  const {
    saveMarkupsToPdf, saveMarkupsClientSide,
    downloadPdfWithMarkups, downloadFlattenedPdf,
    saveToOriginalFile,
    ensureFileOnBackend, getEffectiveBackendFilename,
  } = useSaveMarkups({
    markups, currentFile, currentFileIdentifier, canvasSize,
    pdfDoc, currentPage, pdfUrl, deletedPdfAnnotations,
    tempBackendFiles, canvasRef,
    currentPdfBytesRef, originalPdfBytesRef, modifiedPdfUrlRef,
    resetRenderedPages,
    setMarkups, setPdfDoc, setNumPages, setIsSavingMarkups,
    setUnsavedMarkupFiles, setDeletedPdfAnnotations,
    setHasLoadedAnnotations, setOwnedPdfAnnotationIds, setTempBackendFiles,
    onRegisterSaveHandler, onRegisterDownloadHandler,
    setSaveNotification, saveNotifTimerRef,
  });

  // Calculate current folder info for scope dropdowns
  const currentFolderInfo = useMemo(() => {
    // For local files, folder-based detection scopes aren't supported yet
    // (local files need to be uploaded first for multi-file detection)
    if (currentFile?.isLocal) {
      return { folder: null, parent: null, folderFileCount: 0, parentFileCount: 0, totalFileCount: 0, isLocalFile: true };
    }
    
    if (!currentFile?.backendFilename || !project?.folders) {
      return { folder: null, parent: null, folderFileCount: 0, parentFileCount: 0, totalFileCount: 0 };
    }
    
    // Helper to find folder containing file
    const findFolderContainingFile = (folders, backendFilename, parent = null) => {
      for (const folder of folders) {
        if (folder.files?.some(f => f.backendFilename === backendFilename)) {
          return { folder, parent };
        }
        if (folder.subfolders?.length > 0) {
          const found = findFolderContainingFile(folder.subfolders, backendFilename, folder);
          if (found) return found;
        }
      }
      return null;
    };
    
    // Helper to count all files in folder including subfolders
    const countFilesInFolder = (folder) => {
      let count = folder.files?.length || 0;
      if (folder.subfolders) {
        folder.subfolders.forEach(sub => {
          count += countFilesInFolder(sub);
        });
      }
      return count;
    };
    
    // Helper to count all files in project
    const countAllFiles = (folders) => {
      let count = 0;
      folders.forEach(folder => {
        count += countFilesInFolder(folder);
      });
      return count;
    };
    
    const result = findFolderContainingFile(project.folders, currentFile.backendFilename);
    const folderFileCount = result?.folder?.files?.length || 0;
    const parentFileCount = result?.parent ? countFilesInFolder(result.parent) : 
                           result?.folder ? countFilesInFolder(result.folder) : 0;
    const totalFileCount = countAllFiles(project.folders);
    
    return {
      folder: result?.folder || null,
      parent: result?.parent || null,
      folderFileCount,
      parentFileCount,
      totalFileCount
    };
  }, [currentFile?.backendFilename, project?.folders]);

  // Zoom settle debounce, scroll restore, and CSS-transform commit effects
  // are all handled by useZoomPan hook

  // Load PDF.js
  useEffect(() => {
    if (!window.pdfjsLib) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.async = true;
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      };
      document.head.appendChild(script);
      
      // Load annotation layer CSS
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf_viewer.min.css';
      document.head.appendChild(link);
    }
  }, []);

  // Load hotspots from project
  useEffect(() => {
    if (currentFile && project) {
      const fileHotspots = project.hotspots?.[currentFile.id] || [];
      setHotspots(fileHotspots);
    } else {
      setHotspots([]);
    }
  }, [currentFile, project]);

  // Performance: Prefetch adjacent PDFs for faster switching
  const prefetchedFilesRef = useRef(new Set()); // Track what we've already prefetched
  useEffect(() => {
    if (!currentFile?.backendFilename || !currentFolderInfo.folder?.files) return;
    
    const files = currentFolderInfo.folder.files;
    const currentIndex = files.findIndex(f => f.id === currentFile.id);
    if (currentIndex === -1) return;
    
    // Prefetch next and previous files (low priority)
    const filesToPrefetch = [];
    if (currentIndex > 0 && files[currentIndex - 1]?.backendFilename) {
      const prevFile = files[currentIndex - 1].backendFilename;
      if (!prefetchedFilesRef.current.has(prevFile)) {
        filesToPrefetch.push(prevFile);
      }
    }
    if (currentIndex < files.length - 1 && files[currentIndex + 1]?.backendFilename) {
      const nextFile = files[currentIndex + 1].backendFilename;
      if (!prefetchedFilesRef.current.has(nextFile)) {
        filesToPrefetch.push(nextFile);
      }
    }
    
    if (filesToPrefetch.length === 0) return;
    
    // Use requestIdleCallback if available, otherwise setTimeout
    const prefetch = () => {
      filesToPrefetch.forEach(filename => {
        prefetchedFilesRef.current.add(filename);
        // Prefetch into cache - errors are silently ignored
        getPdfFromBackend(filename).catch(() => {
          // Remove from prefetched set on error so it can be retried
          prefetchedFilesRef.current.delete(filename);
        });
      });
    };
    
    if ('requestIdleCallback' in window) {
      const idleId = requestIdleCallback(prefetch, { timeout: 2000 });
      return () => cancelIdleCallback(idleId);
    } else {
      const timeoutId = setTimeout(prefetch, 500);
      return () => clearTimeout(timeoutId);
    }
  }, [currentFile?.id, currentFile?.backendFilename]);

  // Handle dialog resize
  useEffect(() => {
    if (!isResizingDialog) return;
    
    const handleMouseMove = (e) => {
      const dx = e.clientX - resizeStart.x;
      const dy = e.clientY - resizeStart.y;
      
      let newWidth = resizeStart.width;
      let newHeight = resizeStart.height;
      
      if (resizeStart.direction === 'e' || resizeStart.direction === 'se') {
        newWidth = Math.max(400, Math.min(window.innerWidth * 0.95, resizeStart.width + dx));
      }
      if (resizeStart.direction === 's' || resizeStart.direction === 'se') {
        newHeight = Math.max(400, Math.min(window.innerHeight * 0.95, resizeStart.height + dy));
      }
      
      setSubclassDialogSize({ width: newWidth, height: newHeight });
    };
    
    const handleMouseUp = () => {
      setIsResizingDialog(false);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingDialog, resizeStart]);

  // Track shift key for polyline snap
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Shift') setIsShiftPressed(true);
      if (e.key === 'Escape') {
        if (pendingShape) {
          setPendingShape(null);
        }
        if (polylinePoints.length > 0) {
          setPolylinePoints([]);
          setPolylineMousePos(null);
          setIsNearStartPoint(false);
        }
      }
    };
    const handleKeyUp = (e) => {
      if (e.key === 'Shift') setIsShiftPressed(false);
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [pendingShape]);

  // Handle shape resize
  useEffect(() => {
    if (!activeResizeHandle || !pendingShape) return;
    
    const handleMouseMove = (e) => {
      if (!canvasRef.current) return;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left) / scale / canvasSize.width;
      const mouseY = (e.clientY - rect.top) / scale / canvasSize.height;
      
      setPendingShape(prev => {
        let { x, y, width, height } = prev;
        const right = x + width;
        const bottom = y + height;
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const isCircle = prev.shapeType === 'circle';
        
        switch (activeResizeHandle) {
          case 'nw': x = mouseX; y = mouseY; width = right - mouseX; height = bottom - mouseY; break;
          case 'n': y = mouseY; height = bottom - mouseY; break;
          case 'ne': y = mouseY; width = mouseX - x; height = bottom - mouseY; break;
          case 'e': width = mouseX - x; break;
          case 'se': width = mouseX - x; height = mouseY - y; break;
          case 's': height = mouseY - y; break;
          case 'sw': x = mouseX; width = right - mouseX; height = mouseY - y; break;
          case 'w': x = mouseX; width = right - mouseX; break;
        }
        
        // Ensure minimum size
        if (width < 0.01) { width = 0.01; }
        if (height < 0.01) { height = 0.01; }
        
        // For circles, maintain equal PIXEL dimensions (not normalized)
        if (isCircle) {
          // Convert to pixels to find the larger dimension
          const widthPx = width * canvasSize.width;
          const heightPx = height * canvasSize.height;
          const maxPx = Math.max(widthPx, heightPx);
          
          // Convert back to normalized coords
          const newWidth = maxPx / canvasSize.width;
          const newHeight = maxPx / canvasSize.height;
          
          // Anchor based on handle
          if (activeResizeHandle === 'nw') {
            x = right - newWidth;
            y = bottom - newHeight;
          } else if (activeResizeHandle === 'ne') {
            y = bottom - newHeight;
          } else if (activeResizeHandle === 'sw') {
            x = right - newWidth;
          } else if (activeResizeHandle === 'se') {
            // Anchor is top-left, nothing to adjust
          } else if (activeResizeHandle === 'n') {
            x = centerX - newWidth / 2;
            y = bottom - newHeight;
          } else if (activeResizeHandle === 's') {
            x = centerX - newWidth / 2;
          } else if (activeResizeHandle === 'e') {
            y = centerY - newHeight / 2;
          } else if (activeResizeHandle === 'w') {
            x = right - newWidth;
            y = centerY - newHeight / 2;
          }
          
          width = newWidth;
          height = newHeight;
        }
        
        return { ...prev, x, y, width, height };
      });
    };
    
    const handleMouseUp = () => {
      setActiveResizeHandle(null);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeResizeHandle, pendingShape, scale, canvasSize]);

  // Handle arc handle dragging (for selected arc markup)
  useEffect(() => {
    if (!activeArcHandle || !selectedMarkup || selectedMarkup.type !== 'arc') return;
    
    const handleMouseMove = (e) => {
      if (!canvasRef.current) return;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left) / scale / canvasSize.width;
      const mouseY = (e.clientY - rect.top) / scale / canvasSize.height;
      
      setMarkups(prevMarkups => prevMarkups.map(m => {
        if (m.id !== selectedMarkup.id) return m;
        
        const updated = { ...m, modified: true };
        
        if (activeArcHandle === 'point1') {
          updated.point1X = mouseX;
          updated.point1Y = mouseY;
        } else if (activeArcHandle === 'point2') {
          updated.point2X = mouseX;
          updated.point2Y = mouseY;
        } else if (activeArcHandle === 'bulge') {
          // Calculate bulge from mouse position
          const p1x = m.point1X;
          const p1y = m.point1Y;
          const p2x = m.point2X;
          const p2y = m.point2Y;
          
          const midX = (p1x + p2x) / 2;
          const midY = (p1y + p2y) / 2;
          const chordDx = p2x - p1x;
          const chordDy = p2y - p1y;
          const chordLen = Math.sqrt(chordDx * chordDx + chordDy * chordDy);
          
          if (chordLen > 0.001) {
            // Perpendicular unit vector
            const perpX = -chordDy / chordLen;
            const perpY = chordDx / chordLen;
            
            // Project mouse position onto perpendicular direction
            const dmx = mouseX - midX;
            const dmy = mouseY - midY;
            const projDist = dmx * perpX + dmy * perpY;
            
            // Convert to bulge factor (distance / chordLen)
            updated.arcBulge = projDist / chordLen;
          }
        }
        
        return updated;
      }));
      
      // Also update selectedMarkup reference
      setSelectedMarkup(prev => {
        if (!prev || prev.id !== selectedMarkup.id) return prev;
        const updated = { ...prev };
        if (activeArcHandle === 'point1') {
          updated.point1X = mouseX;
          updated.point1Y = mouseY;
        } else if (activeArcHandle === 'point2') {
          updated.point2X = mouseX;
          updated.point2Y = mouseY;
        } else if (activeArcHandle === 'bulge') {
          const p1x = prev.point1X;
          const p1y = prev.point1Y;
          const p2x = prev.point2X;
          const p2y = prev.point2Y;
          const midX = (p1x + p2x) / 2;
          const midY = (p1y + p2y) / 2;
          const chordDx = p2x - p1x;
          const chordDy = p2y - p1y;
          const chordLen = Math.sqrt(chordDx * chordDx + chordDy * chordDy);
          if (chordLen > 0.001) {
            const perpX = -chordDy / chordLen;
            const perpY = chordDx / chordLen;
            const dmx = mouseX - midX;
            const dmy = mouseY - midY;
            updated.arcBulge = (dmx * perpX + dmy * perpY) / chordLen;
          }
        }
        return updated;
      });
    };
    
    const handleMouseUp = () => {
      setActiveArcHandle(null);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeArcHandle, selectedMarkup, scale, canvasSize]);

  // Load models from backend
  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      const models = await getModels(project?.id);
      // Filter to only show 'Smart Link' type models in Smart Links
      setSavedModels(models.filter(m => m.modelType === 'Smart Link'));
    } catch (error) {
      console.error('Error loading models:', error);
    }
  };

  // Load PDF when URL changes
  useEffect(() => {
    if (pdfUrl && window.pdfjsLib) {
      loadPdf(pdfUrl);
      // Reset to zoom mode briefly when loading new PDF, then switch to pan
      setZoomMode(true);
      setPanMode(false);
      
      // After a short delay, switch to pan mode
      const timer = setTimeout(() => {
        setZoomMode(false);
        setSelectMode(false);
        setPanMode(true);
      }, 100);
      
      return () => {
        clearTimeout(timer);
        // Cancel any pending PDF load when URL changes or component unmounts
        if (pdfLoadingTaskRef.current) {
          try {
            pdfLoadingTaskRef.current.destroy();
          } catch (e) {
            // Ignore cancellation errors
          }
          pdfLoadingTaskRef.current = null;
        }
      };
    } else {
      setPdfDoc(null);
      setNumPages(0);
      setCurrentPage(1);
    }
  }, [pdfUrl]);

  // Track unsaved markup changes per file
  useEffect(() => {
    // Get all unique file identifiers that have markups
    const filesWithMarkups = new Set();
    markups.forEach(m => {
      if (m.filename && ((!m.fromPdf && !m.savedAt) || m.modified)) {
        // This file has new (unsaved) or modified markups
        filesWithMarkups.add(m.filename);
      }
    });
    
    // Also include files that have deleted PDF annotations
    if (deletedPdfAnnotations.size > 0) {
      for (const filename of deletedPdfAnnotations.keys()) {
        filesWithMarkups.add(filename);
      }
    }
    
    // Update unsaved files state
    setUnsavedMarkupFiles(filesWithMarkups);
    
    // Notify parent component if callback provided
    if (onUnsavedChangesUpdate) {
      onUnsavedChangesUpdate(filesWithMarkups);
    }
  }, [markups, deletedPdfAnnotations, onUnsavedChangesUpdate]);

  // Warn user before leaving if there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (unsavedMarkupFiles.size > 0) {
        const message = 'You have unsaved markup changes. Are you sure you want to leave?';
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [unsavedMarkupFiles]);

  // Report saving state to parent
  useEffect(() => {
    if (onSavingStateChange) {
      onSavingStateChange(isSavingMarkups);
    }
  }, [isSavingMarkups, onSavingStateChange]);

  const loadPdf = async (url) => {
    try {
      // Cancel any previous loading task
      if (pdfLoadingTaskRef.current) {
        try {
          pdfLoadingTaskRef.current.destroy();
        } catch (e) {
          // Ignore cancellation errors
        }
        pdfLoadingTaskRef.current = null;
      }
      
      // Fetch PDF bytes for later modification (used when taking ownership of annotations)
      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        originalPdfBytesRef.current = arrayBuffer;
        currentPdfBytesRef.current = arrayBuffer;
      } catch (fetchError) {
        console.warn('Could not fetch PDF bytes for annotation editing:', fetchError);
      }
      
      // Start new loading task
      const loadingTask = window.pdfjsLib.getDocument(url);
      pdfLoadingTaskRef.current = loadingTask;
      
      const pdf = await loadingTask.promise;
      
      // Check if this is still the current loading task (not cancelled)
      if (pdfLoadingTaskRef.current !== loadingTask) {
        // A newer load was started, ignore this result
        return;
      }
      
      setPdfDoc(pdf);
      setNumPages(pdf.numPages);
      // If a navigation is pending, go directly to the target page instead of page 1.
      // This prevents the visible flash to page 1 before navigating to the object.
      const targetPage = navigationTargetPageRef.current;
      if (targetPage !== null && targetPage >= 1 && targetPage <= pdf.numPages) {
        setCurrentPage(targetPage);
        navigationTargetPageRef.current = null;
      } else {
        setCurrentPage(1);
      }
      // Note: Don't reset scale - preserve zoom level when switching files
      setHasLoadedAnnotations(false); // Reset for new PDF
      resetRenderedPages(); // Reset rendered pages tracking
      setOwnedPdfAnnotationIds(new Set()); // Reset owned annotations for new PDF
    } catch (error) {
      // Ignore cancellation errors (status 0 or destroyed)
      if (error?.name === 'UnexpectedResponseException' && error?.status === 0) {
        // PDF load was cancelled (user switched files) - this is expected
        return;
      }
      if (error?.message?.includes('destroyed') || error?.message?.includes('cancelled')) {
        return;
      }
      console.error('Error loading PDF:', error);
    }
  };

  // Load annotations from PDF into our markup state for editing
  // Heavy parsing logic is in pdfAnnotationUtils.js — this is just the state integration wrapper
  const loadAnnotationsFromPdf = useCallback(async () => {
    if (!pdfDoc || !currentFileIdentifier || hasLoadedAnnotations) return;

    // Capture references to detect stale calls after file switch
    const docAtStart = pdfDoc;
    const fileAtStart = currentFileIdentifier;

    try {
      const loadedMarkups = await parseAnnotationsFromPdf({
        pdfDoc: docAtStart,
        currentFile,
        currentFileIdentifier: fileAtStart,
        pdfUrl,
        debugAnnotations: false,
      });

      // If file changed while we were parsing, discard results
      if (currentFileIdentifier !== fileAtStart) return;

      if (loadedMarkups.length > 0) {
        console.log(`Loaded ${loadedMarkups.length} editable annotations from PDF`);
        setMarkups(prev => {
          // Keep user-created markups and modified PDF annotations
          const preserved = prev.filter(m =>
            m.filename !== fileAtStart ||
            !m.fromPdf ||
            m.modified
          );

          const modifiedPdfAnnotIds = new Set(
            preserved.filter(m => m.fromPdf && m.modified && m.pdfAnnotId).map(m => m.pdfAnnotId)
          );
          const existingIds = new Set(preserved.map(m => m.id));

          const newAnnotations = loadedMarkups.filter(m =>
            (!m.pdfAnnotId || !modifiedPdfAnnotIds.has(m.pdfAnnotId)) &&
            !existingIds.has(m.id)
          );

          console.log('Annotation merge:', {
            preserved: preserved.length,
            modifiedPdfAnnotIds: [...modifiedPdfAnnotIds],
            existingIds: existingIds.size,
            newAnnotations: newAnnotations.length,
            filteredOut: loadedMarkups.length - newAnnotations.length
          });

          return [...preserved, ...newAnnotations];
        });

      }

      setHasLoadedAnnotations(true);
    } catch (error) {
      // Ignore errors from destroyed PDF docs (race condition on file switch)
      if (error?.message?.includes('sendWithPromise') || error?.message?.includes('destroyed')) {
        console.log('Annotation loading cancelled (PDF doc replaced)');
        return;
      }
      console.error('Error loading annotations:', error);
      setHasLoadedAnnotations(true);
    }
  }, [pdfDoc, currentFileIdentifier, hasLoadedAnnotations]);

  // Reset annotation loading state when file changes
  useEffect(() => {
    setHasLoadedAnnotations(false);

    // Performance: Hide overlays during file transition
    setOverlaysReady(false);
    if (overlayDelayRef.current) {
      clearTimeout(overlayDelayRef.current);
    }
  }, [currentFileIdentifier]);

  // Performance: Show overlays after PDF is loaded and first render complete
  useEffect(() => {
    if (pdfDoc && currentFileIdentifier && !isLoadingPdf) {
      // Clear any pending delay
      if (overlayDelayRef.current) {
        clearTimeout(overlayDelayRef.current);
      }
      // Small delay to let PDF render first, then show overlays
      overlayDelayRef.current = setTimeout(() => {
        setOverlaysReady(true);
      }, 50); // 50ms - enough for PDF to paint
    }
    
    return () => {
      if (overlayDelayRef.current) {
        clearTimeout(overlayDelayRef.current);
      }
    };
  }, [pdfDoc, currentFileIdentifier, isLoadingPdf]);

  // Auto-load annotations when PDF is ready — since annotationMode is 0 (PDF.js doesn't
  // render annotations on canvas), we must parse them into our markup state so the SVG
  // overlay can display them immediately, even before unlocking.
  useEffect(() => {
    if (pdfDoc && currentFileIdentifier && !hasLoadedAnnotations) {
      loadAnnotationsFromPdf();
    }
  }, [pdfDoc, currentFileIdentifier, hasLoadedAnnotations, loadAnnotationsFromPdf]);

  // Rendering engine (renderPage, renderAllPages, renderSinglePage, dimension prefetching,
  // render triggers, cleanup, etc.) is now handled by usePdfRenderer hook
  
  // Track previous viewMode to detect when switching to continuous
  const prevViewModeRef = useRef(viewMode);
  
  // Scroll to current page when switching to continuous view
  useEffect(() => {
    const prevViewMode = prevViewModeRef.current;
    prevViewModeRef.current = viewMode;
    
    // If we just switched TO any continuous view, scroll to the current page
    if (isContinuousView(viewMode) && !isContinuousView(prevViewMode) && containerRef.current) {
      // CRITICAL: Reset rendered pages tracking - old canvas DOM nodes are gone,
      // new ones need to be rendered fresh
      resetRenderedPages();
      continuousCanvasRefs.current = {};
      
      const cp = currentPageRef.current;
      // Initialize visible pages around current page (wider range for buffer)
      const initialVisible = new Set();
      for (let p = Math.max(1, cp - CONTINUOUS_VIEW_BUFFER); p <= Math.min(numPages, cp + CONTINUOUS_VIEW_BUFFER); p++) {
        initialVisible.add(p);
      }
      visiblePagesRef.current = initialVisible;
      setVisiblePages(initialVisible);
      
      // Small delay to let the DOM render, then use position-based scroll
      setTimeout(() => {
        scrollToPagePosition(cp, 'instant', 'center');
      }, 50);
    }
  }, [viewMode, numPages, scrollToPagePosition]);
  
  // Scroll handler for continuous view is now in useContinuousLayout hook

  // Zoom input text is updated inside useZoomPan hook's useEffect[scale]
  // zoomWithScrollAdjust and handleWheel are now in useZoomPan hook

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        const newScale = Math.min(20, scaleRef.current * 1.5);
        zoomWithScrollAdjust(newScale);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        const newScale = Math.max(0.1, scaleRef.current / 1.5);
        zoomWithScrollAdjust(newScale);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        zoomWithScrollAdjust(1);
      }
      // Shift+M to toggle pan mode
      if (e.shiftKey && (e.key === 'M' || e.key === 'm')) {
        e.preventDefault();
        setPanMode(prev => {
          const newPanMode = !prev;
          if (newPanMode) {
            setZoomMode(false);
          }
          return newPanMode;
        });
      }
      if (e.key === 'Escape') {
        setLinkMode(null);
        setIsDrawing(false);
        setCurrentRect(null);
        setPendingPlacement(null);
        // Cancel assign object/region mode
        if (objectFinderMode) {
          setObjectFinderMode(null);
          setShowDrawTypePopup(false);
          setPendingShape(null);
          setPolylinePoints([]);
          setPolylineMousePos(null);
          setIsNearStartPoint(false);
        }
        if (showDrawTypePopup) {
          setShowDrawTypePopup(false);
        }
      }
      // S key — activate default signature placement (only when not typing in an input)
      if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const tag = e.target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
        if (defaultSignatureId && savedSymbols) {
          const sig = savedSymbols.find(s => s.id === defaultSignatureId);
          if (sig) {
            e.preventDefault();
            // Deselect any current markup/selection
            setSelectedMarkup(null);
            selectedMarkupRef.current = null;
            setSelectedMarkups([]);
            selectedMarkupsRef.current = [];
            // Clear any active markup mode
            setMarkupMode(null);
            setSelectMode(false);
            setPanMode(false);
            setZoomMode(false);
            // Activate placement
            setPendingPlacement({ symbol: sig, isSignature: true });
          }
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [defaultSignatureId, savedSymbols, objectFinderMode, showDrawTypePopup]);

  // Track shift key for polyline snap
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Shift') setIsShiftPressed(true);
      if (e.key === 'Escape') {
        // Clear object training polyline
        if (polylinePoints.length > 0) {
          setPolylinePoints([]);
          setPendingShape(null);
        }
        // Clear markup polyline
        if (cloudPoints.length > 0) {
          setCloudPoints([]);
          setMarkupPolylineMousePos(null);
        }
      }
    };
    const handleKeyUp = (e) => {
      if (e.key === 'Shift') setIsShiftPressed(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      // Clean up any pending RAF
      if (window._polylineRAF) {
        cancelAnimationFrame(window._polylineRAF);
        window._polylineRAF = null;
      }
    };
  }, [polylinePoints, cloudPoints]);
  
  // Clear pending placement when any tool/mode activates
  useEffect(() => {
    if (markupMode || selectMode || panMode || zoomMode) {
      setPendingPlacement(null);
    }
  }, [markupMode, selectMode, panMode, zoomMode]);

  // Clear polyline mouse pos when exiting polyline mode
  useEffect(() => {
    if (markupMode !== 'polyline') {
      setMarkupPolylineMousePos(null);
      if (window._polylineRAF) {
        cancelAnimationFrame(window._polylineRAF);
        window._polylineRAF = null;
      }
    }
  }, [markupMode]);

  // Keep currentPageRef in sync (avoids currentPage in useCallback deps)
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);

  // Clear selected markup when page changes
  useEffect(() => {
    // Only clear selection on page change in single/side-by-side view.
    // In continuous view, pages are one surface — scrolling shouldn't deselect.
    if (isContinuousView(viewMode)) return;
    setSelectedMarkup(null);
    setSelectedMarkups([]);
    selectedMarkupsRef.current = [];
  }, [currentPage, viewMode]);

  // Global mouseup handler for panning and selection box
  useEffect(() => {
    const handleGlobalMouseUp = (e) => {
      setIsPanning(false);
      
      // Handle selection box completion
      if (isDrawingSelectionBox && selectionBox && canvasRef.current) {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / scale;
        const y = (e.clientY - rect.top) / scale;
        const endX = Math.max(0, Math.min(1, x / canvasSize.width));
        const endY = Math.max(0, Math.min(1, y / canvasSize.height));
        
        // Update final selection box position
        const finalBox = { ...selectionBox, endX, endY };
        
        // Find all markups that intersect with the selection box
        const boxMinX = Math.min(finalBox.startX, finalBox.endX);
        const boxMaxX = Math.max(finalBox.startX, finalBox.endX);
        const boxMinY = Math.min(finalBox.startY, finalBox.endY);
        const boxMaxY = Math.max(finalBox.startY, finalBox.endY);
        
        const boxWidth = boxMaxX - boxMinX;
        const boxHeight = boxMaxY - boxMinY;
        
        if (boxWidth > 0.005 || boxHeight > 0.005) {
          const currentPageNum = currentPage - 1;
          const selected = markups.filter(m => {
            // Check page match
            if (m.page !== currentPageNum) {
              return false;
            }
            // Check file match - allow if file is undefined (legacy markups) or matches current file
            const fileMatches = !m.file || m.file === currentFile?.backendFilename;
            if (!fileMatches) {
              return false;
            }
            
            // Calculate bounds inline
            let bounds = null;
            if (m.type === 'pen' || m.type === 'highlighter') {
              if (m.points && m.points.length > 0) {
                const xs = m.points.map(p => p.x);
                const ys = m.points.map(p => p.y);
                bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
              }
            } else if (m.type === 'polyline' || m.type === 'polylineArrow' || m.type === 'cloudPolyline' || m.type === 'polygon') {
              if (m.points && m.points.length > 0) {
                const xs = m.points.map(p => p.x);
                const ys = m.points.map(p => p.y);
                bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
              }
            } else if (m.startX !== undefined && m.endX !== undefined) {
              bounds = {
                minX: Math.min(m.startX, m.endX),
                maxX: Math.max(m.startX, m.endX),
                minY: Math.min(m.startY, m.endY),
                maxY: Math.max(m.startY, m.endY)
              };
            } else if (m.x !== undefined) {
              const size = 0.025;
              bounds = { minX: m.x - size, maxX: m.x + size, minY: m.y - size, maxY: m.y + size };
            }
            
            if (!bounds) {
              return false;
            }
            
            // Check if markup intersects with selection box
            const intersects = !(bounds.maxX < boxMinX || bounds.minX > boxMaxX || 
                     bounds.maxY < boxMinY || bounds.minY > boxMaxY);
            return intersects;
          });
          
          if (selected.length > 0) {
            setSelectedMarkups(selected);
            selectedMarkupsRef.current = selected;
            setSelectedMarkup(null);
            selectedMarkupRef.current = null;
          }
        }
        
        setIsDrawingSelectionBox(false);
        setSelectionBox(null);
      }
      
      // Handle zoom box completion - zoom to selected area
      if (isDrawingZoomBox && zoomBox && canvasRef.current && containerRef.current) {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / scale;
        const y = (e.clientY - rect.top) / scale;
        const endX = Math.max(0, Math.min(1, x / canvasSize.width));
        const endY = Math.max(0, Math.min(1, y / canvasSize.height));
        
        // Get final box
        const finalBox = { ...zoomBox, endX, endY };
        const boxMinX = Math.min(finalBox.startX, finalBox.endX);
        const boxMaxX = Math.max(finalBox.startX, finalBox.endX);
        const boxMinY = Math.min(finalBox.startY, finalBox.endY);
        const boxMaxY = Math.max(finalBox.startY, finalBox.endY);
        
        const boxWidth = boxMaxX - boxMinX;
        const boxHeight = boxMaxY - boxMinY;
        
        // Only zoom if box is large enough (more than a small click)
        if (boxWidth > 0.01 && boxHeight > 0.01) {
          const container = containerRef.current;
          const containerRect = container.getBoundingClientRect();
          const containerWidth = containerRect.width;
          const containerHeight = containerRect.height;
          
          // Calculate the pixel dimensions of the selected area at current scale
          const selectedPixelWidth = boxWidth * canvasSize.width;
          const selectedPixelHeight = boxHeight * canvasSize.height;
          
          // Calculate the scale needed to fit the selected area in the viewport
          // Leave some padding (90% of container)
          const padding = 0.9;
          const scaleX = (containerWidth * padding) / selectedPixelWidth;
          const scaleY = (containerHeight * padding) / selectedPixelHeight;
          const newScale = Math.min(scaleX, scaleY, 20); // Cap at 20x
          
          // Calculate the center of the selected area in PDF coordinates
          const centerX = ((boxMinX + boxMaxX) / 2) * canvasSize.width;
          const centerY = ((boxMinY + boxMaxY) / 2) * canvasSize.height;
          
          // Set the new scale and schedule scroll adjustment
          pendingScrollRef.current = { 
            pdfX: centerX, 
            pdfY: centerY, 
            mouseX: containerWidth / 2, 
            mouseY: containerHeight / 2 
          };
          setScale(newScale);
        } else {
          // Small box = regular click zoom
          // Zoom in by 1.5x at the click point
          const clickX = ((boxMinX + boxMaxX) / 2) * canvasSize.width;
          const clickY = ((boxMinY + boxMaxY) / 2) * canvasSize.height;
          const container = containerRef.current;
          const containerRect = container.getBoundingClientRect();
          
          pendingScrollRef.current = { 
            pdfX: clickX, 
            pdfY: clickY, 
            mouseX: containerRect.width / 2, 
            mouseY: containerRect.height / 2 
          };
          setScale(prev => Math.min(20, prev * 1.5));
        }
        
        setIsDrawingZoomBox(false);
        setZoomBox(null);
      }
    };
    
    const handleGlobalMouseMove = (e) => {
      // Handle selection box drawing
      if (isDrawingSelectionBox && canvasRef.current) {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / scale;
        const y = (e.clientY - rect.top) / scale;
        const currentX = Math.max(0, Math.min(1, x / canvasSize.width));
        const currentY = Math.max(0, Math.min(1, y / canvasSize.height));
        
        setSelectionBox(prev => prev ? { ...prev, endX: currentX, endY: currentY } : null);
      }
      
      // Handle zoom box drawing
      if (isDrawingZoomBox && canvasRef.current) {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / scale;
        const y = (e.clientY - rect.top) / scale;
        const currentX = Math.max(0, Math.min(1, x / canvasSize.width));
        const currentY = Math.max(0, Math.min(1, y / canvasSize.height));
        
        setZoomBox(prev => prev ? { ...prev, endX: currentX, endY: currentY } : null);
      }
    };
    
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('mousemove', handleGlobalMouseMove);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('mousemove', handleGlobalMouseMove);
    };
  }, [isDrawingSelectionBox, selectionBox, isDrawingZoomBox, zoomBox, scale, canvasSize, currentPage, currentFile, markups]);

  // Clear multi-selection when entering a drawing mode
  useEffect(() => {
    if (markupMode && markupMode !== 'select') {
      setSelectedMarkups([]);
      selectedMarkupsRef.current = [];
    }
  }, [markupMode]);

  // Keyboard shortcuts for tool modes: V=Select, Shift+V=Pan, Z=Zoom, and markup tools
  useEffect(() => {
    const handleToolShortcuts = (e) => {
      // Allow Escape to work even in input fields
      if (e.key === 'Escape' && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        e.target.blur();
        return;
      }
      
      // Don't trigger if typing in an input field or editing text markup
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      
      // Don't trigger if Ctrl or Meta keys are held (allow Ctrl+V, etc.)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      
      // Don't trigger if editing inline text
      if (editingTextMarkupId) return;
      
      const key = e.key.toLowerCase();
      
      // View/navigation mode shortcuts
      if (key === 'v' && !e.shiftKey) {
        // Select mode - also clear any markup tool
        setSelectMode(true);
        setPanMode(false);
        setZoomMode(false);
        setMarkupMode(null);
      } else if (key === 'v' && e.shiftKey) {
        // Pan mode (Shift+V) - deselect markup tool
        e.preventDefault();
        setSelectMode(false);
        setPanMode(true);
        setZoomMode(false);
        setMarkupMode(null);
        setSelectedMarkup(null);
      } else if (key === 'z' && !e.shiftKey) {
        // Zoom mode
        setSelectMode(false);
        setPanMode(false);
        setZoomMode(true);
        setMarkupMode(null);
      }
      
      // Markup tool shortcuts — always work regardless of lock state
      {
        const activateMarkupTool = (mode) => {
          setMarkupMode(markupMode === mode ? null : mode);
          setSelectedMarkup(null);
          setSelectMode(false);
          setPanMode(false);
          setZoomMode(false);
        };
        
        if (key === 'p' && !e.shiftKey) {
          // Pen
          activateMarkupTool('pen');
        } else if (key === 'h' && !e.shiftKey) {
          // Highlighter
          activateMarkupTool('highlighter');
        } else if (key === 'a' && !e.shiftKey) {
          // Arrow
          activateMarkupTool('arrow');
        } else if (key === 'l' && !e.shiftKey) {
          // Line
          activateMarkupTool('line');
        } else if (key === 'r' && !e.shiftKey) {
          // Rectangle
          activateMarkupTool('rectangle');
        } else if (key === 'e' && !e.shiftKey) {
          // Circle/Ellipse
          activateMarkupTool('circle');
        } else if (key === 'c' && !e.shiftKey) {
          // Cloud
          activateMarkupTool('cloud');
        } else if (key === 't' && !e.shiftKey) {
          // Text box
          activateMarkupTool('text');
        } else if (key === 'l' && e.shiftKey) {
          // Polyline (Shift+L)
          e.preventDefault();
          activateMarkupTool('polyline');
        } else if (key === 'a' && e.shiftKey) {
          // Polyline Arrow (Shift+A)
          e.preventDefault();
          activateMarkupTool('polylineArrow');
        } else if (key === 'c' && e.shiftKey) {
          // Cloud Polyline (Shift+C)
          e.preventDefault();
          activateMarkupTool('cloudPolyline');
        }
      }
    };
    
    window.addEventListener('keydown', handleToolShortcuts);
    return () => window.removeEventListener('keydown', handleToolShortcuts);
  }, [editingTextMarkupId, markupMode]);

  // applyZoomInput is now provided by useZoomPan hook

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      const newPage = viewMode === 'sideBySide' ? Math.max(1, currentPage - 2) : currentPage - 1;
      setCurrentPage(newPage);
      // In continuous view, scroll to the page using position-based calculation
      if (isContinuousView(viewMode)) {
        setTimeout(() => scrollToPagePosition(newPage, 'smooth', 'center'), 50);
      }
    } else if (onNavigateFile && allFiles?.length > 1) {
      onNavigateFile('previous');
    }
  };

  const handleNextPage = () => {
    if (currentPage < numPages) {
      const newPage = viewMode === 'sideBySide' ? Math.min(numPages, currentPage + 2) : currentPage + 1;
      setCurrentPage(newPage);
      // In continuous view, scroll to the page using position-based calculation
      if (isContinuousView(viewMode)) {
        setTimeout(() => scrollToPagePosition(newPage, 'smooth', 'center'), 50);
      }
    } else if (onNavigateFile && allFiles?.length > 1) {
      onNavigateFile('next');
    }
  };

  // Mouse handlers
  const handleMouseDown = (e) => {
    if (!containerRef.current) return;
    
    // Handle symbol capture mode - draw region selection
    if (symbolCaptureMode && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setCaptureRegion({ x, y, width: 0, height: 0, startX: x, startY: y });
      return;
    }
    
    // If editing text, clicking outside should save and exit text editing
    if (editingTextMarkupId) {
      // Check if click is inside the text editing textarea itself - if so, let it handle naturally
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.closest('foreignObject')) {
        return;
      }
      // Click was outside the text box - save and exit editing, then continue to allow deselection
      saveTextEdit(false);
      // Don't return - let the click continue to deselect/select other markups
    }
    
    // Don't interfere with pending shape controls (buttons, handles)
    if (pendingShape && e.target.closest('.pending-shape-container')) {
      return;
    }
    
    // Right-click on a markup → show context menu (works for ALL markup types)
    if (e.button === 2 && canvasRef.current) {
      e.preventDefault();
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      const { x: clickX, y: clickY } = inverseTransformCoordinate(x / canvasSize.width, y / canvasSize.height);
      const hitMarkup = hitTestMarkup(clickX, clickY);
      if (hitMarkup) {
        handleMarkupContextMenu(e, hitMarkup);
      }
      return;
    }
    
    // Don't interfere with detected objects or hotspots - let their onClick handlers work
    // BUT when a markup drawing tool is active, ignore objects/hotspots so drawing works
    const isMarkupDrawingTool = markupMode && markupMode !== 'select';
    if (!isMarkupDrawingTool && (e.target.closest('.detected-object-box') || e.target.closest('.hotspot-box'))) {
      return;
    }
    
    // Handle pending symbol/signature placement — rubber-band draw (takes priority)
    if (pendingPlacement && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      const { x: normalizedX, y: normalizedY } = inverseTransformCoordinate(x / canvasSize.width, y / canvasSize.height);

      setIsDrawingMarkup(true);
      isDrawingMarkupRef.current = true;
      const sym = pendingPlacement.symbol;
      const aspectRatio = sym.aspectRatio || ((sym.originalWidth && sym.originalHeight) ? sym.originalWidth / sym.originalHeight : 1);
      
      const newMarkup = {
        id: `placement_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'placementPreview',
        startX: normalizedX,
        startY: normalizedY,
        endX: normalizedX,
        endY: normalizedY,
        aspectRatio: aspectRatio,
        symbolData: sym,
        page: currentPage - 1,
        filename: currentFileIdentifier,
      };
      currentMarkupRef.current = newMarkup;
      setCurrentMarkup(newMarkup);
      e.preventDefault();
      return;
    }

    // Handle markup selection mode (from markups panel OR bottom toolbar)
    if ((markupMode === 'select' || (selectMode && !markupMode)) && !objectFinderMode && !linkMode && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      const { x: clickX, y: clickY } = inverseTransformCoordinate(x / canvasSize.width, y / canvasSize.height);
      const isShiftHeld = e.shiftKey;
      
      // If we have selected markups (multi-select), check if clicking inside any of them to drag
      if (selectedMarkups.length > 0) {
        // Check if clicking inside any selected markup
        const baseTolerance = 0.005;
        // Helper to get local coordinates for rotated shapes (aspect-ratio aware)
        const pgW = canvasSize.width || 1, pgH = canvasSize.height || 1;
        const hwRatio = pgH / pgW;
        const toLocal = (m, cx, cy) => {
          if (!m.rotation) return { lx: cx, ly: cy };
          const rot = -m.rotation * Math.PI / 180;
          let mx, my;
          if (m.startX !== undefined) { mx = (m.startX + m.endX) / 2; my = (m.startY + m.endY) / 2; }
          else if (m.x !== undefined) { mx = m.x; my = m.y; }
          else return { lx: cx, ly: cy };
          const dx = cx - mx, dy = cy - my;
          const cosR = Math.cos(rot), sinR = Math.sin(rot);
          return { lx: mx + dx * cosR - dy * hwRatio * sinR, ly: my + dx / hwRatio * sinR + dy * cosR };
        };
        const clickedSelected = selectedMarkups.find(m => {
          const bounds = getMarkupBounds(m);
          if (!bounds) return false;
          const strokeTol = Math.max(baseTolerance, (m.strokeWidth || 2) * 0.0008);
          const { lx, ly } = toLocal(m, clickX, clickY);
          if (m.type === 'arrow' || m.type === 'line') {
            const dist = pointToLineDistance(lx, ly, m.startX, m.startY, m.endX, m.endY);
            return dist < strokeTol;
          }
          if (m.type === 'pen' || m.type === 'highlighter') {
            // Check segments
            for (let i = 0; i < m.points.length - 1; i++) {
              const p1 = m.points[i];
              const p2 = m.points[i + 1];
              const dist = pointToLineDistance(clickX, clickY, p1.x, p1.y, p2.x, p2.y);
              if (dist < strokeTol) return true;
            }
            return false;
          }
          if (m.type === 'text' || m.type === 'callout') {
            return lx >= bounds.minX && lx <= bounds.maxX && 
                   ly >= bounds.minY && ly <= bounds.maxY;
          }
          if (m.type === 'circle') {
            const cx = (m.startX + m.endX) / 2;
            const cy = (m.startY + m.endY) / 2;
            const rx = Math.abs(m.endX - m.startX) / 2;
            const ry = Math.abs(m.endY - m.startY) / 2;
            if (rx > 0.001 && ry > 0.001) {
              const dx = (lx - cx) / rx;
              const dy = (ly - cy) / ry;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const hasFill = m.fillColor && m.fillColor !== 'none' && m.fillColor !== 'transparent';
              if (hasFill && dist <= 1) return true;
              const borderTol = strokeTol / Math.min(rx, ry);
              return Math.abs(dist - 1) < borderTol;
            }
            return false;
          }
          if (m.type === 'rectangle') {
            const hasFill = m.fillColor && m.fillColor !== 'none' && m.fillColor !== 'transparent';
            if (hasFill) return lx >= bounds.minX && lx <= bounds.maxX && ly >= bounds.minY && ly <= bounds.maxY;
            const onEdge = Math.abs(lx - bounds.minX) < strokeTol || Math.abs(lx - bounds.maxX) < strokeTol || Math.abs(ly - bounds.minY) < strokeTol || Math.abs(ly - bounds.maxY) < strokeTol;
            return onEdge && lx >= bounds.minX - strokeTol && lx <= bounds.maxX + strokeTol && ly >= bounds.minY - strokeTol && ly <= bounds.maxY + strokeTol;
          }
          if (m.type === 'polyline' || m.type === 'polylineArrow' || m.type === 'cloudPolyline' || m.type === 'polygon') {
            if (m.points && m.points.length >= 2) {
              const numSegments = m.type === 'polygon' ? m.points.length : m.points.length - 1;
              for (let i = 0; i < numSegments; i++) {
                const p1 = m.points[i];
                const p2 = m.points[(i + 1) % m.points.length];
                const dist = pointToLineDistance(clickX, clickY, p1.x, p1.y, p2.x, p2.y);
                if (dist < strokeTol) return true;
              }
            }
            // Check fill for polygon
            if (m.type === 'polygon' && m.fillColor && m.fillColor !== 'none' && m.fillColor !== 'transparent') {
              let inside = false;
              const pts = m.points;
              for (let j = 0, k = pts.length - 1; j < pts.length; k = j++) {
                if (((pts[j].y > clickY) !== (pts[k].y > clickY)) &&
                    (clickX < (pts[k].x - pts[j].x) * (clickY - pts[j].y) / (pts[k].y - pts[j].y) + pts[j].x)) {
                  inside = !inside;
                }
              }
              if (inside) return true;
            }
            return false;
          }
          if (m.type === 'cloud') {
            const hasFill = m.fillColor && m.fillColor !== 'none' && m.fillColor !== 'transparent';
            if (hasFill && lx >= bounds.minX && lx <= bounds.maxX && 
                ly >= bounds.minY && ly <= bounds.maxY) {
              return true;
            }
            const cloudTol = strokeTol + 0.008;
            const onEdge = 
              (Math.abs(lx - bounds.minX) < cloudTol || Math.abs(lx - bounds.maxX) < cloudTol) &&
              ly >= bounds.minY && ly <= bounds.maxY ||
              (Math.abs(ly - bounds.minY) < cloudTol || Math.abs(ly - bounds.maxY) < cloudTol) &&
              lx >= bounds.minX && lx <= bounds.maxX;
            return onEdge;
          }
          // For filled shapes, check if inside
          const hasFill = m.fillColor && m.fillColor !== 'none' && m.fillColor !== 'transparent';
          if (hasFill) {
            return lx >= bounds.minX && lx <= bounds.maxX && 
                   ly >= bounds.minY && ly <= bounds.maxY;
          }
          // For unfilled, check border
          const onBorder = 
            (Math.abs(lx - bounds.minX) < strokeTol || Math.abs(lx - bounds.maxX) < strokeTol) &&
            ly >= bounds.minY && ly <= bounds.maxY ||
            (Math.abs(ly - bounds.minY) < strokeTol || Math.abs(ly - bounds.maxY) < strokeTol) &&
            lx >= bounds.minX && lx <= bounds.maxX;
          return onBorder;
        });
        
        if (clickedSelected && !clickedSelected.readOnly) {
          // Start dragging all selected markups
          saveHistory(); // Save before multi-drag starts (changes applied incrementally)
          setIsDraggingMarkup(true);
          isDraggingMarkupRef.current = true;
          const dragStart = {
            x: clickX,
            y: clickY,
            isMultiDrag: true
          };
          setMarkupDragStart(dragStart);
          markupDragStartRef.current = dragStart;
          e.preventDefault();
          return;
        }
        
        // If shift not held and clicking outside, clear multi-selection and continue
        if (!isShiftHeld) {
          setSelectedMarkups([]);
          selectedMarkupsRef.current = [];
        }
      }
      
      // If we have a single selected markup, check for resize handles first
      if (selectedMarkup && selectedMarkups.length === 0) {
        const bounds = getMarkupBounds(selectedMarkup);
        const handle = getResizeHandle(clickX, clickY, bounds, selectedMarkup);
        
        // Allow resizing for shapes and text boxes (but not point-based or old text format, or readOnly)
        const canResize = !selectedMarkup.readOnly && 
          selectedMarkup.type !== 'pen' && selectedMarkup.type !== 'highlighter' &&
          selectedMarkup.type !== 'polyline' && selectedMarkup.type !== 'polylineArrow' && selectedMarkup.type !== 'cloudPolyline' && selectedMarkup.type !== 'polygon' &&
          !(selectedMarkup.type === 'text' && selectedMarkup.x !== undefined && selectedMarkup.startX === undefined);
        
        if (handle && canResize) {
          // Start resizing
          setIsResizingMarkup(true);
          isResizingMarkupRef.current = true;
          setResizeHandle(handle);
          resizeHandleRef.current = handle;
          const dragStart = {
            x: clickX,
            y: clickY,
            bounds: bounds,
            rotation: selectedMarkup.rotation || 0 // Store rotation for mousemove un-rotation
          };
          setMarkupDragStart(dragStart);
          markupDragStartRef.current = dragStart;
          e.preventDefault();
          return;
        }
        
        // Check if clicking inside bounds (to drag) - only if not readOnly
        if (!selectedMarkup.readOnly) {
          // For rotated shapes, transform click into local coordinate space
          let localX = clickX, localY = clickY;
          if (selectedMarkup.rotation && bounds) {
            const rot = -selectedMarkup.rotation * Math.PI / 180;
            const cx = (bounds.minX + bounds.maxX) / 2;
            const cy = (bounds.minY + bounds.maxY) / 2;
            const dx = clickX - cx;
            const dy = clickY - cy;
            const cosR = Math.cos(rot), sinR = Math.sin(rot);
            const hw = (canvasSize.height || 1) / (canvasSize.width || 1);
            localX = cx + dx * cosR - dy * hw * sinR;
            localY = cy + dx / hw * sinR + dy * cosR;
          }
          
          // For arrows/lines, check proximity to the line itself
          if (selectedMarkup.type === 'arrow' || selectedMarkup.type === 'line') {
            // Calculate distance to line segment
            const px = localX, py = localY;
            const x1 = selectedMarkup.startX, y1 = selectedMarkup.startY;
            const x2 = selectedMarkup.endX, y2 = selectedMarkup.endY;
            const dx = x2 - x1, dy = y2 - y1;
            const lenSq = dx * dx + dy * dy;
            let dist;
            if (lenSq === 0) {
              dist = Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
            } else {
              let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
              t = Math.max(0, Math.min(1, t));
              const nearX = x1 + t * dx;
              const nearY = y1 + t * dy;
              dist = Math.sqrt((px - nearX) ** 2 + (py - nearY) ** 2);
            }
            
            if (dist < Math.max(0.005, (selectedMarkup.strokeWidth || 2) * 0.0008)) { // Close to the line
              setIsDraggingMarkup(true);
              isDraggingMarkupRef.current = true;
              didDragMoveRef.current = false; // Reset movement tracking
              wasAlreadySelectedRef.current = true; // This markup was already selected
              const dragStart = {
                x: clickX,
                y: clickY,
                bounds: bounds
              };
              setMarkupDragStart(dragStart);
              markupDragStartRef.current = dragStart;
              e.preventDefault();
              return;
            }
          } else if (selectedMarkup.type === 'polyline' || selectedMarkup.type === 'polylineArrow' || selectedMarkup.type === 'cloudPolyline' || selectedMarkup.type === 'polygon') {
            // For polyline types, check proximity to any segment (including closing edge)
            if (selectedMarkup.points && selectedMarkup.points.length >= 2) {
              const strokeTol = Math.max(0.005, (selectedMarkup.strokeWidth || 2) * 0.0008);
              const isClosed = selectedMarkup.type === 'polygon' || selectedMarkup.closed;
              const numSegs = isClosed ? selectedMarkup.points.length : selectedMarkup.points.length - 1;
              let nearSegment = false;
              for (let j = 0; j < numSegs; j++) {
                const p1 = selectedMarkup.points[j];
                const p2 = selectedMarkup.points[(j + 1) % selectedMarkup.points.length];
                const dist = pointToLineDistance(localX, localY, p1.x, p1.y, p2.x, p2.y);
                if (dist < strokeTol) { nearSegment = true; break; }
              }
              // Also check inside for filled closed shapes
              if (!nearSegment && isClosed && selectedMarkup.fillColor && selectedMarkup.fillColor !== 'none' && selectedMarkup.fillColor !== 'transparent') {
                let inside = false;
                const pts = selectedMarkup.points;
                for (let j = 0, k = pts.length - 1; j < pts.length; k = j++) {
                  if (((pts[j].y > localY) !== (pts[k].y > localY)) &&
                      (localX < (pts[k].x - pts[j].x) * (localY - pts[j].y) / (pts[k].y - pts[j].y) + pts[j].x)) {
                    inside = !inside;
                  }
                }
                nearSegment = inside;
              }
              if (nearSegment) {
                setIsDraggingMarkup(true);
                isDraggingMarkupRef.current = true;
                didDragMoveRef.current = false;
                wasAlreadySelectedRef.current = true;
                const dragStart = { x: clickX, y: clickY, bounds: bounds };
                setMarkupDragStart(dragStart);
                markupDragStartRef.current = dragStart;
                e.preventDefault();
                return;
              }
            }
          } else if (bounds) {
            // For shapes (rectangle, circle, cloud, callout, text), check if filled
            // Text boxes are always considered "filled" for dragging purposes (they have a background)
            const isTextBox = selectedMarkup.type === 'text' || selectedMarkup.type === 'callout';
            const hasFill = isTextBox || (selectedMarkup.fillColor && selectedMarkup.fillColor !== 'none' && selectedMarkup.fillColor !== 'transparent');
            const strokeTol = Math.max(0.005, (selectedMarkup.strokeWidth || selectedMarkup.borderWidth || 2) * 0.0008);
            
            let canDrag = false;
            
            if (hasFill) {
              // Filled shape - can drag from anywhere inside
              canDrag = localX >= bounds.minX && localX <= bounds.maxX && 
                       localY >= bounds.minY && localY <= bounds.maxY;
            } else {
              // Unfilled shape - only drag when clicking on the border/stroke
              const onLeftEdge = Math.abs(localX - bounds.minX) < strokeTol && localY >= bounds.minY && localY <= bounds.maxY;
              const onRightEdge = Math.abs(localX - bounds.maxX) < strokeTol && localY >= bounds.minY && localY <= bounds.maxY;
              const onTopEdge = Math.abs(localY - bounds.minY) < strokeTol && localX >= bounds.minX && localX <= bounds.maxX;
              const onBottomEdge = Math.abs(localY - bounds.maxY) < strokeTol && localX >= bounds.minX && localX <= bounds.maxX;
              
              // For circles/ellipses, check distance from center
              if (selectedMarkup.type === 'circle') {
                const cx = (bounds.minX + bounds.maxX) / 2;
                const cy = (bounds.minY + bounds.maxY) / 2;
                const rx = (bounds.maxX - bounds.minX) / 2;
                const ry = (bounds.maxY - bounds.minY) / 2;
                if (rx > 0.001 && ry > 0.001) {
                  const dx = (localX - cx) / rx;
                  const dy = (localY - cy) / ry;
                  const dist = Math.sqrt(dx * dx + dy * dy);
                  canDrag = Math.abs(dist - 1) < (strokeTol / Math.min(rx, ry));
                }
              } else if (selectedMarkup.type === 'cloud') {
                // Cloud has bumps - use wider tolerance
                const cloudTol = strokeTol + 0.008;
                const onCloudEdge = 
                  (Math.abs(localX - bounds.minX) < cloudTol || Math.abs(localX - bounds.maxX) < cloudTol) &&
                  localY >= bounds.minY && localY <= bounds.maxY ||
                  (Math.abs(localY - bounds.minY) < cloudTol || Math.abs(localY - bounds.maxY) < cloudTol) &&
                  localX >= bounds.minX && localX <= bounds.maxX;
                canDrag = onCloudEdge;
              } else {
                canDrag = onLeftEdge || onRightEdge || onTopEdge || onBottomEdge;
              }
            }
            
            if (canDrag) {
              setIsDraggingMarkup(true);
              isDraggingMarkupRef.current = true;
              didDragMoveRef.current = false; // Reset movement tracking
              wasAlreadySelectedRef.current = true; // This markup was already selected
              const dragStart = {
                x: clickX,
                y: clickY,
                bounds: bounds
              };
              setMarkupDragStart(dragStart);
              markupDragStartRef.current = dragStart;
              e.preventDefault();
              return;
            }
          }
        }
      }
      
      // Otherwise, try to select a markup
      const hitMarkup = hitTestMarkup(clickX, clickY);
      
      if (hitMarkup) {
        // Don't allow selecting PDF annotations when edit mode is off
        // (they're rendered by PDF.js, user should see original appearance)
        if (hitMarkup.fromPdf && !markupEditMode) {
          return; // Ignore click on PDF annotation when not in edit mode
        }
        
        // Don't allow selecting read-only markups for editing/dragging
        if (hitMarkup.readOnly) {
          // Still show it as selected visually but don't allow dragging
          if (isShiftHeld) {
            // Add to or remove from multi-selection
            setSelectedMarkups(prev => {
              const isAlreadySelected = prev.some(m => m.id === hitMarkup.id);
              if (isAlreadySelected) {
                const newSelection = prev.filter(m => m.id !== hitMarkup.id);
                selectedMarkupsRef.current = newSelection;
                return newSelection;
              } else {
                const newSelection = [...prev, hitMarkup];
                selectedMarkupsRef.current = newSelection;
                return newSelection;
              }
            });
            setSelectedMarkup(null);
            selectedMarkupRef.current = null;
          } else {
            // Check if clicking on already selected markup - toggle off
            if (selectedMarkup && selectedMarkup.id === hitMarkup.id) {
              setSelectedMarkup(null);
              selectedMarkupRef.current = null;
              return;
            }
            
            setSelectedMarkup(hitMarkup);
            selectedMarkupRef.current = hitMarkup;
            setSelectedMarkups([]);
            selectedMarkupsRef.current = [];
          }
        } else {
          // Convert PDF annotation to editable format if needed
          let editableMarkup = hitMarkup;
          const needsConversion = 
            (hitMarkup.hasCustomAppearance && !hitMarkup.modified) ||
            (hitMarkup.type === 'text' && hitMarkup.x !== undefined && hitMarkup.startX === undefined) ||
            (hitMarkup.type === 'textHighlight' && !hitMarkup.modified) ||
            (hitMarkup.type === 'textMarkup' && !hitMarkup.modified);
          
          // For PDF annotations, don't mark as modified just from selection
          // Only mark modified when actual changes are made (drag, resize, etc.)
          if (needsConversion) {
            editableMarkup = convertToEditableFormat(hitMarkup);
            setMarkups(prev => prev.map(m => m.id === hitMarkup.id ? editableMarkup : m));
          }
          
          if (isShiftHeld) {
            // Add to or remove from multi-selection
            setSelectedMarkups(prev => {
              const isAlreadySelected = prev.some(m => m.id === editableMarkup.id);
              if (isAlreadySelected) {
                const newSelection = prev.filter(m => m.id !== editableMarkup.id);
                selectedMarkupsRef.current = newSelection;
                return newSelection;
              } else {
                // Also add current single selection if any
                let newSelection = [...prev];
                if (selectedMarkup && !prev.some(m => m.id === selectedMarkup.id)) {
                  newSelection.push(selectedMarkup);
                }
                newSelection.push(editableMarkup);
                selectedMarkupsRef.current = newSelection;
                return newSelection;
              }
            });
            setSelectedMarkup(null);
            selectedMarkupRef.current = null;
          } else {
            setSelectedMarkup(editableMarkup);
            selectedMarkupRef.current = editableMarkup;
            setSelectedMarkups([]);
            selectedMarkupsRef.current = [];
            // Start dragging immediately
            const bounds = getMarkupBounds(editableMarkup);
            setIsDraggingMarkup(true);
            isDraggingMarkupRef.current = true;
            didDragMoveRef.current = false;
            wasAlreadySelectedRef.current = false; // This is a NEW selection
            const dragStart = {
              x: clickX,
              y: clickY,
              bounds: bounds
            };
            setMarkupDragStart(dragStart);
            markupDragStartRef.current = dragStart;
          }
        }
      } else {
        // Clicked on empty space - start drawing selection box
        if (!isShiftHeld) {
          setSelectedMarkup(null);
          selectedMarkupRef.current = null;
          setSelectedMarkups([]);
          selectedMarkupsRef.current = [];
        }
        // Start selection box
        setIsDrawingSelectionBox(true);
        setSelectionBox({ startX: clickX, startY: clickY, endX: clickX, endY: clickY });
      }
      e.preventDefault();
      return;
    }
    
    // Handle markup drawing
    if (markupMode && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      
      if (markupMode === 'eraser') {
        // Find and remove markup at this position
        const { x: clickX, y: clickY } = inverseTransformCoordinate(x / canvasSize.width, y / canvasSize.height);
        setMarkups(prev => prev.filter(m => {
          if (m.page !== currentPage - 1 || m.filename !== currentFileIdentifier) return true;
          if (m.type === 'pen' || m.type === 'highlighter') {
            // Check if click is near any point in the path
            return !m.points.some(p => 
              Math.abs(p.x - clickX) < 0.02 && Math.abs(p.y - clickY) < 0.02
            );
          } else if (m.type === 'rectangle' || m.type === 'arrow' || m.type === 'stamp') {
            // Check if click is within bounds
            const minX = Math.min(m.startX, m.endX);
            const maxX = Math.max(m.startX, m.endX);
            const minY = Math.min(m.startY, m.endY);
            const maxY = Math.max(m.startY, m.endY);
            return !(clickX >= minX && clickX <= maxX && clickY >= minY && clickY <= maxY);
          } else if (m.type === 'circle') {
            // Check if click is within circle bounds
            const cx = (m.startX + m.endX) / 2;
            const cy = (m.startY + m.endY) / 2;
            const rx = Math.abs(m.endX - m.startX) / 2;
            const ry = Math.abs(m.endY - m.startY) / 2;
            const dx = (clickX - cx) / rx;
            const dy = (clickY - cy) / ry;
            return (dx * dx + dy * dy) > 1;
          } else if (m.type === 'text') {
            return !(Math.abs(m.x - clickX) < 0.05 && Math.abs(m.y - clickY) < 0.02);
          }
          return true;
        }));
        return;
      }
      
      // Handle text markup - draw a box first, then edit
      if (markupMode === 'text') {
        setIsDrawingMarkup(true);
        const { x: normalizedX, y: normalizedY } = inverseTransformCoordinate(x / canvasSize.width, y / canvasSize.height);
        const newMarkup = {
          id: `textbox_${Date.now()}`,
          type: 'text',
          startX: normalizedX,
          startY: normalizedY,
          endX: normalizedX,
          endY: normalizedY,
          text: '',
          color: markupColor,  // Text color
          borderColor: markupBorderColor,  // Border color (can be 'none')
          borderWidth: markupBorderWidth,  // Border thickness
          borderStyle: markupBorderStyle,  // Border style (solid, dashed, etc.)
          borderOpacity: markupBorderOpacity,  // Border opacity
          fillColor: markupFillColor,  // Fill/background color (keep 'none' as 'none')
          fillOpacity: markupFillOpacity,  // Fill opacity
          padding: markupTextPadding,  // Text padding
          fontSize: markupFontSize,
          fontFamily: markupFontFamily,
          textAlign: markupTextAlign,
          verticalAlign: markupVerticalAlign,
          lineSpacing: markupLineSpacing,
          page: currentPage - 1,
          filename: currentFileIdentifier,
          author: markupAuthor,
          createdDate: new Date().toISOString()
        };
        currentMarkupRef.current = newMarkup;
        setCurrentMarkup(newMarkup);
        return;
      }
      
      // Handle sticky note
      if (markupMode === 'note') {
        createStickyNote(x, y);
        return;
      }
      
      setIsDrawingMarkup(true);
      const { x: normalizedX, y: normalizedY } = inverseTransformCoordinate(x / canvasSize.width, y / canvasSize.height);

      if (markupMode === 'pen' || markupMode === 'highlighter') {
        // Use refs for better performance during drawing
        isDrawingMarkupRef.current = true;
        const newMarkup = {
          id: `${markupMode}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: markupMode,
          points: [{ x: normalizedX, y: normalizedY }],
          color: markupColor,
          strokeWidth: markupMode === 'highlighter' ? markupStrokeWidth * 3 : markupStrokeWidth,
          opacity: markupMode === 'highlighter' ? markupOpacity : 1,
          page: currentPage - 1,
          filename: currentFileIdentifier,
          author: markupAuthor,
          createdDate: new Date().toISOString()
        };
        currentMarkupRef.current = newMarkup;
        setCurrentMarkup(newMarkup);
      } else if (markupMode === 'polyline' || markupMode === 'polylineArrow' || markupMode === 'cloudPolyline') {
        // Polyline mode - add points with each click
        
        // Helper function for 8-direction snap (horizontal, vertical, 4 diagonals)
        const snapTo8Directions = (fromPt, toX, toY) => {
          const dx = toX - fromPt.x;
          const dy = toY - fromPt.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 0.001) return { x: toX, y: toY };
          
          // Calculate angle in degrees (0 = right, 90 = down)
          const angle = Math.atan2(dy, dx) * 180 / Math.PI;
          
          // Snap to nearest 45 degree increment
          const snapAngle = Math.round(angle / 45) * 45;
          const snapRad = snapAngle * Math.PI / 180;
          
          return {
            x: fromPt.x + dist * Math.cos(snapRad),
            y: fromPt.y + dist * Math.sin(snapRad)
          };
        };
        
        // Apply shift snap if holding shift and we have previous points
        let pointX = normalizedX;
        let pointY = normalizedY;
        if (isShiftPressed && cloudPoints.length > 0) {
          const lastPt = cloudPoints[cloudPoints.length - 1];
          if (lastPt) {
            const snapped = snapTo8Directions(lastPt, normalizedX, normalizedY);
            pointX = snapped.x;
            pointY = snapped.y;
          }
        }
        
        if (cloudPoints.length === 0) {
          // First point
          setCloudPoints([{ x: pointX, y: pointY }]);
          setIsDrawingMarkup(true);
        } else {
          // Check if clicking near start point to close (for all polyline types)
          const startPt = cloudPoints[0];
          const dist = Math.sqrt(
            Math.pow((pointX - startPt.x) * canvasSize.width, 2) + 
            Math.pow((pointY - startPt.y) * canvasSize.height, 2)
          );
          
          // Close threshold - 15 pixels
          const closeThreshold = 15;
          const canClose = cloudPoints.length >= 3 && dist < closeThreshold;
          
          if (canClose) {
            // Close the polyline as a polygon
            const allX = cloudPoints.map(p => p.x);
            const allY = cloudPoints.map(p => p.y);
            const minX = Math.min(...allX);
            const maxX = Math.max(...allX);
            const minY = Math.min(...allY);
            const maxY = Math.max(...allY);
            
            const isCloud = markupMode === 'cloudPolyline';
            const isArrow = markupMode === 'polylineArrow';
            
            const newMarkup = {
              id: `${markupMode}_closed_${Date.now()}`,
              type: isCloud ? 'cloudPolyline' : 'polyline', // Keep cloud type for rendering
              points: [...cloudPoints],
              closed: true, // Mark as closed polygon
              startX: minX,
              startY: minY,
              endX: maxX,
              endY: maxY,
              color: markupColor,
              strokeWidth: markupStrokeWidth,
              fillColor: markupFillColor,
              strokeOpacity: markupStrokeOpacity,
              fillOpacity: markupFillOpacity,
              lineStyle: markupLineStyle,
              lineStyleName: markupLineStyleName || undefined,
              lineStylePattern: markupLineStylePattern || undefined,
              lineStyleRaw: markupLineStyleRaw || undefined,
              intensity: isCloud ? markupCloudIntensity : undefined,
              inverted: isCloud ? markupCloudInverted : undefined,
              arcSize: isCloud ? markupCloudArcSize : undefined,
              page: currentPage - 1,
              filename: currentFileIdentifier,
              author: markupAuthor,
              createdDate: new Date().toISOString()
            };
            addMarkupWithHistory(newMarkup);
            setCloudPoints([]);
            setMarkupPolylineMousePos(null);
            setIsDrawingMarkup(false);
          } else {
            // Add point immediately
            setCloudPoints(prev => [...prev, { x: pointX, y: pointY }]);
          }
        }
        e.preventDefault();
        return;
      } else if (markupMode === 'arrow' || markupMode === 'rectangle' || markupMode === 'circle' || markupMode === 'arc' || markupMode === 'line' || markupMode === 'cloud' || markupMode === 'callout') {
        // Default stroke to 1px for arrows and lines
        const defaultStroke = (markupMode === 'arrow' || markupMode === 'line') ? markupStrokeWidth : markupStrokeWidth;
        const isShapeWithFill = markupMode === 'rectangle' || markupMode === 'circle' || markupMode === 'cloud';
        const supportsLineStyle = markupMode === 'arrow' || markupMode === 'line' || markupMode === 'rectangle' || markupMode === 'circle' || markupMode === 'arc';
        
        // Arc uses different structure - 3-point arc with bulge
        if (markupMode === 'arc') {
          const newMarkup = {
            id: `arc_${Date.now()}`,
            type: 'arc',
            // 3-point arc: two endpoints + bulge factor
            point1X: normalizedX,
            point1Y: normalizedY,
            point2X: normalizedX,
            point2Y: normalizedY,
            arcBulge: 0.5, // Default to quarter-circle bulge (0=straight, 1=semicircle)
            color: markupColor,
            strokeWidth: defaultStroke,
            lineStyle: markupLineStyle,
            strokeOpacity: markupStrokeOpacity,
            opacity: markupOpacity,
            page: currentPage - 1,
            filename: currentFileIdentifier,
            author: markupAuthor,
            createdDate: new Date().toISOString()
          };
          currentMarkupRef.current = newMarkup;
          setCurrentMarkup(newMarkup);
        } else {
          const isArrowOrLine = markupMode === 'arrow' || markupMode === 'line';
          const newMarkup = {
            id: `${markupMode}_${Date.now()}`,
            type: markupMode,
            startX: normalizedX,
            startY: normalizedY,
            endX: normalizedX,
            endY: normalizedY,
            color: markupColor,
            strokeWidth: defaultStroke,
            // Add fill color for shapes
            fillColor: isShapeWithFill ? markupFillColor : undefined,
            // Add arrow head size for arrows
            arrowHeadSize: markupMode === 'arrow' ? markupArrowHeadSize : undefined,
            // Add line style for arrows, lines, rectangles, and circles
            lineStyle: supportsLineStyle ? markupLineStyle : undefined,
            // Named line style (e.g. "Software") for arrows and lines
            lineStyleName: (supportsLineStyle && markupLineStyleName) ? markupLineStyleName : undefined,
            lineStylePattern: (supportsLineStyle && markupLineStylePattern) ? markupLineStylePattern : undefined,
            lineStyleRaw: (supportsLineStyle && markupLineStyleRaw) ? markupLineStyleRaw : undefined,
            // Add separate opacities for shapes, arrows, and lines
            strokeOpacity: (isShapeWithFill || isArrowOrLine) ? markupStrokeOpacity : undefined,
            fillOpacity: isShapeWithFill ? markupFillOpacity : undefined,
            // Cloud-specific: inverted bumps, intensity, bulge, and arc size
            inverted: markupMode === 'cloud' ? markupCloudInverted : undefined,
            intensity: markupMode === 'cloud' ? markupCloudIntensity : undefined,
            bulge: markupMode === 'cloud' ? markupCloudBulge : undefined,
            arcSize: markupMode === 'cloud' ? markupCloudArcSize : undefined,
            opacity: markupOpacity,
            page: currentPage - 1,
            filename: currentFileIdentifier,
            author: markupAuthor,
            createdDate: new Date().toISOString()
          };
          currentMarkupRef.current = newMarkup;
          setCurrentMarkup(newMarkup);
        }
      }
      e.preventDefault();
      return;
    }
    
    // Handle subclass region drawing
    if (isDrawingSubclassRegion && pendingParentBox && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      
      // Check if click is within the parent box bounds
      const parentX = pendingParentBox.x * canvasSize.width;
      const parentY = pendingParentBox.y * canvasSize.height;
      const parentW = pendingParentBox.width * canvasSize.width;
      const parentH = pendingParentBox.height * canvasSize.height;
      
      if (x >= parentX && x <= parentX + parentW && y >= parentY && y <= parentY + parentH) {
        setIsDrawing(true);
        setDrawStart({ x, y });
        setCurrentRect({ x, y, width: 0, height: 0 });
        e.preventDefault();
      }
      return;
    }
    
    // Don't start new drawing if there's a shape awaiting confirmation
    if (pendingShape) {
      return;
    }
    
    if ((linkMode === 'train' || linkMode === 'create' || objectFinderMode === 'train' || objectFinderMode === 'create') && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      const normalizedX = x / canvasSize.width;
      const normalizedY = y / canvasSize.height;
      
      // Handle polyline mode - click to add points
      if ((objectFinderMode === 'train' || objectFinderMode === 'create') && drawingShapeType === 'polyline') {
        e.preventDefault();
        
        // Check if clicking near start point to close the shape
        if (polylinePoints.length >= 3) {
          const startPt = polylinePoints[0];
          const distToStart = Math.sqrt(
            Math.pow((normalizedX - startPt.x) * canvasSize.width, 2) + 
            Math.pow((normalizedY - startPt.y) * canvasSize.height, 2)
          );
          
          if (distToStart < 15) {
            // Close the polyline - calculate bounding box
            const allX = polylinePoints.map(p => p.x);
            const allY = polylinePoints.map(p => p.y);
            const minX = Math.min(...allX);
            const maxX = Math.max(...allX);
            const minY = Math.min(...allY);
            const maxY = Math.max(...allY);
            
            const newBox = {
              id: `obj_${Date.now()}`,
              x: minX,
              y: minY,
              width: maxX - minX,
              height: maxY - minY,
              page: currentPage - 1,
              shapeType: 'polyline',
              polylinePoints: [...polylinePoints], // Store the actual points
            };
            
            setPendingShape(newBox);
            setPolylinePoints([]);
            setPolylineMousePos(null);
            setIsNearStartPoint(false);
            return;
          }
        }
        
        // Add point (with shift-snap if applicable)
        let newPoint = { x: normalizedX, y: normalizedY };
        
        if (isShiftPressed && polylinePoints.length > 0) {
          const lastPt = polylinePoints[polylinePoints.length - 1];
          const dx = Math.abs(normalizedX - lastPt.x);
          const dy = Math.abs(normalizedY - lastPt.y);
          
          // Snap to horizontal or vertical based on which is closer
          if (dx > dy) {
            newPoint.y = lastPt.y; // Horizontal line
          } else {
            newPoint.x = lastPt.x; // Vertical line
          }
        }
        
        setPolylinePoints(prev => [...prev, newPoint]);
        return;
      }
      
      // Regular rectangle/circle drag
      setIsDrawing(true);
      setDrawStart({ x, y });
      setCurrentRect({ x, y, width: 0, height: 0 });
      e.preventDefault();
    } else if (panMode || e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({
        x: e.clientX,
        y: e.clientY,
        scrollLeft: containerRef.current.scrollLeft,
        scrollTop: containerRef.current.scrollTop
      });
    } else if (zoomMode && canvasRef.current) {
      // Start drawing zoom box in zoom mode
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      const normalizedX = Math.max(0, Math.min(1, x / canvasSize.width));
      const normalizedY = Math.max(0, Math.min(1, y / canvasSize.height));
      
      setIsDrawingZoomBox(true);
      setZoomBox({ startX: normalizedX, startY: normalizedY, endX: normalizedX, endY: normalizedY });
      e.preventDefault();
    }
  };

  // Handle double-click to edit text boxes
  const handleDoubleClick = (e) => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    const { x: clickX, y: clickY } = inverseTransformCoordinate(x / canvasSize.width, y / canvasSize.height);

    // Double-click to finish polyline without closing (open polyline)
    // The first click of double-click adds a point, so we use points without the last one
    if ((markupMode === 'polyline' || markupMode === 'polylineArrow' || markupMode === 'cloudPolyline') && cloudPoints.length >= 2) {
      // Remove the last point (added by first click of double-click)
      const pointsToSave = cloudPoints.slice(0, -1);
      
      // Need at least 2 points to save
      if (pointsToSave.length < 2) {
        setCloudPoints([]);
        setMarkupPolylineMousePos(null);
        setIsDrawingMarkup(false);
        e.preventDefault();
        return;
      }
      
      const allX = pointsToSave.map(p => p.x);
      const allY = pointsToSave.map(p => p.y);
      const minX = Math.min(...allX);
      const maxX = Math.max(...allX);
      const minY = Math.min(...allY);
      const maxY = Math.max(...allY);
      
      const isArrow = markupMode === 'polylineArrow';
      const isCloud = markupMode === 'cloudPolyline';
      const newMarkup = {
        id: `${isCloud ? 'cloudPolyline' : isArrow ? 'polylineArrow' : 'polyline'}_${Date.now()}`,
        type: isCloud ? 'cloudPolyline' : isArrow ? 'polylineArrow' : 'polyline',
        points: [...pointsToSave],
        closed: false, // Open polyline
        startX: minX,
        startY: minY,
        endX: maxX,
        endY: maxY,
        color: markupColor,
        strokeWidth: markupStrokeWidth,
        fillColor: markupFillColor,
        strokeOpacity: markupStrokeOpacity,
        fillOpacity: markupFillOpacity,
        lineStyle: markupLineStyle,
        lineStyleName: markupLineStyleName || undefined,
        lineStylePattern: markupLineStylePattern || undefined,
        lineStyleRaw: markupLineStyleRaw || undefined,
        arrowHeadSize: isArrow ? markupArrowHeadSize : undefined,
        intensity: isCloud ? markupCloudIntensity : undefined,
        bulge: isCloud ? markupCloudBulge : undefined,
        inverted: isCloud ? markupCloudInverted : undefined,
        arcSize: isCloud ? markupCloudArcSize : undefined,
        page: currentPage - 1,
        filename: currentFileIdentifier,
        author: markupAuthor,
        createdDate: new Date().toISOString()
      };
      addMarkupWithHistory(newMarkup);
      setCloudPoints([]);
      setMarkupPolylineMousePos(null);
      setIsDrawingMarkup(false);
      e.preventDefault();
      return;
    }
    
    // Find if we clicked on a text markup or shape that supports text
    const hitMarkup = hitTestMarkup(clickX, clickY);
    if (hitMarkup && (hitMarkup.type === 'text') && !hitMarkup.readOnly) {
      // Convert PDF annotation to editable format if needed (old format or custom appearance)
      let editableMarkup = hitMarkup;
      
      if (hitMarkup.type === 'text') {
        const needsConversion = 
          (hitMarkup.hasCustomAppearance && !hitMarkup.modified) ||
          (hitMarkup.x !== undefined && hitMarkup.startX === undefined);
        
        if (needsConversion) {
          editableMarkup = convertToEditableFormat(hitMarkup);
          // Update the markup in the list
          setMarkups(prev => prev.map(m => m.id === hitMarkup.id ? editableMarkup : m));
        }
      }
      
      // Enter edit mode
      setEditingTextMarkupId(editableMarkup.id);
      setTextEditValue(editableMarkup.text || '');
      setSelectedMarkup(editableMarkup);
      selectedMarkupRef.current = editableMarkup;
      e.preventDefault();
    }
  };

  const handleMouseMove = (e) => {
    if (!containerRef.current) return;
    
    // Handle symbol capture mode - update region selection
    if (symbolCaptureMode && captureRegion?.startX !== undefined && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const currentX = (e.clientX - rect.left) / rect.width;
      const currentY = (e.clientY - rect.top) / rect.height;
      
      setCaptureRegion(prev => ({
        ...prev,
        x: Math.min(prev.startX, currentX),
        y: Math.min(prev.startY, currentY),
        width: Math.abs(currentX - prev.startX),
        height: Math.abs(currentY - prev.startY)
      }));
      return;
    }
    
    // PERFORMANCE: Handle polyline preview FIRST - pure DOM manipulation, no state updates
    if ((markupMode === 'polyline' || markupMode === 'polylineArrow' || markupMode === 'cloudPolyline') && cloudPoints.length > 0 && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      let { x: normalizedX, y: normalizedY } = inverseTransformCoordinate(x / canvasSize.width, y / canvasSize.height);

      // Apply shift-snap preview (8 directions)
      if (isShiftPressed && cloudPoints.length > 0) {
        const lastPt = cloudPoints[cloudPoints.length - 1];
        if (lastPt) {
          const dx = normalizedX - lastPt.x;
          const dy = normalizedY - lastPt.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0.001) {
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            const snapAngle = Math.round(angle / 45) * 45;
            const snapRad = snapAngle * Math.PI / 180;
            normalizedX = lastPt.x + dist * Math.cos(snapRad);
            normalizedY = lastPt.y + dist * Math.sin(snapRad);
          }
        }
      }
      
      const dpPoly = transformCoordinate(normalizedX, normalizedY);
      const pixelX = dpPoly.x * canvasSize.width * scale;
      const pixelY = dpPoly.y * canvasSize.height * scale;
      
      // Direct DOM update for preview line
      const previewLine = document.querySelector('[data-polyline-preview="main"]');
      if (previewLine) {
        previewLine.setAttribute('x2', pixelX);
        previewLine.setAttribute('y2', pixelY);
      }
      
      // Update arrowhead for polylineArrow mode
      if (markupMode === 'polylineArrow') {
        const arrowhead = document.querySelector('[data-polyline-preview="arrowhead"]');
        const lastPt = cloudPoints[cloudPoints.length - 1];
        if (arrowhead && lastPt) {
          const dpLast = transformCoordinate(lastPt.x, lastPt.y);
          const startX = dpLast.x * canvasSize.width * scale;
          const startY = dpLast.y * canvasSize.height * scale;
          const angle = Math.atan2(pixelY - startY, pixelX - startX);
          const arrowLength = markupArrowHeadSize * scale;
          const arrowAngle = Math.PI / 7;
          arrowhead.setAttribute('points', `
            ${pixelX},${pixelY}
            ${pixelX - arrowLength * Math.cos(angle - arrowAngle)},${pixelY - arrowLength * Math.sin(angle - arrowAngle)}
            ${pixelX - arrowLength * Math.cos(angle + arrowAngle)},${pixelY - arrowLength * Math.sin(angle + arrowAngle)}
          `);
        }
      }
      
      // Check if near start point for closing polygon
      const startPt = cloudPoints[0];
      if (startPt && cloudPoints.length >= 3) {
        const dpStartPt = transformCoordinate(startPt.x, startPt.y);
        const distToStart = Math.sqrt(
          Math.pow(pixelX - dpStartPt.x * canvasSize.width * scale, 2) +
          Math.pow(pixelY - dpStartPt.y * canvasSize.height * scale, 2)
        );
        const closeLine = document.querySelector('[data-polyline-preview="close"]');
        const startCircle = document.querySelector('[data-polyline-start="true"]');
        
        if (distToStart < 15) {
          if (closeLine) {
            closeLine.setAttribute('x1', pixelX);
            closeLine.setAttribute('y1', pixelY);
            closeLine.style.display = '';
          }
          if (startCircle) {
            startCircle.setAttribute('r', '10');
            startCircle.style.filter = 'drop-shadow(0 0 4px #27ae60)';
            startCircle.setAttribute('stroke-width', '2');
          }
          const closeHint = document.querySelector('[data-polyline-close-hint="true"]');
          if (closeHint) closeHint.style.display = '';
          // Hide arrowhead when about to close
          const arrowhead = document.querySelector('[data-polyline-preview="arrowhead"]');
          if (arrowhead) arrowhead.style.display = 'none';
          // Show fill preview when about to close
          const fillPreview = document.querySelector('[data-polyline-fill-preview="true"]');
          if (fillPreview) fillPreview.style.display = '';
        } else {
          if (closeLine) {
            closeLine.style.display = 'none';
          }
          if (startCircle) {
            startCircle.setAttribute('r', '6');
            startCircle.style.filter = '';
            startCircle.setAttribute('stroke-width', '1.5');
          }
          const closeHint = document.querySelector('[data-polyline-close-hint="true"]');
          if (closeHint) closeHint.style.display = 'none';
          // Show arrowhead when not closing
          const arrowhead = document.querySelector('[data-polyline-preview="arrowhead"]');
          if (arrowhead) arrowhead.style.display = '';
          // Hide fill preview when not closing
          const fillPreview = document.querySelector('[data-polyline-fill-preview="true"]');
          if (fillPreview) fillPreview.style.display = 'none';
        }
      }
      return; // Exit early - no other processing needed
    }
    
    // Note: Selection box drawing is handled by global mousemove handler
    // to ensure it works even when mouse moves over the SVG overlay
    
    // Handle multi-markup dragging
    if (isDraggingMarkupRef.current && markupDragStartRef.current?.isMultiDrag && selectedMarkupsRef.current.length > 0 && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      const { x: currentX, y: currentY } = inverseTransformCoordinate(x / canvasSize.width, y / canvasSize.height);

      const deltaX = currentX - markupDragStartRef.current.x;
      const deltaY = currentY - markupDragStartRef.current.y;

      // Store pending update
      pendingMarkupUpdateRef.current = {
        type: 'multiMove',
        deltaX,
        deltaY,
        selectedIds: selectedMarkupsRef.current.map(m => m.id),
        newDragStart: { ...markupDragStartRef.current, x: currentX, y: currentY }
      };
      
      // Update refs immediately
      markupDragStartRef.current = { ...markupDragStartRef.current, x: currentX, y: currentY };
      
      // Throttle state updates with rAF
      if (!markupDragRafRef.current) {
        markupDragRafRef.current = requestAnimationFrame(() => {
          markupDragRafRef.current = null;
          const pending = pendingMarkupUpdateRef.current;
          if (!pending || pending.type !== 'multiMove') return;
          
          // Move all selected markups
          setMarkups(prev => prev.map(m => {
            if (!pending.selectedIds.includes(m.id) || m.readOnly) return m;
            
            if (m.type === 'pen' || m.type === 'highlighter') {
              return {
                ...m,
                points: m.points.map(p => ({ x: p.x + pending.deltaX, y: p.y + pending.deltaY })),
                modified: m.fromPdf ? true : m.modified
              };
            } else if (m.type === 'polyline' || m.type === 'polylineArrow' || m.type === 'cloudPolyline' || m.type === 'polygon') {
              return {
                ...m,
                points: m.points.map(p => ({ x: p.x + pending.deltaX, y: p.y + pending.deltaY })),
                modified: m.fromPdf ? true : m.modified
              };
            } else if (m.type === 'arc') {
              return {
                ...m,
                point1X: m.point1X + pending.deltaX,
                point1Y: m.point1Y + pending.deltaY,
                point2X: m.point2X + pending.deltaX,
                point2Y: m.point2Y + pending.deltaY,
                modified: m.fromPdf ? true : m.modified
              };
            } else if (m.startX !== undefined) {
              return {
                ...m,
                startX: m.startX + pending.deltaX,
                startY: m.startY + pending.deltaY,
                endX: m.endX + pending.deltaX,
                endY: m.endY + pending.deltaY,
                modified: m.fromPdf ? true : m.modified
              };
            } else if (m.x !== undefined) {
              return {
                ...m,
                x: m.x + pending.deltaX,
                y: m.y + pending.deltaY,
                modified: m.fromPdf ? true : m.modified
              };
            }
            return m;
          }));
          
          // Update selected markups refs
          const updateMarkupPosition = (m) => {
            if (m.readOnly) return m;
            if (m.type === 'pen' || m.type === 'highlighter' || m.type === 'polyline' || m.type === 'polylineArrow' || m.type === 'cloudPolyline' || m.type === 'polygon') {
              return { ...m, points: m.points.map(p => ({ x: p.x + pending.deltaX, y: p.y + pending.deltaY })) };
            } else if (m.type === 'arc') {
              return { ...m, point1X: m.point1X + pending.deltaX, point1Y: m.point1Y + pending.deltaY, point2X: m.point2X + pending.deltaX, point2Y: m.point2Y + pending.deltaY };
            } else if (m.startX !== undefined) {
              return { ...m, startX: m.startX + pending.deltaX, startY: m.startY + pending.deltaY, endX: m.endX + pending.deltaX, endY: m.endY + pending.deltaY };
            } else if (m.x !== undefined) {
              return { ...m, x: m.x + pending.deltaX, y: m.y + pending.deltaY };
            }
            return m;
          };
          
          setSelectedMarkups(prev => prev.map(updateMarkupPosition));
          selectedMarkupsRef.current = selectedMarkupsRef.current.map(updateMarkupPosition);
          setMarkupDragStart(pending.newDragStart);
        });
      }
      return;
    }
    
    // Handle individual polyline point dragging
    if (isDraggingMarkupRef.current && draggingPolylinePointRef.current !== null && selectedMarkupRef.current && markupDragStartRef.current && canvasRef.current) {
      // Use markupDragStartRef as the drag tracking ref (aliased for compatibility)
      const dragRef = markupDragStartRef;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      const currentX = x / canvasSize.width;
      const currentY = y / canvasSize.height;
      
      const pointIndex = draggingPolylinePointRef.current;
      
      // Track if there was significant movement
      const deltaX = currentX - dragRef.current.x;
      const deltaY = currentY - dragRef.current.y;
      if (Math.abs(deltaX) > 0.001 || Math.abs(deltaY) > 0.001) {
        didDragMoveRef.current = true;
      }
      
      // Store original points on first move
      if (!dragRef.current.originalPoints) {
        dragRef.current.originalPoints = [...(selectedMarkupRef.current.points || [])];
        dragRef.current.markupEl = document.querySelector(`[data-markup-id="${selectedMarkupRef.current.id}"]`);
        dragRef.current.handlesEl = document.querySelector('.markup-selection');
        dragRef.current.originalX = dragRef.current.x;
        dragRef.current.originalY = dragRef.current.y;
      }
      
      // Calculate total delta from original position
      const totalDeltaX = currentX - dragRef.current.originalX;
      const totalDeltaY = currentY - dragRef.current.originalY;
      
      // Store for mouseUp
      dragRef.current.totalDeltaX = totalDeltaX;
      dragRef.current.totalDeltaY = totalDeltaY;
      dragRef.current.pointIndex = pointIndex;
      
      // Calculate new point position
      const origPoint = dragRef.current.originalPoints[pointIndex];
      const newPointX = origPoint.x + totalDeltaX;
      const newPointY = origPoint.y + totalDeltaY;
      
      // PERFORMANCE: Direct DOM manipulation for polyline
      const markupEl = dragRef.current.markupEl;
      if (markupEl) {
        // For regular polyline, markupEl IS the path. For polylineArrow/cloudPolyline, it's a <g> containing the path
        // Use toLowerCase() for case-insensitive comparison (SVG tagNames can vary)
        const tagName = markupEl.tagName.toLowerCase();
        const pathEl = tagName === 'path' ? markupEl : markupEl.querySelector('path');
        
        if (pathEl) {
          // Rebuild path with updated point
          const newPoints = dragRef.current.originalPoints.map((p, i) => {
            if (i === pointIndex) {
              return { x: newPointX, y: newPointY };
            }
            return p;
          });
          
          const scaledW = canvasSize.width * scale;
          const scaledH = canvasSize.height * scale;
          
          // Check markup type for path generation
          const markupType = selectedMarkupRef.current.type;
          
          if (markupType === 'cloudPolyline') {
            // Cloud polyline - use arc bumps between points
            let pathData = '';
            const intensity = selectedMarkupRef.current.intensity || 1.0;
            const inverted = selectedMarkupRef.current.inverted || false;
            const bumpDir = inverted ? -1 : 1;
            
            for (let i = 0; i < newPoints.length - 1; i++) {
              const p1 = newPoints[i];
              const p2 = newPoints[i + 1];
              const x1 = p1.x * scaledW;
              const y1 = p1.y * scaledH;
              const x2 = p2.x * scaledW;
              const y2 = p2.y * scaledH;
              
              const segLen = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
              const bumpSize = Math.min(segLen * 0.3, 20 * scale) * intensity;
              const numBumps = Math.max(1, Math.floor(segLen / (bumpSize * 2)));
              
              for (let b = 0; b < numBumps; b++) {
                const t1 = b / numBumps;
                const t2 = (b + 1) / numBumps;
                const bx1 = x1 + (x2 - x1) * t1;
                const by1 = y1 + (y2 - y1) * t1;
                const bx2 = x1 + (x2 - x1) * t2;
                const by2 = y1 + (y2 - y1) * t2;
                
                const midX = (bx1 + bx2) / 2;
                const midY = (by1 + by2) / 2;
                const dx = bx2 - bx1;
                const dy = by2 - by1;
                const len = Math.sqrt(dx * dx + dy * dy);
                const nx = len > 0 ? -dy / len : 0;
                const ny = len > 0 ? dx / len : 1;
                const ctrlX = midX + nx * bumpSize * bumpDir;
                const ctrlY = midY + ny * bumpSize * bumpDir;
                
                if (i === 0 && b === 0) {
                  pathData += `M ${bx1} ${by1} `;
                }
                pathData += `Q ${ctrlX} ${ctrlY} ${bx2} ${by2} `;
              }
            }
            pathEl.setAttribute('d', pathData);
          } else if (markupType === 'polylineArrow') {
            // Polyline arrow - need to shorten last segment for arrowhead
            const lastIdx = newPoints.length - 1;
            if (lastIdx >= 1) {
              const lastPt = newPoints[lastIdx];
              const prevPt = newPoints[lastIdx - 1];
              const endX = lastPt.x * scaledW;
              const endY = lastPt.y * scaledH;
              const startX = prevPt.x * scaledW;
              const startY = prevPt.y * scaledH;
              const angle = Math.atan2(endY - startY, endX - startX);
              const arrowLength = (selectedMarkupRef.current.arrowHeadSize || 12) * scale;
              const lineEndX = endX - arrowLength * 0.7 * Math.cos(angle);
              const lineEndY = endY - arrowLength * 0.7 * Math.sin(angle);
              
              let pathData = '';
              for (let i = 0; i < newPoints.length; i++) {
                const p = newPoints[i];
                if (i === 0) {
                  pathData += `M ${p.x * scaledW} ${p.y * scaledH}`;
                } else if (i === lastIdx) {
                  pathData += ` L ${lineEndX} ${lineEndY}`;
                } else {
                  pathData += ` L ${p.x * scaledW} ${p.y * scaledH}`;
                }
              }
              pathEl.setAttribute('d', pathData);
            }
          } else {
            // Regular polyline
            const pathData = newPoints.map((p, i) => 
              `${i === 0 ? 'M' : 'L'} ${p.x * scaledW} ${p.y * scaledH}`
            ).join(' ');
            pathEl.setAttribute('d', pathData);
          }
        }
        
        // Update arrowhead for polylineArrow
        if (selectedMarkupRef.current.type === 'polylineArrow') {
          const polygonEl = markupEl.querySelector('polygon');
          if (polygonEl && dragRef.current.originalPoints.length >= 2) {
            const newPoints2 = dragRef.current.originalPoints.map((p, i) => {
              if (i === pointIndex) return { x: newPointX, y: newPointY };
              return p;
            });
            const lastIdx = newPoints2.length - 1;
            const p1 = newPoints2[lastIdx - 1];
            const p2 = newPoints2[lastIdx];
            const x1 = p1.x * canvasSize.width * scale;
            const y1 = p1.y * canvasSize.height * scale;
            const x2 = p2.x * canvasSize.width * scale;
            const y2 = p2.y * canvasSize.height * scale;
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const arrowLength = (selectedMarkupRef.current.arrowHeadSize || 12) * scale;
            const arrowAngle = Math.PI / 7;
            
            polygonEl.setAttribute('points', `
              ${x2},${y2}
              ${x2 - arrowLength * Math.cos(angle - arrowAngle)},${y2 - arrowLength * Math.sin(angle - arrowAngle)}
              ${x2 - arrowLength * Math.cos(angle + arrowAngle)},${y2 - arrowLength * Math.sin(angle + arrowAngle)}
            `);
          }
        }
      }
      
      // Update the dragged handle position AND the connecting lines
      const handlesEl = dragRef.current.handlesEl;
      if (handlesEl) {
        const scaledW = canvasSize.width * scale;
        const scaledH = canvasSize.height * scale;
        
        // Build new points array for updating lines
        const newPoints = dragRef.current.originalPoints.map((p, i) => {
          if (i === pointIndex) {
            return { x: newPointX, y: newPointY };
          }
          return p;
        });
        
        const numPoints = newPoints.length;
        const isClosed = selectedMarkupRef.current.closed;
        
        // Update circles
        const circles = handlesEl.querySelectorAll('circle[data-point-index]');
        circles.forEach(circle => {
          const idx = parseInt(circle.getAttribute('data-point-index'));
          if (idx === pointIndex) {
            circle.setAttribute('cx', newPointX * scaledW);
            circle.setAttribute('cy', newPointY * scaledH);
          }
        });
        
        // Update connecting lines in the selection handles
        // Lines: lineIdx 0 connects points 0→1, lineIdx 1 connects 1→2, etc.
        // For closed shapes, the last line connects (n-1)→0
        const lines = handlesEl.querySelectorAll('line');
        const numRegularLines = numPoints - 1; // Lines connecting consecutive points
        
        lines.forEach((line, lineIdx) => {
          let fromIdx, toIdx;
          
          if (lineIdx < numRegularLines) {
            // Regular line: connects point[lineIdx] → point[lineIdx+1]
            fromIdx = lineIdx;
            toIdx = lineIdx + 1;
          } else if (isClosed && lineIdx === numRegularLines) {
            // Closing line: connects last point → first point
            fromIdx = numPoints - 1;
            toIdx = 0;
          } else {
            return; // Unknown line, skip
          }
          
          if (fromIdx < numPoints && toIdx < numPoints) {
            const fromPt = newPoints[fromIdx];
            const toPt = newPoints[toIdx];
            if (fromPt && toPt) {
              line.setAttribute('x1', fromPt.x * scaledW);
              line.setAttribute('y1', fromPt.y * scaledH);
              line.setAttribute('x2', toPt.x * scaledW);
              line.setAttribute('y2', toPt.y * scaledH);
            }
          }
        });
      }
      
      return;
    }
    
    // Handle single markup dragging (using refs for synchronous access)
    if (isDraggingMarkupRef.current && selectedMarkupRef.current && markupDragStartRef.current && canvasRef.current) {
      // Store mouse position for RAF callback
      if (!markupDragStartRef.current.pendingMouseEvent) {
        markupDragStartRef.current.pendingMouseEvent = e;
        
        // Use RAF to batch updates - only process once per frame
        requestAnimationFrame(() => {
          const mouseEvent = markupDragStartRef.current?.pendingMouseEvent;
          if (!mouseEvent || !markupDragStartRef.current || !selectedMarkupRef.current || !canvasRef.current) {
            if (markupDragStartRef.current) markupDragStartRef.current.pendingMouseEvent = null;
            return;
          }
          
          const canvas = canvasRef.current;
          const rect = canvas.getBoundingClientRect();
          const x = (mouseEvent.clientX - rect.left) / scale;
          const y = (mouseEvent.clientY - rect.top) / scale;
          const { x: currentX, y: currentY } = inverseTransformCoordinate(x / canvasSize.width, y / canvasSize.height);

          // Store original position on first move (for offset calculation)
          if (markupDragStartRef.current.originalX === undefined) {
            markupDragStartRef.current.originalX = markupDragStartRef.current.x;
            markupDragStartRef.current.originalY = markupDragStartRef.current.y;
            // Cache DOM elements on first move for faster access
            markupDragStartRef.current.markupEl = document.querySelector(`[data-markup-id="${selectedMarkupRef.current.id}"]`);
            markupDragStartRef.current.handlesEl = document.querySelector('.markup-selection');
            // Store base transforms
            if (markupDragStartRef.current.markupEl) {
              markupDragStartRef.current.markupBaseTransform = markupDragStartRef.current.markupEl.getAttribute('transform') || '';
            }
            if (markupDragStartRef.current.handlesEl) {
              markupDragStartRef.current.handlesBaseTransform = markupDragStartRef.current.handlesEl.getAttribute('transform') || '';
            }
          }
          
          // Calculate offset from original position (not incremental)
          const offsetX = currentX - markupDragStartRef.current.originalX;
          const offsetY = currentY - markupDragStartRef.current.originalY;
          
          // Track if there was significant movement
          if (Math.abs(offsetX) > 0.001 || Math.abs(offsetY) > 0.001) {
            didDragMoveRef.current = true;
          }
          
          // Store offset for final application on mouseUp
          dragOffsetRef.current = { x: offsetX, y: offsetY };
          
          // Direct DOM manipulation using cached elements
          const pixelOffsetX = offsetX * canvasSize.width * scale;
          const pixelOffsetY = offsetY * canvasSize.height * scale;
          
          const markupEl = markupDragStartRef.current.markupEl;
          
          // Use CSS transform for ALL markup types during drag
          const translateTransform = `translate(${pixelOffsetX}, ${pixelOffsetY})`;
          
          if (markupEl) {
            markupEl.setAttribute('transform', translateTransform + ' ' + markupDragStartRef.current.markupBaseTransform);
          }
          
          // Update selection handles  
          const handlesEl = markupDragStartRef.current.handlesEl;
          if (handlesEl) {
            handlesEl.setAttribute('transform', translateTransform + ' ' + markupDragStartRef.current.handlesBaseTransform);
          }
          
          // Clear pending event
          markupDragStartRef.current.pendingMouseEvent = null;
        });
      } else {
        // Update pending event with latest position
        markupDragStartRef.current.pendingMouseEvent = e;
      }
      return;
    }
    
    // Handle markup rotation
    if (isRotatingMarkupRef.current && selectedMarkupRef.current && rotationStartRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      // Use pixel coordinates (not divided by scale) to match centerX/centerY
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      const { centerX, centerY, startAngle, initialRotation } = rotationStartRef.current;
      
      // Calculate current angle from center to mouse (both in pixel coords)
      const currentAngle = Math.atan2(mouseY - centerY, mouseX - centerX) * 180 / Math.PI;
      const deltaAngle = currentAngle - startAngle;
      let newRotation = initialRotation + deltaAngle;
      
      // Snap to 15 degree increments if shift is held
      if (e.shiftKey) {
        newRotation = Math.round(newRotation / 15) * 15;
      }
      
      // Normalize to 0-360
      newRotation = ((newRotation % 360) + 360) % 360;
      
      // Store for mouseUp
      rotationStartRef.current.currentRotation = newRotation;
      
      // Cache DOM elements on first move
      if (!rotationStartRef.current.markupEl) {
        rotationStartRef.current.markupEl = document.querySelector(`[data-markup-id="${selectedMarkupRef.current.id}"]`);
        rotationStartRef.current.handlesEl = document.querySelector('.markup-selection');
      }
      
      // centerX/centerY are already in pixel coordinates (from selection handles)
      const pixelCenterX = centerX;
      const pixelCenterY = centerY;
      
      // PERFORMANCE: Direct DOM manipulation for rotation preview
      const markupEl = rotationStartRef.current.markupEl;
      if (markupEl) {
        // For text boxes, we need to remove any existing rotation transform first
        // and apply the new one. The markup might have an existing rotation in its data.
        markupEl.setAttribute('transform', `rotate(${newRotation}, ${pixelCenterX}, ${pixelCenterY})`);
      }
      
      // Update selection handles rotation
      const handlesEl = rotationStartRef.current.handlesEl;
      if (handlesEl) {
        handlesEl.setAttribute('transform', `rotate(${newRotation}, ${pixelCenterX}, ${pixelCenterY})`);
      }
      
      return;
    }
    
    // Handle markup resizing (using refs for synchronous access)
    if (isResizingMarkupRef.current && selectedMarkupRef.current && resizeHandleRef.current && markupDragStartRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      const { x: currentX, y: currentY } = inverseTransformCoordinate(x / canvasSize.width, y / canvasSize.height);

      // Calculate total delta from original position (not incremental)
      if (markupDragStartRef.current.originalX === undefined) {
        markupDragStartRef.current.originalX = markupDragStartRef.current.x;
        markupDragStartRef.current.originalY = markupDragStartRef.current.y;
        markupDragStartRef.current.originalBounds = { ...markupDragStartRef.current.bounds };
        // Cache DOM elements
        markupDragStartRef.current.markupEl = document.querySelector(`[data-markup-id="${selectedMarkupRef.current.id}"]`);
        markupDragStartRef.current.handlesEl = document.querySelector('.markup-selection');
      }
      
      let totalDeltaX = currentX - markupDragStartRef.current.originalX;
      let totalDeltaY = currentY - markupDragStartRef.current.originalY;
      
      // For rotated shapes, un-rotate the delta into the shape's local coordinate space
      const resizeRotation = markupDragStartRef.current.rotation || 0;
      if (resizeRotation) {
        const rot = -resizeRotation * Math.PI / 180;
        const cosR = Math.cos(rot), sinR = Math.sin(rot);
        const hw = (canvasSize.height || 1) / (canvasSize.width || 1);
        const rawDX = totalDeltaX, rawDY = totalDeltaY;
        totalDeltaX = rawDX * cosR - rawDY * hw * sinR;
        totalDeltaY = rawDX / hw * sinR + rawDY * cosR;
      }
      
      const currentResizeHandle = resizeHandleRef.current;
      const origBounds = markupDragStartRef.current.originalBounds;
      
      // Store resize info for mouseUp
      markupDragStartRef.current.resizeDeltaX = totalDeltaX;
      markupDragStartRef.current.resizeDeltaY = totalDeltaY;
      
      // Calculate new bounds based on handle
      let newMinX = origBounds.minX, newMinY = origBounds.minY;
      let newMaxX = origBounds.maxX, newMaxY = origBounds.maxY;
      
      if (currentResizeHandle.includes('w')) newMinX = origBounds.minX + totalDeltaX;
      if (currentResizeHandle.includes('e')) newMaxX = origBounds.maxX + totalDeltaX;
      if (currentResizeHandle.includes('n')) newMinY = origBounds.minY + totalDeltaY;
      if (currentResizeHandle.includes('s')) newMaxY = origBounds.maxY + totalDeltaY;
      
      // For rotated shapes, compensate for the rotation center shift
      // so the anchor point (opposite corner/edge) stays fixed in world space
      if (resizeRotation) {
        const theta = resizeRotation * Math.PI / 180;
        const cosT = Math.cos(theta), sinT = Math.sin(theta);
        const W = canvasSize.width || 1, H = canvasSize.height || 1;
        
        // Determine anchor point in local (unrotated) space - opposite of dragged handle
        const anchorMap = {
          'nw': { x: origBounds.maxX, y: origBounds.maxY },
          'n':  { x: (origBounds.minX + origBounds.maxX) / 2, y: origBounds.maxY },
          'ne': { x: origBounds.minX, y: origBounds.maxY },
          'e':  { x: origBounds.minX, y: (origBounds.minY + origBounds.maxY) / 2 },
          'se': { x: origBounds.minX, y: origBounds.minY },
          's':  { x: (origBounds.minX + origBounds.maxX) / 2, y: origBounds.minY },
          'sw': { x: origBounds.maxX, y: origBounds.minY },
          'w':  { x: origBounds.maxX, y: (origBounds.minY + origBounds.maxY) / 2 },
        };
        const anchor = anchorMap[currentResizeHandle];
        if (anchor) {
          // Old center and anchor world position
          const oldCX = (origBounds.minX + origBounds.maxX) / 2;
          const oldCY = (origBounds.minY + origBounds.maxY) / 2;
          const oldAnchorWX = oldCX + (anchor.x - oldCX) * cosT - (anchor.y - oldCY) * (H / W) * sinT;
          const oldAnchorWY = oldCY + (anchor.x - oldCX) * (W / H) * sinT + (anchor.y - oldCY) * cosT;
          
          // New center and anchor world position (anchor local coords stay the same)
          const newCX = (newMinX + newMaxX) / 2;
          const newCY = (newMinY + newMaxY) / 2;
          const newAnchorWX = newCX + (anchor.x - newCX) * cosT - (anchor.y - newCY) * (H / W) * sinT;
          const newAnchorWY = newCY + (anchor.x - newCX) * (W / H) * sinT + (anchor.y - newCY) * cosT;
          
          // Shift bounds so anchor stays in same world position
          const shiftX = oldAnchorWX - newAnchorWX;
          const shiftY = oldAnchorWY - newAnchorWY;
          newMinX += shiftX;
          newMaxX += shiftX;
          newMinY += shiftY;
          newMaxY += shiftY;
        }
      }
      
      // Store compensated bounds for mouseUp final commit
      markupDragStartRef.current.compensatedBounds = { minX: newMinX, minY: newMinY, maxX: newMaxX, maxY: newMaxY };
      
      // Handle arrow/line endpoint dragging
      if ((selectedMarkupRef.current.type === 'arrow' || selectedMarkupRef.current.type === 'line') && 
          (currentResizeHandle === 'start' || currentResizeHandle === 'end')) {
        const markupEl = markupDragStartRef.current.markupEl;
        if (markupEl) {
          const orig = markupDragStartRef.current.originalMarkup || selectedMarkupRef.current;
          if (!markupDragStartRef.current.originalMarkup) {
            markupDragStartRef.current.originalMarkup = { ...selectedMarkupRef.current };
          }
          
          if (currentResizeHandle === 'start') {
            const newX = (orig.startX + totalDeltaX) * canvasSize.width * scale;
            const newY = (orig.startY + totalDeltaY) * canvasSize.height * scale;
            const lineEl = markupEl.querySelector('line');
            if (lineEl) {
              lineEl.setAttribute('x1', newX);
              lineEl.setAttribute('y1', newY);
            }
          } else {
            const newX = (orig.endX + totalDeltaX) * canvasSize.width * scale;
            const newY = (orig.endY + totalDeltaY) * canvasSize.height * scale;
            const lineEl = markupEl.querySelector('line');
            const polygonEl = markupEl.querySelector('polygon');
            if (lineEl) {
              // For arrows, recalculate the line end and arrowhead
              if (selectedMarkupRef.current.type === 'arrow' && polygonEl) {
                const x1 = parseFloat(lineEl.getAttribute('x1'));
                const y1 = parseFloat(lineEl.getAttribute('y1'));
                const angle = Math.atan2(newY - y1, newX - x1);
                const arrowLength = (selectedMarkupRef.current.arrowHeadSize || 12) * scale;
                const arrowAngle = Math.PI / 7;
                const lineEndX = newX - arrowLength * 0.7 * Math.cos(angle);
                const lineEndY = newY - arrowLength * 0.7 * Math.sin(angle);
                lineEl.setAttribute('x2', lineEndX);
                lineEl.setAttribute('y2', lineEndY);
                polygonEl.setAttribute('points', `
                  ${newX},${newY}
                  ${newX - arrowLength * Math.cos(angle - arrowAngle)},${newY - arrowLength * Math.sin(angle - arrowAngle)}
                  ${newX - arrowLength * Math.cos(angle + arrowAngle)},${newY - arrowLength * Math.sin(angle + arrowAngle)}
                `);
              } else {
                lineEl.setAttribute('x2', newX);
                lineEl.setAttribute('y2', newY);
              }
            }
          }
        }
        // Update selection handles position
        const handlesEl = markupDragStartRef.current.handlesEl;
        if (handlesEl) {
          const circles = handlesEl.querySelectorAll('circle');
          circles.forEach(circle => {
            const handle = circle.getAttribute('data-handle');
            if (handle === currentResizeHandle) {
              const orig = markupDragStartRef.current.originalMarkup || selectedMarkupRef.current;
              if (currentResizeHandle === 'start') {
                circle.setAttribute('cx', (orig.startX + totalDeltaX) * canvasSize.width * scale);
                circle.setAttribute('cy', (orig.startY + totalDeltaY) * canvasSize.height * scale);
              } else {
                circle.setAttribute('cx', (orig.endX + totalDeltaX) * canvasSize.width * scale);
                circle.setAttribute('cy', (orig.endY + totalDeltaY) * canvasSize.height * scale);
              }
            }
          });
        }
        return;
      }
      
      // PERFORMANCE: Direct DOM manipulation for rect/ellipse resize
      const markupEl = markupDragStartRef.current.markupEl;
      if (markupEl) {
        const pixelMinX = newMinX * canvasSize.width * scale;
        const pixelMinY = newMinY * canvasSize.height * scale;
        const pixelW = (newMaxX - newMinX) * canvasSize.width * scale;
        const pixelH = (newMaxY - newMinY) * canvasSize.height * scale;
        
        // Update rotation transform center for rotated shapes
        if (resizeRotation && markupEl.tagName === 'g') {
          const newCX = pixelMinX + Math.abs(pixelW) / 2;
          const newCY = pixelMinY + Math.abs(pixelH) / 2;
          markupEl.setAttribute('transform', `rotate(${resizeRotation}, ${newCX}, ${newCY})`);
        }
        
        const rectEl = markupEl.querySelector('rect');
        const ellipseEl = markupEl.querySelector('ellipse');
        const foreignEl = markupEl.querySelector('foreignObject');
        
        if (rectEl) {
          rectEl.setAttribute('x', pixelMinX);
          rectEl.setAttribute('y', pixelMinY);
          rectEl.setAttribute('width', Math.abs(pixelW));
          rectEl.setAttribute('height', Math.abs(pixelH));
        }
        if (ellipseEl) {
          ellipseEl.setAttribute('cx', pixelMinX + Math.abs(pixelW) / 2);
          ellipseEl.setAttribute('cy', pixelMinY + Math.abs(pixelH) / 2);
          ellipseEl.setAttribute('rx', Math.abs(pixelW) / 2);
          ellipseEl.setAttribute('ry', Math.abs(pixelH) / 2);
        }
        if (foreignEl) {
          foreignEl.setAttribute('x', pixelMinX);
          foreignEl.setAttribute('y', pixelMinY);
          foreignEl.setAttribute('width', Math.abs(pixelW));
          foreignEl.setAttribute('height', Math.abs(pixelH));
        }
        
        // Cloud path regeneration during resize
        const pathEl = markupEl.querySelector('path');
        if (pathEl && selectedMarkupRef.current.type === 'cloud') {
          const x = pixelMinX, y = pixelMinY;
          const w = Math.abs(pixelW), h = Math.abs(pixelH);
          const inverted = selectedMarkupRef.current.inverted || false;
          const refSize = 800;
          const normW = (newMaxX - newMinX) * refSize;
          const normH = (newMaxY - newMinY) * refSize;
          const targetArcDiameter = selectedMarkupRef.current.arcSize || 15;
          const normPerimeter = 2 * (Math.abs(normW) + Math.abs(normH));
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
          pathEl.setAttribute('d', cloudPath);
        }
      }
      
      // Update selection handles
      const handlesEl = markupDragStartRef.current.handlesEl;
      if (handlesEl) {
        const pixelMinX = newMinX * canvasSize.width * scale;
        const pixelMinY = newMinY * canvasSize.height * scale;
        const pixelMaxX = newMaxX * canvasSize.width * scale;
        const pixelMaxY = newMaxY * canvasSize.height * scale;
        const pixelMidX = (pixelMinX + pixelMaxX) / 2;
        const pixelMidY = (pixelMinY + pixelMaxY) / 2;
        
        // Update rotation transform center for rotated shapes
        if (resizeRotation) {
          handlesEl.setAttribute('transform', `rotate(${resizeRotation}, ${pixelMidX}, ${pixelMidY})`);
        }
        
        // Update selection border rect
        const selRect = handlesEl.querySelector('rect');
        if (selRect) {
          selRect.setAttribute('x', Math.min(pixelMinX, pixelMaxX));
          selRect.setAttribute('y', Math.min(pixelMinY, pixelMaxY));
          selRect.setAttribute('width', Math.abs(pixelMaxX - pixelMinX));
          selRect.setAttribute('height', Math.abs(pixelMaxY - pixelMinY));
        }
        
        // Position map for handle locations
        const absMinX = Math.min(pixelMinX, pixelMaxX);
        const absMinY = Math.min(pixelMinY, pixelMaxY);
        const absMaxX = Math.max(pixelMinX, pixelMaxX);
        const absMaxY = Math.max(pixelMinY, pixelMaxY);
        const handlePositions = {
          'nw': { x: absMinX, y: absMinY },
          'n':  { x: pixelMidX, y: absMinY },
          'ne': { x: absMaxX, y: absMinY },
          'e':  { x: absMaxX, y: pixelMidY },
          'se': { x: absMaxX, y: absMaxY },
          's':  { x: pixelMidX, y: absMaxY },
          'sw': { x: absMinX, y: absMaxY },
          'w':  { x: absMinX, y: pixelMidY },
        };
        
        // Update invisible hit area handles
        const hitHalfSize = 14; // halfHit = hitSize(28) / 2
        const handles = handlesEl.querySelectorAll('rect.resize-handle');
        handles.forEach(handle => {
          const pos = handle.getAttribute('data-handle');
          const hp = handlePositions[pos];
          if (hp) {
            handle.setAttribute('x', hp.x - hitHalfSize);
            handle.setAttribute('y', hp.y - hitHalfSize);
          }
        });
        
        // Update visible handle squares
        const visualHalfSize = 7; // halfHandle = handleSize(14) / 2
        const visualHandles = handlesEl.querySelectorAll('rect.resize-handle-visual');
        visualHandles.forEach(handle => {
          const pos = handle.getAttribute('data-handle');
          const hp = handlePositions[pos];
          if (hp) {
            handle.setAttribute('x', hp.x - visualHalfSize);
            handle.setAttribute('y', hp.y - visualHalfSize);
          }
        });
        
        // Update rotate handle position (stem, hit circle, visual circle, icon)
        const rotStem = 30;
        const rotHandleX = pixelMidX;
        const rotHandleY = absMinY - rotStem;
        
        const stem = handlesEl.querySelector('line.rotate-stem');
        if (stem) {
          stem.setAttribute('x1', pixelMidX);
          stem.setAttribute('y1', absMinY);
          stem.setAttribute('x2', rotHandleX);
          stem.setAttribute('y2', rotHandleY);
        }
        
        const rotHit = handlesEl.querySelector('circle.rotate-handle');
        if (rotHit) {
          rotHit.setAttribute('cx', rotHandleX);
          rotHit.setAttribute('cy', rotHandleY);
        }
        
        const rotVisual = handlesEl.querySelector('circle.rotate-visual');
        if (rotVisual) {
          rotVisual.setAttribute('cx', rotHandleX);
          rotVisual.setAttribute('cy', rotHandleY);
        }
        
        const rotIcon = handlesEl.querySelector('g.rotate-icon');
        if (rotIcon) {
          rotIcon.setAttribute('transform', `translate(${rotHandleX}, ${rotHandleY})`);
        }
      }
      return;
    }
    
    // Handle markup drawing
    if (isDrawingMarkup && currentMarkup && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      let { x: normalizedX, y: normalizedY } = inverseTransformCoordinate(x / canvasSize.width, y / canvasSize.height);

      if (currentMarkup.type === 'pen' || currentMarkup.type === 'highlighter') {
        // Use ref for performance during freehand drawing
        if (currentMarkupRef.current && currentMarkupRef.current.points) {
          if (isShiftPressed && currentMarkupRef.current.points.length > 0) {
            // Shift-snap: straight line from first point
            const firstPt = currentMarkupRef.current.points[0];
            const dx = normalizedX - firstPt.x;
            const dy = normalizedY - firstPt.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 0.001) {
              const angle = Math.atan2(dy, dx) * 180 / Math.PI;
              const snapAngle = Math.round(angle / 45) * 45;
              const snapRad = snapAngle * Math.PI / 180;
              normalizedX = firstPt.x + dist * Math.cos(snapRad);
              normalizedY = firstPt.y + dist * Math.sin(snapRad);
            }
            currentMarkupRef.current.points = [firstPt, { x: normalizedX, y: normalizedY }];
          } else {
            // Add point directly to ref - avoid state update per point
            currentMarkupRef.current.points.push({ x: normalizedX, y: normalizedY });
          }
          
          // PERFORMANCE: Direct DOM manipulation for pen path
          const pathEl = document.querySelector('[data-drawing-preview="path"]');
          if (pathEl) {
            const scaledW = canvasSize.width * scale;
            const scaledH = canvasSize.height * scale;
            const pathData = currentMarkupRef.current.points
              .map((p, i) => { const dp = transformCoordinate(p.x, p.y); return `${i === 0 ? 'M' : 'L'} ${dp.x * scaledW} ${dp.y * scaledH}`; })
              .join(' ');
            pathEl.setAttribute('d', pathData);
          }
        }
      } else if (currentMarkup.type === 'arc') {
        // Arc uses point1/point2 instead of start/end
        let endX = normalizedX;
        let endY = normalizedY;
        
        // Apply shift-snap for arc
        if (isShiftPressed) {
          const dx = normalizedX - currentMarkup.point1X;
          const dy = normalizedY - currentMarkup.point1Y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0.001) {
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            const snapAngle = Math.round(angle / 45) * 45;
            const snapRad = snapAngle * Math.PI / 180;
            endX = currentMarkup.point1X + dist * Math.cos(snapRad);
            endY = currentMarkup.point1Y + dist * Math.sin(snapRad);
          }
        }
        
        // Update ref immediately
        if (currentMarkupRef.current) {
          currentMarkupRef.current.point2X = endX;
          currentMarkupRef.current.point2Y = endY;
        }
        
        // PERFORMANCE: Direct DOM manipulation for arc
        const arcEl = document.querySelector('[data-drawing-preview="arc"]');
        if (arcEl) {
          const scaledW = canvasSize.width * scale;
          const scaledH = canvasSize.height * scale;
          const dp1 = transformCoordinate(currentMarkup.point1X, currentMarkup.point1Y);
          const dp2 = transformCoordinate(endX, endY);
          const p1x = dp1.x * scaledW;
          const p1y = dp1.y * scaledH;
          const p2x = dp2.x * scaledW;
          const p2y = dp2.y * scaledH;
          const bulge = currentMarkup.arcBulge !== undefined ? currentMarkup.arcBulge : 0.5;
          
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
          
          arcEl.setAttribute('d', `M ${p1x} ${p1y} Q ${ctrlX} ${ctrlY} ${p2x} ${p2y}`);
        }
      } else if (currentMarkup.type === 'placementPreview') {
        // Rubber-band placement for symbols/signatures
        // Maintain aspect ratio: use the larger dimension
        const dx = normalizedX - currentMarkup.startX;
        const dy = normalizedY - currentMarkup.startY;
        const ar = currentMarkup.aspectRatio || 1;
        
        // Use the wider drag dimension, constrain the other by aspect ratio
        let endX, endY;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        if (absDx / ar > absDy) {
          // Width-limited
          endX = normalizedX;
          endY = currentMarkup.startY + Math.sign(dy || 1) * absDx / ar;
        } else {
          // Height-limited
          endY = normalizedY;
          endX = currentMarkup.startX + Math.sign(dx || 1) * absDy * ar;
        }
        
        if (currentMarkupRef.current) {
          currentMarkupRef.current.endX = endX;
          currentMarkupRef.current.endY = endY;
        }
        
        // Direct DOM update for placement preview
        const previewRect = document.querySelector('[data-drawing-preview="placement-rect"]');
        const previewImg = document.querySelector('[data-drawing-preview="placement-img"]');
        if (previewRect) {
          const scaledW = canvasSize.width * scale;
          const scaledH = canvasSize.height * scale;
          const dpS = transformCoordinate(currentMarkup.startX, currentMarkup.startY);
          const dpE = transformCoordinate(endX, endY);
          const px = Math.min(dpS.x, dpE.x) * scaledW;
          const py = Math.min(dpS.y, dpE.y) * scaledH;
          const pw = Math.abs(dpE.x - dpS.x) * scaledW;
          const ph = Math.abs(dpE.y - dpS.y) * scaledH;
          previewRect.setAttribute('x', px);
          previewRect.setAttribute('y', py);
          previewRect.setAttribute('width', pw);
          previewRect.setAttribute('height', ph);
          if (previewImg) {
            previewImg.setAttribute('x', px);
            previewImg.setAttribute('y', py);
            previewImg.setAttribute('width', pw);
            previewImg.setAttribute('height', ph);
          }
        }
      } else if (currentMarkup.type === 'arrow' || currentMarkup.type === 'rectangle' || currentMarkup.type === 'text' || currentMarkup.type === 'circle' || currentMarkup.type === 'line' || currentMarkup.type === 'cloud' || currentMarkup.type === 'callout') {
        let endX = normalizedX;
        let endY = normalizedY;
        
        // Apply shift-snap for arrow and line (snap to 0°, 45°, 90°, etc.)
        if (isShiftPressed && (currentMarkup.type === 'arrow' || currentMarkup.type === 'line')) {
          const dx = normalizedX - currentMarkup.startX;
          const dy = normalizedY - currentMarkup.startY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0.001) {
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            const snapAngle = Math.round(angle / 45) * 45;
            const snapRad = snapAngle * Math.PI / 180;
            endX = currentMarkup.startX + dist * Math.cos(snapRad);
            endY = currentMarkup.startY + dist * Math.sin(snapRad);
          }
        }
        
        // Update ref immediately for mouseUp
        if (currentMarkupRef.current) {
          currentMarkupRef.current.endX = endX;
          currentMarkupRef.current.endY = endY;
        }
        
        // PERFORMANCE: Direct DOM manipulation for drawing preview
        const dpEnd = transformCoordinate(endX, endY);
        const dpStart = transformCoordinate(currentMarkup.startX, currentMarkup.startY);
        const pixelEndX = dpEnd.x * canvasSize.width * scale;
        const pixelEndY = dpEnd.y * canvasSize.height * scale;
        const pixelStartX = dpStart.x * canvasSize.width * scale;
        const pixelStartY = dpStart.y * canvasSize.height * scale;
        
        if (currentMarkup.type === 'rectangle' || currentMarkup.type === 'text') {
          const rectEl = document.querySelector('[data-drawing-preview="rect"], [data-drawing-preview="text"]');
          if (rectEl) {
            rectEl.setAttribute('x', Math.min(pixelStartX, pixelEndX));
            rectEl.setAttribute('y', Math.min(pixelStartY, pixelEndY));
            rectEl.setAttribute('width', Math.abs(pixelEndX - pixelStartX));
            rectEl.setAttribute('height', Math.abs(pixelEndY - pixelStartY));
          }
        } else if (currentMarkup.type === 'circle') {
          const ellipseEl = document.querySelector('[data-drawing-preview="circle"]');
          if (ellipseEl) {
            ellipseEl.setAttribute('cx', (pixelStartX + pixelEndX) / 2);
            ellipseEl.setAttribute('cy', (pixelStartY + pixelEndY) / 2);
            ellipseEl.setAttribute('rx', Math.abs(pixelEndX - pixelStartX) / 2);
            ellipseEl.setAttribute('ry', Math.abs(pixelEndY - pixelStartY) / 2);
          }
        } else if (currentMarkup.type === 'line') {
          const lineEl = document.querySelector('[data-drawing-preview="line"]');
          if (lineEl) {
            lineEl.setAttribute('x2', pixelEndX);
            lineEl.setAttribute('y2', pixelEndY);
          }
        } else if (currentMarkup.type === 'arrow') {
          const lineEl = document.querySelector('[data-drawing-preview="arrow-line"]');
          const headEl = document.querySelector('[data-drawing-preview="arrow-head"]');
          if (lineEl && headEl) {
            const angle = Math.atan2(pixelEndY - pixelStartY, pixelEndX - pixelStartX);
            const arrowLength = (currentMarkup.arrowHeadSize || 12) * scale;
            const arrowAngle = Math.PI / 7;
            const lineEndX = pixelEndX - arrowLength * 0.7 * Math.cos(angle);
            const lineEndY = pixelEndY - arrowLength * 0.7 * Math.sin(angle);
            
            lineEl.setAttribute('x2', lineEndX);
            lineEl.setAttribute('y2', lineEndY);
            headEl.setAttribute('points', `
              ${pixelEndX},${pixelEndY}
              ${pixelEndX - arrowLength * Math.cos(angle - arrowAngle)},${pixelEndY - arrowLength * Math.sin(angle - arrowAngle)}
              ${pixelEndX - arrowLength * Math.cos(angle + arrowAngle)},${pixelEndY - arrowLength * Math.sin(angle + arrowAngle)}
            `);
          }
        } else if (currentMarkup.type === 'cloud') {
          // Cloud - regenerate arc path directly on DOM for real-time preview
          const cloudEl = document.querySelector('[data-drawing-preview="cloud"]');
          if (cloudEl) {
            const x = Math.min(pixelStartX, pixelEndX);
            const y = Math.min(pixelStartY, pixelEndY);
            const w = Math.abs(pixelEndX - pixelStartX);
            const h = Math.abs(pixelEndY - pixelStartY);
            
            if (w < 10 || h < 10) {
              // Too small for arcs - show simple rect via path
              cloudEl.setAttribute('d', `M ${x} ${y} h ${w} v ${h} h ${-w} Z`);
            } else {
              const inverted = currentMarkup.inverted || false;
              const sweepOut = inverted ? 0 : 1;
              const refSize = 800;
              const normW = Math.abs(endX - currentMarkup.startX) * refSize;
              const normH = Math.abs(endY - currentMarkup.startY) * refSize;
              const targetArcDiam = currentMarkup.arcSize || 15;
              const normPerimeter = 2 * (normW + normH);
              const totalArcs = Math.max(4, Math.round(normPerimeter / targetArcDiam));
              const screenPerimeter = 2 * (w + h);
              const uniformArcDiam = screenPerimeter / totalArcs;
              const arcR = uniformArcDiam / 2;
              const numArcsX = Math.max(1, Math.round(w / uniformArcDiam));
              const numArcsY = Math.max(1, Math.round(h / uniformArcDiam));
              const spacingX = w / numArcsX;
              const spacingY = h / numArcsY;
              
              let d = `M ${x} ${y}`;
              for (let i = 0; i < numArcsX; i++) d += ` A ${arcR} ${arcR} 0 0 ${sweepOut} ${x + (i+1)*spacingX} ${y}`;
              for (let i = 0; i < numArcsY; i++) d += ` A ${arcR} ${arcR} 0 0 ${sweepOut} ${x+w} ${y + (i+1)*spacingY}`;
              for (let i = numArcsX-1; i >= 0; i--) d += ` A ${arcR} ${arcR} 0 0 ${sweepOut} ${x + i*spacingX} ${y+h}`;
              for (let i = numArcsY-1; i >= 0; i--) d += ` A ${arcR} ${arcR} 0 0 ${sweepOut} ${x} ${y + i*spacingY}`;
              d += ' Z';
              cloudEl.setAttribute('d', d);
            }
          }
        } else {
          // Callout - fallback to React state (complex shapes)
          if (!rafIdRef.current) {
            const capturedEndX = endX;
            const capturedEndY = endY;
            rafIdRef.current = requestAnimationFrame(() => {
              rafIdRef.current = null;
              setCurrentMarkup(prev => prev ? ({
                ...prev,
                endX: capturedEndX,
                endY: capturedEndY
              }) : null);
            });
          }
        }
      }
      return;
    }
    
    // Handle subclass region drawing
    if (isDrawingSubclassRegion && isDrawing && drawStart && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const currentX = (e.clientX - rect.left) / scale;
      const currentY = (e.clientY - rect.top) / scale;
      
      // Clamp to parent box bounds
      const parentX = pendingParentBox.x * canvasSize.width;
      const parentY = pendingParentBox.y * canvasSize.height;
      const parentW = pendingParentBox.width * canvasSize.width;
      const parentH = pendingParentBox.height * canvasSize.height;
      
      const clampedX = Math.max(parentX, Math.min(parentX + parentW, currentX));
      const clampedY = Math.max(parentY, Math.min(parentY + parentH, currentY));
      
      const width = clampedX - drawStart.x;
      const height = clampedY - drawStart.y;
      
      setCurrentRect({
        x: width < 0 ? clampedX : drawStart.x,
        y: height < 0 ? clampedY : drawStart.y,
        width: Math.abs(width),
        height: Math.abs(height)
      });
      return;
    }
    
    // Track mouse position for polyline preview
    if ((objectFinderMode === 'train' || objectFinderMode === 'create') && drawingShapeType === 'polyline' && polylinePoints.length > 0 && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      let normalizedX = x / canvasSize.width;
      let normalizedY = y / canvasSize.height;
      
      // Apply shift-snap preview
      if (isShiftPressed && polylinePoints.length > 0) {
        const lastPt = polylinePoints[polylinePoints.length - 1];
        const dx = Math.abs(normalizedX - lastPt.x);
        const dy = Math.abs(normalizedY - lastPt.y);
        if (dx > dy) {
          normalizedY = lastPt.y;
        } else {
          normalizedX = lastPt.x;
        }
      }
      
      setPolylineMousePos({ x: normalizedX, y: normalizedY });
      
      // Check if near start point
      if (polylinePoints.length >= 3) {
        const startPt = polylinePoints[0];
        const distToStart = Math.sqrt(
          Math.pow((normalizedX - startPt.x) * canvasSize.width, 2) + 
          Math.pow((normalizedY - startPt.y) * canvasSize.height, 2)
        );
        setIsNearStartPoint(distToStart < 15);
      } else {
        setIsNearStartPoint(false);
      }
    }
    
    if ((linkMode === 'train' || linkMode === 'create' || objectFinderMode === 'train' || objectFinderMode === 'create') && isDrawing && drawStart && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const currentX = (e.clientX - rect.left) / scale;
      const currentY = (e.clientY - rect.top) / scale;
      const width = currentX - drawStart.x;
      const height = currentY - drawStart.y;
      
      setCurrentRect({
        x: width < 0 ? currentX : drawStart.x,
        y: height < 0 ? currentY : drawStart.y,
        width: Math.abs(width),
        height: Math.abs(height)
      });
    } else if (activeResizeHandle && pendingShape && canvasRef.current) {
      // Handle shape resizing
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left) / scale / canvasSize.width;
      const mouseY = (e.clientY - rect.top) / scale / canvasSize.height;
      
      setPendingShape(prev => {
        let { x, y, width, height } = prev;
        const right = x + width;
        const bottom = y + height;
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const isCircle = prev.shapeType === 'circle';
        
        switch (activeResizeHandle) {
          case 'nw':
            width = right - mouseX;
            height = bottom - mouseY;
            x = mouseX;
            y = mouseY;
            break;
          case 'n':
            height = bottom - mouseY;
            y = mouseY;
            break;
          case 'ne':
            width = mouseX - x;
            height = bottom - mouseY;
            y = mouseY;
            break;
          case 'e':
            width = mouseX - x;
            break;
          case 'se':
            width = mouseX - x;
            height = mouseY - y;
            break;
          case 's':
            height = mouseY - y;
            break;
          case 'sw':
            width = right - mouseX;
            height = mouseY - y;
            x = mouseX;
            break;
          case 'w':
            width = right - mouseX;
            x = mouseX;
            break;
        }
        
        // Ensure minimum size
        if (width < 0.01) { width = 0.01; x = right - width; }
        if (height < 0.01) { height = 0.01; y = bottom - height; }
        
        // For circles, maintain equal PIXEL dimensions (not normalized)
        if (isCircle) {
          // Convert to pixels to find the larger dimension
          const widthPx = width * canvasSize.width;
          const heightPx = height * canvasSize.height;
          const maxPx = Math.max(widthPx, heightPx);
          
          // Convert back to normalized coords
          const newWidth = maxPx / canvasSize.width;
          const newHeight = maxPx / canvasSize.height;
          
          // Anchor based on handle
          if (activeResizeHandle === 'nw') {
            x = right - newWidth;
            y = bottom - newHeight;
          } else if (activeResizeHandle === 'ne') {
            y = bottom - newHeight;
          } else if (activeResizeHandle === 'sw') {
            x = right - newWidth;
          } else if (activeResizeHandle === 'se') {
            // Anchor is top-left, nothing to adjust
          } else if (activeResizeHandle === 'n') {
            x = centerX - newWidth / 2;
            y = bottom - newHeight;
          } else if (activeResizeHandle === 's') {
            x = centerX - newWidth / 2;
          } else if (activeResizeHandle === 'e') {
            y = centerY - newHeight / 2;
          } else if (activeResizeHandle === 'w') {
            x = right - newWidth;
            y = centerY - newHeight / 2;
          }
          
          width = newWidth;
          height = newHeight;
        }
        
        return { ...prev, x, y, width, height };
      });
    } else if (isPanning) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      containerRef.current.scrollLeft = panStart.scrollLeft - dx;
      containerRef.current.scrollTop = panStart.scrollTop - dy;
    } else if ((markupMode === 'select' || markupMode === null || selectMode) && 
               markupEditMode && !zoomMode && !panMode &&
               !isDraggingMarkupRef.current && !isResizingMarkupRef.current && 
               !isRotatingMarkupRef.current && !isDrawing && canvasRef.current) {
      // PERFORMANCE: Throttle hit testing to ~60fps
      const now = performance.now();
      if (now - lastHitTestTimeRef.current < 16) return;
      lastHitTestTimeRef.current = now;
      
      // DOM-based hover highlighting for select/pan modes
      const canvas = canvasRef.current;

      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      const { x: clickX, y: clickY } = inverseTransformCoordinate(x / canvasSize.width, y / canvasSize.height);

      // Hit test to find markup under cursor
      const hitMarkup = hitTestMarkup(clickX, clickY);
      const newHoveredId = hitMarkup?.id || null;
      
      // Only update DOM if hover changed
      if (newHoveredId !== hoveredMarkupIdRef.current) {
        // Remove highlight from previous
        if (hoveredMarkupIdRef.current) {
          const prevEl = document.querySelector(`[data-markup-id="${hoveredMarkupIdRef.current}"]`);
          if (prevEl) {
            prevEl.classList.remove('markup-hovered');
          }
        }
        
        // Add highlight to new
        if (newHoveredId) {
          const newEl = document.querySelector(`[data-markup-id="${newHoveredId}"]`);
          if (newEl) {
            newEl.classList.add('markup-hovered');
          }
        }
        
        hoveredMarkupIdRef.current = newHoveredId;
        
        // Update cursor
        if (containerRef.current) {
          containerRef.current.style.cursor = newHoveredId ? 'pointer' : '';
        }
      }
    }
  };

  const handleMouseUp = () => {
    // Handle symbol capture mode - finalize region selection
    if (symbolCaptureMode && captureRegion?.startX !== undefined) {
      setCaptureRegion(prev => {
        if (!prev || prev.width < 0.01 || prev.height < 0.01) {
          return null; // Too small, cancel
        }
        return {
          x: prev.x,
          y: prev.y,
          width: prev.width,
          height: prev.height
        };
      });
      return;
    }
    
    // Note: Selection box completion is handled by global mouseup handler
    // to ensure it works even when mouse is released outside the container
    
    // Handle markup drag/resize/rotate completion (check refs for synchronous state)
    if (isDraggingMarkupRef.current || isResizingMarkupRef.current || isRotatingMarkupRef.current) {
      // If this was a multi-drag, history was saved at drag start
      if (markupDragStartRef.current?.isMultiDrag) {
        // History already saved at mousedown
      }
      
      // PERFORMANCE: Handle polyline point drag finalization
      if (isDraggingMarkupRef.current && draggingPolylinePointRef.current !== null && 
          selectedMarkupRef.current && markupDragStartRef.current?.originalPoints) {
        const pointIndex = markupDragStartRef.current.pointIndex;
        const totalDeltaX = markupDragStartRef.current.totalDeltaX || 0;
        const totalDeltaY = markupDragStartRef.current.totalDeltaY || 0;
        const origPoint = markupDragStartRef.current.originalPoints[pointIndex];
        
        if (origPoint && (Math.abs(totalDeltaX) > 0.0001 || Math.abs(totalDeltaY) > 0.0001)) {
          const newPointX = origPoint.x + totalDeltaX;
          const newPointY = origPoint.y + totalDeltaY;
          
          // Save history before applying point drag (enables undo)
          saveHistory();
          
          // Update markups state
          setMarkups(prev => prev.map(m => {
            if (m.id === selectedMarkupRef.current.id && m.points) {
              const newPoints = [...m.points];
              newPoints[pointIndex] = { x: newPointX, y: newPointY };
              
              const allX = newPoints.map(p => p.x);
              const allY = newPoints.map(p => p.y);
              
              return {
                ...m,
                points: newPoints,
                startX: Math.min(...allX),
                startY: Math.min(...allY),
                endX: Math.max(...allX),
                endY: Math.max(...allY),
                modified: m.fromPdf ? true : m.modified
              };
            }
            return m;
          }));
          
          // Update selectedMarkup
          setSelectedMarkup(prev => {
            if (!prev || !prev.points) return prev;
            const newPoints = [...prev.points];
            newPoints[pointIndex] = { x: newPointX, y: newPointY };
            
            const allX = newPoints.map(p => p.x);
            const allY = newPoints.map(p => p.y);
            
            const updated = {
              ...prev,
              points: newPoints,
              startX: Math.min(...allX),
              startY: Math.min(...allY),
              endX: Math.max(...allX),
              endY: Math.max(...allY)
            };
            selectedMarkupRef.current = updated;
            return updated;
          });
          
          setUnsavedMarkupFiles(prev => new Set([...prev, currentFileIdentifier]));
        }
        
        // Clear polyline drag state
        markupDragStartRef.current = null;
        draggingPolylinePointRef.current = null;
        setDraggingPolylinePoint(null);
      }
      
      // If we were "dragging" but there was no actual movement AND the markup was already selected, deselect it
      if (isDraggingMarkupRef.current && !didDragMoveRef.current && wasAlreadySelectedRef.current && selectedMarkupRef.current) {
        setSelectedMarkup(null);
        selectedMarkupRef.current = null;
      }
      
      // PERFORMANCE: Apply the final drag offset to the actual markup coordinates
      if (isDraggingMarkupRef.current && didDragMoveRef.current && selectedMarkupRef.current && dragOffsetRef.current) {
        const finalOffsetX = dragOffsetRef.current.x;
        const finalOffsetY = dragOffsetRef.current.y;
        
        // Restore original transforms using cached values
        if (markupDragStartRef.current) {
          const markupEl = markupDragStartRef.current.markupEl;
          
          if (markupEl) {
            if (markupDragStartRef.current.markupBaseTransform) {
              markupEl.setAttribute('transform', markupDragStartRef.current.markupBaseTransform);
            } else {
              markupEl.removeAttribute('transform');
            }
          }
          
          const handlesEl = markupDragStartRef.current.handlesEl;
          if (handlesEl) {
            if (markupDragStartRef.current.handlesBaseTransform) {
              handlesEl.setAttribute('transform', markupDragStartRef.current.handlesBaseTransform);
            } else {
              handlesEl.removeAttribute('transform');
            }
          }
        }
        
        if (Math.abs(finalOffsetX) > 0.0001 || Math.abs(finalOffsetY) > 0.0001) {
          // Save history before applying move (enables undo of drag)
          saveHistory();
          // Apply offset to markup
          moveMarkup(selectedMarkupRef.current.id, finalOffsetX, finalOffsetY);
          
          // Update selectedMarkup with new position
          setSelectedMarkup(prev => {
            if (!prev) return null;
            let updated;
            if (prev.type === 'pen' || prev.type === 'highlighter') {
              updated = {
                ...prev,
                points: prev.points.map(p => ({ x: p.x + finalOffsetX, y: p.y + finalOffsetY }))
              };
            } else if (prev.startX !== undefined && prev.endX !== undefined) {
              updated = {
                ...prev,
                startX: prev.startX + finalOffsetX,
                startY: prev.startY + finalOffsetY,
                endX: prev.endX + finalOffsetX,
                endY: prev.endY + finalOffsetY,
                ...(prev.points ? { points: prev.points.map(p => ({ x: p.x + finalOffsetX, y: p.y + finalOffsetY })) } : {})
              };
            } else if (prev.x !== undefined) {
              updated = { ...prev, x: prev.x + finalOffsetX, y: prev.y + finalOffsetY };
            } else {
              updated = prev;
            }
            selectedMarkupRef.current = updated;
            return updated;
          });
        }
      }
      
      // PERFORMANCE: Apply final rotation to markup
      if (isRotatingMarkupRef.current && selectedMarkupRef.current && rotationStartRef.current?.currentRotation !== undefined) {
        const finalRotation = rotationStartRef.current.currentRotation;
        
        // Clear DOM transforms
        const markupEl = rotationStartRef.current.markupEl;
        if (markupEl) {
          markupEl.removeAttribute('transform');
        }
        const handlesEl = rotationStartRef.current.handlesEl;
        if (handlesEl) {
          handlesEl.removeAttribute('transform');
        }
        
        // Save history before applying rotation (enables undo of rotate)
        saveHistory();
        
        // Update React state with final rotation
        setMarkups(prev => prev.map(m => {
          if (m.id !== selectedMarkupRef.current.id) return m;
          return { ...m, rotation: finalRotation, modified: m.fromPdf ? true : m.modified };
        }));
        
        setSelectedMarkup(prev => {
          if (!prev) return null;
          const updated = { ...prev, rotation: finalRotation };
          selectedMarkupRef.current = updated;
          return updated;
        });
        
        // Clear rotation state
        rotationStartRef.current.markupEl = null;
        rotationStartRef.current.handlesEl = null;
        rotationStartRef.current.currentRotation = undefined;
      }
      
      // PERFORMANCE: Apply final resize to markup coordinates
      if (isResizingMarkupRef.current && selectedMarkupRef.current && markupDragStartRef.current?.resizeDeltaX !== undefined) {
        const totalDeltaX = markupDragStartRef.current.resizeDeltaX;
        const totalDeltaY = markupDragStartRef.current.resizeDeltaY;
        const currentResizeHandle = resizeHandleRef.current;
        const origBounds = markupDragStartRef.current.originalBounds;
        
        if (origBounds && (Math.abs(totalDeltaX) > 0.0001 || Math.abs(totalDeltaY) > 0.0001)) {
          // Save history before applying resize (enables undo of resize)
          saveHistory();
          // Handle arrow/line endpoint
          if ((selectedMarkupRef.current.type === 'arrow' || selectedMarkupRef.current.type === 'line') && 
              (currentResizeHandle === 'start' || currentResizeHandle === 'end')) {
            const orig = markupDragStartRef.current.originalMarkup || selectedMarkupRef.current;
            if (currentResizeHandle === 'start') {
              resizeMarkup(selectedMarkupRef.current.id, 'start', totalDeltaX, totalDeltaY, origBounds);
              setSelectedMarkup(prev => {
                if (!prev) return null;
                const updated = { ...prev, startX: orig.startX + totalDeltaX, startY: orig.startY + totalDeltaY };
                selectedMarkupRef.current = updated;
                return updated;
              });
            } else {
              resizeMarkup(selectedMarkupRef.current.id, 'end', totalDeltaX, totalDeltaY, origBounds);
              setSelectedMarkup(prev => {
                if (!prev) return null;
                const updated = { ...prev, endX: orig.endX + totalDeltaX, endY: orig.endY + totalDeltaY };
                selectedMarkupRef.current = updated;
                return updated;
              });
            }
          } else {
            // Standard resize - for rotated shapes, use compensated bounds
            const compBounds = markupDragStartRef.current.compensatedBounds;
            const rotation = selectedMarkupRef.current.rotation || 0;
            
            if (rotation && compBounds) {
              // Directly apply compensated bounds for rotated shapes
              setMarkups(prev => prev.map(m => {
                if (m.id !== selectedMarkupRef.current.id) return m;
                const newStartX = Math.min(compBounds.minX, compBounds.maxX);
                const newStartY = Math.min(compBounds.minY, compBounds.maxY);
                const newEndX = Math.max(compBounds.minX, compBounds.maxX);
                const newEndY = Math.max(compBounds.minY, compBounds.maxY);
                return { ...m, startX: newStartX, startY: newStartY, endX: newEndX, endY: newEndY, modified: m.fromPdf ? true : m.modified };
              }));
              setSelectedMarkup(prev => {
                if (!prev) return prev;
                const newStartX = Math.min(compBounds.minX, compBounds.maxX);
                const newStartY = Math.min(compBounds.minY, compBounds.maxY);
                const newEndX = Math.max(compBounds.minX, compBounds.maxX);
                const newEndY = Math.max(compBounds.minY, compBounds.maxY);
                const updated = { ...prev, startX: newStartX, startY: newStartY, endX: newEndX, endY: newEndY };
                selectedMarkupRef.current = updated;
                return updated;
              });
            } else {
              resizeMarkup(selectedMarkupRef.current.id, currentResizeHandle, totalDeltaX, totalDeltaY, origBounds);
            
              // Update selectedMarkup with final bounds
              setSelectedMarkup(prev => {
                if (!prev || !prev.startX) return prev;
                
                let newStartX = prev.startX, newStartY = prev.startY;
                let newEndX = prev.endX, newEndY = prev.endY;
                
                const wasMinX = origBounds.minX === Math.min(prev.startX, prev.endX) ? 
                  (prev.startX < prev.endX ? 'start' : 'end') : 
                  (prev.startX < prev.endX ? 'end' : 'start');
                const wasMinY = origBounds.minY === Math.min(prev.startY, prev.endY) ? 
                  (prev.startY < prev.endY ? 'start' : 'end') : 
                  (prev.startY < prev.endY ? 'end' : 'start');
                
                if (currentResizeHandle.includes('w')) {
                  if (wasMinX === 'start') newStartX = origBounds.minX + totalDeltaX;
                  else newEndX = origBounds.minX + totalDeltaX;
                }
                if (currentResizeHandle.includes('e')) {
                  if (wasMinX === 'end') newStartX = origBounds.maxX + totalDeltaX;
                  else newEndX = origBounds.maxX + totalDeltaX;
                }
                if (currentResizeHandle.includes('n')) {
                  if (wasMinY === 'start') newStartY = origBounds.minY + totalDeltaY;
                  else newEndY = origBounds.minY + totalDeltaY;
                }
                if (currentResizeHandle.includes('s')) {
                  if (wasMinY === 'end') newStartY = origBounds.maxY + totalDeltaY;
                  else newEndY = origBounds.maxY + totalDeltaY;
                }
                
                const updated = { ...prev, startX: newStartX, startY: newStartY, endX: newEndX, endY: newEndY };
                selectedMarkupRef.current = updated;
                return updated;
              });
            }
          }
        }
      }
      
      // Reset drag offset
      dragOffsetRef.current = { x: 0, y: 0 };
      
      // Clear cached DOM elements
      if (markupDragStartRef.current) {
        markupDragStartRef.current.markupEl = null;
        markupDragStartRef.current.handlesEl = null;
        markupDragStartRef.current.markupBaseTransform = null;
        markupDragStartRef.current.handlesBaseTransform = null;
        markupDragStartRef.current.pendingMouseEvent = null;
        markupDragStartRef.current.originalX = undefined;
        markupDragStartRef.current.originalY = undefined;
        markupDragStartRef.current.originalBounds = undefined;
        markupDragStartRef.current.originalMarkup = undefined;
        markupDragStartRef.current.originalPositions = undefined;
        markupDragStartRef.current.resizeDeltaX = undefined;
        markupDragStartRef.current.resizeDeltaY = undefined;
        markupDragStartRef.current.compensatedBounds = undefined;
      }
      
      setIsDraggingMarkup(false);
      isDraggingMarkupRef.current = false;
      didDragMoveRef.current = false;
      wasAlreadySelectedRef.current = false;
      setDraggingPolylinePoint(null);
      draggingPolylinePointRef.current = null;
      setDragStart(null);
      dragStartRef.current = null;
      setIsResizingMarkup(false);
      isResizingMarkupRef.current = false;
      setIsRotatingMarkup(false);
      isRotatingMarkupRef.current = false;
      setResizeHandle(null);
      resizeHandleRef.current = null;
      setMarkupDragStart(null);
      markupDragStartRef.current = null;
      setRotationStart(null);
      rotationStartRef.current = null;
      return;
    }
    
    // Clear resize handle if active
    if (activeResizeHandle) {
      setActiveResizeHandle(null);
      return;
    }
    
    // Handle markup drawing completion
    if (isDrawingMarkup && currentMarkup) {
      // Cancel any pending animation frame
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      
      // PERFORMANCE FIX: Use ref for final data (has latest values from direct DOM manipulation)
      const markupToSave = currentMarkupRef.current 
        ? { ...currentMarkupRef.current }
        : currentMarkup;
      
      // For pen/highlighter, ensure we copy points array
      if ((markupToSave.type === 'pen' || markupToSave.type === 'highlighter') && markupToSave.points) {
        markupToSave.points = [...markupToSave.points];
      }
      
      // Only save if there's actual content
      if (markupToSave.type === 'pen' || markupToSave.type === 'highlighter') {
        // Allow 2 points for shift-snap straight lines, or more for freehand
        if (markupToSave.points && markupToSave.points.length >= 2) {
          // For 2-point lines (shift-snap), ensure minimum distance
          if (markupToSave.points.length === 2) {
            const p1 = markupToSave.points[0];
            const p2 = markupToSave.points[1];
            const dist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
            if (dist > 0.005) {
              addMarkupWithHistory(markupToSave);
            }
          } else {
            addMarkupWithHistory(markupToSave);
          }
        }
        // Clear refs
        isDrawingMarkupRef.current = false;
        currentMarkupRef.current = null;
      } else if (markupToSave.type === 'placementPreview') {
        // Finalize rubber-band placement of symbol/signature
        const dx = Math.abs(markupToSave.endX - markupToSave.startX);
        const dy = Math.abs(markupToSave.endY - markupToSave.startY);
        if (dx > 0.005 || dy > 0.005) {
          const sym = markupToSave.symbolData;
          const minX = Math.min(markupToSave.startX, markupToSave.endX);
          const minY = Math.min(markupToSave.startY, markupToSave.endY);
          const maxX = Math.max(markupToSave.startX, markupToSave.endX);
          const maxY = Math.max(markupToSave.startY, markupToSave.endY);
          const placedWidth = maxX - minX;
          const placedHeight = maxY - minY;
          
          if (sym.type === 'image' || sym.image) {
            // Image-based symbol/signature — create single image markup
            const imageMarkup = {
              id: `image_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              type: 'image',
              image: sym.image,
              startX: minX,
              startY: minY,
              endX: maxX,
              endY: maxY,
              page: markupToSave.page,
              filename: markupToSave.filename,
              aspectRatio: sym.aspectRatio || (placedWidth / placedHeight),
              author: markupAuthor,
              createdDate: new Date().toISOString()
            };
            addMarkupWithHistory(imageMarkup);
          } else if (sym.markups) {
            // Vector symbol — scale child markups to fit placed bounds
            const newMarkups = sym.markups.map(m => {
              const newM = {
                ...m,
                id: `${m.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                page: markupToSave.page,
                filename: markupToSave.filename,
              };
              if (m.type === 'pen' || m.type === 'highlighter' || m.type === 'polyline' || m.type === 'polylineArrow' || m.type === 'cloudPolyline' || m.type === 'polygon') {
                newM.points = m.points.map(p => ({
                  x: minX + p.x * placedWidth,
                  y: minY + p.y * placedHeight
                }));
                if (m.type !== 'pen' && m.type !== 'highlighter') {
                  const xs = newM.points.map(p => p.x);
                  const ys = newM.points.map(p => p.y);
                  newM.startX = Math.min(...xs);
                  newM.startY = Math.min(...ys);
                  newM.endX = Math.max(...xs);
                  newM.endY = Math.max(...ys);
                }
              } else if (m.startX !== undefined) {
                newM.startX = minX + m.startX * placedWidth;
                newM.startY = minY + m.startY * placedHeight;
                newM.endX = minX + m.endX * placedWidth;
                newM.endY = minY + m.endY * placedHeight;
              } else if (m.x !== undefined) {
                newM.x = minX + m.x * placedWidth;
                newM.y = minY + m.y * placedHeight;
              }
              return newM;
            });
            saveHistory();
            setMarkups(prev => [...prev, ...newMarkups]);
          }
        }
        // Clear placement mode
        setPendingPlacement(null);
      } else if (markupToSave.type === 'arc') {
        // Arc uses point1/point2
        const dx = Math.abs(markupToSave.point2X - markupToSave.point1X);
        const dy = Math.abs(markupToSave.point2Y - markupToSave.point1Y);
        if (dx > 0.005 || dy > 0.005) {
          addMarkupWithHistory(markupToSave);
        }
      } else if (markupToSave.type === 'arrow' || markupToSave.type === 'rectangle' || markupToSave.type === 'circle' || markupToSave.type === 'line' || markupToSave.type === 'cloud' || markupToSave.type === 'callout') {
        const dx = Math.abs(markupToSave.endX - markupToSave.startX);
        const dy = Math.abs(markupToSave.endY - markupToSave.startY);
        if (dx > 0.005 || dy > 0.005) {
          addMarkupWithHistory(markupToSave);
        }
      } else if (markupToSave.type === 'text') {
        // Text box - ensure minimum size and enter edit mode
        const dx = Math.abs(markupToSave.endX - markupToSave.startX);
        const dy = Math.abs(markupToSave.endY - markupToSave.startY);
        if (dx > 0.01 || dy > 0.01) {
          // Normalize so startX/Y is always top-left
          const normalizedMarkup = {
            ...markupToSave,
            startX: Math.min(markupToSave.startX, markupToSave.endX),
            startY: Math.min(markupToSave.startY, markupToSave.endY),
            endX: Math.max(markupToSave.startX, markupToSave.endX),
            endY: Math.max(markupToSave.startY, markupToSave.endY),
          };
          addMarkupWithHistory(normalizedMarkup);
          // Enter edit mode immediately so user can start typing
          setEditingTextMarkupId(normalizedMarkup.id);
          setTextEditValue('');
          setSelectedMarkup(normalizedMarkup);
          selectedMarkupRef.current = normalizedMarkup;
        }
      }
      // Clear refs
      currentMarkupRef.current = null;
      setCurrentMarkup(null);
      setIsDrawingMarkup(false);
      return;
    }
    
    // Handle subclass region drawing completion
    if (isDrawingSubclassRegion && isDrawing && currentRect && currentRect.width > 5 && currentRect.height > 5 && pendingParentBox) {
      // Convert to relative coordinates within the parent box
      const parentX = pendingParentBox.x * canvasSize.width;
      const parentY = pendingParentBox.y * canvasSize.height;
      const parentW = pendingParentBox.width * canvasSize.width;
      const parentH = pendingParentBox.height * canvasSize.height;
      
      const relativeRegion = {
        x: (currentRect.x - parentX) / parentW,
        y: (currentRect.y - parentY) / parentH,
        width: currentRect.width / parentW,
        height: currentRect.height / parentH,
      };
      
      setSubclassRegion(relativeRegion);
      setIsDrawing(false);
      setDrawStart(null);
      setCurrentRect(null);
      return;
    }
    
    if (isDrawing && currentRect && currentRect.width > 10 && currentRect.height > 10) {
      if (linkMode === 'train') {
        const trainingBox = {
          id: `train_${Date.now()}`,
          x: currentRect.x / canvasSize.width,
          y: currentRect.y / canvasSize.height,
          width: currentRect.width / canvasSize.width,
          height: currentRect.height / canvasSize.height,
          className: 'Smart Link'
        };
        setTrainingBoxes(prev => [...prev, trainingBox]);
      } else if (linkMode === 'create') {
        const newHotspot = {
          id: `hotspot_${Date.now()}`,
          x: currentRect.x / canvasSize.width,
          y: currentRect.y / canvasSize.height,
          width: currentRect.width / canvasSize.width,
          height: currentRect.height / canvasSize.height,
          targetFileId: null,
          targetFilename: null,
          label: '',
          sourceFileId: currentFile?.id || null,
          sourceFilename: currentFile?.name || null,
          page: currentPage - 1, // 0-indexed like detected links
          assignmentMode: 'drawn'
        };
        setPendingHotspot(newHotspot);
        setOcrTestResult(null); // Clear previous OCR result
        setShowAssignDialog(true);
      } else if (objectFinderMode === 'train' || objectFinderMode === 'create') {
        // Create shape with confirmation step
        let boxX = currentRect.x / canvasSize.width;
        let boxY = currentRect.y / canvasSize.height;
        let boxWidth, boxHeight;
        
        // For circles, we need to ensure the shape appears as a circle on screen
        // This means equal PIXEL dimensions, not equal normalized dimensions
        if (drawingShapeType === 'circle') {
          // Use the larger pixel dimension for both
          const maxPixelDim = Math.max(currentRect.width, currentRect.height);
          
          // Convert to normalized, keeping pixel dimensions equal
          boxWidth = maxPixelDim / canvasSize.width;
          boxHeight = maxPixelDim / canvasSize.height;
          
          // Center the circle on where the user drew
          const drawnCenterX = (currentRect.x + currentRect.width / 2) / canvasSize.width;
          const drawnCenterY = (currentRect.y + currentRect.height / 2) / canvasSize.height;
          boxX = drawnCenterX - boxWidth / 2;
          boxY = drawnCenterY - boxHeight / 2;
        } else {
          boxWidth = currentRect.width / canvasSize.width;
          boxHeight = currentRect.height / canvasSize.height;
        }
        
        const newBox = {
          id: `obj_${Date.now()}`,
          x: boxX,
          y: boxY,
          width: boxWidth,
          height: boxHeight,
          page: currentPage - 1,
          shapeType: drawingShapeType,
        };
        
        // Show confirmation with resize handles
        setPendingShape(newBox);
      }
    }
    
    setIsDrawing(false);
    setDrawStart(null);
    setCurrentRect(null);
    setIsPanning(false);
  };

  // Save hotspots
  const saveHotspots = (newHotspots) => {
    if (!project || !currentFile) return;
    
    const updatedProject = {
      ...project,
      hotspots: {
        ...(project.hotspots || {}),
        [currentFile.id]: newHotspots
      }
    };
    onProjectUpdate(updatedProject);
    setHotspots(newHotspots);
  };

  // Save detected objects to backend file
  const saveDetectedObjects = async (newObjects) => {
    if (!projectId) return;
    
    try {
      await saveObjectsToBackend(projectId, newObjects);
      console.log(`Saved ${newObjects.length} objects to backend`);
    } catch (error) {
      console.error('Failed to save objects to backend:', error);
    }
  };

  // Track if initial load is complete
  const hasLoadedObjectsRef = useRef(false);

  // Auto-save detected objects when they change
  // IMPORTANT: Only save after initial load is complete to prevent race condition
  useEffect(() => {
    // Don't save until we've loaded from backend first
    if (!hasLoadedObjectsRef.current) return;
    if (!projectId) return;
    
    // Debounce the save
    const timeout = setTimeout(() => {
      isSavingDetectedObjectsRef.current = true;
      saveDetectedObjects(detectedObjects);
      // Reset flag after a short delay
      setTimeout(() => {
        isSavingDetectedObjectsRef.current = false;
      }, 100);
    }, 500);
    return () => clearTimeout(timeout);
  }, [detectedObjects, projectId]);

  // Load detected objects from backend file on mount or when refreshKey changes
  useEffect(() => {
    const loadObjects = async () => {
      if (!projectId) return;
      
      // Only skip loading on initial mount if already loaded (not on refresh)
      if (hasLoadedObjectsRef.current && refreshKey === 0) return;
      
      try {
        hasLoadedObjectsRef.current = true;
        const objects = await getObjectsFromBackend(projectId);
        
        if (objects.length > 0) {
          console.log(`Loaded ${objects.length} objects from backend`);
          setDetectedObjects(objects);
        } else if (project?.detectedObjects?.length > 0) {
          // Migration: if no objects in backend file but exist in project, migrate them
          console.log(`Migrating ${project.detectedObjects.length} objects to backend...`);
          setDetectedObjects(project.detectedObjects);
          await saveObjectsToBackend(projectId, project.detectedObjects);
          console.log('Migration complete');
        }
      } catch (error) {
        console.error('Failed to load objects from backend:', error);
        // Fallback to project.detectedObjects if backend fails
        if (project?.detectedObjects) {
          setDetectedObjects(project.detectedObjects);
        }
      }
    };
    
    loadObjects();
  }, [projectId, refreshKey]);

  // Load drawn regions from backend file on mount
  useEffect(() => {
    const loadRegions = async () => {
      if (!projectId) return;
      
      try {
        const regions = await getRegionsFromBackend(projectId);
        if (regions.length > 0) {
          console.log(`Loaded ${regions.length} regions from backend`);
          setDrawnRegions(regions);
        }
      } catch (error) {
        console.error('Failed to load regions from backend:', error);
      }
    };
    
    loadRegions();
  }, [projectId]);

  // Handle pending navigation from Classes page
  const pendingNavigationIdRef = useRef(null);
  const isNavigatingRef = useRef(false);
  const navigationTargetPageRef = useRef(null); // Suppresses setCurrentPage(1) on file load during navigation
  
  useEffect(() => {
    // Check if this is a new navigation request
    const navId = pendingNavigation?.id;
    
    // Skip if already navigating or if this is the same navigation
    if (isNavigatingRef.current) return;
    if (!pendingNavigation || !pdfDoc || canvasSize.width <= 0) return;
    if (navId === pendingNavigationIdRef.current) return;
    
    // Mark as navigating and save the ID
    isNavigatingRef.current = true;
    pendingNavigationIdRef.current = navId;
    
    // Short delay to ensure initial render is complete, then navigate.
    // navigateToObject polls for readiness internally for cross-file navigation.
    const timeout = setTimeout(() => {
      navigateToObject(pendingNavigation, 1.5);
      if (onNavigationComplete) {
        onNavigationComplete();
      }
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 500);
    }, 100);
    
    return () => {
      clearTimeout(timeout);
    };
  }, [pendingNavigation?.id, pdfDoc, canvasSize.width > 0]);
  
  // Reset ref when navigation is cleared
  useEffect(() => {
    if (!pendingNavigation) {
      pendingNavigationIdRef.current = null;
      isNavigatingRef.current = false;
      navigationTargetPageRef.current = null;
    }
  }, [pendingNavigation]);

  const handleAssignPdf = (targetFileId, targetFilename = null) => {
    if (pendingHotspot) {
      const hotspotWithTarget = { 
        ...pendingHotspot, 
        targetFileId,
        targetFilename: targetFilename || null
      };
      const existingIndex = hotspots.findIndex(h => h.id === pendingHotspot.id);
      
      let newHotspots;
      if (existingIndex >= 0) {
        newHotspots = [...hotspots];
        newHotspots[existingIndex] = hotspotWithTarget;
      } else {
        newHotspots = [...hotspots, hotspotWithTarget];
      }
      
      saveHotspots(newHotspots);
      setShowAssignDialog(false);
      setPendingHotspot(null);
    }
  };

  const handleDeleteHotspot = (hotspotId) => {
    saveHotspots(hotspots.filter(h => h.id !== hotspotId));
  };

  const handleDeleteAllHotspots = () => {
    if (confirm(`Delete all ${hotspots.length} links on this PDF?`)) {
      saveHotspots([]);
    }
  };

  // ============================================
  // MARKUP SELECTION & EDITING FUNCTIONS (Revu-style)
  // ============================================
  
  // Hit test to find markup at a given position
  const hitTestMarkup = useCallback((clickX, clickY) => {
    // clickX and clickY are normalized (0-1) coordinates
    const pageMarkups = markups.filter(
      m => m.page === currentPage - 1 && m.filename === currentFileIdentifier
    );
    
    // Base tolerance - about 4 pixels at typical zoom
    const baseTolerance = 0.005;
    
    // Helper: for rotated shapes, transform click point into the shape's local (unrotated) coordinate space
    // Rotation is applied in pixel space (SVG), so we must account for the page aspect ratio
    // when converting the inverse rotation back to normalized (0-1) coordinates.
    const pageW = canvasSize.width || 1;
    const pageH = canvasSize.height || 1;
    const hw = pageH / pageW; // height-to-width ratio
    
    const getLocalClick = (markup, cx, cy) => {
      if (!markup.rotation) return { lx: cx, ly: cy };
      const rot = -markup.rotation * Math.PI / 180; // inverse rotation
      // Shape center in normalized coords
      let centerX, centerY;
      if (markup.startX !== undefined && markup.endX !== undefined) {
        centerX = (markup.startX + markup.endX) / 2;
        centerY = (markup.startY + markup.endY) / 2;
      } else if (markup.x !== undefined) {
        centerX = markup.x;
        centerY = markup.y;
      } else {
        return { lx: cx, ly: cy };
      }
      const dx = cx - centerX;
      const dy = cy - centerY;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      // Inverse-rotate in pixel space, then convert back to normalized:
      // lx = centerX + dx*cos - dy*(H/W)*sin
      // ly = centerY + dx*(W/H)*sin + dy*cos
      return {
        lx: centerX + dx * cosR - dy * hw * sinR,
        ly: centerY + dx / hw * sinR + dy * cosR
      };
    };
    
    // Check in reverse order (topmost first)
    for (let i = pageMarkups.length - 1; i >= 0; i--) {
      const markup = pageMarkups[i];
      // Stroke tolerance scales with stroke width but has a minimum
      const strokeTolerance = Math.max(baseTolerance, (markup.strokeWidth || 2) * 0.0008);
      
      // For rotated shapes, use local (unrotated) coordinates for hit testing
      const { lx, ly } = getLocalClick(markup, clickX, clickY);
      
      if (markup.type === 'pen' || markup.type === 'highlighter') {
        // Check if click is near any segment in the path
        for (let j = 0; j < markup.points.length - 1; j++) {
          const p1 = markup.points[j];
          const p2 = markup.points[j + 1];
          const dist = pointToLineDistance(clickX, clickY, p1.x, p1.y, p2.x, p2.y);
          if (dist < strokeTolerance) {
            return markup;
          }
        }
      } else if (markup.type === 'rectangle') {
        const minX = Math.min(markup.startX, markup.endX);
        const maxX = Math.max(markup.startX, markup.endX);
        const minY = Math.min(markup.startY, markup.endY);
        const maxY = Math.max(markup.startY, markup.endY);
        
        // Check if inside filled area first (if has fill)
        const hasFill = markup.fillColor && markup.fillColor !== 'none' && markup.fillColor !== 'transparent';
        if (hasFill && lx >= minX && lx <= maxX && ly >= minY && ly <= maxY) {
          return markup;
        }
        
        // Check if on the border - must be within tolerance of edge AND within the edge bounds
        const onLeftEdge = Math.abs(lx - minX) < strokeTolerance && ly >= minY && ly <= maxY;
        const onRightEdge = Math.abs(lx - maxX) < strokeTolerance && ly >= minY && ly <= maxY;
        const onTopEdge = Math.abs(ly - minY) < strokeTolerance && lx >= minX && lx <= maxX;
        const onBottomEdge = Math.abs(ly - maxY) < strokeTolerance && lx >= minX && lx <= maxX;
        
        if (onLeftEdge || onRightEdge || onTopEdge || onBottomEdge) {
          return markup;
        }
      } else if (markup.type === 'circle') {
        const cx = (markup.startX + markup.endX) / 2;
        const cy = (markup.startY + markup.endY) / 2;
        const rx = Math.abs(markup.endX - markup.startX) / 2;
        const ry = Math.abs(markup.endY - markup.startY) / 2;
        
        if (rx > 0.001 && ry > 0.001) {
          const dx = (lx - cx) / rx;
          const dy = (ly - cy) / ry;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          // Check if inside filled area first
          const hasFill = markup.fillColor && markup.fillColor !== 'none' && markup.fillColor !== 'transparent';
          if (hasFill && dist <= 1) {
            return markup;
          }
          
          // Check if on border - distance from unit circle should be within tolerance
          const borderTolerance = strokeTolerance / Math.min(rx, ry);
          if (Math.abs(dist - 1) < borderTolerance) {
            return markup;
          }
        }
      } else if (markup.type === 'arc') {
        // 3-point arc hit testing
        const p1x = markup.point1X;
        const p1y = markup.point1Y;
        const p2x = markup.point2X;
        const p2y = markup.point2Y;
        const bulge = markup.arcBulge || 0.5;
        
        // Calculate midpoint of chord
        const midX = (p1x + p2x) / 2;
        const midY = (p1y + p2y) / 2;
        
        // Calculate chord length and perpendicular direction
        const chordDx = p2x - p1x;
        const chordDy = p2y - p1y;
        const chordLen = Math.sqrt(chordDx * chordDx + chordDy * chordDy);
        
        if (chordLen > 0.001) {
          // Perpendicular unit vector (pointing to arc bulge side)
          const perpX = -chordDy / chordLen;
          const perpY = chordDx / chordLen;
          
          // Arc apex point (point on arc furthest from chord)
          const bulgeOffset = chordLen * bulge;
          const apexX = midX + perpX * bulgeOffset;
          const apexY = midY + perpY * bulgeOffset;
          
          // Check distance to arc segments
          const dist1 = pointToLineDistance(clickX, clickY, p1x, p1y, apexX, apexY);
          const dist2 = pointToLineDistance(clickX, clickY, apexX, apexY, p2x, p2y);
          
          if (Math.min(dist1, dist2) < strokeTolerance) {
            return markup;
          }
        }
      } else if (markup.type === 'arrow') {
        // Check distance to line segment
        const x1 = markup.startX, y1 = markup.startY;
        const x2 = markup.endX, y2 = markup.endY;
        const dist = pointToLineDistance(clickX, clickY, x1, y1, x2, y2);
        if (dist < strokeTolerance) {
          return markup;
        }
        // Also check arrowhead area
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const arrowLen = 0.015; // Approximate arrowhead size
        const arrowAngle = Math.PI / 6;
        const tip1X = x2 - arrowLen * Math.cos(angle - arrowAngle);
        const tip1Y = y2 - arrowLen * Math.sin(angle - arrowAngle);
        const tip2X = x2 - arrowLen * Math.cos(angle + arrowAngle);
        const tip2Y = y2 - arrowLen * Math.sin(angle + arrowAngle);
        const distTip1 = pointToLineDistance(clickX, clickY, x2, y2, tip1X, tip1Y);
        const distTip2 = pointToLineDistance(clickX, clickY, x2, y2, tip2X, tip2Y);
        if (distTip1 < strokeTolerance || distTip2 < strokeTolerance) {
          return markup;
        }
      } else if (markup.type === 'text' || markup.type === 'callout') {
        // Text box - click anywhere inside selects it
        if (markup.startX !== undefined && markup.endX !== undefined) {
          const minX = Math.min(markup.startX, markup.endX);
          const maxX = Math.max(markup.startX, markup.endX);
          const minY = Math.min(markup.startY, markup.endY);
          const maxY = Math.max(markup.startY, markup.endY);
          
          if (lx >= minX && lx <= maxX && ly >= minY && ly <= maxY) {
            return markup;
          }
        } else if (markup.origBounds) {
          // Old format with origBounds
          const minX = markup.origBounds.x1;
          const maxX = markup.origBounds.x2;
          const minY = markup.origBounds.y1;
          const maxY = markup.origBounds.y2;
          
          if (lx >= minX && lx <= maxX && ly >= minY && ly <= maxY) {
            return markup;
          }
        } else if (markup.x !== undefined) {
          // Old format without origBounds - approximate text bounds
          const fontSize = (markup.fontSize || 16) / (canvasSize.width || 800);
          const textWidth = Math.max(0.05, (markup.text?.length || 5) * fontSize * 0.6);
          const textHeight = fontSize * 1.5;
          if (lx >= markup.x && lx <= markup.x + textWidth &&
              ly >= markup.y && ly <= markup.y + textHeight) {
            return markup;
          }
        }
      } else if (markup.type === 'line') {
        const x1 = markup.startX, y1 = markup.startY;
        const x2 = markup.endX, y2 = markup.endY;
        const dist = pointToLineDistance(clickX, clickY, x1, y1, x2, y2);
        if (dist < strokeTolerance) {
          return markup;
        }
      } else if (markup.type === 'note') {
        // Check if clicking on note icon (small square)
        const noteSize = 0.015;
        if (clickX >= markup.x - noteSize && clickX <= markup.x + noteSize &&
            clickY >= markup.y - noteSize && clickY <= markup.y + noteSize) {
          return markup;
        }
      } else if (markup.type === 'cloud') {
        const minX = Math.min(markup.startX, markup.endX);
        const maxX = Math.max(markup.startX, markup.endX);
        const minY = Math.min(markup.startY, markup.endY);
        const maxY = Math.max(markup.startY, markup.endY);
        
        // Check if inside filled area first
        const hasFill = markup.fillColor && markup.fillColor !== 'none' && markup.fillColor !== 'transparent';
        if (hasFill && clickX >= minX && clickX <= maxX && clickY >= minY && clickY <= maxY) {
          return markup;
        }
        
        // Check edges with cloud bump tolerance (slightly wider due to bumps)
        const cloudTol = strokeTolerance + 0.008; // Extra for cloud bumps
        const onLeftEdge = Math.abs(clickX - minX) < cloudTol && clickY >= minY && clickY <= maxY;
        const onRightEdge = Math.abs(clickX - maxX) < cloudTol && clickY >= minY && clickY <= maxY;
        const onTopEdge = Math.abs(clickY - minY) < cloudTol && clickX >= minX && clickX <= maxX;
        const onBottomEdge = Math.abs(clickY - maxY) < cloudTol && clickX >= minX && clickX <= maxX;
        
        if (onLeftEdge || onRightEdge || onTopEdge || onBottomEdge) {
          return markup;
        }
      } else if (markup.type === 'polyline' || markup.type === 'polylineArrow' || markup.type === 'cloudPolyline' || markup.type === 'polygon') {
        // Check if click is near any edge
        if (markup.points && markup.points.length >= 2) {
          const isClosed = markup.type === 'polygon' || markup.closed;
          const numSegments = isClosed ? markup.points.length : markup.points.length - 1;
          for (let j = 0; j < numSegments; j++) {
            const p1 = markup.points[j];
            const p2 = markup.points[(j + 1) % markup.points.length];
            const dist = pointToLineDistance(clickX, clickY, p1.x, p1.y, p2.x, p2.y);
            if (dist < strokeTolerance) {
              return markup;
            }
          }
          // Check inside for filled closed shapes (polygon or closed polyline/cloudPolyline)
          if (isClosed && markup.fillColor && markup.fillColor !== 'none' && markup.fillColor !== 'transparent') {
            let inside = false;
            const pts = markup.points;
            for (let j = 0, k = pts.length - 1; j < pts.length; k = j++) {
              if (((pts[j].y > clickY) !== (pts[k].y > clickY)) &&
                  (clickX < (pts[k].x - pts[j].x) * (clickY - pts[j].y) / (pts[k].y - pts[j].y) + pts[j].x)) {
                inside = !inside;
              }
            }
            if (inside) return markup;
          }
        }
      } else if (markup.type === 'textHighlight' || markup.type === 'stamp' || markup.type === 'redact' || markup.type === 'fileAttachment' || markup.type === 'unknown') {
        // Rectangle-like bounds - click inside
        const minX = Math.min(markup.startX, markup.endX);
        const maxX = Math.max(markup.startX, markup.endX);
        const minY = Math.min(markup.startY, markup.endY);
        const maxY = Math.max(markup.startY, markup.endY);
        
        if (clickX >= minX && clickX <= maxX && clickY >= minY && clickY <= maxY) {
          return markup;
        }
      } else if (markup.type === 'textMarkup') {
        // Line-based (underline, strikeout, squiggly)
        const dist = pointToLineDistance(clickX, clickY, markup.startX, markup.startY, markup.endX, markup.endY);
        if (dist < strokeTolerance) {
          return markup;
        }
      } else if (markup.type === 'caret' || markup.type === 'sound') {
        // Point-based
        const size = 0.015;
        if (clickX >= markup.x - size && clickX <= markup.x + size &&
            clickY >= markup.y - size && clickY <= markup.y + size) {
          return markup;
        }
      } else if (markup.type === 'symbol') {
        // Symbol markup - click inside bounds
        const minX = Math.min(markup.startX, markup.endX);
        const maxX = Math.max(markup.startX, markup.endX);
        const minY = Math.min(markup.startY, markup.endY);
        const maxY = Math.max(markup.startY, markup.endY);
        
        if (clickX >= minX && clickX <= maxX && clickY >= minY && clickY <= maxY) {
          return markup;
        }
      } else if (markup.type === 'image') {
        // Image markup - click inside bounds
        const minX = Math.min(markup.startX, markup.endX);
        const maxX = Math.max(markup.startX, markup.endX);
        const minY = Math.min(markup.startY, markup.endY);
        const maxY = Math.max(markup.startY, markup.endY);
        
        if (clickX >= minX && clickX <= maxX && clickY >= minY && clickY <= maxY) {
          return markup;
        }
      }
    }
    return null;
  }, [markups, currentPage, currentFile?.backendFilename]);
  
  // Helper: point to line segment distance
  const pointToLineDistance = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    
    const nearX = x1 + t * dx;
    const nearY = y1 + t * dy;
    return Math.sqrt((px - nearX) ** 2 + (py - nearY) ** 2);
  };
  
  // Convert a PDF annotation to editable format
  // This is called when a user selects a PDF annotation with custom appearance
  const convertToEditableFormat = useCallback((markup) => {
    const converted = { ...markup, modified: true };
    
    if (markup.type === 'text') {
      // Convert old text format (x, y) to text box format (startX, startY, endX, endY)
      if (markup.x !== undefined && markup.startX === undefined) {
        // Store original PDF bounds for patching (to hide PDF.js rendered version)
        if (markup.origBounds) {
          converted.pdfOrigBounds = { ...markup.origBounds };
          converted.startX = markup.origBounds.x1;
          converted.startY = markup.origBounds.y1;
          converted.endX = markup.origBounds.x2;
          converted.endY = markup.origBounds.y2;
        } else {
          // Estimate bounds from text content
          const fontSize = (markup.fontSize || 12) / (canvasSize.width || 800);
          const textWidth = Math.max(0.05, (markup.text?.length || 5) * fontSize * 0.6);
          const textHeight = fontSize * 1.5;
          converted.startX = markup.x;
          converted.startY = markup.y;
          converted.endX = markup.x + textWidth;
          converted.endY = markup.y + textHeight;
        }
        // Remove old format properties but keep pdfOrigBounds for patching
        delete converted.x;
        delete converted.y;
        delete converted.origBounds;
        
        // Set default colors if not present
        if (!converted.borderColor) {
          converted.borderColor = converted.color || '#000000';
        }
        if (!converted.fillColor) {
          converted.fillColor = 'white';
        }
      }
    } else if (markup.type === 'textHighlight') {
      // Convert textHighlight to rectangle for editing
      converted.type = 'rectangle';
      converted.strokeWidth = 0;
      converted.color = 'none';
      converted.fillColor = markup.color;
      converted.opacity = markup.opacity || 0.3;
    } else if (markup.type === 'textMarkup') {
      // Convert underline/strikeout to line for editing
      converted.type = 'line';
    }
    
    console.log('Converted annotation for editing:', markup.id, converted);
    return converted;
  }, [canvasSize.width]);
  
  // Convert markup to pending region shape format for region assignment
  const convertMarkupToRegionShape = useCallback((markup) => {
    if (!markup) return null;
    
    const bounds = getMarkupBounds(markup);
    if (!bounds) return null;
    
    // Determine shape type based on markup type
    let shapeType = 'rectangle';
    let polylinePoints = null;
    
    if (markup.type === 'circle') {
      shapeType = 'circle';
    } else if (markup.type === 'polyline' || markup.type === 'polylineArrow' || markup.type === 'cloudPolyline' || markup.type === 'polygon') {
      shapeType = 'polyline';
      polylinePoints = markup.points ? [...markup.points] : null;
    }
    
    return {
      x: bounds.minX,
      y: bounds.minY,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      page: markup.page !== undefined ? markup.page : currentPage - 1,
      shapeType,
      polylinePoints,
    };
  }, [getMarkupBounds, currentPage]);
  
  // Handle right-click context menu on markups
  const handleMarkupContextMenu = useCallback((e, markup) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Position the context menu at click location
    setMarkupContextMenuPos({ x: e.clientX, y: e.clientY });
    setMarkupContextMenuTarget(markup);
    setShowMarkupContextMenu(true);
  }, []);
  
  // Handle "Convert to Region" from context menu
  const handleConvertToRegion = useCallback(() => {
    if (!markupContextMenuTarget) return;
    
    const regionShape = convertMarkupToRegionShape(markupContextMenuTarget);
    if (regionShape) {
      setPendingRegionShape(regionShape);
      setRegionTypeInput('');
      setSubRegionNameInput('');
      setRegionFillColorInput('#3498db');
      setRegionBorderColorInput('#3498db');
      setShowRegionAssignDialog(true);
    }
    
    setShowMarkupContextMenu(false);
    setMarkupContextMenuTarget(null);
  }, [markupContextMenuTarget, convertMarkupToRegionShape]);
  
  // Handle "Flatten to Page" from context menu — bakes markup into page content
  const handleFlattenMarkup = useCallback(async () => {
    if (!markupContextMenuTarget || !currentFile) return;

    const markupToFlatten = markupContextMenuTarget;
    setShowMarkupContextMenu(false);
    setMarkupContextMenuTarget(null);

    try {
      setIsSavingMarkups(true);
      const backendFilename = await ensureFileOnBackend(currentFile);

      // Also include the pdfAnnotId if this was originally a PDF annotation — backend needs to remove it
      const annotationsToRemove = markupToFlatten.pdfAnnotId ? [markupToFlatten.pdfAnnotId] : [];

      const response = await fetch(`${BACKEND_URL}/api/pdf/save-markups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfFilename: backendFilename,
          markups: [markupToFlatten],
          annotationsToRemove,
          flatten: true,
          saveInPlace: true,
          canvasWidth: canvasSize.width,
          canvasHeight: canvasSize.height,
          sourceFolder: currentFile?.sourceFolder || null,
        })
      });

      if (!response.ok) {
        const ct = response.headers.get('content-type');
        if (ct && ct.includes('application/json')) {
          const err = await response.json();
          throw new Error(err.error || 'Failed to flatten');
        }
        throw new Error(`Server error: ${response.status}`);
      }

      // Remove the markup from the SVG layer — it's now part of the page
      setMarkups(prev => prev.filter(m => m.id !== markupToFlatten.id));
      if (selectedMarkup?.id === markupToFlatten.id) {
        setSelectedMarkup(null);
        selectedMarkupRef.current = null;
      }

      // Reload the PDF to show the flattened content
      if (pdfDoc && currentFile) {
        await new Promise(r => setTimeout(r, 200));
        const reloadUrl = `${BACKEND_URL}/api/pdf/${encodeURIComponent(backendFilename)}?t=${Date.now()}${currentFile.sourceFolder ? `&sourceFolder=${encodeURIComponent(currentFile.sourceFolder)}` : ''}`;
        try {
          const loadingTask = window.pdfjsLib.getDocument(reloadUrl);
          const newPdfDoc = await loadingTask.promise;
          setPdfDoc(newPdfDoc);
          setNumPages(newPdfDoc.numPages);
          if (resetRenderedPages) resetRenderedPages();
        } catch (reloadErr) {
          console.warn('Flattened but failed to reload:', reloadErr);
        }
      }

      console.log('Flattened markup:', markupToFlatten.type, markupToFlatten.id);
      if (saveNotifTimerRef.current) clearTimeout(saveNotifTimerRef.current);
      setSaveNotification({ type: 'success', message: 'Markup flattened to page' });
      saveNotifTimerRef.current = setTimeout(() => setSaveNotification(null), 2500);
    } catch (error) {
      console.error('Error flattening markup:', error);
      if (saveNotifTimerRef.current) clearTimeout(saveNotifTimerRef.current);
      setSaveNotification({ type: 'error', message: error.message });
    } finally {
      setIsSavingMarkups(false);
    }
  }, [markupContextMenuTarget, currentFile, canvasSize, pdfDoc, ensureFileOnBackend, selectedMarkup]);

  // Close context menu when clicking elsewhere
  useEffect(() => {
    if (!showMarkupContextMenu) return;
    
    const handleClickOutside = (e) => {
      // Don't close if clicking inside the context menu itself
      if (e.target.closest('.markup-context-menu')) return;
      setShowMarkupContextMenu(false);
      setMarkupContextMenuTarget(null);
    };
    
    // Use a small timeout so the opening right-click's events all complete
    // before we start listening. On Windows, contextmenu fires on mouseup
    // which would immediately close the menu if we listened for it.
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMarkupContextMenu]);
  
  // Check which resize handle is being hovered/clicked
  const getResizeHandle = useCallback((clickX, clickY, bounds, markup = null) => {
    if (!bounds) return null;
    
    // Hit area should match the visible handle size (14px) plus tolerance
    // Use 14px (halfHit=14) to match the 28px invisible touch target in renderSelectionHandles
    const scaledW = canvasSize.width * scale;
    const scaledH = canvasSize.height * scale;
    const handleSizeX = scaledW > 0 ? 14 / scaledW : 0.01;
    const handleSizeY = scaledH > 0 ? 14 / scaledH : 0.01;
    
    // For arrows and lines, check endpoint handles (circles)
    if (markup && (markup.type === 'arrow' || markup.type === 'line')) {
      const endpointHitX = scaledW > 0 ? 14 / scaledW : 0.01;
      const endpointHitY = scaledH > 0 ? 14 / scaledH : 0.01;
      if (Math.abs(clickX - markup.startX) < endpointHitX && Math.abs(clickY - markup.startY) < endpointHitY) return 'start';
      if (Math.abs(clickX - markup.endX) < endpointHitX && Math.abs(clickY - markup.endY) < endpointHitY) return 'end';
      return null;
    }
    
    const { minX, maxX, minY, maxY } = bounds;
    
    // For rotated shapes, un-rotate the click into local coordinate space
    let localX = clickX, localY = clickY;
    if (markup && markup.rotation) {
      const rot = -markup.rotation * Math.PI / 180;
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const dx = clickX - cx;
      const dy = clickY - cy;
      const cosR = Math.cos(rot), sinR = Math.sin(rot);
      const hw = (canvasSize.height || 1) / (canvasSize.width || 1);
      localX = cx + dx * cosR - dy * hw * sinR;
      localY = cy + dx / hw * sinR + dy * cosR;
    }
    
    // Check if this is a text box (only corner resize allowed)
    const isTextBox = markup && markup.type === 'text' && markup.startX !== undefined;
    
    // Corner handles - check if click is within handle area
    if (Math.abs(localX - minX) < handleSizeX && Math.abs(localY - minY) < handleSizeY) return 'nw';
    if (Math.abs(localX - maxX) < handleSizeX && Math.abs(localY - minY) < handleSizeY) return 'ne';
    if (Math.abs(localX - minX) < handleSizeX && Math.abs(localY - maxY) < handleSizeY) return 'sw';
    if (Math.abs(localX - maxX) < handleSizeX && Math.abs(localY - maxY) < handleSizeY) return 'se';
    
    // Edge handles - not for text boxes
    if (!isTextBox) {
      const midX = (minX + maxX) / 2;
      const midY = (minY + maxY) / 2;
      if (Math.abs(localX - midX) < handleSizeX && Math.abs(localY - minY) < handleSizeY) return 'n';
      if (Math.abs(localX - midX) < handleSizeX && Math.abs(localY - maxY) < handleSizeY) return 's';
      if (Math.abs(localX - minX) < handleSizeX && Math.abs(localY - midY) < handleSizeY) return 'w';
      if (Math.abs(localX - maxX) < handleSizeX && Math.abs(localY - midY) < handleSizeY) return 'e';
    }
    
    return null;
  }, [canvasSize, scale]);
  
  
  // Global mouse handlers for continuous view drag/resize operations
  useEffect(() => {
    if (!isContinuousView(viewMode)) return;
    
    const handleGlobalMouseMove = (e) => {
      // Only handle if dragging/resizing in continuous view
      if (!isDraggingMarkupRef.current && !isResizingMarkupRef.current) return;
      if (!selectedMarkupRef.current || !markupDragStartRef.current) return;
      
      const pageNum = selectedMarkupRef.current.page + 1;
      const pageEl = containerRef.current?.querySelector(`[data-page="${pageNum}"]`);
      if (!pageEl) return;
      
      const rect = pageEl.getBoundingClientRect();
      const dims = allPageDimensions[pageNum] || { width: canvasSize.width || 800, height: canvasSize.height || 1000 };
      const baseWidth = dims.width;
      const baseHeight = dims.height;
      const pageWidth = baseWidth * scale;
      const pageHeight = baseHeight * scale;
      
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      const _clampedNX = Math.max(0, Math.min(1, x / baseWidth));
      const _clampedNY = Math.max(0, Math.min(1, y / baseHeight));
      const { x: normalizedX, y: normalizedY } = inverseTransformCoordinate(_clampedNX, _clampedNY);

      const deltaX = normalizedX - markupDragStartRef.current.x;
      const deltaY = normalizedY - markupDragStartRef.current.y;
      
      if (isDraggingMarkupRef.current) {
        if (Math.abs(deltaX) > 0.001 || Math.abs(deltaY) > 0.001) {
          didDragMoveRef.current = true;
        }
        
        // Accumulate delta instead of calling moveMarkup
        dragDeltaRef.current.x += deltaX;
        dragDeltaRef.current.y += deltaY;
        
        // Update selection overlay position via direct DOM manipulation
        if (continuousSelectionRef.current) {
          const offsetX = dragDeltaRef.current.x * pageWidth;
          const offsetY = dragDeltaRef.current.y * pageHeight;
          continuousSelectionRef.current.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
        }
        
        // Also move the markup element directly via DOM for smooth visual feedback
        if (selectedMarkupRef.current) {
          const markupEl = document.querySelector(`[data-markup-id="${selectedMarkupRef.current.id}"]`);
          if (markupEl) {
            const offsetX = dragDeltaRef.current.x * pageWidth;
            const offsetY = dragDeltaRef.current.y * pageHeight;
            markupEl.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
          }
        }
      } else if (isResizingMarkupRef.current && resizeHandleRef.current) {
        // For rotated shapes, un-rotate the delta into local space
        let localDeltaX = deltaX, localDeltaY = deltaY;
        const resizeRotation = selectedMarkupRef.current?.rotation || 0;
        if (resizeRotation) {
          const rot = -resizeRotation * Math.PI / 180;
          const cosR = Math.cos(rot), sinR = Math.sin(rot);
          const hw = (baseHeight || 1) / (baseWidth || 1);
          localDeltaX = deltaX * cosR - deltaY * hw * sinR;
          localDeltaY = deltaX / hw * sinR + deltaY * cosR;
        }
        resizeMarkup(selectedMarkupRef.current.id, resizeHandleRef.current, localDeltaX, localDeltaY, markupDragStartRef.current.bounds);
      }
      
      markupDragStartRef.current = {
        ...markupDragStartRef.current,
        x: normalizedX,
        y: normalizedY
      };
    };
    
    const handleGlobalMouseUp = () => {
      // Handle continuous view markup drag/resize completion
      if (isDraggingMarkupRef.current || isResizingMarkupRef.current) {
        // Handle polyline vertex drag finalization FIRST
        if (isDraggingMarkupRef.current && draggingPolylinePointRef.current !== null && 
            selectedMarkupRef.current && markupDragStartRef.current?.originalPoints) {
          const pointIndex = markupDragStartRef.current.pointIndex;
          const totalDeltaX = markupDragStartRef.current.totalDeltaX || 0;
          const totalDeltaY = markupDragStartRef.current.totalDeltaY || 0;
          const origPoint = markupDragStartRef.current.originalPoints[pointIndex];
          
          if (origPoint && (Math.abs(totalDeltaX) > 0.0001 || Math.abs(totalDeltaY) > 0.0001)) {
            const newPointX = origPoint.x + totalDeltaX;
            const newPointY = origPoint.y + totalDeltaY;
            saveHistory();
            setMarkups(prev => prev.map(m => {
              if (m.id === selectedMarkupRef.current.id && m.points) {
                const newPoints = [...m.points];
                newPoints[pointIndex] = { x: newPointX, y: newPointY };
                const allX = newPoints.map(p => p.x);
                const allY = newPoints.map(p => p.y);
                return { ...m, points: newPoints, startX: Math.min(...allX), startY: Math.min(...allY), endX: Math.max(...allX), endY: Math.max(...allY), modified: m.fromPdf ? true : m.modified };
              }
              return m;
            }));
            setSelectedMarkup(prev => {
              if (!prev || !prev.points) return prev;
              const newPoints = [...prev.points];
              newPoints[pointIndex] = { x: newPointX, y: newPointY };
              const allX = newPoints.map(p => p.x);
              const allY = newPoints.map(p => p.y);
              const updated = { ...prev, points: newPoints, startX: Math.min(...allX), startY: Math.min(...allY), endX: Math.max(...allX), endY: Math.max(...allY) };
              selectedMarkupRef.current = updated;
              return updated;
            });
            setUnsavedMarkupFiles(prev => new Set([...prev, currentFileIdentifier]));
          }
          
          // Clear polyline drag state
          draggingPolylinePointRef.current = null;
          setDraggingPolylinePoint(null);
          isDraggingMarkupRef.current = false;
          setIsDraggingMarkup(false);
          didDragMoveRef.current = false;
          markupDragStartRef.current = null;
          setMarkupDragStart(null);
          return;
        }
        
        // Apply accumulated drag delta
        if (isDraggingMarkupRef.current && didDragMoveRef.current && selectedMarkupRef.current) {
          const totalDeltaX = dragDeltaRef.current.x;
          const totalDeltaY = dragDeltaRef.current.y;
          
          if (Math.abs(totalDeltaX) > 0.001 || Math.abs(totalDeltaY) > 0.001) {
            moveMarkup(selectedMarkupRef.current.id, totalDeltaX, totalDeltaY);
          }
        }
        
        // Reset drag delta and selection transform
        dragDeltaRef.current = { x: 0, y: 0 };
        if (continuousSelectionRef.current) {
          continuousSelectionRef.current.style.transform = '';
        }
        // Also clear the markup element transform
        if (selectedMarkupRef.current) {
          const markupEl = document.querySelector(`[data-markup-id="${selectedMarkupRef.current.id}"]`);
          if (markupEl) {
            markupEl.style.transform = '';
          }
        }
        
        // Mark file as having unsaved changes
        if (didDragMoveRef.current || isResizingMarkupRef.current) {
          setUnsavedMarkupFiles(prev => new Set([...prev, currentFileIdentifier]));
        }
        
        // If there was no movement and markup was already selected, deselect
        if (isDraggingMarkupRef.current && !didDragMoveRef.current && wasAlreadySelectedRef.current && selectedMarkupRef.current) {
          setSelectedMarkup(null);
          selectedMarkupRef.current = null;
        } else if (selectedMarkupRef.current) {
          // Refresh selectedMarkup from markups array after move
          setTimeout(() => {
            setMarkups(current => {
              const updated = current.find(m => m.id === selectedMarkupRef.current?.id);
              if (updated) {
                setSelectedMarkup(updated);
                selectedMarkupRef.current = updated;
              }
              return current;
            });
          }, 0);
        }
        
        // Reset all drag/resize state
        isDraggingMarkupRef.current = false;
        setIsDraggingMarkup(false);
        isResizingMarkupRef.current = false;
        setIsResizingMarkup(false);
        didDragMoveRef.current = false;
        wasAlreadySelectedRef.current = false;
        resizeHandleRef.current = null;
        setResizeHandle(null);
        markupDragStartRef.current = null;
        setMarkupDragStart(null);
      }
    };
    
    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [viewMode, currentFileIdentifier, scale, allPageDimensions, canvasSize, moveMarkup, resizeMarkup, saveHistory]);
  // Note: markups removed from deps - we use refs for immediate updates
  
  
  // Save selected markups as a reusable symbol
  const saveAsSymbol = useCallback((name, group) => {
    const markupsToSave = selectedMarkups.length > 0 ? selectedMarkups : (selectedMarkup ? [selectedMarkup] : []);
    if (markupsToSave.length === 0) return;
    
    // Calculate bounding box of all markups
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    markupsToSave.forEach(m => {
      if (m.type === 'pen' || m.type === 'highlighter' || m.type === 'polyline' || m.type === 'polylineArrow' || m.type === 'cloudPolyline' || m.type === 'polygon') {
        if (m.points) {
          m.points.forEach(p => {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
          });
        }
      } else if (m.startX !== undefined) {
        minX = Math.min(minX, m.startX, m.endX);
        minY = Math.min(minY, m.startY, m.endY);
        maxX = Math.max(maxX, m.startX, m.endX);
        maxY = Math.max(maxY, m.startY, m.endY);
      } else if (m.x !== undefined) {
        minX = Math.min(minX, m.x);
        minY = Math.min(minY, m.y);
        maxX = Math.max(maxX, m.x);
        maxY = Math.max(maxY, m.y);
      }
    });
    
    const width = maxX - minX;
    const height = maxY - minY;
    
    // Normalize markups relative to bounding box (0-1 range within symbol)
    const normalizedMarkups = markupsToSave.map(m => {
      const normalized = { ...m };
      delete normalized.id;
      delete normalized.file;
      delete normalized.filename;
      delete normalized.page;
      delete normalized.fromPdf;
      delete normalized.modified;
      delete normalized.readOnly;
      
      if (m.type === 'pen' || m.type === 'highlighter' || m.type === 'polyline' || m.type === 'polylineArrow' || m.type === 'cloudPolyline' || m.type === 'polygon') {
        normalized.points = m.points.map(p => ({
          x: width > 0 ? (p.x - minX) / width : 0.5,
          y: height > 0 ? (p.y - minY) / height : 0.5
        }));
        // Remove bounding box for polylines/polygons - will be recalculated on placement
        if (m.type === 'polyline' || m.type === 'polylineArrow' || m.type === 'cloudPolyline' || m.type === 'polygon') {
          delete normalized.startX;
          delete normalized.startY;
          delete normalized.endX;
          delete normalized.endY;
        }
      } else if (m.startX !== undefined) {
        normalized.startX = width > 0 ? (m.startX - minX) / width : 0.5;
        normalized.startY = height > 0 ? (m.startY - minY) / height : 0.5;
        normalized.endX = width > 0 ? (m.endX - minX) / width : 0.5;
        normalized.endY = height > 0 ? (m.endY - minY) / height : 0.5;
      } else if (m.x !== undefined) {
        normalized.x = width > 0 ? (m.x - minX) / width : 0.5;
        normalized.y = height > 0 ? (m.y - minY) / height : 0.5;
      }
      
      return normalized;
    });
    
    // Generate preview by capturing the actual rendered SVG markup elements from the DOM
    let preview = '';
    try {
      const svgEls = markupsToSave.map(m => document.querySelector(`[data-markup-id="${m.id}"]`)).filter(Boolean);
      if (svgEls.length > 0) {
        // Find the parent SVG to get viewBox dimensions
        const parentSvg = svgEls[0].closest('svg');
        const vb = parentSvg?.getAttribute('viewBox')?.split(' ').map(Number) || [0, 0, 800, 600];
        const svgW = vb[2], svgH = vb[3];
        
        // Get bounding box of all elements in SVG coordinates
        let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
        svgEls.forEach(el => {
          try {
            const bbox = el.getBBox();
            bMinX = Math.min(bMinX, bbox.x);
            bMinY = Math.min(bMinY, bbox.y);
            bMaxX = Math.max(bMaxX, bbox.x + bbox.width);
            bMaxY = Math.max(bMaxY, bbox.y + bbox.height);
          } catch(e) {}
        });
        
        // Add padding
        const pad = Math.max((bMaxX - bMinX), (bMaxY - bMinY)) * 0.05;
        bMinX -= pad; bMinY -= pad; bMaxX += pad; bMaxY += pad;
        const cropW = bMaxX - bMinX;
        const cropH = bMaxY - bMinY;
        
        // Clone elements and build SVG
        const cloned = svgEls.map(el => el.cloneNode(true).outerHTML).join('');
        // Copy any <defs> from parent (markers, patterns, etc)
        const defs = parentSvg?.querySelector('defs')?.outerHTML || '';
        preview = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bMinX} ${bMinY} ${cropW} ${cropH}">${defs}${cloned}</svg>`;
      }
    } catch(e) {
      console.warn('Failed to capture markup preview:', e);
    }
    
    const symbol = {
      id: `symbol_${Date.now()}`,
      name: name || `Symbol ${savedSymbols.length + 1}`,
      category: symbolSaveCategory || 'symbol',
      group: group || '',
      markups: normalizedMarkups,
      originalWidth: width,  // Save original normalized width
      originalHeight: height, // Save original normalized height
      aspectRatio: height > 0 ? width / height : 1,
      preview: preview,
      created: new Date().toISOString()
    };
    
    const newSymbols = [...savedSymbols, symbol];
    setSavedSymbols(newSymbols);
    localStorage.setItem('markup_symbols', JSON.stringify(newSymbols));
    
    // Clear selection and dialog
    setShowSaveSymbolDialog(false);
    setSymbolNameInput('');
    setSymbolCreationMode(false);
    setSymbolSaveCategory('symbol');
    setSelectedMarkups([]);
    selectedMarkupsRef.current = [];
    setSelectedMarkup(null);
    selectedMarkupRef.current = null;
  }, [selectedMarkups, selectedMarkup, savedSymbols, symbolSaveCategory]);

  // Place a symbol at a specific location
  const placeSymbol = useCallback((symbol, centerX, centerY, pageOverride) => {
    if (!symbol || !symbol.markups) return;
    
    const currentPageNum = pageOverride !== undefined ? pageOverride : currentPage - 1;
    
    // Use original dimensions if available, otherwise use a default scale
    const width = symbol.originalWidth || 0.1;
    const height = symbol.originalHeight || (0.1 / (symbol.aspectRatio || 1));
    
    // Calculate top-left corner from center
    const offsetX = centerX - width / 2;
    const offsetY = centerY - height / 2;
    
    // Create new markups from symbol
    const newMarkups = symbol.markups.map(m => {
      const newMarkup = { 
        ...m, 
        id: `${m.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        page: currentPageNum,
        filename: currentFileIdentifier
      };
      
      if (m.type === 'pen' || m.type === 'highlighter' || m.type === 'polyline' || m.type === 'polylineArrow' || m.type === 'cloudPolyline' || m.type === 'polygon') {
        newMarkup.points = m.points.map(p => ({
          x: offsetX + p.x * width,
          y: offsetY + p.y * height
        }));
        // Recalculate bounding box for polylines/polygons
        if (m.type === 'polyline' || m.type === 'polylineArrow' || m.type === 'cloudPolyline' || m.type === 'polygon') {
          const xs = newMarkup.points.map(p => p.x);
          const ys = newMarkup.points.map(p => p.y);
          newMarkup.startX = Math.min(...xs);
          newMarkup.startY = Math.min(...ys);
          newMarkup.endX = Math.max(...xs);
          newMarkup.endY = Math.max(...ys);
        }
      } else if (m.startX !== undefined) {
        newMarkup.startX = offsetX + m.startX * width;
        newMarkup.startY = offsetY + m.startY * height;
        newMarkup.endX = offsetX + m.endX * width;
        newMarkup.endY = offsetY + m.endY * height;
      } else if (m.x !== undefined) {
        newMarkup.x = offsetX + m.x * width;
        newMarkup.y = offsetY + m.y * height;
      }
      
      return newMarkup;
    });
    
    // Add all markups with history
    saveHistory();
    setMarkups(prev => [...prev, ...newMarkups]);
  }, [currentPage, markups, currentFileIdentifier]);

  // Place an image-type symbol (bitmap capture)
  const placeImageSymbol = useCallback((symbol, centerX, centerY, pageOverride) => {
    if (!symbol || !symbol.image) return;
    
    const currentPageNum = pageOverride !== undefined ? pageOverride : currentPage - 1;
    
    // Use original dimensions
    const width = symbol.originalWidth || 0.1;
    const height = symbol.originalHeight || (0.1 / (symbol.aspectRatio || 1));
    
    // Calculate top-left corner from center
    const offsetX = centerX - width / 2;
    const offsetY = centerY - height / 2;
    
    // Create image markup
    const imageMarkup = {
      id: `image_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'image',
      image: symbol.image,
      startX: offsetX,
      startY: offsetY,
      endX: offsetX + width,
      endY: offsetY + height,
      page: currentPageNum,
      filename: currentFileIdentifier,
      aspectRatio: symbol.aspectRatio || (width / height)
    };
    
    // Add markup with history
    saveHistory();
    setMarkups(prev => [...prev, imageMarkup]);
  }, [currentPage, markups, currentFileIdentifier]);

  // Efficient drawing overlay update - updates SVG directly without React re-render
  const updateDrawingOverlay = useCallback(() => {
    const overlay = drawingOverlayRef.current;
    const markup = currentMarkupRef.current;
    
    if (!overlay || !markup) {
      if (overlay) overlay.innerHTML = '';
      return;
    }
    
    const pageNum = markup.page + 1;
    const dims = allPageDimensions[pageNum] || { width: canvasSize.width || 800, height: canvasSize.height || 1000 };
    const pageWidth = dims.width * scale;
    const pageHeight = dims.height * scale;
    
    let svgContent = '';
    const strokeWidth = (markup.strokeWidth || 2) * scale;
    const color = markup.color || '#ff0000';
    
    // For shapes with startX/endX, check minimum size before drawing
    if (markup.startX !== undefined && markup.endX !== undefined) {
      const w = Math.abs(markup.endX - markup.startX) * pageWidth;
      const h = Math.abs(markup.endY - markup.startY) * pageHeight;
      if (w < 3 && h < 3) {
        overlay.innerHTML = '';
        return; // Too small to draw
      }
    }
    
    if (markup.type === 'pen' || markup.type === 'highlighter') {
      if (markup.points && markup.points.length >= 2) {
        const pathData = markup.points
          .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * pageWidth} ${p.y * pageHeight}`)
          .join(' ');
        const opacity = markup.type === 'highlighter' ? 0.4 : (markup.opacity || 1);
        svgContent = `<path d="${pathData}" stroke="${color}" stroke-width="${strokeWidth}" fill="none" opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
    } else if (markup.type === 'rectangle') {
      const x = Math.min(markup.startX, markup.endX) * pageWidth;
      const y = Math.min(markup.startY, markup.endY) * pageHeight;
      const w = Math.abs(markup.endX - markup.startX) * pageWidth;
      const h = Math.abs(markup.endY - markup.startY) * pageHeight;
      const fill = markup.fillColor === 'none' ? 'transparent' : (markup.fillColor || 'transparent');
      const lineStyleAttr = markup.lineStyle ? ` stroke-dasharray="${markup.lineStyle === 'dashed' ? `${strokeWidth * 3},${strokeWidth * 2}` : markup.lineStyle === 'dotted' ? `${strokeWidth},${strokeWidth * 2}` : ''}"` : '';
      svgContent = `<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${color}" stroke-width="${strokeWidth}" fill="${fill}" opacity="${markup.opacity || 0.7}" stroke-opacity="${markup.strokeOpacity !== undefined ? markup.strokeOpacity : 1}" fill-opacity="${markup.fillColor === 'none' ? 0 : (markup.fillOpacity !== undefined ? markup.fillOpacity : 0.3)}"${lineStyleAttr}/>`;
    } else if (markup.type === 'circle') {
      const cx = (markup.startX + markup.endX) / 2 * pageWidth;
      const cy = (markup.startY + markup.endY) / 2 * pageHeight;
      const rx = Math.abs(markup.endX - markup.startX) / 2 * pageWidth;
      const ry = Math.abs(markup.endY - markup.startY) / 2 * pageHeight;
      const fill = markup.fillColor === 'none' ? 'transparent' : (markup.fillColor || 'transparent');
      svgContent = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="${color}" stroke-width="${strokeWidth}" fill="${fill}" opacity="${markup.opacity || 0.7}" stroke-opacity="${markup.strokeOpacity !== undefined ? markup.strokeOpacity : 1}" fill-opacity="${markup.fillColor === 'none' ? 0 : (markup.fillOpacity !== undefined ? markup.fillOpacity : 0.3)}"/>`;
    } else if (markup.type === 'arrow' || markup.type === 'line') {
      const x1 = markup.startX * pageWidth;
      const y1 = markup.startY * pageHeight;
      const x2 = markup.endX * pageWidth;
      const y2 = markup.endY * pageHeight;
      svgContent = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}" opacity="${markup.opacity || 1}"/>`;
      if (markup.type === 'arrow') {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const arrowLength = 12 * scale;
        const arrowAngle = Math.PI / 7;
        const ax1 = x2 - arrowLength * Math.cos(angle - arrowAngle);
        const ay1 = y2 - arrowLength * Math.sin(angle - arrowAngle);
        const ax2 = x2 - arrowLength * Math.cos(angle + arrowAngle);
        const ay2 = y2 - arrowLength * Math.sin(angle + arrowAngle);
        svgContent += `<polygon points="${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}" fill="${color}" opacity="${markup.opacity || 1}"/>`;
      }
    } else if (markup.type === 'text' || markup.type === 'callout') {
      const x = Math.min(markup.startX, markup.endX) * pageWidth;
      const y = Math.min(markup.startY, markup.endY) * pageHeight;
      const w = Math.abs(markup.endX - markup.startX) * pageWidth;
      const h = Math.abs(markup.endY - markup.startY) * pageHeight;
      svgContent = `<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${markup.borderColor || '#333'}" stroke-width="1" fill="${markup.fillColor || 'rgba(255,255,255,0.9)'}" stroke-dasharray="5,5"/>`;
    } else if (markup.type === 'cloud') {
      // Cloud preview with bumpy edges
      const x = Math.min(markup.startX, markup.endX) * pageWidth;
      const y = Math.min(markup.startY, markup.endY) * pageHeight;
      const w = Math.abs(markup.endX - markup.startX) * pageWidth;
      const h = Math.abs(markup.endY - markup.startY) * pageHeight;
      
      // Need minimum size for cloud arcs
      if (w < 10 || h < 10) {
        // Draw simple rectangle preview for small clouds
        svgContent = `<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${color}" stroke-width="${strokeWidth}" fill="transparent" stroke-dasharray="5,5"/>`;
      } else {
        const inverted = markup.inverted || false;
        
        // Use normalized coordinates to calculate arc count (zoom-independent)
        const refSize = 800;
        const normW = Math.abs(markup.endX - markup.startX) * refSize;
        const normH = Math.abs(markup.endY - markup.startY) * refSize;
        const targetArcDiameter = markup.arcSize || 15;
        
        // Calculate total arcs based on perimeter for uniform distribution
        const normPerimeter = 2 * (normW + normH);
        const totalArcs = Math.max(4, Math.round(normPerimeter / targetArcDiameter));
        
        // Uniform arc diameter based on actual screen perimeter
        const screenPerimeter = 2 * (w + h);
        const uniformArcDiameter = screenPerimeter / totalArcs;
        const arcRadius = uniformArcDiameter / 2;
        
        // Distribute arcs to each edge based on how many fit with uniform size
        const numArcsX = Math.max(1, Math.round(w / uniformArcDiameter));
        const numArcsY = Math.max(1, Math.round(h / uniformArcDiameter));
        
        // Calculate actual spacing (may differ slightly to fit edge exactly)
        const spacingX = w / numArcsX;
        const spacingY = h / numArcsY;
        
        const sweepOut = inverted ? 0 : 1;
        
        let cloudPath = `M ${x} ${y}`;
        // Top edge
        for (let i = 0; i < numArcsX; i++) {
          const endX = x + (i + 1) * spacingX;
          cloudPath += ` A ${arcRadius} ${arcRadius} 0 0 ${sweepOut} ${endX} ${y}`;
        }
        // Right edge
        for (let i = 0; i < numArcsY; i++) {
          const endY = y + (i + 1) * spacingY;
          cloudPath += ` A ${arcRadius} ${arcRadius} 0 0 ${sweepOut} ${x + w} ${endY}`;
        }
        // Bottom edge
        for (let i = numArcsX - 1; i >= 0; i--) {
          const endX = x + i * spacingX;
          cloudPath += ` A ${arcRadius} ${arcRadius} 0 0 ${sweepOut} ${endX} ${y + h}`;
        }
        // Left edge
        for (let i = numArcsY - 1; i >= 0; i--) {
          const endY = y + i * spacingY;
          cloudPath += ` A ${arcRadius} ${arcRadius} 0 0 ${sweepOut} ${x} ${endY}`;
        }
        cloudPath += ' Z';
        const fill = markup.fillColor === 'none' ? 'transparent' : (markup.fillColor || 'transparent');
        svgContent = `<path d="${cloudPath}" stroke="${color}" stroke-width="${strokeWidth}" fill="${fill}" opacity="${markup.opacity || 0.7}"/>`;
      }
    } else if (markup.type === 'arc') {
      // Arc (3-point) preview
      const x1 = markup.startX * pageWidth;
      const y1 = markup.startY * pageHeight;
      const x2 = markup.endX * pageWidth;
      const y2 = markup.endY * pageHeight;
      svgContent = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}" stroke-dasharray="5,5"/>`;
    } else if (markup.type === 'polyline' || markup.type === 'polylineArrow' || markup.type === 'polygon' || markup.type === 'cloudPolyline') {
      if (markup.points && markup.points.length >= 1) {
        const pathData = markup.points
          .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * pageWidth} ${p.y * pageHeight}`)
          .join(' ') + (markup.type === 'polygon' && markup.points.length > 2 ? ' Z' : '');
        const fill = markup.type === 'polygon' ? (markup.fillColor || 'transparent') : 'none';
        svgContent = `<path d="${pathData}" stroke="${color}" stroke-width="${strokeWidth}" fill="${fill}" opacity="${markup.opacity || 0.7}"/>`;
      }
    } else if (markup.type === 'placementPreview') {
      // Symbol/signature placement preview — show image in dashed rect
      const x = Math.min(markup.startX, markup.endX) * pageWidth;
      const y = Math.min(markup.startY, markup.endY) * pageHeight;
      const w = Math.abs(markup.endX - markup.startX) * pageWidth;
      const h = Math.abs(markup.endY - markup.startY) * pageHeight;
      const sym = markup.symbolData;
      const imgSrc = sym?.image || '';
      svgContent = `<rect data-drawing-preview="placement-rect" x="${x}" y="${y}" width="${w}" height="${h}" stroke="#3498db" stroke-width="2" fill="rgba(52,152,219,0.05)" stroke-dasharray="6,4" rx="2"/>`;
      if (imgSrc) {
        svgContent += `<image data-drawing-preview="placement-img" href="${imgSrc}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" opacity="0.7"/>`;
      }
    }
    
    overlay.innerHTML = svgContent;
  }, [allPageDimensions, canvasSize, scale]);

  // Create a sticky note
  const createStickyNote = useCallback((x, y) => {
    setNoteDialogPosition({ x, y });
    setNoteText('');
    setEditingNoteId(null);
    setShowNoteDialog(true);
  }, []);

  // Save sticky note
  const saveStickyNote = useCallback(() => {
    if (!noteText.trim()) {
      setShowNoteDialog(false);
      return;
    }
    
    const normalizedX = noteDialogPosition.x / canvasSize.width;
    const normalizedY = noteDialogPosition.y / canvasSize.height;
    
    if (editingNoteId) {
      // Update existing note
      updateMarkupProperties(editingNoteId, { 
        text: noteText,
        modifiedDate: new Date().toISOString()
      });
    } else {
      // Create new note
      const newNote = {
        id: `note_${Date.now()}`,
        type: 'note',
        x: normalizedX,
        y: normalizedY,
        text: noteText,
        color: markupColor,
        page: currentPage - 1,
        filename: currentFileIdentifier,
        author: markupAuthor,
        createdDate: new Date().toISOString(),
        isExpanded: true
      };
      addMarkupWithHistory(newNote);
      setExpandedNotes(prev => new Set([...prev, newNote.id]));
    }
    
    setShowNoteDialog(false);
    setNoteText('');
    setEditingNoteId(null);
  }, [noteText, noteDialogPosition, canvasSize, editingNoteId, markupColor, currentPage, currentFile, markupAuthor, updateMarkupProperties, addMarkupWithHistory]);

  // Toggle note expansion
  const toggleNoteExpanded = useCallback((noteId) => {
    setExpandedNotes(prev => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  }, []);

  // Get filtered markups for list
  const getFilteredMarkups = useCallback(() => {
    let filtered = markups.filter(m => m.filename === currentFileIdentifier);
    
    if (markupListFilter === 'current') {
      filtered = filtered.filter(m => m.page === currentPage - 1);
    } else if (markupListFilter === 'type' && markupListTypeFilter) {
      filtered = filtered.filter(m => m.type === markupListTypeFilter);
    }
    
    return filtered;
  }, [markups, currentFile, currentPage, markupListFilter, markupListTypeFilter]);

  // Keyboard shortcuts for selected markup
  useEffect(() => {
    const handleMarkupKeyDown = (e) => {
      // Don't handle shortcuts if typing in an input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        // Allow Escape to blur input and exit tools/deselect
        if (e.key === 'Escape') {
          e.target.blur(); // Blur the input first
          if (editingTextMarkupId) {
            cancelTextEdit();
          } else if (selectedMarkup) {
            setSelectedMarkup(null);
          } else if (markupMode) {
            setMarkupMode(null);
          }
        }
        return;
      }
      
      // Ctrl+S / Cmd+S — save document in place
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S') && !e.shiftKey) {
        e.preventDefault();
        saveMarkupsToPdf(false, true);
        return;
      }

      // Undo/Redo shortcuts work even without selection
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoMarkup();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redoMarkup();
        return;
      }
      
      // Copy selected markups (Ctrl+C / Cmd+C) — skip if editing text inline
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && !e.shiftKey && !editingTextMarkupId) {
        const toCopy = selectedMarkups.length > 0 ? selectedMarkups : (selectedMarkup ? [selectedMarkup] : []);
        if (toCopy.length > 0) {
          e.preventDefault();
          copyMarkups(toCopy);
          return;
        }
      }
      
      // Paste markups (Ctrl+V / Cmd+V) — skip if editing text inline
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V') && !e.shiftKey && !editingTextMarkupId) {
        if (clipboardRef.current && clipboardRef.current.length > 0) {
          e.preventDefault();
          const currentPageNum = currentPage - 1;
          const fileId = currentFile?.backendFilename || currentFile?.id || null;
          pasteMarkups(currentPageNum, fileId);
          return;
        }
      }
      
      // Duplicate in place (Ctrl+D / Cmd+D) — skip if editing text inline
      if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D') && !editingTextMarkupId) {
        const toDup = selectedMarkups.length > 0 ? selectedMarkups : (selectedMarkup ? [selectedMarkup] : []);
        if (toDup.length > 0) {
          e.preventDefault();
          copyMarkups(toDup);
          const currentPageNum = currentPage - 1;
          const fileId = currentFile?.backendFilename || currentFile?.id || null;
          pasteMarkups(currentPageNum, fileId);
          return;
        }
      }
      
      // If editing text inline, don't handle other shortcuts
      if (editingTextMarkupId) {
        if (e.key === 'Escape') {
          cancelTextEdit();
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          saveTextEdit(false);
        }
        return;
      }
      
      // T for text tool always available
      if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const newMode = markupMode === 'text' ? null : 'text';
        setMarkupMode(newMode);
        if (newMode) {
          setPanMode(false);
          setZoomMode(false);
        }
        setSelectedMarkup(null);
        return;
      }
      
      // V for select tool - activates select mode, clears markup mode
      if ((e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setMarkupMode(null);
        setSelectMode(true);
        setPanMode(false);
        setZoomMode(false);
        return;
      }
      
      // Ctrl+A to select all markups on current page (when in select mode)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        if (selectMode || markupMode === 'select') {
          e.preventDefault();
          const currentPageNum = currentPage - 1;
          const pageMarkups = markups.filter(m => 
            m.page === currentPageNum && 
            m.file === currentFile?.backendFilename
          );
          if (pageMarkups.length > 0) {
            setSelectedMarkups(pageMarkups);
            selectedMarkupsRef.current = pageMarkups;
            setSelectedMarkup(null);
            selectedMarkupRef.current = null;
          }
          return;
        }
      }
      
      // A for arrow tool always available (only when not Ctrl/Cmd)
      if ((e.key === 'a' || e.key === 'A') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const newMode = markupMode === 'arrow' ? null : 'arrow';
        setMarkupMode(newMode);
        if (newMode) {
          setPanMode(false);
          setZoomMode(false);
        }
        setSelectedMarkup(null);
        setSelectedMarkups([]);
        selectedMarkupsRef.current = [];
        return;
      }
      
      // R for rectangle tool always available
      if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const newMode = markupMode === 'rectangle' ? null : 'rectangle';
        setMarkupMode(newMode);
        if (newMode) {
          setPanMode(false);
          setZoomMode(false);
        }
        setSelectedMarkup(null);
        setSelectedMarkups([]);
        selectedMarkupsRef.current = [];
        return;
      }
      
      // C for circle tool always available
      if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const newMode = markupMode === 'circle' ? null : 'circle';
        setMarkupMode(newMode);
        if (newMode) {
          setPanMode(false);
          setZoomMode(false);
        }
        setSelectedMarkup(null);
        setSelectedMarkups([]);
        selectedMarkupsRef.current = [];
        return;
      }
      
      // L for line tool always available
      if ((e.key === 'l' || e.key === 'L') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const newMode = markupMode === 'line' ? null : 'line';
        setMarkupMode(newMode);
        if (newMode) {
          setPanMode(false);
          setZoomMode(false);
        }
        setSelectedMarkup(null);
        setSelectedMarkups([]);
        selectedMarkupsRef.current = [];
        return;
      }
      
      // Escape to deselect or exit tool
      if (e.key === 'Escape') {
        if (selectedMarkups.length > 0) {
          setSelectedMarkups([]);
          selectedMarkupsRef.current = [];
        } else if (selectedMarkup) {
          setSelectedMarkup(null);
        } else if (markupMode) {
          setMarkupMode(null);
        }
        return;
      }
      
      // Arrow key nudging for selected markups
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const toNudge = selectedMarkups.length > 0 ? selectedMarkups : (selectedMarkup ? [selectedMarkup] : []);
        if (toNudge.length > 0 && !toNudge.some(m => m.readOnly)) {
          e.preventDefault();
          // Zoom-aware nudge: 1 screen pixel per tap, Shift = 10px
          // In normalized coords: 1px = 1 / (scale * canvasWidth)
          const basePixels = e.shiftKey ? 10 : 1;
          const canvasW = canvasSize?.width || 800;
          const currentZoom = scaleRef?.current || scale || 1;
          const step = basePixels / (currentZoom * canvasW);
          let dx = 0, dy = 0;
          if (e.key === 'ArrowLeft')  dx = -step;
          if (e.key === 'ArrowRight') dx = step;
          if (e.key === 'ArrowUp')    dy = -step;
          if (e.key === 'ArrowDown')  dy = step;
          saveHistory();
          for (const m of toNudge) {
            moveMarkup(m.id, dx, dy);
          }
          // Helper to shift a markup object's position fields
          const shiftMarkup = (m) => {
            let updated;
            if (m.type === 'pen' || m.type === 'highlighter') {
              updated = { ...m, points: m.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
            } else if (m.startX !== undefined && m.endX !== undefined) {
              updated = {
                ...m,
                startX: m.startX + dx, startY: m.startY + dy,
                endX: m.endX + dx, endY: m.endY + dy,
                ...(m.points ? { points: m.points.map(p => ({ x: p.x + dx, y: p.y + dy })) } : {})
              };
            } else if (m.x !== undefined) {
              updated = { ...m, x: m.x + dx, y: m.y + dy };
            } else {
              updated = m;
            }
            return updated;
          };
          // Update selectedMarkup / selectedMarkups state so handles re-render
          if (selectedMarkups.length > 0) {
            setSelectedMarkups(prev => {
              const updated = prev.map(shiftMarkup);
              selectedMarkupsRef.current = updated;
              return updated;
            });
          } else if (selectedMarkup) {
            setSelectedMarkup(prev => {
              if (!prev) return null;
              const updated = shiftMarkup(prev);
              selectedMarkupRef.current = updated;
              return updated;
            });
          }
          return;
        }
      }
      
      // Delete key works for both single and multi-selection
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedMarkups.length > 0) {
          e.preventDefault();
          deleteMarkupFull(selectedMarkups);
          return;
        } else if (selectedMarkup) {
          e.preventDefault();
          deleteMarkupFull([selectedMarkup]);
          return;
        }
      }
      
      if (!selectedMarkup || (markupMode !== 'select' && !selectMode)) return;
      
      if (e.key === 'Enter' && (selectedMarkup.type === 'text' || selectedMarkup.type === 'callout')) {
        e.preventDefault();
        startTextEdit(selectedMarkup);
      }
    };
    
    window.addEventListener('keydown', handleMarkupKeyDown);
    return () => window.removeEventListener('keydown', handleMarkupKeyDown);
  }, [selectedMarkup, selectedMarkups, markupMode, selectMode, deleteMarkupFull, undoMarkup, redoMarkup, copyMarkups, pasteMarkups, editingTextMarkupId, cancelTextEdit, saveTextEdit, startTextEdit, showMarkupsPanel, currentPage, currentFile, markups, moveMarkup, saveHistory, saveMarkupsToPdf]);


  // Save/export logic is in useSaveMarkups hook (called above)


  // OCR Test - test OCR on a drawn region
  const handleOcrTest = async (bbox) => {
    if (!currentFile) {
      alert('No PDF selected');
      return;
    }

    setIsOcrTesting(true);
    setOcrTestResult(null);

    try {
      // Ensure file is on backend (uploads local files if needed)
      const backendFilename = await ensureFileOnBackend(currentFile);
      
      const response = await fetch(`${BACKEND_URL}/api/ocr/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfFilename: backendFilename,
          bbox: bbox,
          page: currentPage - 1,
          formatTemplate: ocrFormat || null,
        })
      });

      if (!response.ok) {
        throw new Error('OCR test failed');
      }

      const result = await response.json();
      setOcrTestResult(result);
    } catch (error) {
      console.error('OCR test error:', error);
      setOcrTestResult({ error: error.message });
    } finally {
      setIsOcrTesting(false);
    }
  };

  // Train model using backend
  const handleTrainModel = async () => {
    if (trainingBoxes.length === 0) {
      alert('Please draw at least one example');
      return;
    }

    if (!currentFile) {
      alert('No PDF selected');
      return;
    }

    setIsTraining(true);

    try {
      // Ensure file is on backend (uploads local files if needed)
      const backendFilename = await ensureFileOnBackend(currentFile);
      
      const result = await trainDetector(
        backendFilename,
        trainingBoxes,
        false,          // multiOrientation
        false,          // includeInverted
        'separate',     // trainingMode
        'Smart Link',   // modelType
        project?.id,    // projectId
        null,           // addToExistingModel
        currentFile?.sourceFolder || null  // sourceFolder
      );

      console.log('Training result:', result);
      
      setTrainingBoxes([]);
      setLinkMode(null);
      await loadModels();
      
      alert(`Training complete! Created ${result.totalModels} model(s)`);
    } catch (error) {
      console.error('Training error:', error);
      alert('Training failed: ' + error.message);
    } finally {
      setIsTraining(false);
    }
  };

  // Run detection using backend
  const handleFindLinks = async () => {
    if (selectedModels.length === 0) {
      alert('Please select at least one model');
      return;
    }

    setIsDetecting(true);
    
    // Debug: Log selected models and their settings
    console.log('=== Smart Links Detection Start ===');
    console.log('Selected model IDs:', selectedModels);
    selectedModels.forEach(modelId => {
      const model = savedModels.find(m => m.id === modelId);
      if (model) {
        console.log(`Model: ${model.className} (id=${model.id})`, {
          assignmentMode: model.assignmentMode,
          propertyName: model.propertyName,
          propertyTemplateId: model.propertyTemplateId
        });
      } else {
        console.log(`Model ${modelId} NOT FOUND in savedModels`);
      }
    });

    try {
      // Helper function to find folder containing file in nested structure
      const findFolderContainingFile = (folders, backendFilename, parent = null) => {
        for (const folder of folders) {
          if (folder.files?.some(f => f.backendFilename === backendFilename)) {
            return { folder, parent };
          }
          if (folder.subfolders?.length > 0) {
            const found = findFolderContainingFile(folder.subfolders, backendFilename, folder);
            if (found) return found;
          }
        }
        return null;
      };
      
      // Helper function to get all files from a folder and its subfolders
      const getAllFilesInFolder = (folder) => {
        let files = [...(folder.files || [])];
        if (folder.subfolders) {
          folder.subfolders.forEach(subfolder => {
            files = [...files, ...getAllFilesInFolder(subfolder)];
          });
        }
        return files;
      };
      
      // Helper function to get all files from all folders
      const getAllFilesInProject = (folders, rootFiles = []) => {
        let files = [...rootFiles]; // Include root-level files
        folders.forEach(folder => {
          files = [...files, ...getAllFilesInFolder(folder)];
        });
        return files;
      };
      
      let filesToProcess;
      
      if (detectionScope === 'current') {
        filesToProcess = [currentFile];
      } else if (detectionScope === 'folder') {
        const result = findFolderContainingFile(project?.folders || [], currentFile.backendFilename);
        filesToProcess = result?.folder?.files || [currentFile];
      } else if (detectionScope === 'parent') {
        const result = findFolderContainingFile(project?.folders || [], currentFile.backendFilename);
        if (result?.parent) {
          filesToProcess = getAllFilesInFolder(result.parent);
        } else if (result?.folder) {
          filesToProcess = getAllFilesInFolder(result.folder);
        } else {
          filesToProcess = [currentFile];
        }
      } else if (detectionScope === 'all') {
        filesToProcess = getAllFilesInProject(project?.folders || [], project?.files || []);
      } else {
        filesToProcess = [currentFile];
      }
      
      console.log(`Smart Links scope: ${detectionScope}, processing ${filesToProcess.length} file(s)`);

      let totalLinksFound = 0;
      const allNewHotspots = { ...(project.hotspots || {}) };
      const totalFiles = filesToProcess.length;

      for (let i = 0; i < filesToProcess.length; i++) {
        const file = filesToProcess[i];
        
        // Update progress
        setSmartLinksProgress({
          phase: 'detecting',
          currentFile: file.name?.replace('.pdf', '') || file.backendFilename?.replace('.pdf', ''),
          currentFileIndex: i + 1,
          totalFiles,
          percent: Math.round((i / totalFiles) * 80) // Detection is 0-80%
        });
        
        // Ensure file is on backend (uploads local files if needed)
        let backendFilename;
        try {
          backendFilename = await ensureFileOnBackend(file);
        } catch (uploadError) {
          console.warn(`Skipping file ${file.name}: ${uploadError.message}`);
          continue;
        }

        // Build per-class settings from smartLinksClassSettings
        const perClassSettings = {};
        Object.entries(smartLinksClassSettings).forEach(([modelId, settings]) => {
          perClassSettings[modelId] = {
            confidence: settings.confidence,
            enableOCR: settings.enableOCR,
            ocrFormat: settings.ocrFormat || null,
            subclassFormats: settings.subclassFormats || null,
            className: settings.className
          };
        });
        
        // Determine which pages to detect on
        // Only restrict to current page when scope is 'current' (single PDF) and page scope is 'current'
        const isCurrentFileOnly = detectionScope === 'current' && file.id === currentFile?.id;
        const pagesToDetect = isCurrentFileOnly && detectionPageScope === 'current' ? [currentPage] : null;

        const result = await runDetection(backendFilename, {
          confidence,  // fallback
          selectedModels,
          enableOCR,  // fallback
          ocrPadding: ocrPadding,
          perClassSettings,  // per-class settings
          pages: pagesToDetect, // Which pages to detect on (null = all pages)
          sourceFolder: file.sourceFolder || null,
        });

        console.log(`Detection result for ${file.name}:`, result);

        if (result.detections && result.detections.length > 0) {
          // Build a map of model settings for quick lookup
          const modelSettingsMap = {};
          selectedModels.forEach(modelId => {
            const model = savedModels.find(m => m.id === modelId);
            if (model) {
              modelSettingsMap[model.className] = model;
              modelSettingsMap[model.id] = model;
              console.log(`Model map entry: className="${model.className}", id="${model.id}", assignmentMode="${model.assignmentMode}", propertyName="${model.propertyName}"`);
            }
          });
          
          const newHotspots = [];
          
          result.detections.forEach((det, index) => {
            // Backend now returns formatted OCR text and confidence
            const ocrText = det.ocr_text || '';
            const ocrConfidence = det.ocr_confidence || 'low';
            
            // Find the model that created this detection
            // Backend may return class name in different fields
            console.log(`Detection fields: class_name="${det.class_name}", model_id="${det.model_id}", label="${det.label}"`);
            const detectionModel = modelSettingsMap[det.class_name] || modelSettingsMap[det.model_id] || modelSettingsMap[det.label];
            console.log(`Found model:`, detectionModel ? `${detectionModel.className} (assignmentMode=${detectionModel.assignmentMode}, propertyName=${detectionModel.propertyName})` : 'NOT FOUND');
            
            let targetFileId = null;
            let targetFilename = null;
            
            // Check if this model is set to match by document property
            if (detectionModel?.assignmentMode === 'property' && detectionModel.propertyName && ocrText) {
              // Property mode - search for file by extractedProperties value
              const propertyName = detectionModel.propertyName;
              console.log(`Property mode: Looking for "${ocrText}" in property "${propertyName}"`);
              console.log(`  Searching ${allFiles.length} files...`);
              
              // Debug: show what properties exist on files
              allFiles.forEach((f, idx) => {
                const propValue = f.extractedProperties?.[propertyName];
                if (propValue) {
                  console.log(`  File "${f.name}" has ${propertyName}="${propValue}"`);
                }
              });
              
              const matchingFile = allFiles.find(f => {
                const propValue = f.extractedProperties?.[propertyName];
                if (!propValue) return false;
                // Match if property value contains OCR text or vice versa
                const match = propValue.toLowerCase().includes(ocrText.toLowerCase()) || 
                       ocrText.toLowerCase().includes(propValue.toLowerCase());
                if (match) {
                  console.log(`  MATCH: "${ocrText}" matched "${propValue}" in ${f.name}`);
                }
                return match;
              });
              
              if (matchingFile) {
                targetFileId = matchingFile.id;
                targetFilename = matchingFile.name;
              } else {
                console.log(`  No match found for "${ocrText}"`);
              }
              
              newHotspots.push({
                id: `hotspot_${Date.now()}_${index}`,
                x: det.bbox.x,
                y: det.bbox.y,
                width: det.bbox.width,
                height: det.bbox.height,
                targetFileId,
                targetFilename,
                label: ocrText,
                confidence: det.confidence,
                ocrConfidence,
                formatScore: det.format_score || 0,
                sourceFilename: file.name,
                page: det.page || 0,
                assignmentMode: 'property',
                propertyName: detectionModel.propertyName,
              });
            } else {
              // Link mode - try to find matching file by filename
              if (ocrText && enableOCR) {
                const matchingFile = allFiles.find(f => 
                  f.name.includes(ocrText) || 
                  f.backendFilename?.includes(ocrText)
                );
                if (matchingFile) {
                  targetFileId = matchingFile.id;
                  targetFilename = matchingFile.name;
                }
              }

              newHotspots.push({
                id: `hotspot_${Date.now()}_${index}`,
                x: det.bbox.x,
                y: det.bbox.y,
                width: det.bbox.width,
                height: det.bbox.height,
                targetFileId,
                targetFilename,
                label: ocrText,
                confidence: det.confidence,
                ocrConfidence,
                formatScore: det.format_score || 0,
                sourceFilename: file.name,
                page: det.page || 0,
                assignmentMode: 'link',
              });
            }
          });

          allNewHotspots[file.id] = [
            ...(allNewHotspots[file.id] || []),
            ...newHotspots
          ];
          
          totalLinksFound += newHotspots.length;
        }
      }

      // Update progress for saving phase
      setSmartLinksProgress(prev => ({
        ...prev,
        phase: 'saving',
        currentFile: '',
        percent: 90
      }));

      // Save all hotspots
      const updatedProject = {
        ...project,
        hotspots: allNewHotspots
      };
      
      onProjectUpdate(updatedProject);
      
      // Update local state for current file
      if (currentFile) {
        setHotspots(allNewHotspots[currentFile.id] || []);
      }
      
      // Complete progress
      setSmartLinksProgress(prev => ({
        ...prev,
        phase: 'complete',
        percent: 100
      }));

      alert(`Detection complete! Found ${totalLinksFound} link${totalLinksFound !== 1 ? 's' : ''}.`);
    } catch (error) {
      console.error('Detection error:', error);
      alert('Detection failed: ' + error.message);
    } finally {
      setIsDetecting(false);
      // Reset progress after a short delay
      setTimeout(() => {
        setSmartLinksProgress({
          phase: '',
          currentFile: '',
          currentFileIndex: 0,
          totalFiles: 0,
          percent: 0
        });
      }, 500);
    }
  };

  const handleDeleteModel = async (modelId) => {
    if (confirm('Delete this model?')) {
      try {
        await deleteModel(modelId);
        await loadModels();
      } catch (error) {
        console.error('Error deleting model:', error);
        alert('Failed to delete model');
      }
    }
  };

  const handleHotspotClick = (hotspot) => {
    if (hotspot.targetFileId) {
      const targetFile = allFiles.find(f => f.id === hotspot.targetFileId);
      if (targetFile && onFileSelect) {
        onFileSelect(targetFile);
      }
    } else {
      setPendingHotspot(hotspot);
      setShowAssignDialog(true);
    }
  };

  const toggleModelSelection = (modelId) => {
    setSelectedModels(prev => 
      prev.includes(modelId)
        ? prev.filter(id => id !== modelId)
        : [...prev, modelId]
    );
  };

  // Parse OCR format template for display preview
  const parseOcrFormat = (template) => {
    if (!template || !template.trim()) {
      setOcrFormatParsed(null);
      return null;
    }

    const upperTemplate = template.toUpperCase().trim();
    let prefixPart = '';
    let numberPart = '';

    if (upperTemplate.includes('-')) {
      [prefixPart, numberPart] = upperTemplate.split('-', 2);
    } else {
      for (let i = 0; i < upperTemplate.length; i++) {
        if (/\d/.test(upperTemplate[i])) {
          prefixPart = upperTemplate.slice(0, i);
          numberPart = upperTemplate.slice(i);
          break;
        }
      }
    }

    const baseLetters = prefixPart.length;
    const baseDigits = (numberPart.match(/\d/g) || []).length;

    const minLetters = Math.max(1, baseLetters);
    const maxLetters = baseLetters + extraLetters;
    const minDigits = Math.max(1, baseDigits - extraDigits);
    const maxDigits = baseDigits + extraDigits;

    const parsed = {
      template: upperTemplate,
      baseLetters,
      baseDigits,
      minLetters,
      maxLetters,
      minDigits,
      maxDigits,
      trailingLetters,
    };

    setOcrFormatParsed(parsed);
    return parsed;
  };

  // Update format preview when parameters change
  useEffect(() => {
    if (ocrFormat) {
      parseOcrFormat(ocrFormat);
    }
  }, [ocrFormat, extraLetters, extraDigits, trailingLetters]);

  // Object Finder - Load models
  const loadObjectModels = async () => {
    try {
      const models = await getModels(project?.id);
      // Filter to exclude 'Smart Link' models - only show object models
      setObjectModels(models.filter(m => m.modelType !== 'Smart Link'));
    } catch (error) {
      console.error('Error loading object models:', error);
    }
  };

  useEffect(() => {
    if (showObjectFinder) {
      loadObjectModels();
    }
  }, [showObjectFinder]);

  // Object Finder - Train model
  const handleObjectTrain = async () => {
    if (objectTrainingBoxes.length === 0) {
      alert('Please draw at least one example');
      return;
    }

    if (!currentFile) {
      alert('No PDF selected');
      return;
    }

    setIsObjectTraining(true);

    try {
      // Ensure file is on backend (uploads local files if needed)
      const backendFilename = await ensureFileOnBackend(currentFile);
      
      // Sanitize class names for filenames but keep subclass metadata
      // Use custom title if provided, otherwise use class name
      const modelTitle = trainingModelTitle.trim() || objectTrainingBoxes[0]?.className || 'Untitled';
      
      const sanitizedBoxes = objectTrainingBoxes.map(box => {
        const originalClass = box.parentClass || box.className;
        return {
          ...box,
          // In combined mode, use model title; in separate mode, keep original class names
          className: objectModelMode === 'combined' 
            ? modelTitle.replace(/[<>:"/\\|?*]/g, '-')
            : originalClass.replace(/[<>:"/\\|?*]/g, '-'),
          label: box.label?.replace(/ > /g, ' - ')?.replace(/[<>:"/\\|?*]/g, '-') || box.label,
          originalClassName: originalClass, // Keep original parent class
          // Preserve shape type for rendering
          shapeType: box.shapeType || 'rectangle',
          polylinePoints: box.polylinePoints || null,
          // Preserve subclass metadata - subclassRegions is the new format (multiple regions)
          hasSubclasses: box.hasSubclasses,
          availableSubclasses: box.availableSubclasses,
          subclassRegions: box.subclassRegions, // Map of subclass name -> region
          fullClassPath: box.fullClassPath
        };
      });
      
      console.log('Training with addToExistingModel:', addToExistingModel);
      
      const result = await trainDetector(
        backendFilename,
        sanitizedBoxes,
        false,                      // multiOrientation
        false,                      // includeInverted
        objectModelMode,            // trainingMode - 'separate' or 'combined'
        'object',                   // modelType
        project?.id,                // projectId
        addToExistingModel || null, // addToExistingModel
        currentFile?.sourceFolder || null  // sourceFolder
      );

      console.log('Object training result:', result);
      
      setObjectTrainingBoxes([]);
      setObjectFinderMode(null);
      setTrainingModelTitle('');
      setAddToExistingModel(null);
      await loadObjectModels();
      
      // Show what was trained including subclass regions
      const regionsInfo = sanitizedBoxes.filter(b => b.subclassRegions && Object.keys(b.subclassRegions).length > 0);
      const uniqueClasses = [...new Set(sanitizedBoxes.map(b => b.className))];
      
      if (addToExistingModel) {
        const existingModel = objectModels.find(m => m.id === addToExistingModel);
        alert(`Added ${objectTrainingBoxes.length} template(s) to model "${existingModel?.className || modelTitle}"`);
      } else if (objectModelMode === 'separate' && uniqueClasses.length > 1) {
        let message = `Training complete! Created ${uniqueClasses.length} model(s):\n${uniqueClasses.join('\n')}`;
        if (regionsInfo.length > 0) {
          const subclassNames = [...new Set(regionsInfo.flatMap(b => Object.keys(b.subclassRegions || {})))];
          message += `\n\nSubclass regions: ${subclassNames.join(', ')}`;
        }
        alert(message);
      } else if (regionsInfo.length > 0) {
        const subclassNames = [...new Set(regionsInfo.flatMap(b => Object.keys(b.subclassRegions || {})))];
        alert(`Training complete! Model "${modelTitle}" created.\n\nSubclass regions marked: ${subclassNames.join(', ')}\nThese will be OCR'd during detection.`);
      } else {
        alert(`Training complete! Model "${modelTitle}" created.`);
      }
    } catch (error) {
      console.error('Object training error:', error);
      alert('Training failed: ' + error.message);
    } finally {
      setIsObjectTraining(false);
    }
  };

  // Object Finder - Toggle model selection
  const toggleObjectModelSelection = (modelId) => {
    setSelectedObjectModels(prev => 
      prev.includes(modelId) 
        ? prev.filter(id => id !== modelId)
        : [...prev, modelId]
    );
  };

  // Object Finder - Start panel section resize
  const startObjectsPanelResize = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = objectsPanelModelsHeight;
    
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    
    const handleMouseMove = (moveEvent) => {
      const dy = moveEvent.clientY - startY;
      const newHeight = Math.max(100, Math.min(500, startHeight + dy));
      setObjectsPanelModelsHeight(newHeight);
    };
    
    const handleMouseUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Links panel - Start panel section resize
  const startLinksPanelResize = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = linksPanelModelsHeight;
    
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    
    const handleMouseMove = (moveEvent) => {
      const dy = moveEvent.clientY - startY;
      const newHeight = Math.max(100, Math.min(500, startHeight + dy));
      setLinksPanelModelsHeight(newHeight);
    };
    
    const handleMouseUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Object Finder - Delete model
  const handleDeleteObjectModel = async (modelId) => {
    if (!confirm('Delete this model?')) return;
    
    try {
      await deleteModel(modelId);
      await loadObjectModels();
      setSelectedObjectModels(prev => prev.filter(id => id !== modelId));
    } catch (error) {
      console.error('Error deleting model:', error);
      alert('Failed to delete model');
    }
  };

  // Object Finder - Run detection
  const handleFindObjects = async () => {
    console.log('Selected object models:', selectedObjectModels);
    
    if (selectedObjectModels.length === 0) {
      alert('Please select at least one model');
      return;
    }

    if (!currentFile) {
      alert('No PDF selected');
      return;
    }

    setIsObjectDetecting(true);

    try {
      // For local files, we need to ensure they're uploaded first
      // and track the backend filename
      let currentBackendFilename;
      try {
        currentBackendFilename = await ensureFileOnBackend(currentFile);
      } catch (uploadError) {
        alert(`Failed to process file: ${uploadError.message}`);
        setIsObjectDetecting(false);
        return;
      }
      
      let filesToProcess;
      
      // Helper function to find folder containing file in nested structure
      const findFolderContainingFile = (folders, backendFilename, parent = null) => {
        for (const folder of folders) {
          if (folder.files?.some(f => f.backendFilename === backendFilename)) {
            return { folder, parent };
          }
          if (folder.subfolders?.length > 0) {
            const found = findFolderContainingFile(folder.subfolders, backendFilename, folder);
            if (found) return found;
          }
        }
        return null;
      };
      
      // Helper function to get all files from a folder and its subfolders
      const getAllFilesInFolder = (folder) => {
        let files = [...(folder.files || [])];
        if (folder.subfolders) {
          folder.subfolders.forEach(subfolder => {
            files = [...files, ...getAllFilesInFolder(subfolder)];
          });
        }
        return files;
      };
      
      // Helper function to get all files from all folders
      const getAllFilesInProject = (folders, rootFiles = []) => {
        let files = [...rootFiles]; // Include root-level files
        folders.forEach(folder => {
          files = [...files, ...getAllFilesInFolder(folder)];
        });
        return files;
      };
      
      // For local files, only support 'current' scope
      if (currentFile.isLocal) {
        filesToProcess = [{ backendFilename: currentBackendFilename, sourceFolder: null }];
        if (objectDetectionScope !== 'current') {
          console.log('Local file: forcing scope to current');
        }
      } else if (objectDetectionScope === 'current') {
        // Just current PDF
        filesToProcess = [{ backendFilename: currentBackendFilename, sourceFolder: currentFile.sourceFolder || null }];
      } else if (objectDetectionScope === 'folder') {
        // Current folder only (no subfolders)
        const result = findFolderContainingFile(project?.folders || [], currentBackendFilename);
        if (result?.folder) {
          filesToProcess = result.folder.files.map(f => ({ backendFilename: f.backendFilename, sourceFolder: f.sourceFolder || null }));
        } else {
          // File might be at root level - just use current file
          filesToProcess = [{ backendFilename: currentBackendFilename, sourceFolder: currentFile.sourceFolder || null }];
        }
      } else if (objectDetectionScope === 'parent') {
        // Parent folder including all subfolders
        const result = findFolderContainingFile(project?.folders || [], currentBackendFilename);
        if (result?.parent) {
          // Use parent folder and get all files including subfolders
          const allFiles = getAllFilesInFolder(result.parent);
          filesToProcess = allFiles.map(f => ({ backendFilename: f.backendFilename, sourceFolder: f.sourceFolder || null }));
        } else if (result?.folder) {
          // No parent (top-level folder), use current folder with subfolders
          const allFiles = getAllFilesInFolder(result.folder);
          filesToProcess = allFiles.map(f => ({ backendFilename: f.backendFilename, sourceFolder: f.sourceFolder || null }));
        } else {
          // File might be at root level - just use current file
          filesToProcess = [{ backendFilename: currentBackendFilename, sourceFolder: currentFile.sourceFolder || null }];
        }
      } else if (objectDetectionScope === 'all') {
        // All PDFs in entire project (including root-level files)
        const allFiles = getAllFilesInProject(project?.folders || [], project?.files || []);
        filesToProcess = allFiles.map(f => ({ backendFilename: f.backendFilename, sourceFolder: f.sourceFolder || null }));
      } else {
        filesToProcess = [{ backendFilename: currentBackendFilename, sourceFolder: currentFile.sourceFolder || null }];
      }
      
      console.log(`Detection scope: ${objectDetectionScope}, processing ${filesToProcess.length} file(s)`);

      let newDetections = [];
      const totalFiles = filesToProcess.length;

      for (let i = 0; i < filesToProcess.length; i++) {
        const { backendFilename: filename, sourceFolder: fileSourceFolder } = filesToProcess[i];
        
        // Update progress
        setDetectionProgress({
          phase: 'detecting',
          currentFile: filename.replace('.pdf', ''),
          currentFileIndex: i + 1,
          totalFiles,
          percent: Math.round((i / totalFiles) * 70) // Detection is 0-70%
        });
        
        // Build per-class settings from classDetectionSettings
        const perClassSettings = {};
        Object.entries(classDetectionSettings).forEach(([modelId, settings]) => {
          perClassSettings[modelId] = {
            confidence: settings.confidence,
            enableOCR: settings.enableOCR,
            ocrFormat: settings.ocrFormat || null,
            subclassFormats: settings.subclassFormats || null,  // Per-subclass OCR formats
            className: settings.className  // Include className for matching
          };
        });
        
        console.log('Running detection with:', {
          filename,
          models: selectedObjectModels,
          perClassSettings
        });
        
        // Determine which pages to detect on
        // Only restrict to current page when scope is 'current' (single PDF) and page scope is 'current'
        const isCurrentFileOnly = objectDetectionScope === 'current' && filename === currentBackendFilename;
        const pagesToDetect = isCurrentFileOnly && objectDetectionPageScope === 'current' ? [currentPage] : null;
        
        if (pagesToDetect) {
          console.log(`Detecting on page ${currentPage} only`);
        } else {
          console.log('Detecting on all pages');
        }
        
        const result = await runDetection(filename, {
          confidence: objectConfidence, // fallback
          selectedModels: selectedObjectModels,
          enableOCR: objectEnableOCR, // fallback
          ocrPadding: objectOcrPadding,
          perClassSettings, // per-class confidence, OCR, and format settings
          projectId, // For incremental saves
          pages: pagesToDetect, // Which pages to detect on (null = all pages)
          sourceFolder: fileSourceFolder,
        });

        if (result.detections) {
          const detectionsWithFile = result.detections.map((d, idx) => {
            // Look up shapeType from multiple sources
            let shapeType = d.shapeType || 'rectangle';
            if (!d.shapeType) {
              // Try to find the model by className to get its shapeType
              const model = objectModels.find(m => m.className === d.label);
              if (model?.shapeType) {
                shapeType = model.shapeType;
              } else if (result.shapeTypes && result.shapeTypes[d.label]) {
                // Fall back to result.shapeTypes if available
                shapeType = result.shapeTypes[d.label];
              } else {
                // Fall back to getClassShapeType which checks project.classes
                shapeType = getClassShapeType(d.label);
              }
            }
            
            return {
              ...d,
              id: `det_${filename}_${Date.now()}_${idx}`,
              filename: filename,
              shapeType
            };
          });
          newDetections = [...newDetections, ...detectionsWithFile];
        }
      }

      // ========== OCR-to-Objects: Run OCR per page and match patterns ==========
      if (ocrToObjectsEnabled) {
        // Flatten class-based patterns into pattern rows for matching
        const validPatterns = [];
        ocrToObjectsClasses.forEach(cls => {
          if (!cls.className.trim()) return;
          cls.patterns.forEach(p => {
            if (p.trim()) {
              validPatterns.push({ pattern: p.trim(), matchType: 'pattern', className: cls.className.trim(), useExisting: cls.useExisting });
            }
          });
        });
        
        if (validPatterns.length > 0) {
          console.log(`OCR-to-Objects: ${validPatterns.length} pattern(s) to match`);
          
          for (let i = 0; i < filesToProcess.length; i++) {
            const filename = filesToProcess[i];
            
            setDetectionProgress({
              phase: 'ocr-scan',
              currentFile: filename.replace('.pdf', ''),
              currentFileIndex: i + 1,
              totalFiles,
              percent: Math.round(70 + (i / totalFiles) * 25) // OCR is 70-95%
            });
            
            // Check what OCR results already exist for this file
            let fileOcrResults = ocrResultsByFile[filename] || [];
            const existingPages = new Set(fileOcrResults.map(r => r.page));
            
            // Determine which pages need OCR
            // If we ran detection on specific pages, only OCR those
            const isCurrentFileOnly = objectDetectionScope === 'current' && filename === filesToProcess[0];
            const pagesToOcr = isCurrentFileOnly && objectDetectionPageScope === 'current' ? [currentPage] : null;
            
            // Get pages that have detections on them (to know max page)
            const detectionPages = new Set(
              newDetections.filter(d => d.filename === filename).map(d => d.page)
            );
            
            // Build list of pages to OCR
            let pagesNeedingOcr = [];
            if (pagesToOcr) {
              // Specific pages requested
              pagesNeedingOcr = pagesToOcr.filter(p => !existingPages.has(p));
            } else {
              // All pages - we need to figure out how many pages this PDF has
              // Use detection pages + existing OCR pages as a hint, or try up to numPages
              const maxPage = Math.max(
                ...[...detectionPages, ...existingPages, 1],
                filename === filesToProcess[0] ? (numPages || 1) : 1
              );
              for (let p = 1; p <= maxPage; p++) {
                if (!existingPages.has(p)) {
                  pagesNeedingOcr.push(p);
                }
              }
            }
            
            // Run OCR on pages that don't have results yet
            if (pagesNeedingOcr.length > 0) {
              console.log(`OCR-to-Objects: Running OCR on ${pagesNeedingOcr.length} new pages for ${filename}`);
              
              const BATCH_SIZE = 5;
              for (let batchStart = 0; batchStart < pagesNeedingOcr.length; batchStart += BATCH_SIZE) {
                const batch = pagesNeedingOcr.slice(batchStart, batchStart + BATCH_SIZE);
                
                setDetectionProgress({
                  phase: 'ocr-scan',
                  currentFile: filename.replace('.pdf', ''),
                  currentFileIndex: i + 1,
                  totalFiles,
                  percent: Math.round(70 + ((i + batchStart / pagesNeedingOcr.length) / totalFiles) * 25),
                  detail: `OCR pages ${batch[0]}-${batch[batch.length - 1]}`
                });
                
                try {
                  // Try batch endpoint
                  const batchResponse = await fetch(`${BACKEND_URL}/api/ocr/fullpage/batch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pdfFilename: filename, pages: batch, dpi: 150, sourceFolder: fileSourceFolder })
                  });
                  
                  if (batchResponse.ok) {
                    const batchData = await batchResponse.json();
                    if (batchData.batch_results) {
                      for (const [pageKey, pageResult] of Object.entries(batchData.batch_results)) {
                        if (pageResult.results && pageResult.results.length > 0) {
                          fileOcrResults = [...fileOcrResults, ...pageResult.results];
                        }
                      }
                    }
                  } else {
                    // Fallback to page-by-page
                    for (const pageNum of batch) {
                      try {
                        const result = await runFullPageOcr(filename, pageNum, 150, fileSourceFolder);
                        if (result.results && result.results.length > 0) {
                          fileOcrResults = [...fileOcrResults, ...result.results];
                        }
                      } catch (e) {
                        const msg = e.message || '';
                        if (msg.includes('Could not convert') || msg.includes('not found')) break;
                      }
                    }
                  }
                } catch (e) {
                  console.warn(`OCR batch error for ${filename}:`, e);
                }
              }
              
              // Save OCR results back so they're cached for future runs
              setOcrResultsByFile(prev => ({
                ...prev,
                [filename]: fileOcrResults
              }));
            } else {
              console.log(`OCR-to-Objects: Using cached OCR for ${filename} (${fileOcrResults.length} items)`);
            }
            
            // Now match OCR results against patterns and create objects
            const timestamp = Date.now();
            let ocrObjectCount = 0;
            
            for (const ocrItem of fileOcrResults) {
              const ocrText = ocrItem.text;
              const ocrPage = ocrItem.page ? ocrItem.page - 1 : 0; // Convert to 0-indexed
              
              for (const patternRow of validPatterns) {
                if (ocrMatchText(ocrText, patternRow.pattern, patternRow.matchType)) {
                  // Extract the matched portion
                  const extractedText = ocrExtractMatch(ocrText, patternRow.pattern, patternRow.matchType);
                  
                  // Check if an object already exists at this location (from detection or previous OCR)
                  const ocrBbox = ocrItem.bbox;
                  const alreadyExists = newDetections.some(det => {
                    if (det.filename !== filename) return false;
                    if (det.page !== ocrPage) return false;
                    // Check center distance - if centers are very close, it's a duplicate
                    const detCx = det.bbox.x + det.bbox.width / 2;
                    const detCy = det.bbox.y + det.bbox.height / 2;
                    const ocrCx = ocrBbox.x + ocrBbox.width / 2;
                    const ocrCy = ocrBbox.y + ocrBbox.height / 2;
                    const dist = Math.sqrt((detCx - ocrCx) ** 2 + (detCy - ocrCy) ** 2);
                    return dist < 0.03; // Within 3% of page dimensions
                  });
                  
                  if (!alreadyExists) {
                    newDetections.push({
                      id: `ocr_obj_${filename}_${timestamp}_${ocrObjectCount}`,
                      label: patternRow.className,
                      className: patternRow.className,
                      ocr_text: extractedText,
                      bbox: ocrBbox,
                      page: ocrPage,
                      filename: filename,
                      confidence: ocrItem.confidence,
                      orientation: ocrItem.orientation || 'horizontal',
                      source: 'ocr-pattern',
                      shapeType: 'rectangle'
                    });
                    ocrObjectCount++;
                  }
                  break; // First matching pattern wins, don't double-assign
                }
              }
            }
            
            console.log(`OCR-to-Objects: Created ${ocrObjectCount} objects from OCR patterns for ${filename}`);
          }
          
          // Create any new classes from OCR patterns
          if (project) {
            const existingClassNames = new Set((project.classes || []).map(c => c.name));
            const newClassNames = [...new Set(
              ocrToObjectsClasses
                .filter(cls => !cls.useExisting && cls.className.trim())
                .map(cls => cls.className.trim())
            )].filter(name => !existingClassNames.has(name));
            
            if (newClassNames.length > 0) {
              const newClasses = newClassNames.map(name => ({
                id: `class_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name,
                color: `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`
              }));
              const updatedProject = {
                ...project,
                classes: [...(project.classes || []), ...newClasses]
              };
              onProjectUpdate(updatedProject);
            }
          }
        }
      }
      // ========== End OCR-to-Objects ==========

      // Helper function to calculate overlap percentage (IoU - Intersection over Union)
      const calculateOverlap = (box1, box2) => {
        const x1 = Math.max(box1.x, box2.x);
        const y1 = Math.max(box1.y, box2.y);
        const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
        const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);
        
        if (x2 <= x1 || y2 <= y1) return 0; // No overlap
        
        const intersectionArea = (x2 - x1) * (y2 - y1);
        const box1Area = box1.width * box1.height;
        const box2Area = box2.width * box2.height;
        const minArea = Math.min(box1Area, box2Area);
        
        return intersectionArea / minArea; // Overlap relative to smaller box
      };

      // Merge with existing objects
      setDetectedObjects(prev => {
        // Keep objects from files we didn't process
        const existingFromOtherFiles = prev.filter(obj => !filesToProcess.includes(obj.filename));
        
        // Keep ALL existing objects from processed files
        const existingFromProcessedFiles = prev.filter(obj => filesToProcess.includes(obj.filename));
        
        // Filter new detections to avoid duplicates (>80% overlap with existing)
        const filteredNewDetections = newDetections.filter(newObj => {
          for (const existingObj of existingFromProcessedFiles) {
            // Only compare objects on same file and page
            if (existingObj.filename === newObj.filename && existingObj.page === newObj.page) {
              const overlap = calculateOverlap(existingObj.bbox, newObj.bbox);
              if (overlap > 0.8) {
                console.log(`Skipping duplicate detection (${(overlap * 100).toFixed(0)}% overlap)`);
                return false; // Skip this detection
              }
            }
          }
          return true; // Keep this detection
        });
        
        console.log(`Filtered ${newDetections.length - filteredNewDetections.length} duplicate detections`);
        
        // Combine: other files + existing from processed files + new filtered detections
        return [...existingFromOtherFiles, ...existingFromProcessedFiles, ...filteredNewDetections];
      });
      
      console.log(`Found ${newDetections.length} new objects`);
      
      // Extract subclass field values if we have subclass regions defined
      if (newDetections.length > 0) {
        // Update progress for extraction phase
        setDetectionProgress(prev => ({
          ...prev,
          phase: 'extracting',
          currentFile: '',
          percent: 80
        }));
        
        const detectionsWithSubclassInfo = await extractSubclassValues(newDetections);
        // Update detected objects with subclass field info
        setDetectedObjects(prev => {
          return prev.map(obj => {
            const enhanced = detectionsWithSubclassInfo.find(d => d.id === obj.id);
            if (enhanced && enhanced.subclassFields) {
              return { 
                ...obj, 
                subclassFields: enhanced.subclassFields,
                hasSubclassRegions: true
              };
            }
            return obj;
          });
        });
      }
      
      // Update progress for saving phase
      setDetectionProgress(prev => ({
        ...prev,
        phase: 'saving',
        percent: 95
      }));
      
    } catch (error) {
      console.error('Object detection error:', error);
      alert('Detection failed: ' + error.message);
    } finally {
      setIsObjectDetecting(false);
      // Show complete briefly then reset progress
      setDetectionProgress(prev => ({
        ...prev,
        phase: 'complete',
        percent: 100
      }));
      setTimeout(() => {
        setDetectionProgress({
          phase: '',
          currentFile: '',
          currentFileIndex: 0,
          totalFiles: 0,
          percent: 0
        });
      }, 500);
    }
  };
  
  // Extract OCR values for subclass fields based on marked regions
  // This looks at the training data to find subclass regions, then OCRs those regions
  const extractSubclassValues = async (detections) => {
    // Find training boxes that have subclassRegions defined
    const trainingWithRegions = objectTrainingBoxes.filter(box => 
      box.subclassRegions && Object.keys(box.subclassRegions).length > 0
    );
    
    // Also check models for stored region info
    const modelRegions = {};
    for (const model of objectModels) {
      if (model.subclassRegions) {
        modelRegions[model.className] = model.subclassRegions;
      }
    }
    
    const results = [];
    
    for (const detection of detections) {
      // Find if we have subclass regions for this class
      const regions = modelRegions[detection.label] || 
                      trainingWithRegions.find(t => t.className === detection.label)?.subclassRegions;
      
      if (!regions || Object.keys(regions).length === 0) {
        results.push(detection);
        continue;
      }
      
      // We have regions - add subclass fields (values will be filled by backend OCR)
      const subclassFields = {};
      for (const [subclassName, region] of Object.entries(regions)) {
        // Store the region so backend can OCR it
        subclassFields[subclassName] = {
          region: region,
          value: '' // Will be filled by OCR
        };
      }
      
      results.push({
        ...detection,
        subclassFields: subclassFields,
        hasSubclassRegions: true
      });
    }
    
    return results;
  };

  // Navigate to object with smooth scroll/zoom
  // Track active highlight timeout to prevent multiple highlights
  const highlightTimeoutRef = useRef(null);
  
  const navigateToObject = (obj, targetZoom = 1.0) => {
    const isSameFile = obj.filename === currentFile?.backendFilename;
    const isSamePage = obj.page === currentPage - 1;
    const targetPage = (obj.page !== undefined) ? obj.page + 1 : 1;
    
    // Clear any existing highlight timeout
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = null;
    }
    
    // Function to scroll to object position — handles both single and continuous view
    const scrollToObject = (zoomLevel) => {
      if (!containerRef.current || !obj.bbox) return;
      
      const container = containerRef.current;
      const currentScale = zoomLevel || scale;
      
      if (isContinuousView(viewMode)) {
        // Continuous view: use layout positions to find page offset
        const layout = continuousLayoutRef.current;
        const pagePos = layout.positions?.[targetPage];
        if (!pagePos) return;
        
        // Object center within the page (normalized bbox → scaled page coords)
        const objLocalX = (obj.bbox.x + obj.bbox.width / 2) * pagePos.width;
        const objLocalY = (obj.bbox.y + obj.bbox.height / 2) * pagePos.height;
        
        let objAbsX, objAbsY;
        
        if (layout.isHorizontal) {
          // Horizontal: pages laid out left-to-right, centered vertically
          objAbsX = pagePos.left + objLocalX;
          // Pages centered via calc(50% - pageHeight/2)
          const wrapperHeight = container.scrollHeight;
          const pageTopInWrapper = (wrapperHeight - pagePos.height) / 2;
          objAbsY = pageTopInWrapper + objLocalY;
        } else {
          // Vertical: pages laid out top-to-bottom, centered horizontally
          objAbsY = pagePos.top + objLocalY;
          // Pages centered via calc(50% - pageWidth/2)
          const wrapperWidth = container.scrollWidth;
          const pageLeftInWrapper = (wrapperWidth - pagePos.width) / 2;
          objAbsX = pageLeftInWrapper + objLocalX;
        }
        
        container.scrollTo({
          left: Math.max(0, objAbsX - container.clientWidth / 2),
          top: Math.max(0, objAbsY - container.clientHeight / 2),
          behavior: 'smooth'
        });
      } else {
        // Single view: object position relative to single page canvas
        const objCenterX = (obj.bbox.x + obj.bbox.width / 2) * canvasSize.width * currentScale;
        const objCenterY = (obj.bbox.y + obj.bbox.height / 2) * canvasSize.height * currentScale;
        
        container.scrollTo({
          left: Math.max(0, objCenterX - container.clientWidth / 2),
          top: Math.max(0, objCenterY - container.clientHeight / 2),
          behavior: 'smooth'
        });
      }
      
      // Highlight the object
      setHighlightedObjectId(obj.id);
      highlightTimeoutRef.current = setTimeout(() => {
        setHighlightedObjectId(null);
        highlightTimeoutRef.current = null;
      }, 3000);
    };
    
    if (isSameFile && isSamePage) {
      // Same file, same page - just scroll smoothly
      scrollToObject(scale);
    } else if (isSameFile) {
      // Same file, different page
      if (isContinuousView(viewMode)) {
        // Continuous view: just scroll to the object position (all pages are mounted)
        scrollToObject(scale);
      } else {
        // Single view: change page, wait for render, then scroll
        setCurrentPage(targetPage);
        setTimeout(() => scrollToObject(scale), 300);
      }
    } else {
      // Different file - set target page BEFORE file load to prevent page-1 flash
      navigationTargetPageRef.current = targetPage;
      const file = allFiles.find(f => f.backendFilename === obj.filename);
      if (file) {
        onFileSelect(file);
        // Wait for PDF to load and render, then scroll to object.
        // The PDF load effect will set currentPage to targetPage directly
        // (via navigationTargetPageRef) so no page-1 flash occurs.
        const waitForRenderAndScroll = () => {
          // Poll until the page is rendered (or timeout after 3s)
          const startTime = Date.now();
          const checkReady = () => {
            const elapsed = Date.now() - startTime;
            if (elapsed > 3000) {
              // Timeout — scroll anyway
              scrollToObject(targetZoom);
              return;
            }
            // Check if PDF is loaded and canvas is ready
            if (isContinuousView(viewMode)) {
              const layout = continuousLayoutRef.current;
              if (layout.positions?.length > targetPage) {
                // Layout is ready — scroll immediately
                setTimeout(() => scrollToObject(targetZoom), 50);
                return;
              }
            } else {
              if (canvasSize.width > 0 && canvasRef.current) {
                setTimeout(() => scrollToObject(targetZoom), 50);
                return;
              }
            }
            requestAnimationFrame(checkReady);
          };
          checkReady();
        };
        waitForRenderAndScroll();
      }
    }
  };

  // Capture object image from canvas
  const captureObjectImage = (obj) => {
    if (!canvasRef.current || !obj?.bbox) return null;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Calculate pixel coordinates
    const x = Math.floor(obj.bbox.x * canvas.width);
    const y = Math.floor(obj.bbox.y * canvas.height);
    const width = Math.ceil(obj.bbox.width * canvas.width);
    const height = Math.ceil(obj.bbox.height * canvas.height);
    
    // Add padding
    const padding = 10;
    const px = Math.max(0, x - padding);
    const py = Math.max(0, y - padding);
    const pw = Math.min(canvas.width - px, width + padding * 2);
    const ph = Math.min(canvas.height - py, height + padding * 2);
    
    try {
      // Create a temporary canvas to extract the region
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = pw;
      tempCanvas.height = ph;
      const tempCtx = tempCanvas.getContext('2d');
      
      // Copy the region from the main canvas
      tempCtx.drawImage(canvas, px, py, pw, ph, 0, 0, pw, ph);
      
      // Check for rotation (we ignore inversion for the flip, but it affects rotation direction)
      const detectedRotation = obj.detected_rotation || 0;
      const detectedInverted = obj.detected_inverted || false;
      
      // If rotated, normalize back to original orientation (0 degrees)
      // NOTE: We do NOT flip for inversion - show the actual image as it appears on the PDF
      // BUT if inverted, rotation direction is reversed (clockwise becomes counter-clockwise)
      if (detectedRotation !== 0) {
        let workingCanvas = tempCanvas;
        let currentWidth = pw;
        let currentHeight = ph;
        
        const rotatedCanvas = document.createElement('canvas');
        const rotatedCtx = rotatedCanvas.getContext('2d');
        
        // Swap dimensions for 90/270 rotations
        if (detectedRotation === 90 || detectedRotation === 270) {
          rotatedCanvas.width = currentHeight;
          rotatedCanvas.height = currentWidth;
        } else {
          rotatedCanvas.width = currentWidth;
          rotatedCanvas.height = currentHeight;
        }
        
        rotatedCtx.save();
        
        // Determine effective rotation (inverted reverses direction)
        // Normal: 90 -> -90, 270 -> +90
        // Inverted: 90 -> +90, 270 -> -90 (opposite)
        let effectiveRotation = detectedRotation;
        if (detectedInverted) {
          // Reverse the rotation direction
          if (detectedRotation === 90) effectiveRotation = 270;
          else if (detectedRotation === 270) effectiveRotation = 90;
          // 180 stays the same (opposite of 180 is still 180)
        }
        
        // Rotate back to 0° (counter-rotate)
        if (effectiveRotation === 90) {
          rotatedCtx.translate(0, currentWidth);
          rotatedCtx.rotate(-Math.PI / 2);
        } else if (effectiveRotation === 180) {
          rotatedCtx.translate(currentWidth, currentHeight);
          rotatedCtx.rotate(Math.PI);
        } else if (effectiveRotation === 270) {
          rotatedCtx.translate(currentHeight, 0);
          rotatedCtx.rotate(Math.PI / 2);
        }
        
        rotatedCtx.drawImage(workingCanvas, 0, 0);
        rotatedCtx.restore();
        
        return rotatedCanvas.toDataURL('image/png');
      }
      
      // Return as data URL
      return tempCanvas.toDataURL('image/png');
    } catch (e) {
      console.error('Error capturing object image:', e);
      return null;
    }
  };
  
  // Capture object image WITHOUT padding - for subclass region marking
  // Scales up for better visibility when marking small regions
  const captureObjectImageNoPadding = (obj, scaleFactor = 3) => {
    if (!canvasRef.current || !obj?.bbox) return null;
    
    const canvas = canvasRef.current;
    
    // Calculate pixel coordinates - NO PADDING
    const x = Math.floor(obj.bbox.x * canvas.width);
    const y = Math.floor(obj.bbox.y * canvas.height);
    const width = Math.ceil(obj.bbox.width * canvas.width);
    const height = Math.ceil(obj.bbox.height * canvas.height);
    
    // Clamp to canvas bounds
    const px = Math.max(0, x);
    const py = Math.max(0, y);
    const pw = Math.min(canvas.width - px, width);
    const ph = Math.min(canvas.height - py, height);
    
    try {
      // Scale up the captured image for better visibility
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = pw * scaleFactor;
      tempCanvas.height = ph * scaleFactor;
      const tempCtx = tempCanvas.getContext('2d');
      
      // Use better image scaling
      tempCtx.imageSmoothingEnabled = true;
      tempCtx.imageSmoothingQuality = 'high';
      
      // Draw scaled up
      tempCtx.drawImage(canvas, px, py, pw, ph, 0, 0, pw * scaleFactor, ph * scaleFactor);
      
      // Check for rotation (we ignore inversion for the flip, but it affects rotation direction)
      const detectedRotation = obj.detected_rotation || 0;
      const detectedInverted = obj.detected_inverted || false;
      const sw = pw * scaleFactor;
      const sh = ph * scaleFactor;
      
      // If rotated, normalize back to original orientation (0 degrees)
      // NOTE: We do NOT flip for inversion - show the actual image as it appears on the PDF
      // BUT if inverted, rotation direction is reversed (clockwise becomes counter-clockwise)
      if (detectedRotation !== 0) {
        let workingCanvas = tempCanvas;
        let currentWidth = sw;
        let currentHeight = sh;
        
        const rotatedCanvas = document.createElement('canvas');
        const rotatedCtx = rotatedCanvas.getContext('2d');
        
        // Swap dimensions for 90/270 rotations
        if (detectedRotation === 90 || detectedRotation === 270) {
          rotatedCanvas.width = currentHeight;
          rotatedCanvas.height = currentWidth;
        } else {
          rotatedCanvas.width = currentWidth;
          rotatedCanvas.height = currentHeight;
        }
        
        rotatedCtx.imageSmoothingEnabled = true;
        rotatedCtx.imageSmoothingQuality = 'high';
        rotatedCtx.save();
        
        // Determine effective rotation (inverted reverses direction)
        let effectiveRotation = detectedRotation;
        if (detectedInverted) {
          if (detectedRotation === 90) effectiveRotation = 270;
          else if (detectedRotation === 270) effectiveRotation = 90;
        }
        
        // Rotate back to 0° (counter-rotate)
        if (effectiveRotation === 90) {
          rotatedCtx.translate(0, currentWidth);
          rotatedCtx.rotate(-Math.PI / 2);
        } else if (effectiveRotation === 180) {
          rotatedCtx.translate(currentWidth, currentHeight);
          rotatedCtx.rotate(Math.PI);
        } else if (effectiveRotation === 270) {
          rotatedCtx.translate(currentHeight, 0);
          rotatedCtx.rotate(Math.PI / 2);
        }
        
        rotatedCtx.drawImage(workingCanvas, 0, 0);
        rotatedCtx.restore();
        
        return rotatedCanvas.toDataURL('image/png');
      }
      
      return tempCanvas.toDataURL('image/png');
    } catch (e) {
      console.error('Error capturing object image:', e);
      return null;
    }
  };

  // Object Finder - Export to CSV
  const handleExportObjects = () => {
    if (detectedObjects.length === 0) {
      alert('No objects to export');
      return;
    }

    // Get all unique subclass keys across all objects
    const allSubclassKeys = new Set();
    detectedObjects.forEach(obj => {
      if (obj.subclassValues) {
        Object.keys(obj.subclassValues).forEach(key => allSubclassKeys.add(key));
      }
    });
    const subclassKeysList = Array.from(allSubclassKeys).sort();

    const headers = ['Index', 'Label', 'Filename', 'Page', 'X', 'Y', 'Width', 'Height', 'Confidence', 'OCR Text', ...subclassKeysList];
    const rows = detectedObjects.map((obj, i) => {
      const baseRow = [
        i + 1,
        obj.label || '',
        obj.filename || '',
        (obj.page || 0) + 1,
        obj.bbox?.x?.toFixed(4) || '',
        obj.bbox?.y?.toFixed(4) || '',
        obj.bbox?.width?.toFixed(4) || '',
        obj.bbox?.height?.toFixed(4) || '',
        obj.confidence?.toFixed(4) || '',
        obj.ocr_text || ''
      ];
      // Add subclass values
      subclassKeysList.forEach(key => {
        baseRow.push(obj.subclassValues?.[key] || '');
      });
      return baseRow;
    });

    const csv = [headers, ...rows].map(row => 
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `objects_${currentFile.name.replace('.pdf', '')}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Object Finder - Assign class to drawn box
  const handleAssignObjectClass = (runOcr = false) => {
    if (!pendingObjectBox || !objectClassInput.trim()) return;
    
    const boxWithClass = {
      ...pendingObjectBox,
      className: objectClassInput.trim()
    };
    
    if (objectFinderMode === 'train') {
      // Add to training boxes
      setObjectTrainingBoxes(prev => [...prev, boxWithClass]);
    } else if (objectFinderMode === 'create') {
      // Add as saved object (like a hotspot but for objects)
      const savedObj = {
        ...boxWithClass,
        id: `saved_obj_${Date.now()}`,
        label: objectClassInput.trim(),
        ocr_text: '',
      };
      setSavedObjects(prev => [...prev, savedObj]);
    }
    
    setShowObjectClassDialog(false);
    setPendingObjectBox(null);
    setObjectClassInput('');
  };

  // Object Finder - Run OCR on pending box
  const handleObjectOcrTest = async () => {
    if (!pendingObjectBox || !currentFile?.backendFilename) return;
    
    setIsOcrTesting(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/ocr/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfFilename: currentFile.backendFilename,
          bbox: pendingObjectBox,
          page: pendingObjectBox.page || 0,
        })
      });

      if (response.ok) {
        const result = await response.json();
        setOcrTestResult(result);
      }
    } catch (error) {
      console.error('OCR test error:', error);
    } finally {
      setIsOcrTesting(false);
    }
  };

  // Object Finder - Save object with OCR result
  const handleSaveObjectWithOcr = () => {
    if (!pendingObjectBox || !objectClassInput.trim()) return;
    
    const savedObj = {
      ...pendingObjectBox,
      id: `saved_obj_${Date.now()}`,
      className: objectClassInput.trim(),
      label: objectClassInput.trim(),
      ocr_text: ocrTestResult?.text || '',
    };
    
    if (objectFinderMode === 'train') {
      setObjectTrainingBoxes(prev => [...prev, { ...savedObj, className: objectClassInput.trim() }]);
    } else {
      setSavedObjects(prev => [...prev, savedObj]);
    }
    
    setShowObjectClassDialog(false);
    setPendingObjectBox(null);
    setObjectClassInput('');
    setOcrTestResult(null);
  };

  const currentFileIndex = allFiles?.findIndex(f => f.id === currentFile?.id) ?? -1;

  // Calculate current file index within the current folder (must be before early returns)
  const currentFolderFileIndex = useMemo(() => {
    if (!currentFile || !currentFolderInfo.folder?.files) return 0;
    return currentFolderInfo.folder.files.findIndex(f => f.id === currentFile.id);
  }, [currentFile, currentFolderInfo.folder]);

  // === PERFORMANCE: Index objects by file+page for O(1) lookups instead of O(n) filtering ===
  const objectsByFilePage = useMemo(() => {
    const index = new Map(); // Map<filename, Map<page, object[]>>
    for (const obj of detectedObjects) {
      if (!index.has(obj.filename)) {
        index.set(obj.filename, new Map());
      }
      const fileMap = index.get(obj.filename);
      if (!fileMap.has(obj.page)) {
        fileMap.set(obj.page, []);
      }
      fileMap.get(obj.page).push(obj);
    }
    return index;
  }, [detectedObjects]);

  // === PERFORMANCE: Memoized filtered objects using index (O(1) lookup) ===
  const currentPageDetectedObjects = useMemo(() => {
    if (!currentFile?.backendFilename) return [];
    const fileMap = objectsByFilePage.get(currentFile.backendFilename);
    if (!fileMap) return [];
    const pageObjects = fileMap.get(currentPage - 1) || [];
    // Only filter by hiddenClasses (small array, fast)
    // Always keep the highlighted object so search flash works even when class is hidden
    if (hiddenClasses.length === 0) return pageObjects;
    return pageObjects.filter(obj => !hiddenClasses.includes(obj.label) || obj.id === highlightedObjectId);
  }, [objectsByFilePage, currentFile?.backendFilename, currentPage, hiddenClasses, highlightedObjectId]);

  // === PERFORMANCE: Index hotspots by page for O(1) lookup ===
  const hotspotsByPage = useMemo(() => {
    const index = new Map(); // Map<page, hotspot[]>
    for (const h of hotspots) {
      if (!index.has(h.page)) {
        index.set(h.page, []);
      }
      index.get(h.page).push(h);
    }
    return index;
  }, [hotspots]);

  const currentPageHotspots = useMemo(() => {
    if (!currentFile?.backendFilename) return [];
    return hotspotsByPage.get(currentPage - 1) || [];
  }, [hotspotsByPage, currentFile?.backendFilename, currentPage]);

  const currentPageTrainingBoxes = useMemo(() => {
    return objectTrainingBoxes.filter(box => box.page === currentPage - 1);
  }, [objectTrainingBoxes, currentPage]);

  // === PERFORMANCE: Index markups by file+page for O(1) lookup ===
  const markupsByFilePage = useMemo(() => {
    const index = new Map(); // Map<filename, Map<page, markup[]>>
    for (const m of markups) {
      if (!index.has(m.filename)) {
        index.set(m.filename, new Map());
      }
      const fileMap = index.get(m.filename);
      if (!fileMap.has(m.page)) {
        fileMap.set(m.page, []);
      }
      fileMap.get(m.page).push(m);
    }
    return index;
  }, [markups]);

  const currentPageMarkups = useMemo(() => {
    if (!currentFileIdentifier) return [];
    const fileMap = markupsByFilePage.get(currentFileIdentifier);
    if (!fileMap) return [];
    return fileMap.get(currentPage - 1) || [];
  }, [markupsByFilePage, currentFileIdentifier, currentPage]);

  // === PERFORMANCE: Memoized search functionality ===
  
  // Debounce search query to avoid filtering on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(globalSearchQuery);
    }, 150); // 150ms debounce
    return () => clearTimeout(timer);
  }, [globalSearchQuery]);
  
  // Utility function for hex to rgba conversion - defined once, not in render loop
  const hexToRgba = useCallback((hex, alpha) => {
    if (!hex || !hex.startsWith('#')) return `rgba(52, 152, 219, ${alpha})`;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }, []);

  // Pre-compute object index map for O(1) lookups instead of O(n) indexOf
  const objectIndexMap = useMemo(() => {
    const map = new Map();
    detectedObjects.forEach((obj, index) => {
      map.set(obj.id, index);
    });
    return map;
  }, [detectedObjects]);

  // Helper function to check if an object matches the search query
  const matchesSearchQuery = useCallback((obj, query) => {
    if (!query) return false;
    const lowerQuery = query.toLowerCase();
    if (obj.label?.toLowerCase().includes(lowerQuery)) return true;
    if (obj.ocr_text?.toLowerCase().includes(lowerQuery)) return true;
    if (obj.description?.toLowerCase().includes(lowerQuery)) return true;
    if (obj.filename?.toLowerCase().includes(lowerQuery)) return true;
    if (obj.className?.toLowerCase().includes(lowerQuery)) return true;
    if (obj.subclassValues) {
      for (const value of Object.values(obj.subclassValues)) {
        if (value && String(value).toLowerCase().includes(lowerQuery)) return true;
      }
    }
    return false;
  }, []);

  // Get files in current folder for scope filtering
  const currentFolderFiles = useMemo(() => {
    if (!currentFolderInfo.folder?.files) return [];
    return currentFolderInfo.folder.files.map(f => f.backendFilename);
  }, [currentFolderInfo.folder]);

  // Memoized search results with scope filtering - only compute when panel is open
  const filteredSearchResults = useMemo(() => {
    // Don't compute if search panel is closed or no query
    if (!showSearchPanel) return [];
    const query = debouncedSearchQuery.trim();
    if (!query) return [];
    
    // Filter by scope first, then by query
    let objectsToSearch = detectedObjects;
    
    if (searchScope === 'current' && currentFile?.backendFilename) {
      objectsToSearch = detectedObjects.filter(obj => obj.filename === currentFile.backendFilename);
      // Further filter by page if page scope is 'current'
      if (searchPageScope === 'current') {
        objectsToSearch = objectsToSearch.filter(obj => obj.page === currentPage);
      }
    } else if (searchScope === 'folder' && currentFolderFiles.length > 0) {
      objectsToSearch = detectedObjects.filter(obj => currentFolderFiles.includes(obj.filename));
    }
    // 'all' uses full detectedObjects
    
    return objectsToSearch
      .filter(obj => matchesSearchQuery(obj, query))
      .slice(0, 100); // Limit to 100 results for performance
  }, [showSearchPanel, debouncedSearchQuery, detectedObjects, searchScope, searchPageScope, currentPage, currentFile?.backendFilename, currentFolderFiles, matchesSearchQuery]);

  // Memoized search results for project-level search (used in "no file" and "loading" states)
  const projectSearchResults = useMemo(() => {
    if (!showSearchPanel) return [];
    const query = debouncedSearchQuery.trim();
    if (!query || !project?.detectedObjects) return [];
    return project.detectedObjects
      .filter(obj => matchesSearchQuery(obj, query))
      .slice(0, 50); // Limit to 50 results for performance
  }, [showSearchPanel, project?.detectedObjects, debouncedSearchQuery, matchesSearchQuery]);

  // Memoized unique classes from detected objects for filter panel
  const uniqueObjectClasses = useMemo(() => {
    return [...new Set(detectedObjects.map(obj => obj.label))].filter(Boolean);
  }, [detectedObjects]);

  // === PERFORMANCE: Pre-compute object styles (colors, shapes) - only changes when objects or classes change ===
  const styledDetectedObjects = useMemo(() => {
    return currentPageDetectedObjects.map(obj => {
      const classNames = [obj.label, obj.className, obj.parentClass];
      const { fillColor, borderColor: classBorderColor } = getClassColors(classNames);
      
      // Look up shapeType from multiple sources:
      // 1. Directly on the object
      // 2. From objectModels (model metadata)
      // 3. From project.classes
      let shapeType = obj.shapeType;
      if (!shapeType) {
        // Try to find matching model by label/className
        const model = objectModels.find(m => 
          m.className === obj.label || 
          m.className === obj.className ||
          m.className === obj.parentClass
        );
        if (model?.shapeType) {
          shapeType = model.shapeType;
        } else {
          // Fall back to project.classes
          shapeType = getClassShapeType(classNames);
        }
      }
      
      const isCircle = shapeType === 'circle';
      const isPolyline = shapeType === 'polyline';
      const isNoFill = fillColor === 'none';
      const isNoBorder = classBorderColor === 'none';
      const isFullyHidden = isNoFill && isNoBorder;
      const bgColor = isNoFill ? 'transparent' : hexToRgba(fillColor, 0.15);
      const borderColor = isNoBorder ? 'transparent' : classBorderColor;
      // For label background, prefer border color if fill is none
      const labelColor = isNoBorder ? (isNoFill ? '#666' : fillColor) : classBorderColor;
      
      return {
        ...obj,
        _style: {
          fillColor,
          bgColor,
          borderColor,
          labelColor,
          shapeType,
          isCircle,
          isPolyline,
          isNoFill,
          isNoBorder,
          isFullyHidden,
        }
      };
    });
  }, [currentPageDetectedObjects, getClassColors, getClassShapeType, hexToRgba, objectModels]);

  // === PERFORMANCE: Pre-compute training box styles ===
  const styledTrainingBoxes = useMemo(() => {
    return currentPageTrainingBoxes.map(box => {
      const classNames = [box.className, box.label, box.parentClass];
      const { fillColor, borderColor: classBorderColor } = getClassColors(classNames);
      
      // Look up shapeType from multiple sources
      let shapeType = box.shapeType;
      if (!shapeType) {
        const model = objectModels.find(m => 
          m.className === box.className || 
          m.className === box.label ||
          m.className === box.parentClass
        );
        if (model?.shapeType) {
          shapeType = model.shapeType;
        } else {
          shapeType = getClassShapeType(classNames);
        }
      }
      
      const isCircle = shapeType === 'circle';
      const isPolyline = shapeType === 'polyline';
      const isNoFill = fillColor === 'none';
      const isNoBorder = classBorderColor === 'none';
      const isFullyHidden = isNoFill && isNoBorder;
      const bgColor = isNoFill ? 'transparent' : hexToRgba(fillColor, 0.2);
      const borderColor = isNoBorder ? 'transparent' : classBorderColor;
      const labelColor = isNoBorder ? (isNoFill ? '#666' : fillColor) : classBorderColor;
      
      return {
        ...box,
        _style: {
          fillColor,
          boxColor: classBorderColor, // Keep boxColor for compatibility
          bgColor,
          borderColor,
          labelColor,
          shapeType,
          isCircle,
          isPolyline,
          isNoFill,
          isNoBorder,
          isFullyHidden,
        }
      };
    });
  }, [currentPageTrainingBoxes, getClassColors, getClassShapeType, hexToRgba, objectModels]);

  // Memoized filtered OCR results for PDF overlay - prevents re-filtering on every render
  // Also extracts matching portion when filter is active
  const filteredOcrResultsForDisplay = useMemo(() => {
    if (!showOcrOnPdf || !ocrResults || ocrResults.length === 0) return [];
    
    // If no filter, return all results for current page
    if (!ocrFilter) {
      return ocrResults.filter(r => r.page === currentPage);
    }
    
    // Helper to escape regex special chars
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Helper to generate segment pattern
    const generateSegmentPattern = (segment) => {
      let pattern = '';
      let i = 0;
      while (i < segment.length) {
        const char = segment[i];
        if (/\d/.test(char)) {
          let count = 0;
          while (i < segment.length && /\d/.test(segment[i])) { count++; i++; }
          pattern += `\\d{${count}}`;
        } else if (/[A-Za-z]/.test(char)) {
          let count = 0;
          while (i < segment.length && /[A-Za-z]/.test(segment[i])) { count++; i++; }
          pattern += `[A-Za-z]{${count}}`;
        } else {
          pattern += escapeRegex(char);
          i++;
        }
      }
      return pattern;
    };
    
    // Generate pattern based on filter mode
    let pattern = '';
    const example = ocrFilter;
    
    // Prefix mode (ends with -)
    if (example.endsWith('-')) {
      const prefix = example.slice(0, -1);
      pattern = '^' + escapeRegex(prefix) + '-';
    }
    // Suffix mode (starts with -)
    else if (example.startsWith('-')) {
      const suffix = example.slice(1);
      pattern = escapeRegex(suffix) + '$';
    }
    // Contains mode (starts and ends with *)
    else if (example.startsWith('*') && example.endsWith('*')) {
      const middle = example.slice(1, -1);
      pattern = escapeRegex(middle);
    }
    // Segment wildcard mode (contains *)
    else if (example.includes('*')) {
      const parts = example.split('-');
      let segPattern = '';
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) segPattern += '-';
        const part = parts[i];
        if (part === '*' || part === '**') {
          segPattern += '[A-Za-z0-9]+';
        } else if (part.includes('*')) {
          segPattern += part.replace(/\*/g, '[A-Za-z0-9]*');
        } else {
          segPattern += generateSegmentPattern(part);
        }
      }
      pattern = '^' + segPattern + '$';
    }
    // Default: exact structure match (search WITHIN text, not full match)
    else {
      let i = 0;
      while (i < example.length) {
        const char = example[i];
        if (/\d/.test(char)) {
          let count = 0;
          while (i < example.length && /\d/.test(example[i])) { count++; i++; }
          pattern += `\\d{${count}}`;
        } else if (/[A-Za-z]/.test(char)) {
          let count = 0;
          while (i < example.length && /[A-Za-z]/.test(example[i])) { count++; i++; }
          pattern += `[A-Za-z]{${count}}`;
        } else {
          pattern += escapeRegex(char);
          i++;
        }
      }
      // No ^ $ anchors - allow matching within longer text
    }
    
    try {
      const regex = new RegExp(pattern, 'i');
      return ocrResults
        .filter(r => r.page === currentPage)
        .map(item => {
          const match = item.text.match(regex);
          if (match) {
            return { 
              ...item, 
              displayText: match[0],
              matchStart: match.index,
              matchLength: match[0].length,
            };
          }
          return null;
        })
        .filter(Boolean);
    } catch {
      // Fallback to contains
      const cleanFilter = ocrFilter.replace(/\*/g, '').toUpperCase();
      return ocrResults
        .filter(r => r.page === currentPage)
        .map(item => {
          const idx = item.text.toUpperCase().indexOf(cleanFilter);
          if (idx === -1) return null;
          return {
            ...item,
            displayText: item.text.slice(idx, idx + cleanFilter.length),
            matchStart: idx,
            matchLength: cleanFilter.length,
          };
        })
        .filter(Boolean);
    }
  }, [showOcrOnPdf, ocrResults, currentPage, ocrFilter]);


  // Lines 9246+ rewritten to use extracted sub-components
  if (!currentFile) {
    return (
      <div className="pdf-viewer-area">
        {/* Toolbar - visible even without file selected */}
        <div className="pdf-toolbar pdf-toolbar-top">
          <span className="toolbar-doc-name" style={{ color: '#999' }}>No file selected</span>
          <div className="toolbar-right">
            <button 
              onClick={() => {
                setShowPropertiesPanel(!showPropertiesPanel);
                if (!showPropertiesPanel) {
                  setShowOcrPanel(false);
                  setShowSmartLinks(false);
                  setShowObjectFinder(false);
                  setShowSearchPanel(false);
                  setShowViewPanel(false);
                  setShowMarkupHistoryPanel(false);
                }
              }}
              className={showPropertiesPanel ? 'active' : ''}
              title="Properties"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="white" strokeWidth="1.5"/>
                <polyline points="14 2 14 8 20 8" stroke="white" strokeWidth="1.5"/>
                <line x1="16" y1="13" x2="8" y2="13" stroke="white" strokeWidth="1.5"/>
                <line x1="16" y1="17" x2="8" y2="17" stroke="white" strokeWidth="1.5"/>
                <line x1="10" y1="9" x2="8" y2="9" stroke="white" strokeWidth="1.5"/>
              </svg>
              Properties
            </button>

            <button 
              onClick={() => navigate(`/project/${projectId}/symbols`)}
              title="Symbols - Create reusable vector symbols"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
                <rect x="2" y="2" width="5" height="5" rx="1" stroke="white" strokeWidth="1.5"/>
                <rect x="9" y="2" width="5" height="5" rx="1" stroke="white" strokeWidth="1.5"/>
                <rect x="2" y="9" width="5" height="5" rx="1" stroke="white" strokeWidth="1.5"/>
                <rect x="9" y="9" width="5" height="5" rx="1" stroke="white" strokeWidth="1.5"/>
              </svg>
              Symbols
            </button>
            
            <button 
              onClick={() => {
                setShowOcrPanel(!showOcrPanel);
                if (!showOcrPanel) {
                  setShowPropertiesPanel(false);
                  setShowSmartLinks(false);
                  setShowObjectFinder(false);
                  setShowSearchPanel(false);
                  setShowViewPanel(false);
                  setShowMarkupHistoryPanel(false);
                }
              }}
              className={showOcrPanel ? 'active' : ''}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
                <rect x="2" y="3" width="12" height="10" rx="1" stroke="white" strokeWidth="1.5" fill="none"/>
                <path d="M5 7H11M5 10H9" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              OCR
            </button>
            
            <button 
              onClick={() => {
                setShowSmartLinks(!showSmartLinks);
                if (!showSmartLinks) {
                  setShowPropertiesPanel(false);
                  setShowOcrPanel(false);
                  setShowObjectFinder(false);
                  setShowSearchPanel(false);
                  setShowViewPanel(false);
                  setShowMarkupHistoryPanel(false);
                }
              }}
              className={showSmartLinks ? 'active' : ''}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle', transform: 'rotate(45deg)'}}>
                <path d="M6.5 10.5L9.5 7.5M7 5H5C3.89543 5 3 5.89543 3 7V9C3 10.1046 3.89543 11 5 11H7M9 5H11C12.1046 5 13 5.89543 13 7V9C13 10.1046 12.1046 11 11 11H9" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Links
            </button>
            
            <button 
              onClick={() => {
                setShowObjectFinder(!showObjectFinder);
                if (!showObjectFinder) {
                  setShowPropertiesPanel(false);
                  setShowOcrPanel(false);
                  setShowSmartLinks(false);
                  setShowSearchPanel(false);
                  setShowViewPanel(false);
                  setShowMarkupHistoryPanel(false);
                }
              }}
              className={showObjectFinder ? 'active' : ''}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
                <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="M8 8V15M8 8L2 4.5M8 8L14 4.5" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
              </svg>
              Objects
            </button>
            
            <button 
              onClick={() => {
                setShowSearchPanel(!showSearchPanel);
                if (!showSearchPanel) {
                  setShowPropertiesPanel(false);
                  setShowOcrPanel(false);
                  setShowSmartLinks(false);
                  setShowObjectFinder(false);
                  setShowViewPanel(false);
                  setShowMarkupHistoryPanel(false);
                }
              }}
              className={showSearchPanel ? 'active' : ''}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
                <circle cx="7" cy="7" r="4" stroke="white" strokeWidth="1.5"/>
                <path d="M10 10L13 13" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Search
            </button>
            
            <button 
              onClick={() => {
                setShowViewPanel(!showViewPanel);
                if (!showViewPanel) {
                  setShowPropertiesPanel(false);
                  setShowOcrPanel(false);
                  setShowSmartLinks(false);
                  setShowObjectFinder(false);
                  setShowSearchPanel(false);
                  setShowMarkupHistoryPanel(false);
                }
              }}
              className={showViewPanel ? 'active' : ''}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
                <ellipse cx="8" cy="8" rx="6" ry="4" stroke="white" strokeWidth="1.5"/>
                <circle cx="8" cy="8" r="2" fill="white"/>
              </svg>
              View
            </button>
          </div>
        </div>
        
        <div className="viewer-content" style={{ backgroundColor: pdfBackgroundColor }}>
          <div className="no-file-selected">
            <h2>Select a Document</h2>
            <p className="brand-subtitle">pidly</p>
          </div>
          
          {/* Object Finder Panel - when no file selected */}
          {showObjectFinder && (
          <div className="smart-links-panel">
            <div className="panel-header">
              <h3>Objects</h3>
              <button className="close-panel" onClick={() => setShowObjectFinder(false)}>×</button>
            </div>
            <div className="panel-content">
              {/* Navigation Links */}
              <div className="panel-nav-links">
                <button 
                  className="nav-link-btn"
                  onClick={() => navigate(`/project/${projectId}/models`)}
                >
                  Models
                </button>
                <button 
                  className="nav-link-btn"
                  onClick={() => navigate(`/project/${projectId}/classes`)}
                >
                  Classes
                </button>
                <button 
                  className="nav-link-btn"
                  onClick={() => navigate(`/project/${projectId}/regions`)}
                >
                  Regions
                </button>
              </div>
              
              {/* Search Section */}
              <div className="panel-section">
                <h4>Search Objects</h4>
                <input
                  type="text"
                  placeholder="Search objects, tags, links..."
                  value={globalSearchQuery}
                  onChange={(e) => setGlobalSearchQuery(e.target.value)}
                  className="search-input"
                  autoFocus
                />
              </div>
              
              <div className="panel-section search-results-section">
                <h4>Search Results</h4>
                <div className="search-results">
                  {globalSearchQuery.trim() ? (
                    globalSearchQuery !== debouncedSearchQuery ? (
                      <p className="no-results">Searching...</p>
                    ) : projectSearchResults.length === 0 ? (
                      <p className="no-results">No results found</p>
                    ) : (
                      projectSearchResults.map((obj, idx) => (
                        <div 
                          key={obj.id || idx} 
                          className="search-result-item"
                          onClick={() => {
                            if (obj.filename && onFileSelect) {
                              const file = allFiles.find(f => f.backendFilename === obj.filename);
                              if (file) {
                                onFileSelect(file, obj);
                              }
                            }
                          }}
                        >
                          {obj.subclassValues && Object.keys(obj.subclassValues).length > 0 ? (
                            Object.entries(obj.subclassValues).map(([k, v]) => (
                              <div key={k} className="result-line">{k}: {v || '-'}</div>
                            ))
                          ) : (
                            obj.ocr_text && <div className="result-line">Tag: {obj.ocr_text}</div>
                          )}
                          <div className="result-line">{obj.label || obj.className}</div>
                          <div className="result-line result-document">{obj.filename?.replace('.pdf', '') || 'Unknown'}</div>
                        </div>
                      ))
                    )
                  ) : (
                    <p className="no-results">Enter a search term to find objects</p>
                  )}
                </div>
              </div>
              
              {/* Stats Section */}
              <div className="panel-section">
                <h4>📊 Project Stats</h4>
                <div className="stats-mini">
                  <div className="stat-item">
                    <span className="stat-value">{savedObjects.length}</span>
                    <span className="stat-label">Objects</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">{(project?.classes || []).filter(c => !c.parentId).length}</span>
                    <span className="stat-label">Classes</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">{drawnRegions.length}</span>
                    <span className="stat-label">Regions</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          )}
          
          {/* Smart Links Panel - when no file selected */}
          {showSmartLinks && (
          <div className="smart-links-panel">
            <div className="panel-header">
              <h3>Links</h3>
              <button className="close-panel" onClick={() => setShowSmartLinks(false)}>×</button>
            </div>
            <div className="panel-content">
              {/* Navigation Link */}
              <div className="panel-nav-links">
                <button 
                  className="nav-link-btn"
                  onClick={() => navigate(`/project/${projectId}/smartlinks`)}
                >
                  Document Link Properties
                </button>
              </div>

              <div className="panel-section disabled-section">
                <div className="mode-buttons">
                  <button disabled className="disabled">
                    Assign Document Link
                  </button>
                </div>
                <p className="mode-hint disabled-hint">Select a document to assign links</p>
              </div>

              <div className="panel-section panel-section-resizable" style={{ height: linksPanelModelsHeight, minHeight: 100, maxHeight: 500, opacity: 0.5 }}>
                <h4>Models ({savedModels.length})</h4>
                {savedModels.length === 0 ? (
                  <p className="no-models">No models trained yet</p>
                ) : (
                  <>
                    <input
                      type="text"
                      className="model-search-input"
                      placeholder="Search models..."
                      value={linksModelSearch}
                      onChange={(e) => setLinksModelSearch(e.target.value)}
                      disabled
                    />
                    <div className="models-list scrollable" style={{ height: 'calc(100% - 60px)' }}>
                      {savedModels
                        .filter(model => 
                          model.className.toLowerCase().includes(linksModelSearch.toLowerCase())
                        )
                        .map(model => (
                          <div key={model.id} className="model-item disabled">
                            <label className="model-checkbox">
                              <input
                                type="checkbox"
                                checked={selectedModels.includes(model.id)}
                                disabled
                              />
                              <span>{model.className}</span>
                            </label>
                            <span className="model-info">{model.numTemplates} templates</span>
                          </div>
                        ))}
                    </div>
                  </>
                )}
              </div>

              {/* Resizer handle */}
              <div 
                className="panel-section-resizer"
                onMouseDown={startLinksPanelResize}
                title="Drag to resize"
              />

              <div className="panel-section disabled-section" style={{ opacity: 0.5 }}>
                <h4>Find Links</h4>
                <p className="mode-hint disabled-hint">Select a document to find links</p>
              </div>
            </div>
          </div>
          )}
          
          {/* View Panel - when no file selected */}
          {showViewPanel && (
          <div className="smart-links-panel">
            <div className="panel-header">
              <h3>View</h3>
              <button className="close-panel" onClick={() => setShowViewPanel(false)}>×</button>
            </div>
            <div className="panel-content">
              <div className="panel-section">
                <h4>View Preferences</h4>
                <div className="view-preferences">
                  <div className="view-pref-row">
                    <label>Hide Labels on Boxes</label>
                    <input 
                      type="checkbox" 
                      checked={hideLabels}
                      onChange={(e) => setHideLabels(e.target.checked)}
                      className="checkbox-input"
                    />
                  </div>
                  <div className="view-pref-row">
                    <label>Background Colour</label>
                    <input 
                      type="color" 
                      value={pdfBackgroundColor}
                      onChange={(e) => setPdfBackgroundColor(e.target.value)}
                      className="color-input-small"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
          )}

          {/* Properties Panel - when no file selected */}
          {showPropertiesPanel && (
          <div className="smart-links-panel">
            <div className="panel-header">
              <h3>Properties</h3>
              <button className="close-panel" onClick={() => setShowPropertiesPanel(false)}>×</button>
            </div>
            <div className="panel-content">
              <div className="panel-section">
                <h4>Current Document</h4>
                <p style={{ fontSize: '12px', color: '#888' }}>No document selected</p>
              </div>
              
              <div className="panel-section">
                <h4>Document Properties</h4>
                <p style={{ fontSize: '12px', color: '#888', marginBottom: '12px' }}>
                  View and edit extracted properties, revision info, and metadata for all project documents.
                </p>
                <button 
                  className="primary-btn"
                  onClick={() => {
                    setShowPropertiesPanel(false);
                    navigate(`/project/${projectId}/docprops`);
                  }}
                  style={{ width: '100%' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ marginRight: '8px', verticalAlign: 'middle' }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="1.5"/>
                    <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="1.5"/>
                    <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" strokeWidth="1.5"/>
                    <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" strokeWidth="1.5"/>
                    <line x1="10" y1="9" x2="8" y2="9" stroke="currentColor" strokeWidth="1.5"/>
                  </svg>
                  Open Document Properties
                </button>
              </div>
            </div>
          </div>
          )}
        </div>
      </div>
    );
  }

  if (isLoadingPdf) {
    return (
      <div className="pdf-viewer-area">
        {/* Minimal Toolbar while loading */}
        <div className="pdf-toolbar pdf-toolbar-top">
          <span className="toolbar-title">Loading...</span>
          <div className="toolbar-right">
            <button 
              onClick={() => setShowSearchPanel(!showSearchPanel)}
              className={showSearchPanel ? 'active' : ''}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
                <circle cx="7" cy="7" r="4" stroke="white" strokeWidth="1.5"/>
                <path d="M10 10L13 13" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Search
            </button>
          </div>
        </div>
        
        <div className="viewer-content" style={{ backgroundColor: pdfBackgroundColor }}>
          <div className="no-file-selected">
            <div className="empty-icon">⏳</div>
            <h2>Loading PDF...</h2>
          </div>
          
          {/* Search Panel */}
          {showSearchPanel && (
            <div className="smart-links-panel">
              <div className="panel-header">
                <h3>Search</h3>
                <button className="close-panel" onClick={() => setShowSearchPanel(false)}>×</button>
              </div>
              <div className="panel-content">
                <div className="panel-section">
                  <input
                    type="text"
                    placeholder="Search objects, tags, links..."
                    value={globalSearchQuery}
                    onChange={(e) => setGlobalSearchQuery(e.target.value)}
                    className="search-input"
                    autoFocus
                  />
                </div>
                
                <div className="panel-section search-results-section">
                  <h4>Search Results</h4>
                  <div className="search-results">
                    {globalSearchQuery.trim() ? (
                      globalSearchQuery !== debouncedSearchQuery ? (
                        <p className="no-results">Searching...</p>
                      ) : projectSearchResults.length === 0 ? (
                        <p className="no-results">No results found</p>
                      ) : (
                        projectSearchResults.map((obj, idx) => (
                          <div 
                            key={obj.id || idx} 
                            className="search-result-item"
                            onClick={() => {
                              if (obj.filename && onFileSelect) {
                                const file = allFiles.find(f => f.backendFilename === obj.filename);
                                if (file) {
                                  onFileSelect(file, obj);
                                }
                              }
                            }}
                          >
                            {obj.subclassValues && Object.keys(obj.subclassValues).length > 0 ? (
                              Object.entries(obj.subclassValues).map(([k, v]) => (
                                <div key={k} className="result-line">{k}: {v || '-'}</div>
                              ))
                            ) : (
                              obj.ocr_text && <div className="result-line">Tag: {obj.ocr_text}</div>
                            )}
                            <div className="result-line">{obj.label || obj.className}</div>
                            <div className="result-line result-document">{obj.filename?.replace('.pdf', '') || 'Unknown'}</div>
                          </div>
                        ))
                      )
                    ) : (
                      <p className="no-results">Enter a search term</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
  const scaledWidth = canvasSize.width * scale;
  const scaledHeight = canvasSize.height * scale;
  
  // Total effective rotation: PDF's inherent page rotation + user-applied rotation
  const effectiveRotation = (((pdfPageRotation + rotation) % 360) + 360) % 360;

  // Helper to transform annotation coordinates based on total effective rotation
  // Annotations/markups are stored in unrotated coordinate space (0-1)
  // This transforms them to the rotated display space
  const transformCoordinate = (x, y) => {
    switch (effectiveRotation) {
      case 90:
        return { x: 1 - y, y: x };
      case 180:
        return { x: 1 - x, y: 1 - y };
      case 270:
        return { x: y, y: 1 - x };
      default: // 0
        return { x, y };
    }
  };

  // Inverse of transformCoordinate: converts rotated display space → unrotated storage space
  const inverseTransformCoordinate = (x, y) => {
    switch (effectiveRotation) {
      case 90:
        return { x: y, y: 1 - x };
      case 180:
        return { x: 1 - x, y: 1 - y };
      case 270:
        return { x: 1 - y, y: x };
      default: // 0
        return { x, y };
    }
  };

  // Lines 9246+ rewritten - see extracted sub-components

  // Lines 9246+ rewritten to use extracted sub-components
  return (
    <div className="pdf-viewer-area">
      {/* Top Toolbar - Panel buttons */}
      <TopToolbar
        showPropertiesPanel={showPropertiesPanel}
        onToggleProperties={() => {
          setShowPropertiesPanel(!showPropertiesPanel);
          if (!showPropertiesPanel) {
            setShowOcrPanel(false);
            setShowSmartLinks(false);
            setLinkMode(null);
            setShowObjectFinder(false);
            setObjectFinderMode(null);
            setShowSearchPanel(false);
            setShowViewPanel(false);
            setShowMarkupsPanel(false);
            setShowMarkupHistoryPanel(false);
            setMarkupMode(null);
          }
        }}
        showOcrPanel={showOcrPanel}
        showSmartLinks={showSmartLinks}
        showObjectFinder={showObjectFinder}
        showSearchPanel={showSearchPanel}
        showViewPanel={showViewPanel}
        onToggleOcr={() => {
          setShowOcrPanel(!showOcrPanel);
          if (!showOcrPanel) {
            setShowPropertiesPanel(false);
            setShowSmartLinks(false);
            setLinkMode(null);
            setShowObjectFinder(false);
            setObjectFinderMode(null);
            setShowSearchPanel(false);
            setShowViewPanel(false);
            setShowMarkupsPanel(false);
            setShowMarkupHistoryPanel(false);
            setMarkupMode(null);
          }
        }}
        onToggleLinks={() => {
          if (showSmartLinks) {
            setLinkMode(null);
          }
          setShowSmartLinks(!showSmartLinks);
          if (!showSmartLinks) {
            setShowPropertiesPanel(false);
            setShowOcrPanel(false);
            setShowObjectFinder(false);
            setObjectFinderMode(null);
            setShowSearchPanel(false);
            setShowViewPanel(false);
            setShowMarkupsPanel(false);
            setShowMarkupHistoryPanel(false);
            setMarkupMode(null);
          }
        }}
        onToggleObjects={() => {
          if (showObjectFinder) {
            setObjectFinderMode(null);
          }
          setShowObjectFinder(!showObjectFinder);
          if (!showObjectFinder) {
            setShowPropertiesPanel(false);
            setShowOcrPanel(false);
            setShowSmartLinks(false);
            setLinkMode(null);
            setShowSearchPanel(false);
            setShowViewPanel(false);
            setShowMarkupsPanel(false);
            setShowMarkupHistoryPanel(false);
            setMarkupMode(null);
          }
        }}
        onToggleSearch={() => {
          setShowSearchPanel(!showSearchPanel);
          if (!showSearchPanel) {
            setShowPropertiesPanel(false);
            setShowOcrPanel(false);
            setShowSmartLinks(false);
            setLinkMode(null);
            setShowObjectFinder(false);
            setObjectFinderMode(null);
            setShowViewPanel(false);
            setShowMarkupsPanel(false);
            setShowMarkupHistoryPanel(false);
            setMarkupMode(null);
          }
        }}
        onToggleView={() => {
          setShowViewPanel(!showViewPanel);
          if (!showViewPanel) {
            setShowPropertiesPanel(false);
            setShowOcrPanel(false);
            setShowSmartLinks(false);
            setLinkMode(null);
            setShowObjectFinder(false);
            setObjectFinderMode(null);
            setShowSearchPanel(false);
            setShowMarkupsPanel(false);
            setShowMarkupHistoryPanel(false);
            setMarkupMode(null);
          }
        }}
      />

      {/* Secondary Markup Tools Toolbar - conditionally visible based on user preference */}
      {showMarkupToolbar && (
        <MarkupToolbar
          markupEditMode={markupEditMode}
          markupMode={markupMode}
          onSetMarkupMode={(mode) => {
            setMarkupMode(mode);
            if (mode) {
              setSelectMode(false);
              setPanMode(false);
              setZoomMode(false);
            }
          }}
          onClearSelection={() => setSelectedMarkup(null)}
          onSetHighlighterOpacity={setMarkupOpacity}
          currentOpacity={markupOpacity}
          onUndo={undoMarkup}
          onRedo={redoMarkup}
          canUndo={markupHistory.length > 0}
          canRedo={markupFuture.length > 0}
          showMarkupsPanel={showMarkupsPanel}
          onToggleMarkupsPanel={() => {
            setShowMarkupsPanel(!showMarkupsPanel);
            if (!showMarkupsPanel) {
              setShowPropertiesPanel(false);
              setShowOcrPanel(false);
              setShowSmartLinks(false);
              setLinkMode(null);
              setShowObjectFinder(false);
              setObjectFinderMode(null);
              setShowSearchPanel(false);
              setShowViewPanel(false);
              setShowMarkupHistoryPanel(false);
            }
          }}
          showMarkupHistoryPanel={showMarkupHistoryPanel}
          onToggleMarkupHistoryPanel={() => {
            setShowMarkupHistoryPanel(!showMarkupHistoryPanel);
            if (!showMarkupHistoryPanel) {
              setShowMarkupsPanel(false);
              setShowPropertiesPanel(false);
              setShowOcrPanel(false);
              setShowSmartLinks(false);
              setLinkMode(null);
              setShowObjectFinder(false);
              setObjectFinderMode(null);
              setShowSearchPanel(false);
              setShowViewPanel(false);
            }
          }}
          documentName={currentFile.name}
          pendingPlacement={pendingPlacement}
        />
      )}
      

      {/* Tool Options Bar - uses existing toolbars/ToolOptionsBar.jsx */}
      {showMarkupToolbar && (
      <ToolOptionsBar
        markupMode={markupMode}
        onSetMarkupMode={(mode) => {
          setMarkupMode(mode);
          if (mode) {
            setSelectMode(false);
            setPanMode(false);
            setZoomMode(false);
          }
        }}
        markupEditMode={markupEditMode}
        onSetMarkupEditMode={setMarkupEditMode}
        selectedMarkup={selectedMarkup}
        selectedMarkups={selectedMarkups}
        onSetSelectedMarkup={setSelectedMarkup}
        updateMarkupProperties={updateMarkupProperties}
        penHighlighterUIMode={penHighlighterUIMode}
        onSetPenHighlighterUIMode={setPenHighlighterUIMode}
        markupColor={markupColor}
        onSetMarkupColor={setMarkupColor}
        markupFillColor={markupFillColor}
        onSetMarkupFillColor={setMarkupFillColor}
        markupBorderColor={markupBorderColor}
        onSetMarkupBorderColor={setMarkupBorderColor}
        markupStrokeWidth={markupStrokeWidth}
        onSetMarkupStrokeWidth={setMarkupStrokeWidth}
        markupOpacity={markupOpacity}
        onSetMarkupOpacity={setMarkupOpacity}
        markupStrokeOpacity={markupStrokeOpacity}
        onSetMarkupStrokeOpacity={setMarkupStrokeOpacity}
        markupFillOpacity={markupFillOpacity}
        onSetMarkupFillOpacity={setMarkupFillOpacity}
        markupBorderOpacity={markupBorderOpacity}
        onSetMarkupBorderOpacity={setMarkupBorderOpacity}
        markupBorderWidth={markupBorderWidth}
        onSetMarkupBorderWidth={setMarkupBorderWidth}
        markupLineStyle={markupLineStyle}
        onSetMarkupLineStyle={setMarkupLineStyle}
        markupLineStyleName={markupLineStyleName}
        onSetMarkupLineStyleName={setMarkupLineStyleName}
        markupLineStylePattern={markupLineStylePattern}
        onSetMarkupLineStylePattern={setMarkupLineStylePattern}
        markupLineStyleRaw={markupLineStyleRaw}
        onSetMarkupLineStyleRaw={setMarkupLineStyleRaw}
        projectLineStyles={projectLineStyles}
        onSaveLineStyle={handleSaveLineStyle}
        onRemoveLineStyle={handleRemoveLineStyle}
        markupBorderStyle={markupBorderStyle}
        onSetMarkupBorderStyle={setMarkupBorderStyle}
        markupArrowHeadSize={markupArrowHeadSize}
        onSetMarkupArrowHeadSize={setMarkupArrowHeadSize}
        markupCloudArcSize={markupCloudArcSize}
        onSetMarkupCloudArcSize={setMarkupCloudArcSize}
        markupCloudInverted={markupCloudInverted}
        onSetMarkupCloudInverted={setMarkupCloudInverted}
        markupFontSize={markupFontSize}
        onSetMarkupFontSize={setMarkupFontSize}
        markupFontFamily={markupFontFamily}
        onSetMarkupFontFamily={setMarkupFontFamily}
        markupTextAlign={markupTextAlign}
        onSetMarkupTextAlign={setMarkupTextAlign}
        markupVerticalAlign={markupVerticalAlign}
        onSetMarkupVerticalAlign={setMarkupVerticalAlign}
        markupTextPadding={markupTextPadding}
        onSetMarkupTextPadding={setMarkupTextPadding}
        pdfDoc={pdfDoc}
        hasLoadedAnnotations={hasLoadedAnnotations}
        onLoadAnnotationsFromPdf={loadAnnotationsFromPdf}
        onSetHasLoadedAnnotations={setHasLoadedAnnotations}
        markups={markups}
        onSetMarkups={setMarkups}
        ownedPdfAnnotationIds={ownedPdfAnnotationIds}
        onSetOwnedPdfAnnotationIds={setOwnedPdfAnnotationIds}
        unsavedMarkupFiles={unsavedMarkupFiles}
        onSetUnsavedMarkupFiles={setUnsavedMarkupFiles}
        deletedPdfAnnotations={deletedPdfAnnotations}
        onSetDeletedPdfAnnotations={setDeletedPdfAnnotations}
        showMarkupsPanel={showMarkupsPanel}
        onSetShowMarkupsPanel={setShowMarkupsPanel}
        onSetShowMarkupHistoryPanel={setShowMarkupHistoryPanel}
        currentFile={currentFile}
        currentFileIdentifier={currentFileIdentifier}
        onSaveMarkupsToPdf={saveMarkupsToPdf}
        pendingPlacement={pendingPlacement}
      />
      )}

      <div
        className={`viewer-content${isPanning ? ' panning-cursor' : panMode ? ' pan-cursor' : ''}${markupMode && markupMode !== 'select' ? ' markup-drawing-active' : ''}`}
        style={{ backgroundColor: pdfBackgroundColor }}
        onContextMenu={(e) => {
          // Prevent browser context menu when clicking on a markup
          if (canvasRef.current) {
            const canvas = canvasRef.current;
            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) / scale;
            const y = (e.clientY - rect.top) / scale;
            const { x: clickX, y: clickY } = inverseTransformCoordinate(x / canvasSize.width, y / canvasSize.height);
            if (hitTestMarkup(clickX, clickY)) {
              e.preventDefault();
            }
          }
        }}
        onMouseMove={(e) => {
          if (zoomSettings.showCrosshairs || zoomSettings.showCoordinates) {
            const container = containerRef.current;
            if (container) {
              const cRect = container.getBoundingClientRect();
              const mouseX = e.clientX;
              const mouseY = e.clientY;
              // Only track when mouse is over the PDF container
              if (mouseX >= cRect.left && mouseX <= cRect.right && mouseY >= cRect.top && mouseY <= cRect.bottom) {
                const screenX = mouseX - cRect.left;
                const screenY = mouseY - cRect.top;
                const pdfX = Math.round((container.scrollLeft + screenX) / scale);
                const pdfY = Math.round((container.scrollTop + screenY) / scale);
                pdfvMousePosRef.current = { screenX, screenY, pdfX, pdfY, cRect };
                // Direct DOM updates — no React re-render
                if (crosshairHRef.current) {
                  crosshairHRef.current.style.display = '';
                  crosshairHRef.current.style.top = (cRect.top + screenY) + 'px';
                  crosshairHRef.current.style.left = cRect.left + 'px';
                  crosshairHRef.current.style.width = cRect.width + 'px';
                }
                if (crosshairVRef.current) {
                  crosshairVRef.current.style.display = '';
                  crosshairVRef.current.style.left = (cRect.left + screenX) + 'px';
                  crosshairVRef.current.style.top = cRect.top + 'px';
                  crosshairVRef.current.style.height = cRect.height + 'px';
                }
                if (coordsRef.current) {
                  coordsRef.current.style.display = '';
                  coordsRef.current.style.left = (cRect.left + screenX + 16) + 'px';
                  coordsRef.current.style.top = (cRect.top + screenY + 16) + 'px';
                  coordsRef.current.textContent = `${pdfX}, ${pdfY}`;
                }
              } else {
                pdfvMousePosRef.current = null;
                if (crosshairHRef.current) crosshairHRef.current.style.display = 'none';
                if (crosshairVRef.current) crosshairVRef.current.style.display = 'none';
                if (coordsRef.current) coordsRef.current.style.display = 'none';
              }
            }
          } else {
            pdfvMousePosRef.current = null;
            if (crosshairHRef.current) crosshairHRef.current.style.display = 'none';
            if (crosshairVRef.current) crosshairVRef.current.style.display = 'none';
            if (coordsRef.current) coordsRef.current.style.display = 'none';
          }
        }}
        onMouseLeave={() => {
          pdfvMousePosRef.current = null;
          if (crosshairHRef.current) crosshairHRef.current.style.display = 'none';
          if (crosshairVRef.current) crosshairVRef.current.style.display = 'none';
          if (coordsRef.current) coordsRef.current.style.display = 'none';
        }}
      >
        {/* PDF Container - Single Page View - extracted to SinglePageView.jsx */}
        {viewMode === 'single' && (
          <SinglePageView
            containerRef={containerRef}
            canvasRef={canvasRef}
            singleScrollContentRef={singleScrollContentRef}
            singleCanvasContainerRef={singleCanvasContainerRef}
            viewMode={viewMode}
            currentPage={currentPage}
            numPages={numPages}
            rotation={effectiveRotation}
            scale={scale}
            isZooming={isZooming}
            canvasSize={canvasSize}
            pageBaseDimensions={pageBaseDimensions}
            pdfBackgroundColor={pdfBackgroundColor}
            overlaysReady={overlaysReady}
            pdfDoc={pdfDoc}
            handleMouseDown={handleMouseDown}
            handleMouseMove={handleMouseMove}
            handleMouseUp={handleMouseUp}
            handleDoubleClick={handleDoubleClick}
            panMode={panMode}
            isPanning={isPanning}
            zoomMode={zoomMode}
            selectMode={selectMode}
            setIsPanning={setIsPanning}
            setPanStart={setPanStart}
            setPanMode={setPanMode}
            setZoomMode={setZoomMode}
            markupMode={markupMode}
            markupEditMode={markupEditMode}
            markups={markups}
            currentMarkup={currentMarkup}
            selectedMarkup={selectedMarkup}
            selectedMarkups={selectedMarkups}
            editingTextMarkupId={editingTextMarkupId}
            textEditValue={textEditValue}
            setTextEditValue={setTextEditValue}
            setEditingTextMarkupId={setEditingTextMarkupId}
            ownedPdfAnnotationIds={ownedPdfAnnotationIds}
            editingPdfAnnotationId={editingPdfAnnotationId}
            markupCanvasRef={markupCanvasRef}
            drawingOverlayRef={drawingOverlayRef}
            annotationLayerRef={annotationLayerRef}
            isDrawingMarkup={isDrawingMarkup}
            isDraggingMarkup={isDraggingMarkup}
            isResizingMarkup={isResizingMarkup}
            isRotatingMarkup={isRotatingMarkup}
            hoveredMarkupId={hoveredMarkupId}
            hoveredMarkupIdRef={hoveredMarkupIdRef}
            getLineDashArray={getLineDashArray}
            getMarkupCursor={getMarkupCursor}
            handleMarkupContextMenu={handleMarkupContextMenu}
            expandedNotes={expandedNotes}
            toggleNoteExpanded={toggleNoteExpanded}
            showNoteDialog={showNoteDialog}
            setShowNoteDialog={setShowNoteDialog}
            setNoteDialogPosition={setNoteDialogPosition}
            setNoteText={setNoteText}
            setEditingNoteId={setEditingNoteId}
            editingMarkupText={editingMarkupText}
            setEditingMarkupText={setEditingMarkupText}
            markups_setMarkups={setMarkups}
            setSelectedMarkup={setSelectedMarkup}
            setSelectedMarkups={setSelectedMarkups}
            selectedMarkupRef={selectedMarkupRef}
            textInputRef={textInputRef}
            getMarkupBounds={getMarkupBounds}
            convertToEditableFormat={convertToEditableFormat}
            takeOwnershipOfAnnotation={takeOwnershipOfAnnotation}
            markupFontSize={markupFontSize}
            markupFontFamily={markupFontFamily}
            markupTextAlign={markupTextAlign}
            markupVerticalAlign={markupVerticalAlign}
            markupLineSpacing={markupLineSpacing}
            markupColor={markupColor}
            markupStrokeWidth={markupStrokeWidth}
            markupFillColor={markupFillColor}
            markupBorderColor={markupBorderColor}
            markupLineStyle={markupLineStyle}
            markupStrokeOpacity={markupStrokeOpacity}
            markupFillOpacity={markupFillOpacity}
            markupCloudInverted={markupCloudInverted}
            markupCloudArcSize={markupCloudArcSize}
            showObjectBoxes={showObjectBoxes}
            showObjectFinder={showObjectFinder}
            objectFinderMode={objectFinderMode}
            objectDrawType={objectDrawType}
            styledDetectedObjects={styledDetectedObjects}
            styledTrainingBoxes={styledTrainingBoxes}
            hoveredObject={hoveredObject}
            setHoveredObject={setHoveredObject}
            highlightedObjectId={highlightedObjectId}
            hideLabels={hideLabels}
            hiddenClasses={hiddenClasses}
            objectViewMode={objectViewMode}
            detectedObjects={detectedObjects}
            setDetectedObjects={setDetectedObjects}
            setSelectedObject={setSelectedObject}
            setShowObjectEditDialog={setShowObjectEditDialog}
            setObjectImagePreview={setObjectImagePreview}
            captureObjectImage={captureObjectImage}
            objectIndexMap={objectIndexMap}
            savedObjects={savedObjects}
            showLinksOnPdf={showLinksOnPdf}
            showSmartLinks={showSmartLinks}
            linkMode={linkMode}
            currentPageHotspots={currentPageHotspots}
            hotspots={hotspots}
            setHotspots={setHotspots}
            hoveredHotspot={hoveredHotspot}
            setHoveredHotspot={setHoveredHotspot}
            trainingBoxes={trainingBoxes}
            setTrainingBoxes={setTrainingBoxes}
            currentRect={currentRect}
            isDrawing={isDrawing}
            handleHotspotClick={handleHotspotClick}
            setHotspotContextMenu={setHotspotContextMenu}
            allFiles={allFiles}
            showOcrOnPdf={showOcrOnPdf}
            filteredOcrResultsForDisplay={filteredOcrResultsForDisplay}
            showRegionBoxes={showRegionBoxes}
            drawnRegions={drawnRegions}
            hoveredRegion={hoveredRegion}
            setHoveredRegion={setHoveredRegion}
            setEditingRegion={setEditingRegion}
            setEditRegionName={setEditRegionName}
            setShowRegionEditDialog={setShowRegionEditDialog}
            pendingShape={pendingShape}
            setPendingShape={setPendingShape}
            drawingShapeType={drawingShapeType}
            polylinePoints={polylinePoints}
            polylineMousePos={polylineMousePos}
            isNearStartPoint={isNearStartPoint}
            cloudPoints={cloudPoints}
            isShiftPressed={isShiftPressed}
            captureRegion={captureRegion}
            symbolCaptureMode={symbolCaptureMode}
            selectionBox={selectionBox}
            isDrawingSelectionBox={isDrawingSelectionBox}
            zoomBox={zoomBox}
            isDrawingZoomBox={isDrawingZoomBox}
            currentFileIdentifier={currentFileIdentifier}
            hexToRgba={hexToRgba}
            getClassColor={getClassColor}
            getClassColors={getClassColors}
            getClassShapeType={getClassShapeType}
            getRegionTypeColors={getRegionTypeColors}
            project={project}
            currentFile={currentFile}
            objectModels={objectModels}
            objectTrainingBoxes={objectTrainingBoxes}
            showDrawTypePopup={showDrawTypePopup}
            setShowDrawTypePopup={setShowDrawTypePopup}
            continuousCanvasRefs={continuousCanvasRefs}
            markupComments={markupComments}
            setMarkupComments={setMarkupComments}
            showCommentInput={showCommentInput}
            setShowCommentInput={setShowCommentInput}
            commentInputText={commentInputText}
            setCommentInputText={setCommentInputText}
            markupAuthor={markupAuthor}
            dragOffsetRef={dragOffsetRef}
            continuousSelectionRef={continuousSelectionRef}
            selectedMarkupsRef={selectedMarkupsRef}
            setIsDraggingMarkup={setIsDraggingMarkup}
            isDraggingMarkupRef={isDraggingMarkupRef}
            didDragMoveRef={didDragMoveRef}
            wasAlreadySelectedRef={wasAlreadySelectedRef}
            setMarkupDragStart={setMarkupDragStart}
            markupDragStartRef={markupDragStartRef}
            draggingPolylinePoint={draggingPolylinePoint}
            draggingPolylinePointRef={draggingPolylinePointRef}
            setDraggingPolylinePoint={setDraggingPolylinePoint}
            isRotatingMarkupRef={isRotatingMarkupRef}
            rotationStartRef={rotationStartRef}
            setIsRotatingMarkup={setIsRotatingMarkup}
            objectTrainingBoxes_set={setObjectTrainingBoxes}
            pendingParentBox={pendingParentBox}
            setPendingParentBox={setPendingParentBox}
            setParentBoxImage={setParentBoxImage}
            setShowSubclassRegionDialog={setShowSubclassRegionDialog}
            setCurrentSubclassIndex={setCurrentSubclassIndex}
            setSubclassRegions={setSubclassRegions}
            parentClassForTraining={parentClassForTraining}
            noteText={noteText}
            editingNoteId={editingNoteId}
            savedSymbols={savedSymbols}
            draggingSymbol={draggingSymbol}
            setDraggingSymbol={setDraggingSymbol}
            placeSymbol={placeSymbol}
            placeImageSymbol={placeImageSymbol}
            pendingPlacement={pendingPlacement}
            activeResizeHandle={activeResizeHandle}
            activeArcHandle={activeArcHandle}
            resizeHandle={resizeHandle}
            scaledWidth={scaledWidth}
            scaledHeight={scaledHeight}
            transformCoordinate={transformCoordinate}
            currentPageMarkups={currentPageMarkups}
            setPendingRegionShape={setPendingRegionShape}
            setRegionTypeInput={setRegionTypeInput}
            setSubRegionNameInput={setSubRegionNameInput}
            setRegionFillColorInput={setRegionFillColorInput}
            setRegionBorderColorInput={setRegionBorderColorInput}
            setShowRegionAssignDialog={setShowRegionAssignDialog}
            setPendingObjectBox={setPendingObjectBox}
            setObjectClassInput={setObjectClassInput}
            setShowObjectClassDialog={setShowObjectClassDialog}
          />
        )}

        {/* PDF Container - Continuous View - extracted to ContinuousView.jsx */}
        {(viewMode === 'continuous' || viewMode === 'continuousHorizontal' || viewMode === 'sideBySide') && (
          <ContinuousView
            {...{
              containerRef, continuousWrapperRef, zoomInnerRef,
              viewMode, currentPage, numPages, rotation: effectiveRotation, scale, isZooming, isZoomingRef,
              canvasSize, pageBaseDimensions, allPageDimensions,
              pdfBackgroundColor, overlaysReady, pdfDoc,
              continuousLayout, continuousLayoutRef,
              continuousCanvasRefs, renderedPages,
              mountedPageRange, visiblePages, CONTINUOUS_VIEW_BUFFER,
              panMode, isPanning, panStart, zoomMode, selectMode,
              setIsPanning, setPanStart, setCurrentPage,
              zoomWithScrollAdjust, precomputedPageDimsRef,
              setIsDrawingZoomBox, setZoomBox,
              markupMode, markupEditMode, markups, markupsByPageIndex, currentMarkup, selectedMarkup, selectedMarkups,
              editingTextMarkupId, textEditValue, setTextEditValue, setEditingTextMarkupId,
              saveTextEdit, cancelTextEdit,
              ownedPdfAnnotationIds, editingPdfAnnotationId,
              markupCanvasRef, drawingOverlayRef, drawingPageRef,
              isDrawingMarkup, isDraggingMarkup, isResizingMarkup, isRotatingMarkup,
              setIsDrawingMarkup, setIsDraggingMarkup, setIsResizingMarkup, setIsRotatingMarkup,
              setCurrentMarkup, setMarkupDragStart, setResizeHandle,
              hoveredMarkupId, hoveredMarkupIdRef,
              getLineDashArray, getMarkupCursor,
              handleMarkupContextMenu,
              expandedNotes, toggleNoteExpanded,
              setShowNoteDialog, setNoteDialogPosition, setNoteText, setEditingNoteId,
              editingMarkupText, setEditingMarkupText,
              setMarkups, setSelectedMarkup, setSelectedMarkups,
              textInputRef,
              markupFontSize, markupFontFamily, markupTextAlign, markupVerticalAlign,
              markupLineSpacing, markupColor,
              markupStrokeWidth, markupFillColor, markupBorderColor,
              markupOpacity, markupStrokeOpacity, markupFillOpacity,
              markupLineStyle, markupBorderStyle,
              markupCloudArcSize, markupCloudInverted,
              markupArrowHeadSize,
              showObjectBoxes, showObjectFinder, objectFinderMode, objectDrawType,
              detectedObjects, setDetectedObjects,
              hoveredObject, setHoveredObject, highlightedObjectId,
              hideLabels, hiddenClasses, objectViewMode,
              setSelectedObject, setShowObjectEditDialog, setObjectImagePreview,
              captureObjectImage,
              savedObjects,
              objectsByFilePage, objectModels,
              showLinksOnPdf, showSmartLinks, linkMode,
              hotspots, setHotspots, hotspotsByPage,
              hoveredHotspot, setHoveredHotspot,
              trainingBoxes, setTrainingBoxes,
              currentRect, isDrawing,
              handleHotspotClick,
              setHotspotContextMenu,
              allFiles,
              showOcrOnPdf, ocrResults, ocrFilter,
              showRegionBoxes, drawnRegions,
              hoveredRegion, setHoveredRegion,
              setEditingRegion, setEditRegionName, setShowRegionEditDialog,
              setPendingRegionShape, setRegionTypeInput, setSubRegionNameInput,
              setRegionFillColorInput, setRegionBorderColorInput, setShowRegionAssignDialog,
              pendingShape, setPendingShape,
              drawingShapeType,
              polylinePoints, polylineMousePos, isNearStartPoint,
              captureRegion, symbolCaptureMode,
              selectionBox, isDrawingSelectionBox, setSelectionBox, setIsDrawingSelectionBox,
              isShiftPressed,
              zoomBox, isDrawingZoomBox,
              currentFileIdentifier,
              hexToRgba, getClassColor, getClassColors, getClassShapeType, getRegionTypeColors,
              project, currentFile,
              objectTrainingBoxes, setObjectTrainingBoxes,
              pendingParentBox, setPendingParentBox, setParentBoxImage,
              setShowSubclassRegionDialog, setCurrentSubclassIndex, setSubclassRegions,
              parentClassForTraining,
              didDragMoveRef, wasAlreadySelectedRef, dragDeltaRef, rafIdRef,
              moveMarkup, resizeMarkup,
              dragOffsetRef, continuousSelectionRef, selectedMarkupsRef,
              isDraggingMarkupRef, isResizingMarkupRef, isRotatingMarkupRef,
              isDrawingMarkupRef, currentMarkupRef, markupDragStartRef,
              dragStartRef, resizeHandleRef, rotationStartRef,
              draggingPolylinePointRef, selectedMarkupRef,
              draggingPolylinePoint, setDraggingPolylinePoint,
              handleMouseDown, handleMouseMove, handleMouseUp, handleDoubleClick,
              setIsDrawing, setDrawStart, setCurrentRect,
              setObjectClassName, setShowObjectClassDialog, setPendingObjectBox,
              setObjectClassInput,
              showDrawTypePopup, setShowDrawTypePopup,
              savedSymbols, draggingSymbol, pendingPlacement, setPendingPlacement,
              markupComments, setMarkupComments,
              placeSymbol, placeImageSymbol, setDraggingSymbol,
              showCommentInput, setShowCommentInput,
              commentInputText, setCommentInputText,
              markupAuthor,
              activeResizeHandle, activeArcHandle, setActiveResizeHandle,
              scrollToPagePosition,
              setUnsavedMarkupFiles,
              setMarkupHistory, setMarkupFuture,
              addMarkupWithHistory, getMarkupBounds, updateDrawingOverlay,
              convertToEditableFormat, takeOwnershipOfAnnotation,
              currentPageRef,
              scaleRef,
              noteText, editingNoteId,
              scaledWidth, scaledHeight,
              transformCoordinate,
            }}
          />
        )}

        {/* Side by Side View now handled by ContinuousView above */}


        {/* Smart Links Panel */}
        <LinksPanel
          isOpen={showSmartLinks}
          onClose={() => { setShowSmartLinks(false); setLinkMode(null); }}
          onNavigateToLinkProperties={() => navigate(`/project/${projectId}/smartlinks`, { 
            state: { returnToFile: currentFile ? { id: currentFile.id, backendFilename: currentFile.backendFilename } : null } 
          })}
          linkMode={linkMode}
          onLinkModeChange={setLinkMode}
          onSetPanMode={setPanMode}
          onSetZoomMode={setZoomMode}
          savedModels={savedModels}
          linksModelSearch={linksModelSearch}
          onLinksModelSearchChange={setLinksModelSearch}
          selectedModels={selectedModels}
          onToggleModelSelection={toggleModelSelection}
          linksPanelModelsHeight={linksPanelModelsHeight}
          onStartResize={startLinksPanelResize}
          detectionScope={detectionScope}
          onDetectionScopeChange={setDetectionScope}
          detectionPageScope={detectionPageScope}
          onDetectionPageScopeChange={setDetectionPageScope}
          currentFile={currentFile}
          currentFolderInfo={currentFolderInfo}
          numPages={numPages}
          currentPage={currentPage}
          isDetecting={isDetecting}
          smartLinksProgress={smartLinksProgress}
          smartLinksDisplayPercent={smartLinksDisplayPercent}
          smartLinksClassSettings={smartLinksClassSettings}
          confidence={confidence}
          enableOCR={enableOCR}
          onOpenSettingsDialog={(settings) => {
            setSmartLinksClassSettings(settings);
            setShowSmartLinksSettings(true);
          }}
        />

        {/* OCR Panel */}
        <OCRPanel
          isOpen={showOcrPanel}
          onClose={() => setShowOcrPanel(false)}
          showOcrOnPdf={showOcrOnPdf}
          onShowOcrOnPdfChange={setShowOcrOnPdf}
          ocrScope={ocrScope}
          onOcrScopeChange={setOcrScope}
          currentFile={currentFile}
          numPages={numPages}
          currentPage={currentPage}
          // Folder/Project context
          currentFolderInfo={currentFolderInfo}
          projectFileCount={currentFolderInfo.totalFileCount}
          // OCR state
          isRunningOcr={isRunningOcr}
          ocrProgress={ocrProgress}
          ocrResults={ocrResults}
          ocrResultsCount={ocrResultsCount}
          // Filter
          ocrFilter={ocrFilter}
          onOcrFilterChange={setOcrFilter}
          ocrFilterType={ocrFilterType}
          onOcrFilterTypeChange={setOcrFilterType}
          // Search integration
          includeOcrInSearch={includeOcrInSearch}
          onIncludeOcrInSearchChange={setIncludeOcrInSearch}
          // Run OCR with extended scope support
          onRunOcr={async () => {
            if (!currentFile?.backendFilename) return;
            
            ocrCancelRef.current = false;
            setIsRunningOcr(true);
            setOcrProgress({ percent: 0, status: 'Starting OCR...' });
            
            try {
              // Helper to get all files in a folder recursively
              const getAllFilesInFolder = (folder) => {
                let files = [...(folder.files || [])];
                if (folder.subfolders) {
                  folder.subfolders.forEach(sub => {
                    files = [...files, ...getAllFilesInFolder(sub)];
                  });
                }
                return files;
              };
              
              // Helper to get all files in project
              const getAllFilesInProject = () => {
                let files = [];
                if (project?.folders) {
                  project.folders.forEach(folder => {
                    files = [...files, ...getAllFilesInFolder(folder)];
                  });
                }
                return files;
              };
              
              // Determine files to process based on scope
              let filesToProcess = [];
              if (ocrScope === 'current') {
                filesToProcess = [{ file: currentFile, pages: [currentPage] }];
              } else if (ocrScope === 'document') {
                filesToProcess = [{ file: currentFile, pages: Array.from({ length: numPages }, (_, i) => i + 1) }];
              } else if (ocrScope === 'folder' && currentFolderInfo.folder) {
                const folderFiles = currentFolderInfo.folder.files || [];
                filesToProcess = folderFiles.map(f => ({ file: f, pages: null })); // null means all pages
              } else if (ocrScope === 'project') {
                const projectFiles = getAllFilesInProject();
                filesToProcess = projectFiles.map(f => ({ file: f, pages: null }));
              }
              
              let totalProcessed = 0;
              let totalItems = 0;
              const totalFiles = filesToProcess.length;
              
              for (let fileIdx = 0; fileIdx < filesToProcess.length; fileIdx++) {
                if (ocrCancelRef.current) {
                  setOcrProgress({ percent: 0, status: 'Cancelled' });
                  break;
                }
                
                const { file, pages } = filesToProcess[fileIdx];
                const filename = file.backendFilename;
                if (!filename) continue;
                
                // Get existing results for this file to avoid duplicates
                const existingResults = ocrResultsByFile[filename] || [];
                const existingPages = new Set(existingResults.map(r => r.page));
                
                // Determine pages to process (either specified or all)
                let pagesToProcess = pages;
                if (!pagesToProcess) {
                  // Get actual page count for this file
                  let filePageCount = null;
                  try {
                    const sfParam = file.sourceFolder ? `?sourceFolder=${encodeURIComponent(file.sourceFolder)}` : '';
                    const pdfUrl = `${BACKEND_URL}/api/pdf/${encodeURIComponent(filename)}${sfParam}`;
                    const loadingTask = window.pdfjsLib.getDocument({ url: pdfUrl, verbosity: 0 });
                    const pdfDocTemp = await loadingTask.promise;
                    filePageCount = pdfDocTemp.numPages;
                    pdfDocTemp.destroy();
                  } catch (e) {
                    console.warn(`Could not get page count for ${filename}, using max 50`);
                    filePageCount = 50;
                  }
                  
                  // Build page list from actual page count
                  pagesToProcess = [];
                  for (let p = 1; p <= filePageCount; p++) {
                    if (!existingPages.has(p)) {
                      pagesToProcess.push(p);
                    }
                  }
                  if (pagesToProcess.length === 0 && existingResults.length > 0) {
                    // File already processed, skip
                    totalProcessed++;
                    continue;
                  }
                }
                
                // Filter out already-processed pages
                pagesToProcess = pagesToProcess.filter(p => !existingPages.has(p));
                
                if (pagesToProcess.length === 0) {
                  totalProcessed++;
                  continue;
                }
                
                let fileResults = [...existingResults]; // Start with existing results
                
                // Process pages in batches of 5 for speed (one HTTP call per batch)
                const BATCH_SIZE = 5;
                for (let batchStart = 0; batchStart < pagesToProcess.length; batchStart += BATCH_SIZE) {
                  if (ocrCancelRef.current) break;
                  
                  const batch = pagesToProcess.slice(batchStart, batchStart + BATCH_SIZE);
                  const overallProgress = ((fileIdx + (batchStart / pagesToProcess.length)) / totalFiles) * 100;
                  
                  setOcrProgress({ 
                    percent: Math.round(overallProgress), 
                    status: totalFiles > 1 
                      ? `File ${fileIdx + 1}/${totalFiles}: Pages ${batch[0]}-${batch[batch.length-1]}...` 
                      : `Processing pages ${batch[0]}-${batch[batch.length-1]} of ${pagesToProcess.length}...`
                  });
                  
                  try {
                    // Try batch endpoint first
                    const batchResponse = await fetch(`${BACKEND_URL}/api/ocr/fullpage/batch`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ pdfFilename: filename, pages: batch, dpi: 150, sourceFolder: file.sourceFolder || null })
                    });
                    
                    if (batchResponse.ok) {
                      const batchData = await batchResponse.json();
                      
                      if (batchData.batch_results) {
                        // Process each page's results from the batch
                        for (const [pageKey, pageResult] of Object.entries(batchData.batch_results)) {
                          if (pageResult.results && pageResult.results.length > 0) {
                            pageResult.results.forEach(newItem => {
                              const isDuplicate = fileResults.some(existing => 
                                existing.page === newItem.page &&
                                Math.abs(existing.bbox.x - newItem.bbox.x) < 0.001 &&
                                Math.abs(existing.bbox.y - newItem.bbox.y) < 0.001
                              );
                              if (!isDuplicate) {
                                fileResults.push(newItem);
                                totalItems++;
                              }
                            });
                          }
                        }
                      }
                    } else {
                      // Batch endpoint not available, fall back to page-by-page
                      for (const pageNum of batch) {
                        if (ocrCancelRef.current) break;
                        try {
                          const result = await runFullPageOcr(filename, pageNum, 150, file.sourceFolder);
                          if (result.results && result.results.length > 0) {
                            result.results.forEach(newItem => {
                              const isDuplicate = fileResults.some(existing => 
                                existing.page === newItem.page &&
                                Math.abs(existing.bbox.x - newItem.bbox.x) < 0.001 &&
                                Math.abs(existing.bbox.y - newItem.bbox.y) < 0.001
                              );
                              if (!isDuplicate) {
                                fileResults.push(newItem);
                                totalItems++;
                              }
                            });
                          }
                        } catch (pageError) {
                          const errMsg = pageError.message || '';
                          if (errMsg.includes('not found') || errMsg.includes('out of range') || errMsg.includes('Could not convert')) {
                            break;
                          }
                        }
                      }
                    }
                  } catch (batchError) {
                    console.warn(`OCR batch error on ${filename}:`, batchError);
                  }
                  
                  // Update results progressively
                  if (fileResults.length > 0) {
                    setOcrResultsByFile(prev => ({
                      ...prev,
                      [filename]: fileResults
                    }));
                  }
                }
                
                // Store results for this file (merge with existing)
                if (fileResults.length > 0) {
                  setOcrResultsByFile(prev => ({
                    ...prev,
                    [filename]: fileResults
                  }));
                }
                
                totalProcessed++;
              }
              
              if (!ocrCancelRef.current) {
                setOcrProgress({ percent: 100, status: `Found ${totalItems} new text items` });
                setTimeout(() => setOcrProgress(null), 2000);
              } else {
                setTimeout(() => setOcrProgress(null), 1500);
              }
              
            } catch (error) {
              console.error('OCR error:', error);
              setOcrProgress({ percent: 0, status: `Error: ${error.message}` });
              setTimeout(() => setOcrProgress(null), 3000);
            } finally {
              setIsRunningOcr(false);
              ocrCancelRef.current = false;
            }
          }}
          onCancelOcr={() => {
            ocrCancelRef.current = true;
            setOcrProgress({ percent: ocrProgress?.percent || 0, status: 'Cancelling...' });
          }}
          onExportOcr={() => {
            if (ocrResults.length === 0) return;
            
            // Export as CSV
            const headers = ['Text', 'Confidence', 'Page', 'X', 'Y', 'Width', 'Height'];
            const rows = ocrResults.map(r => [
              r.text,
              r.confidence,
              r.page,
              r.bbox.x,
              r.bbox.y,
              r.bbox.width,
              r.bbox.height
            ]);
            
            const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ocr_results_${currentFile?.name || 'page'}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          existingClasses={(project?.classes || []).filter(c => !c.parentId)}
          onExportToObjects={async ({ className, isNewClass, items }) => {
            if (!currentFile?.backendFilename || items.length === 0) return;
            
            try {
              // Create objects from OCR items - use extractedText if available
              const timestamp = Date.now();
              const newObjects = items.map((item, idx) => ({
                id: `ocr_${timestamp}_${idx}`,
                label: className,
                className: className,
                ocr_text: item.extractedText || item.text, // Use extracted portion
                bbox: item.bbox,
                page: item.page - 1, // Convert to 0-indexed
                filename: currentFile.backendFilename,
                confidence: item.confidence,
                orientation: item.orientation || 'horizontal',
                source: 'ocr'
              }));
              
              // Add new class if needed
              if (isNewClass && project) {
                const newClass = {
                  id: `class_${timestamp}`,
                  name: className,
                  color: `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`
                };
                const updatedProject = {
                  ...project,
                  classes: [...(project.classes || []), newClass]
                };
                onProjectUpdate(updatedProject);
              }
              
              // Add to detected objects
              const existingObjects = detectedObjects || [];
              const updatedObjects = [...existingObjects, ...newObjects];
              setDetectedObjects(updatedObjects);
              
              // Save to backend
              await saveObjectsToBackend(projectId, updatedObjects);
              
              console.log(`Exported ${newObjects.length} OCR items as objects in class "${className}"`);
              
            } catch (error) {
              console.error('Error exporting OCR to objects:', error);
            }
          }}
          allFiles={allFiles}
          ocrResultsByFile={ocrResultsByFile}
          onExportToLinks={({ items, assignMode, propertyName }) => {
            if (!items || items.length === 0 || !project) return;
            
            try {
              const timestamp = Date.now();
              
              // Group items by source file (backendFilename)
              const itemsByFile = {};
              items.forEach(item => {
                const fn = item.sourceFilename || currentFile?.backendFilename;
                if (!fn) return;
                if (!itemsByFile[fn]) itemsByFile[fn] = [];
                itemsByFile[fn].push(item);
              });
              
              // Build new hotspots per file, merging with existing
              const updatedHotspots = { ...(project.hotspots || {}) };
              let totalCreated = 0;
              let totalMatched = 0;
              
              for (const [backendFilename, fileItems] of Object.entries(itemsByFile)) {
                // Find the file object by backendFilename
                const file = allFiles.find(f => f.backendFilename === backendFilename);
                if (!file) continue;
                
                const existingFileHotspots = updatedHotspots[file.id] || [];
                const newHotspots = [];
                
                fileItems.forEach((item, idx) => {
                  const ocrText = item.extractedText || item.text;
                  let targetFileId = null;
                  let targetFilename = null;
                  
                  if (assignMode === 'name') {
                    const matchingFile = allFiles.find(f =>
                      f.name?.toLowerCase().includes(ocrText.toLowerCase()) ||
                      f.backendFilename?.toLowerCase().includes(ocrText.toLowerCase())
                    );
                    if (matchingFile) {
                      targetFileId = matchingFile.id;
                      targetFilename = matchingFile.name;
                      totalMatched++;
                    }
                  } else if (assignMode === 'property' && propertyName) {
                    const matchingFile = allFiles.find(f => {
                      const pv = f.extractedProperties?.[propertyName];
                      if (!pv) return false;
                      return pv.toLowerCase().includes(ocrText.toLowerCase()) ||
                             ocrText.toLowerCase().includes(pv.toLowerCase());
                    });
                    if (matchingFile) {
                      targetFileId = matchingFile.id;
                      targetFilename = matchingFile.name;
                      totalMatched++;
                    }
                  }
                  
                  // Crop bbox to only the matched portion of text
                  let bboxX = item.bbox.x;
                  let bboxY = item.bbox.y;
                  let bboxW = item.bbox.width;
                  let bboxH = item.bbox.height;
                  
                  const fullTextLen = (item.text || '').length;
                  const isVertical = item.orientation && item.orientation !== 'horizontal';
                  
                  if (item.matchStart !== undefined && fullTextLen > 0 && ocrText !== item.text) {
                    const startFrac = item.matchStart / fullTextLen;
                    const lenFrac = item.matchLength / fullTextLen;
                    
                    if (isVertical) {
                      // Vertical text: crop along Y axis
                      bboxY = item.bbox.y + startFrac * item.bbox.height;
                      bboxH = lenFrac * item.bbox.height;
                    } else {
                      // Horizontal text: crop along X axis
                      bboxX = item.bbox.x + startFrac * item.bbox.width;
                      bboxW = lenFrac * item.bbox.width;
                    }
                  }
                  
                  newHotspots.push({
                    id: `ocr_link_${timestamp}_${totalCreated + idx}`,
                    x: bboxX,
                    y: bboxY,
                    width: bboxW,
                    height: bboxH,
                    targetFileId,
                    targetFilename,
                    label: ocrText,
                    confidence: item.confidence || 0,
                    ocrConfidence: 'high',
                    formatScore: 1,
                    sourceFilename: file.name,
                    page: item.page - 1, // OCR results are 1-indexed, hotspots are 0-indexed
                    assignmentMode: assignMode === 'property' ? 'property' : 'link',
                    propertyName: assignMode === 'property' ? propertyName : undefined,
                    source: 'ocr_export',
                  });
                });
                
                updatedHotspots[file.id] = [...existingFileHotspots, ...newHotspots];
                totalCreated += newHotspots.length;
              }
              
              // Save all hotspots
              const updatedProject = { ...project, hotspots: updatedHotspots };
              onProjectUpdate(updatedProject);
              
              // Update local hotspot state if current file was affected
              if (currentFile && updatedHotspots[currentFile.id]) {
                setHotspots(updatedHotspots[currentFile.id]);
              }
              
              alert(`Created ${totalCreated} links from OCR text.\n${totalMatched} matched to target files.\n${totalCreated - totalMatched} unassigned (can be assigned manually).`);
              console.log(`OCR → Links: ${totalCreated} created, ${totalMatched} matched`);
              
            } catch (error) {
              console.error('Error exporting OCR to links:', error);
              alert('Failed to export links: ' + error.message);
            }
          }}
        />

        {/* Object Finder Panel */}
        {showObjectFinder && (
          <div className="smart-links-panel">
            <div className="panel-header">
              <h3>Objects</h3>
              <button className="close-panel" onClick={() => { setShowObjectFinder(false); setObjectFinderMode(null); setShowDrawTypePopup(false); }}>×</button>
            </div>
            <div className="panel-content">
              {/* Pages Navigation Links */}
              <div className="panel-section-label">Pages</div>
              <div className="panel-nav-links">
                <button
                  className="nav-link-btn"
                  onClick={() => navigate(`/project/${projectId}/models`, {
                    state: { returnToFile: currentFile ? { id: currentFile.id, backendFilename: currentFile.backendFilename } : null }
                  })}
                >
                  Models
                </button>
                <button
                  className="nav-link-btn"
                  onClick={() => navigate(`/project/${projectId}/classes`, {
                    state: { returnToFile: currentFile ? { id: currentFile.id, backendFilename: currentFile.backendFilename } : null }
                  })}
                >
                  Classes
                </button>
                <button
                  className="nav-link-btn"
                  onClick={() => navigate(`/project/${projectId}/regions`, {
                    state: { returnToFile: currentFile ? { id: currentFile.id, backendFilename: currentFile.backendFilename } : null }
                  })}
                >
                  Regions
                </button>
              </div>

              <div className="panel-section-label">Actions</div>
              <div className="panel-section">
                <div className="mode-buttons">
                  <button
                    className={objectFinderMode === 'create' ? 'active' : ''}
                    onClick={() => { 
                      if (objectFinderMode === 'create') {
                        setObjectFinderMode(null);
                        setShowDrawTypePopup(false);
                      } else {
                        setShowDrawTypePopup(true);
                      }
                    }}
                  >
                    Assign Object / Region
                  </button>
                </div>
                
                {/* Type Selection Popup */}
                {(showDrawTypePopup || objectFinderMode) && (
                  <div className="draw-type-popup">
                    <p className="popup-label">Select Type</p>
                    <div className="draw-type-buttons">
                      <button
                        className={`draw-type-btn ${objectDrawType === 'object' && objectFinderMode ? 'selected' : ''}`}
                        onClick={() => {
                          setObjectDrawType('object');
                          setObjectFinderMode('create');
                          setShowDrawTypePopup(false);
                          setLinkMode(null);
                          setPanMode(false); 
                          setZoomMode(false);
                          setSelectMode(false);
                          setPolylinePoints([]);
                          setPolylineMousePos(null);
                          setIsNearStartPoint(false);
                          setPendingShape(null);
                        }}
                      >
                        <span className="type-icon type-icon-object"></span>
                        <span className="type-name">Object</span>
                        <span className="type-desc">Draw & tag items</span>
                      </button>
                      <button
                        className={`draw-type-btn ${objectDrawType === 'region' && objectFinderMode ? 'selected' : ''}`}
                        onClick={() => {
                          setObjectDrawType('region');
                          setObjectFinderMode('create');
                          setShowDrawTypePopup(false);
                          setLinkMode(null);
                          setPanMode(false); 
                          setZoomMode(false);
                          setSelectMode(false);
                          setPolylinePoints([]);
                          setPolylineMousePos(null);
                          setIsNearStartPoint(false);
                          setPendingShape(null);
                        }}
                      >
                        <span className="type-icon type-icon-region"></span>
                        <span className="type-name">Region</span>
                        <span className="type-desc">Define areas</span>
                      </button>
                    </div>
                    {!objectFinderMode && (
                      <button 
                        className="popup-cancel-btn"
                        onClick={() => setShowDrawTypePopup(false)}
                      >
                        Cancel
                      </button>
                    )}
                    {objectFinderMode && (
                      <>
                        <div className="shape-selector">
                          <span className="shape-label">Shape:</span>
                          <button 
                            className={`shape-btn ${drawingShapeType === 'rectangle' ? 'active' : ''}`}
                            onClick={() => { setDrawingShapeType('rectangle'); setPolylinePoints([]); setPolylineMousePos(null); setIsNearStartPoint(false); }}
                            title="Rectangle"
                          >
                            ▢
                          </button>
                          <button 
                            className={`shape-btn ${drawingShapeType === 'circle' ? 'active' : ''}`}
                            onClick={() => { setDrawingShapeType('circle'); setPolylinePoints([]); setPolylineMousePos(null); setIsNearStartPoint(false); }}
                            title="Circle"
                          >
                            ○
                          </button>
                          <button 
                            className={`shape-btn ${drawingShapeType === 'polyline' ? 'active' : ''}`}
                            onClick={() => { setDrawingShapeType('polyline'); setPolylinePoints([]); setPolylineMousePos(null); setIsNearStartPoint(false); }}
                            title="Polyline (hold Shift to snap)"
                          >
                            ⬡
                          </button>
                          {drawingShapeType === 'polyline' && polylinePoints.length > 0 && (
                            <button 
                              className="shape-btn clear-points"
                              onClick={() => { setPolylinePoints([]); setPolylineMousePos(null); setIsNearStartPoint(false); }}
                              title="Clear points"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        <p className="mode-hint">
                          {drawingShapeType === 'rectangle' && 'Click and drag to draw a rectangle'}
                          {drawingShapeType === 'circle' && 'Click and drag to draw a circle'}
                          {drawingShapeType === 'polyline' && polylinePoints.length === 0 && 'Click to add points, hold Shift to snap'}
                          {drawingShapeType === 'polyline' && polylinePoints.length > 0 && polylinePoints.length < 3 && `${polylinePoints.length} point${polylinePoints.length > 1 ? 's' : ''} - need ${3 - polylinePoints.length} more to close`}
                          {drawingShapeType === 'polyline' && polylinePoints.length >= 3 && `${polylinePoints.length} points - click near green start point to close`}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {objectFinderMode === 'train' && (
                <div className="panel-section">
                  <h4>Training ({objectTrainingBoxes.length} examples)</h4>
                  
                  {objectTrainingBoxes.length > 0 && (
                    <>
                      <div className="training-summary">
                        {Object.entries(
                          objectTrainingBoxes.reduce((acc, box) => {
                            acc[box.className] = (acc[box.className] || 0) + 1;
                            return acc;
                          }, {})
                        ).map(([cls, count]) => (
                          <span key={cls} className="class-count">{cls}: {count}</span>
                        ))}
                      </div>
                      <button className="clear-btn" onClick={() => setObjectTrainingBoxes([])}>
                        Clear Examples
                      </button>
                    </>
                  )}
                  <button
                    className="primary-btn"
                    onClick={() => {
                      // Get class names for default title
                      const classNames = [...new Set(objectTrainingBoxes.map(b => b.parentClass || b.className))];
                      setTrainingModelTitle(classNames.join(', '));
                      setAddToExistingModel(null);
                      setShowTrainingOptions(true);
                    }}
                    disabled={objectTrainingBoxes.length === 0 || isObjectTraining}
                  >
                    {isObjectTraining ? 'Training...' : `Train Model (${objectTrainingBoxes.length})`}
                  </button>
                </div>
              )}

              <div className="panel-section">
                <h4>Models ({objectModels.length})</h4>
                {objectModels.length === 0 ? (
                  <p className="no-models">No models trained yet</p>
                ) : (
                  <>
                    <input
                      type="text"
                      className="model-search-input"
                      placeholder="Search models..."
                      value={objectModelSearch}
                      onChange={(e) => setObjectModelSearch(e.target.value)}
                    />
                    <div className="models-list scrollable" style={{ maxHeight: 200, overflowY: 'auto' }}>
                      {objectModels
                        .filter(model =>
                          model.className.toLowerCase().includes(objectModelSearch.toLowerCase())
                        )
                        .map(model => (
                          <div key={model.id} className="model-item">
                            <label className="model-checkbox">
                              <input
                                type="checkbox"
                                checked={selectedObjectModels.includes(model.id)}
                                onChange={() => toggleObjectModelSelection(model.id)}
                              />
                              <span>{model.className}</span>
                            </label>
                            <span className="model-info">{model.numTemplates} templates</span>
                          </div>
                        ))}
                      {objectModels.filter(model =>
                        model.className.toLowerCase().includes(objectModelSearch.toLowerCase())
                      ).length === 0 && (
                        <p className="no-results">No models match "{objectModelSearch}"</p>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Selected Models Summary */}
              {selectedObjectModels.length > 0 && (
                <div className="selected-models-summary">
                  Selected: {selectedObjectModels.map(id => objectModels.find(m => m.id === id)?.className).filter(Boolean).join(', ')}
                </div>
              )}

              <div className="panel-section">
                <h4>Detect Objects</h4>
                <div className="option-group">
                  <label>Scope:</label>
                  <select 
                    value={objectDetectionScope} 
                    onChange={(e) => setObjectDetectionScope(e.target.value)}
                  >
                    <option value="current">{currentFile?.name || 'Current Document'}</option>
                    <option value="folder">
                      {currentFolderInfo.folder?.name || 'Current Folder'} ({currentFolderInfo.folderFileCount} files)
                    </option>
                    {currentFolderInfo.parent && (
                      <option value="parent">
                        {currentFolderInfo.parent.name} + subfolders ({currentFolderInfo.parentFileCount} files)
                      </option>
                    )}
                    <option value="all">All Documents in Project ({currentFolderInfo.totalFileCount} files)</option>
                  </select>
                </div>
                
                {/* Page scope selector - only show for multi-page documents when scope is current PDF */}
                {objectDetectionScope === 'current' && numPages > 1 && (
                  <div className="option-group">
                    <label>Pages:</label>
                    <select 
                      value={objectDetectionPageScope} 
                      onChange={(e) => setObjectDetectionPageScope(e.target.value)}
                    >
                      <option value="current">Current Page ({currentPage})</option>
                      <option value="all">All Pages (1-{numPages})</option>
                    </select>
                  </div>
                )}

                <button
                  className="primary-btn find-links-btn"
                  onClick={() => {
                    // Initialize settings for each selected model/class
                    const initialSettings = {};
                    selectedObjectModels.forEach(modelId => {
                      const model = objectModels.find(m => m.id === modelId);
                      if (model) {
                        // Look up subclasses from project class hierarchy
                        const parentClass = getClassByName(model.className);
                        const projectSubclasses = parentClass ? getSubclassesOf(parentClass.id) : [];
                        const subclassNames = projectSubclasses.map(sc => sc.name);
                        
                        // Also check model's stored subclassRegions as fallback source
                        const classSubclassRegions = model.subclassRegions?.[model.className] || null;
                        
                        // Merge subclass names from both sources (project hierarchy + model regions)
                        const allSubclassNames = [...new Set([
                          ...subclassNames,
                          ...(classSubclassRegions ? Object.keys(classSubclassRegions) : [])
                        ])];
                        
                        console.log(`Model ${model.className}: projectSubclasses =`, subclassNames, 'modelRegions =', classSubclassRegions ? Object.keys(classSubclassRegions) : 'none');
                        
                        // Build subclass formats from all known subclasses
                        // Priority: previous user entry > model's saved subclassOcrFormats > empty
                        const subclassFormats = {};
                        allSubclassNames.forEach(subclassName => {
                          subclassFormats[subclassName] = classDetectionSettings[modelId]?.subclassFormats?.[subclassName] 
                            || model.subclassOcrFormats?.[subclassName] 
                            || '';
                        });
                        
                        // Use model's recommended confidence if available - prefer recommended over previous user value
                        const defaultConfidence = model.recommendedConfidence || classDetectionSettings[modelId]?.confidence || 0.65;
                        // Use model's recommended OCR format if available - prefer recommended over previous user value
                        const defaultOcrFormat = model.recommendedOcrFormat || classDetectionSettings[modelId]?.ocrFormat || '';
                        
                        initialSettings[modelId] = {
                          confidence: defaultConfidence,
                          enableOCR: classDetectionSettings[modelId]?.enableOCR ?? true,
                          ocrFormat: defaultOcrFormat,
                          subclassNames: allSubclassNames,  // All subclass names for this class
                          subclassFormats: subclassFormats,
                          subclassRegions: classSubclassRegions,
                          className: model.className,
                          recommendedConfidence: model.recommendedConfidence || null,
                          recommendedOcrFormat: model.recommendedOcrFormat || null,
                          recommendedOcrPattern: model.recommendedOcrPattern || null,
                          recommendedSubclassOcrFormats: model.subclassOcrFormats || null,
                          recommendedSubclassOcrPatterns: model.subclassOcrPatterns || null,
                        };
                        console.log(`Settings for ${model.className}:`, initialSettings[modelId]);
                      }
                    });
                    setClassDetectionSettings(initialSettings);
                    setShowDetectionSettings(true);
                  }}
                  disabled={selectedObjectModels.length === 0 || isObjectDetecting}
                >
                  {isObjectDetecting ? 'Detecting...' : 'Detect Objects'}
                </button>
                
                {/* Detection Progress Bar */}
                {(isObjectDetecting || detectionProgress.phase) && (
                  <div className="detection-progress" style={{ marginTop: 12 }}>
                    <div className="progress-bar-container" style={{
                      background: '#e0e0e0',
                      borderRadius: 4,
                      height: 8,
                      overflow: 'hidden',
                      marginBottom: 6
                    }}>
                      <div className="progress-bar-fill" style={{
                        background: detectionProgress.phase === 'complete' ? '#27ae60' : '#3498db',
                        height: '100%',
                        width: `${detectionDisplayPercent}%`,
                        transition: 'background 0.3s ease'
                      }} />
                    </div>
                    <div className="progress-status" style={{ fontSize: 11, color: '#666' }}>
                      {detectionProgress.phase === 'detecting' && (
                        <>
                          <div style={{ fontWeight: 500 }}>Detecting Objects...</div>
                          {detectionProgress.totalFiles > 1 && (
                            <div style={{ marginTop: 2 }}>
                              File {detectionProgress.currentFileIndex} of {detectionProgress.totalFiles}: {detectionProgress.currentFile}
                            </div>
                          )}
                        </>
                      )}
                      {detectionProgress.phase === 'extracting' && (
                        <div style={{ fontWeight: 500 }}>Extracting Object Data...</div>
                      )}
                      {detectionProgress.phase === 'ocr-scan' && (
                        <>
                          <div style={{ fontWeight: 500 }}>OCR Scanning for Text Objects...</div>
                          {detectionProgress.totalFiles > 1 && (
                            <div style={{ marginTop: 2 }}>
                              File {detectionProgress.currentFileIndex} of {detectionProgress.totalFiles}: {detectionProgress.currentFile}
                            </div>
                          )}
                          {detectionProgress.detail && (
                            <div style={{ marginTop: 2, fontSize: 10, color: '#888' }}>{detectionProgress.detail}</div>
                          )}
                        </>
                      )}
                      {detectionProgress.phase === 'saving' && (
                        <div style={{ fontWeight: 500 }}>Saving...</div>
                      )}
                      {detectionProgress.phase === 'complete' && (
                        <div style={{ fontWeight: 500, color: '#27ae60' }}>Complete!</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

        {/* Search Panel */}
        <SearchPanel
          isOpen={showSearchPanel}
          onClose={() => setShowSearchPanel(false)}
          searchQuery={globalSearchQuery}
          onSearchQueryChange={setGlobalSearchQuery}
          searchScope={searchScope}
          onSearchScopeChange={setSearchScope}
          searchPageScope={searchPageScope}
          onSearchPageScopeChange={setSearchPageScope}
          debouncedSearchQuery={debouncedSearchQuery}
          filteredSearchResults={filteredSearchResults}
          onNavigateToObject={navigateToObject}
          // OCR integration
          ocrResultsByFile={ocrResultsByFile}
          includeOcrInSearch={includeOcrInSearch}
          onIncludeOcrInSearchChange={setIncludeOcrInSearch}
          onNavigateToOcrResult={(ocrItem) => {
            // Navigate to the file and page containing the OCR result
            if (ocrItem.filename) {
              // Find file in project
              const findFile = (folders) => {
                for (const folder of folders) {
                  const found = folder.files?.find(f => f.backendFilename === ocrItem.filename);
                  if (found) return found;
                  if (folder.subfolders) {
                    const sub = findFile(folder.subfolders);
                    if (sub) return sub;
                  }
                }
                return null;
              };
              
              const file = project?.folders ? findFile(project.folders) : null;
              if (file && file.backendFilename !== currentFile?.backendFilename) {
                // Navigate to different file
                setCurrentPage(ocrItem.page || 1);
                onFileSelect(file);
              } else {
                // Same file, just navigate to page
                setCurrentPage(ocrItem.page || 1);
              }
            }
          }}
          // Context info
          currentFile={currentFile}
          currentFolderInfo={currentFolderInfo}
          currentFolderFiles={currentFolderFiles}
          detectedObjects={detectedObjects}
          numPages={numPages}
          currentPage={currentPage}
        />

        {/* View Mode Panel */}
        <ViewPanel
          isOpen={showViewPanel}
          onClose={() => setShowViewPanel(false)}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          numPages={numPages}
          currentFile={currentFile}
          currentPage={currentPage}
          onOpenInfiniteView={onOpenInfiniteView}
          pdfBackgroundColor={pdfBackgroundColor}
          onBackgroundColorChange={setPdfBackgroundColor}
          showMarkupToolbar={showMarkupToolbar}
          onShowMarkupToolbarChange={setShowMarkupToolbar}
          hideLabels={hideLabels}
          onHideLabelsChange={setHideLabels}
          onOpenZoomSettings={() => setShowZoomSettingsDialog(true)}
          showLinksOnPdf={showLinksOnPdf}
          onShowLinksOnPdfChange={setShowLinksOnPdf}
          showRegionBoxes={showRegionBoxes}
          onShowRegionBoxesChange={setShowRegionBoxes}
          hiddenClasses={hiddenClasses}
          onHiddenClassesChange={setHiddenClasses}
          uniqueObjectClasses={uniqueObjectClasses}
        />

        {/* Properties Panel */}
        <PropertiesPanel
          isOpen={showPropertiesPanel}
          onClose={() => setShowPropertiesPanel(false)}
          currentFile={currentFile}
          onNavigateToDocProps={() => {
            setShowPropertiesPanel(false);
            navigate(`/project/${projectId}/docprops`, { 
              state: { returnToFile: currentFile ? { id: currentFile.id, backendFilename: currentFile.backendFilename } : null } 
            });
          }}
        />

        {/* Symbols Panel */}
        <SymbolsPanel
          isOpen={showMarkupsPanel}
          onClose={() => { setShowMarkupsPanel(false); setSymbolCreationMode(false); setSymbolCaptureMode(false); setCaptureRegion(null); }}
          symbolCreationMode={symbolCreationMode}
          onSetSymbolCreationMode={setSymbolCreationMode}
          selectedMarkups={selectedMarkups}
          selectedMarkup={selectedMarkup}
          onClearSelections={() => {
            setSelectedMarkups([]);
            selectedMarkupsRef.current = [];
            setSelectedMarkup(null);
          }}
          onOpenSaveDialog={(category) => { setSymbolSaveCategory(category || 'symbol'); setShowSaveSymbolDialog(true); }}
          markupEditMode={markupEditMode}
          onEnterCreationMode={() => {
            setSymbolCreationMode(true);
            setSelectMode(true);
            setPanMode(false);
            setZoomMode(false);
            setMarkupMode(null);
            setSelectedMarkups([]);
            selectedMarkupsRef.current = [];
            setSelectedMarkup(null);
          }}
          // Capture mode props
          captureMode={symbolCaptureMode}
          onSetCaptureMode={(mode) => {
            setSymbolCaptureMode(mode);
            if (mode) {
              setSelectMode(false);
              setPanMode(false);
              setZoomMode(false);
              setMarkupMode(null);
              setSymbolCreationMode(false);
            }
          }}
          selectedRegion={captureRegion}
          onClearRegion={() => setCaptureRegion(null)}
          pdfDoc={pdfDoc}
          currentPage={currentPage}
          // Symbols list
          savedSymbols={savedSymbols}
          setSavedSymbols={setSavedSymbols}
          symbolSearchQuery={symbolSearchQuery}
          onSearchQueryChange={setSymbolSearchQuery}
          symbolsViewMode={symbolsViewMode}
          onViewModeChange={setSymbolsViewMode}
          onDeleteSymbol={deleteSymbol}
          onDragStart={setDraggingSymbol}
          onDragEnd={() => setDraggingSymbol(null)}
          canvasSize={canvasSize}
          scale={scale}
          defaultSignatureId={defaultSignatureId}
          onSetDefaultSignature={setDefaultSignatureId}
          panelWidth={symbolsPanelWidth}
          onPanelWidthChange={setSymbolsPanelWidth}
          onStartPlacement={(placement) => {
            setPendingPlacement(placement);
            // Deselect any current markup/selection
            setSelectedMarkup(null);
            selectedMarkupRef.current = null;
            setSelectedMarkups([]);
            selectedMarkupsRef.current = [];
            // Exit any other mode
            setSelectMode(false);
            setPanMode(false);
            setZoomMode(false);
            setMarkupMode(null);
          }}
        />
        
        <MarkupHistoryPanel
          isOpen={showMarkupHistoryPanel}
          onClose={() => setShowMarkupHistoryPanel(false)}
          markups={markups}
          currentPage={currentPage}
          numPages={numPages}
          onSelectMarkup={(m) => setSelectedMarkup(m)}
          onDeleteMarkup={(m) => deleteMarkupFull([m])}
          onDumpAnnotations={pdfDoc ? async () => {
            try {
              console.log('📋 Starting annotation dump...', { pdfDoc: !!pdfDoc, currentFile: currentFile?.name, pdfUrl: !!pdfUrl });
              await dumpAllAnnotationData({ pdfDoc, currentFile, pdfUrl, download: true });
            } catch (err) {
              console.error('Annotation dump failed:', err);
              alert('Failed to export annotation data: ' + err.message);
            }
          } : null}
        />
        
        {/* Crosshairs overlay - always mounted, positioned via refs for zero re-renders */}
        {zoomSettings.showCrosshairs && (
          <>
            <div ref={crosshairHRef} className="pdfv-crosshair pdfv-crosshair-h" style={{
              position: 'fixed', display: 'none',
            }} />
            <div ref={crosshairVRef} className="pdfv-crosshair pdfv-crosshair-v" style={{
              position: 'fixed', display: 'none',
            }} />
          </>
        )}

        {/* Coordinates display - always mounted, positioned via ref */}
        {zoomSettings.showCoordinates && (
          <div ref={coordsRef} className="pdfv-coordinates" style={{
            position: 'fixed', display: 'none',
          }} />
        )}

        {/* Bottom Toolbar - positioned over pdf-container */}
        <BottomToolbar
          openPanelWidth={showMarkupsPanel ? symbolsPanelWidth : (showSmartLinks || showObjectFinder || showSearchPanel || showViewPanel || showMarkupHistoryPanel || showPropertiesPanel || showOcrPanel) ? 320 : 0}
          selectMode={selectMode}
          panMode={panMode}
          zoomMode={zoomMode}
          onSelectMode={() => { setSelectMode(true); setPanMode(false); setZoomMode(false); setLinkMode(null); setMarkupMode(null); }}
          onPanMode={() => { setSelectMode(false); setPanMode(true); setZoomMode(false); setLinkMode(null); setMarkupMode(null); }}
          onZoomMode={() => { setSelectMode(false); setPanMode(false); setZoomMode(true); setLinkMode(null); setMarkupMode(null); }}
          zoomInput={zoomInput}
          onZoomInputChange={setZoomInput}
          onZoomIn={() => zoomWithScrollAdjust(Math.min(20, scaleRef.current * 1.5))}
          onZoomOut={() => zoomWithScrollAdjust(Math.max(0.1, scaleRef.current / 1.5))}
          onApplyZoomInput={applyZoomInput}
          onRotate={() => setRotation(r => (r + 90) % 360)}
          currentPage={currentPage}
          numPages={numPages}
          pageInput={pageInput}
          onPageInputChange={setPageInput}
          onPageInputFocus={() => setPageInput(String(currentPage))}
          onPageInputBlur={() => {
            const val = parseInt(pageInput);
            if (!isNaN(val) && val >= 1 && val <= numPages) {
              setCurrentPage(val);
              if (isContinuousView(viewMode)) {
                // Pre-mount pages around target before scrolling
                const jumpVisible = new Set();
                for (let p = Math.max(1, val - CONTINUOUS_VIEW_BUFFER); p <= Math.min(numPages, val + CONTINUOUS_VIEW_BUFFER); p++) {
                  jumpVisible.add(p);
                }
                visiblePagesRef.current = jumpVisible;
                setVisiblePages(jumpVisible);
                setTimeout(() => scrollToPagePosition(val, 'smooth', 'center'), 50);
              }
            }
            setPageInput(null);
          }}
          onPageInputKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.target.blur();
            } else if (e.key === 'Escape') {
              setPageInput(null);
              e.target.blur();
            }
          }}
          onPreviousPage={handlePreviousPage}
          onNextPage={handleNextPage}
          allFiles={allFiles}
          currentFileIndex={currentFileIndex}
          onNavigateFile={onNavigateFile}
          currentFolderFileIndex={currentFolderFileIndex}
          currentFolderInfo={currentFolderInfo}
          viewMode={viewMode}
          containerRef={containerRef}
          onRefresh={() => {
            if (unsavedMarkupFiles.size > 0) {
              const proceed = window.confirm(
                'You have unsaved markup changes. Refreshing will discard them.\n\nDo you want to continue?'
              );
              if (!proceed) return;
            }
            onRefresh?.();
          }}
        />
      </div>

      {/* Sticky Note Dialog */}
      <NoteDialog
        isOpen={showNoteDialog}
        onClose={() => {
          setShowNoteDialog(false);
          setNoteText('');
          setEditingNoteId(null);
        }}
        editingNoteId={editingNoteId}
        noteText={noteText}
        onNoteTextChange={setNoteText}
        markupColor={markupColor}
        onColorChange={setMarkupColor}
        markupAuthor={markupAuthor}
        onAuthorChange={setMarkupAuthor}
        onSave={saveStickyNote}
      />

      {/* Save Symbol Dialog */}
      <SaveSymbolDialog
        isOpen={showSaveSymbolDialog}
        onClose={() => {
          setShowSaveSymbolDialog(false);
          setSymbolNameInput('');
        }}
        selectedMarkups={selectedMarkups}
        selectedMarkup={selectedMarkup}
        category={symbolSaveCategory}
        existingGroups={[...new Set(savedSymbols.filter(s => (s.category || 'symbol') === symbolSaveCategory && s.group).map(s => s.group))]}
        onSave={(name, group) => saveAsSymbol(name, group)}
      />

      {/* Assign Dialog */}
      <AssignDialog
        isOpen={showAssignDialog}
        onClose={() => {
          setShowAssignDialog(false);
          setPendingHotspot(null);
        }}
        pendingHotspot={pendingHotspot}
        allFiles={allFiles}
        currentFileId={currentFile?.id}
        onAssign={(fileId, fileName) => {
          handleAssignPdf(fileId, fileName);
        }}
      />

      {/* Object Class Dialog */}
      <ObjectClassDialog
        isOpen={showObjectClassDialog}
        onClose={() => {
          setShowObjectClassDialog(false);
          setPendingObjectBox(null);
          setOcrTestResult(null);
          setObjectClassInput('');
          setObjectTagInput('');
          setObjectDescInput('');
        }}
        mode={objectFinderMode}
        pendingBox={pendingObjectBox}
        classes={project?.classes}
        classColumns={project?.classColumns}
        currentFileIdentifier={currentFileIdentifier}
        onAddTrainingBox={(newObject) => {
          setObjectTrainingBoxes(prev => [...prev, newObject]);
        }}
        onCreateObject={(newObject, openEditDialog) => {
          // Add to detected objects
          setDetectedObjects(prev => [...prev, newObject]);
          
          if (openEditDialog) {
            // Capture image and open edit dialog
            setTimeout(() => {
              const imageData = captureObjectImage(newObject);
              setObjectImagePreview(imageData);
              setSelectedObject({ ...newObject, index: -1 });
              setShowObjectEditDialog(true);
            }, 50);
          }
        }}
        onOpenSubclassRegionDialog={(parentBoxData) => {
          // Capture the cropped image of the parent box - NO PADDING for accurate coordinates
          const boxForCapture = {
            bbox: {
              x: parentBoxData.x,
              y: parentBoxData.y,
              width: parentBoxData.width,
              height: parentBoxData.height
            }
          };
          const croppedImage = captureObjectImageNoPadding(boxForCapture);
          setParentBoxImage(croppedImage);
          
          // Store the parent box and prompt for subclass region
          setPendingParentBox(parentBoxData);
          setShowSubclassRegionDialog(true);
          setIsDrawingSubclassRegion(false);
          setSubclassRegions({});
          setCurrentSubclassIndex(0);
          setSubclassCurrentRect(null);
          setSubclassImageZoom(1.0);
        }}
        captureObjectImage={captureObjectImage}
      />

      {/* Markup Context Menu */}
      <MarkupContextMenu
        isOpen={showMarkupContextMenu && !!markupContextMenuTarget}
        position={markupContextMenuPos}
        markup={markupContextMenuTarget}
        onClose={() => {
          setShowMarkupContextMenu(false);
          setMarkupContextMenuTarget(null);
        }}
        onAddToStamps={() => {
          if (markupContextMenuTarget) {
            // Select the right-clicked markup so SaveSymbolDialog picks it up
            setSelectedMarkup(markupContextMenuTarget);
            selectedMarkupRef.current = markupContextMenuTarget;
            setSelectedMarkups([markupContextMenuTarget]);
            selectedMarkupsRef.current = [markupContextMenuTarget];
            // Open save dialog in stamp mode
            setSymbolSaveCategory('stamp');
            setShowSaveSymbolDialog(true);
          }
          setShowMarkupContextMenu(false);
          setMarkupContextMenuTarget(null);
        }}
        onConvertToRegion={handleConvertToRegion}
        onFlatten={handleFlattenMarkup}
        onEdit={() => {
          if (markupContextMenuTarget) {
            // Select the markup so its properties show in the ToolOptionsBar for editing
            setSelectedMarkup(markupContextMenuTarget);
            selectedMarkupRef.current = markupContextMenuTarget;
            setSelectedMarkups([]);
            selectedMarkupsRef.current = [];
            // Switch to select mode so ToolOptionsBar shows properties
            setMarkupMode('select');
          }
          setShowMarkupContextMenu(false);
          setMarkupContextMenuTarget(null);
        }}
        onDelete={() => {
          if (markupContextMenuTarget) {
            deleteMarkupFull([markupContextMenuTarget]);
          }
        }}
      />

      {/* Region Assignment Dialog */}
      <RegionAssignDialog
        isOpen={showRegionAssignDialog && !!pendingRegionShape}
        onClose={() => {
          setShowRegionAssignDialog(false);
          setPendingRegionShape(null);
        }}
        pendingShape={pendingRegionShape}
        regionTypes={project?.regionTypes}
        existingRegions={drawnRegions}
        currentFile={currentFile}
        getSubRegionColors={getSubRegionColorsForDialog}
        onNavigateToRegions={() => {
          navigate(`/project/${projectId}/regions`, { 
            state: { returnToFile: currentFile ? { id: currentFile.id, backendFilename: currentFile.backendFilename } : null } 
          });
        }}
        onSave={async (newRegion, colors) => {
          const trimmedName = newRegion.subRegionName;
          
          // Check if this sub-region already exists
          const existingRegionsWithName = drawnRegions.filter(
            r => r.subRegionName === trimmedName && r.regionType === newRegion.regionType
          );
          
          // Update existing regions with same name if colors changed
          let updatedRegions;
          if (existingRegionsWithName.length > 0) {
            // Update all existing regions with this name to have the new colors
            updatedRegions = drawnRegions.map(r => {
              if (r.subRegionName === trimmedName && r.regionType === newRegion.regionType) {
                return { ...r, fillColor: colors.fillColor, borderColor: colors.borderColor };
              }
              return r;
            });
            // Add the new region
            updatedRegions = [...updatedRegions, newRegion];
          } else {
            // Just add the new region
            updatedRegions = [...drawnRegions, newRegion];
          }
          
          setDrawnRegions(updatedRegions);
          
          // Save to backend
          try {
            await saveRegionsToBackend(projectId, updatedRegions);
            console.log('Region saved successfully');
          } catch (error) {
            console.error('Failed to save region:', error);
          }
          
          // Close dialog and reset
          setShowRegionAssignDialog(false);
          setPendingRegionShape(null);
          setRegionTypeInput('');
          setSubRegionNameInput('');
          setRegionFillColorInput('#3498db');
          setRegionBorderColorInput('#3498db');
        }}
      />

      {/* Region Edit Dialog */}
      <RegionEditDialog
        isOpen={showRegionEditDialog && !!editingRegion}
        onClose={() => {
          setShowRegionEditDialog(false);
          setEditingRegion(null);
        }}
        region={editingRegion}
        onSave={async (regionId, newName) => {
          // Update this region's name
          const updatedRegions = drawnRegions.map(r => {
            if (r.id === regionId) {
              return { ...r, subRegionName: newName };
            }
            return r;
          });
          
          setDrawnRegions(updatedRegions);
          
          try {
            await saveRegionsToBackend(projectId, updatedRegions);
            console.log('Region updated successfully');
          } catch (error) {
            console.error('Failed to update region:', error);
          }
          
          setShowRegionEditDialog(false);
          setEditingRegion(null);
        }}
        onDelete={async (regionId) => {
          const updatedRegions = drawnRegions.filter(r => r.id !== regionId);
          setDrawnRegions(updatedRegions);
          
          try {
            await saveRegionsToBackend(projectId, updatedRegions);
            console.log('Region deleted successfully');
          } catch (error) {
            console.error('Failed to delete region:', error);
          }
          
          setShowRegionEditDialog(false);
          setEditingRegion(null);
        }}
      />

      {/* Object Edit Dialog */}
      {showObjectEditDialog && selectedObject && (
        <div className="modal-overlay" onClick={() => { setShowObjectEditDialog(false); setSelectedObject(null); setObjectImagePreview(null); }}>
          <div className="modal object-edit-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Object Details</h2>
            
            {/* Object Image Preview */}
            {objectImagePreview && (
              <div className="object-image-preview">
                <img src={objectImagePreview} alt="Object preview" />
              </div>
            )}
            
            <div className="object-details">
              <div className="detail-row">
                <label>Class:</label>
                <select
                  value={selectedObject.label || ''}
                  onChange={(e) => setSelectedObject({ ...selectedObject, label: e.target.value, className: e.target.value })}
                >
                  <option value="">-- Select a class --</option>
                  {(project?.classes || []).filter(c => !c.parentId).map(cls => (
                    <option key={cls.id || cls.name} value={cls.name}>
                      {cls.name}
                    </option>
                  ))}
                  {/* Keep current class as option if not in list */}
                  {selectedObject.label && !project?.classes?.find(c => c.name === selectedObject.label) && (
                    <option value={selectedObject.label}>{selectedObject.label}</option>
                  )}
                </select>
              </div>
              
              {/* Show different fields based on whether class has subclasses */}
              {(() => {
                const className = selectedObject.label || selectedObject.className;
                const parentClass = (project?.classes || []).find(c => c.name === className && !c.parentId);
                const subclasses = parentClass ? (project?.classes || []).filter(c => c.parentId === parentClass.id) : [];
                const hasSubclasses = subclasses.length > 0 || (selectedObject.subclassValues && Object.keys(selectedObject.subclassValues).length > 0);
                
                if (hasSubclasses) {
                  // Get all subclass names from class definition and from object's subclassValues
                  const subclassNames = new Set(subclasses.map(s => s.name));
                  if (selectedObject.subclassValues) {
                    Object.keys(selectedObject.subclassValues).forEach(k => subclassNames.add(k));
                  }
                  
                  return (
                    <>
                      <div className="custom-fields-divider">Subclass Fields</div>
                      {Array.from(subclassNames).map(subName => (
                        <div className="detail-row" key={subName}>
                          <label>{subName}:</label>
                          <input
                            type="text"
                            value={selectedObject.subclassValues?.[subName] || ''}
                            onChange={(e) => setSelectedObject({ 
                              ...selectedObject, 
                              subclassValues: {
                                ...(selectedObject.subclassValues || {}),
                                [subName]: e.target.value
                              }
                            })}
                          />
                        </div>
                      ))}
                    </>
                  );
                } else {
                  // No subclasses - show just Tag field
                  return (
                    <div className="detail-row">
                      <label>Tag:</label>
                      <input
                        type="text"
                        value={selectedObject.ocr_text || ''}
                        onChange={(e) => setSelectedObject({ ...selectedObject, ocr_text: e.target.value })}
                      />
                    </div>
                  );
                }
              })()}
              
              {/* Custom columns from project - per class */}
              {(() => {
                const className = selectedObject.label || selectedObject.className;
                const classColumns = project?.classColumns?.[className] || [];
                if (classColumns.length === 0) return null;
                return (
                  <>
                    <div className="custom-fields-divider">Custom Fields</div>
                    {classColumns.map(col => (
                      <div className="detail-row" key={col.id}>
                        <label>{col.name}:</label>
                        <input
                          type="text"
                          value={selectedObject[col.id] || ''}
                          onChange={(e) => setSelectedObject({ ...selectedObject, [col.id]: e.target.value })}
                        />
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
            
            <div className="modal-actions">
              <button 
                className="delete-object-btn"
                onClick={async () => {
                  if (confirm('Are you sure you want to delete this object?')) {
                    const updatedObjects = detectedObjects.filter(obj => obj.id !== selectedObject.id);
                    setDetectedObjects(updatedObjects);
                    // Persist to backend
                    try {
                      await saveObjectsToBackend(projectId, updatedObjects);
                    } catch (err) {
                      console.error('Failed to save after delete:', err);
                    }
                    setShowObjectEditDialog(false);
                    setSelectedObject(null);
                  }
                }}
              >
                Delete
              </button>
              <button className="cancel-btn" onClick={() => { setShowObjectEditDialog(false); setSelectedObject(null); setObjectImagePreview(null); }}>Cancel</button>
              <button 
                className="primary-btn"
                onClick={async () => {
                  const updatedObjects = detectedObjects.map(obj => {
                    if (obj.id === selectedObject.id) {
                      // Copy all fields including custom columns and subclassValues
                      const updatedObj = {
                        ...obj,
                        label: selectedObject.label,
                        className: selectedObject.label,
                        ocr_text: selectedObject.ocr_text,
                        subclassValues: selectedObject.subclassValues,
                      };
                      // Add custom column values for this class
                      const classColumns = project?.classColumns?.[selectedObject.label] || [];
                      classColumns.forEach(col => {
                        updatedObj[col.id] = selectedObject[col.id] || '';
                      });
                      return updatedObj;
                    }
                    return obj;
                  });
                  
                  setDetectedObjects(updatedObjects);
                  
                  // Persist to backend
                  try {
                    await saveObjectsToBackend(projectId, updatedObjects);
                  } catch (err) {
                    console.error('Failed to save object changes:', err);
                  }
                  
                  setShowObjectEditDialog(false);
                  setSelectedObject(null);
                  setObjectImagePreview(null);
                }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detection Settings Popup */}
      {showDetectionSettings && (
        <div className="modal-overlay" onClick={() => setShowDetectionSettings(false)}>
          <div className="modal detection-settings-modal" onClick={(e) => e.stopPropagation()} style={{ background: '#2a2a2a', borderRadius: 10, padding: 24, color: '#fff', maxWidth: 540, width: '90%', maxHeight: '85vh', overflowY: 'auto' }}>
            <h2 style={{ margin: '0 0 4px 0', color: '#fff', fontWeight: 'bold', fontSize: 18 }}>Detection Settings</h2>
            <p style={{ color: '#888', fontSize: 13, margin: '0 0 16px 0' }}>Configure settings for each model</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(classDetectionSettings).map(([modelId, settings]) => {
                const format = settings.ocrFormat || '';
                const pattern = format ? format.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N') : '';
                const isExpanded = expandedDetectionModels[modelId] === true; // Default collapsed
                
                return (
                  <div key={modelId} style={{ 
                    background: '#333', 
                    borderRadius: 8,
                    border: '1px solid #444',
                    overflow: 'hidden'
                  }}>
                    {/* Collapsible header */}
                    <div 
                      onClick={() => setExpandedDetectionModels(prev => ({ ...prev, [modelId]: !isExpanded }))}
                      style={{ 
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                        padding: '12px 14px', cursor: 'pointer', userSelect: 'none',
                        background: isExpanded ? '#3a3a3a' : '#333'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, color: '#888', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                        <span style={{ fontWeight: 600, fontSize: 14, color: '#eee' }}>{settings.className}</span>
                      </div>
                    </div>
                    
                    {/* Expandable content */}
                    {isExpanded && (
                      <div style={{ padding: '12px 14px', borderTop: '1px solid #444' }}>
                        {/* Confidence slider */}
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontSize: 12, color: '#aaa' }}>Confidence</span>
                            <span style={{ fontSize: 13, color: '#eee', fontWeight: 500 }}>
                              {(settings.confidence * 100).toFixed(1)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0.2"
                            max="0.95"
                            step="0.025"
                            value={settings.confidence}
                            style={{ width: '100%', cursor: 'pointer', accentColor: '#5b9bd5' }}
                            onChange={(e) => {
                              setClassDetectionSettings(prev => ({
                                ...prev,
                                [modelId]: { ...prev[modelId], confidence: parseFloat(e.target.value) }
                              }));
                            }}
                          />
                          {settings.recommendedConfidence && (
                            <div style={{ 
                              display: 'flex', alignItems: 'center', gap: 6,
                              marginTop: 4, padding: '3px 8px',
                              background: 'rgba(39,174,96,0.15)', borderRadius: 4,
                              fontSize: 11, color: '#6fcf97'
                            }}>
                              <span>✓ Recommended: {(settings.recommendedConfidence * 100).toFixed(0)}%</span>
                              {Math.abs(settings.confidence - settings.recommendedConfidence) > 0.01 && (
                                <button
                                  onClick={() => {
                                    setClassDetectionSettings(prev => ({
                                      ...prev,
                                      [modelId]: { ...prev[modelId], confidence: settings.recommendedConfidence }
                                    }));
                                  }}
                                  style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 10, background: '#27ae60', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}
                                >
                                  Use
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        
                        {/* OCR Format section */}
                        <div style={{ opacity: settings.enableOCR ? 1 : 0.35 }}>
                          {settings.subclassNames && settings.subclassNames.length > 0 ? (
                            /* Subclass formats */
                            <div>
                              <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>Subclass Formats:</div>
                              {settings.subclassNames.map(subclassName => {
                                const subFormat = settings.subclassFormats?.[subclassName] || '';
                                const subPattern = subFormat ? subFormat.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N') : '';
                                const recommendedSubFormat = settings.recommendedSubclassOcrFormats?.[subclassName] || '';
                                return (
                                  <div key={subclassName} style={{ marginBottom: 6 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <span style={{ fontSize: 11, color: '#aaa', minWidth: 70 }}>{subclassName}:</span>
                                      <input
                                        type="text"
                                        placeholder="e.g. FI-12345"
                                        value={subFormat}
                                        disabled={!settings.enableOCR}
                                        onChange={(e) => {
                                          setClassDetectionSettings(prev => ({
                                            ...prev,
                                            [modelId]: { 
                                              ...prev[modelId], 
                                              subclassFormats: {
                                                ...prev[modelId].subclassFormats,
                                                [subclassName]: e.target.value.toUpperCase()
                                              }
                                            }
                                          }));
                                        }}
                                        style={{ width: 120, padding: '4px 8px', fontSize: 11, fontFamily: 'monospace', border: '1px solid #555', borderRadius: 4, background: '#1a1a1a', color: '#eee' }}
                                      />
                                      {subPattern && settings.enableOCR && (
                                        <code style={{ fontSize: 10, background: 'rgba(39,174,96,0.15)', padding: '2px 6px', borderRadius: 3, color: '#6fcf97', fontFamily: 'monospace' }}>
                                          {subPattern}
                                        </code>
                                      )}
                                    </div>
                                    {recommendedSubFormat && settings.enableOCR && subFormat !== recommendedSubFormat && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, marginLeft: 78, padding: '2px 6px', background: 'rgba(52,152,219,0.15)', borderRadius: 3, fontSize: 10, color: '#5dade2' }}>
                                        <span>✓ Saved: {recommendedSubFormat}</span>
                                        <button
                                          onClick={() => {
                                            setClassDetectionSettings(prev => ({
                                              ...prev,
                                              [modelId]: { 
                                                ...prev[modelId], 
                                                subclassFormats: {
                                                  ...prev[modelId].subclassFormats,
                                                  [subclassName]: recommendedSubFormat
                                                }
                                              }
                                            }));
                                          }}
                                          style={{ marginLeft: 'auto', padding: '1px 5px', fontSize: 9, background: '#2980b9', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}
                                        >
                                          Use
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            /* Single format */
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <input
                                  type="text"
                                  placeholder="Format e.g. FI-12345"
                                  value={format}
                                  disabled={!settings.enableOCR}
                                  onChange={(e) => {
                                    setClassDetectionSettings(prev => ({
                                      ...prev,
                                      [modelId]: { ...prev[modelId], ocrFormat: e.target.value.toUpperCase() }
                                    }));
                                  }}
                                  style={{ width: 160, padding: '6px 10px', fontSize: 12, fontFamily: 'monospace', border: '1px solid #555', borderRadius: 4, background: '#1a1a1a', color: '#eee' }}
                                />
                                {pattern && settings.enableOCR && (
                                  <code style={{ fontSize: 11, background: 'rgba(39,174,96,0.15)', padding: '4px 10px', borderRadius: 4, color: '#6fcf97', fontFamily: 'monospace' }}>
                                    {pattern}
                                  </code>
                                )}
                              </div>
                              {settings.recommendedOcrFormat && settings.enableOCR && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, padding: '3px 8px', background: 'rgba(52,152,219,0.15)', borderRadius: 4, fontSize: 11, color: '#5dade2' }}>
                                  <span>✓ Recommended: {settings.recommendedOcrFormat} → {settings.recommendedOcrPattern || settings.recommendedOcrFormat.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N')}</span>
                                  {format !== settings.recommendedOcrFormat && (
                                    <button
                                      onClick={() => {
                                        setClassDetectionSettings(prev => ({
                                          ...prev,
                                          [modelId]: { ...prev[modelId], ocrFormat: settings.recommendedOcrFormat }
                                        }));
                                      }}
                                      style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 10, background: '#2980b9', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}
                                    >
                                      Use
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
            {/* OCR-to-Objects Section */}
            <div style={{ 
              marginTop: 16, 
              padding: '14px 16px', 
              background: '#333', 
              borderRadius: 8, 
              border: '1px solid #444'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: ocrToObjectsEnabled ? 12 : 0 }}>
                <span style={{ fontWeight: 600, fontSize: 14, color: '#eee' }}>
                  Text to Objects
                </span>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={ocrToObjectsEnabled}
                    onChange={(e) => setOcrToObjectsEnabled(e.target.checked)}
                    style={{ cursor: 'pointer', margin: 0 }}
                  />
                </label>
              </div>
              
              {ocrToObjectsEnabled && (
                <div>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>
                    After detection, OCR each page and create objects from matching text.
                  </div>
                  
                  {/* Class groups */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {ocrToObjectsClasses.map((cls) => (
                      <div key={cls.id} style={{ padding: '10px 12px', background: '#3a3a3a', borderRadius: 6, border: '1px solid #4a4a4a' }}>
                        {/* Class header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          {cls.useExisting && (project?.classes || []).length > 0 ? (
                            <select
                              value={cls.className}
                              onChange={(e) => {
                                setOcrToObjectsClasses(prev => prev.map(c => c.id === cls.id ? { ...c, className: e.target.value } : c));
                              }}
                              style={{ flex: 1, padding: '6px 8px', border: '1px solid #555', borderRadius: 4, fontSize: 13, background: '#2a2a2a', color: '#eee' }}
                            >
                              <option value="">-- Select class --</option>
                              {(project?.classes || []).map(c => (
                                <option key={c.id} value={c.name}>{c.name}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={cls.className}
                              onChange={(e) => {
                                setOcrToObjectsClasses(prev => prev.map(c => c.id === cls.id ? { ...c, className: e.target.value } : c));
                              }}
                              placeholder="Class name"
                              style={{ flex: 1, padding: '6px 8px', border: '1px solid #555', borderRadius: 4, fontSize: 13, background: '#2a2a2a', color: '#eee' }}
                            />
                          )}
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#888', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            <input
                              type="checkbox"
                              checked={cls.useExisting}
                              onChange={(e) => {
                                setOcrToObjectsClasses(prev => prev.map(c => c.id === cls.id ? { ...c, useExisting: e.target.checked, className: '' } : c));
                              }}
                              style={{ margin: 0, cursor: 'pointer' }}
                            />
                            Existing
                          </label>
                          {ocrToObjectsClasses.length > 1 && (
                            <button
                              onClick={() => setOcrToObjectsClasses(prev => prev.filter(c => c.id !== cls.id))}
                              style={{ padding: '2px 7px', background: 'none', border: '1px solid #555', borderRadius: 4, color: '#888', cursor: 'pointer', fontSize: 12 }}
                            >✕</button>
                          )}
                        </div>
                        
                        {/* Patterns under this class */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 4 }}>
                          {cls.patterns.map((pat, patIdx) => (
                            <div key={patIdx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 10, color: '#777', width: 50, flexShrink: 0 }}>Pattern</span>
                              <input
                                type="text"
                                value={pat}
                                onChange={(e) => {
                                  const val = e.target.value.toUpperCase();
                                  setOcrToObjectsClasses(prev => prev.map(c => {
                                    if (c.id !== cls.id) return c;
                                    const newPatterns = [...c.patterns];
                                    newPatterns[patIdx] = val;
                                    return { ...c, patterns: newPatterns };
                                  }));
                                }}
                                placeholder="e.g. FI-12345"
                                style={{ flex: 1, padding: '4px 8px', border: '1px solid #555', borderRadius: 4, fontSize: 12, fontFamily: 'monospace', background: '#2a2a2a', color: '#eee' }}
                              />
                              {pat && (
                                <span style={{ fontSize: 9, color: '#5dade2', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                  {ocrFormatToDisplay(pat)}
                                </span>
                              )}
                              {cls.patterns.length > 1 && (
                                <button
                                  onClick={() => {
                                    setOcrToObjectsClasses(prev => prev.map(c => {
                                      if (c.id !== cls.id) return c;
                                      return { ...c, patterns: c.patterns.filter((_, i) => i !== patIdx) };
                                    }));
                                  }}
                                  style={{ padding: '1px 5px', background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 11 }}
                                >✕</button>
                              )}
                            </div>
                          ))}
                          <button
                            onClick={() => {
                              setOcrToObjectsClasses(prev => prev.map(c => {
                                if (c.id !== cls.id) return c;
                                return { ...c, patterns: [...c.patterns, ''] };
                              }));
                            }}
                            style={{ alignSelf: 'flex-start', marginTop: 2, marginLeft: 50, padding: '2px 10px', background: 'none', border: '1px dashed #555', borderRadius: 4, color: '#888', cursor: 'pointer', fontSize: 10 }}
                          >
                            + pattern
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Add class button */}
                  <button
                    onClick={() => {
                      setOcrToObjectsClasses(prev => [...prev, {
                        id: Date.now(),
                        className: '',
                        useExisting: false,
                        patterns: ['']
                      }]);
                    }}
                    style={{ 
                      marginTop: 8, padding: '7px 12px', background: '#444', 
                      border: '1px solid #555', borderRadius: 4, color: '#ccc', 
                      cursor: 'pointer', fontSize: 12, width: '100%'
                    }}
                  >
                    + Add Class
                  </button>
                </div>
              )}
            </div>
            
            {/* Actions */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 18 }}>
              <button 
                onClick={() => setShowDetectionSettings(false)}
                style={{ background: '#444', border: 'none', borderRadius: 6, color: '#ccc', padding: '10px 24px', cursor: 'pointer', fontSize: 14 }}
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  setShowDetectionSettings(false);
                  handleFindObjects();
                }}
                disabled={isObjectDetecting}
                style={{ 
                  background: isObjectDetecting ? '#555' : '#2980b9', 
                  border: 'none', borderRadius: 6, color: '#fff', 
                  padding: '10px 24px', cursor: isObjectDetecting ? 'not-allowed' : 'pointer', 
                  fontSize: 14, fontWeight: 600,
                  opacity: isObjectDetecting ? 0.6 : 1
                }}
              >
                {isObjectDetecting ? 'Detecting...' : '🔍 Start Detection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Smart Links Detection Settings Popup */}
      {showSmartLinksSettings && (
        <div className="modal-overlay" onClick={() => setShowSmartLinksSettings(false)}>
          <div className="modal detection-settings-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Links Settings</h2>
            <p className="modal-subtitle">Configure settings for each class</p>
            
            <div className="detection-settings-list" style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {Object.entries(smartLinksClassSettings).map(([modelId, settings]) => {
                const format = settings.ocrFormat || '';
                const pattern = format ? format.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N') : '';
                
                return (
                  <div key={modelId} style={{ 
                    padding: '14px 16px',
                    background: '#fafafa', 
                    borderRadius: '8px',
                    marginBottom: '10px',
                    border: '1px solid #e8e8e8'
                  }}>
                    {/* Header row: Class name + Data Extraction toggle */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <span style={{ fontWeight: '600', fontSize: '14px', color: '#333' }}>
                        {settings.className}
                      </span>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', color: '#555', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        <input
                          type="checkbox"
                          checked={settings.enableOCR}
                          onChange={(e) => {
                            setSmartLinksClassSettings(prev => ({
                              ...prev,
                              [modelId]: { ...prev[modelId], enableOCR: e.target.checked }
                            }));
                          }}
                          style={{ cursor: 'pointer', margin: 0 }}
                        />
                        Data Extraction
                      </label>
                    </div>
                    
                    {/* Confidence row - full width */}
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontSize: '12px', color: '#666' }}>Confidence</span>
                        <span style={{ fontSize: '13px', color: '#333', fontWeight: '500' }}>
                          {(settings.confidence * 100).toFixed(1)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.2"
                        max="0.95"
                        step="0.025"
                        value={settings.confidence}
                        style={{ width: '100%', cursor: 'pointer', accentColor: '#2196F3' }}
                        onChange={(e) => {
                          setSmartLinksClassSettings(prev => ({
                            ...prev,
                            [modelId]: { ...prev[modelId], confidence: parseFloat(e.target.value) }
                          }));
                        }}
                      />
                      {settings.recommendedConfidence && (
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '6px',
                          marginTop: '4px',
                          padding: '4px 8px',
                          background: '#e8f5e9',
                          borderRadius: '4px',
                          fontSize: '11px',
                          color: '#2e7d32'
                        }}>
                          <span>✓</span>
                          <span>Trained model recommended: {(settings.recommendedConfidence * 100).toFixed(0)}%</span>
                          {Math.abs(settings.confidence - settings.recommendedConfidence) > 0.01 && (
                            <button
                              onClick={() => {
                                setSmartLinksClassSettings(prev => ({
                                  ...prev,
                                  [modelId]: { ...prev[modelId], confidence: settings.recommendedConfidence }
                                }));
                              }}
                              style={{
                                marginLeft: 'auto',
                                padding: '2px 6px',
                                fontSize: '10px',
                                background: '#27ae60',
                                color: 'white',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer'
                              }}
                            >
                              Use
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    
                    {/* Format row(s) - show subclass formats if available, otherwise single format */}
                    {(settings.subclassNames && settings.subclassNames.length > 0) || (settings.subclassRegions && Object.keys(settings.subclassRegions).length > 0) ? (
                      /* Subclass formats */
                      <div style={{ opacity: settings.enableOCR ? 1 : 0.4 }}>
                        <div style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>Subclass Formats:</div>
                        {(settings.subclassNames || Object.keys(settings.subclassRegions || {})).map(subclassName => {
                          const subFormat = settings.subclassFormats?.[subclassName] || '';
                          const subPattern = subFormat ? subFormat.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N') : '';
                          return (
                            <div key={subclassName} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                              <span style={{ fontSize: '12px', color: '#555', minWidth: '70px' }}>{subclassName}:</span>
                              <input
                                type="text"
                                placeholder="e.g. FI-12345"
                                value={subFormat}
                                disabled={!settings.enableOCR}
                                onChange={(e) => {
                                  setSmartLinksClassSettings(prev => ({
                                    ...prev,
                                    [modelId]: { 
                                      ...prev[modelId], 
                                      subclassFormats: {
                                        ...prev[modelId].subclassFormats,
                                        [subclassName]: e.target.value.toUpperCase()
                                      }
                                    }
                                  }));
                                }}
                                style={{ 
                                  width: '130px',
                                  padding: '4px 8px', 
                                  fontSize: '11px',
                                  fontFamily: 'monospace',
                                  border: '1px solid #ddd', 
                                  borderRadius: '4px',
                                  background: settings.enableOCR ? '#fff' : '#f5f5f5'
                                }}
                              />
                              {subPattern && settings.enableOCR && (
                                <code style={{ 
                                  fontSize: '10px', 
                                  background: '#e8f5e9', 
                                  padding: '2px 6px', 
                                  borderRadius: '3px', 
                                  color: '#2e7d32',
                                  fontFamily: 'monospace'
                                }}>
                                  {subPattern}
                                </code>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      /* Single format for classes without subclasses */
                      <div style={{ opacity: settings.enableOCR ? 1 : 0.4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minHeight: '32px' }}>
                          <input
                            type="text"
                            placeholder="Format e.g. FI-12345"
                            value={format}
                            disabled={!settings.enableOCR}
                            onChange={(e) => {
                              setSmartLinksClassSettings(prev => ({
                                ...prev,
                                [modelId]: { ...prev[modelId], ocrFormat: e.target.value.toUpperCase() }
                              }));
                            }}
                            style={{ 
                              width: '160px',
                              padding: '6px 10px', 
                              fontSize: '12px',
                              fontFamily: 'monospace',
                              border: '1px solid #ddd', 
                              borderRadius: '4px',
                              background: settings.enableOCR ? '#fff' : '#f5f5f5'
                            }}
                          />
                          {pattern && settings.enableOCR && (
                            <code style={{ 
                              fontSize: '11px', 
                              background: '#e8f5e9', 
                              padding: '4px 10px', 
                              borderRadius: '4px', 
                              color: '#2e7d32',
                              fontFamily: 'monospace',
                              letterSpacing: '0.5px'
                            }}>
                              {pattern}
                            </code>
                          )}
                        </div>
                        {settings.recommendedOcrFormat && settings.enableOCR && (
                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '6px',
                            marginTop: '4px',
                            padding: '4px 8px',
                            background: '#e3f2fd',
                            borderRadius: '4px',
                            fontSize: '11px',
                            color: '#1565c0'
                          }}>
                            <span>✓</span>
                            <span>Recommended: {settings.recommendedOcrFormat} → {settings.recommendedOcrPattern || settings.recommendedOcrFormat.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N')}</span>
                            {format !== settings.recommendedOcrFormat && (
                              <button
                                onClick={() => {
                                  setSmartLinksClassSettings(prev => ({
                                    ...prev,
                                    [modelId]: { ...prev[modelId], ocrFormat: settings.recommendedOcrFormat }
                                  }));
                                }}
                                style={{
                                  marginLeft: 'auto',
                                  padding: '2px 6px',
                                  fontSize: '10px',
                                  background: '#1976d2',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '3px',
                                  cursor: 'pointer'
                                }}
                              >
                                Use
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
            {/* Help text */}
            <div style={{ fontSize: '11px', color: '#777', marginTop: '10px', padding: '8px 10px', background: '#f8f8f8', borderRadius: '4px', lineHeight: '1.4' }}>
              <strong>Format:</strong> L = letter, N = number. Corrects 1↔I and 0↔O based on position.
            </div>
            
            <div className="modal-actions">
              <button 
                className="cancel-btn"
                onClick={() => setShowSmartLinksSettings(false)}
              >
                Cancel
              </button>
              <button 
                className="primary-btn"
                onClick={() => {
                  setShowSmartLinksSettings(false);
                  handleFindLinks();
                }}
                disabled={isDetecting}
              >
                {isDetecting ? 'Detecting...' : '🔍 Start Detection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Training Options Popup */}
      {showTrainingOptions && (
        <div className="modal-overlay" onClick={() => setShowTrainingOptions(false)}>
          <div className="modal training-options-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Training Options</h2>
            
            <div className="training-mode-section">
              <label className="section-label">Training Mode:</label>
              <div className="training-mode-options">
                <div 
                  className={`mode-option ${!addToExistingModel ? 'selected' : ''}`}
                  onClick={() => setAddToExistingModel(null)}
                >
                  <div className={`radio-circle ${!addToExistingModel ? 'checked' : ''}`} />
                  <span>Create new model</span>
                </div>
                <div 
                  className={`mode-option ${addToExistingModel ? 'selected' : ''} ${objectModels.length === 0 ? 'disabled' : ''}`}
                  onClick={() => {
                    if (objectModels.length === 0) return;
                    const classNames = [...new Set(objectTrainingBoxes.map(b => b.parentClass || b.className))];
                    const matchingModel = objectModels.find(m => classNames.includes(m.className));
                    setAddToExistingModel(matchingModel?.id || objectModels[0]?.id);
                  }}
                >
                  <div className={`radio-circle ${addToExistingModel ? 'checked' : ''}`} />
                  <span>Add to existing model{objectModels.length === 0 ? ' (no models)' : ''}</span>
                </div>
              </div>
            </div>
            
            <div className="form-row">
              {!addToExistingModel ? (
                <>
                  <label>Model Title:</label>
                  <input
                    type="text"
                    value={trainingModelTitle}
                    onChange={(e) => setTrainingModelTitle(e.target.value)}
                    placeholder="Enter model name..."
                  />
                  {trainingModelTitle.trim() && objectModels.some(m => m.className.toLowerCase() === trainingModelTitle.trim().toLowerCase()) && (
                    <div className="duplicate-warning">⚠️ A model with this name already exists</div>
                  )}
                  
                  {/* Mode selector - show for all, but disable for single class */}
                  {(() => {
                    const uniqueClasses = [...new Set(objectTrainingBoxes.map(b => b.parentClass || b.className))];
                    const isSingleClass = uniqueClasses.length <= 1;
                    return (
                      <div className="model-mode-section" style={{ marginTop: '16px', padding: '12px', background: '#f8f9fa', borderRadius: '6px', opacity: isSingleClass ? 0.5 : 1 }}>
                        <label style={{ marginBottom: '8px', display: 'block', fontWeight: 500, fontSize: '13px' }}>
                          Multi-class mode: {isSingleClass && <span style={{ fontWeight: 'normal', color: '#888' }}>(single class)</span>}
                        </label>
                        <div style={{ display: 'flex', gap: '16px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: isSingleClass ? 'not-allowed' : 'pointer' }}>
                            <input
                              type="radio"
                              name="modelMode"
                              checked={objectModelMode === 'combined'}
                              onChange={() => setObjectModelMode('combined')}
                              disabled={isSingleClass}
                            />
                            <span>Combined (1 model)</span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: isSingleClass ? 'not-allowed' : 'pointer' }}>
                            <input
                              type="radio"
                              name="modelMode"
                              checked={objectModelMode === 'separate'}
                              onChange={() => setObjectModelMode('separate')}
                              disabled={isSingleClass}
                            />
                            <span>Separate ({uniqueClasses.length} model{uniqueClasses.length !== 1 ? 's' : ''})</span>
                          </label>
                        </div>
                        {!isSingleClass && (
                          <div style={{ fontSize: '11px', color: '#666', marginTop: '6px' }}>
                            Classes: {uniqueClasses.join(', ')}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              ) : (
                <>
                  <label>Select Model:</label>
                  <select
                    value={addToExistingModel || ''}
                    onChange={(e) => setAddToExistingModel(e.target.value)}
                  >
                    <option value="">-- Select model --</option>
                    {objectModels.map(model => (
                      <option key={model.id} value={model.id}>
                        {model.className} ({model.numTemplates} templates)
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
            
            <div className="modal-actions">
              <button 
                className="cancel-btn"
                onClick={() => setShowTrainingOptions(false)}
              >
                Cancel
              </button>
              <button 
                className="primary-btn"
                onClick={async () => {
                  const modelIdToAddTo = addToExistingModel;
                  const currentMode = objectModelMode;
                  setShowTrainingOptions(false);
                  
                  // Call training directly with captured value
                  if (objectTrainingBoxes.length === 0 || !currentFile?.backendFilename) return;
                  
                  setIsObjectTraining(true);
                  try {
                    const modelTitle = trainingModelTitle.trim() || objectTrainingBoxes[0]?.className || 'Untitled';
                    const sanitizedBoxes = objectTrainingBoxes.map(box => {
                      const originalClass = box.parentClass || box.className;
                      return {
                        ...box,
                        // In combined mode, use model title; in separate mode, keep original class names
                        className: currentMode === 'combined' 
                          ? modelTitle.replace(/[<>:"/\\|?*]/g, '-')
                          : originalClass.replace(/[<>:"/\\|?*]/g, '-'),
                        label: box.label?.replace(/ > /g, ' - ')?.replace(/[<>:"/\\|?*]/g, '-') || box.label,
                        originalClassName: originalClass,
                        shapeType: box.shapeType || 'rectangle',
                        hasSubclasses: box.hasSubclasses,
                        availableSubclasses: box.availableSubclasses,
                        subclassRegions: box.subclassRegions,
                        fullClassPath: box.fullClassPath
                      };
                    });
                    
                    console.log('Training with modelIdToAddTo:', modelIdToAddTo, 'mode:', currentMode);
                    
                    const result = await trainDetector(
                      currentFile.backendFilename,
                      sanitizedBoxes,
                      false,                  // multiOrientation
                      false,                  // includeInverted
                      currentMode,            // trainingMode
                      'object',               // modelType
                      project?.id,            // projectId
                      modelIdToAddTo || null, // addToExistingModel
                      currentFile?.sourceFolder || null  // sourceFolder
                    );
                    
                    console.log('Training result:', result);
                    setObjectTrainingBoxes([]);
                    setObjectFinderMode(null);
                    setTrainingModelTitle('');
                    setAddToExistingModel(null);
                    await loadObjectModels();
                    
                    if (modelIdToAddTo) {
                      alert(`Added ${objectTrainingBoxes.length} template(s) to existing model`);
                    } else if (currentMode === 'separate') {
                      const uniqueClasses = [...new Set(sanitizedBoxes.map(b => b.className))];
                      alert(`Training complete! Created ${uniqueClasses.length} model(s):\n${uniqueClasses.join('\n')}`);
                    } else {
                      alert(`Training complete! Model "${modelTitle}" created.`);
                    }
                  } catch (error) {
                    console.error('Training error:', error);
                    alert('Training failed: ' + error.message);
                  } finally {
                    setIsObjectTraining(false);
                  }
                }}
                disabled={
                  isObjectTraining || 
                  (!addToExistingModel && !trainingModelTitle.trim()) ||
                  (!addToExistingModel && objectModels.some(m => m.className.toLowerCase() === trainingModelTitle.trim().toLowerCase()))
                }
              >
                {isObjectTraining ? 'Training...' : (addToExistingModel ? '➕ Add Templates' : '🎓 Train Model')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subclass Region Dialog - Steps through each subclass */}
      {showSubclassRegionDialog && pendingParentBox && (
        <div className="modal-overlay">
          <div 
            className="modal subclass-region-modal resizable" 
            ref={subclassDialogRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: subclassDialogSize.width,
              height: subclassDialogSize.height,
              maxWidth: '95vw',
              maxHeight: '95vh',
              minWidth: 400,
              minHeight: 400
            }}
          >
            {/* Resize handles */}
            <div 
              className="resize-handle resize-handle-e"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingDialog(true);
                setResizeStart({ x: e.clientX, y: e.clientY, width: subclassDialogSize.width, height: subclassDialogSize.height, direction: 'e' });
              }}
            />
            <div 
              className="resize-handle resize-handle-s"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingDialog(true);
                setResizeStart({ x: e.clientX, y: e.clientY, width: subclassDialogSize.width, height: subclassDialogSize.height, direction: 's' });
              }}
            />
            <div 
              className="resize-handle resize-handle-se"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingDialog(true);
                setResizeStart({ x: e.clientX, y: e.clientY, width: subclassDialogSize.width, height: subclassDialogSize.height, direction: 'se' });
              }}
            />
            
            {(() => {
              const subclasses = pendingParentBox.subclasses || [];
              const currentSubclass = subclasses[currentSubclassIndex];
              const totalSubclasses = subclasses.length;
              const currentRegion = subclassRegions[currentSubclass];
              
              // Helper to get coordinates relative to the image, not the container
              const getImageRelativeCoords = (e, container) => {
                const img = container.querySelector('img');
                if (!img) return null;
                
                const imgRect = img.getBoundingClientRect();
                const x = (e.clientX - imgRect.left) / imgRect.width;
                const y = (e.clientY - imgRect.top) / imgRect.height;
                
                return {
                  x: Math.max(0, Math.min(1, x)),
                  y: Math.max(0, Math.min(1, y)),
                  imgRect
                };
              };
              
              return (
                <>
                  <div className="subclass-dialog-header">
                    <h2>📍 Mark "<span className="current-subclass-name">{currentSubclass}</span>" Region</h2>
                    <div className="subclass-progress">
                      Step {currentSubclassIndex + 1} of {totalSubclasses}
                    </div>
                  </div>
                  
                  <div className="subclass-tabs">
                    {subclasses.map((sub, idx) => (
                      <button
                        key={sub}
                        className={`subclass-tab ${idx === currentSubclassIndex ? 'active' : ''} ${subclassRegions[sub] ? 'completed' : ''}`}
                        onClick={() => {
                          setCurrentSubclassIndex(idx);
                          setSubclassCurrentRect(null);
                        }}
                      >
                        {subclassRegions[sub] && <span className="tab-check">✓</span>}
                        {sub}
                      </button>
                    ))}
                  </div>
                  
                  <p className="instruction-text">
                    Draw a box around where the <strong>{currentSubclass}</strong> value appears. 
                    During detection, OCR will read this region and fill the "{currentSubclass}" field.
                  </p>
                  
                  {/* Zoom controls */}
                  <div className="subclass-zoom-controls">
                    <button onClick={() => setSubclassImageZoom(z => Math.max(0.5, z - 0.25))}>−</button>
                    <span>{Math.round(subclassImageZoom * 100)}%</span>
                    <button onClick={() => setSubclassImageZoom(z => Math.min(3, z + 0.25))}>+</button>
                    <button onClick={() => setSubclassImageZoom(1)}>Reset</button>
                  </div>
                  
                  {/* Cropped image canvas for drawing */}
                  <div 
                    className="subclass-image-container"
                    onMouseDown={(e) => {
                      const coords = getImageRelativeCoords(e, e.currentTarget);
                      if (!coords) return;
                      setSubclassDrawStart({ x: coords.x, y: coords.y });
                      setSubclassCurrentRect({ x: coords.x, y: coords.y, width: 0, height: 0 });
                    }}
                    onMouseMove={(e) => {
                      if (!subclassDrawStart) return;
                      const coords = getImageRelativeCoords(e, e.currentTarget);
                      if (!coords) return;
                      const width = coords.x - subclassDrawStart.x;
                      const height = coords.y - subclassDrawStart.y;
                      setSubclassCurrentRect({
                        x: width < 0 ? coords.x : subclassDrawStart.x,
                        y: height < 0 ? coords.y : subclassDrawStart.y,
                        width: Math.abs(width),
                        height: Math.abs(height)
                      });
                    }}
                    onMouseUp={() => {
                      if (subclassCurrentRect && subclassCurrentRect.width > 0.01 && subclassCurrentRect.height > 0.01) {
                        // Save region for current subclass
                        setSubclassRegions(prev => ({
                          ...prev,
                          [currentSubclass]: subclassCurrentRect
                        }));
                      }
                      setSubclassDrawStart(null);
                    }}
                    onMouseLeave={() => {
                      if (subclassDrawStart) {
                        if (subclassCurrentRect && subclassCurrentRect.width > 0.01 && subclassCurrentRect.height > 0.01) {
                          setSubclassRegions(prev => ({
                            ...prev,
                            [currentSubclass]: subclassCurrentRect
                          }));
                        }
                        setSubclassDrawStart(null);
                      }
                    }}
                  >
                    {parentBoxImage ? (
                      <div className="subclass-image-wrapper" style={{ transform: `scale(${subclassImageZoom})`, transformOrigin: 'top left' }}>
                        <img src={parentBoxImage} alt="Object to mark" className="subclass-object-image" draggable={false} />
                        
                        {/* Show all marked regions with different colors - positioned over image */}
                        {Object.entries(subclassRegions).map(([subName, region]) => (
                          <div 
                            key={subName}
                            className={`subclass-draw-rect ${subName === currentSubclass ? 'current' : 'other'}`}
                            style={{
                              left: `${region.x * 100}%`,
                              top: `${region.y * 100}%`,
                              width: `${region.width * 100}%`,
                              height: `${region.height * 100}%`,
                            }}
                          >
                            <span className="region-label">{subName}</span>
                          </div>
                        ))}
                        
                        {/* Current drawing rect */}
                        {subclassCurrentRect && !subclassRegions[currentSubclass] && (
                          <div 
                            className="subclass-draw-rect current drawing"
                            style={{
                              left: `${subclassCurrentRect.x * 100}%`,
                              top: `${subclassCurrentRect.y * 100}%`,
                              width: `${subclassCurrentRect.width * 100}%`,
                              height: `${subclassCurrentRect.height * 100}%`,
                            }}
                          >
                            <span className="region-label">{currentSubclass}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="no-image-placeholder">Loading image...</div>
                    )}
                  </div>
                  
                  <div className="subclass-status">
                    {currentRegion ? (
                      <span className="status-done">✅ Region marked for {currentSubclass}</span>
                    ) : (
                      <span className="status-pending">Draw a box to mark the region</span>
                    )}
                    <span className="regions-count">
                      {Object.keys(subclassRegions).length} / {totalSubclasses} marked
                    </span>
                  </div>
                  
                  <div className="modal-actions">
                    <button 
                      className="cancel-btn"
                      onClick={() => {
                        setShowSubclassRegionDialog(false);
                        setPendingParentBox(null);
                        setSubclassRegions({});
                        setParentBoxImage(null);
                        setSubclassCurrentRect(null);
                        setCurrentSubclassIndex(0);
                      }}
                    >
                      Cancel
                    </button>
                    
                    {currentSubclassIndex > 0 && (
                      <button
                        className="secondary-btn"
                        onClick={() => {
                          setCurrentSubclassIndex(prev => prev - 1);
                          setSubclassCurrentRect(null);
                        }}
                      >
                        ← Previous
                      </button>
                    )}
                    
                    {currentSubclassIndex < totalSubclasses - 1 ? (
                      <button
                        className="primary-btn"
                        onClick={() => {
                          setCurrentSubclassIndex(prev => prev + 1);
                          setSubclassCurrentRect(null);
                        }}
                      >
                        Next →
                      </button>
                    ) : (
                      <button 
                        className="primary-btn save-btn"
                        onClick={() => {
                          const parentClassName = pendingParentBox.className.split(' > ')[0];
                          const newObject = {
                            id: `obj_${Date.now()}`,
                            className: parentClassName,
                            label: pendingParentBox.className,
                            parentClass: parentClassName,
                            fullClassPath: pendingParentBox.className,
                            hasSubclasses: true,
                            availableSubclasses: pendingParentBox.subclasses,
                            confidence: 1.0,
                            isManual: true,
                            page: pendingParentBox.page,
                            bbox: {
                              x: pendingParentBox.x,
                              y: pendingParentBox.y,
                              width: pendingParentBox.width,
                              height: pendingParentBox.height,
                            },
                            shapeType: pendingParentBox.shapeType || 'rectangle',
                            polylinePoints: pendingParentBox.polylinePoints || null,
                            filename: currentFileIdentifier,
                            subclassRegions: subclassRegions, // All marked regions
                          };
                          setObjectTrainingBoxes(prev => [...prev, newObject]);
                          
                          // Also save subclass regions to the project's class definition
                          if (project && onProjectUpdate) {
                            const updatedClasses = (project.classes || []).map(cls => {
                              if (cls.name === parentClassName && !cls.parentId) {
                                return {
                                  ...cls,
                                  subclassRegions: subclassRegions
                                };
                              }
                              return cls;
                            });
                            onProjectUpdate({
                              ...project,
                              classes: updatedClasses
                            });
                          }
                          
                          setShowSubclassRegionDialog(false);
                          setPendingParentBox(null);
                          setSubclassRegions({});
                          setParentBoxImage(null);
                          setSubclassCurrentRect(null);
                          setCurrentSubclassIndex(0);
                        }}
                      >
                        💾 Save Training Example
                      </button>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Zoom & Navigation Settings Dialog */}
      {showZoomSettingsDialog && (
        <ZoomSettingsDialog
          settings={zoomSettings}
          onChange={setZoomSettings}
          onClose={() => setShowZoomSettingsDialog(false)}
        />
      )}

      {/* Hotspot Context Menu */}
      <HotspotContextMenu
        isOpen={!!hotspotContextMenu}
        position={{ x: hotspotContextMenu?.x || 0, y: hotspotContextMenu?.y || 0 }}
        hotspot={hotspotContextMenu?.hotspot}
        targetFile={hotspotContextMenu?.targetFile}
        isLinked={hotspotContextMenu?.isLinked}
        isBroken={hotspotContextMenu?.isBroken}
        onClose={() => setHotspotContextMenu(null)}
        onAssign={() => {
          setPendingHotspot(hotspotContextMenu.hotspot);
          setShowAssignDialog(true);
        }}
        onNavigate={() => {
          handleHotspotClick(hotspotContextMenu.hotspot);
        }}
        onDelete={() => {
          handleDeleteHotspot(hotspotContextMenu.hotspot.id);
        }}
      />

      {/* Save notification toast */}
      {saveNotification && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 100000,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 18px',
            borderRadius: 8,
            background: saveNotification.type === 'success' ? '#27ae60' : '#c0392b',
            color: '#fff',
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
            animation: 'fadeInUp 0.2s ease-out',
            maxWidth: 420,
          }}
        >
          <span style={{ fontSize: 16 }}>
            {saveNotification.type === 'success' ? '✓' : '✕'}
          </span>
          <span style={{ flex: 1 }}>{saveNotification.message}</span>
          {saveNotification.type === 'error' && (
            <button
              onClick={() => {
                setSaveNotification(null);
                downloadPdfWithMarkups();
              }}
              style={{
                padding: '5px 12px',
                background: 'rgba(255,255,255,0.2)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              Save As
            </button>
          )}
          <button
            onClick={() => setSaveNotification(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.7)',
              cursor: 'pointer',
              fontSize: 16,
              padding: '0 2px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

