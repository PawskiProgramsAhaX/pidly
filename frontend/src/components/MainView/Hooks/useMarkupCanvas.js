/**
 * useMarkupCanvas.js
 *
 * React hook that manages a canvas element for rendering markup annotations.
 * Replaces the bulk SVG rendering of markups with a single canvas paint.
 *
 * The hook:
 *  - Maintains a canvas ref
 *  - Redraws when markups, selection, scale, page, or rotation change
 *  - Uses requestAnimationFrame to coalesce rapid updates
 *  - Tracks which markups couldn't be canvas-rendered (fallbackMarkupIds)
 *
 * Usage:
 *   const { canvasRef, fallbackMarkupIds } = useMarkupCanvas({ ... });
 *   <canvas ref={canvasRef} ... />
 */
import { useRef, useEffect, useCallback, useState } from 'react';
import { drawAllMarkups } from '../drawMarkupToCanvas';

export default function useMarkupCanvas({
  markups,               // array of markup objects for this page
  selectedMarkupId,      // exclude from canvas (rendered in SVG)
  scaledWidth,           // canvas logical width (CSS pixels * scale)
  scaledHeight,          // canvas logical height
  scale,
  rotation = 0,
  transformCoordinate,
  getLineDashArray,
  selectedMarkup,
  editingTextMarkupId,
  enabled = true,        // master toggle (e.g. only when overlaysReady)
}) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const [fallbackMarkupIds, setFallbackMarkupIds] = useState(new Set());

  const redraw = useCallback(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!scaledWidth || !scaledHeight || isNaN(scaledWidth) || isNaN(scaledHeight)) return;

    try {
      // Resize canvas backing store to match CSS dimensions
      const dpr = window.devicePixelRatio || 1;
      const backingW = Math.round(scaledWidth * dpr);
      const backingH = Math.round(scaledHeight * dpr);

      if (canvas.width !== backingW || canvas.height !== backingH) {
        canvas.width = backingW;
        canvas.height = backingH;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Scale context for devicePixelRatio so drawing coords match CSS pixels
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const opts = {
        scaledWidth,
        scaledHeight,
        scale,
        rotation,
        transformCoordinate,
        getLineDashArray,
        selectedMarkup,
        editingTextMarkupId,
      };

      const newFallbackIds = drawAllMarkups(ctx, markups, opts, selectedMarkupId);

      // Only update state if the fallback set actually changed
      setFallbackMarkupIds(prev => {
        if (prev.size !== newFallbackIds.size) return newFallbackIds;
        for (const id of newFallbackIds) {
          if (!prev.has(id)) return newFallbackIds;
        }
        return prev;
      });
    } catch (err) {
      console.error('useMarkupCanvas redraw failed:', err);
    }
  }, [
    markups, selectedMarkupId, scaledWidth, scaledHeight,
    scale, rotation, transformCoordinate, getLineDashArray,
    selectedMarkup, editingTextMarkupId, enabled,
  ]);

  // Schedule a redraw via requestAnimationFrame (coalesce rapid calls)
  const scheduleRedraw = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      redraw();
    });
  }, [redraw]);

  // Redraw whenever dependencies change
  useEffect(() => {
    scheduleRedraw();
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scheduleRedraw]);

  return { canvasRef, fallbackMarkupIds, redraw };
}
