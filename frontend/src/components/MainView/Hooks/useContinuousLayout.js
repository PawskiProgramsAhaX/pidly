import { useEffect, useMemo, useCallback, useRef } from 'react';

/**
 * Helper: is this a continuous view mode (vertical or horizontal)?
 */
export function isContinuousView(viewMode) {
  return viewMode === 'continuous' || viewMode === 'continuousHorizontal' || viewMode === 'sideBySide';
}

/**
 * useContinuousLayout – continuous view layout engine for PDFViewerArea.
 *
 * Supports both vertical ('continuous') and horizontal ('continuousHorizontal') layout.
 * The layout positions array always contains { top, left, width, height } per page.
 * For vertical: pages stack top-to-bottom, centered horizontally.
 * For horizontal: pages stack left-to-right, centered vertically.
 */
export default function useContinuousLayout({
  viewMode,
  numPages,
  scale,
  setCurrentPage,
  currentPageRef,
  canvasSize,
  allPageDimensions,
  precomputedPageDimsRef,
  containerRef,
  continuousLayoutRef,
  isZoomingRef,
  setVisiblePages,
  visiblePagesRef,
  isPanningRef,
  isScrollingRef,
}) {
  const isHorizontal = viewMode === 'continuousHorizontal' || viewMode === 'sideBySide';
  const isContinuous = isContinuousView(viewMode);

  // ─── Layout computation ──────────────────────────────────────────────
  const continuousLayout = useMemo(() => {
    if (!isContinuousView(viewMode) || numPages === 0) {
      return { positions: [], totalHeight: 0, totalWidth: 0, gap: 10 * scale, padding: 20 * scale, maxPageWidth: 800, maxPageHeight: 1000, isHorizontal: false };
    }

    const horizontal = viewMode === 'continuousHorizontal' || viewMode === 'sideBySide';
    const gap = 10 * scale;
    const padding = 20 * scale;
    const defaultDims = { width: canvasSize.width || 800, height: canvasSize.height || 1000 };
    const positions = [null]; // 1-indexed, positions[0] unused
    let maxPageWidth = 0;
    let maxPageHeight = 0;

    if (viewMode === 'sideBySide') {
      // Side-by-side: all pages in a single horizontal row, scrollable left-to-right
      let x = padding;
      for (let p = 1; p <= numPages; p++) {
        const dims = allPageDimensions[p] || precomputedPageDimsRef.current[p] || defaultDims;
        const pageWidth = dims.width * scale;
        const pageHeight = dims.height * scale;
        if (pageWidth > maxPageWidth) maxPageWidth = pageWidth;
        if (pageHeight > maxPageHeight) maxPageHeight = pageHeight;
        positions.push({
          left: x, top: 0, width: pageWidth, height: pageHeight,
          baseWidth: dims.width, baseHeight: dims.height,
        });
        x += pageWidth + gap;
      }
      const totalWidth = x - gap + padding;
      const layout = { positions, totalHeight: 0, totalWidth, gap, padding, maxPageWidth, maxPageHeight, isHorizontal: true, isSideBySide: true };
      continuousLayoutRef.current = layout;
      return layout;
    } else if (horizontal) {
      // Horizontal: pages stack left-to-right
      let x = padding;
      for (let p = 1; p <= numPages; p++) {
        const dims = allPageDimensions[p] || precomputedPageDimsRef.current[p] || defaultDims;
        const pageHeight = dims.height * scale;
        const pageWidth = dims.width * scale;
        if (pageWidth > maxPageWidth) maxPageWidth = pageWidth;
        if (pageHeight > maxPageHeight) maxPageHeight = pageHeight;
        positions.push({ left: x, top: 0, height: pageHeight, width: pageWidth, baseWidth: dims.width, baseHeight: dims.height });
        x += pageWidth + gap;
      }
      const totalWidth = x - gap + padding;
      const layout = { positions, totalHeight: 0, totalWidth, gap, padding, maxPageWidth, maxPageHeight, isHorizontal: true };
      continuousLayoutRef.current = layout;
      return layout;
    } else {
      // Vertical: pages stack top-to-bottom (existing behavior)
      let y = padding;
      for (let p = 1; p <= numPages; p++) {
        const dims = allPageDimensions[p] || precomputedPageDimsRef.current[p] || defaultDims;
        const pageHeight = dims.height * scale;
        const pageWidth = dims.width * scale;
        if (pageWidth > maxPageWidth) maxPageWidth = pageWidth;
        if (pageHeight > maxPageHeight) maxPageHeight = pageHeight;
        positions.push({ top: y, left: 0, height: pageHeight, width: pageWidth, baseWidth: dims.width, baseHeight: dims.height });
        y += pageHeight + gap;
      }
      const totalHeight = y - gap + padding;
      const layout = { positions, totalHeight, totalWidth: 0, gap, padding, maxPageWidth, maxPageHeight, isHorizontal: false };
      continuousLayoutRef.current = layout;
      return layout;
    }
  }, [viewMode, numPages, scale, allPageDimensions, canvasSize]);

  // ─── scrollToPagePosition ────────────────────────────────────────────
  const scrollToPagePosition = useCallback((pageNum, behavior = 'smooth', block = 'center') => {
    const container = containerRef.current;
    const layout = continuousLayoutRef.current;
    if (!container || !layout.positions || !layout.positions[pageNum]) return;

    const pagePos = layout.positions[pageNum];

    if (layout.isHorizontal) {
      const containerWidth = container.clientWidth;
      let scrollTarget;
      if (block === 'center') {
        scrollTarget = pagePos.left - (containerWidth / 2) + (pagePos.width / 2);
      } else if (block === 'start') {
        scrollTarget = pagePos.left - layout.padding;
      } else {
        scrollTarget = pagePos.left;
      }
      container.scrollTo({ left: Math.max(0, scrollTarget), behavior });
    } else {
      const containerHeight = container.clientHeight;
      let scrollTarget;
      if (block === 'center') {
        scrollTarget = pagePos.top - (containerHeight / 2) + (pagePos.height / 2);
      } else if (block === 'start') {
        scrollTarget = pagePos.top - layout.padding;
      } else {
        scrollTarget = pagePos.top;
      }
      container.scrollTo({ top: Math.max(0, scrollTarget), behavior });
    }
  }, []);

  // ─── Refs for scroll handler debouncing ──────────────────────────────
  const lastUpdateTimeRef = useRef(0);
  const prevViewModeRef = useRef(viewMode);

  // ─── Handle view mode changes: reset scroll position ────────────────────
  useEffect(() => {
    if (!isContinuousView(viewMode)) {
      prevViewModeRef.current = viewMode;
      return;
    }

    const container = containerRef.current;
    const prevMode = prevViewModeRef.current;
    prevViewModeRef.current = viewMode;

    // If switching between different continuous modes, scroll to current page
    if (container && isContinuousView(prevMode) && prevMode !== viewMode) {
      // Reset rendered pages — orientation changed, canvases need fresh render
      container.scrollTop = 0;
      container.scrollLeft = 0;

      // Force immediate visible pages recalculation around CURRENT page (not page 1)
      const layout = continuousLayoutRef.current;
      const cp = currentPageRef.current || 1;
      if (layout && layout.positions && layout.positions.length > 1) {
        const horizontal = viewMode === 'continuousHorizontal' || viewMode === 'sideBySide';
        const viewportSize = horizontal ? container.clientWidth : container.clientHeight;
        const buffer = viewportSize * 1.0;

        // Seed visible pages around current page
        const newVisible = new Set();
        for (let p = Math.max(1, cp - 3); p <= Math.min(layout.positions.length - 1, cp + 3); p++) {
          newVisible.add(p);
        }

        if (newVisible.size > 0) {
          visiblePagesRef.current = newVisible;
          setVisiblePages(newVisible);
          // Don't reset currentPage — keep the page user was viewing
        }

        // Scroll to current page after DOM updates with new layout
        setTimeout(() => {
          const freshLayout = continuousLayoutRef.current;
          if (freshLayout?.positions?.[cp]) {
            const pos = freshLayout.positions[cp];
            const horiz = viewMode === 'continuousHorizontal' || viewMode === 'sideBySide';
            if (horiz) {
              const target = pos.left - (container.clientWidth / 2) + (pos.width / 2);
              container.scrollLeft = Math.max(0, target);
            } else {
              const target = pos.top - (container.clientHeight / 2) + (pos.height / 2);
              container.scrollTop = Math.max(0, target);
            }
          }
        }, 50);
      }
    }
  }, [viewMode]);

  // ─── Scroll handler: update visible pages + currentPage from scroll ──
  useEffect(() => {
    if (!isContinuousView(viewMode)) return;

    const container = containerRef.current;
    if (!container) return;

    const horizontal = viewMode === 'continuousHorizontal' || viewMode === 'sideBySide';
    let rafId = null;

    // Binary search: find first page whose trailing edge > target.
    // For vertical: trailing edge = top + height
    // For horizontal: trailing edge = left + width
    const findFirstVisiblePage = (positions, target) => {
      let lo = 1, hi = positions.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const pos = positions[mid];
        if (!pos) { lo = mid + 1; continue; }
        const trailingEdge = horizontal ? (pos.left + pos.width) : (pos.top + pos.height);
        if (trailingEdge > target) {
          hi = mid;
        } else {
          lo = mid + 1;
        }
      }
      return lo;
    };

    const computeVisible = () => {
      const layout = continuousLayoutRef.current;
      if (!layout.positions || layout.positions.length <= 1) return null;
      if (isZoomingRef.current) return null;

      let scrollPos, viewportSize;
      if (horizontal) {
        scrollPos = container.scrollLeft;
        viewportSize = container.clientWidth;
      } else {
        scrollPos = container.scrollTop;
        viewportSize = container.clientHeight;
      }

      const buffer = viewportSize * 1.0; // 1x buffer — pre-renders ~1 full screen in each direction
      const viewStart = scrollPos - buffer;
      const viewEnd = scrollPos + viewportSize + buffer;
      const viewMid = scrollPos + viewportSize / 2;

      const newVisible = new Set();
      let closestPage = 1;
      let closestDistance = Infinity;

      const startPage = findFirstVisiblePage(layout.positions, viewStart);

      for (let p = startPage; p < layout.positions.length; p++) {
        const pos = layout.positions[p];
        if (!pos) continue;

        const pageStart = horizontal ? pos.left : pos.top;
        const pageSize = horizontal ? pos.width : pos.height;
        const pageEnd = pageStart + pageSize;

        if (pageStart >= viewEnd) break;

        if (pageEnd > viewStart) {
          newVisible.add(p);
        }

        const pageMid = pageStart + pageSize / 2;
        const distance = Math.abs(pageMid - viewMid);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestPage = p;
        }
      }

      // Check pages before startPage for closest-to-center
      for (let p = startPage - 1; p >= 1; p--) {
        const pos = layout.positions[p];
        if (!pos) continue;
        const pageStart = horizontal ? pos.left : pos.top;
        const pageSize = horizontal ? pos.width : pos.height;
        const pageMid = pageStart + pageSize / 2;
        const distance = Math.abs(pageMid - viewMid);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestPage = p;
        }
        if (pageMid < viewMid) break;
      }

      return { newVisible, closestPage };
    };

    const scrollSettleTimerRef = { current: null };

    // Fast check: has the visible range actually changed?
    // Compare min/max of the Set instead of iterating every element.
    const hasVisibleChanged = (newVisible) => {
      const prev = visiblePagesRef.current;
      if (prev.size !== newVisible.size) return true;
      // Quick min/max check — covers 99% of scroll cases (pages slide in/out at edges)
      let prevMin = Infinity, prevMax = -Infinity;
      let newMin = Infinity, newMax = -Infinity;
      for (const p of prev) { if (p < prevMin) prevMin = p; if (p > prevMax) prevMax = p; }
      for (const p of newVisible) { if (p < newMin) newMin = p; if (p > newMax) newMax = p; }
      return prevMin !== newMin || prevMax !== newMax;
    };

    const commitVisiblePages = (newVisible, closestPage) => {
      visiblePagesRef.current = newVisible;
      setVisiblePages(prev => {
        if (prev.size !== newVisible.size) return newVisible;
        for (const p of newVisible) {
          if (!prev.has(p)) return newVisible;
        }
        return prev;
      });
      setCurrentPage(prev => prev !== closestPage ? closestPage : prev);
      lastUpdateTimeRef.current = performance.now();
    };

    const handleScroll = () => {
      if (isZoomingRef.current) return;
      if (rafId) cancelAnimationFrame(rafId);

      // Add is-scrolling class for CSS optimizations (disables hover effects, etc.)
      // This is a direct DOM write — zero React overhead.
      if (!container.classList.contains('is-scrolling')) {
        container.classList.add('is-scrolling');
      }
      isScrollingRef.current = true;

      rafId = requestAnimationFrame(() => {
        const result = computeVisible();
        if (!result) return;

        const { newVisible, closestPage } = result;

        // Always update ref immediately (free — no React render)
        visiblePagesRef.current = newVisible;

        // During active scroll: defer React state update until scroll settles.
        // Pages within the mounted buffer already have rendered canvases,
        // so scrolling through them is instant without any React work.
        // Only commit to React state when:
        //   (a) scroll has settled (no scroll event for 120ms), OR
        //   (b) the visible range has changed AND enough time has passed (250ms)
        //       — this handles the case where user scrolls past the mounted buffer
        //       and we need to mount new pages.
        if (scrollSettleTimerRef.current) {
          clearTimeout(scrollSettleTimerRef.current);
        }

        const timeSinceLastCommit = performance.now() - lastUpdateTimeRef.current;
        const rangeChanged = hasVisibleChanged(newVisible);

        if (rangeChanged && timeSinceLastCommit > 500) {
          // Range changed and it's been a while — commit now to mount new pages
          commitVisiblePages(newVisible, closestPage);
        } else {
          // Defer until scroll settles
          scrollSettleTimerRef.current = setTimeout(() => {
            scrollSettleTimerRef.current = null;
            // Remove is-scrolling class — re-enables hover effects, pointer-events
            container.classList.remove('is-scrolling');
            isScrollingRef.current = false;
            // Recompute fresh since scroll position may have drifted
            const freshResult = computeVisible();
            if (freshResult) {
              commitVisiblePages(freshResult.newVisible, freshResult.closestPage);
            }
          }, 120);
        }
      });
    };

    // Initial visible pages calculation — commit immediately
    const initialResult = computeVisible();
    if (initialResult) {
      commitVisiblePages(initialResult.newVisible, initialResult.closestPage);
    }

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      container.classList.remove('is-scrolling');
      isScrollingRef.current = false;
      if (rafId) cancelAnimationFrame(rafId);
      if (scrollSettleTimerRef.current) {
        clearTimeout(scrollSettleTimerRef.current);
        scrollSettleTimerRef.current = null;
      }
    };
  }, [viewMode, numPages]);

  // ─── Return ───────────────────────────────────────────────────────────
  return {
    continuousLayout,
    scrollToPagePosition,
  };
}
