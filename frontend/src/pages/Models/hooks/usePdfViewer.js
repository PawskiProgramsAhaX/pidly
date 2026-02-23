import { useState, useEffect, useRef, useCallback } from 'react';
import { getPdfFromBackend } from '../../../utils/storage';

/**
 * Hook encapsulating PDF rendering, zoom, pan, and page navigation.
 * Returns refs, state, and handlers for the PDF canvas.
 */
export default function usePdfViewer() {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [isRendering, setIsRendering] = useState(false);

  // Pan state
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // ── Initialise PDF.js ──────────────────────────
  useEffect(() => {
    if (!window.pdfjsLib) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      };
      document.head.appendChild(script);
    }
  }, []);

  // ── Load a PDF by backend filename ─────────────
  const loadPdfByFilename = useCallback(async (backendFilename, sourceFolder = null) => {
    if (!backendFilename || !window.pdfjsLib) return;
    try {
      const blobUrl = await getPdfFromBackend(backendFilename, sourceFolder);
      const pdf = await window.pdfjsLib.getDocument(blobUrl).promise;
      setPdfDoc(pdf);
      setNumPages(pdf.numPages);
      setCurrentPage(1);
      setScale(1);
      setPanOffset({ x: 0, y: 0 });
    } catch (error) {
      console.error('Error loading PDF:', error);
      alert('Failed to load PDF');
    }
  }, []);

  const clearPdf = useCallback(() => {
    setPdfDoc(null);
    setNumPages(0);
    setCurrentPage(1);
    setScale(1);
    setPanOffset({ x: 0, y: 0 });
    setCanvasSize({ width: 0, height: 0 });
  }, []);

  // ── Render current page ────────────────────────
  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current || isRendering) return;
    setIsRendering(true);
    try {
      const page = await pdfDoc.getPage(currentPage);
      const baseScale = 2;
      const viewport = page.getViewport({ scale: baseScale });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      setCanvasSize({
        width: viewport.width / baseScale,
        height: viewport.height / baseScale,
      });
      await page.render({ canvasContext: context, viewport }).promise;
    } catch (error) {
      console.error('Render error:', error);
    } finally {
      setIsRendering(false);
    }
  }, [pdfDoc, currentPage]);

  useEffect(() => {
    if (pdfDoc) renderPage();
  }, [pdfDoc, currentPage, renderPage]);

  // ── Wheel zoom (toward cursor) ────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pdfDoc) return;

    const handleWheel = (e) => {
      if (!canvasSize.width || !canvasSize.height) return;
      e.preventDefault();
      e.stopPropagation();

      const oldScale = scale;
      const factor = 1.25;
      const newScale =
        e.deltaY > 0
          ? Math.max(0.25, oldScale / factor)
          : Math.min(5, oldScale * factor);
      if (newScale === oldScale) return;

      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const pdfX = (mouseX - panOffset.x) / oldScale;
      const pdfY = (mouseY - panOffset.y) / oldScale;
      const newPanX = mouseX - pdfX * newScale;
      const newPanY = mouseY - pdfY * newScale;

      const pdfWidth = canvasSize.width * newScale;
      const pdfHeight = canvasSize.height * newScale;
      const margin = 100;

      setPanOffset({
        x: Math.max(Math.min(0, rect.width - pdfWidth - margin), Math.min(margin, newPanX)),
        y: Math.max(Math.min(0, rect.height - pdfHeight - margin), Math.min(margin, newPanY)),
      });
      setScale(newScale);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [pdfDoc, scale, panOffset.x, panOffset.y, canvasSize.width, canvasSize.height]);

  // ── Pan ────────────────────────────────────────
  useEffect(() => {
    if (!isPanning) return;

    const handleMouseMove = (e) => {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const pdfWidth = canvasSize.width * scale;
      const pdfHeight = canvasSize.height * scale;
      const margin = 100;

      setPanOffset((prev) => ({
        x: Math.max(Math.min(0, containerRect.width - pdfWidth - margin), Math.min(margin, prev.x + e.movementX)),
        y: Math.max(Math.min(0, containerRect.height - pdfHeight - margin), Math.min(margin, prev.y + e.movementY)),
      }));
    };

    const handleMouseUp = () => setIsPanning(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isPanning, canvasSize, scale]);

  // ── Prevent browser zoom ──────────────────────
  useEffect(() => {
    const preventZoom = (e) => {
      if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) e.preventDefault();
    };
    const preventWheelZoom = (e) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    document.addEventListener('keydown', preventZoom);
    document.addEventListener('wheel', preventWheelZoom, { passive: false });
    return () => {
      document.removeEventListener('keydown', preventZoom);
      document.removeEventListener('wheel', preventWheelZoom);
    };
  }, []);

  // ── Page keyboard shortcuts ───────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (pdfDoc && numPages > 1 && !e.target.matches('input, textarea, select')) {
        if (e.key === 'PageDown' || (e.key === 'ArrowRight' && e.altKey)) {
          e.preventDefault();
          setCurrentPage((p) => Math.min(numPages, p + 1));
        } else if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && e.altKey)) {
          e.preventDefault();
          setCurrentPage((p) => Math.max(1, p - 1));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pdfDoc, numPages]);

  // ── Zoom helpers ──────────────────────────────
  const zoomIn = useCallback(() => setScale((s) => Math.min(s * 1.25, 5)), []);
  const zoomOut = useCallback(() => setScale((s) => Math.max(s / 1.25, 0.25)), []);

  const startPan = useCallback((e) => {
    setIsPanning(true);
    setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  }, [panOffset]);

  return {
    // Refs
    canvasRef,
    containerRef,
    // State
    pdfDoc,
    currentPage,
    setCurrentPage,
    numPages,
    scale,
    setScale,
    canvasSize,
    panOffset,
    setPanOffset,
    isPanning,
    setIsPanning,
    // Actions
    loadPdfByFilename,
    clearPdf,
    zoomIn,
    zoomOut,
    startPan,
  };
}
