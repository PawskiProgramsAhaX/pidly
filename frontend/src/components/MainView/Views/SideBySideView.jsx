import { useRef, useMemo, useCallback, useEffect } from 'react';
import { isContinuousView } from '../hooks/useContinuousLayout';
import '../PDFViewerArea.css';
import { renderMarkupShape } from '../renderMarkupShape';
import { renderSelectionHandles, ROTATE_CURSOR } from '../renderSelectionHandles';

/**
 * SideBySideView - Renders ALL PDF pages in a single horizontal row,
 * continuously scrollable left-to-right with virtualized page mounting.
 *
 * Full-featured: includes all overlays (objects, hotspots, regions, OCR,
 * markups, selection handles, zoom box, training boxes, etc.) matching
 * ContinuousView's capabilities.
 */
export default function SideBySideView(props) {
  const {
    containerRef, continuousWrapperRef, zoomInnerRef,
    viewMode, currentPage, numPages, rotation, scale, isZooming,
    canvasSize, pageBaseDimensions, allPageDimensions,
    pdfBackgroundColor, overlaysReady, pdfDoc,
    continuousLayout, continuousLayoutRef,
    continuousCanvasRefs, renderedPages,
    mountedPageRange, visiblePages, CONTINUOUS_VIEW_BUFFER,
    // Pan/zoom
    panMode, isPanning, panStart, zoomMode, selectMode,
    setIsPanning, setPanStart, setCurrentPage,
    zoomWithScrollAdjust, precomputedPageDimsRef,
    setIsDrawingZoomBox, setZoomBox,
    // Mouse handlers - continuous view has its own inline handlers
    // Markup state
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
    // Notes
    expandedNotes, toggleNoteExpanded,
    setShowNoteDialog, setNoteDialogPosition, setNoteText, setEditingNoteId,
    // Text editing
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
    // Objects/detection
    showObjectBoxes, showObjectFinder, objectFinderMode, objectDrawType,
    detectedObjects, setDetectedObjects,
    hoveredObject, setHoveredObject, highlightedObjectId,
    hideLabels, hiddenClasses, objectViewMode,
    setSelectedObject, setShowObjectEditDialog, setObjectImagePreview,
    captureObjectImage,
    savedObjects,
    objectsByFilePage, objectModels,
    // Links/hotspots
    showLinksOnPdf, showSmartLinks, linkMode,
    hotspots, setHotspots, hotspotsByPage,
    hoveredHotspot, setHoveredHotspot,
    trainingBoxes, setTrainingBoxes,
    currentRect, isDrawing,
    handleHotspotClick,
    setHotspotContextMenu,
    allFiles,
    // OCR
    showOcrOnPdf, ocrResults, ocrFilter,
    // Regions
    showRegionBoxes, drawnRegions,
    hoveredRegion, setHoveredRegion,
    setEditingRegion, setEditRegionName, setShowRegionEditDialog,
    setPendingRegionShape, setRegionTypeInput, setSubRegionNameInput,
    setRegionFillColorInput, setRegionBorderColorInput, setShowRegionAssignDialog,
    // Shapes
    pendingShape, setPendingShape,
    drawingShapeType,
    polylinePoints, polylineMousePos, isNearStartPoint,
    // Capture region
    captureRegion, symbolCaptureMode,
    // Selection
    selectionBox, isDrawingSelectionBox, setSelectionBox, setIsDrawingSelectionBox,
    isShiftPressed,
    zoomBox, isDrawingZoomBox,
    currentFileIdentifier,
    // Helpers
    hexToRgba, getClassColor, getClassColors, getClassShapeType, getRegionTypeColors,
    project, currentFile,
    // Training
    objectTrainingBoxes, setObjectTrainingBoxes,
    pendingParentBox, setPendingParentBox, setParentBoxImage,
    setShowSubclassRegionDialog, setCurrentSubclassIndex, setSubclassRegions,
    parentClassForTraining,
    // Markup interaction refs
    didDragMoveRef, wasAlreadySelectedRef, dragDeltaRef, rafIdRef,
    moveMarkup, resizeMarkup,
    dragOffsetRef, continuousSelectionRef, selectedMarkupsRef,
    isDraggingMarkupRef, isResizingMarkupRef, isRotatingMarkupRef,
    isDrawingMarkupRef, currentMarkupRef, markupDragStartRef,
    dragStartRef, resizeHandleRef, rotationStartRef,
    draggingPolylinePointRef, selectedMarkupRef,
    draggingPolylinePoint, setDraggingPolylinePoint,
    // Markup draw/resize/rotate handlers
    handleMouseDown, handleMouseMove, handleMouseUp, handleDoubleClick,
    // Drawing state
    isDrawingRef_setIsDrawing: setIsDrawing,
    setDrawStart, setCurrentRect,
    // Object training
    setObjectClassName, setShowObjectClassDialog, setPendingObjectBox,
    setObjectClassInput,
    showDrawTypePopup, setShowDrawTypePopup,
    // Symbols
    savedSymbols, draggingSymbol, pendingPlacement, setPendingPlacement,
    placeSymbol, placeImageSymbol, setDraggingSymbol,
    // Markup comments
    markupComments, setMarkupComments,
    showCommentInput, setShowCommentInput,
    commentInputText, setCommentInputText,
    markupAuthor,
    // Active handles
    activeResizeHandle, activeArcHandle, setActiveResizeHandle,
    // Misc
    scrollToPagePosition,
    setUnsavedMarkupFiles,
    setMarkupHistory, setMarkupFuture,
    addMarkupWithHistory, getMarkupBounds, updateDrawingOverlay,
    currentPageRef,
    scaleRef,
    // Note state
    noteText, editingNoteId,
  } = props;

  // ─── Wheel → horizontal scroll conversion ─────────────────────────────
  // Without this, vertical mouse wheel does nothing on a horizontal layout.
  // Only active when NOT in zoom mode (Ctrl/Meta+wheel is handled by useZoomPan).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e) => {
      // Don't intercept zoom gestures — useZoomPan handles those
      if (e.ctrlKey || e.metaKey || zoomMode) return;
      // If there's meaningful deltaX already (trackpad horizontal swipe), let it through natively
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      // Convert vertical scroll → horizontal scroll
      e.preventDefault();
      container.scrollLeft += e.deltaY;
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [zoomMode]);

  return (
    <div
      ref={containerRef}
      className={`pdf-container pdf-container-sidebyside${isZooming ? ' is-zooming-continuous' : ''}`}
      style={{
        backgroundColor: pdfBackgroundColor,
        // Override the CSS flex centering — it causes inaccessible negative overflow
        // when content is wider than the container (horizontal layout)
        display: 'block',
        cursor: isRotatingMarkup ? ROTATE_CURSOR : undefined,
      }}
      onMouseDown={(e) => {
        // Handle panning — panMode click OR middle mouse button (always available)
        if ((panMode || e.button === 1) && containerRef.current) {
          setIsPanning(true);
          setPanStart({
            x: e.clientX,
            y: e.clientY,
            scrollLeft: containerRef.current.scrollLeft,
            scrollTop: containerRef.current.scrollTop
          });
          e.preventDefault();
        }
        // Handle zoom box start
        if (zoomMode && containerRef.current) {
          const pageElements = containerRef.current.querySelectorAll('.pdf-continuous-page');
          let clickedPage = null;
          let pageRect = null;

          pageElements.forEach(pageEl => {
            const rect = pageEl.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom) {
              clickedPage = parseInt(pageEl.dataset.page) || 1;
              pageRect = rect;
            }
          });

          if (clickedPage && pageRect) {
            const dims = allPageDimensions[clickedPage] || { width: canvasSize.width || 800, height: canvasSize.height || 1000 };
            const pageWidth = dims.width * scale;
            const pageHeight = dims.height * scale;

            const normalizedX = (e.clientX - pageRect.left) / pageWidth;
            const normalizedY = (e.clientY - pageRect.top) / pageHeight;

            setIsDrawingZoomBox(true);
            setZoomBox({
              startX: normalizedX,
              startY: normalizedY,
              endX: normalizedX,
              endY: normalizedY,
              page: clickedPage
            });
            e.preventDefault();
          }
        }
      }}
      onMouseMove={(e) => {
        // Handle panning (panMode drag or middle-mouse-button drag)
        if (isPanning && containerRef.current) {
          const dx = e.clientX - panStart.x;
          const dy = e.clientY - panStart.y;
          containerRef.current.scrollLeft = panStart.scrollLeft - dx;
          containerRef.current.scrollTop = panStart.scrollTop - dy;
        }
        // Handle zoom box drag
        if (isDrawingZoomBox && zoomBox && containerRef.current) {
          const pageEl = containerRef.current.querySelector(`[data-page="${zoomBox.page}"]`);
          if (pageEl) {
            const pageRect = pageEl.getBoundingClientRect();
            const dims = allPageDimensions[zoomBox.page] || { width: canvasSize.width || 800, height: canvasSize.height || 1000 };
            const pageWidth = dims.width * scale;
            const pageHeight = dims.height * scale;

            const normalizedX = Math.max(0, Math.min(1, (e.clientX - pageRect.left) / pageWidth));
            const normalizedY = Math.max(0, Math.min(1, (e.clientY - pageRect.top) / pageHeight));

            setZoomBox(prev => prev ? { ...prev, endX: normalizedX, endY: normalizedY } : null);
          }
        }
      }}
      onMouseUp={(e) => {
        setIsPanning(false);
        // Handle zoom box complete
        if (isDrawingZoomBox && zoomBox && containerRef.current) {
          const boxMinX = Math.min(zoomBox.startX, zoomBox.endX);
          const boxMaxX = Math.max(zoomBox.startX, zoomBox.endX);
          const boxMinY = Math.min(zoomBox.startY, zoomBox.endY);
          const boxMaxY = Math.max(zoomBox.startY, zoomBox.endY);

          const boxWidth = boxMaxX - boxMinX;
          const boxHeight = boxMaxY - boxMinY;

          if (boxWidth > 0.02 && boxHeight > 0.02) {
            const dims = allPageDimensions[zoomBox.page] || { width: canvasSize.width || 800, height: canvasSize.height || 1000 };
            const container = containerRef.current;
            const containerWidth = container.clientWidth;
            const containerHeight = container.clientHeight;

            const boxRealWidth = boxWidth * dims.width;
            const boxRealHeight = boxHeight * dims.height;
            const scaleX = containerWidth / boxRealWidth;
            const scaleY = containerHeight / boxRealHeight;
            const newScale = Math.min(scaleX, scaleY, 10) * 0.9;

            setCurrentPage(zoomBox.page);
            zoomWithScrollAdjust(newScale);

            setTimeout(() => {
              const pageEl = container.querySelector(`[data-page="${zoomBox.page}"]`);
              if (pageEl) {
                const pageRect = pageEl.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();

                const boxCenterX = (boxMinX + boxMaxX) / 2;
                const boxCenterY = (boxMinY + boxMaxY) / 2;

                const targetX = pageRect.left + boxCenterX * pageRect.width;
                const targetY = pageRect.top + boxCenterY * pageRect.height;

                const scrollAdjustX = targetX - (containerRect.left + containerRect.width / 2);
                const scrollAdjustY = targetY - (containerRect.top + containerRect.height / 2);

                container.scrollLeft += scrollAdjustX;
                container.scrollTop += scrollAdjustY;
              }
            }, 200);
          } else {
            setCurrentPage(zoomBox.page);
            zoomWithScrollAdjust(Math.min(20, scaleRef.current * 1.5));

            const clickCenterX = (boxMinX + boxMaxX) / 2;
            const clickCenterY = (boxMinY + boxMaxY) / 2;
            setTimeout(() => {
              const container = containerRef.current;
              const pageEl = container?.querySelector(`[data-page="${zoomBox.page}"]`);
              if (pageEl && container) {
                const pageRect = pageEl.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                const targetX = pageRect.left + clickCenterX * pageRect.width;
                const targetY = pageRect.top + clickCenterY * pageRect.height;
                container.scrollLeft += targetX - (containerRect.left + containerRect.width / 2);
                container.scrollTop += targetY - (containerRect.top + containerRect.height / 2);
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
          if (prevEl) {
            prevEl.classList.remove('markup-hovered');
          }
          hoveredMarkupIdRef.current = null;
        }
      }}
    >
      <div
        ref={continuousWrapperRef}
        className="pdf-continuous-wrapper"
        style={{
          position: 'relative',
          width: continuousLayout.totalWidth || '100%',
          height: `max(100%, ${continuousLayout.maxPageHeight + 80 * scale}px)`,
        }}
      >
        <div
          ref={zoomInnerRef}
          className="zoom-transform-inner"
          style={{
            position: 'relative',
            width: continuousLayout.totalWidth || '100%',
            height: '100%',
            transformOrigin: '0 0',
            willChange: isZooming ? 'transform' : 'auto',
          }}
        >
          {/* Performance: DOM virtualization - only mount visible pages + buffer */}
          {(() => {
            const defaultDims = { width: canvasSize.width || 800, height: canvasSize.height || 1000 };

            const mountedPages = [];
            for (let p = mountedPageRange.min; p <= mountedPageRange.max; p++) {
              mountedPages.push(p);
            }

            return mountedPages.map(pageNum => {
              const dims = allPageDimensions[pageNum] || precomputedPageDimsRef.current[pageNum] || defaultDims;
              const pageWidth = dims.width * scale;
              const pageHeight = dims.height * scale;
              const baseWidth = dims.width;
              const baseHeight = dims.height;
              const pageMarkups = markupsByPageIndex.get(pageNum - 1) || [];

              // Helper to get normalized coords from mouse event on this page
              const getPageCoords = (e) => {
                const pageEl = e.currentTarget;
                const rect = pageEl.getBoundingClientRect();
                const x = (e.clientX - rect.left) / scale;
                const y = (e.clientY - rect.top) / scale;
                return {
                  normalizedX: Math.max(0, Math.min(1, x / baseWidth)),
                  normalizedY: Math.max(0, Math.min(1, y / baseHeight))
                };
              };

              // Handler for markup interactions
              const handleContinuousPageMouseDown = (e) => {
                if (panMode || zoomMode) return;
                // If editing text, save and exit editing, then continue to allow deselection
                if (editingTextMarkupId) {
                  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.closest('foreignObject')) {
                    return;
                  }
                  saveTextEdit(false);
                  // Don't return - let the click continue to deselect/select other markups
                }
                if (e.target.closest('.detected-object-box') || e.target.closest('.hotspot-box')) return;

                // Check if clicking on a resize handle
                const resizeHandleEl = e.target.closest('.resize-handle');
                if (resizeHandleEl && selectedMarkup && selectedMarkup.page === pageNum - 1) {
                  e.preventDefault();
                  e.stopPropagation();
                  const handle = resizeHandleEl.dataset.handle;
                  const bounds = getMarkupBounds(selectedMarkup);

                  isResizingMarkupRef.current = true;
                  setIsResizingMarkup(true);
                  resizeHandleRef.current = handle;
                  setResizeHandle(handle);

                  const { normalizedX, normalizedY } = getPageCoords(e);
                  const dragStart = { x: normalizedX, y: normalizedY, bounds, page: pageNum - 1 };
                  markupDragStartRef.current = dragStart;
                  setMarkupDragStart(dragStart);
                  return;
                }

                if (currentPage !== pageNum) setCurrentPage(pageNum);
                const { normalizedX, normalizedY } = getPageCoords(e);

                // If selected markup on this page, check if clicking to drag (PDF annotations require edit mode)
                if (selectedMarkup && selectedMarkup.page === pageNum - 1 && !selectedMarkup.readOnly && (markupEditMode || !selectedMarkup.fromPdf)) {
                  const bounds = getMarkupBounds(selectedMarkup);
                  if (bounds) {
                    const strokeTol = Math.max(0.005, (selectedMarkup.strokeWidth || 2) * 0.0008);
                    let canDrag = false;

                    if (selectedMarkup.type === 'arrow' || selectedMarkup.type === 'line') {
                      const dist = pointToLineDistance(normalizedX, normalizedY,
                        selectedMarkup.startX, selectedMarkup.startY,
                        selectedMarkup.endX, selectedMarkup.endY);
                      canDrag = dist < strokeTol;
                    } else if (selectedMarkup.type === 'pen' || selectedMarkup.type === 'highlighter') {
                      for (let i = 0; i < selectedMarkup.points.length - 1; i++) {
                        const p1 = selectedMarkup.points[i];
                        const p2 = selectedMarkup.points[i + 1];
                        const dist = pointToLineDistance(normalizedX, normalizedY, p1.x, p1.y, p2.x, p2.y);
                        if (dist < strokeTol) { canDrag = true; break; }
                      }
                    } else if (selectedMarkup.type === 'circle') {
                      const cx = (selectedMarkup.startX + selectedMarkup.endX) / 2;
                      const cy = (selectedMarkup.startY + selectedMarkup.endY) / 2;
                      const rx = Math.abs(selectedMarkup.endX - selectedMarkup.startX) / 2;
                      const ry = Math.abs(selectedMarkup.endY - selectedMarkup.startY) / 2;
                      if (rx > 0.001 && ry > 0.001) {
                        const dx = (normalizedX - cx) / rx;
                        const dy = (normalizedY - cy) / ry;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        const hasFill = selectedMarkup.fillColor && selectedMarkup.fillColor !== 'none' && selectedMarkup.fillColor !== 'transparent';
                        if (hasFill && dist <= 1) canDrag = true;
                        else {
                          const borderTol = strokeTol / Math.min(rx, ry);
                          canDrag = Math.abs(dist - 1) < borderTol;
                        }
                      }
                    } else {
                      const hasFill = selectedMarkup.fillColor && selectedMarkup.fillColor !== 'none' && selectedMarkup.fillColor !== 'transparent';
                      const isTextBox = selectedMarkup.type === 'text' || selectedMarkup.type === 'callout';

                      if (hasFill || isTextBox) {
                        canDrag = normalizedX >= bounds.minX && normalizedX <= bounds.maxX &&
                                  normalizedY >= bounds.minY && normalizedY <= bounds.maxY;
                      } else if (selectedMarkup.type === 'cloud') {
                        const cloudTol = strokeTol + 0.008;
                        const onBorder =
                          (Math.abs(normalizedX - bounds.minX) < cloudTol || Math.abs(normalizedX - bounds.maxX) < cloudTol) &&
                          normalizedY >= bounds.minY && normalizedY <= bounds.maxY ||
                          (Math.abs(normalizedY - bounds.minY) < cloudTol || Math.abs(normalizedY - bounds.maxY) < cloudTol) &&
                          normalizedX >= bounds.minX && normalizedX <= bounds.maxX;
                        canDrag = onBorder;
                      } else {
                        const onBorder =
                          (Math.abs(normalizedX - bounds.minX) < strokeTol || Math.abs(normalizedX - bounds.maxX) < strokeTol) &&
                          normalizedY >= bounds.minY && normalizedY <= bounds.maxY ||
                          (Math.abs(normalizedY - bounds.minY) < strokeTol || Math.abs(normalizedY - bounds.maxY) < strokeTol) &&
                          normalizedX >= bounds.minX && normalizedX <= bounds.maxX;
                        canDrag = onBorder;
                      }
                    }

                    if (canDrag) {
                      e.preventDefault();
                      e.stopPropagation();
                      isDraggingMarkupRef.current = true;
                      setIsDraggingMarkup(true);
                      didDragMoveRef.current = false;
                      wasAlreadySelectedRef.current = true;
                      const dragStart = { x: normalizedX, y: normalizedY, bounds, page: pageNum - 1 };
                      markupDragStartRef.current = dragStart;
                      setMarkupDragStart(dragStart);
                      return;
                    }
                  }
                }

                // Try to select existing markup (PDF annotations require edit mode)
                {
                  let hitMarkup = null;
                  for (let i = pageMarkups.length - 1; i >= 0; i--) {
                    const m = pageMarkups[i];
                    if (m.readOnly) continue;
                    if (m.fromPdf && !markupEditMode) continue;
                    const bounds = getMarkupBounds(m);
                    if (!bounds) continue;
                    const { minX, maxX, minY, maxY } = bounds;
                    const pad = 0.01;
                    if (normalizedX >= minX - pad && normalizedX <= maxX + pad &&
                        normalizedY >= minY - pad && normalizedY <= maxY + pad) {
                      hitMarkup = m;
                      break;
                    }
                  }

                  if (hitMarkup) {
                    e.stopPropagation();
                    setSelectedMarkup(hitMarkup);
                    selectedMarkupRef.current = hitMarkup;
                    setSelectedMarkups([]);
                    selectedMarkupsRef.current = [];
                    if (currentPage !== pageNum) setCurrentPage(pageNum);

                    isDraggingMarkupRef.current = true;
                    setIsDraggingMarkup(true);
                    didDragMoveRef.current = false;
                    wasAlreadySelectedRef.current = false;
                    dragDeltaRef.current = { x: 0, y: 0 };

                    const dragBounds = getMarkupBounds(hitMarkup);
                    const dragStart = { x: normalizedX, y: normalizedY, bounds: dragBounds, page: pageNum - 1 };
                    markupDragStartRef.current = dragStart;
                    setMarkupDragStart(dragStart);
                    return;
                  }

                  // Clicked empty space - always deselect
                  if (selectedMarkup) {
                    setSelectedMarkup(null);
                    selectedMarkupRef.current = null;
                    setSelectedMarkups([]);
                    selectedMarkupsRef.current = [];
                  }
                  // If tool is active, fall through to tool drawing; otherwise start selection box
                  if (!markupMode || selectMode) {
                    // Start drawing selection box
                    setIsDrawingSelectionBox(true);
                    setSelectionBox({ startX: normalizedX, startY: normalizedY, endX: normalizedX, endY: normalizedY, page: pageNum - 1 });
                    return;
                  }
                }

                // Handle pending symbol/signature placement — rubber-band draw
                if (pendingPlacement) {
                  e.preventDefault();
                  e.stopPropagation();
                  
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
                    page: pageNum - 1,
                    filename: currentFileIdentifier,
                  };
                  currentMarkupRef.current = newMarkup;
                  setCurrentMarkup(newMarkup);
                  setIsDrawingMarkup(true);
                  drawingPageRef && (drawingPageRef.current = pageNum - 1);
                  updateDrawingOverlay();
                  return;
                }

                // Start new markup drawing — always works regardless of lock state
                if (markupMode && !selectMode) {
                  if (['polyline', 'polylineArrow', 'cloudPolyline', 'polygon'].includes(markupMode)) {
                    e.stopPropagation();
                    // Snap helper
                    const snapTo8 = (from, toX, toY) => {
                      const dx = toX - from.x, dy = toY - from.y;
                      const dist = Math.sqrt(dx * dx + dy * dy);
                      if (dist < 0.001) return { x: toX, y: toY };
                      const snapAngle = Math.round(Math.atan2(dy, dx) * 180 / Math.PI / 45) * 45 * Math.PI / 180;
                      return { x: from.x + dist * Math.cos(snapAngle), y: from.y + dist * Math.sin(snapAngle) };
                    };
                    let pointX = normalizedX, pointY = normalizedY;
                    
                    // Set drawing overlay ref
                    const overlay = e.currentTarget.querySelector('.drawing-overlay svg');
                    if (overlay) drawingOverlayRef.current = overlay;
                    
                    if (!currentMarkupRef.current || currentMarkupRef.current.type !== markupMode || currentMarkupRef.current.page !== pageNum - 1) {
                      const newMarkup = {
                        id: `markup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        type: markupMode,
                        points: [{ x: pointX, y: pointY }],
                        color: markupColor, strokeWidth: markupStrokeWidth,
                        opacity: markupOpacity, fillColor: markupFillColor,
                        lineStyle: markupLineStyle,
                        strokeOpacity: markupStrokeOpacity, fillOpacity: markupFillOpacity,
                        arrowHeadSize: markupMode === 'polylineArrow' ? markupArrowHeadSize : undefined,
                        page: pageNum - 1, filename: currentFileIdentifier,
                        author: markupAuthor, createdDate: new Date().toISOString()
                      };
                      if (markupMode === 'cloudPolyline') {
                        newMarkup.arcSize = markupCloudArcSize;
                        newMarkup.inverted = markupCloudInverted;
                      }
                      currentMarkupRef.current = newMarkup;
                    } else {
                      const pts = currentMarkupRef.current.points;
                      if (isShiftPressed && pts.length > 0) {
                        const snapped = snapTo8(pts[pts.length - 1], normalizedX, normalizedY);
                        pointX = snapped.x; pointY = snapped.y;
                      }
                      // Check close threshold
                      if (pts.length >= 3) {
                        const startPt = pts[0];
                        const distToStart = Math.sqrt(
                          Math.pow((pointX - startPt.x) * pageWidth, 2) + 
                          Math.pow((pointY - startPt.y) * pageHeight, 2)
                        );
                        if (distToStart < 15) {
                          const allX = pts.map(p => p.x), allY = pts.map(p => p.y);
                          const newMarkup = {
                            ...currentMarkupRef.current, points: [...pts], closed: true,
                            startX: Math.min(...allX), startY: Math.min(...allY),
                            endX: Math.max(...allX), endY: Math.max(...allY),
                          };
                          delete newMarkup._cursorX; delete newMarkup._cursorY;
                          addMarkupWithHistory(newMarkup);
                          currentMarkupRef.current = null;
                          isDrawingMarkupRef.current = false;
                          if (drawingOverlayRef.current) drawingOverlayRef.current.innerHTML = '';
                          return;
                        }
                      }
                      pts.push({ x: pointX, y: pointY });
                    }
                    updateDrawingOverlay();
                    return;
                  }

                  e.stopPropagation();
                  const id = `markup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                  let newMarkup;

                  if (markupMode === 'pen' || markupMode === 'highlighter') {
                    newMarkup = {
                      id, type: markupMode, page: pageNum - 1, filename: currentFileIdentifier,
                      color: markupColor || (markupMode === 'highlighter' ? 'yellow' : 'red'),
                      strokeWidth: markupStrokeWidth || (markupMode === 'highlighter' ? 20 : 2),
                      opacity: markupMode === 'highlighter' ? 0.4 : 1,
                      points: [{ x: normalizedX, y: normalizedY }],
                    };
                  } else if (markupMode === 'note') {
                    setShowNoteDialog(true);
                    setNoteDialogPosition({ x: normalizedX, y: normalizedY });
                    setNoteText('');
                    setEditingNoteId(null);
                    if (currentPage !== pageNum) setCurrentPage(pageNum);
                    return;
                  } else {
                    const isShapeWithFill = ['rectangle', 'circle', 'cloud'].includes(markupMode);
                    const isArrowOrLine = ['arrow', 'line'].includes(markupMode);
                    newMarkup = {
                      id, type: markupMode, page: pageNum - 1, filename: currentFileIdentifier,
                      color: markupBorderColor || markupColor || 'red',
                      strokeWidth: markupStrokeWidth || 2,
                      fillColor: markupFillColor || 'none',
                      opacity: markupOpacity,
                      lineStyle: markupLineStyle,
                      strokeOpacity: (isShapeWithFill || isArrowOrLine) ? markupStrokeOpacity : undefined,
                      fillOpacity: isShapeWithFill ? markupFillOpacity : undefined,
                      arrowHeadSize: markupMode === 'arrow' ? markupArrowHeadSize : undefined,
                      startX: normalizedX, startY: normalizedY,
                      endX: normalizedX, endY: normalizedY,
                      author: markupAuthor,
                      createdDate: new Date().toISOString()
                    };
                    if (markupMode === 'text' || markupMode === 'callout') {
                      newMarkup.text = '';
                      newMarkup.fontSize = markupFontSize || 12;
                      newMarkup.fontFamily = markupFontFamily || 'Helvetica';
                      newMarkup.color = markupColor || '#000';
                    }
                    if (markupMode === 'cloud') {
                      newMarkup.arcSize = markupCloudArcSize;
                      newMarkup.inverted = markupCloudInverted;
                    }
                  }

                  setCurrentMarkup(newMarkup);
                  currentMarkupRef.current = newMarkup;
                  setIsDrawingMarkup(true);
                  isDrawingMarkupRef.current = true;
                  drawingPageRef && (drawingPageRef.current = pageNum - 1);
                }
              };

              const handleContinuousPageMouseMove = (e) => {
                if (panMode) return;
                const { normalizedX, normalizedY } = getPageCoords(e);

                // Handle selection box drawing
                if (isDrawingSelectionBox && selectionBox && selectionBox.page === pageNum - 1) {
                  setSelectionBox(prev => prev ? { ...prev, endX: normalizedX, endY: normalizedY } : null);
                  return;
                }

                // Handle polyline vertex dragging
                if (isDraggingMarkupRef.current && draggingPolylinePointRef.current !== null && selectedMarkupRef.current && markupDragStartRef.current) {
                  if (selectedMarkupRef.current.page !== pageNum - 1) return;
                  const pointIndex = draggingPolylinePointRef.current;
                  const deltaX = normalizedX - markupDragStartRef.current.x;
                  const deltaY = normalizedY - markupDragStartRef.current.y;
                  if (Math.abs(deltaX) > 0.001 || Math.abs(deltaY) > 0.001) {
                    didDragMoveRef.current = true;
                  }
                  if (!markupDragStartRef.current.originalPoints) {
                    markupDragStartRef.current.originalPoints = [...(selectedMarkupRef.current.points || [])];
                    markupDragStartRef.current.originalX = markupDragStartRef.current.x;
                    markupDragStartRef.current.originalY = markupDragStartRef.current.y;
                  }
                  const totalDeltaX = normalizedX - markupDragStartRef.current.originalX;
                  const totalDeltaY = normalizedY - markupDragStartRef.current.originalY;
                  markupDragStartRef.current.totalDeltaX = totalDeltaX;
                  markupDragStartRef.current.totalDeltaY = totalDeltaY;
                  markupDragStartRef.current.pointIndex = pointIndex;
                  const origPoint = markupDragStartRef.current.originalPoints[pointIndex];
                  if (origPoint) {
                    const newX = origPoint.x + totalDeltaX;
                    const newY = origPoint.y + totalDeltaY;
                    // Update via DOM for performance
                    const handleEl = document.querySelector(`.polyline-point-handle[data-point-index="${pointIndex}"]`);
                    if (handleEl) {
                      handleEl.setAttribute('cx', newX * pageWidth);
                      handleEl.setAttribute('cy', newY * pageHeight);
                    }
                    // Update path
                    const markupEl = document.querySelector(`[data-markup-id="${selectedMarkupRef.current.id}"]`);
                    if (markupEl) {
                      const pathEl = markupEl.tagName.toLowerCase() === 'path' ? markupEl : markupEl.querySelector('path');
                      if (pathEl) {
                        const pts = markupDragStartRef.current.originalPoints.map((p, i) => {
                          if (i === pointIndex) return { x: newX, y: newY };
                          return p;
                        });
                        const closed = selectedMarkupRef.current.type === 'polygon';
                        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * pageWidth} ${p.y * pageHeight}`).join(' ') + (closed ? ' Z' : '');
                        pathEl.setAttribute('d', d);
                      }
                    }
                  }
                  return;
                }

                // Handle markup dragging
                if (isDraggingMarkupRef.current && selectedMarkupRef.current && markupDragStartRef.current) {
                  if (selectedMarkupRef.current.page !== pageNum - 1) return;
                  const deltaX = normalizedX - markupDragStartRef.current.x;
                  const deltaY = normalizedY - markupDragStartRef.current.y;

                  if (Math.abs(deltaX) > 0.001 || Math.abs(deltaY) > 0.001) {
                    didDragMoveRef.current = true;
                  }
                  dragDeltaRef.current.x += deltaX;
                  dragDeltaRef.current.y += deltaY;
                  markupDragStartRef.current = { ...markupDragStartRef.current, x: normalizedX, y: normalizedY };

                  if (continuousSelectionRef.current) {
                    const offsetX = dragDeltaRef.current.x * pageWidth;
                    const offsetY = dragDeltaRef.current.y * pageHeight;
                    continuousSelectionRef.current.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
                  }
                  const markupEl = document.querySelector(`[data-markup-id="${selectedMarkupRef.current.id}"]`);
                  if (markupEl) {
                    const offsetX = dragDeltaRef.current.x * pageWidth;
                    const offsetY = dragDeltaRef.current.y * pageHeight;
                    markupEl.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
                  }
                  return;
                }

                // Handle markup resizing
                if (isResizingMarkupRef.current && selectedMarkupRef.current && resizeHandleRef.current && markupDragStartRef.current) {
                  if (selectedMarkupRef.current.page !== pageNum - 1) return;
                  const deltaX = normalizedX - markupDragStartRef.current.x;
                  const deltaY = normalizedY - markupDragStartRef.current.y;
                  resizeMarkup(selectedMarkupRef.current.id, resizeHandleRef.current, deltaX, deltaY, markupDragStartRef.current.bounds);
                  // Sync selectedMarkup with the updated markup from the array
                  setMarkups(current => {
                    const updated = current.find(m => m.id === selectedMarkupRef.current?.id);
                    if (updated) {
                      setSelectedMarkup(updated);
                      selectedMarkupRef.current = updated;
                    }
                    return current;
                  });
                  markupDragStartRef.current = { ...markupDragStartRef.current, x: normalizedX, y: normalizedY };
                  return;
                }

                // DOM-based hover highlighting
                if (markupEditMode && !isDraggingMarkupRef.current && !isResizingMarkupRef.current &&
                    !isRotatingMarkupRef.current && !isDrawingMarkupRef.current &&
                    !(currentMarkupRef.current && ['polyline', 'polylineArrow', 'cloudPolyline', 'polygon'].includes(currentMarkupRef.current.type))) {
                  const pageMarkupsList = markups.filter(m => m.filename === currentFileIdentifier && m.page === pageNum - 1);
                  let hitMarkup = null;
                  for (let i = pageMarkupsList.length - 1; i >= 0; i--) {
                    const m = pageMarkupsList[i];
                    const minX = Math.min(m.startX || 0, m.endX || 0);
                    const maxX = Math.max(m.startX || 0, m.endX || 0);
                    const minY = Math.min(m.startY || 0, m.endY || 0);
                    const maxY = Math.max(m.startY || 0, m.endY || 0);
                    if (normalizedX >= minX - 0.01 && normalizedX <= maxX + 0.01 &&
                        normalizedY >= minY - 0.01 && normalizedY <= maxY + 0.01) {
                      hitMarkup = m;
                      break;
                    }
                  }
                  const newHoveredId = hitMarkup?.id || null;
                  if (newHoveredId !== hoveredMarkupIdRef.current) {
                    if (hoveredMarkupIdRef.current) {
                      const prevEl = document.querySelector(`[data-markup-id="${hoveredMarkupIdRef.current}"]`);
                      if (prevEl) prevEl.classList.remove('markup-hovered');
                    }
                    if (newHoveredId) {
                      const newEl = document.querySelector(`[data-markup-id="${newHoveredId}"]`);
                      if (newEl) newEl.classList.add('markup-hovered');
                    }
                    hoveredMarkupIdRef.current = newHoveredId;
                  }
                }

                // Handle polyline rubber line preview (polylines don't set isDrawingMarkup)
                if (!isDrawingMarkupRef.current && currentMarkupRef.current && 
                    ['polyline', 'polylineArrow', 'cloudPolyline', 'polygon'].includes(currentMarkupRef.current.type) &&
                    currentMarkupRef.current.page === pageNum - 1) {
                  let cursorX = normalizedX, cursorY = normalizedY;
                  const m = currentMarkupRef.current;
                  if (isShiftPressed && m.points && m.points.length > 0) {
                    const lastPt = m.points[m.points.length - 1];
                    const dx = cursorX - lastPt.x, dy = cursorY - lastPt.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > 0.001) {
                      const snapAngle = Math.round(Math.atan2(dy, dx) * 180 / Math.PI / 45) * 45 * Math.PI / 180;
                      cursorX = lastPt.x + dist * Math.cos(snapAngle);
                      cursorY = lastPt.y + dist * Math.sin(snapAngle);
                    }
                  }
                  m._cursorX = cursorX;
                  m._cursorY = cursorY;
                  if (!rafIdRef.current) {
                    rafIdRef.current = requestAnimationFrame(() => {
                      const overlay = drawingOverlayRef.current;
                      const mk = currentMarkupRef.current;
                      if (overlay && mk && mk.points && mk.points.length >= 1) {
                        const pw = pageWidth, ph = pageHeight;
                        const color = mk.color || '#ff0000';
                        const sw = (mk.strokeWidth || 2) * scale;
                        const isCloud = mk.type === 'cloudPolyline';
                        let svgContent = '';
                        
                        if (isCloud && mk.points.length >= 2) {
                          const inverted = mk.inverted || false;
                          const sweepDir = inverted ? 0 : 1;
                          const normArcDiameter = mk.arcSize || 15;
                          const baseSize = 800;
                          let cloudPath = '';
                          for (let i = 0; i < mk.points.length - 1; i++) {
                            const pt1 = mk.points[i], pt2 = mk.points[i + 1];
                            const x1 = pt1.x * pw, y1 = pt1.y * ph;
                            const x2 = pt2.x * pw, y2 = pt2.y * ph;
                            const dx = x2 - x1, dy = y2 - y1;
                            const segLen = Math.sqrt(dx * dx + dy * dy);
                            if (segLen < 1) continue;
                            const normLen = Math.sqrt(Math.pow((pt2.x - pt1.x) * baseSize, 2) + Math.pow((pt2.y - pt1.y) * baseSize, 2));
                            const numArcs = Math.max(1, Math.round(normLen / normArcDiameter));
                            const arcDiam = segLen / numArcs;
                            const arcR = arcDiam / 2;
                            const ux = dx / segLen, uy = dy / segLen;
                            if (i === 0) cloudPath += `M ${x1} ${y1}`;
                            for (let j = 0; j < numArcs; j++) {
                              const eX = x1 + ux * arcDiam * (j + 1);
                              const eY = y1 + uy * arcDiam * (j + 1);
                              cloudPath += ` A ${arcR} ${arcR} 0 0 ${sweepDir} ${eX} ${eY}`;
                            }
                          }
                          svgContent = `<path d="${cloudPath}" stroke="${color}" stroke-width="${sw}" fill="none" opacity="${mk.opacity || 1}"/>`;
                          const lastPt = mk.points[mk.points.length - 1];
                          const lx = lastPt.x * pw, ly = lastPt.y * ph;
                          const cx = mk._cursorX * pw, cy = mk._cursorY * ph;
                          const rDx = cx - lx, rDy = cy - ly;
                          const rLen = Math.sqrt(rDx * rDx + rDy * rDy);
                          if (rLen > 1) {
                            const rNormLen = Math.sqrt(Math.pow((mk._cursorX - lastPt.x) * baseSize, 2) + Math.pow((mk._cursorY - lastPt.y) * baseSize, 2));
                            const rNumArcs = Math.max(1, Math.round(rNormLen / normArcDiameter));
                            const rArcDiam = rLen / rNumArcs;
                            const rArcR = rArcDiam / 2;
                            const rux = rDx / rLen, ruy = rDy / rLen;
                            let rubberPath = `M ${lx} ${ly}`;
                            for (let j = 0; j < rNumArcs; j++) {
                              const eX = lx + rux * rArcDiam * (j + 1);
                              const eY = ly + ruy * rArcDiam * (j + 1);
                              rubberPath += ` A ${rArcR} ${rArcR} 0 0 ${sweepDir} ${eX} ${eY}`;
                            }
                            svgContent += `<path d="${rubberPath}" stroke="${color}" stroke-width="${sw}" opacity="0.5" fill="none"/>`;
                          }
                        } else {
                          let pathData = mk.points
                            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * pw} ${p.y * ph}`)
                            .join(' ');
                          svgContent = `<path d="${pathData}" stroke="${color}" stroke-width="${sw}" fill="none" opacity="${mk.opacity || 1}" stroke-linecap="round" stroke-linejoin="round"/>`;
                          const lastPt = mk.points[mk.points.length - 1];
                          svgContent += `<line x1="${lastPt.x * pw}" y1="${lastPt.y * ph}" x2="${mk._cursorX * pw}" y2="${mk._cursorY * ph}" stroke="${color}" stroke-width="${sw}" opacity="0.5" stroke-dasharray="4,4"/>`;
                        }
                        if (mk.points.length >= 3) {
                          const startPt = mk.points[0];
                          const distToStart = Math.sqrt(
                            Math.pow((mk._cursorX - startPt.x) * pw, 2) + 
                            Math.pow((mk._cursorY - startPt.y) * ph, 2)
                          );
                          if (distToStart < 15) {
                            svgContent += `<circle cx="${startPt.x * pw}" cy="${startPt.y * ph}" r="6" fill="rgba(52,152,219,0.3)" stroke="#3498db" stroke-width="2"/>`;
                            svgContent += `<line x1="${mk._cursorX * pw}" y1="${mk._cursorY * ph}" x2="${startPt.x * pw}" y2="${startPt.y * ph}" stroke="${color}" stroke-width="${sw}" opacity="0.3" stroke-dasharray="4,4"/>`;
                          }
                        }
                        mk.points.forEach(p => {
                          svgContent += `<circle cx="${p.x * pw}" cy="${p.y * ph}" r="3" fill="${color}"/>`;
                        });
                        overlay.innerHTML = svgContent;
                      }
                      rafIdRef.current = null;
                    });
                  }
                  return;
                }

                // Handle new markup drawing
                if (!isDrawingMarkupRef.current || !currentMarkupRef.current) return;
                if (currentMarkupRef.current.page !== pageNum - 1) return;

                const markup = currentMarkupRef.current;
                if (markup.type === 'pen' || markup.type === 'highlighter') {
                  markup.points.push({ x: normalizedX, y: normalizedY });
                } else if (markup.type === 'placementPreview') {
                  // Aspect-ratio-locked rubber-band
                  const dx = normalizedX - markup.startX;
                  const dy = normalizedY - markup.startY;
                  const ar = markup.aspectRatio || 1;
                  const absDx = Math.abs(dx);
                  const absDy = Math.abs(dy);
                  if (absDx / ar > absDy) {
                    markup.endX = normalizedX;
                    markup.endY = markup.startY + Math.sign(dy || 1) * absDx / ar;
                  } else {
                    markup.endY = normalizedY;
                    markup.endX = markup.startX + Math.sign(dx || 1) * absDy * ar;
                  }
                } else if (markup.startX !== undefined && !['polyline', 'polylineArrow', 'cloudPolyline', 'polygon'].includes(markup.type)) {
                  markup.endX = normalizedX;
                  markup.endY = normalizedY;
                }

                if (!rafIdRef.current) {
                  rafIdRef.current = requestAnimationFrame(() => {
                    updateDrawingOverlay();
                    rafIdRef.current = null;
                  });
                }
              };

              const handleContinuousPageMouseUp = (e) => {
                // Handle selection box completion
                if (isDrawingSelectionBox && selectionBox && selectionBox.page === pageNum - 1) {
                  const { normalizedX, normalizedY } = getPageCoords(e);
                  const finalBox = { ...selectionBox, endX: normalizedX, endY: normalizedY };
                  const boxMinX = Math.min(finalBox.startX, finalBox.endX);
                  const boxMaxX = Math.max(finalBox.startX, finalBox.endX);
                  const boxMinY = Math.min(finalBox.startY, finalBox.endY);
                  const boxMaxY = Math.max(finalBox.startY, finalBox.endY);
                  
                  if ((boxMaxX - boxMinX) > 0.005 || (boxMaxY - boxMinY) > 0.005) {
                    const selected = pageMarkups.filter(m => {
                      if (m.readOnly) return false;
                      const bounds = getMarkupBounds(m);
                      if (!bounds) return false;
                      return !(bounds.maxX < boxMinX || bounds.minX > boxMaxX || 
                               bounds.maxY < boxMinY || bounds.minY > boxMaxY);
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
                  return;
                }

                // Handle polyline vertex drag completion
                if (isDraggingMarkupRef.current && draggingPolylinePointRef.current !== null && 
                    selectedMarkupRef.current && markupDragStartRef.current?.originalPoints) {
                  const pointIndex = markupDragStartRef.current.pointIndex;
                  const totalDeltaX = markupDragStartRef.current.totalDeltaX || 0;
                  const totalDeltaY = markupDragStartRef.current.totalDeltaY || 0;
                  const origPoint = markupDragStartRef.current.originalPoints[pointIndex];
                  
                  if (origPoint && (Math.abs(totalDeltaX) > 0.0001 || Math.abs(totalDeltaY) > 0.0001)) {
                    const newPointX = origPoint.x + totalDeltaX;
                    const newPointY = origPoint.y + totalDeltaY;
                    
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
                  
                  draggingPolylinePointRef.current = null;
                  if (setDraggingPolylinePoint) setDraggingPolylinePoint(null);
                  isDraggingMarkupRef.current = false;
                  setIsDraggingMarkup(false);
                  didDragMoveRef.current = false;
                  markupDragStartRef.current = null;
                  return;
                }

                // Handle drag/resize completion
                if (isDraggingMarkupRef.current || isResizingMarkupRef.current) {
                  // Apply accumulated drag delta
                  if (isDraggingMarkupRef.current && didDragMoveRef.current && selectedMarkupRef.current) {
                    const totalDeltaX = dragDeltaRef.current.x;
                    const totalDeltaY = dragDeltaRef.current.y;
                    if (Math.abs(totalDeltaX) > 0.001 || Math.abs(totalDeltaY) > 0.001) {
                      moveMarkup(selectedMarkupRef.current.id, totalDeltaX, totalDeltaY);
                      
                      // Update selectedMarkup immediately with new position to prevent jump-back
                      const moved = { ...selectedMarkupRef.current };
                      if (moved.points) {
                        moved.points = moved.points.map(p => ({ x: p.x + totalDeltaX, y: p.y + totalDeltaY }));
                      }
                      if (moved.startX !== undefined) {
                        moved.startX += totalDeltaX;
                        moved.startY += totalDeltaY;
                        moved.endX += totalDeltaX;
                        moved.endY += totalDeltaY;
                      }
                      if (moved.x !== undefined) {
                        moved.x += totalDeltaX;
                        moved.y += totalDeltaY;
                      }
                      if (moved.point1X !== undefined) {
                        moved.point1X += totalDeltaX;
                        moved.point1Y += totalDeltaY;
                        moved.point2X += totalDeltaX;
                        moved.point2Y += totalDeltaY;
                      }
                      setSelectedMarkup(moved);
                      selectedMarkupRef.current = moved;
                    }
                  }

                  // Reset drag delta and selection transform
                  dragDeltaRef.current = { x: 0, y: 0 };
                  if (continuousSelectionRef.current) continuousSelectionRef.current.style.transform = '';
                  if (selectedMarkupRef.current) {
                    const el = document.querySelector(`[data-markup-id="${selectedMarkupRef.current.id}"]`);
                    if (el) el.style.transform = '';
                  }
                  
                  if (didDragMoveRef.current || isResizingMarkupRef.current) {
                    setUnsavedMarkupFiles(prev => new Set([...prev, currentFileIdentifier]));
                  }

                  // If there was no movement and markup was already selected, deselect
                  if (isDraggingMarkupRef.current && !didDragMoveRef.current && wasAlreadySelectedRef.current && selectedMarkupRef.current) {
                    setSelectedMarkup(null);
                    selectedMarkupRef.current = null;
                  } else if (selectedMarkupRef.current) {
                    // Use setMarkups updater to read from latest state (not stale closure)
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
                  return;
                }

                // Handle new markup drawing completion
                if (!isDrawingMarkupRef.current || !currentMarkupRef.current) return;
                if (currentMarkupRef.current.page !== pageNum - 1) return;
                if (rafIdRef.current) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; }

                const markup = { ...currentMarkupRef.current };
                if (markup.points) markup.points = [...markup.points];
                if (drawingOverlayRef.current) drawingOverlayRef.current.innerHTML = '';

                if (markup.type === 'placementPreview') {
                  const dx = Math.abs(markup.endX - markup.startX);
                  const dy = Math.abs(markup.endY - markup.startY);
                  if (dx > 0.005 || dy > 0.005) {
                    const sym = markup.symbolData;
                    const minX = Math.min(markup.startX, markup.endX);
                    const minY = Math.min(markup.startY, markup.endY);
                    const maxX = Math.max(markup.startX, markup.endX);
                    const maxY = Math.max(markup.startY, markup.endY);
                    const placedWidth = maxX - minX;
                    const placedHeight = maxY - minY;
                    
                    if (sym.type === 'image' || sym.image) {
                      const imageMarkup = {
                        id: `image_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        type: 'image',
                        image: sym.image,
                        startX: minX, startY: minY, endX: maxX, endY: maxY,
                        page: markup.page,
                        filename: markup.filename,
                        aspectRatio: sym.aspectRatio || (placedWidth / placedHeight),
                        author: markupAuthor,
                        createdDate: new Date().toISOString()
                      };
                      addMarkupWithHistory(imageMarkup);
                      setUnsavedMarkupFiles(prev => new Set([...prev, currentFileIdentifier]));
                    } else if (sym.markups) {
                      const newMarkups = sym.markups.map(m => {
                        const newM = {
                          ...m,
                          id: `${m.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                          page: markup.page,
                          filename: markup.filename,
                        };
                        if (m.points) {
                          newM.points = m.points.map(p => ({
                            x: minX + p.x * placedWidth,
                            y: minY + p.y * placedHeight
                          }));
                        }
                        if (m.startX !== undefined) {
                          newM.startX = minX + m.startX * placedWidth;
                          newM.startY = minY + m.startY * placedHeight;
                          newM.endX = minX + m.endX * placedWidth;
                          newM.endY = minY + m.endY * placedHeight;
                        }
                        return newM;
                      });
                      setMarkupHistory(prev => [...prev, markups]);
                      setMarkups(prev => [...prev, ...newMarkups]);
                      setUnsavedMarkupFiles(prev => new Set([...prev, currentFileIdentifier]));
                    }
                  }
                  setPendingPlacement(null);
                  setCurrentMarkup(null); currentMarkupRef.current = null;
                  setIsDrawingMarkup(false); isDrawingMarkupRef.current = false;
                  return;
                }
                if (markup.type === 'pen' || markup.type === 'highlighter') {
                  if (markup.points && markup.points.length >= 2) {
                    addMarkupWithHistory(markup);
                    setUnsavedMarkupFiles(prev => new Set([...prev, currentFileIdentifier]));
                  }
                  setCurrentMarkup(null); currentMarkupRef.current = null;
                  setIsDrawingMarkup(false); isDrawingMarkupRef.current = false;
                } else if (['arrow', 'line', 'rectangle', 'circle', 'cloud', 'arc'].includes(markup.type)) {
                  const dx = Math.abs(markup.endX - markup.startX);
                  const dy = Math.abs(markup.endY - markup.startY);
                  if (dx > 0.005 || dy > 0.005) {
                    addMarkupWithHistory(markup);
                    setUnsavedMarkupFiles(prev => new Set([...prev, currentFileIdentifier]));
                  }
                  setCurrentMarkup(null); currentMarkupRef.current = null;
                  setIsDrawingMarkup(false); isDrawingMarkupRef.current = false;
                } else if (markup.type === 'text' || markup.type === 'callout') {
                  const dx = Math.abs(markup.endX - markup.startX);
                  const dy = Math.abs(markup.endY - markup.startY);
                  if (dx > 0.01 && dy > 0.01) {
                    const normalizedMarkup = {
                      ...markup,
                      startX: Math.min(markup.startX, markup.endX),
                      startY: Math.min(markup.startY, markup.endY),
                      endX: Math.max(markup.startX, markup.endX),
                      endY: Math.max(markup.startY, markup.endY),
                    };
                    addMarkupWithHistory(normalizedMarkup);
                    setUnsavedMarkupFiles(prev => new Set([...prev, currentFileIdentifier]));
                    setEditingTextMarkupId(normalizedMarkup.id);
                    setTextEditValue('');
                    setSelectedMarkup(normalizedMarkup);
                    selectedMarkupRef.current = normalizedMarkup;
                  }
                  setCurrentMarkup(null); currentMarkupRef.current = null;
                  setIsDrawingMarkup(false); isDrawingMarkupRef.current = false;
                }
              };

              const scaledStrokeWidth = (sw) => (sw || 2) * scale;
              const isPageVisible = visiblePages.has(pageNum);

              const handleContinuousPageDoubleClick = (e) => {
                // Finalize polyline on double-click
                if (currentMarkupRef.current && 
                    ['polyline', 'polylineArrow', 'cloudPolyline', 'polygon'].includes(currentMarkupRef.current.type) &&
                    currentMarkupRef.current.page === pageNum - 1) {
                  e.preventDefault();
                  e.stopPropagation();
                  
                  const m = currentMarkupRef.current;
                  const pointsToSave = m.points.slice(0, -1);
                  
                  if (pointsToSave.length >= 2) {
                    const allX = pointsToSave.map(p => p.x);
                    const allY = pointsToSave.map(p => p.y);
                    const newMarkup = {
                      ...m,
                      points: [...pointsToSave],
                      closed: false,
                      startX: Math.min(...allX),
                      startY: Math.min(...allY),
                      endX: Math.max(...allX),
                      endY: Math.max(...allY),
                      author: markupAuthor,
                      createdDate: new Date().toISOString()
                    };
                    delete newMarkup._cursorX;
                    delete newMarkup._cursorY;
                    addMarkupWithHistory(newMarkup);
                  }
                  
                  currentMarkupRef.current = null;
                  isDrawingMarkupRef.current = false;
                  if (drawingOverlayRef.current) drawingOverlayRef.current.innerHTML = '';
                  return;
                }
                
                // Double-click on a selected non-text markup → deselect (only in edit mode)
                if (markupEditMode && selectedMarkup && selectedMarkup.page === pageNum - 1) {
                  const { normalizedX, normalizedY } = getPageCoords(e);
                  const bounds = getMarkupBounds(selectedMarkup);
                  if (bounds) {
                    const pad = 0.015;
                    const isInBounds = normalizedX >= bounds.minX - pad && normalizedX <= bounds.maxX + pad &&
                                       normalizedY >= bounds.minY - pad && normalizedY <= bounds.maxY + pad;
                    if (isInBounds && selectedMarkup.type !== 'text' && selectedMarkup.type !== 'callout') {
                      setSelectedMarkup(null);
                      selectedMarkupRef.current = null;
                      return;
                    }
                  }
                }
                
                // Double-click on text markup → edit (only in edit mode)
                if (!markupEditMode) return;
                const { normalizedX, normalizedY } = getPageCoords(e);
                const hitMarkup = pageMarkups.find(m => {
                  if (m.readOnly) return false;
                  if (m.type !== 'text' && m.type !== 'callout') return false;
                  const bounds = getMarkupBounds(m);
                  if (!bounds) return false;
                  return normalizedX >= bounds.minX && normalizedX <= bounds.maxX &&
                         normalizedY >= bounds.minY && normalizedY <= bounds.maxY;
                });
                if (hitMarkup) {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditingTextMarkupId(hitMarkup.id);
                  setTextEditValue(hitMarkup.text || '');
                  setSelectedMarkup(hitMarkup);
                  selectedMarkupRef.current = hitMarkup;
                }
              };

              return (
                <div
                  key={pageNum}
                  className="pdf-continuous-page"
                  data-page={pageNum}
                  onMouseDown={handleContinuousPageMouseDown}
                  onMouseMove={handleContinuousPageMouseMove}
                  onMouseUp={handleContinuousPageMouseUp}
                  onDoubleClick={handleContinuousPageDoubleClick}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    try {
                      const symbolData = e.dataTransfer.getData('application/json');
                      if (symbolData) {
                        const symbol = JSON.parse(symbolData);
                        if (symbol) {
                          const { normalizedX, normalizedY } = getPageCoords(e);
                          if (symbol.type === 'image' && symbol.image) {
                            placeImageSymbol(symbol, normalizedX, normalizedY, pageNum - 1);
                          } else if (symbol.markups) {
                            placeSymbol(symbol, normalizedX, normalizedY, pageNum - 1);
                          }
                        }
                      }
                    } catch (err) {
                      console.error('Failed to drop symbol:', err);
                    }
                    setDraggingSymbol(null);
                  }}
                  onMouseLeave={(e) => {
                    if (isDraggingMarkupRef.current || isResizingMarkupRef.current) {
                      handleContinuousPageMouseUp(e);
                    }
                    if (isDrawingMarkupRef.current && currentMarkupRef.current?.page === pageNum - 1) {
                      if (!['polyline', 'polylineArrow', 'cloudPolyline', 'polygon'].includes(currentMarkupRef.current.type)) {
                        handleContinuousPageMouseUp(e);
                      }
                    }
                  }}
                  style={{
                    position: 'absolute',
                    left: continuousLayout.positions[pageNum]?.left || 0,
                    top: `calc(50% - ${pageHeight / 2}px)`,
                    width: pageWidth,
                    height: pageHeight,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    background: 'white',
                    overflow: 'hidden',
                    contain: 'strict',
                    containIntrinsicSize: `${pageWidth}px ${pageHeight}px`,
                    cursor: pendingPlacement ? 'crosshair' :
                      markupMode ?
                      (markupMode === 'pen' || markupMode === 'highlighter' ? 'crosshair' :
                       markupMode === 'eraser' ? 'pointer' :
                       markupMode === 'note' ? 'crosshair' :
                       markupMode === 'symbol' ? 'copy' : 'crosshair') :
                      (panMode ? (isPanning ? 'grabbing' : 'grab') :
                       zoomMode ? 'zoom-in' : 'default'),
                  }}
                >
                  {/* Canvas */}
                  <canvas
                    ref={el => { if (el) continuousCanvasRefs.current[pageNum] = el; }}
                    style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
                  />
                  {/* Loading indicator */}
                  {isPageVisible && !renderedPages.has(pageNum) && (
                    <div style={{
                      position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#999', fontSize: '14px', background: 'white', pointerEvents: 'none'
                    }}>
                      Loading page {pageNum}...
                    </div>
                  )}
                  {/* Page number label */}
                  <div style={{
                    position: 'absolute', bottom: '4px', left: '50%', transform: 'translateX(-50%)',
                    fontSize: '11px', color: '#3498db', background: 'rgba(232, 244, 252, 0.9)',
                    padding: '2px 8px', borderRadius: '3px', fontWeight: '600',
                    whiteSpace: 'nowrap', pointerEvents: 'none',
                  }}>
                    Page {pageNum}
                  </div>

                  {/* Markup SVG Overlay */}
                  <svg
                    className="markup-overlay"
                    viewBox={`0 0 ${pageWidth} ${pageHeight}`}
                    style={{
                      position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                      pointerEvents: (markupMode || selectMode || markupEditMode) ? 'auto' : 'none',
                    }}
                  >
                    {isPageVisible && overlaysReady && pageMarkups.map(markupFromList => {
                      const markup = (selectedMarkup && markupFromList.id === selectedMarkup.id) ? selectedMarkup : markupFromList;
                      const strokeWidth = scaledStrokeWidth(markup.strokeWidth);

                      return renderMarkupShape(markup, {
                        scaledWidth: pageWidth, scaledHeight: pageHeight, scale,
                        scaledStrokeWidth: strokeWidth,
                        rotation: rotation || 0, getLineDashArray,
                        selectedMarkup, markupMode, selectMode, markupEditMode,
                        editingTextMarkupId, expandedNotes, toggleNoteExpanded,
                        setEditingNoteId, setNoteText, setNoteDialogPosition, setShowNoteDialog,
                        canvasSize,
                      });
                    })}

                    {/* Selection handles for selected markup on this page */}
                    {selectedMarkup && selectedMarkup.page === pageNum - 1 && (markupEditMode || !selectedMarkup.fromPdf) &&
                      renderSelectionHandles({
                        selectedMarkup, getMarkupBounds,
                        scaledWidth: pageWidth, scaledHeight: pageHeight, scale,
                        gStyle: { pointerEvents: 'all' },
                        selectionRef: continuousSelectionRef,
                        draggingPolylinePoint: draggingPolylinePoint,
                        onRotateMouseDown: (e, centerX, centerY, currentRotation) => {
                          const svgEl = e.currentTarget.ownerSVGElement;
                          if (!svgEl) return;
                          const rect = svgEl.getBoundingClientRect();
                          const mouseX = e.clientX - rect.left;
                          const mouseY = e.clientY - rect.top;
                          const startAngle = Math.atan2(mouseY - centerY, mouseX - centerX) * 180 / Math.PI;
                          isRotatingMarkupRef.current = true;
                          if (setIsRotatingMarkup) setIsRotatingMarkup(true);
                          rotationStartRef.current = {
                            centerX, centerY,
                            startAngle,
                            initialRotation: currentRotation || 0,
                          };
                        },
                        onPolylinePointMouseDown: (e, pointIndex) => {
                          e.stopPropagation();
                          draggingPolylinePointRef.current = pointIndex;
                          isDraggingMarkupRef.current = true;
                          setIsDraggingMarkup(true);
                          if (setDraggingPolylinePoint) setDraggingPolylinePoint(pointIndex);
                          didDragMoveRef.current = false;
                          const { normalizedX, normalizedY } = getPageCoords(e);
                          const dragStart = { x: normalizedX, y: normalizedY, bounds: getMarkupBounds(selectedMarkup), page: pageNum - 1 };
                          markupDragStartRef.current = dragStart;
                          setMarkupDragStart(dragStart);
                        },
                      })
                    }

                    {/* Drawing overlay */}
                    <g className="drawing-overlay" data-page={pageNum}
                      ref={el => {
                        if (el && isDrawingMarkupRef.current && currentMarkupRef.current?.page === pageNum - 1) {
                          drawingOverlayRef.current = el;
                        }
                      }} />

                    {/* Zoom box overlay */}
                    {isDrawingZoomBox && zoomBox && zoomBox.page === pageNum && (
                      <rect
                        x={Math.min(zoomBox.startX, zoomBox.endX) * pageWidth}
                        y={Math.min(zoomBox.startY, zoomBox.endY) * pageHeight}
                        width={Math.abs(zoomBox.endX - zoomBox.startX) * pageWidth}
                        height={Math.abs(zoomBox.endY - zoomBox.startY) * pageHeight}
                        fill="rgba(52, 152, 219, 0.2)" stroke="white" strokeWidth={2} strokeDasharray="5,5" />
                    )}
                    {/* Selection box overlay */}
                    {isDrawingSelectionBox && selectionBox && selectionBox.page === pageNum - 1 && (
                      <rect
                        x={Math.min(selectionBox.startX, selectionBox.endX) * pageWidth}
                        y={Math.min(selectionBox.startY, selectionBox.endY) * pageHeight}
                        width={Math.abs(selectionBox.endX - selectionBox.startX) * pageWidth}
                        height={Math.abs(selectionBox.endY - selectionBox.startY) * pageHeight}
                        fill="rgba(52, 152, 219, 0.15)"
                        stroke="rgba(52, 152, 219, 0.8)"
                        strokeWidth={1}
                        strokeDasharray="4,4"
                      />
                    )}
                    <defs>
                      <marker id={`arrowhead-${pageNum}`} markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
                      </marker>
                    </defs>
                  </svg>

                  {/* === Hotspot / Object / Training / OCR / Region Overlay === */}
                  {isPageVisible && (
                    <div className="hotspot-overlay" style={{
                      position: 'absolute', top: 0, left: 0, width: pageWidth, height: pageHeight,
                      pointerEvents: 'none', zIndex: 15,
                    }}>
                      {/* Drawn Regions */}
                      {showRegionBoxes && !isZooming && overlaysReady && drawnRegions
                        .filter(region => {
                          if (region.page !== pageNum - 1) return false;
                          const regionFilename = region.filename;
                          const currentFilename = currentFile?.backendFilename || currentFile?.name;
                          return regionFilename === currentFilename;
                        })
                        .map((region) => {
                          const regionTypeColors = getRegionTypeColors(region.regionType);
                          const rFillColor = region.fillColor !== undefined ? region.fillColor : regionTypeColors.fillColor;
                          const rBorderColor = region.borderColor !== undefined ? region.borderColor : regionTypeColors.borderColor;
                          const isNoFill = rFillColor === 'none';
                          const isNoBorder = rBorderColor === 'none';
                          const displayBorderColor = isNoBorder ? 'transparent' : rBorderColor;
                          const displayFillColor = isNoFill ? 'transparent' : rFillColor;
                          const labelColor = isNoBorder ? (isNoFill ? '#666' : rFillColor) : rBorderColor;

                          if (region.shapeType === 'polyline' && region.polylinePoints) {
                            return (
                              <svg key={`region_${region.id}`} style={{
                                position: 'absolute', top: 0, left: 0, width: pageWidth, height: pageHeight,
                                pointerEvents: 'none', zIndex: 4,
                              }}>
                                <polygon points={region.polylinePoints.map(p => `${p.x * pageWidth},${p.y * pageHeight}`).join(' ')}
                                  fill={isNoFill ? 'transparent' : displayFillColor} fillOpacity={isNoFill ? 0 : 0.15}
                                  stroke={displayBorderColor} strokeWidth={isNoBorder ? 0 : 2} strokeDasharray={isNoBorder ? '' : '8,4'}
                                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                                  onClick={(e) => { e.stopPropagation(); setEditingRegion(region); setEditRegionName(region.subRegionName); setShowRegionEditDialog(true); }} />
                                {(!isNoFill || !isNoBorder) && (
                                  <foreignObject x={region.polylinePoints[0]?.x * pageWidth || 0} y={(region.polylinePoints[0]?.y * pageHeight || 0) - 22} width="200" height="20" style={{ overflow: 'visible' }}>
                                    <span style={{ display: 'inline-block', background: labelColor, color: 'white', padding: '2px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: '600', whiteSpace: 'nowrap', cursor: 'pointer' }}
                                      onClick={(e) => { e.stopPropagation(); setEditingRegion(region); setEditRegionName(region.subRegionName); setShowRegionEditDialog(true); }}>
                                      🗺️ {region.regionType}: {region.subRegionName}
                                    </span>
                                  </foreignObject>
                                )}
                              </svg>
                            );
                          }

                          return (
                            <div key={`region_${region.id}`}
                              className={`drawn-region-box ${region.shapeType === 'circle' ? 'circle' : ''}`}
                              style={{
                                left: region.bbox.x * pageWidth, top: region.bbox.y * pageHeight,
                                width: region.bbox.width * pageWidth, height: region.bbox.height * pageHeight,
                                pointerEvents: 'auto', cursor: 'pointer', position: 'absolute',
                                border: isNoBorder ? 'none' : `2px dashed ${displayBorderColor}`,
                                backgroundColor: isNoFill ? 'transparent' : `${displayFillColor}26`,
                                borderRadius: region.shapeType === 'circle' ? '50%' : '0', zIndex: 4,
                              }}
                              onMouseEnter={() => setHoveredRegion(region.id)}
                              onMouseLeave={() => setHoveredRegion(null)}
                              onClick={(e) => { e.stopPropagation(); setEditingRegion(region); setEditRegionName(region.subRegionName); setShowRegionEditDialog(true); }}>
                              {(!isNoFill || !isNoBorder) && (
                                <span className="region-box-label" style={{
                                  position: 'absolute', top: '-20px', left: '0', background: labelColor, color: 'white',
                                  padding: '2px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: '600',
                                  whiteSpace: 'nowrap', pointerEvents: 'auto', cursor: 'pointer',
                                }}
                                  onClick={(e) => { e.stopPropagation(); setEditingRegion(region); setEditRegionName(region.subRegionName); setShowRegionEditDialog(true); }}>
                                  🗺️ {region.regionType}: {region.subRegionName}
                                </span>
                              )}
                            </div>
                          );
                        })}

                      {/* Detected Objects */}
                      {showObjectBoxes && !isZooming && overlaysReady && (() => {
                        const fileMap = objectsByFilePage.get(currentFile?.backendFilename);
                        if (!fileMap) return null;
                        let pageObjects = fileMap.get(pageNum - 1) || [];
                        if (hiddenClasses.length > 0) {
                          pageObjects = pageObjects.filter(obj => !hiddenClasses.includes(obj.label) || obj.id === highlightedObjectId);
                        }
                        if (pageObjects.length === 0) return null;

                        // Build index map for object ordering
                        const objectIndexMap = new Map();
                        const allPageObjects = fileMap.get(pageNum - 1) || [];
                        allPageObjects.forEach((obj, idx) => objectIndexMap.set(obj.id, idx));

                        return pageObjects.map(obj => {
                          const classNames = [obj.label, obj.className, obj.parentClass];
                          const { fillColor: oFill, borderColor: oBorderRaw } = getClassColors(classNames);
                          let shapeType = obj.shapeType;
                          if (!shapeType) {
                            const model = objectModels.find(m =>
                              m.className === obj.label || m.className === obj.className || m.className === obj.parentClass
                            );
                            shapeType = model?.shapeType || getClassShapeType(classNames);
                          }
                          const isCircle = shapeType === 'circle';
                          const isPolyline = shapeType === 'polyline';
                          const isNoFill = oFill === 'none';
                          const isNoBorder = oBorderRaw === 'none';
                          const isFullyHidden = isNoFill && isNoBorder;
                          const bgColor = isNoFill ? 'transparent' : hexToRgba(oFill, 0.15);
                          const borderColor = isNoBorder ? 'transparent' : oBorderRaw;
                          const labelColor = isNoBorder ? (isNoFill ? '#666' : oFill) : oBorderRaw;

                          if (isFullyHidden) {
                            return (
                              <div key={`detected_${obj.id}`}
                                className={`detected-object-box ${hoveredObject === obj.id ? 'hovered' : ''} ${highlightedObjectId === obj.id ? 'highlighted' : ''} no-color`}
                                style={{
                                  left: obj.bbox.x * pageWidth, top: obj.bbox.y * pageHeight,
                                  width: obj.bbox.width * pageWidth, height: obj.bbox.height * pageHeight,
                                  pointerEvents: zoomMode ? 'none' : 'all', cursor: 'pointer',
                                  border: 'none', backgroundColor: 'transparent', zIndex: 10,
                                }}
                                onClick={() => { const imageData = captureObjectImage(obj); setObjectImagePreview(imageData); setSelectedObject({ ...obj, index: objectIndexMap.get(obj.id) ?? -1 }); setShowObjectEditDialog(true); }}
                                onMouseEnter={() => setHoveredObject(obj.id)}
                                onMouseLeave={() => setHoveredObject(null)}>
                                {(hoveredObject === obj.id || highlightedObjectId === obj.id) && (
                                  <div className="object-tooltip">
                                    <div><strong>{obj.label}</strong></div>
                                    {obj.subclassValues && Object.keys(obj.subclassValues).length > 0 ? (
                                      Object.entries(obj.subclassValues).map(([k, v]) => (<div key={k}>{k}: {v || '-'}</div>))
                                    ) : (obj.ocr_text && <div>Tag: {obj.ocr_text}</div>)}
                                    <div>Confidence: {((obj.confidence || 0) * 100).toFixed(0)}%</div>
                                    <div className="tooltip-hint">Click to edit</div>
                                  </div>
                                )}
                              </div>
                            );
                          }

                          if (isPolyline && obj.polylinePoints) {
                            return (
                              <svg key={`detected_${obj.id}`} style={{
                                position: 'absolute', top: 0, left: 0, width: pageWidth, height: pageHeight,
                                pointerEvents: 'none', zIndex: 10,
                              }}>
                                <polygon points={obj.polylinePoints.map(p => `${p.x * pageWidth},${p.y * pageHeight}`).join(' ')}
                                  fill={isNoFill ? 'transparent' : oFill} fillOpacity={isNoFill ? 0 : 0.15}
                                  stroke={isNoBorder ? 'transparent' : borderColor} strokeWidth={isNoBorder ? 0 : 2}
                                  style={{ pointerEvents: zoomMode ? 'none' : 'all', cursor: 'pointer' }}
                                  onClick={() => { const imageData = captureObjectImage(obj); setObjectImagePreview(imageData); setSelectedObject({ ...obj, index: objectIndexMap.get(obj.id) ?? -1 }); setShowObjectEditDialog(true); }} />
                              </svg>
                            );
                          }

                          return (
                            <div key={`detected_${obj.id}`}
                              className={`detected-object-box ${hoveredObject === obj.id ? 'hovered' : ''} ${highlightedObjectId === obj.id ? 'highlighted' : ''} ${isCircle ? 'circle-shape' : ''}`}
                              style={{
                                left: obj.bbox.x * pageWidth, top: obj.bbox.y * pageHeight,
                                width: obj.bbox.width * pageWidth, height: obj.bbox.height * pageHeight,
                                pointerEvents: zoomMode ? 'none' : 'all', cursor: 'pointer',
                                borderColor: borderColor, backgroundColor: bgColor,
                                borderRadius: isCircle ? '50%' : '0', borderWidth: isNoBorder ? '0' : '2px', zIndex: 10,
                              }}
                              onClick={() => { const imageData = captureObjectImage(obj); setObjectImagePreview(imageData); setSelectedObject({ ...obj, index: objectIndexMap.get(obj.id) ?? -1 }); setShowObjectEditDialog(true); }}
                              onMouseEnter={() => setHoveredObject(obj.id)}
                              onMouseLeave={() => setHoveredObject(null)}>
                              {(hoveredObject === obj.id || highlightedObjectId === obj.id) && (
                                <div className="object-tooltip">
                                  <div><strong>{obj.label}</strong></div>
                                  {obj.subclassValues && Object.keys(obj.subclassValues).length > 0 ? (
                                    Object.entries(obj.subclassValues).map(([k, v]) => (<div key={k}>{k}: {v || '-'}</div>))
                                  ) : (obj.ocr_text && <div>Tag: {obj.ocr_text}</div>)}
                                  <div>Confidence: {((obj.confidence || 0) * 100).toFixed(0)}%</div>
                                  <div className="tooltip-hint">Click to edit</div>
                                </div>
                              )}
                              {!hideLabels && (
                                <span className="object-box-label" style={{ backgroundColor: labelColor }}>
                                  {obj.ocr_text || obj.subclassValues?.Tag || obj.label}
                                </span>
                              )}
                            </div>
                          );
                        });
                      })()}

                      {/* Hotspots / Smart Links */}
                      {showLinksOnPdf && !isZooming && overlaysReady && (() => {
                        const pageHotspots = hotspotsByPage.get(pageNum - 1) || [];
                        if (pageHotspots.length === 0) return null;
                        return pageHotspots.map(hotspot => {
                          const targetFile = hotspot.targetFileId ? allFiles.find(f => f.id === hotspot.targetFileId) : null;
                          const isLinked = !!hotspot.targetFileId && !!targetFile;
                          const isBroken = !!hotspot.targetFileId && !targetFile;
                          const linkColors = project?.linkColors || {};
                          const assignedColors = linkColors.assigned || {};
                          const unassignedColors = linkColors.unassigned || {};
                          const colors = isLinked ? assignedColors : unassignedColors;
                          const defaultStroke = isLinked ? '#27ae60' : '#e74c3c';
                          const defaultFill = isLinked ? 'rgba(39, 174, 96, 0.3)' : 'rgba(231, 76, 60, 0.3)';
                          const showLine = colors.showLine !== false;
                          const showFill = colors.showFill !== false;
                          const strokeColor = colors.stroke || defaultStroke;
                          const fillColor = colors.fill || defaultFill;
                          return (
                            <div key={hotspot.id}
                              className={`hotspot ${hoveredHotspot === hotspot.id ? 'hovered' : ''} ${isLinked ? 'linked' : ''} ${isBroken ? 'broken' : ''} ${!hotspot.targetFileId ? 'unlinked' : ''} ${highlightedObjectId === hotspot.id ? 'highlighted' : ''}`}
                              style={{
                                left: hotspot.x * pageWidth, top: hotspot.y * pageHeight,
                                width: hotspot.width * pageWidth, height: hotspot.height * pageHeight,
                                pointerEvents: 'all',
                                borderColor: showLine ? strokeColor : 'transparent',
                                backgroundColor: showFill ? fillColor : 'transparent',
                              }}
                              onClick={() => handleHotspotClick(hotspot)}
                              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setHotspotContextMenu({ hotspot, x: e.clientX, y: e.clientY, targetFile, isLinked, isBroken }); }}
                              onMouseEnter={() => setHoveredHotspot(hotspot.id)}
                              onMouseLeave={() => setHoveredHotspot(null)}>
                              {hotspot.label && (
                                <div className={`hotspot-label ${isLinked ? 'linked' : ''} ${isBroken ? 'broken' : ''} ${!hotspot.targetFileId ? 'unlinked' : ''}`}
                                  style={{ backgroundColor: showLine ? strokeColor : (isLinked ? '#27ae60' : '#e74c3c') }}>
                                  {hotspot.label}
                                </div>
                              )}
                              {hoveredHotspot === hotspot.id && (
                                <div className="hotspot-tooltip">
                                  {isLinked
                                    ? `Target → ${targetFile.name}${hotspot.assignmentMode === 'property' ? ` (by ${hotspot.propertyName})` : ''}`
                                    : isBroken
                                      ? `Target → ${hotspot.targetFilename || 'Unknown'} (deleted)`
                                      : 'Unassigned'}
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}

                      {/* OCR Text Boxes */}
                      {showOcrOnPdf && ocrResults && ocrResults.length > 0 && (() => {
                        const pageOcr = ocrResults.filter(r => r.page === pageNum);
                        let filtered = pageOcr;
                        if (ocrFilter) {
                          const lowerFilter = ocrFilter.toLowerCase();
                          filtered = pageOcr.map(r => {
                            const idx = (r.text || '').toLowerCase().indexOf(lowerFilter);
                            if (idx === -1) return null;
                            return { ...r, matchStart: idx, matchLength: lowerFilter.length };
                          }).filter(Boolean);
                        }
                        return filtered.map((item, idx) => {
                          const isVertical = item.orientation && item.orientation !== 'horizontal';
                          const isVerticalUp = item.orientation === 'vertical-up';
                          const isVerticalDown = item.orientation === 'vertical-down';
                          const isPartialMatch = item.matchStart !== undefined && 
                            (item.matchStart > 0 || item.matchStart + item.matchLength < item.text.length);
                          const textStyle = {
                            position: 'absolute',
                            left: item.bbox.x * pageWidth, top: item.bbox.y * pageHeight,
                            fontSize: Math.max(10, Math.min(14, (isVertical ? item.bbox.width : item.bbox.height) * pageHeight * 0.8)),
                            color: 'white', fontWeight: 'bold',
                            textShadow: '1px 1px 2px black, -1px -1px 2px black, 1px -1px 2px black, -1px 1px 2px black',
                            pointerEvents: 'none', zIndex: 3, whiteSpace: 'nowrap',
                          };
                          if (isPartialMatch) { textStyle.background = 'transparent'; textStyle.border = 'none'; }
                          if (isVerticalUp) {
                            textStyle.transform = 'rotate(-90deg)';
                            textStyle.transformOrigin = 'left top';
                            textStyle.left = (item.bbox.x + item.bbox.width) * pageWidth;
                          } else if (isVerticalDown) {
                            textStyle.transform = 'rotate(90deg)';
                            textStyle.transformOrigin = 'left top';
                          }
                          return (
                            <div key={`ocr-${pageNum}-${idx}`} className={isPartialMatch ? 'ocr-text-overlay ocr-partial-match' : 'ocr-text-overlay'} style={textStyle}
                              title={`${item.displayText || item.text} (${(item.confidence * 100).toFixed(0)}%)${isVertical ? ' [vertical]' : ''}`}>
                              {isPartialMatch ? (<>
                                <span style={{ opacity: 0.4 }}>{item.text.slice(0, item.matchStart)}</span>
                                <span style={{ background: 'rgba(39, 174, 96, 0.55)', borderRadius: 2, padding: '0 1px' }}>{item.text.slice(item.matchStart, item.matchStart + item.matchLength)}</span>
                                <span style={{ opacity: 0.4 }}>{item.text.slice(item.matchStart + item.matchLength)}</span>
                              </>) : (item.displayText || item.text)}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
}

// Helper: point-to-line distance for drag hit testing
function pointToLineDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}
