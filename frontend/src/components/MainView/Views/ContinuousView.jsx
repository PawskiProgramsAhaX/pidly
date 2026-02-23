import { useRef, useMemo, useEffect } from 'react';
import { isContinuousView } from '../Hooks/useContinuousLayout';
import '../PDFViewerArea.css';
import ContinuousPage from './ContinuousPage';
import { ROTATE_CURSOR } from '../renderSelectionHandles';

// Stable empty array — prevents new [] reference on every render for pages with no markups
const EMPTY_MARKUPS = [];

/**
 * ContinuousView - Thin wrapper that manages the scrollable container,
 * pan/zoom at the container level, and delegates per-page rendering
 * to memoized <ContinuousPage> components.
 *
 * Performance architecture:
 *   - Each page is a React.memo component that only re-renders when ITS data changes
 *   - Shared interaction state lives in ctxRef (a single ref, updated every render)
 *   - ContinuousPage destructures from ctxRef.current at render time (always fresh)
 *   - Pages that aren't visually affected by a state change skip re-render entirely
 *   - E.g. hovering page 3 does NOT re-render pages 1, 2, 4, 5
 *   - E.g. dragging a markup on page 5 does NOT re-render pages 1-4, 6-20
 */
export default function ContinuousView(props) {
  const {
    containerRef, continuousWrapperRef, zoomInnerRef,
    viewMode, currentPage, numPages, rotation, scale, isZooming, isZoomingRef,
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
    objectsByFilePage, objectModels, objectIndexMap,
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
    isDrawingRef_setIsDrawing: setIsDrawing,
    setDrawStart, setCurrentRect,
    setObjectClassName, setShowObjectClassDialog, setPendingObjectBox,
    setObjectClassInput,
    showDrawTypePopup, setShowDrawTypePopup,
    savedSymbols, draggingSymbol, pendingPlacement, setPendingPlacement,
    placeSymbol, placeImageSymbol, setDraggingSymbol,
    markupComments, setMarkupComments,
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
  } = props;

  // ─── Interaction context ref ─────────────────────────────────────────
  // Updated every render (just a ref assignment — zero cost).
  // ContinuousPage destructures from ctxRef.current at render time.
  // Since ctxRef identity never changes, it never triggers ContinuousPage re-renders.
  // But when memo ALLOWS a re-render, ctxRef.current provides fresh values.
  const ctxRef = useRef({});
  ctxRef.current = {
    viewMode, currentPage, numPages, rotation, scale, isZooming, isZoomingRef, canvasSize,
    pageBaseDimensions, allPageDimensions, pdfBackgroundColor, overlaysReady, pdfDoc,
    continuousLayout, continuousLayoutRef, continuousCanvasRefs, renderedPages,
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
    getLineDashArray, getMarkupCursor, handleMarkupContextMenu,
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
    markupCloudArcSize, markupCloudInverted, markupArrowHeadSize,
    showObjectBoxes, showObjectFinder, objectFinderMode, objectDrawType,
    detectedObjects, setDetectedObjects,
    hoveredObject, setHoveredObject, highlightedObjectId,
    hideLabels, hiddenClasses, objectViewMode,
    setSelectedObject, setShowObjectEditDialog, setObjectImagePreview,
    captureObjectImage, savedObjects, objectsByFilePage, objectModels, objectIndexMap,
    showLinksOnPdf, showSmartLinks, linkMode,
    hotspots, setHotspots, hotspotsByPage,
    hoveredHotspot, setHoveredHotspot,
    trainingBoxes, setTrainingBoxes,
    currentRect, isDrawing, handleHotspotClick, setHotspotContextMenu, allFiles,
    showOcrOnPdf, ocrResults, ocrFilter,
    showRegionBoxes, drawnRegions,
    hoveredRegion, setHoveredRegion,
    setEditingRegion, setEditRegionName, setShowRegionEditDialog,
    setPendingRegionShape, setRegionTypeInput, setSubRegionNameInput,
    setRegionFillColorInput, setRegionBorderColorInput, setShowRegionAssignDialog,
    pendingShape, setPendingShape, drawingShapeType,
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
    setIsDrawing, setDrawStart, setCurrentRect,
    setObjectClassName, setShowObjectClassDialog, setPendingObjectBox, setObjectClassInput,
    showDrawTypePopup, setShowDrawTypePopup,
    savedSymbols, draggingSymbol, pendingPlacement, setPendingPlacement,
    placeSymbol, placeImageSymbol, setDraggingSymbol,
    markupComments, setMarkupComments,
    showCommentInput, setShowCommentInput,
    commentInputText, setCommentInputText,
    markupAuthor,
    activeResizeHandle, activeArcHandle, setActiveResizeHandle,
    scrollToPagePosition, setUnsavedMarkupFiles,
    setMarkupHistory, setMarkupFuture,
    addMarkupWithHistory, getMarkupBounds, updateDrawingOverlay,
    convertToEditableFormat, takeOwnershipOfAnnotation,
    currentPageRef, scaleRef,
    noteText, editingNoteId,
    containerRef,
  };

  // ─── Per-page prop derivation ───────────────────────────────────────
  const editingTextPage = useMemo(() => {
    if (!editingTextMarkupId) return -1;
    const m = markups.find(mk => mk.id === editingTextMarkupId);
    return m ? m.page : -1;
  }, [editingTextMarkupId, markups]);

  const defaultDims = useMemo(() => ({
    width: canvasSize.width || 800, height: canvasSize.height || 1000
  }), [canvasSize.width, canvasSize.height]);

  // ─── Horizontal wheel → scroll conversion ──────────────────────────────
  // In horizontal/sideBySide layouts, vertical mouse wheel scrolls left/right.
  // This is the PRIMARY navigation axis — always convert.
  // When zoomed in and page is taller than viewport, user uses grab/pan tool (middle-click)
  // for vertical panning, matching Bluebeam behavior.
  // Ctrl/Meta+wheel is zoom and handled by useZoomPan — don't intercept.
  useEffect(() => {
    if (!continuousLayout.isHorizontal) return;
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e) => {
      if (e.ctrlKey || e.metaKey || zoomMode) return;
      // If trackpad is sending horizontal swipes (deltaX > deltaY), let native handling work
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      container.scrollLeft += e.deltaY;
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [continuousLayout.isHorizontal, zoomMode]);

  return (
          <div 
            ref={containerRef}
            className={`pdf-container pdf-container-continuous${isZooming ? ' is-zooming-continuous' : ''}`}
            onMouseDown={(e) => {
              // Pan: panMode click or middle mouse button
              if ((panMode || e.button === 1) && containerRef.current) {
                setIsPanning(true);
                setPanStart({
                  x: e.clientX, y: e.clientY,
                  scrollLeft: containerRef.current.scrollLeft,
                  scrollTop: containerRef.current.scrollTop
                });
                e.preventDefault();
              }
              // Zoom box
              if (zoomMode && containerRef.current) {
                const pageElements = containerRef.current.querySelectorAll('.pdf-continuous-page');
                let clickedPage = null, pageRect = null;
                pageElements.forEach(pageEl => {
                  const rect = pageEl.getBoundingClientRect();
                  if (e.clientX >= rect.left && e.clientX <= rect.right &&
                      e.clientY >= rect.top && e.clientY <= rect.bottom) {
                    clickedPage = parseInt(pageEl.dataset.page) || 1;
                    pageRect = rect;
                  }
                });
                if (clickedPage && pageRect) {
                  const dims = allPageDimensions[clickedPage] || defaultDims;
                  const pw = dims.width * scale, ph = dims.height * scale;
                  const nx = (e.clientX - pageRect.left) / pw;
                  const ny = (e.clientY - pageRect.top) / ph;
                  setIsDrawingZoomBox(true);
                  setZoomBox({ startX: nx, startY: ny, endX: nx, endY: ny, page: clickedPage });
                  e.preventDefault();
                }
              }
            }}
            onMouseMove={(e) => {
              if (isPanning && containerRef.current) {
                containerRef.current.scrollLeft = panStart.scrollLeft - (e.clientX - panStart.x);
                containerRef.current.scrollTop = panStart.scrollTop - (e.clientY - panStart.y);
              }
              if (isDrawingZoomBox && zoomBox && containerRef.current) {
                const pageEl = containerRef.current.querySelector(`[data-page="${zoomBox.page}"]`);
                if (pageEl) {
                  const pr = pageEl.getBoundingClientRect();
                  const dims = allPageDimensions[zoomBox.page] || defaultDims;
                  const pw = dims.width * scale, ph = dims.height * scale;
                  const nx = Math.max(0, Math.min(1, (e.clientX - pr.left) / pw));
                  const ny = Math.max(0, Math.min(1, (e.clientY - pr.top) / ph));
                  setZoomBox(prev => prev ? { ...prev, endX: nx, endY: ny } : null);
                }
              }
            }}
            onMouseUp={(e) => {
              setIsPanning(false);
              if (isDrawingZoomBox && zoomBox && containerRef.current) {
                const bMinX = Math.min(zoomBox.startX, zoomBox.endX);
                const bMaxX = Math.max(zoomBox.startX, zoomBox.endX);
                const bMinY = Math.min(zoomBox.startY, zoomBox.endY);
                const bMaxY = Math.max(zoomBox.startY, zoomBox.endY);
                const bW = bMaxX - bMinX, bH = bMaxY - bMinY;
                if (bW > 0.02 && bH > 0.02) {
                  const dims = allPageDimensions[zoomBox.page] || defaultDims;
                  const container = containerRef.current;
                  const newScale = Math.min(container.clientWidth / (bW * dims.width), container.clientHeight / (bH * dims.height), 10) * 0.9;
                  setCurrentPage(zoomBox.page);
                  zoomWithScrollAdjust(newScale);
                  setTimeout(() => {
                    const pe = container.querySelector(`[data-page="${zoomBox.page}"]`);
                    if (pe) {
                      const pr = pe.getBoundingClientRect(), cr = container.getBoundingClientRect();
                      container.scrollLeft += (pr.left + (bMinX + bMaxX) / 2 * pr.width) - (cr.left + cr.width / 2);
                      container.scrollTop += (pr.top + (bMinY + bMaxY) / 2 * pr.height) - (cr.top + cr.height / 2);
                    }
                  }, 200);
                } else {
                  setCurrentPage(zoomBox.page);
                  zoomWithScrollAdjust(Math.min(20, scaleRef.current * 1.5));
                  const cx = (bMinX + bMaxX) / 2, cy = (bMinY + bMaxY) / 2;
                  setTimeout(() => {
                    const c = containerRef.current;
                    const pe = c?.querySelector(`[data-page="${zoomBox.page}"]`);
                    if (pe && c) {
                      const pr = pe.getBoundingClientRect(), cr = c.getBoundingClientRect();
                      c.scrollLeft += (pr.left + cx * pr.width) - (cr.left + cr.width / 2);
                      c.scrollTop += (pr.top + cy * pr.height) - (cr.top + cr.height / 2);
                    }
                  }, 200);
                }
                setIsDrawingZoomBox(false);
                setZoomBox(null);
              }
            }}
            onMouseLeave={() => {
              setIsPanning(false);
              if (hoveredMarkupIdRef.current) {
                const prevEl = document.querySelector(`[data-markup-id="${hoveredMarkupIdRef.current}"]`);
                if (prevEl) prevEl.classList.remove('markup-hovered');
                hoveredMarkupIdRef.current = null;
              }
            }}
            style={{ 
              cursor: isRotatingMarkup ? ROTATE_CURSOR :
                      pendingPlacement ? 'crosshair' :
                      panMode ? (isPanning ? 'grabbing' : 'grab') : 
                      zoomMode ? 'zoom-in' : 
                      markupMode ? 'crosshair' : 'default',
              overflowY: 'auto', overflowX: 'auto',
              overflowAnchor: 'none', scrollbarGutter: 'stable',
              backgroundColor: pdfBackgroundColor
            }}
          >
            <div 
              ref={continuousWrapperRef}
              className="pdf-continuous-wrapper"
              style={{
                position: 'relative',
                ...(continuousLayout.isHorizontal ? {
                  width: continuousLayout.totalWidth,
                  height: `max(100%, ${continuousLayout.maxPageHeight + 80 * scale}px)`,
                } : {
                  height: continuousLayout.totalHeight,
                  width: `max(100%, ${continuousLayout.maxPageWidth + 80 * scale}px)`,
                }),
              }}
            >
              <div 
                ref={zoomInnerRef}
                className="zoom-transform-inner"
                style={{
                  position: 'relative',
                  width: continuousLayout.isHorizontal ? continuousLayout.totalWidth : '100%',
                  height: continuousLayout.isHorizontal ? '100%' : continuousLayout.totalHeight,
                  transformOrigin: '0 0',
                  // will-change: transform is now managed by CSS class .is-zooming-continuous
                  // (applied via DOM manipulation in useZoomPan for instant activation)
                }}
              >
              {/* Virtualized page rendering — each page is a memoized component */}
              {(() => {
                const pages = [];
                for (let p = mountedPageRange.min; p <= mountedPageRange.max; p++) pages.push(p);
                return pages.map(pageNum => {
                  const dims = allPageDimensions[pageNum] || precomputedPageDimsRef.current[pageNum] || defaultDims;
                  const pageWidth = dims.width * scale;
                  const pageHeight = dims.height * scale;
                  const pageIdx = pageNum - 1;
                  // Scope per-page props: only pass if relevant to THIS page
                  const selMarkup = selectedMarkup?.page === pageIdx ? selectedMarkup : null;
                  const editId = editingTextPage === pageIdx ? editingTextMarkupId : null;
                  const selBox = (isDrawingSelectionBox && selectionBox?.page === pageIdx) ? selectionBox : null;
                  const zmBox = (isDrawingZoomBox && zoomBox?.page === pageNum) ? zoomBox : null;
                  return (
                    <ContinuousPage
                      key={pageNum}
                      pageNum={pageNum}
                      pageWidth={pageWidth}
                      pageHeight={pageHeight}
                      baseWidth={dims.width}
                      baseHeight={dims.height}
                      pageMarkups={markupsByPageIndex.get(pageIdx) || EMPTY_MARKUPS}
                      isPageVisible={visiblePages.has(pageNum)}
                      isRendered={renderedPages.has(pageNum)}
                      selectedMarkup={selMarkup}
                      editingTextMarkupId={editId}
                      scale={scale}
                      markupEditMode={markupEditMode}
                      markupMode={markupMode}
                      selectMode={selectMode}
                      overlaysReady={overlaysReady}
                      continuousLayout={continuousLayout}
                      expandedNotes={expandedNotes}
                      showObjectBoxes={showObjectBoxes}
                      showLinksOnPdf={showLinksOnPdf}
                      showOcrOnPdf={showOcrOnPdf}
                      showRegionBoxes={showRegionBoxes}
                      hiddenClasses={hiddenClasses}
                      hideLabels={hideLabels}
                      highlightedObjectId={highlightedObjectId}
                      selectionBox={selBox}
                      zoomBox={zmBox}
                      ctxRef={ctxRef}
                    />
                  );
                });
              })()}
              </div>
            </div>
          </div>
  );
}
