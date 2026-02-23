import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { isContinuousView } from './useContinuousLayout';

/**
 * usePdfRenderer – PDF rendering engine for PDFViewerArea.
 *
 * Owns:
 *   - renderPage / renderAllPages / renderSinglePage functions
 *   - isRendering state
 *   - renderedPages tracking (state + ref)
 *   - canvasSize / pageBaseDimensions (computed from rendered page)
 *   - allPageDimensions / precomputedPageDimsRef (page dimension prefetching)
 *   - All rendering refs (isRenderingRef, renderTasksRef, pageRenderingRef, etc.)
 *   - pdfDoc change lock reset (useLayoutEffect)
 *   - Dimension prefetch effect
 *   - Render trigger effects (single, continuous, sideBySide)
 *   - Rotation reset effect
 *   - Newly-visible-pages render effect
 *   - Unmounted page cleanup effect
 *
 * Does NOT own:
 *   - pdfDoc loading / PDF.js script loading
 *   - visiblePages / scroll handler (sets currentPage which parent owns)
 *   - View-switch scroll effect (calls scrollToPagePosition)
 *   - canvasRef (widely used in parent mouse handlers)
 *
 * @param {Object} params
 * @param {Object} params.pdfDoc               – loaded PDF.js document
 * @param {number} params.numPages             – total page count
 * @param {number} params.currentPage          – current page number
 * @param {Object} params.currentPageRef       – ref tracking currentPage
 * @param {number} params.rotation             – rotation in degrees
 * @param {string} params.viewMode             – 'single' | 'continuous' | 'sideBySide'
 * @param {Set}    params.visiblePages         – visible page numbers (for continuous view)
 * @param {Object} params.isZoomingRef         – ref from useZoomPan
 * @param {Object} params.containerRef         – ref to scrollable container
 * @param {Object} params.canvasRef            – ref to single-view canvas element
 * @param {Object} params.continuousLayoutRef  – ref to continuous layout data
 * @param {number} params.CONTINUOUS_VIEW_BUFFER – buffer pages above/below viewport
 */
export default function usePdfRenderer({
  pdfDoc,
  numPages,
  currentPage,
  currentPageRef,
  rotation,
  viewMode,
  visiblePages,
  isZoomingRef,
  isScrollingRef,
  containerRef,
  canvasRef,
  continuousLayoutRef,
  CONTINUOUS_VIEW_BUFFER,
}) {
  // ─── State ───────────────────────────────────────────────────────────
  const [isRendering, setIsRendering] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [pdfPageRotation, setPdfPageRotation] = useState(0);
  const [pageBaseDimensions, setPageBaseDimensions] = useState({ width: 0, height: 0 });
  const [allPageDimensions, setAllPageDimensions] = useState({});
  const [renderedPages, setRenderedPages] = useState(new Set());

  // ─── Refs ────────────────────────────────────────────────────────────
  const isRenderingRef = useRef(false);
  const continuousCanvasRefs = useRef({});
  const renderTasksRef = useRef({});
  const pageRenderingRef = useRef({});
  const prevPdfDocRef = useRef(null);
  const singlePageRenderTaskRef = useRef(null);
  const renderedPagesRef = useRef(new Set());
  const precomputedPageDimsRef = useRef({});
  const prevVisiblePagesRef = useRef(new Set());
  const renderGenerationRef = useRef(0); // Incremented on each renderAllPages call; batches bail out if stale

  // ─── Progressive rendering ────────────────────────────────────────────
  // Render at reduced resolution for instant page appearance, upgrade to 1.5x when settled.
  // Zoom-aware fast pass: when zoomed out, render fewer pixels since display is smaller.
  const FAST_SCALE = 0.75;    // Fast-pass render scale (lower = faster initial paint, upgraded to quality later)
  const QUALITY_SCALE = 1.5;  // Used after 300ms of no activity for sharp text
  const pageRenderQualityRef = useRef({}); // pageNum → scale it was last rendered at
  const qualityUpgradeTimerRef = useRef(null);
  // Zoom scale ref — synced by parent after useZoomPan initializes.
  // Only affects fast-pass resolution; quality pass always uses QUALITY_SCALE.
  const zoomScaleRef = useRef(1);

  // ─── Canvas pool ──────────────────────────────────────────────────────
  // Reuse offscreen canvases to avoid GC pressure during rapid scroll/zoom.
  const canvasPoolRef = useRef([]);
  const CANVAS_POOL_SIZE = 8;

  const acquireOffscreenCanvas = useCallback((width, height) => {
    let canvas = canvasPoolRef.current.pop();
    if (!canvas) {
      canvas = document.createElement('canvas');
    }
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }, []);

  const releaseOffscreenCanvas = useCallback((canvas) => {
    if (canvasPoolRef.current.length < CANVAS_POOL_SIZE) {
      canvasPoolRef.current.push(canvas);
    }
    // else let it be GC'd
  }, []);

  // ─── resetRenderedPages ──────────────────────────────────────────────
  // Exposed for parent to call when reloading PDF or switching files
  const resetRenderedPages = useCallback(() => {
    renderedPagesRef.current = new Set();
    pageRenderQualityRef.current = {};
    setRenderedPages(new Set());
    if (qualityUpgradeTimerRef.current) {
      clearTimeout(qualityUpgradeTimerRef.current);
      qualityUpgradeTimerRef.current = null;
    }
  }, []);

  // ─── CRITICAL: Reset rendering locks when pdfDoc changes (file switch) ──
  useLayoutEffect(() => {
    if (pdfDoc !== prevPdfDocRef.current) {
      isRenderingRef.current = false;
      pageRenderingRef.current = {};
      pageRenderQualityRef.current = {};

      // Cancel any pending quality upgrade
      if (qualityUpgradeTimerRef.current) {
        clearTimeout(qualityUpgradeTimerRef.current);
        qualityUpgradeTimerRef.current = null;
      }

      // Cancel any existing render tasks
      Object.values(renderTasksRef.current).forEach(task => {
        try { task?.cancel?.(); } catch (e) { /* Ignore cancel errors */ }
      });
      renderTasksRef.current = {};

      prevPdfDocRef.current = pdfDoc;
    }
  }, [pdfDoc]);

  // ─── renderSinglePage ────────────────────────────────────────────────
  const renderSinglePage = useCallback(async (pageNum, canvas, renderScale) => {
    if (!pdfDoc || !canvas) return null;

    // Already rendering — skip
    if (pageRenderingRef.current[pageNum]) return null;

    try {
      pageRenderingRef.current[pageNum] = true;

      // Cancel any existing render task for this page
      if (renderTasksRef.current[pageNum]) {
        try { renderTasksRef.current[pageNum].cancel(); } catch (e) {}
        delete renderTasksRef.current[pageNum];
      }

      const page = await pdfDoc.getPage(pageNum);
      // renderScale passed by caller:
      //   - Fast pass: 1x for instant page appearance during scroll/zoom
      //   - Quality pass: 1.5x for sharp text when settled
      //   - Single view: 2x for crisp retina text
      const baseScale = renderScale || 2;
      const viewport = page.getViewport({ scale: baseScale, rotation: page.rotate + rotation });

      // Double-buffer: render to pooled off-screen canvas, then blit to visible canvas.
      const offscreen = acquireOffscreenCanvas(viewport.width, viewport.height);
      const offCtx = offscreen.getContext('2d');

      const renderTask = page.render({
        canvasContext: offCtx,
        viewport: viewport,
        annotationMode: 0
      });

      renderTasksRef.current[pageNum] = renderTask;
      await renderTask.promise;

      // Swap: set visible canvas dimensions and blit in one shot (no white flash)
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext('2d');
      context.drawImage(offscreen, 0, 0);

      // Return offscreen canvas to pool for reuse
      releaseOffscreenCanvas(offscreen);

      delete renderTasksRef.current[pageNum];
      delete pageRenderingRef.current[pageNum];

      const displayWidth = viewport.width / baseScale;
      const displayHeight = viewport.height / baseScale;

      // Update ref only — caller batches the setState
      renderedPagesRef.current.add(pageNum);

      return { width: displayWidth, height: displayHeight };
    } catch (error) {
      delete pageRenderingRef.current[pageNum];
      delete renderTasksRef.current[pageNum];
      if (error?.name === 'RenderingCancelledException') return null;
      console.error(`Error rendering page ${pageNum}:`, error);
      return null;
    }
  }, [pdfDoc, rotation]);

  // ─── renderAllPages (continuous / sideBySide) ─────────────────────────
  // Progressive rendering: first pass at 1x (instant), quality upgrade to 1.5x after 300ms settle.
  const renderAllPages = useCallback(async (forceQuality) => {
    if (!pdfDoc || viewMode === 'single') return;

    // Increment render generation — any older in-flight renderAllPages call
    // will bail out between batches when it sees the generation has advanced.
    const generation = ++renderGenerationRef.current;

    // Cancel quality upgrade timer — new activity resets the settle clock
    if (qualityUpgradeTimerRef.current) {
      clearTimeout(qualityUpgradeTimerRef.current);
      qualityUpgradeTimerRef.current = null;
    }

    // Cancel in-flight renders for pages no longer visible.
    // KEY for page-jump performance: jumping from page 2→30
    // no longer waits for pages 1–5 to finish rendering.
    const currentVisible = visiblePages;
    for (const [pageNum, task] of Object.entries(renderTasksRef.current)) {
      const p = Number(pageNum);
      if (!currentVisible.has(p)) {
        try { task?.cancel?.(); } catch (e) {}
        delete renderTasksRef.current[pageNum];
        delete pageRenderingRef.current[p];
      }
    }

    // Determine render scale:
    //   Quality pass: always full QUALITY_SCALE (1.5x) for sharp settled text
    //   Fast pass: zoom-aware — render fewer pixels when zoomed out
    //     zoom=1.0 → fast=1.0 (same as before)
    //     zoom=0.5 → fast=0.75 (renders 56% fewer pixels vs 1.0, still 1.5× display)
    //     zoom=0.3 → fast=0.5  (renders 75% fewer pixels vs 1.0, still 1.67× display)
    //     zoom=2.0 → fast=1.0  (capped — never exceeds FAST_SCALE)
    const zoomAwareFast = Math.max(0.5, Math.min(FAST_SCALE, zoomScaleRef.current * 1.5));
    const renderScale = forceQuality ? QUALITY_SCALE : zoomAwareFast;

    let pagesToRender;
    if (forceQuality) {
      // Quality pass: re-render visible pages that are still at fast quality
      pagesToRender = [...visiblePages].filter(p => {
        if (p < 1 || p > numPages) return false;
        if (pageRenderingRef.current[p]) return false;
        return (pageRenderQualityRef.current[p] || 0) < QUALITY_SCALE;
      });
    } else {
      // Fast pass: render pages not yet rendered at all
      pagesToRender = [...visiblePages].filter(p => {
        if (p < 1 || p > numPages) return false;
        if (renderedPagesRef.current.has(p)) return false;
        if (pageRenderingRef.current[p]) return false;
        return true;
      });
    }

    // Priority: render pages closest to viewport center first
    if (containerRef.current && pagesToRender.length > 1) {
      const layout = continuousLayoutRef.current;
      const isHoriz = layout.isHorizontal;
      const viewMid = isHoriz
        ? containerRef.current.scrollLeft + containerRef.current.clientWidth / 2
        : containerRef.current.scrollTop + containerRef.current.clientHeight / 2;
      pagesToRender.sort((a, b) => {
        const posA = layout.positions?.[a];
        const posB = layout.positions?.[b];
        if (!posA || !posB) return 0;
        const distA = Math.abs((isHoriz ? posA.left + posA.width / 2 : posA.top + posA.height / 2) - viewMid);
        const distB = Math.abs((isHoriz ? posB.left + posB.width / 2 : posB.top + posB.height / 2) - viewMid);
        return distA - distB;
      });
    }

    if (pagesToRender.length === 0) {
      // Nothing to render at this scale — but still schedule quality upgrade if fast pass
      if (!forceQuality) {
        if (qualityUpgradeTimerRef.current) clearTimeout(qualityUpgradeTimerRef.current);
        qualityUpgradeTimerRef.current = setTimeout(() => {
          qualityUpgradeTimerRef.current = null;
          if (!isZoomingRef.current && !isScrollingRef.current) renderAllPagesRef.current(true);
        }, 600);
      }
      return;
    }

    const newDims = {};
    // Fast pass at reduced scale → lighter per-canvas, can afford more concurrency.
    // Quality pass → heavier, keep concurrency lower to avoid GPU pressure.
    const MAX_CONCURRENT = forceQuality ? 2 : (zoomScaleRef.current < 0.6 ? 6 : 4);

    for (let i = 0; i < pagesToRender.length; i += MAX_CONCURRENT) {
      // Bail out if a newer renderAllPages call has started
      if (renderGenerationRef.current !== generation) return;

      const batch = pagesToRender.slice(i, i + MAX_CONCURRENT);
      const renderPromises = batch.map(async (pageNum) => {
        const canvas = continuousCanvasRefs.current[pageNum];
        if (canvas) {
          const pageDims = await renderSinglePage(pageNum, canvas, renderScale);
          if (pageDims) {
            newDims[pageNum] = pageDims;
            pageRenderQualityRef.current[pageNum] = renderScale;
          }
        }
      });
      await Promise.all(renderPromises);
    }

    // Bail out if stale — a newer call will handle the state update
    if (renderGenerationRef.current !== generation) return;

    // Quality upgrade: canvas was updated in-place, no React state change needed.
    // Calling setRenderedPages would create a new Set reference → trigger a full
    // re-render of ContinuousView (12k lines) for zero visual change.
    if (forceQuality) return;

    // ONE batched state update for all newly rendered pages (fast pass only)
    setRenderedPages(new Set(renderedPagesRef.current));

    // Update dimensions if we rendered something and not mid-zoom
    if (Object.keys(newDims).length > 0 && !isZoomingRef.current) {
      setAllPageDimensions(prev => {
        const updated = { ...prev };
        let changed = false;
        for (const [key, value] of Object.entries(newDims)) {
          if (!updated[key] || updated[key].width !== value.width || updated[key].height !== value.height) {
            updated[key] = value;
            changed = true;
          }
        }
        return changed ? updated : prev;
      });
    }

    // After fast pass completes, schedule quality upgrade
    if (!forceQuality) {
      // Schedule quality upgrade: after 600ms settle, re-render visible pages at 1.5x
      // (600ms gives enough time for scroll/zoom to settle without competing for main thread)
      if (qualityUpgradeTimerRef.current) {
        clearTimeout(qualityUpgradeTimerRef.current);
      }
      qualityUpgradeTimerRef.current = setTimeout(() => {
        qualityUpgradeTimerRef.current = null;
        if (!isZoomingRef.current && !isScrollingRef.current) {
          renderAllPagesRef.current(true); // forceQuality = true
        }
      }, 600);
    }
  }, [pdfDoc, numPages, viewMode, renderSinglePage, visiblePages]);

  // ─── renderPage (single view) ────────────────────────────────────────
  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) {
      return;
    }

    // Cancel any existing render
    if (singlePageRenderTaskRef.current) {
      try { singlePageRenderTaskRef.current.cancel(); } catch (e) {}
      singlePageRenderTaskRef.current = null;
      isRenderingRef.current = false;
    }

    if (isRenderingRef.current) {
      return;
    }

    isRenderingRef.current = true;
    setIsRendering(true);

    try {
      const page = await pdfDoc.getPage(currentPage);
      const baseScale = 2;
      const viewport = page.getViewport({ scale: baseScale, rotation: page.rotate + rotation });

      // Get unrotated dimensions for annotation coordinate system
      const unrotatedViewport = page.getViewport({ scale: 1, rotation: 0 });
      setPageBaseDimensions({ width: unrotatedViewport.width, height: unrotatedViewport.height });
      setPdfPageRotation(page.rotate || 0);

      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const displayWidth = viewport.width / baseScale;
      const displayHeight = viewport.height / baseScale;
      setCanvasSize({ width: displayWidth, height: displayHeight });

      const renderTask = page.render({
        canvasContext: context,
        viewport: viewport,
        annotationMode: 0
      });

      singlePageRenderTaskRef.current = renderTask;
      await renderTask.promise;
      singlePageRenderTaskRef.current = null;

    } catch (error) {
      if (error?.name !== 'RenderingCancelledException') {
        console.error('Render error:', error);
      }
    } finally {
      isRenderingRef.current = false;
      setIsRendering(false);
    }
  }, [pdfDoc, currentPage, rotation]);

  // ─── Ref sync effects ────────────────────────────────────────────────
  // Store renderPage in ref to avoid useEffect dependency issues
  const renderPageRef = useRef(renderPage);
  useEffect(() => {
    renderPageRef.current = renderPage;
  }, [renderPage]);

  // renderAllPagesRef — also consumed by useZoomPan for continuous commit re-render
  const renderAllPagesRef = useRef(renderAllPages);
  useEffect(() => {
    renderAllPagesRef.current = renderAllPages;
  }, [renderAllPages]);

  // ─── Clear rendered pages cache when rotation changes ─────────────────
  useEffect(() => {
    renderedPagesRef.current = new Set();
    pageRenderQualityRef.current = {};
    setRenderedPages(new Set());
  }, [rotation]);

  // ─── Pre-fetch all page dimensions when PDF loads ─────────────────────
  // Lightweight — no rendering, just getViewport() for each page
  useEffect(() => {
    if (!pdfDoc || numPages === 0) return;
    let cancelled = false;

    const prefetch = async () => {
      const dims = {};
      // Smaller batches (10) with main-thread yields between them
      // so initial page rendering isn't blocked by dimension prefetch.
      const batchSize = 10;
      for (let i = 1; i <= numPages; i += batchSize) {
        if (cancelled) return;
        const batch = [];
        for (let p = i; p < i + batchSize && p <= numPages; p++) {
          batch.push(p);
        }
        await Promise.all(batch.map(async (p) => {
          try {
            const page = await pdfDoc.getPage(p);
            const viewport = page.getViewport({ scale: 1, rotation: page.rotate + rotation });
            dims[p] = { width: viewport.width, height: viewport.height };
          } catch (e) {}
        }));
        // Yield to main thread between batches — lets rendering and UI stay responsive
        if (i + batchSize <= numPages) {
          await new Promise(r => setTimeout(r, 0));
        }
      }
      if (!cancelled) {
        precomputedPageDimsRef.current = dims;
        setAllPageDimensions(prev => {
          const merged = { ...prev };
          let changed = false;
          for (let p = 1; p <= numPages; p++) {
            if (!merged[p] && dims[p]) {
              merged[p] = dims[p];
              changed = true;
            }
          }
          return changed ? merged : prev;
        });
      }
    };

    prefetch();
    return () => { cancelled = true; };
  }, [pdfDoc, numPages, rotation]);

  // ─── Render trigger: single view ──────────────────────────────────────
  useEffect(() => {
    if (pdfDoc && viewMode === 'single') {
      renderPage();
    }
  }, [pdfDoc, currentPage, rotation, viewMode, renderPage]);

  // ─── Render trigger: continuous view ──────────────────────────────────
  useEffect(() => {
    if (pdfDoc && isContinuousView(viewMode) && numPages > 0) {
      renderAllPagesRef.current();
    }
  }, [pdfDoc, viewMode, numPages, rotation]);

  // ─── Render newly visible pages (pages that just came into view) ──────
  // Defers actual PDF.js work by 50ms so React can finish painting first.
  // This prevents janky frames where React commit + PDF.js render compete for the main thread.
  const renderDeferTimerRef = useRef(null);
  useEffect(() => {
    if (pdfDoc && isContinuousView(viewMode) && visiblePages.size > 0) {
      // Skip during zoom - don't trigger PDF.js re-renders mid-zoom
      if (isZoomingRef.current) return;

      // Check if any NEW pages became visible that haven't been rendered
      let hasNewPages = false;
      for (const p of visiblePages) {
        if (!prevVisiblePagesRef.current.has(p) && !renderedPagesRef.current.has(p)) {
          hasNewPages = true;
          break;
        }
      }
      prevVisiblePagesRef.current = new Set(visiblePages);

      if (hasNewPages) {
        // Defer PDF.js work — let React finish painting this frame first
        if (renderDeferTimerRef.current) clearTimeout(renderDeferTimerRef.current);
        renderDeferTimerRef.current = setTimeout(() => {
          renderDeferTimerRef.current = null;
          if (!isZoomingRef.current && !isScrollingRef.current) {
            renderAllPagesRef.current();
          }
        }, 50);
      }
    }
    return () => {
      if (renderDeferTimerRef.current) {
        clearTimeout(renderDeferTimerRef.current);
        renderDeferTimerRef.current = null;
      }
    };
  }, [pdfDoc, viewMode, visiblePages]);

  // ─── Cleanup unmounted pages ──────────────────────────────────────────
  // Removes tracking for pages no longer in mount range so they re-render when remounted.
  // IMPORTANT: Only updates REFS — no setRenderedPages call. The fast pass will call
  // setRenderedPages after it finishes rendering, which handles the "Loading page..." indicator.
  // This eliminates an entire React render cycle that was cascading on every scroll settle.
  useEffect(() => {
    if (!isContinuousView(viewMode) || numPages === 0) return;
    if (isZoomingRef.current) return;

    // Compute mounted range without array spread — O(n) loop instead of O(n log n) spread+min+max
    let visMin = Infinity, visMax = -Infinity;
    for (const p of visiblePages) {
      if (p < visMin) visMin = p;
      if (p > visMax) visMax = p;
    }
    if (visMin === Infinity) return;

    const mountedMin = Math.max(1, visMin - CONTINUOUS_VIEW_BUFFER);
    const mountedMax = Math.min(numPages, visMax + CONTINUOUS_VIEW_BUFFER);

    // Find pages that are in renderedPages but no longer mounted
    for (const p of renderedPagesRef.current) {
      if (p < mountedMin || p > mountedMax) {
        renderedPagesRef.current.delete(p);
        delete pageRenderQualityRef.current[p];
        delete continuousCanvasRefs.current[p];
      }
    }

    // No setRenderedPages here — the fast pass handles state sync after rendering.
    // This avoids a full React re-render cycle just for bookkeeping.
  }, [viewMode, numPages, visiblePages]);

  // ─── Render trigger: sideBySide view ──────────────────────────────────
  // Now handled by continuous view triggers above since sideBySide uses continuous layout

  // ─── Return ───────────────────────────────────────────────────────────
  return {
    // State
    isRendering,
    canvasSize,
    pdfPageRotation,
    pageBaseDimensions,
    allPageDimensions,
    renderedPages,

    // Refs (needed by parent JSX and other hooks)
    continuousCanvasRefs,
    renderedPagesRef,
    renderAllPagesRef,
    precomputedPageDimsRef,
    zoomScaleRef, // Parent syncs: zoomScaleRef.current = scaleRef.current

    // Functions
    renderPage,
    renderAllPages,
    resetRenderedPages,
  };
}
