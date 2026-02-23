import { useRef, useCallback } from 'react';
import '../PDFViewerArea.css';
import { renderMarkupShape } from '../renderMarkupShape';
import { renderSelectionHandles, ROTATE_CURSOR } from '../renderSelectionHandles';

/**
 * SinglePageView - Renders the single-page PDF view with canvas, SVG markup overlay,
 * and all object/hotspot/region/training box overlays.
 *
 * Extracted from PDFViewerArea.jsx (was ~3400 lines inline).
 * 
 * NOTE: This component receives many props because it is the primary interactive
 * PDF rendering surface. Future refactoring could introduce context or further
 * sub-component extraction.
 */
export default function SinglePageView(props) {
  // Destructure all needed props
  const {
    // Core viewer
    containerRef, canvasRef, singleScrollContentRef, singleCanvasContainerRef,
    viewMode, currentPage, numPages, rotation, scale, canvasSize, pageBaseDimensions,
    pdfBackgroundColor, overlaysReady, pdfDoc,
    // Mouse handlers
    handleMouseDown, handleMouseMove, handleMouseUp, handleDoubleClick,
    // Pan/zoom
    panMode, isPanning, isZooming, zoomMode, selectMode,
    setIsPanning, setPanStart, setPanMode, setZoomMode,
    // Markup state
    markupMode, markupEditMode, markups, currentMarkup, selectedMarkup, selectedMarkups,
    editingTextMarkupId, textEditValue, setTextEditValue, setEditingTextMarkupId,
    ownedPdfAnnotationIds, editingPdfAnnotationId,
    markupCanvasRef, drawingOverlayRef, annotationLayerRef,
    isDrawingMarkup, isDraggingMarkup, isResizingMarkup, isRotatingMarkup,
    hoveredMarkupId, hoveredMarkupIdRef,
    getLineDashArray, getMarkupCursor,
    handleMarkupContextMenu,
    // Notes
    expandedNotes, toggleNoteExpanded, showNoteDialog,
    setShowNoteDialog, setNoteDialogPosition, setNoteText, setEditingNoteId,
    // Text editing  
    editingMarkupText, setEditingMarkupText,
    markups_setMarkups: setMarkups,
    setSelectedMarkup, setSelectedMarkups,
    selectedMarkupRef,
    textInputRef,
    // Markup utilities
    getMarkupBounds, convertToEditableFormat, takeOwnershipOfAnnotation,
    markupFontSize, markupFontFamily, markupTextAlign, markupVerticalAlign,
    markupLineSpacing, markupColor,
    markupStrokeWidth, markupFillColor, markupBorderColor, markupLineStyle, markupStrokeOpacity,
    markupFillOpacity, markupCloudInverted, markupCloudArcSize,
    // Objects/detection
    showObjectBoxes, showObjectFinder, objectFinderMode, objectDrawType,
    styledDetectedObjects, styledTrainingBoxes,
    hoveredObject, setHoveredObject, highlightedObjectId,
    hideLabels, hiddenClasses, objectViewMode,
    detectedObjects, setDetectedObjects,
    setSelectedObject, setShowObjectEditDialog, setObjectImagePreview,
    captureObjectImage, objectIndexMap,
    savedObjects,
    // Links/hotspots
    showLinksOnPdf, showSmartLinks, linkMode,
    currentPageHotspots, hotspots, setHotspots,
    hoveredHotspot, setHoveredHotspot,
    trainingBoxes, setTrainingBoxes,
    currentRect, isDrawing,
    handleHotspotClick,
    setHotspotContextMenu,
    allFiles,
    // OCR
    showOcrOnPdf, filteredOcrResultsForDisplay,
    // Regions
    showRegionBoxes, drawnRegions,
    hoveredRegion, setHoveredRegion,
    setEditingRegion, setEditRegionName, setShowRegionEditDialog,
    // Shapes
    pendingShape, setPendingShape,
    drawingShapeType,
    polylinePoints, polylineMousePos, isNearStartPoint,
    cloudPoints, isShiftPressed,
    // Capture region
    captureRegion, symbolCaptureMode,
    // Selection box  
    selectionBox, isDrawingSelectionBox,
    // Zoom box
    zoomBox, isDrawingZoomBox,
    // Drawing overlay
    currentFileIdentifier,
    // Helpers
    hexToRgba, getClassColor, getClassColors, getClassShapeType, getRegionTypeColors,
    project, currentFile, objectModels,
    // Subclass
    objectTrainingBoxes,
    showDrawTypePopup, setShowDrawTypePopup,
    // Continuous layout refs (not used in single but needed for shared interface)
    continuousCanvasRefs,
    // Markup comments
    markupComments, setMarkupComments,
    showCommentInput, setShowCommentInput,
    commentInputText, setCommentInputText,
    markupAuthor,
    // Markup drag refs
    dragOffsetRef, continuousSelectionRef,
    selectedMarkupsRef,
    setIsDraggingMarkup, isDraggingMarkupRef,
    didDragMoveRef, wasAlreadySelectedRef,
    setMarkupDragStart, markupDragStartRef,
    draggingPolylinePoint, draggingPolylinePointRef, setDraggingPolylinePoint,
    isRotatingMarkupRef, rotationStartRef,
    setIsRotatingMarkup,
    // Object finder drawing
    objectTrainingBoxes_set: setObjectTrainingBoxes,
    // Pending parent box
    pendingParentBox, setPendingParentBox, setParentBoxImage,
    setShowSubclassRegionDialog, setCurrentSubclassIndex, setSubclassRegions,
    parentClassForTraining,
    // Notes
    noteText, editingNoteId,
    // Symbols
    savedSymbols, draggingSymbol, setDraggingSymbol, placeSymbol, placeImageSymbol,
    pendingPlacement,
    // Active handles
    activeResizeHandle, activeArcHandle, resizeHandle,
    // Computed dimensions
    scaledWidth, scaledHeight, transformCoordinate,
    // Computed per-page data
    currentPageMarkups,
    // Object/Region dialog setters
    setPendingRegionShape, setRegionTypeInput, setSubRegionNameInput,
    setRegionFillColorInput, setRegionBorderColorInput, setShowRegionAssignDialog,
    setPendingObjectBox, setObjectClassInput, setShowObjectClassDialog,
  } = props;

  return (
        <div 
          ref={containerRef}
          className="pdf-container"
          style={isRotatingMarkup ? { cursor: ROTATE_CURSOR } : undefined}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            handleMouseUp();
            // Clear hover state when leaving canvas
            if (hoveredMarkupIdRef.current) {
              const prevEl = document.querySelector(`[data-markup-id="${hoveredMarkupIdRef.current}"]`);
              if (prevEl) {
                prevEl.classList.remove('markup-hovered');
              }
              hoveredMarkupIdRef.current = null;
            }
          }}
          onDoubleClick={handleDoubleClick}
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
                if (symbol && canvasRef.current) {
                  const canvas = canvasRef.current;
                  const rect = canvas.getBoundingClientRect();
                  const x = (e.clientX - rect.left) / scale;
                  const y = (e.clientY - rect.top) / scale;
                  const centerX = x / canvasSize.width;
                  const centerY = y / canvasSize.height;
                  
                  // Handle both vector symbols (markups) and image symbols
                  if (symbol.type === 'image' && symbol.image) {
                    placeImageSymbol(symbol, centerX, centerY);
                  } else if (symbol.markups) {
                    placeSymbol(symbol, centerX, centerY);
                  }
                }
              }
            } catch (err) {
              console.error('Failed to drop symbol:', err);
            }
            setDraggingSymbol(null);
          }}
          style={{ 
            backgroundColor: pdfBackgroundColor,
            cursor: pendingPlacement ? 'crosshair' :
                    pendingShape ? 'default' :
                    symbolCaptureMode ? 'crosshair' :
                    (markupMode === 'select' || (selectMode && !markupMode && !panMode && !zoomMode)) ? (isDraggingMarkup ? 'grabbing' : isResizingMarkup ? (resizeHandle?.includes('n') || resizeHandle?.includes('s') ? 'ns-resize' : 'ew-resize') : 'default') :
                    (markupMode === 'pen' || markupMode === 'highlighter') ? getMarkupCursor() :
                    markupMode ? 'crosshair' :
                    (linkMode || objectFinderMode) ? 'crosshair' : 
                    panMode ? (isPanning ? 'grabbing' : 'grab') : 
                    zoomMode ? 'zoom-in' : 'default'
          }}
        >
            <div 
              ref={singleScrollContentRef}
              className="pdf-scroll-content"
              style={{
                width: scaledWidth + 80,
                height: scaledHeight + 80,
                minWidth: '100%',
                minHeight: '100%',
              }}
            >
              <div 
                ref={singleCanvasContainerRef}
                className="pdf-canvas-container"
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: scaledWidth,
                  height: scaledHeight,
                }}
              >
                <canvas 
                  ref={canvasRef} 
                  className="pdf-canvas"
                  style={{ 
                    width: '100%', 
                    height: '100%',
                    display: 'block'
                  }}
                />
                
                {/* Annotation Layer - reserved for future use */}
                <div 
                  ref={annotationLayerRef}
                  className="annotation-layer"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                    overflow: 'hidden',
                    display: 'none' // Not currently used
                  }}
                />

                {/* Markup SVG Overlay */}
                {scaledWidth > 0 && scaledHeight > 0 && !isNaN(scaledWidth) && !isNaN(scaledHeight) && (
                <svg
                viewBox={`0 0 ${scaledWidth} ${scaledHeight}`}
                className={`markup-overlay${isDrawingMarkup ? ' is-drawing' : ''}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  overflow: 'visible',
                  pointerEvents: (markupMode || selectMode || markupEditMode) && !symbolCaptureMode ? 'auto' : 'none',
                  cursor: isRotatingMarkup ? ROTATE_CURSOR :
                          markupMode === 'select' ? (isDraggingMarkup ? 'grabbing' : 'default') : 
                          (markupMode === 'pen' || markupMode === 'highlighter') ? getMarkupCursor() :
                          markupMode ? 'crosshair' : 
                          symbolCaptureMode ? 'crosshair' :
                          selectMode ? 'default' : 'default'
                }}
                onContextMenu={(e) => {
                  // Handle right-click on markups
                  if (!canvasRef.current || !currentPageMarkups) return;
                  const rect = canvasRef.current.getBoundingClientRect();
                  const x = (e.clientX - rect.left) / scale;
                  const y = (e.clientY - rect.top) / scale;
                  const clickX = x / canvasSize.width;
                  const clickY = y / canvasSize.height;

                  // Simple bounds-based hit test against current page markups
                  const pad = 0.01;
                  for (let i = currentPageMarkups.length - 1; i >= 0; i--) {
                    const m = currentPageMarkups[i];
                    if (m.readOnly) continue;
                    const bounds = getMarkupBounds(m);
                    if (!bounds) continue;
                    if (clickX >= bounds.minX - pad && clickX <= bounds.maxX + pad &&
                        clickY >= bounds.minY - pad && clickY <= bounds.maxY + pad) {
                      handleMarkupContextMenu(e, m);
                      return;
                    }
                  }
                }}
              >
                {/* Render all markups */}
                {currentPageMarkups && currentPageMarkups.map(markupFromList => {
                  const markup = (selectedMarkup && markupFromList.id === selectedMarkup.id) ? selectedMarkup : markupFromList;
                  const scaledSW = (markup.strokeWidth || 2) * scale;
                  return renderMarkupShape(markup, {
                    scaledWidth, scaledHeight, scale,
                    scaledStrokeWidth: scaledSW,
                    rotation, transformCoordinate, getLineDashArray,
                    selectedMarkup, markupMode, selectMode, markupEditMode,
                    editingTextMarkupId, expandedNotes, toggleNoteExpanded,
                    setEditingNoteId, setNoteText, setNoteDialogPosition, setShowNoteDialog,
                    canvasSize,
                  });
                })}
                
                {/* Render current markup being drawn */}
                {currentMarkup && (
                  <>
                    {(currentMarkup.type === 'pen' || currentMarkup.type === 'highlighter') && currentMarkup.points && currentMarkup.points.length >= 1 && (
                      <path
                        data-drawing-preview="path"
                        d={currentMarkup.points
                          .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * scaledWidth} ${p.y * scaledHeight}`)
                          .join(' ')}
                        stroke={currentMarkup.color}
                        strokeWidth={currentMarkup.strokeWidth * scale}
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={currentMarkup.opacity || 1}
                      />
                    )}
                    {currentMarkup.type === 'rectangle' && (() => {
                      const dashArray = currentMarkup.lineStyle ? getLineDashArray(currentMarkup.lineStyle, currentMarkup.strokeWidth * scale) : null;
                      return (
                        <rect
                          data-drawing-preview="rect"
                          x={Math.min(currentMarkup.startX, currentMarkup.endX) * scaledWidth}
                          y={Math.min(currentMarkup.startY, currentMarkup.endY) * scaledHeight}
                          width={Math.abs(currentMarkup.endX - currentMarkup.startX) * scaledWidth}
                          height={Math.abs(currentMarkup.endY - currentMarkup.startY) * scaledHeight}
                          stroke={currentMarkup.color}
                          strokeWidth={currentMarkup.strokeWidth * scale}
                          strokeOpacity={currentMarkup.strokeOpacity !== undefined ? currentMarkup.strokeOpacity : 1}
                          strokeDasharray={dashArray ? dashArray.join(',') : undefined}
                          fill={currentMarkup.fillColor === 'none' ? 'transparent' : (currentMarkup.fillColor || 'none')}
                          fillOpacity={currentMarkup.fillColor === 'none' ? 0 : (currentMarkup.fillOpacity !== undefined ? currentMarkup.fillOpacity : 0.3)}
                        />
                      );
                    })()}
                    {currentMarkup.type === 'text' && (
                      <rect
                        data-drawing-preview="text"
                        x={Math.min(currentMarkup.startX, currentMarkup.endX) * scaledWidth}
                        y={Math.min(currentMarkup.startY, currentMarkup.endY) * scaledHeight}
                        width={Math.abs(currentMarkup.endX - currentMarkup.startX) * scaledWidth}
                        height={Math.abs(currentMarkup.endY - currentMarkup.startY) * scaledHeight}
                        stroke="white"
                        strokeWidth={2 * scale}
                        fill="rgba(52, 152, 219, 0.1)"
                        strokeDasharray={`${6 * scale},${3 * scale}`}
                      />
                    )}
                    {currentMarkup.type === 'arrow' && (() => {
                      const x1 = currentMarkup.startX * scaledWidth;
                      const y1 = currentMarkup.startY * scaledHeight;
                      const x2 = currentMarkup.endX * scaledWidth;
                      const y2 = currentMarkup.endY * scaledHeight;
                      const angle = Math.atan2(y2 - y1, x2 - x1);
                      const arrowLength = (currentMarkup.arrowHeadSize || 12) * scale;
                      const arrowAngle = Math.PI / 7;
                      const lineEndX = x2 - arrowLength * 0.7 * Math.cos(angle);
                      const lineEndY = y2 - arrowLength * 0.7 * Math.sin(angle);
                      const dashArray = currentMarkup.lineStyle ? getLineDashArray(currentMarkup.lineStyle, currentMarkup.strokeWidth * scale) : null;
                      
                      return (
                        <g data-drawing-preview="arrow">
                          <line
                            data-drawing-preview="arrow-line"
                            x1={x1}
                            y1={y1}
                            x2={lineEndX}
                            y2={lineEndY}
                            stroke={currentMarkup.color}
                            strokeWidth={currentMarkup.strokeWidth * scale}
                            strokeDasharray={dashArray ? dashArray.join(',') : undefined}
                          />
                          <polygon
                            data-drawing-preview="arrow-head"
                            points={`
                              ${x2},${y2}
                              ${x2 - arrowLength * Math.cos(angle - arrowAngle)},${y2 - arrowLength * Math.sin(angle - arrowAngle)}
                              ${x2 - arrowLength * Math.cos(angle + arrowAngle)},${y2 - arrowLength * Math.sin(angle + arrowAngle)}
                            `}
                            fill={currentMarkup.color}
                          />
                        </g>
                      );
                    })()}
                    {currentMarkup.type === 'circle' && (() => {
                      const dashArray = currentMarkup.lineStyle ? getLineDashArray(currentMarkup.lineStyle, currentMarkup.strokeWidth * scale) : null;
                      return (
                        <ellipse
                          data-drawing-preview="circle"
                          cx={((currentMarkup.startX + currentMarkup.endX) / 2) * scaledWidth}
                          cy={((currentMarkup.startY + currentMarkup.endY) / 2) * scaledHeight}
                          rx={Math.abs(currentMarkup.endX - currentMarkup.startX) * scaledWidth / 2}
                          ry={Math.abs(currentMarkup.endY - currentMarkup.startY) * scaledHeight / 2}
                          stroke={currentMarkup.color}
                          strokeWidth={currentMarkup.strokeWidth * scale}
                          strokeOpacity={currentMarkup.strokeOpacity !== undefined ? currentMarkup.strokeOpacity : 1}
                          strokeDasharray={dashArray ? dashArray.join(',') : undefined}
                          fill={currentMarkup.fillColor === 'none' ? 'transparent' : (currentMarkup.fillColor || 'none')}
                          fillOpacity={currentMarkup.fillColor === 'none' ? 0 : (currentMarkup.fillOpacity !== undefined ? currentMarkup.fillOpacity : 0.3)}
                        />
                      );
                    })()}
                    {currentMarkup.type === 'arc' && (() => {
                      // 3-point arc preview
                      const p1x = currentMarkup.point1X * scaledWidth;
                      const p1y = currentMarkup.point1Y * scaledHeight;
                      const p2x = currentMarkup.point2X * scaledWidth;
                      const p2y = currentMarkup.point2Y * scaledHeight;
                      const bulge = currentMarkup.arcBulge !== undefined ? currentMarkup.arcBulge : 0.5;
                      const dashArray = currentMarkup.lineStyle ? getLineDashArray(currentMarkup.lineStyle, currentMarkup.strokeWidth * scale) : null;
                      
                      // Calculate control point for quadratic bezier
                      const midX = (p1x + p2x) / 2;
                      const midY = (p1y + p2y) / 2;
                      const chordDx = p2x - p1x;
                      const chordDy = p2y - p1y;
                      const chordLen = Math.sqrt(chordDx * chordDx + chordDy * chordDy);
                      
                      // Perpendicular unit vector
                      const perpX = chordLen > 0 ? -chordDy / chordLen : 0;
                      const perpY = chordLen > 0 ? chordDx / chordLen : 1;
                      
                      // Control point offset
                      const bulgeOffset = chordLen * bulge;
                      const ctrlX = midX + perpX * bulgeOffset;
                      const ctrlY = midY + perpY * bulgeOffset;
                      
                      const arcPath = `M ${p1x} ${p1y} Q ${ctrlX} ${ctrlY} ${p2x} ${p2y}`;
                      
                      return (
                        <path
                          data-drawing-preview="arc"
                          d={arcPath}
                          stroke={currentMarkup.color}
                          strokeWidth={currentMarkup.strokeWidth * scale}
                          strokeOpacity={currentMarkup.strokeOpacity !== undefined ? currentMarkup.strokeOpacity : 1}
                          strokeDasharray={dashArray ? dashArray.join(',') : undefined}
                          fill="none"
                          strokeLinecap="round"
                        />
                      );
                    })()}
                    {currentMarkup.type === 'line' && (() => {
                      const dashArray = currentMarkup.lineStyle ? getLineDashArray(currentMarkup.lineStyle, currentMarkup.strokeWidth * scale) : null;
                      return (
                        <line
                          data-drawing-preview="line"
                          x1={currentMarkup.startX * scaledWidth}
                          y1={currentMarkup.startY * scaledHeight}
                          x2={currentMarkup.endX * scaledWidth}
                          y2={currentMarkup.endY * scaledHeight}
                          stroke={currentMarkup.color}
                          strokeWidth={currentMarkup.strokeWidth * scale}
                          strokeDasharray={dashArray ? dashArray.join(',') : undefined}
                        />
                      );
                    })()}
                    {currentMarkup.type === 'cloud' && (() => {
                      const x = Math.min(currentMarkup.startX, currentMarkup.endX) * scaledWidth;
                      const y = Math.min(currentMarkup.startY, currentMarkup.endY) * scaledHeight;
                      const w = Math.abs(currentMarkup.endX - currentMarkup.startX) * scaledWidth;
                      const h = Math.abs(currentMarkup.endY - currentMarkup.startY) * scaledHeight;
                      const fillColor = currentMarkup.fillColor === 'none' ? 'transparent' : (currentMarkup.fillColor || 'none');
                      
                      // Always use <path> so mousemove can update d attribute directly
                      let d = `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
                      
                      if (w >= 10 && h >= 10) {
                        // Generate actual cloud arc path
                        const inverted = currentMarkup.inverted || false;
                        const sweepOut = inverted ? 0 : 1;
                        const refSize = 800;
                        const normW = Math.abs(currentMarkup.endX - currentMarkup.startX) * refSize;
                        const normH = Math.abs(currentMarkup.endY - currentMarkup.startY) * refSize;
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
                        
                        d = `M ${x} ${y}`;
                        for (let i = 0; i < numArcsX; i++) d += ` A ${arcR} ${arcR} 0 0 ${sweepOut} ${x + (i+1)*spacingX} ${y}`;
                        for (let i = 0; i < numArcsY; i++) d += ` A ${arcR} ${arcR} 0 0 ${sweepOut} ${x+w} ${y + (i+1)*spacingY}`;
                        for (let i = numArcsX-1; i >= 0; i--) d += ` A ${arcR} ${arcR} 0 0 ${sweepOut} ${x + i*spacingX} ${y+h}`;
                        for (let i = numArcsY-1; i >= 0; i--) d += ` A ${arcR} ${arcR} 0 0 ${sweepOut} ${x} ${y + i*spacingY}`;
                        d += ' Z';
                      }
                      
                      return (
                        <path
                          data-drawing-preview="cloud"
                          d={d}
                          stroke={currentMarkup.color}
                          strokeWidth={currentMarkup.strokeWidth * scale}
                          strokeOpacity={currentMarkup.strokeOpacity !== undefined ? currentMarkup.strokeOpacity : 1}
                          fill={fillColor}
                          fillOpacity={currentMarkup.fillColor === 'none' ? 0 : (currentMarkup.fillOpacity !== undefined ? currentMarkup.fillOpacity : 0.3)}
                        />
                      );
                    })()}
                    {currentMarkup.type === 'callout' && (
                      <g>
                        <rect
                          x={Math.min(currentMarkup.startX, currentMarkup.endX) * scaledWidth}
                          y={Math.min(currentMarkup.startY, currentMarkup.endY) * scaledHeight}
                          width={Math.abs(currentMarkup.endX - currentMarkup.startX) * scaledWidth}
                          height={Math.abs(currentMarkup.endY - currentMarkup.startY) * scaledHeight}
                          rx={4 * scale}
                          stroke={currentMarkup.color}
                          strokeWidth={currentMarkup.strokeWidth * scale}
                          fill="rgba(255,255,255,0.9)"
                        />
                      </g>
                    )}
                    {currentMarkup.type === 'placementPreview' && (() => {
                      const px = Math.min(currentMarkup.startX, currentMarkup.endX) * scaledWidth;
                      const py = Math.min(currentMarkup.startY, currentMarkup.endY) * scaledHeight;
                      const pw = Math.abs(currentMarkup.endX - currentMarkup.startX) * scaledWidth;
                      const ph = Math.abs(currentMarkup.endY - currentMarkup.startY) * scaledHeight;
                      const sym = currentMarkup.symbolData;
                      const imgSrc = sym?.image || sym?.preview || '';
                      return (
                        <g>
                          <rect
                            data-drawing-preview="placement-rect"
                            x={px} y={py} width={pw} height={ph}
                            stroke="#3498db" strokeWidth={2} fill="rgba(52,152,219,0.05)"
                            strokeDasharray="6,4" rx={2}
                          />
                          {imgSrc && (
                            <image
                              data-drawing-preview="placement-img"
                              href={imgSrc}
                              x={px} y={py} width={pw} height={ph}
                              preserveAspectRatio="xMidYMid meet"
                              opacity={0.7}
                            />
                          )}
                        </g>
                      );
                    })()}
                  </>
                )}
                
                {/* Polyline drawing preview */}
                {markupMode === 'polyline' && cloudPoints.length > 0 && (() => {
                  const startPt = cloudPoints[0];
                  
                  // Get dash array for line style
                  const dashArray = markupLineStyle ? getLineDashArray(markupLineStyle, markupStrokeWidth * scale) : null;
                  
                  return (
                    <g>
                      {/* Filled preview when will close - DOM controlled */}
                      {markupFillColor !== 'none' && cloudPoints.length >= 3 && (
                        <path
                          data-polyline-fill-preview="true"
                          d={cloudPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * scaledWidth} ${p.y * scaledHeight}`).join(' ') + ' Z'}
                          fill={markupFillColor}
                          fillOpacity={markupFillOpacity * 0.5}
                          stroke="none"
                          style={{ display: 'none' }}
                        />
                      )}
                      
                      {/* Lines between points */}
                      {cloudPoints.map((point, i) => {
                        if (i === 0 || !point) return null;
                        const prev = cloudPoints[i - 1];
                        if (!prev) return null;
                        return (
                          <line
                            key={`polyline-${i}`}
                            x1={prev.x * scaledWidth}
                            y1={prev.y * scaledHeight}
                            x2={point.x * scaledWidth}
                            y2={point.y * scaledHeight}
                            stroke={markupColor}
                            strokeWidth={markupStrokeWidth * scale}
                            strokeOpacity={markupStrokeOpacity}
                            strokeDasharray={dashArray ? dashArray.join(',') : undefined}
                          />
                        );
                      })}
                      
                      {/* Preview line from last point to mouse - ALWAYS rendered, position controlled by DOM */}
                      {cloudPoints.length > 0 && cloudPoints[cloudPoints.length - 1] && (
                        <line
                          data-polyline-preview="main"
                          x1={cloudPoints[cloudPoints.length - 1].x * scaledWidth}
                          y1={cloudPoints[cloudPoints.length - 1].y * scaledHeight}
                          x2={cloudPoints[cloudPoints.length - 1].x * scaledWidth}
                          y2={cloudPoints[cloudPoints.length - 1].y * scaledHeight}
                          stroke={markupColor}
                          strokeWidth={markupStrokeWidth * scale}
                          strokeDasharray="5,5"
                          opacity="0.7"
                        />
                      )}
                      
                      {/* Preview line to start point when close enough - controlled by DOM display property */}
                      {cloudPoints.length >= 3 && (
                        <line
                          data-polyline-preview="close"
                          x1={cloudPoints[cloudPoints.length - 1].x * scaledWidth}
                          y1={cloudPoints[cloudPoints.length - 1].y * scaledHeight}
                          x2={startPt.x * scaledWidth}
                          y2={startPt.y * scaledHeight}
                          stroke="white"
                          strokeWidth={markupStrokeWidth * scale}
                          strokeDasharray="5,5"
                          opacity="0.7"
                          style={{ display: 'none' }}
                        />
                      )}
                      
                      {/* Points - fixed screen size */}
                      {cloudPoints.filter(p => p && p.x !== undefined).map((point, i) => (
                        <circle
                          key={`pt-${i}`}
                          data-polyline-start={i === 0 ? "true" : undefined}
                          cx={point.x * scaledWidth}
                          cy={point.y * scaledHeight}
                          r={i === 0 ? 6 : 4}
                          fill={i === 0 ? '#27ae60' : markupColor}
                          stroke="white"
                          strokeWidth={1.5}
                        />
                      ))}
                      
                      {/* "Click to close" hint - controlled by DOM */}
                      {cloudPoints.length >= 3 && (
                        <text
                          data-polyline-close-hint="true"
                          x={startPt.x * scaledWidth}
                          y={startPt.y * scaledHeight - 18}
                          fill="white"
                          fontSize={11}
                          textAnchor="middle"
                          fontWeight="bold"
                          style={{ display: 'none' }}
                        >
                          Click to close
                        </text>
                      )}
                      
                      {/* Shift snap indicator - fixed screen size */}
                      {isShiftPressed && cloudPoints.length > 0 && cloudPoints[cloudPoints.length - 1] && (
                        <text
                          x={cloudPoints[cloudPoints.length - 1].x * scaledWidth + 12}
                          y={cloudPoints[cloudPoints.length - 1].y * scaledHeight - 8}
                          fill="#3498db"
                          fontSize={9}
                        >
                          ⇢ Snap
                        </text>
                      )}
                    </g>
                  );
                })()}
                
                {/* Polyline Arrow preview */}
                {markupMode === 'polylineArrow' && cloudPoints.length > 0 && (() => {
                  // Get dash array for line style
                  const dashArray = markupLineStyle ? getLineDashArray(markupLineStyle, markupStrokeWidth * scale) : null;
                  const startPt = cloudPoints[0];
                  
                  return (
                    <g>
                      {/* Filled preview polygon - controlled by DOM */}
                      {markupFillColor !== 'none' && cloudPoints.length >= 3 && (
                        <path
                          data-polyline-fill-preview="true"
                          d={cloudPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * scaledWidth} ${p.y * scaledHeight}`).join(' ') + ' Z'}
                          fill={markupFillColor}
                          fillOpacity={markupFillOpacity * 0.5}
                          stroke="none"
                          style={{ display: 'none' }}
                        />
                      )}
                      
                      {/* Lines between points */}
                      {cloudPoints.map((point, i) => {
                        if (i === 0 || !point) return null;
                        const prev = cloudPoints[i - 1];
                        if (!prev) return null;
                        return (
                          <line
                            key={`polyarrow-${i}`}
                            x1={prev.x * scaledWidth}
                            y1={prev.y * scaledHeight}
                            x2={point.x * scaledWidth}
                            y2={point.y * scaledHeight}
                            stroke={markupColor}
                            strokeWidth={markupStrokeWidth * scale}
                            strokeOpacity={markupStrokeOpacity}
                            strokeDasharray={dashArray ? dashArray.join(',') : undefined}
                          />
                        );
                      })}
                      
                      {/* Preview line from last point to mouse - DOM controlled */}
                      {cloudPoints.length > 0 && cloudPoints[cloudPoints.length - 1] && (
                        <>
                          <line
                            data-polyline-preview="main"
                            x1={cloudPoints[cloudPoints.length - 1].x * scaledWidth}
                            y1={cloudPoints[cloudPoints.length - 1].y * scaledHeight}
                            x2={cloudPoints[cloudPoints.length - 1].x * scaledWidth}
                            y2={cloudPoints[cloudPoints.length - 1].y * scaledHeight}
                            stroke={markupColor}
                            strokeWidth={markupStrokeWidth * scale}
                            strokeDasharray="5,5"
                            opacity="0.7"
                          />
                          {/* Arrowhead preview - DOM controlled */}
                          <polygon
                            data-polyline-preview="arrowhead"
                            points="0,0 0,0 0,0"
                            fill={markupColor}
                            opacity="0.7"
                          />
                        </>
                      )}
                      
                      {/* Preview line to start point - DOM controlled */}
                      {cloudPoints.length >= 3 && (
                        <line
                          data-polyline-preview="close"
                          x1={cloudPoints[cloudPoints.length - 1].x * scaledWidth}
                          y1={cloudPoints[cloudPoints.length - 1].y * scaledHeight}
                          x2={startPt.x * scaledWidth}
                          y2={startPt.y * scaledHeight}
                          stroke="white"
                          strokeWidth={markupStrokeWidth * scale}
                          strokeDasharray="5,5"
                          opacity="0.7"
                          style={{ display: 'none' }}
                        />
                      )}
                      
                      {/* Points - fixed screen size */}
                      {cloudPoints.filter(p => p && p.x !== undefined).map((point, i) => (
                        <circle
                          key={`ptarr-${i}`}
                          data-polyline-start={i === 0 ? "true" : undefined}
                          cx={point.x * scaledWidth}
                          cy={point.y * scaledHeight}
                          r={i === 0 ? 6 : 4}
                          fill={i === 0 ? '#27ae60' : markupColor}
                          stroke="white"
                          strokeWidth={1.5}
                        />
                      ))}
                      
                      {/* "Click to close" hint - DOM controlled */}
                      {cloudPoints.length >= 3 && (
                        <text
                          data-polyline-close-hint="true"
                          x={startPt.x * scaledWidth + 14}
                          y={startPt.y * scaledHeight - 4}
                          fill="white"
                          fontSize={11}
                          fontWeight="600"
                          style={{ display: 'none' }}
                        >
                          Click to close
                        </text>
                      )}
                      
                      {/* Shift snap indicator */}
                      {isShiftPressed && cloudPoints.length > 0 && cloudPoints[cloudPoints.length - 1] && (
                        <text
                          x={cloudPoints[cloudPoints.length - 1].x * scaledWidth + 12}
                          y={cloudPoints[cloudPoints.length - 1].y * scaledHeight - 8}
                          fill="#3498db"
                          fontSize={9}
                        >
                          ⇢ Snap
                        </text>
                      )}
                    </g>
                  );
                })()}
                
                {/* Cloud Polyline preview */}
                {markupMode === 'cloudPolyline' && cloudPoints.length > 0 && (() => {
                  const inverted = markupCloudInverted;
                  const sweepDir = inverted ? 0 : 1;
                  
                  const startPt = cloudPoints[0];
                  
                  // Build cloud path ONLY for completed segments (not the preview to mouse)
                  let cloudPath = '';
                  const validAllPoints = cloudPoints.filter(p => p && p.x !== undefined && p.y !== undefined);
                  
                  // Use user-specified arc size
                  const baseSize = 800;
                  const normArcDiameter = markupCloudArcSize; // Use arcSize directly
                  
                  for (let i = 0; i < validAllPoints.length - 1; i++) {
                    const p1 = validAllPoints[i];
                    const p2 = validAllPoints[i + 1];
                    if (!p1 || !p2) continue;
                    
                    // Normalized segment length (for arc count)
                    const normDx = (p2.x - p1.x) * baseSize;
                    const normDy = (p2.y - p1.y) * baseSize;
                    const normSegmentLength = Math.sqrt(normDx * normDx + normDy * normDy);
                    
                    // Screen space coordinates
                    const x1 = p1.x * scaledWidth;
                    const y1 = p1.y * scaledHeight;
                    const x2 = p2.x * scaledWidth;
                    const y2 = p2.y * scaledHeight;
                    const dx = x2 - x1;
                    const dy = y2 - y1;
                    const segmentLength = Math.sqrt(dx * dx + dy * dy);
                    
                    if (segmentLength < 1) continue;
                    
                    // Number of arcs based on NORMALIZED length (constant regardless of zoom)
                    const numArcs = Math.max(1, Math.round(normSegmentLength / normArcDiameter));
                    const actualArcDiameter = segmentLength / numArcs;
                    const arcRadius = actualArcDiameter / 2;
                    
                    const ux = dx / segmentLength;
                    const uy = dy / segmentLength;
                    
                    if (i === 0) {
                      cloudPath += `M ${x1} ${y1}`;
                    }
                    
                    for (let j = 0; j < numArcs; j++) {
                      const endX = x1 + ux * actualArcDiameter * (j + 1);
                      const endY = y1 + uy * actualArcDiameter * (j + 1);
                      cloudPath += ` A ${arcRadius} ${arcRadius} 0 0 ${sweepDir} ${endX} ${endY}`;
                    }
                  }
                  
                  // Note: Closing segment is shown via simple line when near start (DOM controlled)
                  
                  const lastValidPoint = validAllPoints[validAllPoints.length - 1];
                  
                  return (
                    <g>
                      {/* Completed cloud path (doesn't include mouse preview) */}
                      {cloudPath && (
                        <path
                          d={cloudPath}
                          stroke={markupColor}
                          strokeWidth={markupStrokeWidth * scale}
                          strokeOpacity={markupStrokeOpacity}
                          fill="none"
                        />
                      )}
                      
                      {/* PERFORMANCE: Simple dashed line preview from last point to mouse - DOM controlled */}
                      {lastValidPoint && (
                        <line
                          data-polyline-preview="main"
                          x1={lastValidPoint.x * scaledWidth}
                          y1={lastValidPoint.y * scaledHeight}
                          x2={lastValidPoint.x * scaledWidth}
                          y2={lastValidPoint.y * scaledHeight}
                          stroke={markupColor}
                          strokeWidth={markupStrokeWidth * scale}
                          strokeDasharray="5,5"
                          opacity="0.7"
                        />
                      )}
                      
                      {/* Close line preview - DOM controlled */}
                      {cloudPoints.length >= 3 && (
                        <line
                          data-polyline-preview="close"
                          x1={lastValidPoint.x * scaledWidth}
                          y1={lastValidPoint.y * scaledHeight}
                          x2={startPt.x * scaledWidth}
                          y2={startPt.y * scaledHeight}
                          stroke="white"
                          strokeWidth={markupStrokeWidth * scale}
                          strokeDasharray="5,5"
                          opacity="0.7"
                          style={{ display: 'none' }}
                        />
                      )}
                      
                      {/* Points - fixed screen size */}
                      {cloudPoints.filter(p => p && p.x !== undefined).map((point, i) => (
                        <circle
                          key={`ptcloud-${i}`}
                          data-polyline-start={i === 0 ? "true" : undefined}
                          cx={point.x * scaledWidth}
                          cy={point.y * scaledHeight}
                          r={i === 0 ? 6 : 4}
                          fill={i === 0 ? '#27ae60' : markupColor}
                          stroke="white"
                          strokeWidth={1.5}
                        />
                      ))}
                      
                      {/* "Click to close" hint - DOM controlled */}
                      {cloudPoints.length >= 3 && (
                        <text
                          data-polyline-close-hint="true"
                          x={startPt.x * scaledWidth + 14}
                          y={startPt.y * scaledHeight - 4}
                          fill="white"
                          fontSize={11}
                          fontWeight="600"
                          style={{ display: 'none' }}
                        >
                          Click to close
                        </text>
                      )}
                      
                      {/* Shift snap indicator */}
                      {isShiftPressed && cloudPoints.length > 0 && cloudPoints[cloudPoints.length - 1] && (
                        <text
                          x={cloudPoints[cloudPoints.length - 1].x * scaledWidth + 12}
                          y={cloudPoints[cloudPoints.length - 1].y * scaledHeight - 8}
                          fill="#3498db"
                          fontSize={9}
                        >
                          ⇢ Snap
                        </text>
                      )}
                    </g>
                  );
                })()}
                
                {/* Selection box while drawing */}
                {isDrawingSelectionBox && selectionBox && (
                  <rect
                    x={Math.min(selectionBox.startX, selectionBox.endX) * scaledWidth}
                    y={Math.min(selectionBox.startY, selectionBox.endY) * scaledHeight}
                    width={Math.abs(selectionBox.endX - selectionBox.startX) * scaledWidth}
                    height={Math.abs(selectionBox.endY - selectionBox.startY) * scaledHeight}
                    fill="rgba(52, 152, 219, 0.1)"
                    stroke="white"
                    strokeWidth={1}
                    strokeDasharray="5,3"
                  />
                )}
                
                {/* Symbol capture region */}
                {symbolCaptureMode && captureRegion && captureRegion.width > 0 && (
                  <rect
                    x={captureRegion.x * scaledWidth}
                    y={captureRegion.y * scaledHeight}
                    width={captureRegion.width * scaledWidth}
                    height={captureRegion.height * scaledHeight}
                    fill="rgba(41, 128, 185, 0.2)"
                    stroke="#2980b9"
                    strokeWidth={2}
                    strokeDasharray="6,4"
                  />
                )}
                
                {/* Zoom box while drawing (zoom to area) */}
                {isDrawingZoomBox && zoomBox && (
                  <rect
		    data-zoom-box="true"
                    x={Math.min(zoomBox.startX, zoomBox.endX) * scaledWidth}
                    y={Math.min(zoomBox.startY, zoomBox.endY) * scaledHeight}
                    width={Math.abs(zoomBox.endX - zoomBox.startX) * scaledWidth}
                    height={Math.abs(zoomBox.endY - zoomBox.startY) * scaledHeight}
                    fill="rgba(46, 204, 113, 0.15)"
                    stroke="white"
                    strokeWidth={2}
                    strokeDasharray="6,4"
                  />
                )}
                
                {/* Multi-selection highlights - subtle like single selection */}
                {selectedMarkups.length > 0 && selectedMarkups.map(m => {
                  const bounds = getMarkupBounds(m);
                  if (!bounds) return null;
                  return (
                    <rect
                      key={`sel-${m.id}`}
                      x={bounds.minX * scaledWidth}
                      y={bounds.minY * scaledHeight}
                      width={(bounds.maxX - bounds.minX) * scaledWidth}
                      height={(bounds.maxY - bounds.minY) * scaledHeight}
                      fill="rgba(0, 102, 255, 0.05)"
                      stroke="#0066ff"
                      strokeWidth={2}
                      strokeDasharray="5,3"
                      pointerEvents="none"
                    />
                  );
                })}
                
                {/* Inline text editing */}
                {editingTextMarkupId && (() => {
                  const markup = markups.find(m => m.id === editingTextMarkupId);
                  if (!markup) return null;
                  
                  // Only text boxes, text markups, and callouts can have text editing - not rectangle/circle
                  if (markup.type === 'rectangle' || markup.type === 'circle') return null;
                  
                  const isTextBox = markup.startX !== undefined && markup.endX !== undefined;
                  const isRectOrCircle = false; // Rectangles/circles are filtered out above
                  
                  if (isTextBox) {
                    // Text box editing - use textarea in bounding box
                    let boxX, boxY, boxW, boxH;
                    
                    boxX = Math.min(markup.startX, markup.endX) * scaledWidth;
                    boxY = Math.min(markup.startY, markup.endY) * scaledHeight;
                    boxW = Math.abs(markup.endX - markup.startX) * scaledWidth;
                    boxH = Math.abs(markup.endY - markup.startY) * scaledHeight;
                    
                    const fontSize = (markup.fontSize || 12) * scale;
                    const padding = (markup.padding !== undefined ? markup.padding : 4) * scale;
                    const rotationDeg = markup.rotation || 0;
                    const centerX = boxX + boxW / 2;
                    const centerY = boxY + boxH / 2;
                    
                    const textColor = markup.color || '#000';
                    const bgColor = markup.fillColor === 'none' ? 'transparent' : (markup.fillColor || 'white');
                    
                    return (
                      <g transform={rotationDeg ? `rotate(${rotationDeg}, ${centerX}, ${centerY})` : undefined}>
                        <foreignObject
                          x={boxX}
                          y={boxY}
                          width={boxW}
                          height={boxH}
                          style={{ overflow: 'visible' }}
                        >
                          <textarea
                            xmlns="http://www.w3.org/1999/xhtml"
                            ref={textInputRef}
                            defaultValue={textEditValue}
                            onBlur={() => saveTextEdit(false)}
                            onFocus={(e) => {
                              // Put cursor at end of text
                              const len = e.target.value.length;
                              e.target.setSelectionRange(len, len);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                cancelTextEdit();
                              }
                              // Allow Enter for new lines, Ctrl+Enter to save and stay selected
                              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                saveTextEdit(true);
                              }
                            }}
                            autoFocus
                            style={{
                              width: '100%',
                              height: '100%',
                              border: '2px solid #3498db',
                              borderRadius: markup.type === 'circle' ? '50%' : '0',
                              padding: `${padding}px`,
                              fontSize: `${fontSize}px`,
                              fontFamily: (markup.fontFamily || (isRectOrCircle ? 'Arial' : 'Helvetica')) + ', sans-serif',
                              color: textColor,
                              background: bgColor,
                              outline: 'none',
                              resize: 'none',
                              boxSizing: 'border-box',
                              textAlign: markup.textAlign || (isRectOrCircle ? 'center' : 'left'),
                            }}
                            placeholder={isRectOrCircle ? "Type text... (Esc to cancel)" : "Type here... (click outside to save)"}
                          />
                        </foreignObject>
                      </g>
                    );
                  } else {
                    // Old format - single line input
                    const x = markup.x * scaledWidth;
                    const y = markup.y * scaledHeight;
                    return (
                      <foreignObject
                        x={x}
                        y={y - 5}
                        width={300}
                        height={100}
                      >
                        <input
                          xmlns="http://www.w3.org/1999/xhtml"
                          ref={textInputRef}
                          type="text"
                          defaultValue={textEditValue}
                          onBlur={() => saveTextEdit(false)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              saveTextEdit(false);
                            } else if (e.key === 'Escape') {
                              cancelTextEdit();
                            }
                          }}
                          autoFocus
                          style={{
                            border: '2px solid #3498db',
                            borderRadius: '4px',
                            padding: '4px 8px',
                            fontSize: `${markup.fontSize || 16}px`,
                            color: markup.color || '#000',
                            background: 'white',
                            outline: 'none',
                            minWidth: '100px'
                          }}
                          placeholder="Enter text..."
                        />
                      </foreignObject>
                    );
                  }
                })()}
                
                {/* Hit-test boxes for PDF annotations when in edit mode */}
                {/* These invisible rectangles let us click on PDF.js-rendered annotations */}
                {/* Only show for annotations we haven't taken ownership of yet */}
                {markupEditMode && currentPageMarkups
                  .filter(markup => markup.fromPdf && !ownedPdfAnnotationIds.has(markup.id) && (!selectedMarkup || markup.id !== selectedMarkup.id))
                  .map(markup => {
                    const bounds = getMarkupBounds(markup);
                    if (!bounds) return null;
                    
                    const { minX, maxX, minY, maxY } = bounds;
                    const x = minX * scaledWidth;
                    const y = minY * scaledHeight;
                    const w = (maxX - minX) * scaledWidth;
                    const h = (maxY - minY) * scaledHeight;
                    const padding = 3; // Small padding for easier clicking
                    
                    return (
                      <rect
                        key={`hit-${markup.id}`}
                        x={x - padding}
                        y={y - padding}
                        width={w + padding * 2}
                        height={h + padding * 2}
                        fill="transparent"
                        stroke="none"
                        style={{ cursor: 'pointer' }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          
                          // Convert to editable format if needed
                          let editableMarkup = markup;
                          if ((markup.hasCustomAppearance && !markup.modified) ||
                              (markup.type === 'text' && markup.x !== undefined && markup.startX === undefined)) {
                            editableMarkup = convertToEditableFormat(markup);
                            setMarkups(prev => prev.map(m => m.id === markup.id ? editableMarkup : m));
                          }
                          
                          // Take ownership of this annotation (delete from PDF, render in SVG)
                          takeOwnershipOfAnnotation(markup.id);
                          
                          // Select this annotation
                          setSelectedMarkup(editableMarkup);
                          selectedMarkupRef.current = editableMarkup;
                          setSelectedMarkups([]);
                          selectedMarkupsRef.current = [];
                          
                          // Track for dragging
                          if (!markup.readOnly) {
                            setIsDraggingMarkup(true);
                            isDraggingMarkupRef.current = true;
                            didDragMoveRef.current = false;
                            wasAlreadySelectedRef.current = false;
                            
                            const rect = e.currentTarget.ownerSVGElement.getBoundingClientRect();
                            const dragBounds = getMarkupBounds(editableMarkup);
                            const dragStart = {
                              x: (e.clientX - rect.left) / scale / canvasSize.width,
                              y: (e.clientY - rect.top) / scale / canvasSize.height,
                              bounds: dragBounds
                            };
                            setMarkupDragStart(dragStart);
                            markupDragStartRef.current = dragStart;
                          }
                        }}
                      />
                    );
                  })
                }
                
                {/* Selection handles for selected markup */}
                {selectedMarkup && (markupMode === 'select' || (selectMode && !markupMode) || markupEditMode) &&
                  renderSelectionHandles({
                    selectedMarkup, getMarkupBounds,
                    scaledWidth, scaledHeight, scale,
                    draggingPolylinePoint,
                    onRotateMouseDown: (e, centerX, centerY, currentRotation) => {
                      // Get the SVG bounding rect for coordinate mapping
                      const svgEl = e.currentTarget.ownerSVGElement;
                      const canvasEl = canvasRef.current;
                      const refEl = svgEl || canvasEl;
                      if (!refEl) return;
                      const rect = refEl.getBoundingClientRect();
                      const mouseX = e.clientX - rect.left;
                      const mouseY = e.clientY - rect.top;
                      const startAngle = Math.atan2(mouseY - centerY, mouseX - centerX) * 180 / Math.PI;
                      isRotatingMarkupRef.current = true;
                      setIsRotatingMarkup(true);
                      rotationStartRef.current = {
                        centerX, centerY,
                        startAngle,
                        initialRotation: currentRotation || 0,
                      };
                    },
                    onPolylinePointMouseDown: (e, pointIndex) => {
                      e.stopPropagation();
                      if (draggingPolylinePointRef) draggingPolylinePointRef.current = pointIndex;
                      if (isDraggingMarkupRef) isDraggingMarkupRef.current = true;
                      if (setIsDraggingMarkup) setIsDraggingMarkup(true);
                      if (setDraggingPolylinePoint) setDraggingPolylinePoint(pointIndex);
                      if (didDragMoveRef) didDragMoveRef.current = false;
                      const rect = e.currentTarget.ownerSVGElement.getBoundingClientRect();
                      const clickX = (e.clientX - rect.left) / scale / canvasSize.width;
                      const clickY = (e.clientY - rect.top) / scale / canvasSize.height;
                      const dragStart = { x: clickX, y: clickY, bounds: getMarkupBounds(selectedMarkup) };
                      if (markupDragStartRef) markupDragStartRef.current = dragStart;
                      if (setMarkupDragStart) setMarkupDragStart(dragStart);
                    },
                  })
                }
              </svg>
              )}
              
              {/* Overlay */}
              <div 
                className="hotspot-overlay"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: scaledWidth,
                  height: scaledHeight,
                  pointerEvents: 'none',
                  zIndex: 15
                }}
              >
                {currentRect && (objectFinderMode === 'train' || objectFinderMode === 'create') && (
                  <div
                    className={`drawing-rect ${drawingShapeType === 'circle' ? 'circle' : ''}`}
                    style={{
                      left: currentRect.x * scale,
                      top: currentRect.y * scale,
                      width: currentRect.width * scale,
                      height: currentRect.height * scale,
                      borderRadius: drawingShapeType === 'circle' ? '50%' : '0',
                    }}
                  />
                )}
                {currentRect && (linkMode === 'train' || linkMode === 'create') && (
                  <div
                    className={`drawing-rect ${linkMode === 'train' ? 'training' : 'creating'}`}
                    style={{
                      left: currentRect.x * scale,
                      top: currentRect.y * scale,
                      width: currentRect.width * scale,
                      height: currentRect.height * scale,
                    }}
                  />
                )}
                
                {/* Polyline drawing preview */}
                {drawingShapeType === 'polyline' && polylinePoints.length > 0 && (objectFinderMode === 'train' || objectFinderMode === 'create') && (
                  <svg
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none',
                      zIndex: 500,
                    }}
                  >
                    {/* Lines between confirmed points */}
                    {polylinePoints.map((point, i) => {
                      if (i === 0) return null;
                      const prev = polylinePoints[i - 1];
                      return (
                        <line
                          key={i}
                          x1={prev.x * scaledWidth}
                          y1={prev.y * scaledHeight}
                          x2={point.x * scaledWidth}
                          y2={point.y * scaledHeight}
                          stroke="white"
                          strokeWidth="2"
                        />
                      );
                    })}
                    
                    {/* Live preview line from last point to mouse */}
                    {polylineMousePos && (
                      <line
                        x1={polylinePoints[polylinePoints.length - 1].x * scaledWidth}
                        y1={polylinePoints[polylinePoints.length - 1].y * scaledHeight}
                        x2={polylineMousePos.x * scaledWidth}
                        y2={polylineMousePos.y * scaledHeight}
                        stroke="white"
                        strokeWidth="2"
                        strokeDasharray="5,5"
                        opacity="0.7"
                      />
                    )}
                    
                    {/* Preview line to start point when close enough to close */}
                    {isNearStartPoint && polylineMousePos && (
                      <line
                        x1={polylineMousePos.x * scaledWidth}
                        y1={polylineMousePos.y * scaledHeight}
                        x2={polylinePoints[0].x * scaledWidth}
                        y2={polylinePoints[0].y * scaledHeight}
                        stroke="white"
                        strokeWidth="2"
                        strokeDasharray="5,5"
                        opacity="0.7"
                      />
                    )}
                    
                    {/* Points */}
                    {polylinePoints.map((point, i) => (
                      <circle
                        key={`pt-${i}`}
                        cx={point.x * scaledWidth}
                        cy={point.y * scaledHeight}
                        r={i === 0 ? (isNearStartPoint ? 12 : 8) : 5}
                        fill={i === 0 ? '#27ae60' : '#3498db'}
                        stroke={i === 0 && isNearStartPoint ? '#fff' : 'white'}
                        strokeWidth={i === 0 && isNearStartPoint ? 3 : 2}
                        style={i === 0 && isNearStartPoint ? { filter: 'drop-shadow(0 0 4px #27ae60)' } : {}}
                      />
                    ))}
                    
                    {/* "Click to close" indicator when near start */}
                    {isNearStartPoint && (
                      <text
                        x={polylinePoints[0].x * scaledWidth}
                        y={polylinePoints[0].y * scaledHeight - 20}
                        fill="white"
                        fontSize="12"
                        fontWeight="bold"
                        textAnchor="middle"
                      >
                        Click to close
                      </text>
                    )}
                  </svg>
                )}
                
                {trainingBoxes.map(box => (
                  <div
                    key={box.id}
                    className="training-box"
                    style={{
                      left: box.x * scaledWidth,
                      top: box.y * scaledHeight,
                      width: box.width * scaledWidth,
                      height: box.height * scaledHeight,
                    }}
                  >
                    <span className="box-label">Training</span>
                  </div>
                ))}
                
                {/* Object Finder Training Boxes - using pre-computed styles */}
                {styledTrainingBoxes.map(box => {
                  const coords = box.bbox || box;
                  const { fillColor, boxColor, bgColor, borderColor, labelColor, isCircle, isPolyline, isNoFill, isNoBorder, isFullyHidden } = box._style;
                  
                  // For polylines, render as SVG
                  if (isPolyline && box.polylinePoints) {
                    return (
                      <svg
                        key={box.id}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: scaledWidth,
                          height: scaledHeight,
                          pointerEvents: 'none',
                          zIndex: 5,
                        }}
                      >
                        <polygon
                          points={box.polylinePoints.map(p => 
                            `${p.x * scaledWidth},${p.y * scaledHeight}`
                          ).join(' ')}
                          fill={isNoFill ? 'transparent' : fillColor}
                          fillOpacity={isNoFill ? 0 : 0.2}
                          stroke={isNoBorder ? 'transparent' : borderColor}
                          strokeWidth={isNoBorder ? 0 : 2}
                        />
                        {!isFullyHidden && (
                          <text
                            x={coords.x * scaledWidth + 4}
                            y={coords.y * scaledHeight - 4}
                            fill="white"
                            fontSize="11"
                            fontWeight="bold"
                            style={{ 
                              paintOrder: 'stroke',
                              stroke: labelColor,
                              strokeWidth: 3,
                            }}
                          >
                            {box.className || box.label || 'Object'}
                          </text>
                        )}
                      </svg>
                    );
                  }
                  
                  return (
                    <div
                      key={box.id}
                      className={`training-box object-training-box ${box.subclassRegion ? 'has-subclass-region' : ''} ${isCircle ? 'circle-shape' : ''} ${isFullyHidden ? 'no-color' : ''}`}
                      style={{
                        left: coords.x * scaledWidth,
                        top: coords.y * scaledHeight,
                        width: coords.width * scaledWidth,
                        height: coords.height * scaledHeight,
                        borderColor: borderColor,
                        backgroundColor: bgColor,
                        borderRadius: isCircle ? '50%' : '0',
                        borderWidth: isNoBorder ? '0' : '2px',
                      }}
                    >
                      {!isFullyHidden && (
                        <span className="box-label" style={{ backgroundColor: labelColor }}>{box.className || box.label || 'Object'}</span>
                      )}
                      {/* Show subclass regions if exist (new format - multiple regions) */}
                      {box.subclassRegions && Object.entries(box.subclassRegions).map(([subName, region]) => (
                        <div 
                          key={subName}
                          className="subclass-region-indicator"
                          style={{
                            left: `${region.x * 100}%`,
                            top: `${region.y * 100}%`,
                            width: `${region.width * 100}%`,
                            height: `${region.height * 100}%`,
                          }}
                          title={subName}
                        >
                          <span className="subclass-region-name">{subName}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
                
                {/* OCR Text Boxes - when showOcrOnPdf is enabled, only show filtered results */}
                {filteredOcrResultsForDisplay.map((item, idx) => {
                  const isVertical = item.orientation && item.orientation !== 'horizontal';
                  const isVerticalUp = item.orientation === 'vertical-up';
                  const isVerticalDown = item.orientation === 'vertical-down';
                  
                  // Check if this is a partial match (matched portion != full text)
                  const isPartialMatch = item.matchStart !== undefined && 
                    (item.matchStart > 0 || item.matchStart + item.matchLength < item.text.length);
                  
                  // For vertical text, position at center of bbox
                  const textStyle = {
                    position: 'absolute',
                    left: item.bbox.x * scaledWidth,
                    top: item.bbox.y * scaledHeight,
                    fontSize: Math.max(10, Math.min(14, (isVertical ? item.bbox.width : item.bbox.height) * scaledHeight * 0.8)),
                    color: 'white',
                    fontWeight: 'bold',
                    textShadow: '1px 1px 2px black, -1px -1px 2px black, 1px -1px 2px black, -1px 1px 2px black',
                    pointerEvents: 'none',
                    zIndex: 3,
                    whiteSpace: 'nowrap',
                  };
                  
                  // If partial match, make the parent box transparent so only the matched span is highlighted
                  if (isPartialMatch) {
                    textStyle.background = 'transparent';
                    textStyle.border = 'none';
                  }
                  
                  // Add rotation for vertical text
                  if (isVerticalUp) {
                    textStyle.transform = 'rotate(-90deg)';
                    textStyle.transformOrigin = 'left top';
                    textStyle.left = (item.bbox.x + item.bbox.width) * scaledWidth;
                  } else if (isVerticalDown) {
                    textStyle.transform = 'rotate(90deg)';
                    textStyle.transformOrigin = 'left top';
                  }
                  
                  return (
                    <div
                      key={`ocr-${idx}`}
                      className={isPartialMatch ? 'ocr-text-overlay ocr-partial-match' : 'ocr-text-overlay'}
                      style={textStyle}
                      title={`${item.displayText || item.text} (${(item.confidence * 100).toFixed(0)}%)${isVertical ? ' [vertical]' : ''}`}
                    >
                      {isPartialMatch ? (<>
                        <span style={{ opacity: 0.4 }}>{item.text.slice(0, item.matchStart)}</span>
                        <span style={{ background: 'rgba(39, 174, 96, 0.55)', borderRadius: 2, padding: '0 1px' }}>{item.text.slice(item.matchStart, item.matchStart + item.matchLength)}</span>
                        <span style={{ opacity: 0.4 }}>{item.text.slice(item.matchStart + item.matchLength)}</span>
                      </>) : (item.displayText || item.text)}
                    </div>
                  );
                })}
                
                {/* Pending Shape Confirmation Overlay */}
                {pendingShape && pendingShape.page === currentPage - 1 && (
                  <div
                    className="pending-shape-container"
                    style={{
                      left: pendingShape.x * scaledWidth,
                      top: pendingShape.y * scaledHeight,
                      width: pendingShape.width * scaledWidth,
                      height: pendingShape.height * scaledHeight,
                    }}
                  >
                    {/* Shape outline */}
                    {pendingShape.shapeType === 'polyline' && pendingShape.polylinePoints ? (
                      <svg
                        style={{
                          position: 'absolute',
                          top: -pendingShape.y * scaledHeight,
                          left: -pendingShape.x * scaledWidth,
                          width: scaledWidth,
                          height: scaledHeight,
                          pointerEvents: 'none',
                        }}
                      >
                        <polygon
                          points={pendingShape.polylinePoints.map(p => 
                            `${p.x * scaledWidth},${p.y * scaledHeight}`
                          ).join(' ')}
                          fill="rgba(52, 152, 219, 0.15)"
                          stroke="white"
                          strokeWidth="2"
                          strokeDasharray="5,5"
                        />
                      </svg>
                    ) : pendingShape.shapeType === 'circle' ? (
                      <div className="pending-shape circle" />
                    ) : (
                      <div className="pending-shape rectangle" />
                    )}
                    
                    {/* Resize handles - only show for rectangle/circle */}
                    {pendingShape.shapeType !== 'polyline' && (
                      <>
                        <div 
                          className="shape-handle handle-nw"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setActiveResizeHandle('nw');
                          }}
                        />
                        <div 
                          className="shape-handle handle-n"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setActiveResizeHandle('n');
                          }}
                        />
                        <div 
                          className="shape-handle handle-ne"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setActiveResizeHandle('ne');
                          }}
                        />
                        <div 
                          className="shape-handle handle-e"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setActiveResizeHandle('e');
                          }}
                        />
                        <div 
                          className="shape-handle handle-se"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setActiveResizeHandle('se');
                          }}
                        />
                        <div 
                          className="shape-handle handle-s"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setActiveResizeHandle('s');
                          }}
                        />
                        <div 
                          className="shape-handle handle-sw"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setActiveResizeHandle('sw');
                          }}
                        />
                        <div 
                          className="shape-handle handle-w"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setActiveResizeHandle('w');
                          }}
                        />
                      </>
                    )}
                    
                    {/* Confirmation buttons */}
                    <div className="shape-confirm-buttons" onMouseDown={(e) => e.stopPropagation()}>
                      <button 
                        className="confirm-btn"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (objectDrawType === 'region') {
                            // Show region assignment dialog
                            setPendingRegionShape(pendingShape);
                            setRegionTypeInput('');
                            setSubRegionNameInput('');
                            setRegionFillColorInput('#3498db');
                            setRegionBorderColorInput('#3498db');
                            setShowRegionAssignDialog(true);
                            setPendingShape(null);
                          } else {
                            // Show object class dialog
                            setPendingObjectBox(pendingShape);
                            setObjectClassInput('');
                            setShowObjectClassDialog(true);
                            setPendingShape(null);
                          }
                        }}
                        title="Confirm shape"
                      >
                        ✓
                      </button>
                      <button 
                        className="cancel-btn"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingShape(null);
                        }}
                        title="Cancel"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}
                
                {/* Drawn Regions - rendered with dashed border, not clickable inside */}
                {/* Performance: Skip during zoom and file transition */}
                {showRegionBoxes && !isZooming && overlaysReady && drawnRegions
                  .filter(region => {
                    // Filter to current page and file
                    if (region.page !== currentPage - 1) return false;
                    const regionFilename = region.filename;
                    const currentFilename = currentFile?.backendFilename || currentFile?.name;
                    return regionFilename === currentFilename;
                  })
                  .map((region) => {
                    // Get colors - check region-specific first, then fall back to region type
                    const regionTypeColors = getRegionTypeColors(region.regionType);
                    const fillColor = region.fillColor !== undefined ? region.fillColor : regionTypeColors.fillColor;
                    const borderColor = region.borderColor !== undefined ? region.borderColor : regionTypeColors.borderColor;
                    const isNoFill = fillColor === 'none';
                    const isNoBorder = borderColor === 'none';
                    const displayBorderColor = isNoBorder ? 'transparent' : borderColor;
                    const displayFillColor = isNoFill ? 'transparent' : fillColor;
                    const labelColor = isNoBorder ? (isNoFill ? '#666' : fillColor) : borderColor;
                    
                    // Render polyline regions as SVG
                    if (region.shapeType === 'polyline' && region.polylinePoints) {
                      return (
                        <svg
                          key={`region_${region.id}`}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: scaledWidth,
                            height: scaledHeight,
                            pointerEvents: 'none',
                            zIndex: 4,
                          }}
                        >
                          <polygon
                            points={region.polylinePoints.map(p => 
                              `${p.x * scaledWidth},${p.y * scaledHeight}`
                            ).join(' ')}
                            fill={isNoFill ? 'transparent' : displayFillColor}
                            fillOpacity={isNoFill ? 0 : 0.15}
                            stroke={displayBorderColor}
                            strokeWidth={isNoBorder ? 0 : 2}
                            strokeDasharray={isNoBorder ? '' : '8,4'}
                            style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingRegion(region);
                              setEditRegionName(region.subRegionName);
                              setShowRegionEditDialog(true);
                            }}
                          />
                          {/* Region label - only show if not fully hidden */}
                          {(!isNoFill || !isNoBorder) && (
                            <foreignObject
                              x={region.polylinePoints[0]?.x * scaledWidth || 0}
                              y={(region.polylinePoints[0]?.y * scaledHeight || 0) - 22}
                              width="200"
                              height="20"
                              style={{ overflow: 'visible' }}
                            >
                              <span
                                style={{
                                  display: 'inline-block',
                                  background: labelColor,
                                  color: 'white',
                                  padding: '2px 6px',
                                  borderRadius: '3px',
                                  fontSize: '10px',
                                  fontWeight: '600',
                                  whiteSpace: 'nowrap',
                                  cursor: 'pointer',
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingRegion(region);
                                  setEditRegionName(region.subRegionName);
                                  setShowRegionEditDialog(true);
                                }}
                              >
                                🗺️ {region.regionType}: {region.subRegionName}
                              </span>
                            </foreignObject>
                          )}
                        </svg>
                      );
                    }
                    
                    // Render rectangle/circle regions
                    return (
                      <div
                        key={`region_${region.id}`}
                        className={`drawn-region-box ${region.shapeType === 'circle' ? 'circle' : ''}`}
                        style={{
                          left: region.bbox.x * scaledWidth,
                          top: region.bbox.y * scaledHeight,
                          width: region.bbox.width * scaledWidth,
                          height: region.bbox.height * scaledHeight,
                          pointerEvents: 'auto',
                          cursor: 'pointer',
                          position: 'absolute',
                          border: isNoBorder ? 'none' : `2px dashed ${displayBorderColor}`,
                          backgroundColor: isNoFill ? 'transparent' : `${displayFillColor}26`,
                          borderRadius: region.shapeType === 'circle' ? '50%' : '0',
                          zIndex: 4,
                        }}
                        onMouseEnter={() => setHoveredRegion(region.id)}
                        onMouseLeave={() => setHoveredRegion(null)}
                        onClick={(e) => {
                          e.stopPropagation();
                          // Open region edit dialog
                          setEditingRegion(region);
                          setEditRegionName(region.subRegionName);
                          setShowRegionEditDialog(true);
                        }}
                      >
                        {/* Region label - only show if not fully hidden */}
                        {(!isNoFill || !isNoBorder) && (
                          <span 
                            className="region-box-label"
                            style={{
                              position: 'absolute',
                              top: '-20px',
                              left: '0',
                              background: labelColor,
                              color: 'white',
                              padding: '2px 6px',
                              borderRadius: '3px',
                              fontSize: '10px',
                              fontWeight: '600',
                              whiteSpace: 'nowrap',
                              pointerEvents: 'auto',
                              cursor: 'pointer',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              // Open region edit dialog
                              setEditingRegion(region);
                              setEditRegionName(region.subRegionName);
                              setShowRegionEditDialog(true);
                            }}
                          >
                            🗺️ {region.regionType}: {region.subRegionName}
                          </span>
                        )}
                      </div>
                    );
                  })}
                
                {/* Detected Objects - using pre-computed styles for performance */}
                {/* Performance: Only render when showObjectBoxes is true, not zooming, and overlays ready */}
                {showObjectBoxes && !isZooming && overlaysReady && styledDetectedObjects.map((obj) => {
                    const { fillColor, bgColor, borderColor, labelColor, isCircle, isPolyline, isNoFill, isNoBorder, isFullyHidden } = obj._style;
                    
                    // For fully hidden objects, still render an invisible but clickable area
                    if (isFullyHidden) {
                      return (
                        <div
                          key={`detected_${obj.id}`}
                          className={`detected-object-box ${hoveredObject === obj.id ? 'hovered' : ''} ${highlightedObjectId === obj.id ? 'highlighted' : ''} no-color`}
                          style={{
                            left: obj.bbox.x * scaledWidth,
                            top: obj.bbox.y * scaledHeight,
                            width: obj.bbox.width * scaledWidth,
                            height: obj.bbox.height * scaledHeight,
                            pointerEvents: zoomMode ? 'none' : 'all',
                            cursor: 'pointer',
                            border: 'none',
                            backgroundColor: 'transparent',
                            zIndex: 10,
                          }}
                          onClick={() => { 
                            const imageData = captureObjectImage(obj);
                            setObjectImagePreview(imageData);
                            setSelectedObject({ ...obj, index: objectIndexMap.get(obj.id) ?? -1 }); 
                            setShowObjectEditDialog(true); 
                          }}
                          onMouseEnter={() => setHoveredObject(obj.id)}
                          onMouseLeave={() => setHoveredObject(null)}
                        >
                          {(hoveredObject === obj.id || highlightedObjectId === obj.id) && (
                            <div className="object-tooltip">
                              <div><strong>{obj.label}</strong></div>
                              {obj.subclassValues && Object.keys(obj.subclassValues).length > 0 ? (
                                Object.entries(obj.subclassValues).map(([k, v]) => (
                                  <div key={k}>{k}: {v || '-'}</div>
                                ))
                              ) : (
                                obj.ocr_text && <div>Tag: {obj.ocr_text}</div>
                              )}
                              <div>Confidence: {((obj.confidence || 0) * 100).toFixed(0)}%</div>
                              <div className="tooltip-hint">Click to edit</div>
                            </div>
                          )}
                        </div>
                      );
                    }
                    
                    // For polylines, render as SVG
                    if (isPolyline && obj.polylinePoints) {
                      return (
                        <svg
                          key={`detected_${obj.id}`}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: scaledWidth,
                            height: scaledHeight,
                            pointerEvents: 'none',
                            zIndex: 10,
                          }}
                        >
                          <polygon
                            points={obj.polylinePoints.map(p => 
                              `${p.x * scaledWidth},${p.y * scaledHeight}`
                            ).join(' ')}
                            fill={isNoFill ? 'transparent' : fillColor}
                            fillOpacity={isNoFill ? 0 : 0.15}
                            stroke={isNoBorder ? 'transparent' : borderColor}
                            strokeWidth={isNoBorder ? 0 : 2}
                            style={{ pointerEvents: zoomMode ? 'none' : 'all', cursor: 'pointer' }}
                            onClick={() => { 
                              const imageData = captureObjectImage(obj);
                              setObjectImagePreview(imageData);
                              setSelectedObject({ ...obj, index: objectIndexMap.get(obj.id) ?? -1 }); 
                              setShowObjectEditDialog(true); 
                            }}
                          />
                        </svg>
                      );
                    }
                    
                    // For polylines WITHOUT polylinePoints, render as rectangle
                    if (isPolyline) {
                      return (
                        <div
                          key={`detected_${obj.id}`}
                          className={`detected-object-box ${hoveredObject === obj.id ? 'hovered' : ''} ${highlightedObjectId === obj.id ? 'highlighted' : ''} ${isFullyHidden ? 'no-color' : ''}`}
                          style={{
                            left: obj.bbox.x * scaledWidth,
                            top: obj.bbox.y * scaledHeight,
                            width: obj.bbox.width * scaledWidth,
                            height: obj.bbox.height * scaledHeight,
                            pointerEvents: zoomMode ? 'none' : 'all',
                            cursor: 'pointer',
                            borderColor: borderColor,
                            backgroundColor: bgColor,
                            borderWidth: isNoBorder ? '0' : '2px',
                            zIndex: 10,
                          }}
                          onClick={() => { 
                            const imageData = captureObjectImage(obj);
                            setObjectImagePreview(imageData);
                            setSelectedObject({ ...obj, index: objectIndexMap.get(obj.id) ?? -1 }); 
                            setShowObjectEditDialog(true); 
                          }}
                          onMouseEnter={() => setHoveredObject(obj.id)}
                          onMouseLeave={() => setHoveredObject(null)}
                        >
                          {(hoveredObject === obj.id || highlightedObjectId === obj.id) && (
                            <div className="object-tooltip">
                              <div><strong>{obj.label}</strong></div>
                              {obj.subclassValues && Object.keys(obj.subclassValues).length > 0 ? (
                                Object.entries(obj.subclassValues).map(([k, v]) => (
                                  <div key={k}>{k}: {v || '-'}</div>
                                ))
                              ) : (
                                obj.ocr_text && <div>Tag: {obj.ocr_text}</div>
                              )}
                              <div>Confidence: {((obj.confidence || 0) * 100).toFixed(0)}%</div>
                              <div className="tooltip-hint">Click to edit</div>
                            </div>
                          )}
                          {!hideLabels && !isFullyHidden && (
                            <span className="object-box-label" style={{ backgroundColor: labelColor }}>
                              {obj.ocr_text || obj.label}
                            </span>
                          )}
                        </div>
                      );
                    }
                    
                    return (
                  <div
                    key={`detected_${obj.id}`}
                    className={`detected-object-box ${hoveredObject === obj.id ? 'hovered' : ''} ${highlightedObjectId === obj.id ? 'highlighted' : ''} ${isCircle ? 'circle-shape' : ''} ${isFullyHidden ? 'no-color' : ''}`}
                    style={{
                      left: obj.bbox.x * scaledWidth,
                      top: obj.bbox.y * scaledHeight,
                      width: obj.bbox.width * scaledWidth,
                      height: obj.bbox.height * scaledHeight,
                      pointerEvents: zoomMode ? 'none' : 'all',
                      cursor: 'pointer',
                      borderColor: borderColor,
                      backgroundColor: bgColor,
                      borderRadius: isCircle ? '50%' : '0',
                      borderWidth: isNoBorder ? '0' : '2px',
                      zIndex: 10,
                    }}
                    onClick={() => { 
                      const imageData = captureObjectImage(obj);
                      setObjectImagePreview(imageData);
                      setSelectedObject({ ...obj, index: objectIndexMap.get(obj.id) ?? -1 }); 
                      setShowObjectEditDialog(true); 
                    }}
                    onMouseEnter={() => setHoveredObject(obj.id)}
                    onMouseLeave={() => setHoveredObject(null)}
                  >
                    {(hoveredObject === obj.id || highlightedObjectId === obj.id) && (
                      <div className="object-tooltip">
                        <div><strong>{obj.label}</strong></div>
                        {obj.subclassValues && Object.keys(obj.subclassValues).length > 0 ? (
                          Object.entries(obj.subclassValues).map(([k, v]) => (
                            <div key={k}>{k}: {v || '-'}</div>
                          ))
                        ) : (
                          obj.ocr_text && <div>Tag: {obj.ocr_text}</div>
                        )}
                        <div>Confidence: {((obj.confidence || 0) * 100).toFixed(0)}%</div>
                        <div className="tooltip-hint">Click to edit</div>
                      </div>
                    )}
                    {!hideLabels && !isFullyHidden && (
                      <span className="object-box-label" style={{ backgroundColor: labelColor }}>
                        {obj.ocr_text || obj.subclassValues?.Tag || obj.label}
                      </span>
                    )}
                  </div>
                    );
                  })}
                
                {/* Performance: Only render hotspots when showLinksOnPdf is true, not zooming, and overlays ready */}
                {showLinksOnPdf && !isZooming && overlaysReady && currentPageHotspots.map(hotspot => {
                  const targetFile = hotspot.targetFileId ? allFiles.find(f => f.id === hotspot.targetFileId) : null;
                  const isLinked = !!hotspot.targetFileId && !!targetFile;
                  const isBroken = !!hotspot.targetFileId && !targetFile; // Has target but file is missing
                  
                  // Get colors from project.linkColors or use defaults
                  const linkColors = project?.linkColors || {};
                  const assignedColors = linkColors.assigned || {};
                  const unassignedColors = linkColors.unassigned || {};
                  
                  // Determine which colors to use based on link status
                  const colors = isLinked ? assignedColors : unassignedColors;
                  const defaultStroke = isLinked ? '#27ae60' : '#e74c3c';
                  const defaultFill = isLinked ? 'rgba(39, 174, 96, 0.3)' : 'rgba(231, 76, 60, 0.3)';
                  
                  const showLine = colors.showLine !== false;
                  const showFill = colors.showFill !== false;
                  const strokeColor = colors.stroke || defaultStroke;
                  const fillColor = colors.fill || defaultFill;
                  
                  return (
                  <div
                    key={hotspot.id}
                    className={`hotspot ${hoveredHotspot === hotspot.id ? 'hovered' : ''} ${isLinked ? 'linked' : ''} ${isBroken ? 'broken' : ''} ${!hotspot.targetFileId ? 'unlinked' : ''} ${highlightedObjectId === hotspot.id ? 'highlighted' : ''}`}
                    style={{
                      left: hotspot.x * scaledWidth,
                      top: hotspot.y * scaledHeight,
                      width: hotspot.width * scaledWidth,
                      height: hotspot.height * scaledHeight,
                      pointerEvents: 'all',
                      borderColor: showLine ? strokeColor : 'transparent',
                      backgroundColor: showFill ? fillColor : 'transparent'
                    }}
                    onClick={() => handleHotspotClick(hotspot)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setHotspotContextMenu({
                        hotspot,
                        x: e.clientX,
                        y: e.clientY,
                        targetFile,
                        isLinked,
                        isBroken
                      });
                    }}
                    onMouseEnter={() => setHoveredHotspot(hotspot.id)}
                    onMouseLeave={() => setHoveredHotspot(null)}
                  >
                    {/* Always show OCR text label if available */}
                    {hotspot.label && (
                      <div 
                        className={`hotspot-label ${isLinked ? 'linked' : ''} ${isBroken ? 'broken' : ''} ${!hotspot.targetFileId ? 'unlinked' : ''}`}
                        style={{
                          backgroundColor: showLine ? strokeColor : (isLinked ? '#27ae60' : '#e74c3c')
                        }}
                      >
                        {hotspot.label}
                      </div>
                    )}
                    {hoveredHotspot === hotspot.id && (
                      <div className="hotspot-tooltip">
                        {isLinked 
                          ? `Target → ${targetFile.name}${hotspot.assignmentMode === 'property' ? ` (by ${hotspot.propertyName})` : ''}`
                          : isBroken
                            ? `Target → ${hotspot.targetFilename || 'Unknown'} (deleted)`
                            : 'Unassigned'
                        }
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
  );
}
