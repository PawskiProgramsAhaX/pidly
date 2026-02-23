import React, { memo, useCallback } from 'react';
import { renderMarkupShape } from '../renderMarkupShape';
import { renderSelectionHandles } from '../renderSelectionHandles';

/**
 * ContinuousPage — Memoized per-page component for continuous/horizontal/side-by-side views.
 *
 * PERFORMANCE ARCHITECTURE:
 *   ┌─ ContinuousView (thin wrapper, ~300 lines) ──────────────────────────┐
 *   │  • Scrollable container with pan/zoom handlers                       │
 *   │  • Builds ctxRef (updated every render, identity never changes)      │
 *   │  • Scopes per-page props (selectedMarkup, editingTextMarkupId, etc.) │
 *   │  • Mounts visible pages + buffer via mountedPageRange                │
 *   └──────────────────────────────────────────────────────────────────────┘
 *            │                    │                    │
 *    ┌──────┐ ┌──────┐ ┌──────┐
 *    │Page 1│  │Page 2│  │Page 3│   ← React.memo blocks re-render unless
 *    │(memo)│  │(memo)│  │(memo)│     THIS page's data changed
 *    └──────┘  └──────┘  └──────┘
 *
 *   - Hovering page 3 → only page 3 re-renders (via DOM class, zero re-renders)
 *   - Dragging markup on page 5 → only page 5 re-renders (selectedMarkup scoped)
 *   - Scrolling → zero page re-renders (canvases persist, new pages rendered on settle)
 *   - Toolbar changes → all pages re-render (infrequent, acceptable)
 *
 *   Event handlers read from ctxRef.current at call time — always fresh state,
 *   even if this page hasn't re-rendered. No stale closures.
 */
const ContinuousPage = memo(function ContinuousPage({
  pageNum, pageWidth, pageHeight, baseWidth, baseHeight,
  pageMarkups, isPageVisible, isRendered,
  selectedMarkup,
  editingTextMarkupId, scale,
  overlaysReady, markupEditMode, markupMode, selectMode,
  continuousLayout, expandedNotes,
  selectionBox, zoomBox,
  // Overlay visibility flags — must be props (not ctxRef) so memo re-renders on toggle
  showObjectBoxes, showLinksOnPdf, showOcrOnPdf, showRegionBoxes,
  hiddenClasses, hideLabels,
  ctxRef,
}) {
  const pageIdx = pageNum - 1;

  // ─── Canvas ref registration ─────────────────────────────────────────
  const canvasRefCb = useCallback(el => {
    if (el) ctxRef.current.continuousCanvasRefs.current[pageNum] = el;
  }, [pageNum]);

  // ─── Coordinate helper ───────────────────────────────────────────────
  const getPageCoords = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    return {
      normalizedX: Math.max(0, Math.min(1, x / baseWidth)),
      normalizedY: Math.max(0, Math.min(1, y / baseHeight)),
    };
  };

  const scaledStrokeWidth = (sw) => (sw || 2) * scale;

  // ─── pointToLineDistance (inline for zero-dependency handlers) ────────
  const ptLineDist = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.sqrt((px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2);
  };

  // =====================================================================
  // EVENT HANDLERS — read shared state from ctxRef.current at call time
  // =====================================================================

  const handleMouseDown = (e) => {
    const ctx = ctxRef.current;
    // Don't interfere with pan/zoom modes at container level
    if (ctx.panMode || ctx.zoomMode) return;
    // Don't interfere with text editing
    if (ctx.editingTextMarkupId) return;
    // Don't interfere with detected objects or hotspots
    if (e.target.closest('.detected-object-box') || e.target.closest('.hotspot-box')) return;

    // Check resize handle click
    const resizeHandleEl = e.target.closest('.resize-handle');
    if (resizeHandleEl && ctx.selectedMarkup && ctx.selectedMarkup.page === pageIdx) {
      e.preventDefault();
      e.stopPropagation();
      const handle = resizeHandleEl.dataset.handle;
      const bounds = ctx.getMarkupBounds(ctx.selectedMarkup);
      ctx.isResizingMarkupRef.current = true;
      ctx.setIsResizingMarkup(true);
      ctx.resizeHandleRef.current = handle;
      ctx.setResizeHandle(handle);
      const { normalizedX, normalizedY } = getPageCoords(e);
      const dragStart = { x: normalizedX, y: normalizedY, bounds, page: pageIdx };
      ctx.markupDragStartRef.current = dragStart;
      ctx.setMarkupDragStart(dragStart);
      return;
    }

    // Set as current page
    if (ctx.currentPage !== pageNum) ctx.setCurrentPage(pageNum);

    const { normalizedX, normalizedY } = getPageCoords(e);

    // Drag selected markup (PDF annotations require edit mode)
    if (ctx.selectedMarkup && ctx.selectedMarkup.page === pageIdx && !ctx.selectedMarkup.readOnly && (ctx.markupEditMode || !ctx.selectedMarkup.fromPdf)) {
      const bounds = ctx.getMarkupBounds(ctx.selectedMarkup);
      if (bounds) {
        const strokeTol = Math.max(0.005, (ctx.selectedMarkup.strokeWidth || 2) * 0.0008);
        let canDrag = false;
        const m = ctx.selectedMarkup;

        if (m.type === 'arrow' || m.type === 'line') {
          canDrag = ptLineDist(normalizedX, normalizedY, m.startX, m.startY, m.endX, m.endY) < strokeTol;
        } else if (m.type === 'pen' || m.type === 'highlighter') {
          for (let i = 0; i < m.points.length - 1; i++) {
            if (ptLineDist(normalizedX, normalizedY, m.points[i].x, m.points[i].y, m.points[i+1].x, m.points[i+1].y) < strokeTol) { canDrag = true; break; }
          }
        } else if (m.type === 'circle') {
          const cx = (m.startX + m.endX) / 2, cy = (m.startY + m.endY) / 2;
          const rx = Math.abs(m.endX - m.startX) / 2, ry = Math.abs(m.endY - m.startY) / 2;
          if (rx > 0.001 && ry > 0.001) {
            const dx = (normalizedX - cx) / rx, dy = (normalizedY - cy) / ry;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const hasFill = m.fillColor && m.fillColor !== 'none' && m.fillColor !== 'transparent';
            if (hasFill && dist <= 1) canDrag = true;
            else canDrag = Math.abs(dist - 1) < (strokeTol / Math.min(rx, ry));
          }
        } else {
          const hasFill = m.fillColor && m.fillColor !== 'none' && m.fillColor !== 'transparent';
          const isTextBox = m.type === 'text' || m.type === 'callout';
          if (hasFill || isTextBox) {
            canDrag = normalizedX >= bounds.minX && normalizedX <= bounds.maxX && normalizedY >= bounds.minY && normalizedY <= bounds.maxY;
          } else if (m.type === 'cloud') {
            const cloudTol = strokeTol + 0.008;
            canDrag = (
              (Math.abs(normalizedX - bounds.minX) < cloudTol || Math.abs(normalizedX - bounds.maxX) < cloudTol) && normalizedY >= bounds.minY && normalizedY <= bounds.maxY ||
              (Math.abs(normalizedY - bounds.minY) < cloudTol || Math.abs(normalizedY - bounds.maxY) < cloudTol) && normalizedX >= bounds.minX && normalizedX <= bounds.maxX
            );
          } else {
            canDrag = (
              (Math.abs(normalizedX - bounds.minX) < strokeTol || Math.abs(normalizedX - bounds.maxX) < strokeTol) && normalizedY >= bounds.minY && normalizedY <= bounds.maxY ||
              (Math.abs(normalizedY - bounds.minY) < strokeTol || Math.abs(normalizedY - bounds.maxY) < strokeTol) && normalizedX >= bounds.minX && normalizedX <= bounds.maxX
            );
          }
        }

        if (canDrag) {
          e.preventDefault(); e.stopPropagation();
          ctx.isDraggingMarkupRef.current = true;
          ctx.setIsDraggingMarkup(true);
          ctx.didDragMoveRef.current = false;
          ctx.wasAlreadySelectedRef.current = true;
          const dragStart = { x: normalizedX, y: normalizedY, bounds, page: pageIdx };
          ctx.markupDragStartRef.current = dragStart;
          ctx.setMarkupDragStart(dragStart);
          return;
        }
      }
    }

    // Selection mode - try to select (always works; PDF annotations require edit mode)
    if (!ctx.markupMode || ctx.selectMode) {
      const baseTolerance = 0.005;
      const clickedMarkup = pageMarkups.find(m => {
        if (m.readOnly) return false;
        if (m.fromPdf && !ctx.markupEditMode) return false;
        const bounds = ctx.getMarkupBounds(m);
        if (!bounds) return false;
        const strokeTol = Math.max(baseTolerance, (m.strokeWidth || 2) * 0.0008);
        if (m.type === 'arrow' || m.type === 'line') return ptLineDist(normalizedX, normalizedY, m.startX, m.startY, m.endX, m.endY) < strokeTol;
        if (m.type === 'pen' || m.type === 'highlighter') {
          for (let i = 0; i < m.points.length - 1; i++) {
            if (ptLineDist(normalizedX, normalizedY, m.points[i].x, m.points[i].y, m.points[i+1].x, m.points[i+1].y) < strokeTol) return true;
          }
          return false;
        }
        if (m.type === 'text' || m.type === 'callout') return normalizedX >= bounds.minX && normalizedX <= bounds.maxX && normalizedY >= bounds.minY && normalizedY <= bounds.maxY;
        if (m.type === 'circle') {
          const cx = (m.startX + m.endX) / 2, cy = (m.startY + m.endY) / 2;
          const rx = Math.abs(m.endX - m.startX) / 2, ry = Math.abs(m.endY - m.startY) / 2;
          if (rx > 0.001 && ry > 0.001) {
            const dx = (normalizedX - cx) / rx, dy = (normalizedY - cy) / ry;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const hasFill = m.fillColor && m.fillColor !== 'none' && m.fillColor !== 'transparent';
            if (hasFill && dist <= 1) return true;
            return Math.abs(dist - 1) < (strokeTol / Math.min(rx, ry));
          }
          return false;
        }
        if (m.type === 'polyline' || m.type === 'polylineArrow' || m.type === 'cloudPolyline' || m.type === 'polygon') {
          if (m.points && m.points.length >= 2) {
            const numSeg = m.type === 'polygon' ? m.points.length : m.points.length - 1;
            for (let j = 0; j < numSeg; j++) {
              if (ptLineDist(normalizedX, normalizedY, m.points[j].x, m.points[j].y, m.points[(j+1) % m.points.length].x, m.points[(j+1) % m.points.length].y) < strokeTol) return true;
            }
            if (m.type === 'polygon' && m.fillColor && m.fillColor !== 'none' && m.fillColor !== 'transparent') {
              let inside = false;
              const pts = m.points;
              for (let j = 0, k = pts.length - 1; j < pts.length; k = j++) {
                if (((pts[j].y > normalizedY) !== (pts[k].y > normalizedY)) && (normalizedX < (pts[k].x - pts[j].x) * (normalizedY - pts[j].y) / (pts[k].y - pts[j].y) + pts[j].x)) inside = !inside;
              }
              if (inside) return true;
            }
          }
          return false;
        }
        if (m.type === 'cloud') {
          const hasFill = m.fillColor && m.fillColor !== 'none' && m.fillColor !== 'transparent';
          if (hasFill && normalizedX >= bounds.minX && normalizedX <= bounds.maxX && normalizedY >= bounds.minY && normalizedY <= bounds.maxY) return true;
          const cloudTol = strokeTol + 0.008;
          return (Math.abs(normalizedX - bounds.minX) < cloudTol || Math.abs(normalizedX - bounds.maxX) < cloudTol) && normalizedY >= bounds.minY && normalizedY <= bounds.maxY ||
                 (Math.abs(normalizedY - bounds.minY) < cloudTol || Math.abs(normalizedY - bounds.maxY) < cloudTol) && normalizedX >= bounds.minX && normalizedX <= bounds.maxX;
        }
        const hasFill = m.fillColor && m.fillColor !== 'none' && m.fillColor !== 'transparent';
        if (hasFill) return normalizedX >= bounds.minX && normalizedX <= bounds.maxX && normalizedY >= bounds.minY && normalizedY <= bounds.maxY;
        return (Math.abs(normalizedX - bounds.minX) < strokeTol || Math.abs(normalizedX - bounds.maxX) < strokeTol) && normalizedY >= bounds.minY && normalizedY <= bounds.maxY ||
               (Math.abs(normalizedY - bounds.minY) < strokeTol || Math.abs(normalizedY - bounds.maxY) < strokeTol) && normalizedX >= bounds.minX && normalizedX <= bounds.maxX;
      });

      if (clickedMarkup) {
        e.preventDefault(); e.stopPropagation();
        if (e.shiftKey && ctx.selectedMarkup) {
          ctx.setSelectedMarkups(prev => prev.find(m => m.id === clickedMarkup.id) ? prev.filter(m => m.id !== clickedMarkup.id) : [...prev, clickedMarkup]);
        } else {
          ctx.setSelectedMarkup(clickedMarkup);
          ctx.selectedMarkupRef.current = clickedMarkup;
          ctx.setSelectedMarkups([]);
          ctx.selectedMarkupsRef.current = [];
          if (!clickedMarkup.readOnly) {
            ctx.isDraggingMarkupRef.current = true;
            ctx.setIsDraggingMarkup(true);
            ctx.didDragMoveRef.current = false;
            ctx.wasAlreadySelectedRef.current = false;
            const bounds = ctx.getMarkupBounds(clickedMarkup);
            const dragStart = { x: normalizedX, y: normalizedY, bounds, page: pageIdx };
            ctx.markupDragStartRef.current = dragStart;
            ctx.setMarkupDragStart(dragStart);
          }
        }
        return;
      } else if (!ctx.markupMode) {
        ctx.setSelectedMarkup(null);
        ctx.selectedMarkupRef.current = null;
        ctx.setSelectedMarkups([]);
        ctx.selectedMarkupsRef.current = [];
      }
    }

    // Handle different markup modes (drawing) — always works regardless of lock state
    if (ctx.markupMode) {
      e.preventDefault(); e.stopPropagation();
      const overlay = e.currentTarget.querySelector('.drawing-overlay');
      if (overlay) ctx.drawingOverlayRef.current = overlay;

      const mkId = () => `markup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const baseMk = { page: pageIdx, filename: ctx.currentFileIdentifier, color: ctx.markupColor, strokeWidth: ctx.markupStrokeWidth, opacity: ctx.markupOpacity };

      if (ctx.markupMode === 'pen' || ctx.markupMode === 'highlighter') {
        ctx.isDrawingMarkupRef.current = true;
        ctx.currentMarkupRef.current = { ...baseMk, id: mkId(), type: ctx.markupMode, points: [{ x: normalizedX, y: normalizedY }] };
        ctx.updateDrawingOverlay();
      } else if (['arrow', 'line', 'rectangle', 'circle', 'cloud', 'text', 'callout', 'arc'].includes(ctx.markupMode)) {
        ctx.isDrawingMarkupRef.current = true;
        const newMk = { ...baseMk, id: mkId(), type: ctx.markupMode, startX: normalizedX, startY: normalizedY, endX: normalizedX, endY: normalizedY, fillColor: ctx.markupFillColor, lineStyle: ctx.markupLineStyle };
        if (ctx.markupMode === 'cloud') { newMk.arcSize = ctx.markupCloudArcSize; newMk.inverted = ctx.markupCloudInverted; }
        if (ctx.markupMode === 'text' || ctx.markupMode === 'callout') { newMk.fontSize = ctx.markupFontSize; newMk.fontFamily = ctx.markupFontFamily; newMk.textColor = ctx.markupColor; newMk.borderColor = ctx.markupBorderColor; newMk.text = ''; }
        ctx.currentMarkupRef.current = newMk;
        ctx.updateDrawingOverlay();
      } else if (['polyline', 'polylineArrow', 'cloudPolyline', 'polygon'].includes(ctx.markupMode)) {
        if (!ctx.currentMarkupRef.current || ctx.currentMarkupRef.current.type !== ctx.markupMode || ctx.currentMarkupRef.current.page !== pageIdx) {
          const newMk = { ...baseMk, id: mkId(), type: ctx.markupMode, points: [{ x: normalizedX, y: normalizedY }], fillColor: ctx.markupFillColor, lineStyle: ctx.markupLineStyle };
          if (ctx.markupMode === 'cloudPolyline') { newMk.arcSize = ctx.markupCloudArcSize; newMk.inverted = ctx.markupCloudInverted; }
          ctx.currentMarkupRef.current = newMk;
        } else {
          ctx.currentMarkupRef.current.points.push({ x: normalizedX, y: normalizedY });
        }
        ctx.updateDrawingOverlay();
      } else if (ctx.markupMode === 'note') {
        ctx.setNoteDialogPosition({ x: normalizedX, y: normalizedY });
        ctx.setNoteText('');
        ctx.setEditingNoteId(null);
        ctx.setShowNoteDialog(true);
      } else if (ctx.markupMode === 'eraser') {
        const clicked = pageMarkups.find(m => {
          if (m.readOnly) return false;
          const bounds = ctx.getMarkupBounds(m);
          if (!bounds) return false;
          const tolerance = 0.02;
          return normalizedX >= bounds.minX - tolerance && normalizedX <= bounds.maxX + tolerance && normalizedY >= bounds.minY - tolerance && normalizedY <= bounds.maxY + tolerance;
        });
        if (clicked) {
          ctx.setMarkupHistory(prev => [...prev, ctx.markups]);
          ctx.setMarkupFuture([]);
          ctx.setMarkups(prev => prev.filter(m => m.id !== clicked.id));
          ctx.setUnsavedMarkupFiles(prev => new Set([...prev, ctx.currentFileIdentifier]));
        }
      } else if (ctx.markupMode === 'symbol' && ctx.draggingSymbol) {
        const sym = ctx.draggingSymbol;
        const nw = (sym.width || 50) / baseWidth, nh = (sym.height || 50) / baseHeight;
        const newMk = { id: mkId(), type: 'symbol', symbolId: sym.id, symbolName: sym.name, symbolData: sym.svgContent || sym.imageData, startX: normalizedX - nw/2, startY: normalizedY - nh/2, endX: normalizedX + nw/2, endY: normalizedY + nh/2, page: pageIdx, filename: ctx.currentFileIdentifier };
        ctx.addMarkupWithHistory(newMk);
        ctx.setUnsavedMarkupFiles(prev => new Set([...prev, ctx.currentFileIdentifier]));
      }
    }
  };

  const handleMouseMove = (e) => {
    const ctx = ctxRef.current;
    const { normalizedX, normalizedY } = getPageCoords(e);

    // Markup dragging — accumulate delta, DOM manipulation (zero React overhead)
    if (ctx.isDraggingMarkupRef.current && ctx.selectedMarkupRef.current && ctx.markupDragStartRef.current) {
      if (ctx.selectedMarkupRef.current.page !== pageIdx) return;
      const deltaX = normalizedX - ctx.markupDragStartRef.current.x;
      const deltaY = normalizedY - ctx.markupDragStartRef.current.y;
      if (Math.abs(deltaX) > 0.001 || Math.abs(deltaY) > 0.001) ctx.didDragMoveRef.current = true;
      ctx.dragDeltaRef.current.x += deltaX;
      ctx.dragDeltaRef.current.y += deltaY;
      ctx.markupDragStartRef.current = { ...ctx.markupDragStartRef.current, x: normalizedX, y: normalizedY };
      if (ctx.continuousSelectionRef.current) {
        ctx.continuousSelectionRef.current.style.transform = `translate(${ctx.dragDeltaRef.current.x * pageWidth}px, ${ctx.dragDeltaRef.current.y * pageHeight}px)`;
      }
      const markupEl = document.querySelector(`[data-markup-id="${ctx.selectedMarkupRef.current.id}"]`);
      if (markupEl) markupEl.style.transform = `translate(${ctx.dragDeltaRef.current.x * pageWidth}px, ${ctx.dragDeltaRef.current.y * pageHeight}px)`;
      return;
    }

    // Markup resizing
    if (ctx.isResizingMarkupRef.current && ctx.selectedMarkupRef.current && ctx.resizeHandleRef.current && ctx.markupDragStartRef.current) {
      if (ctx.selectedMarkupRef.current.page !== pageIdx) return;
      const deltaX = normalizedX - ctx.markupDragStartRef.current.x;
      const deltaY = normalizedY - ctx.markupDragStartRef.current.y;
      ctx.resizeMarkup(ctx.selectedMarkupRef.current.id, ctx.resizeHandleRef.current, deltaX, deltaY, ctx.markupDragStartRef.current.bounds);
      ctx.markupDragStartRef.current = { ...ctx.markupDragStartRef.current, x: normalizedX, y: normalizedY };
      return;
    }

    // DOM-based hover highlighting (zero React overhead)
    if ((ctx.markupMode === 'select' || ctx.markupMode === null || ctx.selectMode) &&
        ctx.markupEditMode && !ctx.isDraggingMarkupRef.current && !ctx.isResizingMarkupRef.current &&
        !ctx.isRotatingMarkupRef.current && !ctx.isDrawingMarkupRef.current) {
      const allPageMarkups = ctx.markups.filter(m => m.filename === ctx.currentFileIdentifier && m.page === pageIdx);
      let hitMarkup = null;
      for (let i = allPageMarkups.length - 1; i >= 0; i--) {
        const m = allPageMarkups[i];
        const minX = Math.min(m.startX || 0, m.endX || 0), maxX = Math.max(m.startX || 0, m.endX || 0);
        const minY = Math.min(m.startY || 0, m.endY || 0), maxY = Math.max(m.startY || 0, m.endY || 0);
        if (normalizedX >= minX - 0.01 && normalizedX <= maxX + 0.01 && normalizedY >= minY - 0.01 && normalizedY <= maxY + 0.01) { hitMarkup = m; break; }
      }
      const newHoveredId = hitMarkup?.id || null;
      if (newHoveredId !== ctx.hoveredMarkupIdRef.current) {
        if (ctx.hoveredMarkupIdRef.current) {
          const prevEl = document.querySelector(`[data-markup-id="${ctx.hoveredMarkupIdRef.current}"]`);
          if (prevEl) prevEl.classList.remove('markup-hovered');
        }
        if (newHoveredId) {
          const newEl = document.querySelector(`[data-markup-id="${newHoveredId}"]`);
          if (newEl) newEl.classList.add('markup-hovered');
        }
        ctx.hoveredMarkupIdRef.current = newHoveredId;
      }
    }

    // Drawing
    if (!ctx.isDrawingMarkupRef.current || !ctx.currentMarkupRef.current) return;
    if (ctx.currentMarkupRef.current.page !== pageIdx) return;
    const markup = ctx.currentMarkupRef.current;
    if (markup.type === 'pen' || markup.type === 'highlighter') {
      markup.points.push({ x: normalizedX, y: normalizedY });
    } else if (markup.startX !== undefined && !['polyline', 'polylineArrow', 'cloudPolyline', 'polygon'].includes(markup.type)) {
      markup.endX = normalizedX;
      markup.endY = normalizedY;
    }
    if (!ctx.rafIdRef.current) {
      ctx.rafIdRef.current = requestAnimationFrame(() => { ctx.updateDrawingOverlay(); ctx.rafIdRef.current = null; });
    }
  };

  const handleMouseUp = (e) => {
    const ctx = ctxRef.current;

    // Drag/resize completion
    if (ctx.isDraggingMarkupRef.current || ctx.isResizingMarkupRef.current) {
      if (ctx.isDraggingMarkupRef.current && !ctx.didDragMoveRef.current && ctx.wasAlreadySelectedRef.current && ctx.selectedMarkupRef.current) {
        ctx.setSelectedMarkup(null);
        ctx.selectedMarkupRef.current = null;
      } else if (ctx.selectedMarkupRef.current && ctx.isDraggingMarkupRef.current && ctx.didDragMoveRef.current) {
        const totalDX = ctx.dragDeltaRef.current.x, totalDY = ctx.dragDeltaRef.current.y;
        if (Math.abs(totalDX) > 0.001 || Math.abs(totalDY) > 0.001) {
          ctx.moveMarkup(ctx.selectedMarkupRef.current.id, totalDX, totalDY);
          setTimeout(() => {
            const updated = ctx.markups.find(m => m.id === ctx.selectedMarkupRef.current?.id);
            if (updated) { ctx.setSelectedMarkup(updated); ctx.selectedMarkupRef.current = updated; }
          }, 0);
        }
      } else if (ctx.selectedMarkupRef.current && ctx.isResizingMarkupRef.current) {
        const updated = ctx.markups.find(m => m.id === ctx.selectedMarkupRef.current.id);
        if (updated) { ctx.setSelectedMarkup(updated); ctx.selectedMarkupRef.current = updated; }
      }
      ctx.dragDeltaRef.current = { x: 0, y: 0 };
      if (ctx.continuousSelectionRef.current) ctx.continuousSelectionRef.current.style.transform = '';
      if (ctx.selectedMarkupRef.current) {
        const mkEl = document.querySelector(`[data-markup-id="${ctx.selectedMarkupRef.current.id}"]`);
        if (mkEl) mkEl.style.transform = '';
      }
      if (ctx.didDragMoveRef.current || ctx.isResizingMarkupRef.current) ctx.setUnsavedMarkupFiles(prev => new Set([...prev, ctx.currentFileIdentifier]));
      ctx.isDraggingMarkupRef.current = false; ctx.setIsDraggingMarkup(false);
      ctx.isResizingMarkupRef.current = false; ctx.setIsResizingMarkup(false);
      ctx.didDragMoveRef.current = false; ctx.wasAlreadySelectedRef.current = false;
      ctx.resizeHandleRef.current = null; ctx.setResizeHandle(null);
      ctx.markupDragStartRef.current = null; ctx.setMarkupDragStart(null);
      return;
    }

    // Drawing completion
    if (!ctx.isDrawingMarkupRef.current || !ctx.currentMarkupRef.current) return;
    if (ctx.currentMarkupRef.current.page !== pageIdx) return;
    if (ctx.rafIdRef.current) { cancelAnimationFrame(ctx.rafIdRef.current); ctx.rafIdRef.current = null; }
    const markup = { ...ctx.currentMarkupRef.current };
    if (markup.points) markup.points = [...markup.points];
    if (ctx.drawingOverlayRef.current) ctx.drawingOverlayRef.current.innerHTML = '';

    if (markup.type === 'pen' || markup.type === 'highlighter') {
      if (markup.points && markup.points.length >= 2) {
        ctx.addMarkupWithHistory(markup);
        ctx.setUnsavedMarkupFiles(prev => new Set([...prev, ctx.currentFileIdentifier]));
      }
      ctx.setCurrentMarkup(null); ctx.currentMarkupRef.current = null;
      ctx.setIsDrawingMarkup(false); ctx.isDrawingMarkupRef.current = false;
    } else if (['arrow', 'line', 'rectangle', 'circle', 'cloud', 'arc'].includes(markup.type)) {
      const dx = Math.abs(markup.endX - markup.startX), dy = Math.abs(markup.endY - markup.startY);
      if (dx > 0.005 || dy > 0.005) {
        ctx.addMarkupWithHistory(markup);
        ctx.setUnsavedMarkupFiles(prev => new Set([...prev, ctx.currentFileIdentifier]));
      }
      ctx.setCurrentMarkup(null); ctx.currentMarkupRef.current = null;
      ctx.setIsDrawingMarkup(false); ctx.isDrawingMarkupRef.current = false;
    } else if (markup.type === 'text' || markup.type === 'callout') {
      const dx = Math.abs(markup.endX - markup.startX), dy = Math.abs(markup.endY - markup.startY);
      if (dx > 0.01 && dy > 0.01) {
        const norm = { ...markup, startX: Math.min(markup.startX, markup.endX), startY: Math.min(markup.startY, markup.endY), endX: Math.max(markup.startX, markup.endX), endY: Math.max(markup.startY, markup.endY) };
        ctx.addMarkupWithHistory(norm);
        ctx.setUnsavedMarkupFiles(prev => new Set([...prev, ctx.currentFileIdentifier]));
        ctx.setEditingTextMarkupId(norm.id);
        ctx.setTextEditValue('');
        ctx.setSelectedMarkup(norm);
        ctx.selectedMarkupRef.current = norm;
      }
      ctx.setCurrentMarkup(null); ctx.currentMarkupRef.current = null;
      ctx.setIsDrawingMarkup(false); ctx.isDrawingMarkupRef.current = false;
    }
    // Polylines continue until double-click
  };

  const handleDoubleClick = (e) => {
    const ctx = ctxRef.current;

    // Finalize polyline
    if (ctx.currentMarkupRef.current &&
        ['polyline', 'polylineArrow', 'cloudPolyline', 'polygon'].includes(ctx.currentMarkupRef.current.type) &&
        ctx.currentMarkupRef.current.page === pageIdx) {
      e.preventDefault(); e.stopPropagation();
      const m = ctx.currentMarkupRef.current;
      const pointsToSave = m.points.slice(0, -1);
      if (pointsToSave.length >= 2) {
        const allX = pointsToSave.map(p => p.x), allY = pointsToSave.map(p => p.y);
        const newMk = { ...m, points: [...pointsToSave], closed: false, startX: Math.min(...allX), startY: Math.min(...allY), endX: Math.max(...allX), endY: Math.max(...allY), author: ctx.markupAuthor, createdDate: new Date().toISOString() };
        delete newMk._cursorX; delete newMk._cursorY;
        ctx.addMarkupWithHistory(newMk);
      }
      ctx.currentMarkupRef.current = null;
      ctx.isDrawingMarkupRef.current = false;
      if (ctx.drawingOverlayRef.current) ctx.drawingOverlayRef.current.innerHTML = '';
      return;
    }

    // Double-click to deselect non-text markup (only in edit mode)
    if (ctx.markupEditMode && ctx.selectedMarkup && ctx.selectedMarkup.page === pageIdx) {
      const { normalizedX, normalizedY } = getPageCoords(e);
      const bounds = ctx.getMarkupBounds(ctx.selectedMarkup);
      if (bounds) {
        const pad = 0.015;
        const isInBounds = normalizedX >= bounds.minX - pad && normalizedX <= bounds.maxX + pad && normalizedY >= bounds.minY - pad && normalizedY <= bounds.maxY + pad;
        if (isInBounds && ctx.selectedMarkup.type !== 'text' && ctx.selectedMarkup.type !== 'callout') {
          ctx.setSelectedMarkup(null); ctx.selectedMarkupRef.current = null;
          return;
        }
      }
    }

    // Double-click on text markup → edit (only in edit mode)
    if (!ctx.markupEditMode) return;
    const { normalizedX, normalizedY } = getPageCoords(e);
    const hitMarkup = pageMarkups.find(m => {
      if (m.readOnly) return false;
      if (m.type !== 'text' && m.type !== 'callout') return false;
      const bounds = ctx.getMarkupBounds(m);
      if (!bounds) return false;
      return normalizedX >= bounds.minX && normalizedX <= bounds.maxX && normalizedY >= bounds.minY && normalizedY <= bounds.maxY;
    });
    if (hitMarkup) {
      e.preventDefault(); e.stopPropagation();
      ctx.setEditingTextMarkupId(hitMarkup.id);
      ctx.setTextEditValue(hitMarkup.text || '');
      ctx.setSelectedMarkup(hitMarkup);
      ctx.selectedMarkupRef.current = hitMarkup;
    }
  };

  const handleMouseLeave = (e) => {
    const ctx = ctxRef.current;
    if (ctx.isDraggingMarkupRef.current || ctx.isResizingMarkupRef.current) handleMouseUp(e);
    if (ctx.isDrawingMarkupRef.current && ctx.currentMarkupRef.current?.page === pageIdx) {
      if (!['polyline', 'polylineArrow', 'cloudPolyline', 'polygon'].includes(ctx.currentMarkupRef.current.type)) handleMouseUp(e);
    }
  };

  // =====================================================================
  // JSX RETURN
  // =====================================================================
  const pagePos = continuousLayout.positions?.[pageNum];
  if (!pagePos) return null;

  return (
    <div
      className="pdf-continuous-page"
      data-page={pageNum}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      onMouseLeave={handleMouseLeave}
      style={{
        position: 'absolute',
        ...(continuousLayout.isHorizontal
          ? { left: pagePos.left, top: `calc(50% - ${pageHeight / 2}px)` }
          : { top: pagePos.top, left: `calc(50% - ${pageWidth / 2}px)` }
        ),
        width: pageWidth,
        height: pageHeight,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        background: 'white',
        overflow: 'hidden',
        contain: 'strict',
        containIntrinsicSize: `${pageWidth}px ${pageHeight}px`,
        // Cursor is set on the container — no per-page cursor needed
      }}
    >
      {/* Canvas — persists across scrolling, ref registered via callback */}
      <canvas
        ref={canvasRefCb}
        style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
      />

      {/* Loading indicator */}
      {isPageVisible && !isRendered && (
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#999', fontSize: '14px', background: 'white', pointerEvents: 'none',
        }}>
          Loading page {pageNum}...
        </div>
      )}

      {/* ─── Markup SVG Overlay ─────────────────────────────────────────── */}
      <svg
        className="markup-overlay"
        viewBox={`0 0 ${pageWidth} ${pageHeight}`}
        style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          pointerEvents: (markupMode || selectMode || markupEditMode) ? 'auto' : 'none',
        }}
      >
        {/* Render all markups */}
        {isPageVisible && overlaysReady && pageMarkups.map(markupFromList => {
          const markup = (selectedMarkup && markupFromList.id === selectedMarkup.id) ? selectedMarkup : markupFromList;
          const ctx = ctxRef.current;
          const sw = scaledStrokeWidth(markup.strokeWidth);
          return renderMarkupShape(markup, {
            scaledWidth: pageWidth, scaledHeight: pageHeight, scale,
            scaledStrokeWidth: sw, rotation: ctx.rotation || 0, getLineDashArray: ctx.getLineDashArray,
            selectedMarkup, markupMode, selectMode, markupEditMode,
            editingTextMarkupId, expandedNotes, toggleNoteExpanded: ctx.toggleNoteExpanded,
            setEditingNoteId: ctx.setEditingNoteId, setNoteText: ctx.setNoteText,
            setNoteDialogPosition: ctx.setNoteDialogPosition, setShowNoteDialog: ctx.setShowNoteDialog,
            canvasSize: ctx.canvasSize,
          });
        })}

        {/* Hit-test boxes for PDF annotations not yet owned */}
        {markupEditMode && (() => {
          const ctx = ctxRef.current;
          return ctx.markups
            .filter(m => m.page === pageIdx && m.filename === ctx.currentFileIdentifier && m.fromPdf && !ctx.ownedPdfAnnotationIds.has(m.id) && (!selectedMarkup || m.id !== selectedMarkup.id))
            .map(markup => {
              const bounds = ctx.getMarkupBounds(markup);
              if (!bounds) return null;
              const { minX, maxX, minY, maxY } = bounds;
              const x = minX * pageWidth, y = minY * pageHeight;
              const w = (maxX - minX) * pageWidth, h = (maxY - minY) * pageHeight;
              const padding = 3;
              return (
                <rect
                  key={`hit-${markup.id}`}
                  x={x - padding} y={y - padding}
                  width={w + padding * 2} height={h + padding * 2}
                  fill="transparent" stroke="none"
                  style={{ cursor: 'pointer', pointerEvents: 'all' }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    let editableMarkup = markup;
                    if ((markup.hasCustomAppearance && !markup.modified) || (markup.type === 'text' && markup.x !== undefined && markup.startX === undefined)) {
                      editableMarkup = ctx.convertToEditableFormat(markup);
                      ctx.setMarkups(prev => prev.map(m => m.id === markup.id ? editableMarkup : m));
                    }
                    ctx.takeOwnershipOfAnnotation(markup.id);
                    ctx.setSelectedMarkup(editableMarkup);
                    ctx.selectedMarkupRef.current = editableMarkup;
                    ctx.setSelectedMarkups([]); ctx.selectedMarkupsRef.current = [];
                    if (ctx.currentPage !== pageNum) ctx.setCurrentPage(pageNum);
                    if (!markup.readOnly) {
                      ctx.setIsDraggingMarkup(true); ctx.isDraggingMarkupRef.current = true;
                      ctx.didDragMoveRef.current = false; ctx.wasAlreadySelectedRef.current = false;
                      const { normalizedX, normalizedY } = getPageCoords(e);
                      const dragBounds = ctx.getMarkupBounds(editableMarkup);
                      const dragStart = { x: normalizedX, y: normalizedY, bounds: dragBounds, page: pageIdx };
                      ctx.setMarkupDragStart(dragStart); ctx.markupDragStartRef.current = dragStart;
                    }
                  }}
                />
              );
            });
        })()}

        {/* Selection handles */}
        {selectedMarkup && selectedMarkup.page === pageIdx && (markupEditMode || !selectedMarkup.fromPdf) &&
          renderSelectionHandles({
            selectedMarkup, getMarkupBounds: ctxRef.current.getMarkupBounds,
            scaledWidth: pageWidth, scaledHeight: pageHeight, scale,
            gStyle: { pointerEvents: 'all' },
            selectionRef: ctxRef.current.continuousSelectionRef,
            draggingPolylinePoint: ctxRef.current.draggingPolylinePointRef?.current,
            onPolylinePointMouseDown: (e, pointIndex) => {
              e.stopPropagation();
              const ctx = ctxRef.current;
              if (ctx.draggingPolylinePointRef) ctx.draggingPolylinePointRef.current = pointIndex;
              if (ctx.isDraggingMarkupRef) ctx.isDraggingMarkupRef.current = true;
              if (ctx.setIsDraggingMarkup) ctx.setIsDraggingMarkup(true);
              if (ctx.setDraggingPolylinePoint) ctx.setDraggingPolylinePoint(pointIndex);
              if (ctx.didDragMoveRef) ctx.didDragMoveRef.current = false;
              const svgEl = e.currentTarget.ownerSVGElement;
              if (!svgEl) return;
              const rect = svgEl.getBoundingClientRect();
              const clickX = (e.clientX - rect.left) / scale / (ctx.canvasSize?.width || 1);
              const clickY = (e.clientY - rect.top) / scale / (ctx.canvasSize?.height || 1);
              const dragStart = { x: clickX, y: clickY, bounds: ctx.getMarkupBounds(selectedMarkup) };
              if (ctx.markupDragStartRef) ctx.markupDragStartRef.current = dragStart;
              if (ctx.setMarkupDragStart) ctx.setMarkupDragStart(dragStart);
            },
            onRotateMouseDown: (e, centerX, centerY, currentRotation) => {
              const svgEl = e.currentTarget.ownerSVGElement;
              if (!svgEl) return;
              const rect = svgEl.getBoundingClientRect();
              const mouseX = e.clientX - rect.left;
              const mouseY = e.clientY - rect.top;
              const startAngle = Math.atan2(mouseY - centerY, mouseX - centerX) * 180 / Math.PI;
              const ctx = ctxRef.current;
              if (ctx.isRotatingMarkupRef) ctx.isRotatingMarkupRef.current = true;
              if (ctx.setIsRotatingMarkup) ctx.setIsRotatingMarkup(true);
              if (ctx.rotationStartRef) ctx.rotationStartRef.current = {
                centerX, centerY,
                startAngle,
                initialRotation: currentRotation || 0,
              };
            },
          })
        }

        {/* Inline text editing */}
        {editingTextMarkupId && (() => {
          const ctx = ctxRef.current;
          const mk = ctx.markups.find(m => m.id === editingTextMarkupId);
          if (!mk || mk.page !== pageIdx) return null;
          if (mk.startX === undefined || mk.endX === undefined) return null;
          const boxX = Math.min(mk.startX, mk.endX) * pageWidth;
          const boxY = Math.min(mk.startY, mk.endY) * pageHeight;
          const boxW = Math.abs(mk.endX - mk.startX) * pageWidth;
          const boxH = Math.abs(mk.endY - mk.startY) * pageHeight;
          const fs = (mk.fontSize || 12) * scale;
          const pad = 4 * scale;
          return (
            <foreignObject x={boxX} y={boxY} width={boxW} height={boxH} style={{ overflow: 'visible' }}>
              <textarea
                xmlns="http://www.w3.org/1999/xhtml"
                ref={ctx.textInputRef}
                defaultValue={ctx.textEditValue}
                onBlur={() => ctx.saveTextEdit(false)}
                onFocus={(e) => { const len = e.target.value.length; e.target.setSelectionRange(len, len); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') ctx.cancelTextEdit();
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ctx.saveTextEdit(true); }
                }}
                autoFocus
                style={{
                  width: '100%', height: '100%', border: '2px solid #3498db',
                  padding: `${pad}px`, fontSize: `${fs}px`, fontFamily: 'Helvetica, Arial, sans-serif',
                  color: mk.color || '#000', backgroundColor: mk.fillColor === 'none' ? 'transparent' : (mk.fillColor || 'white'),
                  resize: 'none', outline: 'none', boxSizing: 'border-box', overflow: 'hidden',
                }}
              />
            </foreignObject>
          );
        })()}

        {/* Drawing overlay — updated via ref, not React state */}
        <g
          className="drawing-overlay"
          data-page={pageNum}
          ref={el => {
            if (el) {
              const ctx = ctxRef.current;
              if (ctx.isDrawingMarkupRef.current && ctx.currentMarkupRef.current?.page === pageIdx) {
                ctx.drawingOverlayRef.current = el;
              }
            }
          }}
        />

        {/* Zoom box */}
        {zoomBox && (
          <rect
            x={Math.min(zoomBox.startX, zoomBox.endX) * pageWidth}
            y={Math.min(zoomBox.startY, zoomBox.endY) * pageHeight}
            width={Math.abs(zoomBox.endX - zoomBox.startX) * pageWidth}
            height={Math.abs(zoomBox.endY - zoomBox.startY) * pageHeight}
            fill="rgba(52, 152, 219, 0.2)" stroke="white" strokeWidth={2} strokeDasharray="5,5"
          />
        )}

        <defs>
          <marker id={`arrowhead-${pageNum}`} markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
          </marker>
        </defs>
      </svg>

      {/* ─── Overlay layer (hotspots, objects, OCR, regions) ──────────── */}
      {isPageVisible && (() => {
        const ctx = ctxRef.current;
        // Use ref (not state) — isZoomingRef stays true during commit re-render,
        // preventing expensive overlay computation on the same frame as canvas re-renders.
        const isZooming = ctx.isZoomingRef?.current || ctx.isZooming;

        // Feature flags — short-circuit early if nothing to render
        const hasRects = (ctx.currentRect && pageNum === ctx.currentPage);
        const hasPolylinePreview = (ctx.drawingShapeType === 'polyline' && ctx.polylinePoints?.length > 0 && pageNum === ctx.currentPage);
        const hasTrainingBoxes = (pageNum === ctx.currentPage && ctx.trainingBoxes?.length > 0);
        const hasObjTraining = (ctx.objectTrainingBoxes?.length > 0);
        const hasOcr = (showOcrOnPdf && !isZooming && ctx.ocrResults?.length > 0);
        const hasPendingShape = (ctx.pendingShape && ctx.pendingShape.page === pageIdx);
        const hasRegions = (showRegionBoxes && !isZooming && ctx.drawnRegions?.length > 0);
        const hasObjects = (showObjectBoxes && !isZooming);
        const hasHotspots = (showLinksOnPdf && !isZooming);

        if (!hasRects && !hasPolylinePreview && !hasTrainingBoxes && !hasObjTraining && !hasOcr && !hasPendingShape && !hasRegions && !hasObjects && !hasHotspots && !overlaysReady) return null;

        return (
          <div
            className="hotspot-overlay"
            style={{ position: 'absolute', top: 0, left: 0, width: pageWidth, height: pageHeight, pointerEvents: 'none', zIndex: 15 }}
          >
            {/* Drawing rect preview */}
            {hasRects && (ctx.objectFinderMode === 'train' || ctx.objectFinderMode === 'create') && (
              <div className={`drawing-rect ${ctx.drawingShapeType === 'circle' ? 'circle' : ''}`}
                style={{ left: ctx.currentRect.x * scale, top: ctx.currentRect.y * scale, width: ctx.currentRect.width * scale, height: ctx.currentRect.height * scale, borderRadius: ctx.drawingShapeType === 'circle' ? '50%' : '0' }}
              />
            )}
            {hasRects && (ctx.linkMode === 'train' || ctx.linkMode === 'create') && (
              <div className={`drawing-rect ${ctx.linkMode === 'train' ? 'training' : 'creating'}`}
                style={{ left: ctx.currentRect.x * scale, top: ctx.currentRect.y * scale, width: ctx.currentRect.width * scale, height: ctx.currentRect.height * scale }}
              />
            )}

            {/* Polyline drawing preview */}
            {hasPolylinePreview && (ctx.objectFinderMode === 'train' || ctx.objectFinderMode === 'create') && (
              <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 500 }}>
                {ctx.polylinePoints.map((point, i) => {
                  if (i === 0) return null;
                  const prev = ctx.polylinePoints[i - 1];
                  return <line key={i} x1={prev.x * pageWidth} y1={prev.y * pageHeight} x2={point.x * pageWidth} y2={point.y * pageHeight} stroke="white" strokeWidth="2" />;
                })}
                {ctx.polylineMousePos && <line x1={ctx.polylinePoints[ctx.polylinePoints.length - 1].x * pageWidth} y1={ctx.polylinePoints[ctx.polylinePoints.length - 1].y * pageHeight} x2={ctx.polylineMousePos.x * pageWidth} y2={ctx.polylineMousePos.y * pageHeight} stroke="white" strokeWidth="2" strokeDasharray="5,5" opacity="0.7" />}
                {ctx.isNearStartPoint && ctx.polylineMousePos && <line x1={ctx.polylineMousePos.x * pageWidth} y1={ctx.polylineMousePos.y * pageHeight} x2={ctx.polylinePoints[0].x * pageWidth} y2={ctx.polylinePoints[0].y * pageHeight} stroke="white" strokeWidth="2" strokeDasharray="5,5" opacity="0.7" />}
                {ctx.polylinePoints.map((point, i) => <circle key={`pt-${i}`} cx={point.x * pageWidth} cy={point.y * pageHeight} r={i === 0 ? (ctx.isNearStartPoint ? 12 : 8) : 5} fill={i === 0 ? '#27ae60' : '#3498db'} stroke={i === 0 && ctx.isNearStartPoint ? '#fff' : 'white'} strokeWidth={i === 0 && ctx.isNearStartPoint ? 3 : 2} style={i === 0 && ctx.isNearStartPoint ? { filter: 'drop-shadow(0 0 4px #27ae60)' } : {}} />)}
                {ctx.isNearStartPoint && <text x={ctx.polylinePoints[0].x * pageWidth} y={ctx.polylinePoints[0].y * pageHeight - 20} fill="white" fontSize="12" fontWeight="bold" textAnchor="middle">Click to close</text>}
              </svg>
            )}

            {/* Link training boxes */}
            {hasTrainingBoxes && ctx.trainingBoxes.map(box => (
              <div key={box.id} className="training-box" style={{ left: box.x * pageWidth, top: box.y * pageHeight, width: box.width * pageWidth, height: box.height * pageHeight }}>
                <span className="box-label">Training</span>
              </div>
            ))}

            {/* Object Finder Training Boxes */}
            {hasObjTraining && overlaysReady && (() => {
              const pageTrainingBoxes = ctx.objectTrainingBoxes.filter(box => box.page === pageIdx);
              if (pageTrainingBoxes.length === 0) return null;
              return pageTrainingBoxes.map(box => {
                const coords = box.bbox || box;
                const classNames = [box.className, box.label, box.parentClass];
                const { fillColor: tbFill, borderColor: tbBorderRaw } = ctx.getClassColors(classNames);
                let shapeType = box.shapeType;
                if (!shapeType) {
                  const model = ctx.objectModels?.find(m => m.className === box.className || m.className === box.label || m.className === box.parentClass);
                  shapeType = model?.shapeType || ctx.getClassShapeType(classNames);
                }
                const isCircle = shapeType === 'circle';
                const isPolyline = shapeType === 'polyline';
                const isNoFill = tbFill === 'none', isNoBorder = tbBorderRaw === 'none';
                const isFullyHidden = isNoFill && isNoBorder;
                const bgColor = isNoFill ? 'transparent' : ctx.hexToRgba(tbFill, 0.2);
                const borderColor = isNoBorder ? 'transparent' : tbBorderRaw;
                const labelColor = isNoBorder ? (isNoFill ? '#666' : tbFill) : tbBorderRaw;

                if (isPolyline && box.polylinePoints) {
                  return (
                    <svg key={box.id} style={{ position: 'absolute', top: 0, left: 0, width: pageWidth, height: pageHeight, pointerEvents: 'none', zIndex: 5 }}>
                      <polygon points={box.polylinePoints.map(p => `${p.x * pageWidth},${p.y * pageHeight}`).join(' ')} fill={isNoFill ? 'transparent' : tbFill} fillOpacity={isNoFill ? 0 : 0.2} stroke={isNoBorder ? 'transparent' : borderColor} strokeWidth={isNoBorder ? 0 : 2} />
                      {!isFullyHidden && <text x={coords.x * pageWidth + 4} y={coords.y * pageHeight - 4} fill="white" fontSize="11" fontWeight="bold" style={{ paintOrder: 'stroke', stroke: labelColor, strokeWidth: 3 }}>{box.className || box.label || 'Object'}</text>}
                    </svg>
                  );
                }
                return (
                  <div key={box.id} className={`training-box object-training-box ${box.subclassRegion ? 'has-subclass-region' : ''} ${isCircle ? 'circle-shape' : ''} ${isFullyHidden ? 'no-color' : ''}`}
                    style={{ left: coords.x * pageWidth, top: coords.y * pageHeight, width: coords.width * pageWidth, height: coords.height * pageHeight, borderColor, backgroundColor: bgColor, borderRadius: isCircle ? '50%' : '0', borderWidth: isNoBorder ? '0' : '2px' }}>
                    {!isFullyHidden && <span className="box-label" style={{ backgroundColor: labelColor }}>{box.className || box.label || 'Object'}</span>}
                    {box.subclassRegions && Object.entries(box.subclassRegions).map(([subName, region]) => (
                      <div key={subName} className="subclass-region-indicator" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} title={subName}>
                        <span className="subclass-region-name">{subName}</span>
                      </div>
                    ))}
                  </div>
                );
              });
            })()}

            {/* OCR Text Boxes */}
            {hasOcr && (() => {
              let pageOcr = ctx.ocrResults.filter(r => r.page === pageNum);
              // Apply filter and compute match positions
              if (ctx.ocrFilter) {
                const lowerFilter = ctx.ocrFilter.toLowerCase();
                pageOcr = pageOcr.map(r => {
                  const idx = (r.text || '').toLowerCase().indexOf(lowerFilter);
                  if (idx === -1) return null;
                  return { ...r, matchStart: idx, matchLength: lowerFilter.length };
                }).filter(Boolean);
              }
              return pageOcr.map((item, idx) => {
                const isVert = item.orientation && item.orientation !== 'horizontal';
                const isVertUp = item.orientation === 'vertical-up';
                const isVertDown = item.orientation === 'vertical-down';
                const isPartialMatch = item.matchStart !== undefined && 
                  (item.matchStart > 0 || item.matchStart + item.matchLength < item.text.length);
                const textStyle = {
                  position: 'absolute', left: item.bbox.x * pageWidth, top: item.bbox.y * pageHeight,
                  fontSize: Math.max(10, Math.min(14, (isVert ? item.bbox.width : item.bbox.height) * pageHeight * 0.8)),
                  color: 'white', fontWeight: 'bold', textShadow: '1px 1px 2px black, -1px -1px 2px black, 1px -1px 2px black, -1px 1px 2px black',
                  pointerEvents: 'none', zIndex: 3, whiteSpace: 'nowrap',
                };
                if (isPartialMatch) { textStyle.background = 'transparent'; textStyle.border = 'none'; }
                if (isVertUp) { textStyle.transform = 'rotate(-90deg)'; textStyle.transformOrigin = 'left top'; textStyle.left = (item.bbox.x + item.bbox.width) * pageWidth; }
                else if (isVertDown) { textStyle.transform = 'rotate(90deg)'; textStyle.transformOrigin = 'left top'; }
                return (
                  <div key={`ocr-${pageNum}-${idx}`} className={isPartialMatch ? 'ocr-text-overlay ocr-partial-match' : 'ocr-text-overlay'} style={textStyle} title={`${item.displayText || item.text} (${(item.confidence * 100).toFixed(0)}%)${isVert ? ' [vertical]' : ''}`}>
                    {isPartialMatch ? (<>
                      <span style={{ opacity: 0.4 }}>{item.text.slice(0, item.matchStart)}</span>
                      <span style={{ background: 'rgba(39, 174, 96, 0.55)', borderRadius: 2, padding: '0 1px' }}>{item.text.slice(item.matchStart, item.matchStart + item.matchLength)}</span>
                      <span style={{ opacity: 0.4 }}>{item.text.slice(item.matchStart + item.matchLength)}</span>
                    </>) : (item.displayText || item.text)}
                  </div>
                );
              });
            })()}

            {/* Pending shape confirmation */}
            {hasPendingShape && (
              <div className="pending-shape-container" style={{ left: ctx.pendingShape.x * pageWidth, top: ctx.pendingShape.y * pageHeight, width: ctx.pendingShape.width * pageWidth, height: ctx.pendingShape.height * pageHeight }}>
                {ctx.pendingShape.shapeType === 'polyline' && ctx.pendingShape.polylinePoints ? (
                  <svg style={{ position: 'absolute', top: -ctx.pendingShape.y * pageHeight, left: -ctx.pendingShape.x * pageWidth, width: pageWidth, height: pageHeight, pointerEvents: 'none' }}>
                    <polygon points={ctx.pendingShape.polylinePoints.map(p => `${p.x * pageWidth},${p.y * pageHeight}`).join(' ')} fill="rgba(52,152,219,0.15)" stroke="white" strokeWidth="2" strokeDasharray="5,5" />
                  </svg>
                ) : (
                  <div style={{ width: '100%', height: '100%', border: '2px dashed rgba(52,152,219,0.8)', borderRadius: ctx.pendingShape.shapeType === 'circle' ? '50%' : '0', background: 'rgba(52,152,219,0.1)' }} />
                )}
                <div className="pending-shape-controls" style={{ position: 'absolute', top: -32, right: 0, display: 'flex', gap: 4 }}>
                  <button className="confirm-btn" onClick={() => ctx.setPendingShape(null)}>✓</button>
                  <button className="cancel-btn" onClick={() => ctx.setPendingShape(null)}>✕</button>
                </div>
              </div>
            )}

            {/* Drawn Regions */}
            {hasRegions && overlaysReady && ctx.drawnRegions
              .filter(region => {
                if (region.page !== pageIdx) return false;
                const regionFilename = region.filename;
                const currentFilename = ctx.currentFile?.backendFilename || ctx.currentFile?.name;
                return regionFilename === currentFilename;
              })
              .map(region => {
                const rtc = ctx.getRegionTypeColors(region.regionType);
                const rFillColor = region.fillColor !== undefined ? region.fillColor : rtc.fillColor;
                const rBorderColor = region.borderColor !== undefined ? region.borderColor : rtc.borderColor;
                const isNoFill = rFillColor === 'none', isNoBorder = rBorderColor === 'none';
                const displayBorder = isNoBorder ? 'transparent' : rBorderColor;
                const displayFill = isNoFill ? 'transparent' : rFillColor;
                const labelColor = isNoBorder ? (isNoFill ? '#666' : rFillColor) : rBorderColor;
                const onRegionClick = (e) => { e.stopPropagation(); ctx.setEditingRegion(region); ctx.setEditRegionName(region.subRegionName); ctx.setShowRegionEditDialog(true); };

                if (region.shapeType === 'polyline' && region.polylinePoints) {
                  return (
                    <svg key={`region_${region.id}`} style={{ position: 'absolute', top: 0, left: 0, width: pageWidth, height: pageHeight, pointerEvents: 'none', zIndex: 4 }}>
                      <polygon points={region.polylinePoints.map(p => `${p.x * pageWidth},${p.y * pageHeight}`).join(' ')} fill={isNoFill ? 'transparent' : displayFill} fillOpacity={isNoFill ? 0 : 0.15} stroke={displayBorder} strokeWidth={isNoBorder ? 0 : 2} strokeDasharray={isNoBorder ? '' : '8,4'} style={{ pointerEvents: 'auto', cursor: 'pointer' }} onClick={onRegionClick} />
                      {(!isNoFill || !isNoBorder) && (
                        <foreignObject x={region.polylinePoints[0]?.x * pageWidth || 0} y={(region.polylinePoints[0]?.y * pageHeight || 0) - 22} width="200" height="20" style={{ overflow: 'visible' }}>
                          <span style={{ display: 'inline-block', background: labelColor, color: 'white', padding: '2px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: '600', whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={onRegionClick}>🗺️ {region.regionType}: {region.subRegionName}</span>
                        </foreignObject>
                      )}
                    </svg>
                  );
                }
                return (
                  <div key={`region_${region.id}`} className={`drawn-region-box ${region.shapeType === 'circle' ? 'circle' : ''}`}
                    style={{ left: region.bbox.x * pageWidth, top: region.bbox.y * pageHeight, width: region.bbox.width * pageWidth, height: region.bbox.height * pageHeight, pointerEvents: 'auto', cursor: 'pointer', position: 'absolute', border: isNoBorder ? 'none' : `2px dashed ${displayBorder}`, backgroundColor: isNoFill ? 'transparent' : `${displayFill}26`, borderRadius: region.shapeType === 'circle' ? '50%' : '0', zIndex: 4 }}
                    onMouseEnter={() => ctx.setHoveredRegion(region.id)} onMouseLeave={() => ctx.setHoveredRegion(null)} onClick={onRegionClick}>
                    {(!isNoFill || !isNoBorder) && <span className="region-box-label" style={{ position: 'absolute', top: '-20px', left: '0', background: labelColor, color: 'white', padding: '2px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: '600', whiteSpace: 'nowrap', pointerEvents: 'auto', cursor: 'pointer' }} onClick={onRegionClick}>🗺️ {region.regionType}: {region.subRegionName}</span>}
                  </div>
                );
              })
            }

            {/* Detected Objects */}
            {hasObjects && overlaysReady && (() => {
              const fileMap = ctx.objectsByFilePage?.get(ctx.currentFile?.backendFilename);
              if (!fileMap) return null;
              let pageObjects = fileMap.get(pageIdx) || [];
              if (hiddenClasses?.length > 0) pageObjects = pageObjects.filter(obj => !hiddenClasses.includes(obj.label) || obj.id === ctx.highlightedObjectId);
              if (pageObjects.length === 0) return null;

              return pageObjects.map(obj => {
                const classNames = [obj.label, obj.className, obj.parentClass];
                const { fillColor: oFill, borderColor: oBorderRaw } = ctx.getClassColors(classNames);
                let shapeType = obj.shapeType;
                if (!shapeType) {
                  const model = ctx.objectModels?.find(m => m.className === obj.label || m.className === obj.className || m.className === obj.parentClass);
                  shapeType = model?.shapeType || ctx.getClassShapeType(classNames);
                }
                const isCircle = shapeType === 'circle', isPolyline = shapeType === 'polyline';
                const isNoFill = oFill === 'none', isNoBorder = oBorderRaw === 'none', isFullyHidden = isNoFill && isNoBorder;
                const bgColor = isNoFill ? 'transparent' : ctx.hexToRgba(oFill, 0.15);
                const borderColor = isNoBorder ? 'transparent' : oBorderRaw;
                const labelColor = isNoBorder ? (isNoFill ? '#666' : oFill) : oBorderRaw;
                const objectIndexMap = ctx.objectIndexMap;
                const onObjClick = () => {
                  const imageData = ctx.captureObjectImage(obj);
                  ctx.setObjectImagePreview(imageData);
                  ctx.setSelectedObject({ ...obj, index: objectIndexMap?.get(obj.id) ?? -1 });
                  ctx.setShowObjectEditDialog(true);
                };

                if (isFullyHidden) {
                  return (
                    <div key={`detected_${obj.id}`} className={`detected-object-box ${ctx.hoveredObject === obj.id ? 'hovered' : ''} ${ctx.highlightedObjectId === obj.id ? 'highlighted' : ''} no-color`}
                      style={{ left: obj.bbox.x * pageWidth, top: obj.bbox.y * pageHeight, width: obj.bbox.width * pageWidth, height: obj.bbox.height * pageHeight, pointerEvents: ctx.zoomMode ? 'none' : 'all', cursor: 'pointer', border: 'none', backgroundColor: 'transparent', zIndex: 10 }}
                      onClick={onObjClick} onMouseEnter={() => ctx.setHoveredObject(obj.id)} onMouseLeave={() => ctx.setHoveredObject(null)}>
                      {(ctx.hoveredObject === obj.id || ctx.highlightedObjectId === obj.id) && (
                        <div className="object-tooltip"><div><strong>{obj.label}</strong></div>
                          {obj.subclassValues && Object.keys(obj.subclassValues).length > 0 ? Object.entries(obj.subclassValues).map(([k, v]) => <div key={k}>{k}: {v || '-'}</div>) : obj.ocr_text && <div>Tag: {obj.ocr_text}</div>}
                          <div>Confidence: {((obj.confidence || 0) * 100).toFixed(0)}%</div><div className="tooltip-hint">Click to edit</div>
                        </div>
                      )}
                    </div>
                  );
                }
                if (isPolyline && obj.polylinePoints) {
                  return (
                    <svg key={`detected_${obj.id}`} style={{ position: 'absolute', top: 0, left: 0, width: pageWidth, height: pageHeight, pointerEvents: 'none', zIndex: 10 }}>
                      <polygon points={obj.polylinePoints.map(p => `${p.x * pageWidth},${p.y * pageHeight}`).join(' ')} fill={isNoFill ? 'transparent' : oFill} fillOpacity={isNoFill ? 0 : 0.15} stroke={isNoBorder ? 'transparent' : borderColor} strokeWidth={isNoBorder ? 0 : 2} style={{ pointerEvents: ctx.zoomMode ? 'none' : 'all', cursor: 'pointer' }} onClick={onObjClick} />
                    </svg>
                  );
                }
                return (
                  <div key={`detected_${obj.id}`} className={`detected-object-box ${ctx.hoveredObject === obj.id ? 'hovered' : ''} ${ctx.highlightedObjectId === obj.id ? 'highlighted' : ''} ${isCircle ? 'circle-shape' : ''}`}
                    style={{ left: obj.bbox.x * pageWidth, top: obj.bbox.y * pageHeight, width: obj.bbox.width * pageWidth, height: obj.bbox.height * pageHeight, pointerEvents: ctx.zoomMode ? 'none' : 'all', cursor: 'pointer', borderColor, backgroundColor: bgColor, borderRadius: isCircle ? '50%' : '0', borderWidth: isNoBorder ? '0' : '2px', zIndex: 10 }}
                    onClick={onObjClick} onMouseEnter={() => ctx.setHoveredObject(obj.id)} onMouseLeave={() => ctx.setHoveredObject(null)}>
                    {(ctx.hoveredObject === obj.id || ctx.highlightedObjectId === obj.id) && (
                      <div className="object-tooltip"><div><strong>{obj.label}</strong></div>
                        {obj.subclassValues && Object.keys(obj.subclassValues).length > 0 ? Object.entries(obj.subclassValues).map(([k, v]) => <div key={k}>{k}: {v || '-'}</div>) : obj.ocr_text && <div>Tag: {obj.ocr_text}</div>}
                        <div>Confidence: {((obj.confidence || 0) * 100).toFixed(0)}%</div><div className="tooltip-hint">Click to edit</div>
                      </div>
                    )}
                    {!hideLabels && <span className="object-box-label" style={{ backgroundColor: labelColor }}>{obj.ocr_text || obj.subclassValues?.Tag || obj.label}</span>}
                  </div>
                );
              });
            })()}

            {/* Hotspots / Smart Links */}
            {hasHotspots && overlaysReady && (() => {
              const pageHotspots = ctx.hotspotsByPage?.get(pageIdx) || [];
              if (pageHotspots.length === 0) return null;
              return pageHotspots.map(hotspot => {
                const targetFile = hotspot.targetFileId ? ctx.allFiles?.find(f => f.id === hotspot.targetFileId) : null;
                const isLinked = !!hotspot.targetFileId && !!targetFile;
                const isBroken = !!hotspot.targetFileId && !targetFile;
                const linkColors = ctx.project?.linkColors || {};
                const colors = isLinked ? (linkColors.assigned || {}) : (linkColors.unassigned || {});
                const defaultStroke = isLinked ? '#27ae60' : '#e74c3c';
                const defaultFill = isLinked ? 'rgba(39, 174, 96, 0.3)' : 'rgba(231, 76, 60, 0.3)';
                const showLine = colors.showLine !== false, showFill = colors.showFill !== false;
                const strokeColor = colors.stroke || defaultStroke;
                const fillColor = colors.fill || defaultFill;
                return (
                  <div key={hotspot.id}
                    className={`hotspot ${ctx.hoveredHotspot === hotspot.id ? 'hovered' : ''} ${isLinked ? 'linked' : ''} ${isBroken ? 'broken' : ''} ${!hotspot.targetFileId ? 'unlinked' : ''} ${ctx.highlightedObjectId === hotspot.id ? 'highlighted' : ''}`}
                    style={{ left: hotspot.x * pageWidth, top: hotspot.y * pageHeight, width: hotspot.width * pageWidth, height: hotspot.height * pageHeight, pointerEvents: 'all', borderColor: showLine ? strokeColor : 'transparent', backgroundColor: showFill ? fillColor : 'transparent' }}
                    onClick={() => ctx.handleHotspotClick(hotspot)}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); ctx.setHotspotContextMenu({ hotspot, x: e.clientX, y: e.clientY, targetFile, isLinked, isBroken }); }}
                    onMouseEnter={() => ctx.setHoveredHotspot(hotspot.id)} onMouseLeave={() => ctx.setHoveredHotspot(null)}>
                    {hotspot.label && <div className={`hotspot-label ${isLinked ? 'linked' : ''} ${isBroken ? 'broken' : ''} ${!hotspot.targetFileId ? 'unlinked' : ''}`} style={{ backgroundColor: showLine ? strokeColor : (isLinked ? '#27ae60' : '#e74c3c') }}>{hotspot.label}</div>}
                    {ctx.hoveredHotspot === hotspot.id && (
                      <div className="hotspot-tooltip">{isLinked ? `Target → ${targetFile.name}${hotspot.assignmentMode === 'property' ? ` (by ${hotspot.propertyName})` : ''}` : isBroken ? `Target → ${hotspot.targetFilename || 'Unknown'} (deleted)` : 'Unassigned'}</div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        );
      })()}
    </div>
  );
}, arePagePropsEqual);

// ─── Custom memo comparison ────────────────────────────────────────────
// Returns true to SKIP re-render (props are equal).
function arePagePropsEqual(prev, next) {
  if (
    prev.pageNum !== next.pageNum ||
    prev.pageWidth !== next.pageWidth ||
    prev.pageHeight !== next.pageHeight ||
    prev.baseWidth !== next.baseWidth ||
    prev.baseHeight !== next.baseHeight ||
    prev.isPageVisible !== next.isPageVisible ||
    prev.isRendered !== next.isRendered ||
    prev.scale !== next.scale ||
    prev.overlaysReady !== next.overlaysReady ||
    prev.markupEditMode !== next.markupEditMode ||
    prev.markupMode !== next.markupMode ||
    prev.selectMode !== next.selectMode ||
    prev.selectedMarkup !== next.selectedMarkup ||
    prev.editingTextMarkupId !== next.editingTextMarkupId ||
    prev.continuousLayout !== next.continuousLayout ||
    prev.expandedNotes !== next.expandedNotes ||
    prev.selectionBox !== next.selectionBox ||
    prev.zoomBox !== next.zoomBox ||
    // Overlay visibility flags
    prev.showObjectBoxes !== next.showObjectBoxes ||
    prev.showLinksOnPdf !== next.showLinksOnPdf ||
    prev.showOcrOnPdf !== next.showOcrOnPdf ||
    prev.showRegionBoxes !== next.showRegionBoxes ||
    prev.hiddenClasses !== next.hiddenClasses ||
    prev.hideLabels !== next.hideLabels
  ) return false;

  // pageMarkups: compare by reference first, then shallow element check
  if (prev.pageMarkups !== next.pageMarkups) {
    if (prev.pageMarkups.length !== next.pageMarkups.length) return false;
    for (let i = 0; i < prev.pageMarkups.length; i++) {
      if (prev.pageMarkups[i] !== next.pageMarkups[i]) return false;
    }
  }

  return true; // All equal → skip re-render
}

export default ContinuousPage;
