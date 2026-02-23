import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { isContinuousView } from './useContinuousLayout';

/**
 * useZoomPan – Zoom & scroll engine for PDFViewerArea.
 *
 * Owns:
 *   - scale / zoomInput / isZooming state
 *   - All zoom-related refs (scaleRef, isZoomingRef, settle timeout, CSS-transform refs …)
 *   - Browser-zoom prevention (Ctrl+scroll / Ctrl±)
 *   - Wheel-zoom handler (CSS-transform approach for both single & continuous view)
 *   - useEffect[scale]  – zoom-settle debounce & continuous-commit re-render
 *   - useLayoutEffect   – pending scroll restore (single view toolbar zoom)
 *   - useLayoutEffect   – single-view CSS-transform commit
 *   - useLayoutEffect   – continuous-view CSS-transform commit
 *   - zoomWithScrollAdjust (toolbar / keyboard zoom helper)
 *   - applyZoomInput       (text input → zoom)
 *
 * Does NOT own:
 *   - panMode / isPanning / panStart   (intertwined with mouse-event routing)
 *   - zoomMode toggle                  (toolbar / mode state)
 *   - isDrawingZoomBox / zoomBox       (mouse-event routing)
 *   - Keyboard shortcuts               (mixed concern – parent handles)
 *
 * @param {Object}  params
 * @param {Object}  params.containerRef          – ref to the scrollable container div
 * @param {string}  params.viewMode              – 'single' | 'continuous' | 'sideBySide'
 * @param {Object}  params.canvasSize            – { width, height } in PDF points
 * @param {boolean} params.zoomMode              – whether zoom-click mode is active
 * @param {Object}  params.continuousLayoutRef   – ref whose .current has { totalHeight, … }
 * @param {Object}  params.visiblePagesRef       – ref to Set of visible page numbers
 * @param {Object}  params.renderedPagesRef      – ref to Set of rendered page numbers
 * @param {Object}  params.renderAllPagesRef     – ref to renderAllPages function
 * @param {Object}  params.isZoomingRef          – shared ref for zoom state (written by this hook, read by usePdfRenderer)
 */
export default function useZoomPan({
  containerRef,
  viewMode,
  canvasSize,
  zoomMode,
  continuousLayoutRef,
  visiblePagesRef,
  renderedPagesRef,
  renderAllPagesRef,
  isZoomingRef,
  zoomSettingsRef, // Optional: ref to zoom settings from ZoomSettingsDialog
}) {
  // ─── State ───────────────────────────────────────────────────────────
  const [scale, setScale] = useState(1);
  const [zoomInput, setZoomInput] = useState('100');
  const [isZooming, setIsZooming] = useState(false);

  // ─── Refs ────────────────────────────────────────────────────────────
  const scaleRef = useRef(scale);
  // isZoomingRef is passed in as a shared ref (also used by usePdfRenderer)
  const zoomSettleTimeoutRef = useRef(null);
  const initialScaleSetRef = useRef(false);
  const pendingScrollRef = useRef(null);            // For zoom-to-cursor scroll (single view toolbar zoom)

  // Continuous-view CSS-transform zoom refs
  const continuousWrapperRef = useRef(null);         // Ref for the continuous wrapper div
  const zoomInnerRef = useRef(null);                 // Ref for zoom-transform-inner div
  const zoomBaseScaleRef = useRef(1);                // Committed scale at start of CSS-transform zoom
  const isCommittingZoomRef = useRef(false);          // Flag to reset DOM overrides on commit
  const isContinuousZoomCommitRef = useRef(false);    // Distinguishes continuous commit from other scale changes
  const zoomScrollRef = useRef({ top: 0, left: 0 }); // Float scroll position during continuous zoom (both axes)
  const pendingContinuousScrollRef = useRef({ top: null, left: null });

  // Single-view CSS-transform zoom refs (Bluebeam-style: zero React re-renders during zoom gesture)
  const singleScrollContentRef = useRef(null);       // scroll-content div
  const singleCanvasContainerRef = useRef(null);     // canvas-container div
  const singleZoomScrollTopRef = useRef(0);          // Float scroll position (immune to DOM integer rounding)
  const singleZoomScrollLeftRef = useRef(0);
  const isSingleZoomCommitRef = useRef(false);        // Flag for single-view zoom commit
  const pendingSingleZoomScrollRef = useRef(null);    // {top, left} for useLayoutEffect to apply on commit

  // ─── Minimum zoom for continuous views ─────────────────────────────
  // Caps zoom-out so ~3 pages fit in the viewport (matches Bluebeam behavior).
  // Single view returns 0.1 (no cap) — completely unaffected.
  const getMinScale = useCallback(() => {
    if (!isContinuousView(viewMode)) return 0.1;
    const container = containerRef.current;
    const layout = continuousLayoutRef.current;
    if (!container || !layout?.positions || layout.positions.length <= 1) return 0.1;

    let maxBaseDim = 0;
    for (let p = 1; p < layout.positions.length; p++) {
      const pos = layout.positions[p];
      if (!pos) continue;
      const dim = layout.isHorizontal ? pos.baseWidth : pos.baseHeight;
      if (dim > maxBaseDim) maxBaseDim = dim;
    }
    if (maxBaseDim === 0) return 0.1;

    const viewportDim = layout.isHorizontal ? container.clientWidth : container.clientHeight;
    return Math.max(0.1, viewportDim / (3 * maxBaseDim));
  }, [viewMode]);

  // ─── Browser zoom prevention ─────────────────────────────────────────
  useEffect(() => {
    const preventZoom = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
        e.preventDefault();
      }
    };
    const preventWheelZoom = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', preventZoom);
    document.addEventListener('wheel', preventWheelZoom, { passive: false });
    return () => {
      document.removeEventListener('keydown', preventZoom);
      document.removeEventListener('wheel', preventWheelZoom);
    };
  }, []);

  // ─── useEffect[scale] – zoom settle debounce ────────────────────────
  useEffect(() => {
    scaleRef.current = scale;

    // Don't set isZooming on initial scale (when PDF first loads)
    if (!initialScaleSetRef.current) {
      initialScaleSetRef.current = true;
      return;
    }

    // For continuous zoom commits: all state changes (scale, isZooming, zoomInput)
    // were batched in the commit setTimeout.
    // DON'T clear renderedPages — that causes "Loading Page..." flash.
    // Canvas content is already visible (CSS stretches it). Re-render in background
    // for crisp quality at the new scale without any visual disruption.
    if (isContinuousZoomCommitRef.current) {
      isContinuousZoomCommitRef.current = false;
      // Re-render visible pages in-place at new scale (canvas overwrites, no flash)
      requestAnimationFrame(() => {
        // Allow re-rendering by removing visible pages from the "already rendered" set
        // but DON'T update the state — loading indicators stay hidden
        const visible = [...(visiblePagesRef.current || [])];
        visible.forEach(p => renderedPagesRef.current.delete(p));
        renderAllPagesRef.current();
      });
      return;
    }

    // For single-view CSS-transform zoom commits: skip the isZooming debounce.
    // DOM overrides are cleared in useLayoutEffect; scroll is restored there too.
    if (isSingleZoomCommitRef.current) {
      isSingleZoomCommitRef.current = false;
      return;
    }

    // For single view / toolbar zoom: gate canvas re-renders during rapid changes
    setIsZooming(true);
    isZoomingRef.current = true;
    setZoomInput(Math.round(scale * 100).toString());

    // Clear any pending settle timeout
    if (zoomSettleTimeoutRef.current) {
      clearTimeout(zoomSettleTimeoutRef.current);
    }

    // After zoom settles (150ms of no changes), re-enable canvas rendering
    zoomSettleTimeoutRef.current = setTimeout(() => {
      setIsZooming(false);
      isZoomingRef.current = false;
      containerRef.current?.dispatchEvent(new Event('scroll'));
    }, 150);

    return () => {
      if (zoomSettleTimeoutRef.current) {
        clearTimeout(zoomSettleTimeoutRef.current);
      }
    };
  }, [scale]);

  // ─── useLayoutEffect – pending scroll restore (single view toolbar zoom) ──
  useLayoutEffect(() => {
    if (pendingScrollRef.current && containerRef.current) {
      const container = containerRef.current;
      const { pdfX, pdfY, mouseX, mouseY } = pendingScrollRef.current;

      // Get container dimensions
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      // Current scaled canvas size
      const currentScaledWidth = canvasSize.width * scale;
      const currentScaledHeight = canvasSize.height * scale;

      // Scroll content size (matches JSX: width/height with minWidth/minHeight: 100%)
      const scrollContentWidth = Math.max(containerWidth, currentScaledWidth + 80);
      const scrollContentHeight = Math.max(containerHeight, currentScaledHeight + 80);

      // Canvas is centered in scroll content via left:50% + translate(-50%)
      const canvasLeft = (scrollContentWidth - currentScaledWidth) / 2;
      const canvasTop = (scrollContentHeight - currentScaledHeight) / 2;

      // Convert PDF point to canvas coordinates at current scale
      const canvasX = pdfX * scale;
      const canvasY = pdfY * scale;

      // Calculate scroll to put this canvas point under the cursor
      let newScrollLeft = canvasLeft + canvasX - mouseX;
      let newScrollTop = canvasTop + canvasY - mouseY;

      // Clamp to valid range
      const maxScrollLeft = Math.max(0, scrollContentWidth - containerWidth);
      const maxScrollTop = Math.max(0, scrollContentHeight - containerHeight);
      newScrollLeft = Math.max(0, Math.min(maxScrollLeft, newScrollLeft));
      newScrollTop = Math.max(0, Math.min(maxScrollTop, newScrollTop));

      container.scrollLeft = newScrollLeft;
      container.scrollTop = newScrollTop;
      pendingScrollRef.current = null;
    }
  }, [scale, canvasSize.width, canvasSize.height]);

  // ─── useLayoutEffect – single-view CSS-transform zoom commit ──────────
  // React reconciliation only updates properties that changed between old/new VDOM.
  // Since transform: 'translate(-50%, -50%)' is the same in both renders, React won't
  // reset our scale() override — we must do it manually.
  useLayoutEffect(() => {
    if (!pendingSingleZoomScrollRef.current) return;
    const container = containerRef.current;
    const canvasContainer = singleCanvasContainerRef.current;
    const scrollContent = singleScrollContentRef.current;
    if (!container) {
      pendingSingleZoomScrollRef.current = null;
      return;
    }

    // Reset CSS-transform override (React won't touch this since its VDOM value didn't change)
    if (canvasContainer) {
      canvasContainer.style.transform = 'translate(-50%, -50%)';
    }
    // Note: scroll-content width/height does NOT need clearing here.
    // React already updated it during reconciliation (VDOM width changed: old scale → new scale).
    // Clearing it would destroy React's inline style and cause layout collapse → jump.

    // Restore scroll position (must be done after React re-renders the new layout)
    const { top, left } = pendingSingleZoomScrollRef.current;
    if (top !== null) container.scrollTop = top;
    if (left !== null) container.scrollLeft = left;
    pendingSingleZoomScrollRef.current = null;
    // Clear isZoomingRef AFTER scroll is restored — prevents new gesture from
    // seeding with stale DOM state (CSS transform still applied, wrong scroll)
    isZoomingRef.current = false;
  }, [scale, canvasSize.width, canvasSize.height]);

  // ─── useLayoutEffect – continuous-view CSS-transform zoom commit ──────
  // Runs AFTER React updates DOM but BEFORE browser paints — seamless transition.
  // React has already set wrapper height/minWidth to correct values for new scale.
  // We just need to clear the CSS transform override (React doesn't manage it)
  // and restore scroll position.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const wrapper = continuousWrapperRef.current;

    if (isCommittingZoomRef.current) {
      const inner = zoomInnerRef.current;
      if (inner) {
        inner.style.transform = '';
        // Reset frozen dimensions — must match React's intended values per orientation.
        // For vertical: width is '100%' (React won't clear frozen px value), height is totalHeight (px, React updates it).
        // For horizontal: width is totalWidth (px, React updates it), height is '100%' (React won't clear frozen px value).
        const layout = continuousLayoutRef.current;
        if (layout.isHorizontal) {
          inner.style.width = `${layout.totalWidth}px`;
          inner.style.height = '100%';
        } else {
          inner.style.width = '100%';
        }
      }
      // Clear ALL gesture DOM overrides so React's inline styles take full effect.
      // Must force-write React's intended values because React's VDOM diff may skip
      // re-writing them if it thinks they haven't changed since last render.
      if (wrapper) {
        const layout = continuousLayoutRef.current;
        wrapper.style.width = '';
        wrapper.style.height = '';
        // Force React's intended dimensions — differs by orientation
        if (layout.isHorizontal) {
          wrapper.style.width = `${layout.totalWidth}px`;
          wrapper.style.height = `max(100%, ${layout.maxPageHeight + 80 * scaleRef.current}px)`;
        } else {
          wrapper.style.width = `max(100%, ${layout.maxPageWidth + 80 * scaleRef.current}px)`;
          wrapper.style.height = `${layout.totalHeight}px`;
        }
      }
      isCommittingZoomRef.current = false;
    }

    // Restore scroll position
    const pending = pendingContinuousScrollRef.current;
    if (pending.top !== null) {
      const ratio = pending.zoomRatio || 1;

      if (pending.isHorizontal) {
        // HORIZONTAL: pages use absolute left positions, centered vertically via calc(50%-...).
        // Centering correction applies to scrollTop (vertical axis shifts at commit).
        const H_commit = wrapper ? wrapper.offsetHeight : 0;
        const frozenH = pending.frozenInnerHeight || H_commit;
        container.scrollTop = Math.max(0, (pending.top || 0) + (H_commit - ratio * frozenH) / 2);
        container.scrollLeft = Math.max(0, pending.left || 0);
      } else {
        // VERTICAL: pages use absolute top positions, centered horizontally via calc(50%-...).
        // Centering correction applies to scrollLeft (horizontal axis shifts at commit).
        container.scrollTop = Math.max(0, pending.top);
        const W_commit = wrapper ? wrapper.offsetWidth : 0;
        const frozenW = pending.frozenInnerWidth || W_commit;
        const rawLeft = pending.left || 0;
        container.scrollLeft = Math.max(0, rawLeft + (W_commit - ratio * frozenW) / 2);
      }

      pendingContinuousScrollRef.current = { top: null, left: null };
      // Clear isZoomingRef AFTER scroll is restored — prevents scroll handler
      // from firing with stale position and causing page remount flash
      isZoomingRef.current = false;
    }
  }, [scale]);

  // ─── zoomWithScrollAdjust ─────────────────────────────────────────────
  // Toolbar / keyboard zoom helper — adjusts scroll to keep viewport center stable.
  const zoomWithScrollAdjust = useCallback((newScale) => {
    // Clamp to valid range (continuous views have a dynamic minimum)
    newScale = Math.max(getMinScale(), Math.min(20, newScale));

    if (isContinuousView(viewMode) && containerRef.current) {
      const container = containerRef.current;
      const oldScale = scaleRef.current;

      // If a wheel zoom sequence was active, clear its DOM overrides first
      if (isZoomingRef.current && continuousWrapperRef.current) {
        const inner = zoomInnerRef.current;
        const wrapper = continuousWrapperRef.current;
        if (inner) {
          inner.style.transform = '';
          // Reset frozen dimensions — orientation-aware to avoid collapsing layout
          const layout = continuousLayoutRef.current;
          if (layout.isHorizontal) {
            inner.style.width = `${layout.totalWidth}px`;
            inner.style.height = '100%';
          } else {
            inner.style.width = '100%';
          }
        }
        if (wrapper) {
          wrapper.style.width = '';
          wrapper.style.height = '';
        }
        // Cancel any pending wheel commit
        if (zoomSettleTimeoutRef.current) {
          clearTimeout(zoomSettleTimeoutRef.current);
          zoomSettleTimeoutRef.current = null;
        }
      }

      // Use pending scroll if available (in case called during rapid zoom)
      const scrollTop = pendingContinuousScrollRef.current.top !== null
        ? pendingContinuousScrollRef.current.top
        : container.scrollTop;
      const scrollLeft = pendingContinuousScrollRef.current.left !== null
        ? pendingContinuousScrollRef.current.left
        : container.scrollLeft;
      const viewportHeight = container.clientHeight;
      const viewportWidth = container.clientWidth;
      const scaleRatio = newScale / oldScale;

      // Mark zooming to skip expensive canvas re-renders
      isZoomingRef.current = true;

      // Eagerly update scaleRef
      scaleRef.current = newScale;

      // Scroll adjustment: keep viewport center at the same content position
      const newScrollTop = (scrollTop + viewportHeight / 2) * scaleRatio - viewportHeight / 2;
      const newScrollLeft = (scrollLeft + viewportWidth / 2) * scaleRatio - viewportWidth / 2;

      // Store for useLayoutEffect to apply BEFORE paint (no flicker)
      pendingContinuousScrollRef.current = {
        top: Math.max(0, newScrollTop),
        left: Math.max(0, newScrollLeft)
      };

      setScale(newScale);
    } else {
      // Single view: clear any in-progress CSS-transform zoom
      if (isZoomingRef.current && singleCanvasContainerRef.current) {
        const canvasContainer = singleCanvasContainerRef.current;
        const scrollContent = singleScrollContentRef.current;
        if (canvasContainer) canvasContainer.style.transform = 'translate(-50%, -50%)';
        if (scrollContent) { scrollContent.style.width = ''; scrollContent.style.height = ''; }
        if (zoomSettleTimeoutRef.current) {
          clearTimeout(zoomSettleTimeoutRef.current);
          zoomSettleTimeoutRef.current = null;
        }
        isZoomingRef.current = false;
      }

      // For single view toolbar zoom: use pendingScrollRef to center on viewport center
      if (containerRef.current && canvasSize.width > 0) {
        const container = containerRef.current;
        const oldScale = scaleRef.current;
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        const oldScaledW = canvasSize.width * oldScale;
        const oldScaledH = canvasSize.height * oldScale;
        const scrollContentW = Math.max(containerWidth, oldScaledW + 80);
        const scrollContentH = Math.max(containerHeight, oldScaledH + 80);
        const canvasLeft = (scrollContentW - oldScaledW) / 2;
        const canvasTop = (scrollContentH - oldScaledH) / 2;
        const centerX = container.scrollLeft + containerWidth / 2;
        const centerY = container.scrollTop + containerHeight / 2;
        const pdfX = (centerX - canvasLeft) / oldScale;
        const pdfY = (centerY - canvasTop) / oldScale;
        pendingScrollRef.current = { pdfX, pdfY, mouseX: containerWidth / 2, mouseY: containerHeight / 2 };
      }

      setScale(newScale);
    }
  }, [viewMode, canvasSize.width, canvasSize.height, getMinScale]);

  // ─── Wheel zoom – Bluebeam/Adobe-style CSS-transform ──────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e) => {
      if (zoomMode || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();

        // Read zoom settings (with safe fallbacks)
        const settings = zoomSettingsRef?.current || {};
        const sensitivity = settings.zoomSensitivity ?? 1;
        const scrollDir = settings.scrollDirection || 'natural';
        const zoomTarget = settings.zoomTarget || 'cursor';

        // DeltaY-proportional zoom: trackpads send small deltaY (~3), mice send large (~100).
        // Scale factor by deltaY magnitude for smooth feel on both input devices.
        const absDelta = Math.min(Math.abs(e.deltaY), 200); // cap extreme values
        const factor = Math.pow(1.004, absDelta * sensitivity); // apply sensitivity
        const oldScale = scaleRef.current;

        // Apply scroll direction setting
        let direction = e.deltaY > 0 ? -1 : 1; // -1 = zoom out, 1 = zoom in
        if (scrollDir === 'inverted') direction *= -1;

        const newScale = direction > 0
          ? Math.min(20, oldScale * factor)    // Zoom in to 2000%
          : Math.max(getMinScale(), oldScale / factor);  // Zoom out: capped for continuous views

        if (newScale === oldScale) return;

        // Get mouse position relative to container (or use center if zoomTarget is 'center')
        const rect = container.getBoundingClientRect();
        const mouseX = zoomTarget === 'center'
          ? rect.width / 2
          : e.clientX - rect.left;
        const mouseY = zoomTarget === 'center'
          ? rect.height / 2
          : e.clientY - rect.top;

        // For continuous view: CSS-transform zoom with transformOrigin '0 0'.
        // Zero React re-renders during gesture — just CSS transform + DOM scroll.
        //
        // KEY INSIGHT: Virtual scroll can go negative (zoom-out, content smaller than viewport).
        // DOM scrollLeft can't be negative, so we use CSS translate to compensate:
        //   translate(tx, ty) scale(ratio)  where tx/ty absorb negative scroll values.
        // This handles both zoom-in (positive scroll) and zoom-out (translate centering).
        //
        // Inner width is frozen at gesture start so left:50% page positions don't shift
        // when wrapper.minWidth changes for scroll area sizing.
        if (isContinuousView(viewMode)) {
          const scaleRatio = newScale / oldScale;
          const wrapper = continuousWrapperRef.current;
          const inner = zoomInnerRef.current;

          // First wheel tick — capture committed state and freeze inner dimensions
          if (!isZoomingRef.current) {
            zoomBaseScaleRef.current = oldScale;
            isZoomingRef.current = true;
            // Seed virtual scroll from DOM (can accumulate to negative values)
            zoomScrollRef.current = { 
              top: container.scrollTop, 
              left: container.scrollLeft,
              frozenInnerWidth: inner ? inner.offsetWidth : 0,
              frozenInnerHeight: inner ? inner.offsetHeight : 0
            };
            // Freeze inner dimensions to prevent layout shifts during CSS-transform zoom.
            // Width: always frozen (preserves left:50% page centering for vertical,
            //   preserves totalWidth for horizontal).
            // Height: frozen for horizontal mode only (it's '100%' so follows wrapper;
            //   without freezing, pages using top:calc(50%-...) shift vertically).
            //   For vertical mode, height is a pixel value from React so doesn't shift.
            if (inner) {
              inner.style.width = `${inner.offsetWidth}px`;
              const committedLayout = continuousLayoutRef.current;
              if (committedLayout.isHorizontal) {
                inner.style.height = `${inner.offsetHeight}px`;
              }
            }
          }

          // Update scaleRef for chaining (NOT React state)
          scaleRef.current = newScale;

          // Compute virtual scroll (CAN be negative — that's intentional)
          const rawTop = (zoomScrollRef.current.top + mouseY) * scaleRatio - mouseY;
          const rawLeft = (zoomScrollRef.current.left + mouseX) * scaleRatio - mouseX;
          zoomScrollRef.current.top = rawTop;
          zoomScrollRef.current.left = rawLeft;

          // Split virtual scroll into DOM scroll (>= 0) and translate offset (compensates negative)
          const tx = Math.max(0, -rawLeft);
          const ty = Math.max(0, -rawTop);
          const domScrollLeft = Math.max(0, rawLeft);
          const domScrollTop = Math.max(0, rawTop);

          if (wrapper && inner) {
            const ratio = newScale / zoomBaseScaleRef.current;
            const committedLayout = continuousLayoutRef.current;
            const frozenW = zoomScrollRef.current.frozenInnerWidth;

            let wrapperWidth, wrapperHeight;

            if (committedLayout.isHorizontal) {
              // Horizontal: totalWidth is the primary overflow axis
              wrapperWidth = Math.max(
                tx + committedLayout.totalWidth * ratio,
                container.clientWidth
              );
              const reactCommitHeight = Math.max(
                container.clientHeight,
                committedLayout.maxPageHeight * ratio + 80 * scaleRef.current
              );
              const frozenH = zoomScrollRef.current.frozenInnerHeight || container.clientHeight;
              const visualExtentY = ty + frozenH * ratio;
              wrapperHeight = Math.max(reactCommitHeight, visualExtentY);
            } else {
              // Vertical: totalHeight is the primary overflow axis
              const reactCommitWidth = Math.max(
                container.clientWidth,
                committedLayout.maxPageWidth * ratio + 80 * scaleRef.current
              );
              const visualExtent = tx + frozenW * ratio;
              wrapperWidth = Math.max(reactCommitWidth, visualExtent);
              wrapperHeight = Math.max(
                ty + committedLayout.totalHeight * ratio,
                container.clientHeight
              );
            }

            wrapper.style.width = `${wrapperWidth}px`;
            wrapper.style.height = `${wrapperHeight}px`;
            // CSS transform: translate absorbs negative scroll, scale provides visual zoom
            inner.style.transform = `translate(${tx}px, ${ty}px) scale(${ratio})`;
          }

          // Set DOM scroll AFTER wrapper dimensions (avoid clamping on zoom-in)
          container.scrollTop = domScrollTop;
          container.scrollLeft = domScrollLeft;

          // Debounce: commit after 150ms of no wheel events
          if (zoomSettleTimeoutRef.current) clearTimeout(zoomSettleTimeoutRef.current);
          zoomSettleTimeoutRef.current = setTimeout(() => {
            const finalScale = scaleRef.current;
            const finalRatio = finalScale / zoomBaseScaleRef.current;
            isCommittingZoomRef.current = true;
            isContinuousZoomCommitRef.current = true;
            // Save raw virtual scroll + gesture geometry for EXACT scroll restoration.
            //
            // KEY MATH: During gesture, page center = tx + ratio*frozenW/2 (in wrapper coords).
            // After commit, page center = W_commit/2. For the viewport position to stay the
            // same: scrollLeft_new = rawLeft + (W_commit - ratio*frozenW) / 2.
            // This is derived from: pageCenterCommit - scrollNew = pageCenterGesture - domScrollLeft
            // and the identity: tx - domScrollLeft = -rawLeft (always true).
            pendingContinuousScrollRef.current = {
              top: zoomScrollRef.current.top,
              left: zoomScrollRef.current.left,
              frozenInnerWidth: zoomScrollRef.current.frozenInnerWidth,
              frozenInnerHeight: zoomScrollRef.current.frozenInnerHeight,
              zoomRatio: finalRatio,
              isHorizontal: continuousLayoutRef.current.isHorizontal
            };
            // React 18 batches into ONE render
            setScale(finalScale);
            setIsZooming(false);
            // NOTE: do NOT clear isZoomingRef here — layout effect clears it AFTER
            // scroll is restored, preventing scroll handler from firing with stale positions.
            setZoomInput(Math.round(finalScale * 100).toString());
          }, 150);

          return;
        }

        // Single page view - CSS-transform zoom (Bluebeam/Adobe-style)
        // Zero React re-renders during zoom — just CSS transform + direct scroll.
        // After 150ms of no wheel events, commit the scale in one clean re-render.
        {
          // First wheel event of a zoom sequence — capture committed state
          if (!isZoomingRef.current) {
            zoomBaseScaleRef.current = oldScale;
            isZoomingRef.current = true;
            // Seed float refs from DOM — only time we read from DOM during zoom
            singleZoomScrollTopRef.current = container.scrollTop;
            singleZoomScrollLeftRef.current = container.scrollLeft;
          }

          // --- Compute the PDF point under the cursor (accounts for centered layout) ---
          const containerWidth = container.clientWidth;
          const containerHeight = container.clientHeight;
          const oldVisualW = canvasSize.width * oldScale;
          const oldVisualH = canvasSize.height * oldScale;
          const oldScrollContentW = Math.max(containerWidth, oldVisualW + 80);
          const oldScrollContentH = Math.max(containerHeight, oldVisualH + 80);
          const oldCanvasLeft = (oldScrollContentW - oldVisualW) / 2;
          const oldCanvasTop = (oldScrollContentH - oldVisualH) / 2;

          const pdfX = (singleZoomScrollLeftRef.current + mouseX - oldCanvasLeft) / oldScale;
          const pdfY = (singleZoomScrollTopRef.current + mouseY - oldCanvasTop) / oldScale;

          // Update scaleRef for chaining rapid events (NOT React state)
          scaleRef.current = newScale;

          // --- Compute new scroll to keep that PDF point under the cursor ---
          const newVisualW = canvasSize.width * newScale;
          const newVisualH = canvasSize.height * newScale;
          const newScrollContentW = Math.max(containerWidth, newVisualW + 80);
          const newScrollContentH = Math.max(containerHeight, newVisualH + 80);
          const newCanvasLeft = (newScrollContentW - newVisualW) / 2;
          const newCanvasTop = (newScrollContentH - newVisualH) / 2;

          const newScrollLeft = Math.max(0, newCanvasLeft + pdfX * newScale - mouseX);
          const newScrollTop = Math.max(0, newCanvasTop + pdfY * newScale - mouseY);
          singleZoomScrollLeftRef.current = newScrollLeft;
          singleZoomScrollTopRef.current = newScrollTop;

          const scrollContent = singleScrollContentRef.current;
          const canvasContainer = singleCanvasContainerRef.current;

          if (scrollContent && canvasContainer) {
            const ratio = newScale / zoomBaseScaleRef.current;

            // Set scroll-content size FIRST (must be before scrollTop to avoid clamping on zoom-in)
            scrollContent.style.width = `${newScrollContentW}px`;
            scrollContent.style.height = `${newScrollContentH}px`;

            // Scale canvas-container via CSS transform (keeps centering via translate)
            canvasContainer.style.transform = `translate(-50%, -50%) scale(${ratio})`;
          }

          // Apply scroll from float refs to DOM
          container.scrollTop = newScrollTop;
          container.scrollLeft = newScrollLeft;

          // Debounce: commit after 150ms of no wheel events
          if (zoomSettleTimeoutRef.current) clearTimeout(zoomSettleTimeoutRef.current);
          zoomSettleTimeoutRef.current = setTimeout(() => {
            const finalScale = scaleRef.current;
            isSingleZoomCommitRef.current = true;
            // NOTE: do NOT clear isZoomingRef here — useLayoutEffect clears it AFTER
            // scroll is restored, preventing new gesture from seeding with stale DOM state.
            // Store scroll for useLayoutEffect to restore after React re-render
            pendingSingleZoomScrollRef.current = {
              top: singleZoomScrollTopRef.current,
              left: singleZoomScrollLeftRef.current
            };
            // React 18 batches all these into ONE render
            setScale(finalScale);
            setIsZooming(false);
            setZoomInput(Math.round(finalScale * 100).toString());
          }, 150);
        }
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [zoomMode, canvasSize.width, canvasSize.height, viewMode]);

  // ─── applyZoomInput ───────────────────────────────────────────────────
  const applyZoomInput = useCallback(() => {
    const val = parseInt(zoomInput);
    if (!isNaN(val) && val >= 10 && val <= 2000) {
      zoomWithScrollAdjust(val / 100);
    } else {
      setZoomInput(Math.round(scale * 100).toString());
    }
  }, [zoomInput, scale, zoomWithScrollAdjust]);

  // ─── Return ───────────────────────────────────────────────────────────
  return {
    // State
    scale,
    setScale,
    zoomInput,
    setZoomInput,
    isZooming,

    // Refs (needed by parent for mouse handlers, JSX, and other subsystems)
    scaleRef,
    pendingScrollRef,

    // DOM refs (attach to JSX elements)
    continuousWrapperRef,
    zoomInnerRef,
    singleScrollContentRef,
    singleCanvasContainerRef,

    // Functions
    zoomWithScrollAdjust,
    applyZoomInput,
  };
}
