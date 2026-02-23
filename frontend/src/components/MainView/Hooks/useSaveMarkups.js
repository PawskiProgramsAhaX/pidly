import { useCallback, useRef, useEffect } from 'react';
import { uploadPdfToBackend } from '../../../utils/storage';
import { BACKEND_URL } from '../../../utils/config';
import { stripAllAnnotations } from '../pdfAnnotationUtils';

/**
 * useSaveMarkups — custom hook encapsulating all PDF save/export logic.
 *
 * Handles:
 *  - saveMarkupsToPdf(flatten, saveInPlace) — server-side save with download or in-place overwrite
 *  - saveMarkupsClientSide(flatten) — client-side canvas fallback
 *  - downloadPdfWithMarkups() / downloadFlattenedPdf() — convenience wrappers
 *  - saveToOriginalFile() — overwrite the source file on backend
 *  - ensureFileOnBackend(file) — upload local files to backend for processing
 *  - getEffectiveBackendFilename(file) — resolve backend filename for a file
 *
 * Also registers save/download handlers with parent component via refs.
 */
export function useSaveMarkups({
  // State
  markups,
  currentFile,
  currentFileIdentifier,
  canvasSize,
  pdfDoc,
  currentPage,
  pdfUrl,
  deletedPdfAnnotations,
  tempBackendFiles,
  canvasRef,

  // Refs for PDF byte management (needed for post-save annotation stripping)
  currentPdfBytesRef,
  originalPdfBytesRef,
  modifiedPdfUrlRef,

  // Render control
  resetRenderedPages,

  // Setters
  setMarkups,
  setPdfDoc,
  setNumPages,
  setIsSavingMarkups,
  setUnsavedMarkupFiles,
  setDeletedPdfAnnotations,
  setHasLoadedAnnotations,
  setOwnedPdfAnnotationIds,
  setTempBackendFiles,

  // Parent callbacks
  onRegisterSaveHandler,
  onRegisterDownloadHandler,

  // Save notification
  setSaveNotification,
  saveNotifTimerRef,
}) {

  // ─── Ref to prevent concurrent saves (state is stale in async closures) ──
  const savingRef = useRef(false);

  // ─── Helper: show a save notification (auto-clears success after 2.5s) ──
  const showSaveNotif = useCallback((type, message) => {
    if (saveNotifTimerRef?.current) clearTimeout(saveNotifTimerRef.current);
    if (setSaveNotification) {
      setSaveNotification({ type, message });
      if (type === 'success') {
        saveNotifTimerRef.current = setTimeout(() => setSaveNotification(null), 2500);
      }
    }
  }, [setSaveNotification, saveNotifTimerRef]);

  // ─── ensureFileOnBackend ─────────────────────────────────────────────
  const ensureFileOnBackend = useCallback(async (file) => {
    console.log('ensureFileOnBackend called with:', {
      id: file?.id,
      name: file?.name,
      backendFilename: file?.backendFilename,
      isLocal: file?.isLocal,
      hasFile: !!file?.file,
      hasHandle: !!file?.handle
    });

    // If file already has a backendFilename, use it directly
    if (file.backendFilename) {
      console.log('Using existing backendFilename:', file.backendFilename);
      return file.backendFilename;
    }

    // Check if we already uploaded this local file
    if (tempBackendFiles[file.id]) {
      console.log('Using cached temp upload:', tempBackendFiles[file.id]);
      return tempBackendFiles[file.id];
    }

    // For local files, we need to upload to backend
    if (file.isLocal && file.file) {
      console.log('Uploading local file to backend for processing:', file.name);
      try {
        const result = await uploadPdfToBackend(file.file);
        const backendFilename = result.filename;

        // Store the mapping so we can reuse it
        setTempBackendFiles(prev => ({
          ...prev,
          [file.id]: backendFilename
        }));

        return backendFilename;
      } catch (error) {
        console.error('Failed to upload local file to backend:', error);
        throw new Error(`Failed to upload "${file.name}" for processing: ${error.message}`);
      }
    }

    // For local files with a file handle but no file object, try to get the file
    if (file.isLocal && file.handle) {
      console.log('Getting file from handle for upload:', file.name);
      try {
        const fileObj = await file.handle.getFile();
        const result = await uploadPdfToBackend(fileObj);
        const backendFilename = result.filename;

        setTempBackendFiles(prev => ({
          ...prev,
          [file.id]: backendFilename
        }));

        return backendFilename;
      } catch (error) {
        console.error('Failed to get file from handle:', error);
        throw new Error(`Failed to access "${file.name}" for processing: ${error.message}`);
      }
    }

    // Last resort - if file has backendFilename even though it's marked as local, use it
    if (file.backendFilename) {
      console.log('Fallback: using backendFilename for local file:', file.backendFilename);
      return file.backendFilename;
    }

    throw new Error(`File "${file.name || 'unknown'}" is not available on the backend and cannot be uploaded`);
  }, [tempBackendFiles]);


  // ─── getEffectiveBackendFilename ─────────────────────────────────────
  const getEffectiveBackendFilename = useCallback((file) => {
    if (!file) return null;

    // Check for temporary upload first
    if (file.isLocal && tempBackendFiles[file.id]) {
      return tempBackendFiles[file.id];
    }

    // Otherwise use the regular backend filename
    return file.backendFilename || null;
  }, [tempBackendFiles]);


  // ─── Helper: clear saved-state for current file ──────────────────────
  const clearSavedState = useCallback(() => {
    setMarkups(prev => prev.map(m =>
      m.filename === currentFileIdentifier ? { ...m, modified: false, savedAt: new Date().toISOString() } : m
    ));
    setUnsavedMarkupFiles(prev => {
      const next = new Set(prev);
      next.delete(currentFileIdentifier);
      return next;
    });
    setDeletedPdfAnnotations(prev => {
      const next = new Map(prev);
      next.delete(currentFileIdentifier);
      return next;
    });
  }, [currentFileIdentifier, setMarkups, setUnsavedMarkupFiles, setDeletedPdfAnnotations]);


  // ─── Helper: reload PDF after save while preserving markup objects ───
  // Instead of clearing markups and re-parsing (lossy), we:
  //  1. Fetch the saved PDF bytes
  //  2. Strip ALL annotations so PDF.js renders a clean background
  //  3. Load the stripped PDF into PDF.js
  //  4. Keep existing markups in SVG layer with fromPdf: true, modified: false
  //  5. Auto-own all markup IDs so they stay in SVG (not re-parsed from PDF)
  //  6. Skip annotation re-parsing (hasLoadedAnnotations = true)
  const reloadPdfPreservingMarkups = useCallback(async (pdfBytesOrUrl, allFileMarkups) => {
    try {
      // Get the saved PDF bytes
      let savedBytes;
      if (pdfBytesOrUrl instanceof Uint8Array || pdfBytesOrUrl instanceof ArrayBuffer) {
        savedBytes = pdfBytesOrUrl;
      } else {
        // It's a URL - fetch the bytes
        const resp = await fetch(pdfBytesOrUrl);
        savedBytes = new Uint8Array(await resp.arrayBuffer());
      }

      // Strip all annotations so PDF.js renders clean pages
      const strippedBytes = await stripAllAnnotations(savedBytes);
      const bytesToLoad = strippedBytes || savedBytes;

      // Create blob URL for PDF.js
      const blob = new Blob([bytesToLoad], { type: 'application/pdf' });
      const newUrl = URL.createObjectURL(blob);

      // Clean up old modified URL
      if (modifiedPdfUrlRef?.current) {
        URL.revokeObjectURL(modifiedPdfUrlRef.current);
      }
      if (modifiedPdfUrlRef) {
        modifiedPdfUrlRef.current = newUrl;
      }

      // Store stripped bytes for future takeOwnership calls
      if (currentPdfBytesRef) {
        currentPdfBytesRef.current = bytesToLoad;
      }
      // Also update original bytes ref since this is now the saved version
      if (originalPdfBytesRef) {
        originalPdfBytesRef.current = savedBytes;
      }

      // Load stripped PDF into PDF.js
      const loadingTask = window.pdfjsLib.getDocument({ url: newUrl, verbosity: 0 });
      const newPdfDoc = await loadingTask.promise;

      // Keep existing markups — just update flags (fromPdf: true, modified: false)
      setMarkups(prev => prev.map(m =>
        m.filename === currentFileIdentifier
          ? { ...m, modified: false, fromPdf: true, savedAt: new Date().toISOString() }
          : m
      ));

      // Auto-own ALL markup IDs for this file so they render in SVG layer
      const allIds = new Set(allFileMarkups.map(m => m.id));
      setOwnedPdfAnnotationIds(allIds);

      // Mark annotations as already loaded — do NOT re-parse from PDF
      setHasLoadedAnnotations(true);

      // Clear unsaved/deleted state
      setUnsavedMarkupFiles(prev => {
        const next = new Set(prev);
        next.delete(currentFileIdentifier);
        return next;
      });
      setDeletedPdfAnnotations(prev => {
        const next = new Map(prev);
        next.delete(currentFileIdentifier);
        return next;
      });

      // Set new PDF doc (triggers re-render)
      setPdfDoc(newPdfDoc);
      setNumPages(newPdfDoc.numPages);

      // Force re-render of all pages with clean (annotation-free) backgrounds
      if (resetRenderedPages) {
        resetRenderedPages();
      }

      console.log('Post-save reload: kept', allFileMarkups.length, 'markups, stripped annotations from PDF');
      return true;
    } catch (error) {
      console.warn('Post-save reload failed, falling back to re-parse:', error);
      return false;
    }
  }, [
    currentFileIdentifier, setMarkups, setPdfDoc, setNumPages,
    setOwnedPdfAnnotationIds, setHasLoadedAnnotations,
    setUnsavedMarkupFiles, setDeletedPdfAnnotations,
    currentPdfBytesRef, originalPdfBytesRef, modifiedPdfUrlRef, resetRenderedPages,
  ]);


  // ─── saveMarkupsClientSide (canvas fallback) ─────────────────────────
  const saveMarkupsClientSide = useCallback(async (flatten = false) => {
    if (!pdfDoc || !currentFile) return;

    try {
      const fileMarkups = markups.filter(m => m.filename === currentFileIdentifier);

      const canvas = canvasRef.current;
      if (!canvas) return;

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvasSize.width;
      tempCanvas.height = canvasSize.height;
      const ctx = tempCanvas.getContext('2d');

      // Draw the PDF page
      ctx.drawImage(canvas, 0, 0, canvasSize.width, canvasSize.height);

      // Draw markups on top
      const pageMarkups = fileMarkups.filter(m => m.page === currentPage - 1);
      pageMarkups.forEach(markup => {
        ctx.save();
        if (markup.type === 'pen' || markup.type === 'highlighter') {
          ctx.strokeStyle = markup.color;
          ctx.lineWidth = markup.strokeWidth;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.globalAlpha = markup.opacity || 1;
          ctx.beginPath();
          markup.points.forEach((p, i) => {
            const x = p.x * canvasSize.width;
            const y = p.y * canvasSize.height;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
        } else if (markup.type === 'rectangle') {
          ctx.strokeStyle = markup.color;
          ctx.lineWidth = markup.strokeWidth;
          const x = Math.min(markup.startX, markup.endX) * canvasSize.width;
          const y = Math.min(markup.startY, markup.endY) * canvasSize.height;
          const w = Math.abs(markup.endX - markup.startX) * canvasSize.width;
          const h = Math.abs(markup.endY - markup.startY) * canvasSize.height;
          ctx.strokeRect(x, y, w, h);
        } else if (markup.type === 'arrow') {
          ctx.strokeStyle = markup.color;
          ctx.fillStyle = markup.color;
          ctx.lineWidth = markup.strokeWidth;
          const x1 = markup.startX * canvasSize.width;
          const y1 = markup.startY * canvasSize.height;
          const x2 = markup.endX * canvasSize.width;
          const y2 = markup.endY * canvasSize.height;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();

          // Arrow head
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const arrowLength = markup.arrowHeadSize || 15;
          const arrowAngle = Math.PI / 6;
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - arrowLength * Math.cos(angle - arrowAngle), y2 - arrowLength * Math.sin(angle - arrowAngle));
          ctx.lineTo(x2 - arrowLength * Math.cos(angle + arrowAngle), y2 - arrowLength * Math.sin(angle + arrowAngle));
          ctx.closePath();
          ctx.fill();
        } else if (markup.type === 'text') {
          ctx.fillStyle = markup.color;
          ctx.font = `${markup.fontSize || 16}px Arial`;
          ctx.fillText(markup.text || '', markup.x * canvasSize.width, markup.y * canvasSize.height);
        } else if (markup.type === 'circle') {
          ctx.strokeStyle = markup.color;
          ctx.lineWidth = markup.strokeWidth;
          const cx = ((markup.startX + markup.endX) / 2) * canvasSize.width;
          const cy = ((markup.startY + markup.endY) / 2) * canvasSize.height;
          const rx = Math.abs(markup.endX - markup.startX) * canvasSize.width / 2;
          const ry = Math.abs(markup.endY - markup.startY) * canvasSize.height / 2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
          ctx.stroke();
        } else if (markup.type === 'polyline' || markup.type === 'polylineArrow' || markup.type === 'cloudPolyline' || markup.type === 'polygon') {
          if (markup.points && markup.points.length >= 2) {
            ctx.strokeStyle = markup.color;
            ctx.lineWidth = markup.strokeWidth;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.globalAlpha = markup.strokeOpacity || 1;

            ctx.beginPath();
            markup.points.forEach((p, i) => {
              const x = p.x * canvasSize.width;
              const y = p.y * canvasSize.height;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            if (markup.closed) ctx.closePath();
            ctx.stroke();

            // Draw arrowhead for polylineArrow
            if (markup.type === 'polylineArrow' && markup.points.length >= 2) {
              const lastPt = markup.points[markup.points.length - 1];
              const prevPt = markup.points[markup.points.length - 2];
              const endX = lastPt.x * canvasSize.width;
              const endY = lastPt.y * canvasSize.height;
              const startX = prevPt.x * canvasSize.width;
              const startY = prevPt.y * canvasSize.height;

              const angle = Math.atan2(endY - startY, endX - startX);
              const arrowLength = markup.arrowHeadSize || 12;
              const arrowAngle = Math.PI / 7;

              ctx.fillStyle = markup.color;
              ctx.beginPath();
              ctx.moveTo(endX, endY);
              ctx.lineTo(endX - arrowLength * Math.cos(angle - arrowAngle), endY - arrowLength * Math.sin(angle - arrowAngle));
              ctx.lineTo(endX - arrowLength * Math.cos(angle + arrowAngle), endY - arrowLength * Math.sin(angle + arrowAngle));
              ctx.closePath();
              ctx.fill();
            }
          }
        }
        ctx.restore();
      });

      // Convert to blob and download
      tempCanvas.toBlob((blob) => {
        if (blob) {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = currentFile.name.replace('.pdf', '_page' + currentPage + '.png');
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);

          clearSavedState();
        }
      }, 'image/png');

    } catch (error) {
      console.error('Error in client-side save:', error);
      alert('Failed to save markups');
    }
  }, [pdfDoc, currentFile, markups, currentFileIdentifier, canvasSize, canvasRef, currentPage, clearSavedState]);


  // ─── saveMarkupsToPdf (main save) ────────────────────────────────────
  const saveMarkupsToPdf = useCallback(async (flatten = false, saveInPlace = false) => {
    // Prevent concurrent saves — a second Ctrl+S while saving causes EBUSY on Windows
    if (savingRef.current) {
      console.log('Save already in progress, skipping duplicate request');
      return;
    }

    if (!currentFile) {
      alert('No PDF selected');
      return;
    }

    // Get markups for current file
    const allFileMarkups = markups.filter(m => m.filename === currentFileIdentifier);

    // Debug: log all markups with their flags
    console.log('=== SAVE DEBUG: All file markups ===');
    allFileMarkups.forEach(m => {
      console.log({
        id: m.id,
        type: m.type,
        fromPdf: m.fromPdf,
        modified: m.modified,
        pdfAnnotId: m.pdfAnnotId,
        text: m.text?.substring(0, 20)
      });
    });

    // Separate into categories for the backend:
    // 1. New markups (not from PDF) - add these
    // 2. Modified PDF annotations - need to remove original and add modified version
    // 3. Unmodified PDF annotations - keep as-is (don't send)
    const newMarkups = allFileMarkups.filter(m => !m.fromPdf);
    const modifiedMarkups = allFileMarkups.filter(m => m.fromPdf && m.modified);
    const unmodifiedPdfMarkups = allFileMarkups.filter(m => m.fromPdf && !m.modified);

    console.log('=== SAVE DEBUG: Categories ===');
    console.log('New markups:', newMarkups.length);
    console.log('Modified PDF markups:', modifiedMarkups.length, modifiedMarkups.map(m => ({ id: m.id, pdfAnnotId: m.pdfAnnotId })));
    console.log('Unmodified PDF markups:', unmodifiedPdfMarkups.length);

    // Debug text markups specifically
    const textMarkups = [...newMarkups, ...modifiedMarkups].filter(m => m.type === 'text');
    if (textMarkups.length > 0) {
      console.log('=== SAVE DEBUG: Text markups being saved ===');
      textMarkups.forEach(m => {
        console.log({
          id: m.id, x: m.x, y: m.y, fontSize: m.fontSize,
          text: m.text, fromPdf: m.fromPdf, modified: m.modified
        });
      });
    }

    // IDs of original annotations that were modified (backend should remove these)
    const annotationsToRemove = modifiedMarkups
      .filter(m => m.pdfAnnotId)
      .map(m => m.pdfAnnotId);

    // Also include annotations that were deleted by the user
    const deletedIdsForFile = deletedPdfAnnotations.get(currentFileIdentifier);
    if (deletedIdsForFile) {
      deletedIdsForFile.forEach(id => {
        if (!annotationsToRemove.includes(id)) {
          annotationsToRemove.push(id);
        }
      });
    }

    console.log('=== SAVE DEBUG: annotationsToRemove ===', annotationsToRemove);
    console.log('=== SAVE DEBUG: canvasSize ===', canvasSize);

    const markupsToSave = [...newMarkups, ...modifiedMarkups];

    // Debug: log text box markups being saved
    const textBoxes = markupsToSave.filter(m => m.type === 'text');
    if (textBoxes.length > 0) {
      console.log('=== SAVE DEBUG: Text boxes being saved ===');
      textBoxes.forEach(m => {
        console.log({
          id: m.id, type: m.type, startX: m.startX, startY: m.startY,
          endX: m.endX, endY: m.endY, text: m.text?.substring(0, 30),
          fillColor: m.fillColor, borderColor: m.borderColor,
          textAlign: m.textAlign, fontSize: m.fontSize, color: m.color
        });
      });
    }

    // Debug: log shape markups being saved
    const shapes = markupsToSave.filter(m => m.type === 'rectangle' || m.type === 'circle');
    if (shapes.length > 0) {
      console.log('=== SAVE DEBUG: Shapes being saved ===');
      shapes.forEach(m => {
        console.log({
          id: m.id, type: m.type, color: m.color, fillColor: m.fillColor,
          opacity: m.opacity, strokeWidth: m.strokeWidth,
          text: m.text?.substring(0, 30), textColor: m.textColor,
          fontSize: m.fontSize, textAlign: m.textAlign
        });
      });
    }

    // Debug: log polyline/cloudPolyline/cloud markups being saved
    const polylines = markupsToSave.filter(m => m.type === 'polyline' || m.type === 'polylineArrow' || m.type === 'cloudPolyline' || m.type === 'cloud');
    if (polylines.length > 0) {
      console.log('=== SAVE DEBUG: Polylines/Clouds being saved ===');
      polylines.forEach(m => {
        console.log(`  Saving: id=${m.id}, type=${m.type}, closed=${m.closed}, fillColor=${m.fillColor}, fillOpacity=${m.fillOpacity}, points=${m.points?.length}`);
      });
    }

    // Debug: log arc markups being saved
    const arcs = markupsToSave.filter(m => m.type === 'arc');
    if (arcs.length > 0) {
      console.log('=== SAVE DEBUG: Arcs being saved ===');
      arcs.forEach(m => {
        console.log({
          id: m.id, type: m.type, startX: m.startX, startY: m.startY,
          endX: m.endX, endY: m.endY, color: m.color, strokeWidth: m.strokeWidth,
          strokeOpacity: m.strokeOpacity, lineStyle: m.lineStyle,
          startAngle: m.startAngle, endAngle: m.endAngle
        });
      });
    }

    // Debug: log line markups being saved
    const lines = markupsToSave.filter(m => m.type === 'line' || m.type === 'arrow');
    if (lines.length > 0) {
      console.log('=== SAVE DEBUG: Lines/Arrows being saved ===');
      lines.forEach(m => {
        console.log({
          id: m.id, type: m.type, color: m.color, strokeWidth: m.strokeWidth,
          lineStyle: m.lineStyle, arrowHeadSize: m.arrowHeadSize
        });
      });
    }

    if (markupsToSave.length === 0 && annotationsToRemove.length === 0) {
      if (saveInPlace) {
        // Nothing to save in-place — file is already current
        return;
      }
      // Download mode with no changes: download the current PDF as-is
      // (it already has its existing annotations intact)
      try {
        setIsSavingMarkups(true);
        const backendFilename = await ensureFileOnBackend(currentFile);
        const resp = await fetch(`${BACKEND_URL}/api/pdf/${encodeURIComponent(backendFilename)}`);
        if (!resp.ok) throw new Error('Failed to fetch file');
        const blob = await resp.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = currentFile.name;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } catch (err) {
        console.error('Error downloading file:', err);
        alert('Failed to download file: ' + err.message);
      } finally {
        setIsSavingMarkups(false);
      }
      return;
    }

    setIsSavingMarkups(true);
    savingRef.current = true;

    try {
      // Ensure file is on backend (uploads local files if needed)
      const backendFilename = await ensureFileOnBackend(currentFile);

      console.log('Saving markups:', {
        filename: currentFileIdentifier,
        backendFilename,
        newCount: newMarkups.length,
        modifiedCount: modifiedMarkups.length,
        annotationsToRemove,
        canvasSize: { width: canvasSize.width, height: canvasSize.height }
      });

      const response = await fetch(`${BACKEND_URL}/api/pdf/save-markups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfFilename: backendFilename,
          markups: markupsToSave,
          annotationsToRemove, // Backend should remove these original annotations
          flatten: flatten,
          saveInPlace: saveInPlace, // If true, overwrite the source file instead of downloading
          canvasWidth: canvasSize.width,
          canvasHeight: canvasSize.height,
          sourceFolder: currentFile?.sourceFolder || null
        })
      });

      // Check if response is JSON (error or success for saveInPlace) or blob (download)
      const contentType = response.headers.get('content-type');

      if (!response.ok) {
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json();
          throw new Error(errorData.error || errorData.details || 'Failed to save markups');
        }
        throw new Error(`Server error: ${response.status}`);
      }

      // Check if backend returned JSON (for saveInPlace success or error)
      if (contentType && contentType.includes('application/json')) {
        const result = await response.json();
        if (result.success) {
          console.log('Saved markups in place:', result);

          // Reload PDF while preserving our markup objects (no lossy re-parse)
          if (pdfDoc && currentFile) {
            await new Promise(resolve => setTimeout(resolve, 200)); // Small delay for file system
            const sfParam = currentFile.sourceFolder ? `&sourceFolder=${encodeURIComponent(currentFile.sourceFolder)}` : '';
            const backendUrl = `${BACKEND_URL}/api/pdf/${encodeURIComponent(backendFilename)}?t=${Date.now()}${sfParam}`;

            const preserved = await reloadPdfPreservingMarkups(backendUrl, allFileMarkups);
            if (!preserved) {
              // Fallback: old behavior (clear + re-parse) if stripping failed
              setHasLoadedAnnotations(false);
              setOwnedPdfAnnotationIds(new Set());
              try {
                const loadingTask = window.pdfjsLib.getDocument(backendUrl);
                const newPdfDoc = await loadingTask.promise;
                setMarkups(prev => prev.filter(m => m.filename !== currentFileIdentifier));
                setPdfDoc(newPdfDoc);
                setNumPages(newPdfDoc.numPages);
              } catch (reloadErr) {
                console.warn('PDF saved but failed to reload:', reloadErr);
                alert('Changes saved successfully!\n\nNote: Please close and reopen the document to see the saved annotations.');
              }
            }
          }

          // Clear unsaved state — file has been saved
          clearSavedState();
          showSaveNotif('success', 'Saved successfully');
          return;
        } else if (result.error) {
          throw new Error(result.error || 'Failed to save');
        }
      }

      // Backend returned a blob (PDF) - download it
      const blob = await response.blob();

      // Verify blob is valid
      if (blob.size < 1000) {
        throw new Error(`Invalid PDF response (size: ${blob.size} bytes)`);
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = flatten
        ? currentFile.name.replace('.pdf', '_flattened.pdf')
        : currentFile.name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      // Mark this file's markups as saved
      clearSavedState();

    } catch (error) {
      console.error('Error saving markups:', error);
      showSaveNotif('error', error.message);
    } finally {
      setIsSavingMarkups(false);
      savingRef.current = false;
    }
  }, [
    currentFile, currentFileIdentifier, markups, canvasSize, pdfDoc,
    deletedPdfAnnotations, ensureFileOnBackend,
    clearSavedState, reloadPdfPreservingMarkups, showSaveNotif,
    setMarkups, setPdfDoc, setNumPages, setIsSavingMarkups,
    setUnsavedMarkupFiles, setDeletedPdfAnnotations, setHasLoadedAnnotations,
    setOwnedPdfAnnotationIds,
  ]);


  // ─── Convenience wrappers ────────────────────────────────────────────
  const downloadPdfWithMarkups = useCallback(async () => {
    await saveMarkupsToPdf(false);
  }, [saveMarkupsToPdf]);

  const downloadFlattenedPdf = useCallback(async () => {
    await saveMarkupsToPdf(true);
  }, [saveMarkupsToPdf]);


  // ─── saveToOriginalFile ──────────────────────────────────────────────
  const saveToOriginalFile = useCallback(async () => {
    // Prevent concurrent saves
    if (savingRef.current) {
      console.log('Save already in progress, skipping duplicate request');
      return;
    }

    if (!currentFile || !pdfDoc) return;

    // Local files with sourceFolder work like regular source folder files — no special handling needed

    if (!currentFile.backendFilename) {
      alert('File not found on server. Please try re-uploading.');
      return;
    }

    setIsSavingMarkups(true);
    savingRef.current = true;

    try {
      // Get ALL markups for this file
      const allFileMarkups = markups.filter(m => m.filename === currentFileIdentifier);

      // Categorize: only touch new + modified, leave unmodified annotations in the PDF untouched
      const newMarkups = allFileMarkups.filter(m => !m.fromPdf);
      const modifiedMarkups = allFileMarkups.filter(m => m.fromPdf && m.modified);
      const unmodifiedPdfMarkups = allFileMarkups.filter(m => m.fromPdf && !m.modified);

      // Only remove annotations that were modified (will be replaced) or deleted by the user.
      // Unmodified PDF annotations stay in the file untouched — preserving all their original
      // properties (author, creation date, review status, rich text, appearance streams, etc.)
      const annotationsToRemove = modifiedMarkups
        .filter(m => m.pdfAnnotId)
        .map(m => m.pdfAnnotId);

      // Also include annotations that were deleted by the user
      const deletedIdsForFile = deletedPdfAnnotations.get(currentFileIdentifier);
      if (deletedIdsForFile) {
        deletedIdsForFile.forEach(id => {
          if (!annotationsToRemove.includes(id)) {
            annotationsToRemove.push(id);
          }
        });
      }

      // Only send new + modified markups for the backend to write.
      // Unmodified annotations are already in the PDF and will be preserved.
      const markupsToSave = [...newMarkups, ...modifiedMarkups];

      if (markupsToSave.length === 0 && annotationsToRemove.length === 0) {
        // Nothing changed — file is already up to date
        console.log('No changes to save to original file.');
        setIsSavingMarkups(false);
        return;
      }

      console.log('Saving to original file:', {
        filename: currentFile.backendFilename,
        totalMarkups: markupsToSave.length,
        newMarkups: newMarkups.length,
        modifiedMarkups: modifiedMarkups.length,
        unmodifiedPdfMarkups: unmodifiedPdfMarkups.length + ' (preserved in PDF)',
        annotationsToRemove: annotationsToRemove.length
      });

      // Debug: log all markups being saved
      console.log('=== Markups being saved (new + modified only) ===');
      markupsToSave.forEach((m, i) => {
        console.log(`${i + 1}. ${m.type} - page ${m.page} - fromPdf: ${m.fromPdf} - modified: ${m.modified} - pdfAnnotId: ${m.pdfAnnotId || 'none'}`);
      });

      // Get the annotated PDF from backend
      const response = await fetch(`${BACKEND_URL}/api/pdf/save-markups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfFilename: currentFile.backendFilename,
          markups: markupsToSave,
          annotationsToRemove,
          flatten: false, // Keep annotations editable
          canvasWidth: canvasSize.width,
          canvasHeight: canvasSize.height,
          sourceFolder: currentFile?.sourceFolder || null
        })
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to save markups');
        }
        throw new Error(`Server error: ${response.status}`);
      }

      const blob = await response.blob();

      if (blob.size < 1000) {
        throw new Error(`Invalid PDF response (size: ${blob.size} bytes)`);
      }

      // Now upload this blob to replace the original file
      const formData = new FormData();
      formData.append('pdf', blob, currentFile.backendFilename);

      // Use query param for overwrite flag (multer parses file before body)
      const uploadResponse = await fetch(`${BACKEND_URL}/api/upload?overwrite=true`, {
        method: 'POST',
        body: formData
      });

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json();
        throw new Error(errorData.error || 'Failed to upload saved file');
      }

      // Clear unsaved state immediately (before reload, which may have timing issues)
      clearSavedState();

      // Reload PDF while preserving our markup objects (no lossy re-parse)
      const backendUrl = `${BACKEND_URL}/api/pdf/${currentFile.backendFilename}?t=${Date.now()}`;
      const preserved = await reloadPdfPreservingMarkups(backendUrl, allFileMarkups);
      
      if (!preserved) {
        // Fallback: old behavior (clear + re-parse)
        setMarkups(prev => prev.filter(m => m.filename !== currentFileIdentifier));
        setHasLoadedAnnotations(false);
        setUnsavedMarkupFiles(prev => {
          const next = new Set(prev);
          next.delete(currentFileIdentifier);
          return next;
        });
        setDeletedPdfAnnotations(prev => {
          const next = new Map(prev);
          next.delete(currentFileIdentifier);
          return next;
        });
        
        if (pdfUrl) {
          const pdfResponse = await fetch(backendUrl);
          if (pdfResponse.ok) {
            const pdfBlob = await pdfResponse.blob();
            const freshUrl = URL.createObjectURL(pdfBlob);
            const pdf = await window.pdfjsLib.getDocument(freshUrl).promise;
            setPdfDoc(pdf);
            setNumPages(pdf.numPages);
          }
        }
      }

      showSaveNotif('success', 'Saved successfully');

    } catch (error) {
      console.error('Error saving to original:', error);
      showSaveNotif('error', error.message);
    } finally {
      setIsSavingMarkups(false);
      savingRef.current = false;
    }
  }, [
    currentFile, currentFileIdentifier, markups, canvasSize, pdfDoc, pdfUrl,
    deletedPdfAnnotations, clearSavedState, reloadPdfPreservingMarkups, showSaveNotif,
    setMarkups, setPdfDoc, setNumPages, setIsSavingMarkups,
    setUnsavedMarkupFiles, setDeletedPdfAnnotations, setHasLoadedAnnotations,
  ]);


  // ─── Register save/download handlers with parent ─────────────────────
  // Use saveInPlace (same as lock button) for sidebar save
  const saveInPlaceRef = useRef(() => saveMarkupsToPdf(false, true));
  const downloadHandlerRef = useRef(downloadPdfWithMarkups);
  const hasRegisteredHandlers = useRef(false);

  // Keep refs updated with latest function references
  saveInPlaceRef.current = () => saveMarkupsToPdf(false, true);
  downloadHandlerRef.current = downloadPdfWithMarkups;

  useEffect(() => {
    // Only register once to avoid infinite loops
    if (!hasRegisteredHandlers.current) {
      hasRegisteredHandlers.current = true;
      if (onRegisterSaveHandler) {
        onRegisterSaveHandler(() => saveInPlaceRef.current());
      }
      if (onRegisterDownloadHandler) {
        onRegisterDownloadHandler(() => downloadHandlerRef.current());
      }
    }
  }, [onRegisterSaveHandler, onRegisterDownloadHandler]);


  // ─── Return public API ───────────────────────────────────────────────
  return {
    saveMarkupsToPdf,
    saveMarkupsClientSide,
    downloadPdfWithMarkups,
    downloadFlattenedPdf,
    saveToOriginalFile,
    ensureFileOnBackend,
    getEffectiveBackendFilename,
  };
}
