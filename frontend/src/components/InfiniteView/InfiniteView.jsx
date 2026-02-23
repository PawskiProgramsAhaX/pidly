import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { getObjectsFromBackend, saveObjectsToBackend, getRegionsFromBackend } from '../../utils/storage';
import { BACKEND_URL } from '../../utils/config';
import DocumentsPanel from './Panels/DocumentsPanel';
import ObjectSearchPanel from './Panels/ObjectSearchPanel';
import ViewOptionsPanel from './Panels/ViewOptionsPanel';
import ZoomSettingsDialog, { loadZoomSettings, saveZoomSettings } from './Dialogs/ZoomSettingsDialog';
import CanvasToolbar from './Toolbars/CanvasToolbar';
import InfiniteHeaderToolbar from './Toolbars/InfiniteHeaderToolbar';
import InfiniteMarkupToolbar from './Toolbars/InfiniteMarkupToolbar';
import ObjectDetailDialog from './Dialogs/ObjectDetailDialog';
import MultiDeleteDialog from './Dialogs/MultiDeleteDialog';
import BatchAddDialog from './Dialogs/BatchAddDialog';
import LoadBatchDialog from './Dialogs/LoadBatchDialog';
import InfiniteSymbolsPanel from './Panels/InfiniteSymbolsPanel';
import InfiniteMarkupHistoryPanel from './Panels/InfiniteMarkupHistoryPanel';
import InfiniteViewsPanel from './Panels/InfiniteViewsPanel';
import './InfiniteView.css';
import useInfiniteMarkups from './Hooks/useInfiniteMarkups';
import { renderMarkupShape } from '../shared/renderMarkupShape';
import { renderSelectionHandles } from '../shared/renderSelectionHandles';

// Delete annotations from PDF bytes using pdf-lib
async function deleteAnnotationsFromPdf(pdfArrayBuffer, annotationIdsToDelete) {
  if (!annotationIdsToDelete || annotationIdsToDelete.size === 0) {
    return null;
  }
  
  try {
    const { PDFDocument, PDFName, PDFArray, PDFRef } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(pdfArrayBuffer, { ignoreEncryption: true });
    
    const pages = pdfDoc.getPages();
    let deletedCount = 0;
    
    // Extract the reference numbers from our annotation IDs (e.g., "pdf_text_145R" -> "145")
    const refNumbersToDelete = new Set();
    for (const id of annotationIdsToDelete) {
      const match = id.match(/_(\d+)R/);
      if (match) {
        refNumbersToDelete.add(parseInt(match[1], 10));
      }
    }
    
    console.log('Deleting annotations with ref numbers:', [...refNumbersToDelete]);
    
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      const annotsRef = page.node.get(PDFName.of('Annots'));
      
      if (!annotsRef) continue;
      
      let annots = annotsRef;
      if (annotsRef instanceof PDFRef) {
        annots = pdfDoc.context.lookup(annotsRef);
      }
      
      if (!(annots instanceof PDFArray)) continue;
      
      const newAnnots = [];
      for (let i = 0; i < annots.size(); i++) {
        const annotRef = annots.get(i);
        let shouldDelete = false;
        
        if (annotRef instanceof PDFRef) {
          const objNum = annotRef.objectNumber;
          if (refNumbersToDelete.has(objNum)) {
            shouldDelete = true;
            deletedCount++;
            console.log('Deleting annotation with object number:', objNum);
          }
        }
        
        if (!shouldDelete) {
          newAnnots.push(annotRef);
        }
      }
      
      if (newAnnots.length !== annots.size()) {
        if (newAnnots.length === 0) {
          page.node.delete(PDFName.of('Annots'));
        } else {
          const newAnnotsArray = pdfDoc.context.obj(newAnnots);
          page.node.set(PDFName.of('Annots'), newAnnotsArray);
        }
      }
    }
    
    if (deletedCount === 0) {
      console.log('No annotations matched for deletion');
      return null;
    }
    
    console.log(`Deleted ${deletedCount} annotations from PDF`);
    const modifiedPdfBytes = await pdfDoc.save();
    return modifiedPdfBytes;
    
  } catch (error) {
    console.error('Error deleting annotations from PDF:', error);
    return null;
  }
}

// Save annotations to PDF via backend API
async function saveSlotAnnotationsToPdf(slot, annotations, ownedIds, canvasWidth, canvasHeight) {
  try {
    // Log all incoming annotations
    console.log('=== ALL INCOMING ANNOTATIONS ===');
    annotations.forEach(a => {
      console.log({
        id: a.id,
        type: a.type,
        fromPdf: a.fromPdf,
        text: a.text,
        x1: a.x1,
        y1: a.y1,
        x2: a.x2,
        y2: a.y2
      });
    });
    
    // Separate into categories:
    // 1. New annotations (not from PDF) - add these
    // 2. Owned PDF annotations - these were modified, need to be re-added
    const newAnnotations = annotations.filter(a => !a.fromPdf);
    const ownedAnnotations = annotations.filter(a => a.fromPdf && ownedIds.has(a.id));
    
    // IDs of annotations we've taken ownership of (need to be removed from PDF)
    const annotationsToRemove = [...ownedIds].map(id => {
      // Extract the reference number from the ID format: pdf_type_123R
      const match = id.match(/_(\d+)R$/);
      return match ? match[1] : null;
    }).filter(Boolean);
    
    const rawMarkups = [...newAnnotations, ...ownedAnnotations];
    
    if (rawMarkups.length === 0) {
      console.log('No annotations to save');
      return { success: true };
    }
    
    // Convert InfiniteView annotations (pixel coords) to PDFViewerArea format (normalized 0-1 coords)
    const markupsToSave = rawMarkups.map(ann => {
      // Normalize coordinates from pixels to 0-1 range
      const normalizeX = (x) => x / canvasWidth;
      const normalizeY = (y) => y / canvasHeight;
      
      // Base properties common to all types
      const baseMarkup = {
        id: ann.id,
        type: ann.type,
        page: (slot.page || 1) - 1, // Convert to 0-indexed page
        filename: slot.backendFilename,
        color: ann.color || '#ff0000',
        strokeWidth: ann.strokeWidth || 2,
        opacity: ann.opacity || 1,
        strokeOpacity: ann.strokeOpacity || 1,
        fillColor: ann.fillColor || 'none',
        fillOpacity: ann.fillOpacity || 0.3,
        lineStyle: ann.lineStyle || 'solid',
      };
      
      // Handle different annotation types
      if (ann.type === 'pen' || ann.type === 'highlighter') {
        // Pen/highlighter use points array
        const normalizedPoints = (ann.points || []).map(p => ({
          x: normalizeX(p.x),
          y: normalizeY(p.y)
        }));
        return {
          ...baseMarkup,
          points: normalizedPoints,
          // Add bounding box for compatibility
          startX: normalizedPoints.length > 0 ? Math.min(...normalizedPoints.map(p => p.x)) : 0,
          startY: normalizedPoints.length > 0 ? Math.min(...normalizedPoints.map(p => p.y)) : 0,
          endX: normalizedPoints.length > 0 ? Math.max(...normalizedPoints.map(p => p.x)) : 0,
          endY: normalizedPoints.length > 0 ? Math.max(...normalizedPoints.map(p => p.y)) : 0,
        };
      } else if (ann.type === 'polyline' || ann.type === 'polylineArrow' || ann.type === 'cloudPolyline') {
        // Polyline types use points array
        const normalizedPoints = (ann.points || []).map(p => ({
          x: normalizeX(p.x),
          y: normalizeY(p.y)
        }));
        return {
          ...baseMarkup,
          points: normalizedPoints,
          closed: ann.closed || false,
          arrowHeadSize: ann.arrowHeadSize || 12,
          arcSize: ann.arcSize || ann.cloudArcSize || 15,
          inverted: ann.inverted || false,
          // Bounding box
          startX: normalizedPoints.length > 0 ? Math.min(...normalizedPoints.map(p => p.x)) : 0,
          startY: normalizedPoints.length > 0 ? Math.min(...normalizedPoints.map(p => p.y)) : 0,
          endX: normalizedPoints.length > 0 ? Math.max(...normalizedPoints.map(p => p.x)) : 0,
          endY: normalizedPoints.length > 0 ? Math.max(...normalizedPoints.map(p => p.y)) : 0,
        };
      } else if (ann.type === 'arrow' || ann.type === 'line') {
        return {
          ...baseMarkup,
          startX: normalizeX(ann.x1),
          startY: normalizeY(ann.y1),
          endX: normalizeX(ann.x2),
          endY: normalizeY(ann.y2),
          arrowHeadSize: ann.arrowHeadSize || 12,
        };
      } else if (ann.type === 'arc') {
        return {
          ...baseMarkup,
          startX: normalizeX(ann.x1),
          startY: normalizeY(ann.y1),
          endX: normalizeX(ann.x2),
          endY: normalizeY(ann.y2),
          startAngle: ann.startAngle || 0,
          endAngle: ann.endAngle || Math.PI,
        };
      } else if (ann.type === 'text') {
        const textContent = ann.text || '';
        console.log('=== TEXT ANNOTATION DEBUG ===', {
          id: ann.id,
          text: textContent,
          textLength: textContent.length,
          hasContent: textContent.length > 0,
          x1: ann.x1,
          y1: ann.y1,
          x2: ann.x2,
          y2: ann.y2,
          width: Math.abs(ann.x2 - ann.x1),
          height: Math.abs(ann.y2 - ann.y1),
          color: ann.color,
          textColor: ann.textColor,
          borderColor: ann.borderColor,
          fillColor: ann.fillColor,
          fontSize: ann.fontSize,
          textAlign: ann.textAlign,
          canvasWidth,
          canvasHeight
        });
        
        // Skip text boxes with no content (server will fail on empty text)
        if (!textContent) {
          console.log('Skipping text annotation with no content:', ann.id);
          return null;
        }
        
        return {
          ...baseMarkup,
          startX: normalizeX(Math.min(ann.x1, ann.x2)),
          startY: normalizeY(Math.min(ann.y1, ann.y2)),
          endX: normalizeX(Math.max(ann.x1, ann.x2)),
          endY: normalizeY(Math.max(ann.y1, ann.y2)),
          text: textContent,
          fontSize: ann.fontSize || 14,
          fontFamily: ann.fontFamily || 'Arial',
          textAlign: ann.textAlign || 'left',
          textColor: ann.textColor || ann.color || '#000000',
          borderColor: ann.borderColor || ann.color || '#ff0000',
        };
      } else if (ann.type === 'cloud') {
        // Rectangle cloud
        return {
          ...baseMarkup,
          startX: normalizeX(Math.min(ann.x1, ann.x2)),
          startY: normalizeY(Math.min(ann.y1, ann.y2)),
          endX: normalizeX(Math.max(ann.x1, ann.x2)),
          endY: normalizeY(Math.max(ann.y1, ann.y2)),
          arcSize: ann.arcSize || ann.cloudArcSize || 15,
          cloudIntensity: ann.cloudIntensity || 1,
          inverted: ann.inverted || false,
        };
      } else if (ann.type === 'image') {
        return {
          ...baseMarkup,
          type: 'image',
          image: ann.image,
          startX: normalizeX(Math.min(ann.x1, ann.x2)),
          startY: normalizeY(Math.min(ann.y1, ann.y2)),
          endX: normalizeX(Math.max(ann.x1, ann.x2)),
          endY: normalizeY(Math.max(ann.y1, ann.y2)),
          aspectRatio: ann.aspectRatio || 1,
        };
      } else {
        return {
          ...baseMarkup,
          startX: normalizeX(Math.min(ann.x1, ann.x2)),
          startY: normalizeY(Math.min(ann.y1, ann.y2)),
          endX: normalizeX(Math.max(ann.x1, ann.x2)),
          endY: normalizeY(Math.max(ann.y1, ann.y2)),
          text: ann.text || '',
          fontSize: ann.fontSize || 14,
          textColor: ann.textColor || '#000000',
          textAlign: ann.textAlign || 'center',
        };
      }
    }).filter(Boolean); // Filter out null values (empty text annotations)
    
    console.log('=== INFINITEVIEW SAVE DEBUG ===');
    console.log('Saving annotations:', {
      filename: slot.backendFilename,
      page: slot.page,
      newCount: newAnnotations.length,
      ownedCount: ownedAnnotations.length,
      annotationsToRemove,
      canvasSize: { width: canvasWidth, height: canvasHeight }
    });
    
    // Log text annotations specifically
    const textMarkups = markupsToSave.filter(m => m.type === 'text');
    if (textMarkups.length > 0) {
      console.log('=== TEXT ANNOTATIONS BEING SAVED ===');
      textMarkups.forEach(m => {
        console.log({
          id: m.id,
          type: m.type,
          text: m.text,
          textLength: m.text?.length,
          startX: m.startX,
          startY: m.startY,
          endX: m.endX,
          endY: m.endY,
          fontSize: m.fontSize,
          textColor: m.textColor,
          color: m.color,
          borderColor: m.borderColor,
          fillColor: m.fillColor
        });
      });
    }
    
    // Also log raw annotations before conversion
    const rawTextAnnotations = rawMarkups.filter(a => a.type === 'text');
    if (rawTextAnnotations.length > 0) {
      console.log('=== RAW TEXT ANNOTATIONS (before conversion) ===');
      rawTextAnnotations.forEach(a => {
        console.log({
          id: a.id,
          type: a.type,
          text: a.text,
          textLength: a.text?.length,
          x1: a.x1,
          y1: a.y1,
          x2: a.x2,
          y2: a.y2,
          color: a.color,
          textColor: a.textColor
        });
      });
    }
    
    console.log('Converted markups:', markupsToSave.map(m => ({
      id: m.id,
      type: m.type,
      text: m.type === 'text' ? m.text : undefined,
      startX: m.startX?.toFixed(3),
      startY: m.startY?.toFixed(3),
      endX: m.endX?.toFixed(3),
      endY: m.endY?.toFixed(3),
      pointsCount: m.points?.length
    })));

    const response = await fetch(`${BACKEND_URL}/api/pdf/save-markups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pdfFilename: slot.backendFilename,
        markups: markupsToSave,
        annotationsToRemove,
        flatten: false,
        saveInPlace: true,
        canvasWidth,
        canvasHeight,
        sourceFolder: slot.sourceFolder || null
      })
    });

    const contentType = response.headers.get('content-type');
    
    if (!response.ok) {
      if (contentType && contentType.includes('application/json')) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.details || 'Failed to save annotations');
      }
      throw new Error(`Server error: ${response.status}`);
    }

    if (contentType && contentType.includes('application/json')) {
      const result = await response.json();
      if (result.success) {
        console.log('Saved annotations in place:', result);
        return { success: true };
      } else if (result.error) {
        throw new Error(result.error || 'Failed to save');
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Error saving annotations to PDF:', error);
    return { success: false, error: error.message };
  }
}

// Helper to parse color from PDF annotation
const parseColor = (colorArray) => {
  if (!colorArray || !Array.isArray(colorArray)) return null;
  if (colorArray.length === 3) {
    const [r, g, b] = colorArray.map(c => Math.round(c * 255));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  return null;
};

// Load annotations from a PDF page and convert to canvas pixel coordinates
// scale should match the scale used to render the PDF canvas (1.5)
const loadPdfAnnotations = async (pdfDoc, pageNum, slotId, scale = 1.5) => {
  try {
    const page = await pdfDoc.getPage(pageNum);
    const annotations = await page.getAnnotations();
    // Use the SAME scale as used for canvas rendering
    const viewport = page.getViewport({ scale, rotation: 0 });
    
    console.log('=== loadPdfAnnotations DEBUG ===');
    console.log('Page:', pageNum, 'Total annotations from PDF.js:', annotations.length);
    console.log('All annotation subtypes:', annotations.map(a => ({ subtype: a.subtype, id: a.id, hasContents: !!a.contents })));
    
    const loadedAnnotations = [];
    
    for (const annot of annotations) {
      // Skip non-markup annotations (links, widgets, popups, etc.)
      if (!['Square', 'Circle', 'Line', 'Ink', 'FreeText', 'Polygon', 'PolyLine'].includes(annot.subtype)) {
        continue;
      }
      
      const [x1, y1, x2, y2] = annot.rect;
      // Use viewport.convertToViewportPoint for correct coordinate conversion
      // This handles both scaling and Y-axis flip properly
      const [canvasX1, canvasY1] = viewport.convertToViewportPoint(x1, y2); // top-left
      const [canvasX2, canvasY2] = viewport.convertToViewportPoint(x2, y1); // bottom-right
      
      // Get colors
      const color = parseColor(annot.color) || '#ff0000';
      const fillColor = parseColor(annot.interiorColor) || 'none';
      
      // Get stroke width - also needs to be scaled
      let strokeWidth = 1;
      if (annot.borderStyle?.width !== undefined) {
        strokeWidth = annot.borderStyle.width * scale;
      } else if (annot.border && annot.border[2] !== undefined) {
        strokeWidth = annot.border[2] * scale;
      } else {
        strokeWidth = scale; // default 1pt scaled
      }
      
      // Get opacity
      const opacity = annot.opacity !== undefined ? annot.opacity : 1;
      
      const commonProps = {
        slotId,
        fromPdf: true,
        pdfAnnotId: annot.id,
        opacity,
        strokeOpacity: opacity,
        fillOpacity: opacity,
        // PDF metadata
        author: annot.titleObj?.str || annot.title || undefined,
        createdDate: annot.creationDate || undefined,
        modifiedDate: annot.modificationDate || undefined,
        pdfSubject: annot.subject || undefined,
        pdfSubtype: annot.subtype || undefined,
        annotationName: annot.annotationName || annot.fieldName || undefined,
        contents: annot.contents || undefined,
        software: annot.creatorName || undefined,
      };
      
      let markup = null;
      
      // Generate fallback ID using page number and coordinates
      const fallbackId = `${pageNum}_${Math.round(canvasX1)}_${Math.round(canvasY1)}`;
      
      if (annot.subtype === 'Square') {
        markup = {
          id: `pdf_rect_${annot.id || fallbackId}`,
          type: 'rectangle',
          x1: canvasX1,
          y1: canvasY1,
          x2: canvasX2,
          y2: canvasY2,
          color,
          fillColor,
          strokeWidth,
          ...commonProps
        };
      } else if (annot.subtype === 'Circle') {
        markup = {
          id: `pdf_circle_${annot.id || fallbackId}`,
          type: 'circle',
          x1: canvasX1,
          y1: canvasY1,
          x2: canvasX2,
          y2: canvasY2,
          color,
          fillColor,
          strokeWidth,
          ...commonProps
        };
      } else if (annot.subtype === 'Line') {
        const lineCoords = annot.lineCoordinates || [x1, y1, x2, y2];
        const lineEndings = annot.lineEndings || [];
        const hasArrowAtStart = lineEndings[0] && lineEndings[0] !== 'None' && lineEndings[0].includes('Arrow');
        const hasArrowAtEnd = lineEndings[1] && lineEndings[1] !== 'None' && lineEndings[1].includes('Arrow');
        const hasArrow = hasArrowAtStart || hasArrowAtEnd;
        
        // Convert line endpoints using viewport
        const [lineStartX, lineStartY] = viewport.convertToViewportPoint(lineCoords[0], lineCoords[1]);
        const [lineEndX, lineEndY] = viewport.convertToViewportPoint(lineCoords[2], lineCoords[3]);
        
        const lineType = hasArrow ? 'arrow' : 'line';
        markup = {
          id: `pdf_${lineType}_${annot.id || fallbackId}`,
          type: lineType,
          x1: lineStartX,
          y1: lineStartY,
          x2: lineEndX,
          y2: lineEndY,
          color,
          strokeWidth,
          hasArrowAtStart,
          hasArrowAtEnd,
          ...commonProps
        };
      } else if (annot.subtype === 'Ink') {
        const inkLists = annot.inkLists || (annot.vertices ? [annot.vertices] : null);
        if (inkLists) {
          let inkIndex = 0;
          for (const inkList of inkLists) {
            const points = [];
            if (Array.isArray(inkList) && typeof inkList[0] === 'number') {
              for (let i = 0; i < inkList.length; i += 2) {
                const [px, py] = viewport.convertToViewportPoint(inkList[i], inkList[i + 1]);
                points.push({ x: px, y: py });
              }
            } else if (Array.isArray(inkList)) {
              for (const pt of inkList) {
                if (pt && typeof pt.x === 'number') {
                  const [px, py] = viewport.convertToViewportPoint(pt.x, pt.y);
                  points.push({ x: px, y: py });
                }
              }
            }
            if (points.length > 1) {
              const isHighlighter = strokeWidth > 15 * scale || opacity < 1;
              loadedAnnotations.push({
                id: `pdf_ink_${annot.id || pageNum}_${inkIndex}`,
                type: isHighlighter ? 'highlighter' : 'pen',
                points,
                color,
                strokeWidth: isHighlighter ? strokeWidth : Math.min(strokeWidth, 5 * scale),
                opacity: isHighlighter && opacity === 1 ? 0.4 : opacity,
                ...commonProps
              });
              inkIndex++;
            }
          }
          continue;
        }
      } else if (annot.subtype === 'FreeText') {
        const textContent = annot.contents || annot.richText?.str || '';
        const fontSize = (annot.defaultAppearanceData?.fontSize || 12) * scale;
        
        console.log('=== Loading FreeText annotation ===', {
          id: annot.id,
          text: textContent,
          textLength: textContent.length,
          rect: annot.rect,
          canvasCoords: { x1: canvasX1, y1: canvasY1, x2: canvasX2, y2: canvasY2 },
          color,
          fontSize,
          defaultAppearanceData: annot.defaultAppearanceData
        });
        
        // Load text annotation even if text is empty (user may want to edit an empty box)
        markup = {
          id: `pdf_text_${annot.id || fallbackId}`,
          type: 'text',
          x1: canvasX1,
          y1: canvasY1,
          x2: canvasX2,
          y2: canvasY2,
          text: textContent,
          color,
          textColor: color, // Text color same as annotation color
          fontSize,
          fontFamily: 'Arial',
          textAlign: 'left',
          borderColor: color,
          fillColor: fillColor,
          ...commonProps
        };
      } else if (annot.subtype === 'Polygon' || annot.subtype === 'PolyLine') {
        const vertices = annot.vertices;
        if (vertices && vertices.length >= 4) {
          const points = [];
          for (let i = 0; i < vertices.length; i += 2) {
            const [px, py] = viewport.convertToViewportPoint(vertices[i], vertices[i + 1]);
            points.push({ x: px, y: py });
          }
          markup = {
            id: `pdf_poly_${annot.id || fallbackId}`,
            type: 'polyline',
            points,
            color,
            fillColor: annot.subtype === 'Polygon' ? fillColor : 'none',
            strokeWidth,
            closed: annot.subtype === 'Polygon',
            ...commonProps
          };
        }
      }
      
      if (markup) {
        loadedAnnotations.push(markup);
      }
    }
    
    console.log('=== loadPdfAnnotations RESULT ===');
    console.log('Loaded', loadedAnnotations.length, 'annotations');
    console.log('By type:', loadedAnnotations.reduce((acc, a) => {
      acc[a.type] = (acc[a.type] || 0) + 1;
      return acc;
    }, {}));
    console.log('Text annotations:', loadedAnnotations.filter(a => a.type === 'text').map(a => ({
      id: a.id,
      text: a.text,
      x1: a.x1,
      y1: a.y1,
      x2: a.x2,
      y2: a.y2
    })));
    
    return loadedAnnotations;
  } catch (error) {
    console.error('Error loading PDF annotations:', error);
    return [];
  }
};

export default function InfiniteView({
  initialFile,
  initialPage = 1,
  project,
  allFiles,
  onClose,
  onProjectUpdate,
  onRefresh,
  // Checkout system props
  checkedOutDocuments = {}, // { fileId: 'pdfviewer' | 'infiniteview' }
  onDocumentCheckout,       // (fileId, location) => void - called when unlocking
  onDocumentCheckin         // (fileId) => void - called when locking
}) {
  // Canvas state
  const containerRef = useRef(null);
  const [canvasPosition, setCanvasPosition] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.5); // Start at 50% zoom
  const [zoomSettings, setZoomSettings] = useState(() => loadZoomSettings());
  const [showZoomSettingsDialog, setShowZoomSettingsDialog] = useState(false);
  const zoomSettingsRef = useRef(zoomSettings);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  
  // View lock — prevents adding/removing documents, shapes, and moving slots
  const [viewLocked, setViewLocked] = useState(false);
  
  // PDF slots - each represents a loaded PDF at a position
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState({});
  const [filePageCounts, setFilePageCounts] = useState({}); // { [fileId]: numPages }
  
  // The "anchor" slot - the main/current PDF
  const [anchorSlotId, setAnchorSlotId] = useState(null);
  
  // Multi-select for moving multiple PDFs together
  const [selectedSlotIds, setSelectedSlotIds] = useState(new Set());
  
  // Multi-select for canvas shapes (used with box-select)
  const [selectedShapeIds, setSelectedShapeIds] = useState(new Set());
  
  // Drag box for zoom-to-area (Z tool) and box-select (V tool)
  const [dragBox, setDragBox] = useState(null); // { startX, startY, endX, endY, type: 'zoom' | 'select' } (screen coords)
  
  // Track which slot is being dragged
  const [draggingSlotId, setDraggingSlotId] = useState(null);
  
  // Right-click context menu state
  const [slotContextMenu, setSlotContextMenu] = useState(null); // { x, y, slot }
  
  // RAF-batched drag system — accumulates deltas and applies once per frame
  const dragAccumRef = useRef({ dx: 0, dy: 0, raf: null, ids: null });
  
  // Ref for selected shape IDs so flushDragAccum can access them without stale closure
  const selectedShapeIdsRef = useRef(new Set());
  useEffect(() => { selectedShapeIdsRef.current = selectedShapeIds; }, [selectedShapeIds]);
  
  const flushDragAccum = useCallback(() => {
    const acc = dragAccumRef.current;
    if (acc.dx === 0 && acc.dy === 0) { acc.raf = null; return; }
    const dx = acc.dx;
    const dy = acc.dy;
    const ids = acc.ids;
    acc.dx = 0;
    acc.dy = 0;
    acc.raf = null;
    setSlots(prev => prev.map(s => 
      ids.has(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s
    ));
    // Also move selected canvas shapes when multi-dragging
    const shapeIds = selectedShapeIdsRef.current;
    if (shapeIds.size > 0) {
      setCanvasShapes(prev => prev.map(s => 
        shapeIds.has(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s
      ));
    }
  }, []);

  const batchedMultiDrag = useCallback((deltaX, deltaY, idsToMove) => {
    const acc = dragAccumRef.current;
    acc.dx += deltaX;
    acc.dy += deltaY;
    acc.ids = idsToMove;
    if (!acc.raf) {
      acc.raf = requestAnimationFrame(flushDragAccum);
    }
  }, [flushDragAccum]);

  const batchedSingleDrag = useCallback((slotId, x, y) => {
    // Single slot: accumulate delta relative to current position
    const acc = dragAccumRef.current;
    acc.ids = new Set([slotId]);
    // For single, pass absolute coords - reset accum and set directly
    if (acc.raf) cancelAnimationFrame(acc.raf);
    acc.raf = requestAnimationFrame(() => {
      acc.raf = null;
      setSlots(prev => prev.map(s => 
        s.id === slotId ? { ...s, x, y } : s
      ));
    });
  }, []);
  
  // Track if initial load has happened
  const hasLoadedInitial = useRef(false);
  
  // Drag-and-drop from sidebar onto canvas
  const [isDragOverCanvas, setIsDragOverCanvas] = useState(false);
  const dragOverCountRef = useRef(0); // Counter to handle child enter/leave events
  
  // Search state
  const [showAddPdfSearch, setShowAddPdfSearch] = useState(true);
  const [addPdfSearchQuery, setAddPdfSearchQuery] = useState('');
  const [documentPanelTab, setDocumentPanelTab] = useState('all'); // 'all' or 'onCanvas'
  const [showObjectSearch, setShowObjectSearch] = useState(true);
  const [objectSearchQuery, setObjectSearchQuery] = useState('');
  const [highlightedObjectId, setHighlightedObjectId] = useState(null);
  
  // Hidden classes state (same as PDFViewerArea)
  const [hiddenClasses, setHiddenClasses] = useState(new Set());
  
  // Show/hide object tags - default is false (hidden)
  const [showObjectTags, setShowObjectTags] = useState(false);
  const [showObjects, setShowObjects] = useState(true);
  const [showLinks, setShowLinks] = useState(true);
  
  // Selected object for editing
  const [selectedObject, setSelectedObject] = useState(null);
  const [showObjectDialog, setShowObjectDialog] = useState(false);
  const [objectThumbnail, setObjectThumbnail] = useState(null);
  
  // Animation state - when true, canvas has transition
  const [isAnimating, setIsAnimating] = useState(false);
  const canvasRef = useRef(null);
  
  // Mouse tracking for crosshairs/coordinates
  const [mousePos, setMousePos] = useState(null);
  
  // Delete confirmation for multi-select
  const [showMultiDeleteConfirm, setShowMultiDeleteConfirm] = useState(false);
  const [showBatchAdd, setShowBatchAdd] = useState(false);
  const [showLoadBatchDialog, setShowLoadBatchDialog] = useState(false);
  const [loadBatchTarget, setLoadBatchTarget] = useState(null);
  
  // Refresh key - increment to force re-render of objects/hotspots
  const [refreshKey, setRefreshKey] = useState(0);
  
  // Detected objects loaded from backend
  const [detectedObjects, setDetectedObjects] = useState([]);
  const hasLoadedObjectsRef = useRef(false);
  
  // Drawn regions loaded from backend
  const [drawnRegions, setDrawnRegions] = useState([]);
  
  // Debounced search query for performance
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  
  // View Options sidebar state
  const [showViewOptions, setShowViewOptions] = useState(false);
  
  // ═══════════════════════════════════════════════════════════════════════
  // MARKUP STATE — from shared useInfiniteMarkups hook
  // All markup state, styling, tool defaults, history, CRUD, symbols, and
  // coordinate helpers are provided by this single hook — eliminating the
  // ~30 inline useState declarations that previously drifted from PDFViewer.
  // ═══════════════════════════════════════════════════════════════════════
  const markups = useInfiniteMarkups();
  const {
    markupMode, setMarkupMode,
    showMarkupsToolbar, setShowMarkupsToolbar,
    slotAnnotations, setSlotAnnotations,
    slotAnnotationsRef,
    currentMarkup: currentDrawing, setCurrentMarkup: setCurrentDrawing,
    isDrawingMarkup, setIsDrawingMarkup,
    selectedMarkup: selectedAnnotation, setSelectedMarkup: setSelectedAnnotation,
    selectedMarkupRef,
    isDragging: isDraggingAnnotation, setIsDragging: setIsDraggingAnnotation,
    isResizing: isResizingAnnotation, setIsResizing: setIsResizingAnnotation,
    resizeHandle, setResizeHandle,
    dragStart: annotationDragStart, setDragStart: setAnnotationDragStart,
    editingTextMarkupId: editingTextId, setEditingTextMarkupId: setEditingTextId,
    textEditValue: editingTextValue, setTextEditValue: setEditingTextValue,
    textInputRef: markupTextInputRef,
    history: annotationHistory, future: annotationFuture,
    saveHistory: saveAnnotationHistory,
    undo: undoAnnotation, redo: redoAnnotation,
    addMarkupWithHistory: addAnnotationWithHistory,
    deleteMarkupWithHistory: deleteAnnotationWithHistory,
    updateMarkupWithHistory: updateAnnotationWithHistory,
    updateMarkupLive,
    moveMarkup, resizeMarkup,
    clipboard, copyMarkups, pasteMarkups,
    getMarkupBounds, getMarkupBoundsPixel,
    // Styling
    markupColor, setMarkupColor,
    markupStrokeWidth, setMarkupStrokeWidth,
    markupOpacity, setMarkupOpacity,
    markupFillColor, setMarkupFillColor,
    markupFillOpacity, setMarkupFillOpacity,
    markupStrokeOpacity, setMarkupStrokeOpacity,
    markupArrowHeadSize, setMarkupArrowHeadSize,
    markupLineStyle, setMarkupLineStyle,
    markupFontSize, setMarkupFontSize,
    markupFontFamily, setMarkupFontFamily,
    markupTextAlign, setMarkupTextAlign,
    markupVerticalAlign, setMarkupVerticalAlign,
    markupTextPadding, setMarkupTextPadding,
    markupLineSpacing, setMarkupLineSpacing,
    markupBorderColor, setMarkupBorderColor,
    markupBorderWidth, setMarkupBorderWidth,
    markupBorderStyle, setMarkupBorderStyle,
    markupBorderOpacity, setMarkupBorderOpacity,
    markupCloudArcSize, setMarkupCloudArcSize,
    markupCloudIntensity, setMarkupCloudIntensity,
    markupCloudInverted, setMarkupCloudInverted,
    markupCloudBulge, setMarkupCloudBulge,
    penHighlighterUIMode, setPenHighlighterUIMode,
    getCurrentStyle, applyMarkupProperties,
    loadToolDefaults, saveToolDefaults,
    getLineDashArray,
    // Symbols
    savedSymbols, setSavedSymbols,
    pendingPlacement, setPendingPlacement,
    symbolSearchQuery, setSymbolSearchQuery,
    symbolsViewMode, setSymbolsViewMode,
    defaultSignatureId, setDefaultSignatureId,
    placeSymbol,
    // Panels
    showSymbolsPanel, setShowSymbolsPanel,
    showMarkupHistoryPanel, setShowMarkupHistoryPanel,
    showViewsPanel, setShowViewsPanel,
    // Slot locking
    unlockedSlots, setUnlockedSlots,
    ownedAnnotationIds, setOwnedAnnotationIds,
    // Conversion helpers
    pixelToNorm, normToPixel,
  } = markups;
  const drawingStartRef = useRef(null);
  
  // Markup history (undo/redo)
  // MAX_ANNOTATION_HISTORY now defined in useInfiniteMarkups hook
  // History + slotAnnotationsRef now provided by useInfiniteMarkups hook
  
  // Symbols state
  // Symbols and panels now provided by useInfiniteMarkups hook
  
  // Canvas shapes - view-level decorations (not annotations, not saved on PDFs)
  const [canvasShapes, setCanvasShapes] = useState([]);
  const [selectedCanvasShapeId, setSelectedCanvasShapeId] = useState(null);
  const [draggingShapeId, setDraggingShapeId] = useState(null);
  const [resizingShapeId, setResizingShapeId] = useState(null);
  const [shapeInteractionStart, setShapeInteractionStart] = useState(null); // { x, y, origX, origY, origW, origH, handle }
  const [editingShapeTextId, setEditingShapeTextId] = useState(null);
  
  // Polyline drawing mode
  const [drawingPolylinePoints, setDrawingPolylinePoints] = useState(null); // null = not drawing, [] = drawing
  const [drawingPolylineHover, setDrawingPolylineHover] = useState(null); // { x, y } canvas coords
  
  // Crosshair tracking for drawing modes
  const [crosshairPos, setCrosshairPos] = useState(null); // { x, y } screen coords relative to container
  
  // pendingPlacement, symbolSearchQuery, etc. now from useInfiniteMarkups hook
  
  // Persist symbols to localStorage
  // savedSymbols persistence now handled by useInfiniteMarkups hook
  
  // ─── History/CRUD functions provided by useInfiniteMarkups hook ──────────
  // saveAnnotationHistory, undoAnnotation, redoAnnotation,
  // addAnnotationWithHistory, deleteAnnotationWithHistory, updateAnnotationWithHistory
  // are all destructured from the hook above.
  
  // ─── Symbol placement ────────────────────────────────────────────────────
  const placeSymbolOnSlot = useCallback((symbol, slotId, pixelX, pixelY, slotCanvasSize) => {
    if (!symbol) return;
    saveAnnotationHistory();
    
    const cw = slotCanvasSize?.width || 800;
    const ch = slotCanvasSize?.height || 1000;
    
    if (symbol.image) {
      // Image symbol — symbol.originalWidth/Height are in 0-1 normalized coords, convert to pixels
      const normW = symbol.originalWidth || 0.1;
      const normH = symbol.originalHeight || (0.1 / (symbol.aspectRatio || 1));
      const pxW = normW * cw;
      const pxH = normH * ch;
      const x1 = pixelX - pxW / 2;
      const y1 = pixelY - pxH / 2;
      
      const imageAnnotation = {
        id: `image_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'image',
        image: symbol.image,
        x1, y1,
        x2: x1 + pxW,
        y2: y1 + pxH,
        aspectRatio: symbol.aspectRatio || (normW / normH),
        slotId,
      };
      setSlotAnnotations(prev => ({
        ...prev,
        [slotId]: [...(prev[slotId] || []), imageAnnotation]
      }));
    } else if (symbol.markups) {
      // Vector symbol (group of markups) — normalized coords → pixels
      const normW = symbol.originalWidth || 0.1;
      const normH = symbol.originalHeight || (0.1 / (symbol.aspectRatio || 1));
      const pxW = normW * cw;
      const pxH = normH * ch;
      const originX = pixelX - pxW / 2;
      const originY = pixelY - pxH / 2;
      
      const newAnnotations = symbol.markups.map(m => {
        const ann = {
          ...m,
          id: `${m.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          slotId,
        };
        
        if (m.type === 'pen' || m.type === 'highlighter' || m.type === 'polyline' || m.type === 'polylineArrow' || m.type === 'cloudPolyline' || m.type === 'polygon') {
          ann.points = m.points.map(p => ({
            x: originX + p.x * pxW,
            y: originY + p.y * pxH
          }));
        } else if (m.startX !== undefined) {
          ann.startX = originX + m.startX * pxW;
          ann.startY = originY + m.startY * pxH;
          ann.endX = originX + m.endX * pxW;
          ann.endY = originY + m.endY * pxH;
        } else if (m.x1 !== undefined) {
          ann.x1 = originX + m.x1 * pxW;
          ann.y1 = originY + m.y1 * pxH;
          ann.x2 = originX + m.x2 * pxW;
          ann.y2 = originY + m.y2 * pxH;
        }
        return ann;
      });
      
      setSlotAnnotations(prev => ({
        ...prev,
        [slotId]: [...(prev[slotId] || []), ...newAnnotations]
      }));
    }
    setPendingPlacement(null);
  }, [saveAnnotationHistory]);
  
  // Track which slots are unlocked for markup editing
  // unlockedSlots now from useInfiniteMarkups hook
  // Panel auto-close when all slots locked is handled by the hook
  
  // Track which PDF annotations we've "taken over" (clicked to edit)
  // Until owned, PDF annotations are rendered by PDF.js, not our SVG
  // ownedAnnotationIds now from useInfiniteMarkups hook
  
  // Take ownership of a PDF annotation - delete from PDF bytes and reload
  const takeOwnershipOfAnnotation = useCallback(async (slotId, annotationId) => {
    // Check if already owned
    if (ownedAnnotationIds[slotId]?.has(annotationId)) {
      return;
    }
    
    // Find the slot
    const slot = slots.find(s => s.id === slotId);
    if (!slot || !slot.pdfBytes) {
      console.warn('No slot or PDF bytes for ownership transfer');
      // Still mark as owned even without PDF modification
      setOwnedAnnotationIds(prev => {
        const slotOwned = new Set(prev[slotId] || []);
        slotOwned.add(annotationId);
        return { ...prev, [slotId]: slotOwned };
      });
      return;
    }
    
    // Add to owned set immediately for UI responsiveness
    const newOwnedIds = new Set(ownedAnnotationIds[slotId] || []);
    newOwnedIds.add(annotationId);
    setOwnedAnnotationIds(prev => ({ ...prev, [slotId]: newOwnedIds }));
    
    // Delete annotation from PDF
    const modifiedBytes = await deleteAnnotationsFromPdf(slot.pdfBytes, newOwnedIds);
    
    if (modifiedBytes) {
      try {
        // Revoke old URL
        if (slot.blobUrl) {
          URL.revokeObjectURL(slot.blobUrl);
        }
        
        // Create new blob and URL
        const newBlob = new Blob([modifiedBytes], { type: 'application/pdf' });
        const newUrl = URL.createObjectURL(newBlob);
        
        // Load the modified PDF
        const newPdfDoc = await window.pdfjsLib.getDocument({ data: modifiedBytes.slice(0) }).promise;
        
        // Update the slot with new PDF
        setSlots(prev => prev.map(s => {
          if (s.id === slotId) {
            return {
              ...s,
              pdfDoc: newPdfDoc,
              blobUrl: newUrl,
              pdfBytes: modifiedBytes,
              // Increment a render key to force re-render
              renderKey: (s.renderKey || 0) + 1
            };
          }
          return s;
        }));
        
        console.log('PDF reloaded after taking ownership of annotation:', annotationId);
      } catch (error) {
        console.error('Error reloading PDF after annotation deletion:', error);
      }
    }
  }, [slots, ownedAnnotationIds]);
  
  // Markup properties
  // Markup styling, pen/highlighter UI mode — all from useInfiniteMarkups hook
  
  // Custom pen cursor — tip at lower-left as hotspot, handle pointing upper-right like holding a pen
  const penCursor = useMemo(() => {
    const size = Math.max(48, Math.min(128, markupStrokeWidth * 4 + 48));
    const tipSize = Math.max(3, Math.min(markupStrokeWidth, 24));
    // Pen drawn pointing down, rotate 50° so tip goes lower-left, handle upper-right
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g transform="rotate(50, ${size/2}, ${size/2})"><rect x="${size * 0.42}" y="${size * 0.10}" width="${size * 0.16}" height="${size * 0.45}" fill="#555" rx="2"/><rect x="${size * 0.40}" y="${size * 0.40}" width="${size * 0.20}" height="${size * 0.15}" fill="#444" rx="1"/><polygon points="${size * 0.42},${size * 0.55} ${size * 0.58},${size * 0.55} ${size * 0.54},${size * 0.72} ${size * 0.46},${size * 0.72}" fill="#888"/><polygon points="${size * 0.46},${size * 0.72} ${size * 0.54},${size * 0.72} ${size * 0.50},${size * 0.84}" fill="${markupColor}"/><circle cx="${size * 0.50}" cy="${size * 0.84}" r="${tipSize * 0.5}" fill="${markupColor}"/></g></svg>`;
    const encoded = encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22');
    // After 50° rotation, tip dot lands at lower-left
    const hotspotX = Math.round(size * 0.24);
    const hotspotY = Math.round(size * 0.72);
    return `url("data:image/svg+xml,${encoded}") ${hotspotX} ${hotspotY}, crosshair`;
  }, [markupStrokeWidth, markupColor]);
  
  // Custom highlighter cursor — tilted, chisel tip at cursor point
  const highlighterCursor = useMemo(() => {
    const size = Math.max(48, Math.min(128, markupStrokeWidth * 4 + 48));
    const tipWidth = Math.max(10, Math.min(markupStrokeWidth * 1.0, 36));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g transform="rotate(45, ${size/2}, ${size/2})"><rect x="${size * 0.35}" y="${size * 0.08}" width="${size * 0.30}" height="${size * 0.50}" fill="#333" rx="3"/><rect x="${size * 0.30}" y="${size * 0.42}" width="${size * 0.40}" height="${size * 0.15}" fill="${markupColor}" opacity="0.8" rx="2"/><rect x="${size/2 - tipWidth/2}" y="${size * 0.57}" width="${tipWidth}" height="${size * 0.22}" fill="${markupColor}" opacity="0.9"/><rect x="${size/2 - tipWidth/2}" y="${size * 0.77}" width="${tipWidth}" height="${size * 0.05}" fill="${markupColor}" opacity="0.5"/></g></svg>`;
    const encoded = encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22');
    // Chisel tip at (0.50, 0.80) rotated 45° CW around center → (0.71, 0.71)
    // Chisel tip at (0.50, 0.82) rotated 45° CW around center → (0.27, 0.73)
    const hotspotX = Math.round(size * 0.27);
    const hotspotY = Math.round(size * 0.73);
    return `url("data:image/svg+xml,${encoded}") ${hotspotX} ${hotspotY}, crosshair`;
  }, [markupStrokeWidth, markupColor]);
  
  // Get cursor for current markup mode
  const getMarkupCursor = () => {
    if (markupMode === 'pen') return penCursor;
    if (markupMode === 'highlighter') return highlighterCursor;
    return 'crosshair';
  };
  
  // TOOL_DEFAULTS, loadToolDefaults, saveToolDefaults — all from useInfiniteMarkups hook
  // The hook automatically applies defaults when markupMode changes.
  
  // Crop region state - normalized coordinates (0-1)
  const [cropRegion, setCropRegion] = useState(null); // { x, y, width, height }
  const [cropEnabled, setCropEnabled] = useState(false);
  const [isDrawingCrop, setIsDrawingCrop] = useState(false);
  
  // Background style state - persist to localStorage
  const [backgroundStyle, setBackgroundStyle] = useState(() => {
    try {
      const saved = localStorage.getItem('infiniteView_backgroundStyle');
      // Migrate old preset values to new system
      if (saved && !['grid', 'stars', 'blank'].includes(saved)) return 'grid';
      return saved || 'grid';
    } catch {
      return 'grid';
    }
  });
  
  // Per-mode background colors - persist to localStorage
  const [bgColors, setBgColors] = useState(() => {
    try {
      const saved = localStorage.getItem('infiniteView_bgColors');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { grid: '#12121f', stars: '#000000', blank: '#1a1a2e' };
  });
  
  // Show/hide borders and shadows on PDFs - persist to localStorage
  const [showShadows, setShowShadows] = useState(() => {
    try {
      const saved = localStorage.getItem('infiniteView_showShadows');
      return saved === 'true'; // default false
    } catch {
      return false;
    }
  });
  
  // Persist background style + colors to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('infiniteView_backgroundStyle', backgroundStyle);
      localStorage.setItem('infiniteView_bgColors', JSON.stringify(bgColors));
    } catch (e) {
      console.error('Error saving background style:', e);
    }
  }, [backgroundStyle, bgColors]);
  
  // Persist showShadows to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('infiniteView_showShadows', showShadows.toString());
    } catch (e) {
      console.error('Error saving showShadows:', e);
    }
  }, [showShadows]);
  
  // Keyboard event handler for Delete key
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger if typing in an input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Priority 1: Delete selected annotation
        if (selectedAnnotation) {
          e.preventDefault();
          deleteAnnotationWithHistory(selectedAnnotation.slotId, selectedAnnotation.id);
          setSelectedAnnotation(null);
          return;
        }
        // Priority 2: Delete selected slots
        if (selectedSlotIds.size > 0) {
          e.preventDefault();
          setShowMultiDeleteConfirm(true);
          return;
        }
      }
      // Escape to clear selection, cancel crop drawing, or deselect markup tool
      if (e.key === 'Escape') {
        // First close text editing if active (and save it)
        if (editingTextId) {
          // Text will be saved by the blur handler
          setEditingTextId(null);
          setEditingTextValue('');
          return;
        }
        if (pendingPlacement) {
          setPendingPlacement(null);
          return;
        }
        if (markupMode) {
          setMarkupMode(null);
          setSelectedAnnotation(null);
        } else if (isDrawingCrop || currentTool === 'crop') {
          setIsDrawingCrop(false);
          setCurrentTool('select');
        } else if (selectedAnnotation) {
          setSelectedAnnotation(null);
        } else {
          setSelectedSlotIds(new Set());
          setSelectedShapeIds(new Set());
          setSelectedCanvasShapeId(null);
          setShowMultiDeleteConfirm(false);
        }
      }
      // Tool shortcuts (only when not in text input)
      // V = select, Shift+V = pan, M = move, Z = zoom
      // Use toLowerCase() to handle caps lock
      const key = e.key.toLowerCase();
      
      if (key === 'v' && !e.shiftKey) {
        e.preventDefault();
        setCurrentTool('select');
        setMarkupMode(null);
        setSelectedAnnotation(null);
      }
      if (key === 'v' && e.shiftKey) {
        e.preventDefault();
        setCurrentTool('pan');
        setMarkupMode(null);
      }
      if (key === 'm') {
        e.preventDefault();
        if (!viewLocked) {
          setCurrentTool('move');
          setMarkupMode(null);
        }
      }
      if (key === 'z') {
        e.preventDefault();
        setCurrentTool('zoom');
        setMarkupMode(null);
      }
      // Ctrl+Z = undo, Ctrl+Y / Ctrl+Shift+Z = redo
      if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoAnnotation();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redoAnnotation();
        return;
      }
      
      // Markup tool shortcuts (only work when at least one slot is unlocked)
      const hasUnlockedSlot = unlockedSlots.size > 0;
      if (hasUnlockedSlot) {
        // H = highlighter
        if (key === 'h') {
          e.preventDefault();
          setMarkupMode(markupMode === 'highlighter' ? null : 'highlighter');
        }
        // P = pen
        if (key === 'p') {
          e.preventDefault();
          setMarkupMode(markupMode === 'pen' ? null : 'pen');
        }
        // a = arrow, Shift+A = polylineArrow
        if (key === 'a' && !e.shiftKey) {
          e.preventDefault();
          setMarkupMode(markupMode === 'arrow' ? null : 'arrow');
        }
        if (key === 'a' && e.shiftKey) {
          e.preventDefault();
          setMarkupMode(markupMode === 'polylineArrow' ? null : 'polylineArrow');
        }
        // l = line, Shift+L = polyline
        if (key === 'l' && !e.shiftKey) {
          e.preventDefault();
          setMarkupMode(markupMode === 'line' ? null : 'line');
        }
        if (key === 'l' && e.shiftKey) {
          e.preventDefault();
          setMarkupMode(markupMode === 'polyline' ? null : 'polyline');
        }
        // r = rectangle, Shift+R = arc
        if (key === 'r' && !e.shiftKey) {
          e.preventDefault();
          setMarkupMode(markupMode === 'rectangle' ? null : 'rectangle');
        }
        if (key === 'r' && e.shiftKey) {
          e.preventDefault();
          setMarkupMode(markupMode === 'arc' ? null : 'arc');
        }
        // E = ellipse (circle)
        if (key === 'e') {
          e.preventDefault();
          setMarkupMode(markupMode === 'circle' ? null : 'circle');
        }
        // c = cloud, Shift+C = cloudPolyline (poly cloud)
        if (key === 'c' && !e.shiftKey) {
          e.preventDefault();
          setMarkupMode(markupMode === 'cloud' ? null : 'cloud');
        }
        if (key === 'c' && e.shiftKey) {
          e.preventDefault();
          setMarkupMode(markupMode === 'cloudPolyline' ? null : 'cloudPolyline');
        }
        // T = text box
        if (key === 't') {
          e.preventDefault();
          setMarkupMode(markupMode === 'text' ? null : 'text');
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedSlotIds, isDrawingCrop, markupMode, selectedAnnotation, editingTextId, unlockedSlots, undoAnnotation, redoAnnotation, deleteAnnotationWithHistory, pendingPlacement]);
  
  // Check if any slots have unsaved changes
  const hasAnyUnsavedChanges = useCallback(() => {
    for (const slot of slots) {
      const annotations = slotAnnotations[slot.id] || [];
      const ownedIds = ownedAnnotationIds[slot.id] || new Set();
      const hasChanges = annotations.some(a => !a.fromPdf) || ownedIds.size > 0;
      if (hasChanges) return true;
    }
    return false;
  }, [slots, slotAnnotations, ownedAnnotationIds]);
  
  // Warn user before leaving if there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasAnyUnsavedChanges()) {
        const message = 'You have unsaved markup changes. Are you sure you want to leave?';
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasAnyUnsavedChanges]);
  
  // Load initial PDF - center it on the canvas
  useEffect(() => {
    if (initialFile && !hasLoadedInitial.current) {
      hasLoadedInitial.current = true;
      loadPdfAtPosition(initialFile, initialPage, 0, 0, true);
    }
  }, [initialFile]);
  
  // Load a PDF at a specific canvas position
  
  // Helper: build fetch URL for a PDF file, including sourceFolder if present
  const getPdfFetchUrl = (file) => {
    const base = `${BACKEND_URL}/api/files/${encodeURIComponent(file.backendFilename || file.name)}`;
    return file.sourceFolder ? `${base}?sourceFolder=${encodeURIComponent(file.sourceFolder)}` : base;
  };
  
  const loadPdfAtPosition = async (file, page, x, y, isAnchor = false) => {
    const slotId = `${file.id}_page_${page}_${Date.now()}`;
    
    setLoadingSlots(prev => ({ ...prev, [slotId]: true }));
    
    try {
      const response = await fetch(getPdfFetchUrl(file));
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const url = URL.createObjectURL(blob);
      
      if (!window.pdfjsLib) {
        console.error('pdfjsLib not loaded yet');
        return;
      }
      const loadedPdf = await window.pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
      
      // Load annotations from the PDF page with the same scale used for canvas rendering (1.5)
      const pdfAnnotations = await loadPdfAnnotations(loadedPdf, page, slotId, 1.5);
      if (pdfAnnotations.length > 0) {
        console.log(`Loaded ${pdfAnnotations.length} annotations from PDF`);
        setSlotAnnotations(prev => ({
          ...prev,
          [slotId]: [...(prev[slotId] || []), ...pdfAnnotations]
        }));
      }
      
      const newSlot = {
        id: slotId,
        fileId: file.id,
        backendFilename: file.backendFilename,
        sourceFolder: file.sourceFolder || null,
        fileName: file.name,
        page: page,
        pdfDoc: loadedPdf,
        numPages: loadedPdf.numPages,
        blobUrl: url,
        pdfBytes: arrayBuffer, // Store original PDF bytes for annotation deletion
        x: x, // Canvas position X
        y: y, // Canvas position Y
        width: 0, // Will be set after render
        height: 0,
      };
      
      // Store page count for this file (used by DocumentsPanel page browser)
      setFilePageCounts(prev => ({ ...prev, [file.id]: loadedPdf.numPages }));
      
      setSlots(prev => [...prev, newSlot]);
      
      if (isAnchor) {
        setAnchorSlotId(slotId);
      }
      
      return newSlot;
    } catch (error) {
      console.error('Error loading PDF:', error);
      return null;
    } finally {
      setLoadingSlots(prev => {
        const newState = { ...prev };
        delete newState[slotId];
        return newState;
      });
    }
  };
  
  // Calculate the bounding box and center of all slots
  const getSlotsBounds = () => {
    if (slots.length === 0) {
      return { centerX: 0, centerY: 0, width: 0, height: 0 };
    }
    
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    slots.forEach(slot => {
      const slotWidth = slot.width || 800;
      const slotHeight = slot.height || 600;
      const left = slot.x - slotWidth / 2;
      const right = slot.x + slotWidth / 2;
      const top = slot.y - slotHeight / 2;
      const bottom = slot.y + slotHeight / 2;
      
      if (left < minX) minX = left;
      if (right > maxX) maxX = right;
      if (top < minY) minY = top;
      if (bottom > maxY) maxY = bottom;
    });
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const width = maxX - minX;
    const height = maxY - minY;
    
    return { centerX, centerY, width, height, minX, maxX, minY, maxY };
  };
  
  // Zoom to fit all slots in view
  const zoomToFitAll = () => {
    const bounds = getSlotsBounds();
    if (bounds.width === 0 && bounds.height === 0) {
      setZoom(0.5);
      setCanvasPosition({ x: 0, y: 0 });
      return;
    }
    
    // Get container size
    const container = containerRef.current;
    if (!container) return;
    
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    // Calculate zoom to fit with some padding
    const padding = 100;
    const zoomX = (containerWidth - padding * 2) / bounds.width;
    const zoomY = (containerHeight - padding * 2) / bounds.height;
    const newZoom = Math.min(zoomX, zoomY, 1); // Don't zoom in past 100%
    
    setIsAnimating(true);
    setZoom(Math.max(0.05, newZoom)); // Minimum 5% zoom
    setCanvasPosition({
      x: -bounds.centerX * newZoom,
      y: -bounds.centerY * newZoom
    });
    setTimeout(() => setIsAnimating(false), 600);
  };
  
  // Go to center of all slots at default zoom
  const resetToCenter = () => {
    const bounds = getSlotsBounds();
    setIsAnimating(true);
    setZoom(0.5);
    setCanvasPosition({
      x: -bounds.centerX * 0.5,
      y: -bounds.centerY * 0.5
    });
    setTimeout(() => setIsAnimating(false), 600);
  };
  
  // Zoom to a specific slot at specified zoom level
  const zoomToSlot = (slot, targetZoom = 0.8) => {
    setIsAnimating(true);
    setZoom(targetZoom);
    setCanvasPosition({
      x: -slot.x * targetZoom,
      y: -slot.y * targetZoom
    });
    setTimeout(() => setIsAnimating(false), 600);
  };
  
  // Smart positioning - move existing PDFs out of the way, insert new one at target
  const findSmartPosition = (targetX, targetY, newSlotWidth, newSlotHeight, sourceSlot = null) => {
    const gap = 100;
    const rowTolerance = 150;
    const columnTolerance = 200; // How close X values need to be to be considered same column
    const slotHeight = newSlotHeight || 600;
    const slotWidth = newSlotWidth || 800;
    
    // Find slot that's currently at or near the target position
    const blockingSlot = slots.find(s => {
      if (sourceSlot && s.id === sourceSlot.id) return false; // Don't count source as blocking
      const sWidth = s.width || 800;
      const sHeight = s.height || 600;
      const overlapX = Math.abs(s.x - targetX) < (sWidth + slotWidth) / 2;
      const overlapY = Math.abs(s.y - targetY) < (sHeight + slotHeight) / 2;
      return overlapX && overlapY;
    });
    
    // If no blocking slot, just use target position
    if (!blockingSlot) {
      return { x: targetX, y: targetY, slotsToMove: [] };
    }
    
    // There's a PDF in the way - need to move it (and PDFs in same column) up or down
    const getRowY = (y) => Math.round(y / rowTolerance) * rowTolerance;
    const blockingRowY = getRowY(blockingSlot.y);
    
    // Get all slots excluding source slot
    const allSlots = sourceSlot 
      ? slots.filter(s => s.id !== sourceSlot.id)
      : slots;
    
    // Only consider slots in the same column area (similar X position to target)
    const slotsInColumn = allSlots.filter(s => 
      Math.abs(s.x - targetX) < columnTolerance + (s.width || 800) / 2
    );
    
    const rowYValues = [...new Set(slotsInColumn.map(s => getRowY(s.y)))].sort((a, b) => a - b);
    const rowsAbove = rowYValues.filter(y => y < blockingRowY);
    const rowsBelow = rowYValues.filter(y => y > blockingRowY);
    
    // Calculate how much space we need - the new slot height plus gap
    const spaceNeeded = slotHeight + gap;
    
    let slotsToMove = [];
    
    // Default: push blocking row and everything above it UP (only in same column)
    if (rowsAbove.length <= rowsBelow.length) {
      // Find slots in the same column at or above the blocking row
      const slotsToMoveUp = slotsInColumn.filter(s => getRowY(s.y) <= blockingRowY);
      
      slotsToMove = slotsToMoveUp.map(s => ({
        id: s.id,
        newY: s.y - spaceNeeded
      }));
    } else {
      // Push slots in the same column at or below blocking row DOWN
      const slotsToMoveDown = slotsInColumn.filter(s => getRowY(s.y) >= blockingRowY);
      
      slotsToMove = slotsToMoveDown.map(s => ({
        id: s.id,
        newY: s.y + spaceNeeded
      }));
    }
    
    // New PDF goes at the original target position
    return { x: targetX, y: targetY, slotsToMove };
  };
  
  // Apply slot movements
  const applySlotMovements = (slotsToMove) => {
    if (slotsToMove.length === 0) return;
    
    setSlots(prev => prev.map(s => {
      const movement = slotsToMove.find(m => m.id === s.id);
      if (movement) {
        return { ...s, y: movement.newY };
      }
      return s;
    }));
  };
  
  // Animated transition helper
  const animateToPosition = (targetZoom, targetX, targetY, duration = 600) => {
    return new Promise(resolve => {
      setIsAnimating(true);
      setZoom(targetZoom);
      setCanvasPosition({ x: targetX, y: targetY });
      setTimeout(() => {
        setIsAnimating(false);
        resolve();
      }, duration);
    });
  };
  
  // Navigate to an object - always animate to 60% zoom
  const navigateToObject = async (obj) => {
    const targetZoom = 0.8;
    
    // obj.page is 0-indexed, slot.page is 1-indexed
    const targetPage = (obj.page || 0) + 1;
    
    // 1. Look for an exact match: same file AND same page
    let targetSlot = slots.find(s => s.backendFilename === obj.filename && s.page === targetPage);
    
    if (!targetSlot) {
      // View is locked — don't add new pages, return false to signal blocked
      if (viewLocked) return false;
      
      // 2. Page not on canvas — need to add it
      const file = allFiles.find(f => f.backendFilename === obj.filename);
      if (!file) return;
      
      // Find a good position: next to an existing slot of the same file, or last slot, or origin
      const sameFileSlot = slots.find(s => s.backendFilename === obj.filename);
      const referenceSlot = sameFileSlot || slots[slots.length - 1];
      
      let x = 0, y = 0;
      if (referenceSlot) {
        const slotWidth = referenceSlot.width || 800;
        const slotHeight = referenceSlot.height || 600;
        const gap = 100;
        const targetX = referenceSlot.x + slotWidth + gap;
        const targetY = referenceSlot.y;
        const result = findSmartPosition(targetX, targetY, slotWidth, slotHeight, referenceSlot);
        x = result.x;
        y = result.y;
        applySlotMovements(result.slotsToMove);
      }
      
      // Load the page — returns the slot directly
      const newSlot = await loadPdfAtPosition(file, targetPage, x, y);
      
      if (newSlot) {
        targetSlot = newSlot;
        // Brief wait for canvas render to populate width/height
        await new Promise(r => setTimeout(r, 300));
        // Re-read from state in case dimensions updated (use newSlot position as fallback)
      } else {
        // Load failed
        return;
      }
    }
    
    // Use slot dimensions or defaults
    const slotWidth = targetSlot.width || 800;
    const slotHeight = targetSlot.height || 600;
    
    // Calculate the object's center position within the PDF
    let objectCenterX = targetSlot.x;
    let objectCenterY = targetSlot.y;
    
    if (obj.bbox) {
      // bbox can be {x, y, width, height} (normalized) or [x1, y1, x2, y2]
      let objCenterNormX, objCenterNormY;
      
      if (Array.isArray(obj.bbox)) {
        // [x1, y1, x2, y2] format
        const [x1, y1, x2, y2] = obj.bbox;
        objCenterNormX = (x1 + x2) / 2;
        objCenterNormY = (y1 + y2) / 2;
      } else {
        // {x, y, width, height} format
        objCenterNormX = obj.bbox.x + obj.bbox.width / 2;
        objCenterNormY = obj.bbox.y + obj.bbox.height / 2;
      }
      
      // Convert to canvas coordinates
      const slotLeft = targetSlot.x - slotWidth / 2;
      const slotTop = targetSlot.y - slotHeight / 2;
      
      objectCenterX = slotLeft + objCenterNormX * slotWidth;
      objectCenterY = slotTop + objCenterNormY * slotHeight;
    }
    
    // Animate to center on the object
    setIsAnimating(true);
    setZoom(targetZoom);
    setCanvasPosition({
      x: -objectCenterX * targetZoom,
      y: -objectCenterY * targetZoom
    });
    setTimeout(() => setIsAnimating(false), 600);
    
    // Highlight the object
    setHighlightedObjectId(obj.id);
    setTimeout(() => setHighlightedObjectId(null), 3000);
    
    // Keep panel open - only close with X button
  };
  
  // Navigate to a region — reuses navigateToObject with adapted shape
  const navigateToRegion = (region) => {
    navigateToObject({
      filename: region.filename,
      page: region.page || 0,
      bbox: region.x != null ? { x: region.x, y: region.y, width: region.width, height: region.height } : null,
      id: region.id,
    });
  };
  
  // Load detected objects from backend
  useEffect(() => {
    const loadObjects = async () => {
      if (!project?.id) return;
      
      // Only skip on initial load if already loaded
      if (hasLoadedObjectsRef.current && refreshKey === 0) return;
      
      try {
        hasLoadedObjectsRef.current = true;
        const objects = await getObjectsFromBackend(project.id);
        
        if (objects.length > 0) {
          console.log(`InfiniteView: Loaded ${objects.length} objects from backend`);
          setDetectedObjects(objects);
        } else if (project?.detectedObjects?.length > 0) {
          // Fallback to project.detectedObjects if no backend data
          console.log(`InfiniteView: Using ${project.detectedObjects.length} objects from project`);
          setDetectedObjects(project.detectedObjects);
        }
      } catch (error) {
        console.error('InfiniteView: Failed to load objects from backend:', error);
        // Fallback to project.detectedObjects
        if (project?.detectedObjects) {
          setDetectedObjects(project.detectedObjects);
        }
      }
      
      // Also load regions
      try {
        const regions = await getRegionsFromBackend(project.id);
        if (regions?.length > 0) {
          console.log(`InfiniteView: Loaded ${regions.length} regions from backend`);
          setDrawnRegions(regions);
        }
      } catch (error) {
        console.error('InfiniteView: Failed to load regions from backend:', error);
      }
    };
    
    loadObjects();
  }, [project?.id, refreshKey]);
  
  // Debounce search query to avoid filtering on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(objectSearchQuery);
    }, 150);
    return () => clearTimeout(timer);
  }, [objectSearchQuery]);
  
  // Get all detected objects - use loaded state, fallback to project
  const allDetectedObjects = useMemo(() => {
    if (detectedObjects.length > 0) return detectedObjects;
    if (project?.detectedObjects) return project.detectedObjects;
    return [];
  }, [detectedObjects, project?.detectedObjects]);
  
  // Get all unique classes from detected objects + region types
  const availableClasses = useMemo(() => {
    const classes = new Set();
    allDetectedObjects.forEach(obj => {
      if (obj.label) classes.add(obj.label);
      if (obj.className) classes.add(obj.className);
    });
    drawnRegions.forEach(r => {
      if (r.regionType) classes.add(r.regionType);
    });
    return [...classes].sort();
  }, [allDetectedObjects, drawnRegions]);
  
  // Memoized search matcher — avoids recreating on every render
  const matchesSearchQuery = useCallback((item, query) => {
    if (!query) return false;
    const q = query.toLowerCase();
    // Object fields
    if (item.label?.toLowerCase().includes(q)) return true;
    if (item.ocr_text?.toLowerCase().includes(q)) return true;
    if (item.className?.toLowerCase().includes(q)) return true;
    if (item.description?.toLowerCase().includes(q)) return true;
    if (item.filename?.toLowerCase().includes(q)) return true;
    if (item.subclassValues) {
      for (const val of Object.values(item.subclassValues)) {
        if (val && String(val).toLowerCase().includes(q)) return true;
      }
    }
    // Region fields
    if (item.regionType?.toLowerCase().includes(q)) return true;
    if (item.subRegionName?.toLowerCase().includes(q)) return true;
    return false;
  }, []);
  
  // Filter objects based on debounced search — memoized, only recomputes when deps change
  const filteredObjects = useMemo(() => {
    if (!showObjectSearch) return [];
    const query = debouncedSearchQuery.trim();
    if (!query) return [];
    return allDetectedObjects
      .filter(obj => matchesSearchQuery(obj, query))
      .slice(0, 100);
  }, [showObjectSearch, debouncedSearchQuery, allDetectedObjects, matchesSearchQuery]);
  
  // Filter regions based on debounced search — memoized
  const filteredRegions = useMemo(() => {
    if (!showObjectSearch) return [];
    const query = debouncedSearchQuery.trim();
    if (!query) return [];
    return drawnRegions
      .filter(r => matchesSearchQuery(r, query))
      .slice(0, 100);
  }, [showObjectSearch, debouncedSearchQuery, drawnRegions, matchesSearchQuery]);
  
  // Helper to get class colors (fillColor and borderColor) for display
  const getClassColors = useCallback((className) => {
    if (!className) return { fillColor: 'none', borderColor: '#3498db' };
    
    const classes = project?.classes || [];
    
    // Find the class definition
    let cls = classes.find(c => c.name === className && !c.parentId);
    if (!cls) {
      cls = classes.find(c => c.name === className);
    }
    if (!cls && className.includes(' > ')) {
      const parentName = className.split(' > ')[0];
      cls = classes.find(c => c.name === parentName && !c.parentId);
    }
    
    if (cls) {
      return {
        fillColor: cls.fillColor || 'none',
        borderColor: cls.borderColor || cls.color || '#3498db'
      };
    }
    
    // Generate consistent color based on name
    const defaultColors = [
      '#3498db', '#e74c3c', '#2ecc71', '#9b59b6',
      '#1abc9c', '#e91e63', '#9c27b0', '#00bcd4'
    ];
    let hash = 0;
    for (let i = 0; i < className.length; i++) {
      hash = className.charCodeAt(i) + ((hash << 5) - hash);
    }
    const color = defaultColors[Math.abs(hash) % defaultColors.length];
    return { fillColor: 'none', borderColor: color };
  }, [project?.classes]);
  
  // Handle hotspot click - load linked PDF adjacent to current, with smart positioning
  const handleHotspotClick = async (hotspot, sourceSlot) => {
    if (!hotspot.targetFileId) return;
    
    const targetFile = allFiles.find(f => f.id === hotspot.targetFileId);
    if (!targetFile) return;
    
    // Determine target position based on hotspot location
    const isLeftSide = hotspot.x < 0.5;
    const targetPage = hotspot.targetPage || 1;
    
    // Calculate where the PDF should go (next to the source)
    const gap = 100; // Gap between PDFs
    const slotWidth = sourceSlot.width || 800;
    const slotHeight = sourceSlot.height || 600;
    let targetX, targetY;
    
    if (isLeftSide) {
      // Place to the left of source
      targetX = sourceSlot.x - slotWidth - gap;
      targetY = sourceSlot.y;
    } else {
      // Place to the right of source
      targetX = sourceSlot.x + slotWidth + gap;
      targetY = sourceSlot.y;
    }
    
    // Check if exact page already loaded
    const existingSlot = slots.find(s => s.fileId === targetFile.id && s.page === targetPage);
    if (existingSlot) {
      // Navigate to it
      zoomToSlot(existingSlot, 0.35);
      setAnchorSlotId(existingSlot.id);
      setSelectedSlotIds(new Set([existingSlot.id]));
      return;
    }
    
    // Use smart positioning for new slot - pass sourceSlot for context
    const { x, y, slotsToMove } = findSmartPosition(targetX, targetY, slotWidth, slotHeight, sourceSlot);
    applySlotMovements(slotsToMove);
    
    // Load new page at smart position
    await loadPdfAtPosition(targetFile, targetPage, x, y);
  };
  
  // Pan handlers - only pan canvas when not dragging a slot
  const handleMouseDown = (e) => {
    // Don't start panning if clicking on a hotspot or delete button
    if (e.target.closest('.infinite-hotspot')) {
      return;
    }
    if (e.button === 0 || e.button === 1) { // Left or middle click
      setIsPanning(true);
      setPanStart({
        x: e.clientX - canvasPosition.x,
        y: e.clientY - canvasPosition.y
      });
    }
  };
  
  const handleMouseMove = (e) => {
    if (isPanning && !draggingSlotId) {
      setCanvasPosition({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    }
  };
  
  const handleMouseUp = () => {
    setIsPanning(false);
  };

  // ── Screen-to-canvas coordinate conversion ────────────────────────
  const screenToCanvas = useCallback((screenX, screenY) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const cx = screenX - rect.left - rect.width / 2;
    const cy = screenY - rect.top - rect.height / 2;
    return {
      x: (cx - canvasPosition.x) / zoom,
      y: (cy - canvasPosition.y) / zoom,
    };
  }, [canvasPosition, zoom]);

  // ── Snap utility: constrain angle to 0°/45°/90° increments when Shift held ──
  const snapPoint = useCallback((fromPt, toPt, shiftHeld) => {
    if (!shiftHeld || !fromPt) return toPt;
    const dx = toPt.x - fromPt.x;
    const dy = toPt.y - fromPt.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return toPt;
    const angle = Math.atan2(dy, dx);
    const SNAP_ANGLES = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, -3 * Math.PI / 4, -Math.PI / 2, -Math.PI / 4];
    let closest = SNAP_ANGLES[0];
    let minDiff = Infinity;
    for (const sa of SNAP_ANGLES) {
      // Proper angular distance accounting for wrapping around ±π
      let diff = Math.abs(angle - sa);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff < minDiff) { minDiff = diff; closest = sa; }
    }
    return {
      x: fromPt.x + Math.round(dist * Math.cos(closest)),
      y: fromPt.y + Math.round(dist * Math.sin(closest)),
    };
  }, []);

  // ── Zoom box completion: zoom to fit the drawn rectangle ──────────
  const completeZoomBox = useCallback((box) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const p1 = screenToCanvas(box.startX, box.startY);
    const p2 = screenToCanvas(box.endX, box.endY);
    
    const canvasLeft = Math.min(p1.x, p2.x);
    const canvasTop = Math.min(p1.y, p2.y);
    const canvasW = Math.abs(p2.x - p1.x);
    const canvasH = Math.abs(p2.y - p1.y);
    
    if (canvasW < 10 && canvasH < 10) {
      // Too small - treat as click, do a simple zoom step
      setZoom(prev => Math.min(10, Math.exp(Math.log(prev) + 0.25)));
      return;
    }
    
    const centerX = canvasLeft + canvasW / 2;
    const centerY = canvasTop + canvasH / 2;
    
    const fitZoom = Math.min(
      rect.width / canvasW,
      rect.height / canvasH,
      10
    ) * 0.9; // 90% to leave some padding
    
    setIsAnimating(true);
    setZoom(fitZoom);
    setCanvasPosition({
      x: -centerX * fitZoom,
      y: -centerY * fitZoom,
    });
    setTimeout(() => setIsAnimating(false), 600);
  }, [screenToCanvas]);

  // ── Select box completion: select all slots & shapes in rectangle ─
  const completeSelectBox = useCallback((box) => {
    const p1 = screenToCanvas(box.startX, box.startY);
    const p2 = screenToCanvas(box.endX, box.endY);
    
    const boxLeft = Math.min(p1.x, p2.x);
    const boxTop = Math.min(p1.y, p2.y);
    const boxRight = Math.max(p1.x, p2.x);
    const boxBottom = Math.max(p1.y, p2.y);
    
    if (boxRight - boxLeft < 5 && boxBottom - boxTop < 5) return; // Too small
    
    // Check rectangle intersection helper
    const intersects = (ax, ay, aw, ah) => {
      return ax + aw / 2 > boxLeft && ax - aw / 2 < boxRight &&
             ay + ah / 2 > boxTop && ay - ah / 2 < boxBottom;
    };
    
    // Select slots that intersect
    const newSlotIds = new Set();
    slots.forEach(slot => {
      const sw = slot.width || 800;
      const sh = slot.height || 600;
      if (intersects(slot.x, slot.y, sw, sh)) {
        newSlotIds.add(slot.id);
      }
    });
    setSelectedSlotIds(newSlotIds);
    
    // Select canvas shapes that intersect
    const newShapeIds = new Set();
    canvasShapes.forEach(shape => {
      if (shape.type === 'arrow' || shape.type === 'line') {
        const x2 = shape.x + (shape.width || 200);
        const y2 = shape.y + (shape.height || 0);
        const minX = Math.min(shape.x, x2);
        const minY = Math.min(shape.y, y2);
        const maxX = Math.max(shape.x, x2);
        const maxY = Math.max(shape.y, y2);
        if (maxX > boxLeft && minX < boxRight && maxY > boxTop && minY < boxBottom) {
          newShapeIds.add(shape.id);
        }
      } else if (shape.type === 'polyline' && shape.points?.length) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        shape.points.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
        if (maxX > boxLeft && minX < boxRight && maxY > boxTop && minY < boxBottom) {
          newShapeIds.add(shape.id);
        }
      } else {
        // Rectangle, text, circle — positioned at shape.x, shape.y (top-left)
        const shapeRight = shape.x + (shape.width || 150);
        const shapeBottom = shape.y + (shape.height || 100);
        if (shapeRight > boxLeft && shape.x < boxRight && shapeBottom > boxTop && shape.y < boxBottom) {
          newShapeIds.add(shape.id);
        }
      }
    });
    setSelectedShapeIds(newShapeIds);
  }, [screenToCanvas, slots, canvasShapes]);
  
  // ── Drag-and-drop from sidebar onto canvas ──────────────────────────
  const handleCanvasDragOver = (e) => {
    // Check if this is a file-drop from our sidebar, a symbol, or a canvas shape
    if (e.dataTransfer.types.includes('application/iv-file') || e.dataTransfer.types.includes('application/json') || e.dataTransfer.types.includes('application/iv-shape') || e.dataTransfer.types.includes('application/iv-batch')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleCanvasDragEnter = (e) => {
    if (e.dataTransfer.types.includes('application/iv-file') || e.dataTransfer.types.includes('application/json') || e.dataTransfer.types.includes('application/iv-shape') || e.dataTransfer.types.includes('application/iv-batch')) {
      e.preventDefault();
      dragOverCountRef.current++;
      if (dragOverCountRef.current === 1) {
        setIsDragOverCanvas(true);
      }
    }
  };

  const handleCanvasDragLeave = () => {
    dragOverCountRef.current--;
    if (dragOverCountRef.current <= 0) {
      dragOverCountRef.current = 0;
      setIsDragOverCanvas(false);
    }
  };

  const handleCanvasDrop = async (e) => {
    e.preventDefault();
    dragOverCountRef.current = 0;
    setIsDragOverCanvas(false);
    
    // View is locked — block all drops that add content
    if (viewLocked) return;
    
    console.log('[DEBUG] handleCanvasDrop fired, types:', [...e.dataTransfer.types]);
    
    // Handle canvas shape drops from Views panel
    const shapeData = e.dataTransfer.getData('application/iv-shape');
    if (shapeData) {
      try {
        const { type } = JSON.parse(shapeData);
        const rect = containerRef.current.getBoundingClientRect();
        const cursorX = e.clientX - rect.left - rect.width / 2;
        const cursorY = e.clientY - rect.top - rect.height / 2;
        const canvasX = (cursorX - canvasPosition.x) / zoom;
        const canvasY = (cursorY - canvasPosition.y) / zoom;
        
        // Size scales inversely with zoom so shapes appear ~200px on screen
        const screenSize = 200;
        const baseW = screenSize / zoom;
        const baseH = (screenSize * 0.75) / zoom;
        
        const defaults = {
          rectangle: { width: baseW, height: baseH, fillColor: '#3498db', fillOpacity: 15, borderColor: '#3498db', borderWidth: 2 },
          text:      { width: baseW * 1.2, height: baseH * 0.4, fillColor: '#1a1a2e', fillOpacity: 90, borderColor: '#3498db', borderWidth: 1, text: 'Text', fontSize: Math.round(18 / zoom), textColor: '#ffffff', fontFamily: 'Arial' },
          arrow:     { width: baseW, height: 0, fillColor: 'none', fillOpacity: 0, borderColor: '#e74c3c', borderWidth: 2 },
          line:      { width: baseW, height: 0, fillColor: 'none', fillOpacity: 0, borderColor: '#f39c12', borderWidth: 3 },
          circle:    { width: baseH, height: baseH, fillColor: '#9b59b6', fillOpacity: 15, borderColor: '#9b59b6', borderWidth: 2 },
          polyline:  { width: baseW, height: baseH, fillColor: 'none', fillOpacity: 0, borderColor: '#2ecc71', borderWidth: 3 },
        };
        const d = defaults[type] || defaults.rectangle;
        
        const shape = {
          id: `cshape_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type,
          x: canvasX - d.width / 2,
          y: canvasY - d.height / 2,
          ...d,
          title: '',
          borderStyle: 'solid',
        };
        
        // Polylines need a points array
        if (type === 'polyline') {
          shape.points = [
            { x: shape.x, y: shape.y + d.height },
            { x: shape.x + d.width / 2, y: shape.y },
            { x: shape.x + d.width, y: shape.y + d.height },
          ];
        }
        
        setCanvasShapes(prev => [...prev, shape]);
        setSelectedCanvasShapeId(shape.id);
      } catch (err) {
        console.warn('Failed to drop canvas shape:', err);
      }
      return;
    }
    
    // Handle batch drops from Views panel — open placement dialog
    const batchData = e.dataTransfer.getData('application/iv-batch');
    if (batchData) {
      try {
        const { batchId } = JSON.parse(batchData);
        if (batchId) handleOpenLoadBatch(batchId);
      } catch (err) {
        console.warn('Failed to drop batch:', err);
      }
      return;
    }
    
    // Handle symbol drops from SymbolsPanel
    const symbolData = e.dataTransfer.getData('application/json');
    console.log('[DEBUG] symbolData:', symbolData ? 'present' : 'none', 'iv-file:', e.dataTransfer.getData('application/iv-file') ? 'yes' : 'no');
    if (symbolData && !e.dataTransfer.getData('application/iv-file')) {
      try {
        const symbol = JSON.parse(symbolData);
        console.log('[DEBUG] parsed symbol:', symbol?.name, 'hasImage:', !!symbol?.image, 'hasMarkups:', !!symbol?.markups);
        if (symbol && (symbol.image || symbol.markups)) {
          // Find which unlocked slot the drop lands on
          const rect = containerRef.current.getBoundingClientRect();
          const cursorX = e.clientX - rect.left - rect.width / 2;
          const cursorY = e.clientY - rect.top - rect.height / 2;
          const canvasX = (cursorX - canvasPosition.x) / zoom;
          const canvasY = (cursorY - canvasPosition.y) / zoom;
          
          console.log('[DEBUG] canvas coords:', canvasX, canvasY, 'unlockedSlots:', [...unlockedSlots]);
          
          // Find the slot under the cursor
          const targetSlot = slots.find(s => {
            if (!unlockedSlots.has(s.id)) return false;
            const sw = s.width || 200;
            const sh = s.height || 280;
            const hit = canvasX >= s.x && canvasX <= s.x + sw && canvasY >= s.y && canvasY <= s.y + sh;
            console.log('[DEBUG] slot check:', s.id, 'unlocked:', unlockedSlots.has(s.id), 'bounds:', s.x, s.y, sw, sh, 'hit:', hit);
            return hit;
          });
          
          console.log('[DEBUG] targetSlot:', targetSlot?.id || 'NONE');
          if (targetSlot) {
            const sw = targetSlot.width || 200;
            const sh = targetSlot.height || 280;
            const localPixelX = canvasX - targetSlot.x;
            const localPixelY = canvasY - targetSlot.y;
            placeSymbolOnSlot(symbol, targetSlot.id, localPixelX, localPixelY, { width: sw, height: sh });
          }
          return;
        }
      } catch {}
    }
    
    const data = e.dataTransfer.getData('application/iv-file');
    if (!data) return;
    
    let payload;
    try { payload = JSON.parse(data); } catch { return; }
    
    const file = allFiles.find(f => f.id === payload.fileId);
    if (!file) return;
    
    const page = payload.page || 1;
    
    // Check if this exact page is already on canvas
    const existing = slots.find(s => s.fileId === file.id && s.page === page);
    if (existing) {
      zoomToSlot(existing, 0.35);
      setAnchorSlotId(existing.id);
      setSelectedSlotIds(new Set([existing.id]));
      return;
    }
    
    // Convert drop screen position → canvas position
    // The canvas transform is: translate(calc(-50% + posX), calc(-50% + posY)) scale(zoom)
    // with transformOrigin: center center
    const rect = containerRef.current.getBoundingClientRect();
    const cursorX = e.clientX - rect.left - rect.width / 2;
    const cursorY = e.clientY - rect.top - rect.height / 2;
    const canvasX = (cursorX - canvasPosition.x) / zoom;
    const canvasY = (cursorY - canvasPosition.y) / zoom;
    
    const newSlot = await loadPdfAtPosition(file, page, canvasX, canvasY);
    if (newSlot) {
      setAnchorSlotId(newSlot.id);
      setSelectedSlotIds(new Set([newSlot.id]));
    }
  };
  
  // Update slot dimensions after render
  const updateSlotDimensions = (slotId, width, height) => {
    setSlots(prev => prev.map(s => 
      s.id === slotId ? { ...s, width, height } : s
    ));
  };
  
  // Cleanup blob URLs
  useEffect(() => {
    return () => {
      slots.forEach(slot => {
        if (slot.blobUrl) {
          URL.revokeObjectURL(slot.blobUrl);
        }
      });
    };
  }, []);

  // Current tool mode
  const [currentTool, setCurrentTool] = useState('select'); // 'select', 'pan', 'move', 'zoom', 'crop'

  // Force tool away from 'move' when view is locked
  useEffect(() => {
    if (viewLocked && currentTool === 'move') {
      setCurrentTool('select');
    }
  }, [viewLocked, currentTool]);

  // Refs for zoom/position/tool to avoid stale closures in wheel handler
  const zoomRef = useRef(zoom);
  const canvasPosRef = useRef(canvasPosition);
  const currentToolRef = useRef(currentTool);
  zoomRef.current = zoom;
  canvasPosRef.current = canvasPosition;
  currentToolRef.current = currentTool;
  zoomSettingsRef.current = zoomSettings;

  // Attach wheel listener with passive: false to prevent browser zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Smooth zoom animation state
    let smoothZoomRaf = null;
    let smoothZoomTarget = null;
    let lastWheelEvent = null;

    const applyZoom = (e, curZoom, curPos, newZoom) => {
      const settings = zoomSettingsRef.current;
      const rect = container.getBoundingClientRect();

      if (settings.zoomTarget === 'cursor') {
        const cursorX = e.clientX - rect.left - rect.width / 2;
        const cursorY = e.clientY - rect.top - rect.height / 2;
        const canvasPointX = (cursorX - curPos.x) / curZoom;
        const canvasPointY = (cursorY - curPos.y) / curZoom;
        setZoom(newZoom);
        setCanvasPosition({
          x: cursorX - canvasPointX * newZoom,
          y: cursorY - canvasPointY * newZoom,
        });
      } else {
        // Zoom to center of screen
        const scale = newZoom / curZoom;
        setZoom(newZoom);
        setCanvasPosition({
          x: curPos.x * scale,
          y: curPos.y * scale,
        });
      }
    };

    const zoomWithCursor = (e, curZoom, curPos) => {
      const settings = zoomSettingsRef.current;
      const sensitivity = settings.zoomSensitivity;
      const logStep = 0.25 * sensitivity;
      const logZoom = Math.log(curZoom);

      let direction = e.deltaY > 0 ? -1 : 1;
      if (settings.scrollDirection === 'inverted') direction *= -1;

      const newLogZoom = logZoom + direction * logStep;
      const newZoom = Math.max(0.02, Math.min(10, Math.exp(newLogZoom)));

      if (settings.smoothZoom) {
        smoothZoomTarget = newZoom;
        lastWheelEvent = e;
        if (!smoothZoomRaf) {
          const animateSmooth = () => {
            const cur = zoomRef.current;
            const target = smoothZoomTarget;
            const diff = target - cur;
            if (Math.abs(diff) < 0.001) {
              applyZoom(lastWheelEvent, cur, canvasPosRef.current, target);
              smoothZoomRaf = null;
              smoothZoomTarget = null;
              return;
            }
            const step = cur + diff * 0.3;
            applyZoom(lastWheelEvent, cur, canvasPosRef.current, step);
            smoothZoomRaf = requestAnimationFrame(animateSmooth);
          };
          smoothZoomRaf = requestAnimationFrame(animateSmooth);
        }
      } else {
        applyZoom(e, curZoom, curPos, newZoom);
      }
    };

    const wheelHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const curZoom = zoomRef.current;
      const curPos = canvasPosRef.current;
      const tool = currentToolRef.current;
      const settings = zoomSettingsRef.current;
      
      // Ctrl/⌘ + scroll = always zoom regardless of tool
      if (e.ctrlKey || e.metaKey) {
        zoomWithCursor(e, curZoom, curPos);
        return;
      }
      
      // Zoom tool: scroll = zoom
      if (tool === 'zoom') {
        zoomWithCursor(e, curZoom, curPos);
        return;
      }
      
      // All other tools: scroll = pan
      const panSpeed = 1.2 * settings.scrollPanSpeed;
      const dx = e.shiftKey ? -e.deltaY * panSpeed : -e.deltaX * panSpeed;
      const dy = e.shiftKey ? 0 : -e.deltaY * panSpeed;
      
      setCanvasPosition({
        x: curPos.x + dx,
        y: curPos.y + dy,
      });
    };

    container.addEventListener('wheel', wheelHandler, { passive: false });
    
    return () => {
      container.removeEventListener('wheel', wheelHandler);
      if (smoothZoomRaf) cancelAnimationFrame(smoothZoomRaf);
    };
  }, []); // No deps — uses refs for current values
  
  // Get cursor based on tool
  const getCursor = () => {
    if (dragBox) return 'crosshair';
    if (isPanning) return 'grabbing';
    if (draggingSlotId) return 'grabbing';
    if (currentTool === 'crop' || isDrawingCrop) return 'crosshair';
    if (currentTool === 'drawPolyline') return 'crosshair';
    switch (currentTool) {
      case 'select': return 'default';
      case 'pan': return 'grab';
      case 'move': return 'default';
      case 'zoom': return 'crosshair';
      default: return 'default';
    }
  };
  
  // Whether we're in a drawing mode that should show crosshairs
  const showCrosshairs = !!(markupMode || isDrawingCrop || currentTool === 'drawPolyline' || currentTool === 'zoom');
  
  // Handle crop region completion
  const handleCropComplete = (region) => {
    setCropRegion(region);
    setCropEnabled(true);
    setIsDrawingCrop(false);
    setCurrentTool('select');
  };
  
  // Clear crop region
  const clearCropRegion = () => {
    setCropRegion(null);
    setCropEnabled(false);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // PANEL CALLBACKS — extracted from inline JSX for panel components
  // ═══════════════════════════════════════════════════════════════════════════

  // Toggle crop drawing from ViewOptions panel
  const handleStartCropDraw = () => {
    if (isDrawingCrop) {
      setIsDrawingCrop(false);
      setCurrentTool('select');
    } else {
      setIsDrawingCrop(true);
      setCurrentTool('crop');
    }
  };

  // Refresh button handler
  const handleRefresh = async () => {
    if (onRefresh) {
      await onRefresh();
    }
    setRefreshKey(prev => prev + 1);
  };

  // Object detail dialog — save
  const handleObjectSave = async () => {
    const updatedObjects = detectedObjects.map(obj =>
      obj.id === selectedObject.id ? selectedObject : obj
    );
    setDetectedObjects(updatedObjects);
    
    if (project?.id) {
      try {
        await saveObjectsToBackend(project.id, updatedObjects);
      } catch (error) {
        console.error('Failed to save objects to backend:', error);
      }
    }
    
    if (onProjectUpdate) {
      onProjectUpdate({
        ...project,
        detectedObjects: updatedObjects
      });
    }
    setShowObjectDialog(false);
    if (objectThumbnail) URL.revokeObjectURL(objectThumbnail);
    setObjectThumbnail(null);
  };

  // Object detail dialog — close
  const handleObjectDialogClose = () => {
    setShowObjectDialog(false);
    if (objectThumbnail) URL.revokeObjectURL(objectThumbnail);
    setObjectThumbnail(null);
  };

  // Multi-delete — confirm
  const handleMultiDelete = () => {
    // Check in any unlocked documents
    slots.forEach(s => {
      if (selectedSlotIds.has(s.id) && unlockedSlots.has(s.id)) {
        onDocumentCheckin?.(s.fileId);
      }
    });
    // Clear annotations for deleted slots
    setSlotAnnotations(prev => {
      const next = { ...prev };
      selectedSlotIds.forEach(id => delete next[id]);
      return next;
    });
    setOwnedAnnotationIds(prev => {
      const next = { ...prev };
      selectedSlotIds.forEach(id => delete next[id]);
      return next;
    });
    // Clear unlocked state for deleted slots
    setUnlockedSlots(prev => {
      const next = new Set(prev);
      selectedSlotIds.forEach(id => next.delete(id));
      return next;
    });
    // Delete all selected slots
    setSlots(prev => prev.filter(s => !selectedSlotIds.has(s.id)));
    // Revoke blob URLs
    slots.forEach(s => {
      if (selectedSlotIds.has(s.id) && s.blobUrl) {
        URL.revokeObjectURL(s.blobUrl);
      }
    });
    // Clear selection
    setSelectedSlotIds(new Set());
    setShowMultiDeleteConfirm(false);
    // Reset anchor if deleted
    if (selectedSlotIds.has(anchorSlotId)) {
      const remaining = slots.filter(s => !selectedSlotIds.has(s.id));
      setAnchorSlotId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  // Documents panel — navigate to slot
  const handleSlotNavigate = (slot, targetZoom) => {
    zoomToSlot(slot, targetZoom);
    setAnchorSlotId(slot.id);
    setSelectedSlotIds(new Set([slot.id]));
  };

  // Remove a single slot from canvas (used by panel × buttons and inline delete)
  const removeSlotFromCanvas = useCallback((slot) => {
    if (viewLocked) return;
    const annotations = slotAnnotations[slot.id] || [];
    const ownedIds = ownedAnnotationIds[slot.id] || new Set();
    const hasChanges = annotations.some(a => !a.fromPdf) || ownedIds.size > 0;
    
    if (hasChanges) {
      if (!window.confirm('This page has unsaved changes.\n\nRemove anyway? All unsaved changes will be lost.')) return;
    }
    
    if (slot.blobUrl) URL.revokeObjectURL(slot.blobUrl);
    setSlotAnnotations(prev => { const n = { ...prev }; delete n[slot.id]; return n; });
    setOwnedAnnotationIds(prev => { const n = { ...prev }; delete n[slot.id]; return n; });
    if (unlockedSlots.has(slot.id)) onDocumentCheckin?.(slot.fileId);
    setUnlockedSlots(prev => { const n = new Set(prev); n.delete(slot.id); return n; });
    setSlots(prev => prev.filter(s => s.id !== slot.id));
    setSelectedSlotIds(prev => { const n = new Set(prev); n.delete(slot.id); return n; });
    if (slot.id === anchorSlotId) {
      const remaining = slots.filter(s => s.id !== slot.id);
      setAnchorSlotId(remaining.length > 0 ? remaining[0].id : null);
    }
  }, [slotAnnotations, ownedAnnotationIds, unlockedSlots, anchorSlotId, slots, onDocumentCheckin, viewLocked]);

  // Remove all slots for a file from canvas
  const removeFileFromCanvas = useCallback((fileId) => {
    if (viewLocked) return;
    const fileSlots = slots.filter(s => s.fileId === fileId);
    if (fileSlots.length === 0) return;
    
    // Check for unsaved changes across any slot
    const hasAnyChanges = fileSlots.some(slot => {
      const anns = slotAnnotations[slot.id] || [];
      const ownedIds = ownedAnnotationIds[slot.id] || new Set();
      return anns.some(a => !a.fromPdf) || ownedIds.size > 0;
    });
    
    if (hasAnyChanges) {
      if (!window.confirm(`This document has unsaved changes on ${fileSlots.length} page(s).\n\nRemove all? All unsaved changes will be lost.`)) return;
    }
    
    const idsToRemove = new Set(fileSlots.map(s => s.id));
    fileSlots.forEach(s => { if (s.blobUrl) URL.revokeObjectURL(s.blobUrl); });
    setSlotAnnotations(prev => { const n = { ...prev }; idsToRemove.forEach(id => delete n[id]); return n; });
    setOwnedAnnotationIds(prev => { const n = { ...prev }; idsToRemove.forEach(id => delete n[id]); return n; });
    fileSlots.forEach(s => { if (unlockedSlots.has(s.id)) onDocumentCheckin?.(s.fileId); });
    setUnlockedSlots(prev => { const n = new Set(prev); idsToRemove.forEach(id => n.delete(id)); return n; });
    setSlots(prev => prev.filter(s => !idsToRemove.has(s.id)));
    setSelectedSlotIds(prev => { const n = new Set(prev); idsToRemove.forEach(id => n.delete(id)); return n; });
    if (idsToRemove.has(anchorSlotId)) {
      const remaining = slots.filter(s => !idsToRemove.has(s.id));
      setAnchorSlotId(remaining.length > 0 ? remaining[0].id : null);
    }
  }, [slots, slotAnnotations, ownedAnnotationIds, unlockedSlots, anchorSlotId, onDocumentCheckin, viewLocked]);

  // Remove all slots from canvas
  const removeAllFromCanvas = useCallback(() => {
    if (viewLocked) return;
    if (slots.length === 0) return;
    
    const hasAnyChanges = slots.some(slot => {
      const anns = slotAnnotations[slot.id] || [];
      const ownedIds = ownedAnnotationIds[slot.id] || new Set();
      return anns.some(a => !a.fromPdf) || ownedIds.size > 0;
    });
    
    const msg = hasAnyChanges
      ? `Remove all ${slots.length} document(s) from canvas?\n\nSome have unsaved changes that will be lost.`
      : `Remove all ${slots.length} document(s) from canvas?`;
    if (!window.confirm(msg)) return;
    
    slots.forEach(s => { if (s.blobUrl) URL.revokeObjectURL(s.blobUrl); });
    slots.forEach(s => { if (unlockedSlots.has(s.id)) onDocumentCheckin?.(s.fileId); });
    setSlotAnnotations({});
    setOwnedAnnotationIds({});
    setUnlockedSlots(new Set());
    setSlots([]);
    setSelectedSlotIds(new Set());
    setAnchorSlotId(null);
  }, [slots, slotAnnotations, ownedAnnotationIds, unlockedSlots, onDocumentCheckin, viewLocked]);

  // Batch add — optimised: deduplicates file fetches, single state update
  const handleBatchAdd = useCallback(async ({ items, cols, gap, originX: passedOriginX, originY: passedOriginY }) => {
    if (items.length === 0) return;
    
    const defaultW = 800;
    const defaultH = 600;
    
    // Use passed origin if provided, otherwise auto-place to the right
    let originX, originY;
    if (passedOriginX != null && passedOriginY != null) {
      originX = passedOriginX;
      originY = passedOriginY;
    } else {
      originX = 0;
      originY = 0;
      if (slots.length > 0) {
        let maxRight = -Infinity;
        let minTop = Infinity;
        slots.forEach(s => {
          const right = s.x + (s.width || defaultW);
          if (right > maxRight) maxRight = right;
          if (s.y < minTop) minTop = s.y;
        });
        originX = maxRight + Math.max(gap, 80);
        originY = minTop;
      }
    }
    
    // Filter out items already on canvas
    const itemsToLoad = items.filter(({ file, page }) => 
      !slots.some(s => s.fileId === file.id && s.page === page)
    );
    if (itemsToLoad.length === 0) return;
    
    // ── Deduplicate: group items by fileId, fetch each file only once ──
    const fileGroups = new Map(); // fileId -> { file, pages: [page, ...] }
    itemsToLoad.forEach(({ file, page }) => {
      if (!fileGroups.has(file.id)) {
        fileGroups.set(file.id, { file, pages: [] });
      }
      fileGroups.get(file.id).pages.push(page);
    });
    
    // Fetch & parse each unique file (throttled to 4 concurrent)
    const fileCache = new Map(); // fileId -> { pdfDoc, arrayBuffer, blobUrl }
    const fileIds = [...fileGroups.keys()];
    const CONCURRENCY = 4;
    
    for (let i = 0; i < fileIds.length; i += CONCURRENCY) {
      const batch = fileIds.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (fileId) => {
        const { file } = fileGroups.get(fileId);
        try {
          const response = await fetch(getPdfFetchUrl(file));
          const blob = await response.blob();
          const arrayBuffer = await blob.arrayBuffer();
          const blobUrl = URL.createObjectURL(blob);
          fileCache.set(fileId, { arrayBuffer, blobUrl });
        } catch (err) {
          console.error(`Batch load failed for ${file.name}:`, err);
        }
      }));
    }
    
    // ── Build all slots, dimensions, and annotations in one pass ──
    const newSlots = [];
    const allAnnotations = {};
    const newPageCounts = {};
    const timestamp = Date.now();
    
    for (let idx = 0; idx < itemsToLoad.length; idx++) {
      const { file, page } = itemsToLoad[idx];
      const cached = fileCache.get(file.id);
      if (!cached) continue;
      
      const slotId = `${file.id}_page_${page}_${timestamp}_${idx}`;
      
      // Create a SEPARATE pdfDoc for each slot to avoid concurrent render conflicts.
      // PDF.js cannot handle multiple simultaneous render tasks on the same document.
      let slotPdfDoc;
      try {
        slotPdfDoc = await window.pdfjsLib.getDocument({ data: cached.arrayBuffer.slice(0) }).promise;
      } catch (err) {
        console.error(`Failed to create pdfDoc for slot ${slotId}:`, err);
        continue;
      }
      
      // Get page dimensions from viewport
      let width = defaultW, height = defaultH;
      try {
        const pdfPage = await slotPdfDoc.getPage(page);
        const viewport = pdfPage.getViewport({ scale: 1.5 });
        width = viewport.width;
        height = viewport.height;
      } catch (err) {
        console.warn(`Failed to get dimensions for ${file.name} page ${page}:`, err);
      }
      
      // Load annotations
      try {
        const pdfAnnotations = await loadPdfAnnotations(slotPdfDoc, page, slotId, 1.5);
        if (pdfAnnotations.length > 0) {
          allAnnotations[slotId] = pdfAnnotations;
        }
      } catch (err) {
        console.warn(`Failed to load annotations for ${file.name} page ${page}:`, err);
      }
      
      newPageCounts[file.id] = slotPdfDoc.numPages;
      
      newSlots.push({
        id: slotId,
        fileId: file.id,
        backendFilename: file.backendFilename,
        sourceFolder: file.sourceFolder || null,
        fileName: file.name,
        page,
        pdfDoc: slotPdfDoc,
        numPages: slotPdfDoc.numPages,
        blobUrl: cached.blobUrl,
        pdfBytes: cached.arrayBuffer,
        x: 0, y: 0, // Positioned below
        width, height,
      });
    }
    
    if (newSlots.length === 0) return;
    
    // ── Compute grid cell size from actual dimensions ──
    const maxW = Math.max(...newSlots.map(s => s.width));
    const maxH = Math.max(...newSlots.map(s => s.height));
    const cellW = maxW + gap;
    const cellH = maxH + gap;
    
    // Position all slots into grid
    newSlots.forEach((slot, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      slot.x = originX + col * cellW;
      slot.y = originY + row * cellH;
    });
    
    // ══ SINGLE batch state update — no per-slot re-renders ══
    setSlots(prev => [...prev, ...newSlots]);
    setSlotAnnotations(prev => ({ ...prev, ...allAnnotations }));
    setFilePageCounts(prev => ({ ...prev, ...newPageCounts }));
    
    // Select all newly added and zoom to fit
    const newIds = new Set(newSlots.map(s => s.id));
    setSelectedSlotIds(newIds);
    setAnchorSlotId(newSlots[0].id);
    
    const totalRows = Math.ceil(newSlots.length / cols);
    const batchW = cols * cellW - gap;
    const batchH = totalRows * cellH - gap;
    const batchCenterX = originX + batchW / 2;
    const batchCenterY = originY + batchH / 2;
    
    setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const targetZoom = Math.min(0.5, (rect.width * 0.8) / batchW, (rect.height * 0.8) / batchH);
      
      setIsAnimating(true);
      setZoom(targetZoom);
      setCanvasPosition({
        x: -batchCenterX * targetZoom,
        y: -batchCenterY * targetZoom,
      });
      setTimeout(() => setIsAnimating(false), 600);
    }, 100);
  }, [slots, containerRef]);

  // Documents panel — select annotation from list
  const handlePanelSelectAnnotation = (ann, slotId) => {
    setSelectedAnnotation({ ...ann, slotId });
    const slot = slots.find(s => s.id === slotId);
    if (slot) zoomToSlot(slot, 0.5);
  };

  // Documents panel — delete annotation from list
  const handlePanelDeleteAnnotation = (slotId, annotationId) => {
    setSlotAnnotations(prev => ({
      ...prev,
      [slotId]: (prev[slotId] || []).filter(a => a.id !== annotationId)
    }));
    if (selectedAnnotation?.id === annotationId) {
      setSelectedAnnotation(null);
    }
  };

  // Documents panel — file click in "All" tab
  const handleFileClick = (file, loadedSlot) => {
    if (loadedSlot) {
      // Navigate to the loaded PDF
      zoomToSlot(loadedSlot, 0.35);
      setAnchorSlotId(loadedSlot.id);
      setSelectedSlotIds(new Set([loadedSlot.id]));
    } else {
      // View is locked — don't add new documents
      if (viewLocked) return;
      
      // Add next to the active/anchor slot, or last slot, or at origin
      const anchorSlot = slots.find(s => s.id === anchorSlotId);
      const referenceSlot = anchorSlot || slots[slots.length - 1];
      
      if (referenceSlot) {
        const slotWidth = referenceSlot.width || 800;
        const slotHeight = referenceSlot.height || 600;
        const gap = 100;
        const targetX = referenceSlot.x + slotWidth + gap;
        const targetY = referenceSlot.y;
        const { x, y, slotsToMove } = findSmartPosition(targetX, targetY, slotWidth, slotHeight, referenceSlot);
        applySlotMovements(slotsToMove);
        loadPdfAtPosition(file, 1, x, y);
      } else {
        loadPdfAtPosition(file, 1, 0, 0);
      }
    }
  };

  // Add a specific page of a file to the canvas
  const handleAddPage = (file, pageNum) => {
    // Check if this exact page is already on canvas
    const existingSlot = slots.find(s => s.fileId === file.id && s.page === pageNum);
    if (existingSlot) {
      // Navigate to it instead
      zoomToSlot(existingSlot, 0.35);
      setAnchorSlotId(existingSlot.id);
      setSelectedSlotIds(new Set([existingSlot.id]));
      return;
    }

    // View is locked — don't add new pages
    if (viewLocked) return;

    // Place next to anchor/last slot
    const anchorSlot = slots.find(s => s.id === anchorSlotId);
    const referenceSlot = anchorSlot || slots[slots.length - 1];
    
    if (referenceSlot) {
      const slotWidth = referenceSlot.width || 800;
      const slotHeight = referenceSlot.height || 600;
      const gap = 100;
      const targetX = referenceSlot.x + slotWidth + gap;
      const targetY = referenceSlot.y;
      const { x, y, slotsToMove } = findSmartPosition(targetX, targetY, slotWidth, slotHeight, referenceSlot);
      applySlotMovements(slotsToMove);
      loadPdfAtPosition(file, pageNum, x, y);
    } else {
      loadPdfAtPosition(file, pageNum, 0, 0);
    }
  };

  // Lightweight fetch to get page count without rendering
  const handleFetchPageCount = async (file) => {
    if (filePageCounts[file.id]) return filePageCounts[file.id];
    try {
      const response = await fetch(getPdfFetchUrl(file));
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const loadedPdf = await window.pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
      const count = loadedPdf.numPages;
      loadedPdf.destroy(); // Clean up - we only needed the count
      setFilePageCounts(prev => ({ ...prev, [file.id]: count }));
      return count;
    } catch (error) {
      console.error('Error fetching page count:', error);
      return null;
    }
  };

  // Helper: reload a slot's PDF from backend (used by lock flows)
  const reloadSlotPdf = async (slot) => {
    await new Promise(resolve => setTimeout(resolve, 200));
    const sfParam = slot.sourceFolder ? `&sourceFolder=${encodeURIComponent(slot.sourceFolder)}` : '';
    const response = await fetch(`${BACKEND_URL}/api/files/${encodeURIComponent(slot.backendFilename)}?t=${Date.now()}${sfParam}`);
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const newUrl = URL.createObjectURL(blob);
    const newPdfDoc = await window.pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
    const pdfAnnotations = await loadPdfAnnotations(newPdfDoc, slot.page, slot.id, 1.5);
    
    setSlots(prev => prev.map(s => s.id === slot.id ? {
      ...s,
      pdfDoc: newPdfDoc,
      blobUrl: newUrl,
      pdfBytes: arrayBuffer,
      renderKey: (s.renderKey || 0) + 1
    } : s));
    
    setSlotAnnotations(prev => ({
      ...prev,
      [slot.id]: pdfAnnotations
    }));
  };

  // Helper: force-save any text being edited
  const forceCommitEditingText = () => {
    if (!editingTextId) return;
    for (const slot of slots) {
      const editingAnnIndex = (slotAnnotations[slot.id] || []).findIndex(a => a.id === editingTextId);
      if (editingAnnIndex >= 0) {
        const activeElement = document.activeElement;
        const currentText = (activeElement?.tagName === 'TEXTAREA' ? activeElement.value : null) 
          || slotAnnotations[slot.id][editingAnnIndex].text || '';
        setSlotAnnotations(prev => ({
          ...prev,
          [slot.id]: (prev[slot.id] || []).map(a => 
            a.id === editingTextId ? { ...a, text: currentText } : a
          )
        }));
        break;
      }
    }
    setEditingTextId(null);
  };

  // Helper: lock a single slot (clear state + check in)
  const lockSlot = (slot) => {
    setUnlockedSlots(prev => {
      const next = new Set(prev);
      next.delete(slot.id);
      return next;
    });
    if (selectedAnnotation?.slotId === slot.id) {
      setSelectedAnnotation(null);
    }
    setMarkupMode(null);
    onDocumentCheckin?.(slot.fileId);
  };

  // Helper: clear annotations/ownership for a slot
  const clearSlotAnnotations = (slotId) => {
    setSlotAnnotations(prev => ({ ...prev, [slotId]: [] }));
    setOwnedAnnotationIds(prev => ({ ...prev, [slotId]: new Set() }));
  };

  // Helper: discard changes for a slot (keep only unowned PDF annotations)
  const discardSlotChanges = (slotId) => {
    const ownedIds = ownedAnnotationIds[slotId] || new Set();
    setSlotAnnotations(prev => ({
      ...prev,
      [slotId]: (prev[slotId] || []).filter(a => a.fromPdf && !ownedIds.has(a.id))
    }));
    setOwnedAnnotationIds(prev => ({ ...prev, [slotId]: new Set() }));
  };

  // Documents panel — toggle lock on a single slot
  const handleToggleSlotLock = async (slot) => {
    const isUnlocked = unlockedSlots.has(slot.id);
    const isCheckedOutElsewhere = checkedOutDocuments[slot.fileId] && checkedOutDocuments[slot.fileId] !== 'infiniteview';
    
    if (isCheckedOutElsewhere) {
      alert(`This document is currently being edited in ${checkedOutDocuments[slot.fileId] === 'pdfviewer' ? 'PDF Viewer' : 'another view'}. Please close it there first.`);
      return;
    }
    
    if (isUnlocked) {
      // Get current annotations (force-commit any editing text first)
      let currentAnns = [...(slotAnnotations[slot.id] || [])];
      if (editingTextId) {
        const editingAnnIndex = currentAnns.findIndex(a => a.id === editingTextId);
        if (editingAnnIndex >= 0) {
          const activeElement = document.activeElement;
          const currentText = (activeElement?.tagName === 'TEXTAREA' ? activeElement.value : null)
            || currentAnns[editingAnnIndex].text || '';
          currentAnns[editingAnnIndex] = { ...currentAnns[editingAnnIndex], text: currentText };
          setSlotAnnotations(prev => ({ ...prev, [slot.id]: currentAnns }));
          setEditingTextId(null);
        }
      }
      
      // Check for unsaved changes
      const ownedIds = ownedAnnotationIds[slot.id] || new Set();
      const newAnnotations = currentAnns.filter(a => !a.fromPdf);
      const modifiedAnnotations = currentAnns.filter(a => a.fromPdf && ownedIds.has(a.id));
      const hasUnsavedChanges = newAnnotations.length > 0 || modifiedAnnotations.length > 0;
      
      if (hasUnsavedChanges) {
        const saveChanges = window.confirm(
          `You have unsaved changes (${newAnnotations.length} new, ${modifiedAnnotations.length} modified).\n\nDo you want to save changes?\n\nClick OK to save, or Cancel to discard changes.`
        );
        
        if (saveChanges) {
          try {
            const result = await saveSlotAnnotationsToPdf(
              slot, currentAnns, ownedIds, slot.width || 800, slot.height || 600
            );
            if (!result.success) {
              alert('Failed to save changes: ' + (result.error || 'Unknown error'));
              return;
            }
            clearSlotAnnotations(slot.id);
            try { await reloadSlotPdf(slot); } catch (err) {
              console.warn('PDF saved but failed to reload:', err);
              alert('Changes saved successfully!\n\nNote: Please close and reopen the document to see the saved annotations.');
            }
            lockSlot(slot);
          } catch (err) {
            console.error('Failed to save:', err);
            alert('Failed to save changes: ' + err.message);
            return;
          }
        } else {
          const discardConfirm = window.confirm('Are you sure you want to discard all unsaved changes?\n\nThis cannot be undone.');
          if (discardConfirm) {
            discardSlotChanges(slot.id);
            try { await reloadSlotPdf(slot); } catch (err) {
              console.warn('Failed to reload PDF:', err);
            }
            lockSlot(slot);
          }
          // If user cancels discard, stay in edit mode
        }
      } else {
        // No unsaved changes — just lock
        lockSlot(slot);
      }
    } else {
      // Unlocking — check out the document
      setUnlockedSlots(prev => {
        const next = new Set(prev);
        next.add(slot.id);
        return next;
      });
      onDocumentCheckout?.(slot.fileId, 'infiniteview');
    }
  };

  // Documents panel — toggle all locks
  const handleToggleAllLocks = async () => {
    const allUnlocked = slots.every(slot => unlockedSlots.has(slot.id));
    
    if (allUnlocked) {
      // Force-commit editing text
      if (editingTextId) {
        forceCommitEditingText();
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Check for unsaved changes
      const slotsWithChanges = slots.filter(slot => {
        if (!unlockedSlots.has(slot.id)) return false;
        const annotations = slotAnnotations[slot.id] || [];
        const ownedIds = ownedAnnotationIds[slot.id] || new Set();
        return annotations.some(a => !a.fromPdf) || ownedIds.size > 0;
      });
      
      if (slotsWithChanges.length > 0) {
        const saveChanges = window.confirm(
          `${slotsWithChanges.length} document${slotsWithChanges.length > 1 ? 's have' : ' has'} unsaved changes:\n\n` +
          slotsWithChanges.map(s => `• ${s.fileName}`).join('\n') +
          '\n\nDo you want to SAVE all changes?\n\nClick OK to save, or Cancel to discard changes.'
        );
        
        if (saveChanges) {
          let savedCount = 0;
          let failedCount = 0;
          
          for (const slot of slotsWithChanges) {
            try {
              const slotAnns = slotAnnotations[slot.id] || [];
              const ownedIds = ownedAnnotationIds[slot.id] || new Set();
              const result = await saveSlotAnnotationsToPdf(
                slot, slotAnns, ownedIds, slot.width || 800, slot.height || 600
              );
              if (result.success) {
                savedCount++;
                clearSlotAnnotations(slot.id);
                try { await reloadSlotPdf(slot); } catch (err) {
                  console.warn('PDF saved but failed to reload:', slot.fileName, err);
                }
              } else {
                failedCount++;
                console.error('Failed to save:', slot.fileName, result.error);
              }
            } catch (err) {
              failedCount++;
              console.error('Error saving:', slot.fileName, err);
            }
          }
          
          if (failedCount > 0) {
            alert(`Saved ${savedCount} document(s), but ${failedCount} failed to save.\n\nPlease check the console for details.`);
            return;
          }
        } else {
          const discardConfirm = window.confirm('Are you sure you want to discard all unsaved changes?\n\nThis cannot be undone.');
          if (!discardConfirm) return;
          
          slotsWithChanges.forEach(slot => {
            discardSlotChanges(slot.id);
          });
        }
      }
      
      // Lock all and check them in
      slots.forEach(slot => {
        if (unlockedSlots.has(slot.id)) {
          onDocumentCheckin?.(slot.fileId);
        }
      });
      setUnlockedSlots(new Set());
      setSelectedAnnotation(null);
      setMarkupMode(null);
    } else {
      // Unlock all — skip ones checked out elsewhere
      const newUnlocked = new Set(unlockedSlots);
      slots.forEach(slot => {
        const isCheckedOutElsewhere = checkedOutDocuments[slot.fileId] && checkedOutDocuments[slot.fileId] !== 'infiniteview';
        if (!isCheckedOutElsewhere) {
          newUnlocked.add(slot.id);
          onDocumentCheckout?.(slot.fileId, 'infiniteview');
        }
      });
      setUnlockedSlots(newUnlocked);
    }
  };

  // ═══════════════════════════════════════════════════════
  // CANVAS SHAPES - view-level decorations
  // ═══════════════════════════════════════════════════════
  
  const addCanvasShape = useCallback((type) => {
    if (viewLocked) return;
    
    // Calculate center of viewport in canvas coordinates
    const vcx = -canvasPosition.x / zoom;
    const vcy = -canvasPosition.y / zoom;
    
    const defaults = {
      rectangle: { width: 200, height: 150, fillColor: '#3498db', fillOpacity: 15, borderColor: '#3498db', borderWidth: 2 },
      text:      { width: 250, height: 60,  fillColor: '#1a1a2e', fillOpacity: 90,  borderColor: '#3498db', borderWidth: 1, text: 'Text', fontSize: 18, textColor: '#ffffff', fontFamily: 'Arial' },
      arrow:     { width: 200, height: 0,   fillColor: 'none',    fillOpacity: 0,    borderColor: '#e74c3c', borderWidth: 2 },
      line:      { width: 200, height: 0,   fillColor: 'none',    fillOpacity: 0,    borderColor: '#f39c12', borderWidth: 3 },
      circle:    { width: 150, height: 150, fillColor: '#9b59b6', fillOpacity: 15, borderColor: '#9b59b6', borderWidth: 2 },
      polyline:  { width: 200, height: 80,  fillColor: 'none',    fillOpacity: 0,    borderColor: '#2ecc71', borderWidth: 3 },
    };
    const d = defaults[type] || defaults.rectangle;
    
    const shape = {
      id: `cshape_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      x: vcx - d.width / 2,
      y: vcy - d.height / 2,
      ...d,
      title: '',
      borderStyle: 'solid',
    };
    
    // Polylines need a points array (absolute canvas coords)
    if (type === 'polyline') {
      shape.points = [
        { x: shape.x, y: shape.y + d.height },
        { x: shape.x + d.width / 2, y: shape.y },
        { x: shape.x + d.width, y: shape.y + d.height },
      ];
    }
    
    setCanvasShapes(prev => [...prev, shape]);
    setSelectedCanvasShapeId(shape.id);
  }, [canvasPosition, zoom, viewLocked]);
  
  const updateCanvasShape = useCallback((shapeId, updates) => {
    if (viewLocked) return;
    setCanvasShapes(prev => prev.map(s => s.id === shapeId ? { ...s, ...updates } : s));
  }, [viewLocked]);
  
  const deleteCanvasShape = useCallback((shapeId) => {
    if (viewLocked) return;
    setCanvasShapes(prev => prev.filter(s => s.id !== shapeId));
    if (selectedCanvasShapeId === shapeId) setSelectedCanvasShapeId(null);
    if (editingShapeTextId === shapeId) setEditingShapeTextId(null);
  }, [selectedCanvasShapeId, editingShapeTextId, viewLocked]);

  // ─── Polyline drawing mode ─────────────────────────────
  const startDrawPolyline = useCallback(() => {
    if (viewLocked) return;
    setDrawingPolylinePoints([]);
    setDrawingPolylineHover(null);
    setCurrentTool('drawPolyline');
    setSelectedCanvasShapeId(null);
  }, [viewLocked]);
  
  const finishDrawPolyline = useCallback(() => {
    const pts = drawingPolylinePoints;
    if (pts && pts.length >= 2) {
      let minX = Infinity, minY = Infinity;
      pts.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); });
      const shape = {
        id: `cshape_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'polyline',
        x: minX, y: minY,
        width: 0, height: 0,
        fillColor: 'none', fillOpacity: 0,
        borderColor: '#2ecc71', borderWidth: 3,
        borderStyle: 'solid',
        title: '',
        points: pts.map(p => ({ ...p })),
      };
      setCanvasShapes(prev => [...prev, shape]);
      setSelectedCanvasShapeId(shape.id);
    }
    setDrawingPolylinePoints(null);
    setDrawingPolylineHover(null);
    setCurrentTool('select');
  }, [drawingPolylinePoints]);
  
  const cancelDrawPolyline = useCallback(() => {
    setDrawingPolylinePoints(null);
    setDrawingPolylineHover(null);
    setCurrentTool('select');
  }, []);

  // ─── Shape drag/resize handlers ──────────────────────
  const handleShapeMouseDown = useCallback((e, shapeId, handle = null) => {
    e.stopPropagation();
    e.preventDefault();
    const shape = canvasShapes.find(s => s.id === shapeId);
    if (!shape) return;
    
    setSelectedCanvasShapeId(shapeId);
    
    // When view is locked, allow selection but block drag/resize
    if (viewLocked) return;
    
    if (handle) {
      setResizingShapeId(shapeId);
      setShapeInteractionStart({
        x: e.clientX, y: e.clientY,
        origX: shape.x, origY: shape.y,
        origW: shape.width, origH: shape.height,
        origPoints: shape.points ? shape.points.map(p => ({ ...p })) : null,
        shapeType: shape.type,
        handle,
      });
    } else {
      setDraggingShapeId(shapeId);
      setShapeInteractionStart({
        x: e.clientX, y: e.clientY,
        origX: shape.x, origY: shape.y,
        origW: shape.width, origH: shape.height,
        origPoints: shape.points ? shape.points.map(p => ({ ...p })) : null,
        shapeType: shape.type,
        handle: null,
      });
    }
  }, [canvasShapes, viewLocked]);

  useEffect(() => {
    if (!draggingShapeId && !resizingShapeId) return;
    
    // Track last mouse position for delta-based multi-drag
    let lastX = shapeInteractionStart?.x || 0;
    let lastY = shapeInteractionStart?.y || 0;
    
    const handleMove = (e) => {
      if (!shapeInteractionStart) return;
      const dx = (e.clientX - shapeInteractionStart.x) / zoom;
      const dy = (e.clientY - shapeInteractionStart.y) / zoom;
      const id = draggingShapeId || resizingShapeId;
      
      if (draggingShapeId) {
        // Check if this shape is part of a multi-selection
        const isMulti = selectedShapeIds.has(draggingShapeId) && (selectedShapeIds.size > 1 || selectedSlotIds.size > 0);
        
        if (isMulti) {
          // Move all selected shapes by delta since last frame
          const frameDx = (e.clientX - lastX) / zoom;
          const frameDy = (e.clientY - lastY) / zoom;
          lastX = e.clientX;
          lastY = e.clientY;
          
          setCanvasShapes(prev => prev.map(s => {
            if (!selectedShapeIds.has(s.id)) return s;
            const updated = { ...s, x: s.x + frameDx, y: s.y + frameDy };
            if (s.points) updated.points = s.points.map(p => ({ x: p.x + frameDx, y: p.y + frameDy }));
            return updated;
          }));
          // Also move selected slots
          if (selectedSlotIds.size > 0) {
            setSlots(prev => prev.map(s => 
              selectedSlotIds.has(s.id) ? { ...s, x: s.x + frameDx, y: s.y + frameDy } : s
            ));
          }
        } else {
          // Single shape drag
          const updated = {
            x: shapeInteractionStart.origX + dx,
            y: shapeInteractionStart.origY + dy,
          };
          // Move polyline points too
          if (shapeInteractionStart.origPoints) {
            updated.points = shapeInteractionStart.origPoints.map(p => ({ x: p.x + dx, y: p.y + dy }));
          }
          updateCanvasShape(id, updated);
        }
      } else if (resizingShapeId && shapeInteractionStart.handle) {
        const h = shapeInteractionStart.handle;
        const shapeType = shapeInteractionStart.shapeType;
        
        // Polyline point dragging
        if (h.startsWith('pt-') && shapeInteractionStart.origPoints) {
          const ptIdx = parseInt(h.slice(3));
          if (ptIdx >= 0 && ptIdx < shapeInteractionStart.origPoints.length) {
            let rawPt = { x: shapeInteractionStart.origPoints[ptIdx].x + dx, y: shapeInteractionStart.origPoints[ptIdx].y + dy };
            // Snap to adjacent point if Shift held
            if (e.shiftKey) {
              const pts = shapeInteractionStart.origPoints;
              const refPt = ptIdx > 0 ? pts[ptIdx - 1] : (ptIdx < pts.length - 1 ? pts[ptIdx + 1] : null);
              if (refPt) rawPt = snapPoint(refPt, rawPt, true);
            }
            const newPoints = shapeInteractionStart.origPoints.map((p, i) => 
              i === ptIdx ? rawPt : { ...p }
            );
            updateCanvasShape(id, { points: newPoints });
          }
          return;
        }
        
        // Arrow/line endpoints — no min clamp, allow any direction + snap
        if (shapeType === 'arrow' || shapeType === 'line') {
          if (h === 'nw') {
            // Dragging start point, snap relative to end point
            let startPt = { x: shapeInteractionStart.origX + dx, y: shapeInteractionStart.origY + dy };
            if (e.shiftKey) {
              const endPt = { x: shapeInteractionStart.origX + shapeInteractionStart.origW, y: shapeInteractionStart.origY + shapeInteractionStart.origH };
              startPt = snapPoint(endPt, startPt, true);
            }
            updateCanvasShape(id, { x: startPt.x, y: startPt.y, width: shapeInteractionStart.origX + shapeInteractionStart.origW - startPt.x, height: shapeInteractionStart.origY + shapeInteractionStart.origH - startPt.y });
          } else if (h === 'se') {
            // Dragging end point, snap relative to start point
            let endPt = { x: shapeInteractionStart.origX + shapeInteractionStart.origW + dx, y: shapeInteractionStart.origY + shapeInteractionStart.origH + dy };
            if (e.shiftKey) {
              const startPt = { x: shapeInteractionStart.origX, y: shapeInteractionStart.origY };
              endPt = snapPoint(startPt, endPt, true);
            }
            updateCanvasShape(id, { width: endPt.x - shapeInteractionStart.origX, height: endPt.y - shapeInteractionStart.origY });
          }
          return;
        }
        
        let newX = shapeInteractionStart.origX;
        let newY = shapeInteractionStart.origY;
        let newW = shapeInteractionStart.origW;
        let newH = shapeInteractionStart.origH;
        
        if (h.includes('e')) newW = Math.max(20, shapeInteractionStart.origW + dx);
        if (h.includes('w')) { newW = Math.max(20, shapeInteractionStart.origW - dx); newX = shapeInteractionStart.origX + dx; }
        if (h.includes('s')) newH = Math.max(20, shapeInteractionStart.origH + dy);
        if (h.includes('n')) { newH = Math.max(20, shapeInteractionStart.origH - dy); newY = shapeInteractionStart.origY + dy; }
        
        updateCanvasShape(id, { x: newX, y: newY, width: newW, height: newH });
      }
    };
    
    const handleUp = () => {
      setDraggingShapeId(null);
      setResizingShapeId(null);
      setShapeInteractionStart(null);
    };
    
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [draggingShapeId, resizingShapeId, shapeInteractionStart, zoom, updateCanvasShape, selectedShapeIds, selectedSlotIds]);

  // Deselect shape when clicking canvas background
  useEffect(() => {
    if (!selectedCanvasShapeId) return;
    const handler = (e) => {
      if (!e.target.closest('.canvas-shape') && !e.target.closest('.smart-links-panel')) {
        setSelectedCanvasShapeId(null);
        setEditingShapeTextId(null);
      }
    };
    const el = containerRef.current;
    if (el) el.addEventListener('mousedown', handler);
    return () => { if (el) el.removeEventListener('mousedown', handler); };
  }, [selectedCanvasShapeId]);

  // Delete shape on Delete/Backspace key
  useEffect(() => {
    if (!selectedCanvasShapeId || editingShapeTextId) return;
    const handler = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't delete if user is typing in an input/textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
        deleteCanvasShape(selectedCanvasShapeId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedCanvasShapeId, editingShapeTextId, deleteCanvasShape]);

  // Polyline drawing: Escape cancels, Enter finishes
  useEffect(() => {
    if (currentTool !== 'drawPolyline') return;
    const handler = (e) => {
      if (e.key === 'Escape') { cancelDrawPolyline(); }
      else if (e.key === 'Enter') { finishDrawPolyline(); }
      // Backspace removes last placed point
      else if (e.key === 'Backspace' && drawingPolylinePoints && drawingPolylinePoints.length > 0) {
        e.preventDefault();
        setDrawingPolylinePoints(prev => prev ? prev.slice(0, -1) : prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentTool, drawingPolylinePoints, finishDrawPolyline, cancelDrawPolyline]);

  // ─── Copy / Paste canvas shapes ────────────────────────
  const copiedShapesRef = useRef(null);
  
  useEffect(() => {
    const handler = (e) => {
      // Ignore if user is typing
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      
      // Copy: Ctrl/Cmd+C
      if (e.key === 'c') {
        // Gather shapes to copy: single selected or box-selected
        const shapesToCopy = [];
        if (selectedShapeIds.size > 0) {
          canvasShapes.forEach(s => { if (selectedShapeIds.has(s.id)) shapesToCopy.push(s); });
        } else if (selectedCanvasShapeId) {
          const s = canvasShapes.find(s => s.id === selectedCanvasShapeId);
          if (s) shapesToCopy.push(s);
        }
        if (shapesToCopy.length > 0) {
          copiedShapesRef.current = shapesToCopy.map(s => ({ ...s, points: s.points ? s.points.map(p => ({ ...p })) : undefined }));
        }
      }
      
      // Paste: Ctrl/Cmd+V
      if (e.key === 'v' && copiedShapesRef.current && copiedShapesRef.current.length > 0 && !viewLocked) {
        e.preventDefault();
        const offset = 30 / zoom; // offset pasted shapes slightly
        const newIds = new Set();
        const newShapes = copiedShapesRef.current.map(orig => {
          const newId = `cshape_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          newIds.add(newId);
          const clone = {
            ...orig,
            id: newId,
            x: orig.x + offset,
            y: orig.y + offset,
          };
          if (orig.points) {
            clone.points = orig.points.map(p => ({ x: p.x + offset, y: p.y + offset }));
          }
          return clone;
        });
        setCanvasShapes(prev => [...prev, ...newShapes]);
        // Select pasted shapes
        if (newShapes.length === 1) {
          setSelectedCanvasShapeId(newShapes[0].id);
          setSelectedShapeIds(new Set());
        } else {
          setSelectedCanvasShapeId(null);
          setSelectedShapeIds(newIds);
        }
        // Update clipboard so next paste offsets further
        copiedShapesRef.current = newShapes.map(s => ({ ...s, points: s.points ? s.points.map(p => ({ ...p })) : undefined }));
      }
      
      // Duplicate: Ctrl/Cmd+D
      if (e.key === 'd' && !viewLocked) {
        e.preventDefault();
        const shapesToDupe = [];
        if (selectedShapeIds.size > 0) {
          canvasShapes.forEach(s => { if (selectedShapeIds.has(s.id)) shapesToDupe.push(s); });
        } else if (selectedCanvasShapeId) {
          const s = canvasShapes.find(s => s.id === selectedCanvasShapeId);
          if (s) shapesToDupe.push(s);
        }
        if (shapesToDupe.length > 0) {
          const offset = 30 / zoom;
          const newIds = new Set();
          const newShapes = shapesToDupe.map(orig => {
            const newId = `cshape_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            newIds.add(newId);
            const clone = { ...orig, id: newId, x: orig.x + offset, y: orig.y + offset };
            if (orig.points) {
              clone.points = orig.points.map(p => ({ x: p.x + offset, y: p.y + offset }));
            }
            return clone;
          });
          setCanvasShapes(prev => [...prev, ...newShapes]);
          if (newShapes.length === 1) {
            setSelectedCanvasShapeId(newShapes[0].id);
            setSelectedShapeIds(new Set());
          } else {
            setSelectedCanvasShapeId(null);
            setSelectedShapeIds(newIds);
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canvasShapes, selectedCanvasShapeId, selectedShapeIds, zoom]);

  // ═══════════════════════════════════════════════════════
  // SAVED VIEWS - save/load canvas state to project
  // ═══════════════════════════════════════════════════════
  
  const savedViews = project?.savedViews || [];
  const savedBatches = project?.savedBatches || [];

  const handleSaveView = useCallback((name) => {
    const view = {
      id: `view_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      createdDate: new Date().toISOString(),
      zoom,
      panX: canvasPosition.x,
      panY: canvasPosition.y,
      // Crop state
      cropRegion: cropRegion || null,
      cropEnabled: cropEnabled,
      slotCount: slots.length,
      shapeCount: canvasShapes.length,
      slots: slots.map(s => ({
        fileId: s.fileId,
        page: s.page,
        x: s.x,
        y: s.y,
        width: s.width,
        height: s.height,
        fileName: s.fileName,
        numPages: s.numPages,
        backendFilename: s.backendFilename,
        sourceFolder: s.sourceFolder || null,
      })),
      canvasShapes: canvasShapes.map(s => ({ ...s })),
    };
    
    const updated = [...savedViews, view];
    if (onProjectUpdate) {
      onProjectUpdate({ ...project, savedViews: updated });
    }
  }, [zoom, canvasPosition, slots, canvasShapes, savedViews, project, onProjectUpdate, cropRegion, cropEnabled]);

  const handleLoadView = useCallback(async (viewId) => {
    const view = savedViews.find(v => v.id === viewId);
    if (!view) return;
    
    // Check in all currently unlocked docs
    slots.forEach(slot => {
      if (unlockedSlots.has(slot.id)) {
        onDocumentCheckin?.(slot.fileId);
      }
    });
    setUnlockedSlots(new Set());
    setSelectedAnnotation(null);
    setMarkupMode(null);
    setViewLocked(false); // Unlock when loading a new view
    
    // Restore canvas shapes
    setCanvasShapes(view.canvasShapes || []);
    setSelectedCanvasShapeId(null);
    setSelectedShapeIds(new Set());
    
    // Restore crop state
    if (view.cropRegion) {
      setCropRegion(view.cropRegion);
      setCropEnabled(view.cropEnabled !== false); // default true if crop region exists
    } else {
      setCropRegion(null);
      setCropEnabled(false);
    }
    
    // Revoke old blob URLs
    slots.forEach(s => { if (s.blobUrl) URL.revokeObjectURL(s.blobUrl); });
    setSlots([]);
    setSlotAnnotations({});
    
    // Restore zoom and pan with animation immediately
    setIsAnimating(true);
    setZoom(view.zoom || 0.5);
    setCanvasPosition({ x: view.panX || 0, y: view.panY || 0 });
    setTimeout(() => setIsAnimating(false), 600);
    
    // Load PDFs from backend for each saved slot
    const newSlots = [];
    const newAnnotations = {};
    const fileCache = new Map(); // backendFilename -> { pdfDoc, arrayBuffer, blobUrl }
    
    for (const savedSlot of (view.slots || [])) {
      const file = allFiles.find(f => f.id === savedSlot.fileId);
      const backendFilename = savedSlot.backendFilename || file?.backendFilename;
      if (!backendFilename) {
        console.warn(`Skipping view slot: no file found for fileId=${savedSlot.fileId}`);
        continue;
      }
      
      try {
        const slotId = `${savedSlot.fileId}_page_${savedSlot.page}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        
        // Cache PDF data per file to avoid re-fetching for multi-page
        let cached = fileCache.get(backendFilename);
        if (!cached) {
          const sf = savedSlot.sourceFolder || file?.sourceFolder;
          const sfParam = sf ? `?sourceFolder=${encodeURIComponent(sf)}` : '';
          const response = await fetch(`${BACKEND_URL}/api/files/${encodeURIComponent(backendFilename)}${sfParam}`);
          if (!response.ok) {
            console.warn(`Failed to fetch PDF: ${backendFilename} (${response.status})`);
            continue;
          }
          const blob = await response.blob();
          const arrayBuffer = await blob.arrayBuffer();
          const blobUrl = URL.createObjectURL(blob);
          cached = { arrayBuffer, blobUrl };
          fileCache.set(backendFilename, cached);
        }
        
        // Create a SEPARATE pdfDoc for each slot to avoid concurrent render conflicts
        const slotPdfDoc = await window.pdfjsLib.getDocument({ data: cached.arrayBuffer.slice(0) }).promise;
        
        // Load annotations from the PDF page
        const pdfAnnotations = await loadPdfAnnotations(slotPdfDoc, savedSlot.page, slotId, 1.5);
        if (pdfAnnotations.length > 0) {
          newAnnotations[slotId] = pdfAnnotations;
        }
        
        newSlots.push({
          id: slotId,
          fileId: savedSlot.fileId,
          backendFilename,
          sourceFolder: savedSlot.sourceFolder || file?.sourceFolder || null,
          fileName: savedSlot.fileName || file?.name || backendFilename,
          page: savedSlot.page,
          numPages: savedSlot.numPages || slotPdfDoc.numPages,
          pdfDoc: slotPdfDoc,
          blobUrl: cached.blobUrl,
          pdfBytes: cached.arrayBuffer,
          x: savedSlot.x,
          y: savedSlot.y,
          width: savedSlot.width || 0,
          height: savedSlot.height || 0,
          renderKey: 0,
        });
        
        // Store page count
        setFilePageCounts(prev => ({ ...prev, [savedSlot.fileId]: slotPdfDoc.numPages }));
      } catch (err) {
        console.warn(`Failed to load PDF for view slot: ${savedSlot.fileName}`, err);
      }
    }
    
    setSlots(newSlots);
    if (Object.keys(newAnnotations).length > 0) {
      setSlotAnnotations(prev => ({ ...prev, ...newAnnotations }));
    }
    if (newSlots.length > 0) {
      setAnchorSlotId(newSlots[0].id);
    }
  }, [savedViews, slots, allFiles, unlockedSlots, onDocumentCheckin]);

  const handleDeleteView = useCallback((viewId) => {
    const updated = savedViews.filter(v => v.id !== viewId);
    if (onProjectUpdate) {
      onProjectUpdate({ ...project, savedViews: updated });
    }
  }, [savedViews, project, onProjectUpdate]);

  const handleRenameView = useCallback((viewId, newName) => {
    const updated = savedViews.map(v => v.id === viewId ? { ...v, name: newName } : v);
    if (onProjectUpdate) {
      onProjectUpdate({ ...project, savedViews: updated });
    }
  }, [savedViews, project, onProjectUpdate]);

  // ── Saved Batches ─────────────────────────────────────────────────────

  const handleSaveBatch = useCallback((name) => {
    const selectedSlotList = slots.filter(s => selectedSlotIds.has(s.id));
    const selectedShapeList = canvasShapes.filter(s => selectedShapeIds.has(s.id));
    if (selectedSlotList.length === 0 && selectedShapeList.length === 0) return;

    // Compute bounding box origin of all selected items
    let minX = Infinity, minY = Infinity;
    selectedSlotList.forEach(s => { if (s.x < minX) minX = s.x; if (s.y < minY) minY = s.y; });
    selectedShapeList.forEach(s => { if (s.x < minX) minX = s.x; if (s.y < minY) minY = s.y; });
    if (minX === Infinity) { minX = 0; minY = 0; }

    // Infer grid columns from unique x positions
    const xPositions = new Set(selectedSlotList.map(s => s.x));
    const inferredCols = Math.max(1, xPositions.size);

    // Infer gap from nearest slot pair
    let inferredGap = 50;
    if (selectedSlotList.length >= 2) {
      const sorted = [...selectedSlotList].sort((a, b) => a.x - b.x || a.y - b.y);
      for (let i = 1; i < sorted.length; i++) {
        const dx = sorted[i].x - sorted[i - 1].x - (sorted[i - 1].width || 900);
        const dy = sorted[i].y - sorted[i - 1].y - (sorted[i - 1].height || 1270);
        if (dx > 0 && dx < 500) { inferredGap = Math.round(dx); break; }
        if (dy > 0 && dy < 500) { inferredGap = Math.round(dy); break; }
      }
    }

    const items = [];
    selectedSlotList.forEach(s => {
      items.push({
        type: 'slot',
        fileId: s.fileId, page: s.page,
        relX: s.x - minX, relY: s.y - minY,
        width: s.width || 0, height: s.height || 0,
        fileName: s.fileName, backendFilename: s.backendFilename, numPages: s.numPages,
      });
    });
    selectedShapeList.forEach(s => {
      items.push({
        type: 'shape', shapeType: s.type,
        relX: s.x - minX, relY: s.y - minY,
        shapeData: { ...s, x: s.x - minX, y: s.y - minY },
        title: s.title || '',
      });
    });

    const batch = {
      id: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name, createdDate: new Date().toISOString(),
      items, cols: inferredCols, gap: inferredGap,
    };
    const updated = [...savedBatches, batch];
    if (onProjectUpdate) onProjectUpdate({ ...project, savedBatches: updated });
  }, [slots, canvasShapes, selectedSlotIds, selectedShapeIds, savedBatches, project, onProjectUpdate]);

  const handleOpenLoadBatch = useCallback((batchId) => {
    if (viewLocked) return;
    const batch = savedBatches.find(b => b.id === batchId);
    if (!batch) return;
    setLoadBatchTarget(batch);
    setShowLoadBatchDialog(true);
  }, [savedBatches, viewLocked]);

  const handleLoadBatchConfirm = useCallback(async ({ batch, originX, originY, gap: batchGap, cols: batchCols }) => {
    if (!batch || !batch.items) return;

    const allProjectFiles = [...(project?.files || [])];
    const getFolderFiles = (folders) => {
      let result = [];
      (folders || []).forEach(f => {
        result = [...result, ...(f.files || []), ...getFolderFiles(f.children || f.folders || [])];
      });
      return result;
    };
    const projectFiles = [...allProjectFiles, ...getFolderFiles(project?.folders || [])];
    const onCanvasSet = new Set(slots.map(s => `${s.fileId}:${s.page}`));

    const slotItems = batch.items.filter(i => i.type === 'slot');
    const shapeItems = batch.items.filter(i => i.type === 'shape');
    const slotsToAdd = slotItems.filter(item => !onCanvasSet.has(`${item.fileId}:${item.page}`));
    if (slotsToAdd.length === 0 && shapeItems.length === 0) return;

    // Fetch unique PDFs
    const fileCache = new Map();
    const fileGroups = new Map();
    slotsToAdd.forEach(item => {
      const file = projectFiles.find(f => f.id === item.fileId);
      if (file && !fileGroups.has(file.id)) fileGroups.set(file.id, file);
    });

    const fileIds = [...fileGroups.keys()];
    const CONCURRENCY = 4;
    for (let i = 0; i < fileIds.length; i += CONCURRENCY) {
      const chunk = fileIds.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(async (fileId) => {
        const file = fileGroups.get(fileId);
        try {
          const response = await fetch(getPdfFetchUrl(file));
          if (!response.ok) return;
          const blob = await response.blob();
          const arrayBuffer = await blob.arrayBuffer();
          const blobUrl = URL.createObjectURL(blob);
          fileCache.set(fileId, { arrayBuffer, blobUrl });
        } catch (err) {
          console.error(`Batch load failed for ${file.name}:`, err);
        }
      }));
    }

    // Build new slots
    const newSlots = [];
    const allAnnotations = {};
    const newPageCounts = {};
    const timestamp = Date.now();
    const defaultW = 900, defaultH = 1270;
    const useRelativePositions = slotsToAdd.every(i => i.relX != null && i.relY != null);

    for (let idx = 0; idx < slotsToAdd.length; idx++) {
      const item = slotsToAdd[idx];
      const file = projectFiles.find(f => f.id === item.fileId);
      const cached = file ? fileCache.get(file.id) : null;
      const slotId = `${item.fileId}_page_${item.page}_${timestamp}_${idx}`;

      let width = item.width || defaultW;
      let height = item.height || defaultH;

      let slotPdfDoc = null;
      if (cached) {
        // Create a SEPARATE pdfDoc for each slot to avoid concurrent render conflicts
        try {
          slotPdfDoc = await window.pdfjsLib.getDocument({ data: cached.arrayBuffer.slice(0) }).promise;
        } catch (err) {
          console.error(`Failed to create pdfDoc for batch slot ${slotId}:`, err);
        }
        
        if (slotPdfDoc) {
          try {
            const pdfPage = await slotPdfDoc.getPage(item.page);
            const viewport = pdfPage.getViewport({ scale: 1.5 });
            width = viewport.width;
            height = viewport.height;
          } catch (err) {
            console.warn(`Failed to get dimensions for batch slot ${slotId}:`, err);
          }
          try {
            const pdfAnnotations = await loadPdfAnnotations(slotPdfDoc, item.page, slotId, 1.5);
            if (pdfAnnotations.length > 0) allAnnotations[slotId] = pdfAnnotations;
          } catch (err) {
            console.warn(`Failed to load annotations for batch slot ${slotId}:`, err);
          }
          newPageCounts[item.fileId] = slotPdfDoc.numPages;
        }
      }

      let x, y;
      if (useRelativePositions) {
        x = originX + item.relX;
        y = originY + item.relY;
      } else {
        const cW = (item.width || defaultW) + batchGap;
        const cH = (item.height || defaultH) + batchGap;
        x = originX + (idx % batchCols) * cW;
        y = originY + Math.floor(idx / batchCols) * cH;
      }

      newSlots.push({
        id: slotId, fileId: item.fileId,
        backendFilename: item.backendFilename || file?.backendFilename || '',
        sourceFolder: item.sourceFolder || file?.sourceFolder || null,
        fileName: item.fileName || file?.name || 'Missing Document',
        page: item.page, pdfDoc: slotPdfDoc,
        numPages: item.numPages || slotPdfDoc?.numPages || 1,
        blobUrl: cached?.blobUrl || null, pdfBytes: cached?.arrayBuffer || null,
        x, y, width, height, renderKey: 0,
        isPlaceholder: !cached,
      });
    }

    // Add shapes with offset positions
    const newShapes = shapeItems.map((item, idx) => {
      const shapeData = item.shapeData || {};
      return {
        ...shapeData,
        id: `shape_batch_${timestamp}_${idx}`,
        x: originX + (item.relX || 0),
        y: originY + (item.relY || 0),
      };
    });

    // Single batch state update
    if (newSlots.length > 0) {
      setSlots(prev => [...prev, ...newSlots]);
      setSlotAnnotations(prev => ({ ...prev, ...allAnnotations }));
      setFilePageCounts(prev => ({ ...prev, ...newPageCounts }));
    }
    if (newShapes.length > 0) {
      setCanvasShapes(prev => [...prev, ...newShapes]);
    }

    // Select and zoom to fit
    const newSlotIdSet = new Set(newSlots.map(s => s.id));
    if (newSlotIdSet.size > 0) {
      setSelectedSlotIds(newSlotIdSet);
      setAnchorSlotId(newSlots[0].id);
    }
    if (newShapes.length > 0) {
      setSelectedShapeIds(new Set(newShapes.map(s => s.id)));
    }

    if (newSlots.length > 0) {
      let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
      newSlots.forEach(s => {
        if (s.x < bMinX) bMinX = s.x;
        if (s.x + s.width > bMaxX) bMaxX = s.x + s.width;
        if (s.y < bMinY) bMinY = s.y;
        if (s.y + s.height > bMaxY) bMaxY = s.y + s.height;
      });
      const bW = bMaxX - bMinX, bH = bMaxY - bMinY;
      const bCenterX = bMinX + bW / 2, bCenterY = bMinY + bH / 2;
      setTimeout(() => {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const targetZoom = Math.min(0.5, (rect.width * 0.8) / bW, (rect.height * 0.8) / bH);
        setIsAnimating(true);
        setZoom(targetZoom);
        setCanvasPosition({ x: -bCenterX * targetZoom, y: -bCenterY * targetZoom });
        setTimeout(() => setIsAnimating(false), 600);
      }, 100);
    }
  }, [slots, project, containerRef]);

  const handleDeleteBatch = useCallback((batchId) => {
    const updated = savedBatches.filter(b => b.id !== batchId);
    if (onProjectUpdate) onProjectUpdate({ ...project, savedBatches: updated });
  }, [savedBatches, project, onProjectUpdate]);

  const handleRenameBatch = useCallback((batchId, newName) => {
    const updated = savedBatches.map(b => b.id === batchId ? { ...b, name: newName } : b);
    if (onProjectUpdate) onProjectUpdate({ ...project, savedBatches: updated });
  }, [savedBatches, project, onProjectUpdate]);

  return (
    <div className="infinite-view">
      {/* Header */}
      <div className="infinite-view-header">
        <div className="header-top-row">
          <button className="back-btn" onClick={() => {
            if (hasAnyUnsavedChanges()) {
              const confirmLeave = window.confirm(
                'You have unsaved markup changes.\n\nAre you sure you want to leave? All unsaved changes will be lost.'
              );
              if (!confirmLeave) return;
            }
            onClose?.();
          }}>
            ← Back to Home
          </button>
          <span className="header-title">
            {project?.name || 'Project'} <span className="header-separator">-</span> Infinite View
          </span>
          <span className="header-brand">pidly</span>
        </div>
        
        {/* Second row - toolbar buttons */}
        <InfiniteHeaderToolbar
          showAddPdfSearch={showAddPdfSearch}
          setShowAddPdfSearch={setShowAddPdfSearch}
          setShowBatchAdd={setShowBatchAdd}
          showObjectSearch={showObjectSearch}
          setShowObjectSearch={setShowObjectSearch}
          showViewsPanel={showViewsPanel}
          setShowViewsPanel={setShowViewsPanel}
          showViewOptions={showViewOptions}
          setShowViewOptions={setShowViewOptions}
          showSymbolsPanel={showSymbolsPanel}
          setShowSymbolsPanel={setShowSymbolsPanel}
          setShowMarkupHistoryPanel={setShowMarkupHistoryPanel}
        />
      </div>
      
      {/* Content area - canvas and panels */}
      <div className="infinite-view-content">
        {/* Documents Panel */}
        {showAddPdfSearch && (
          <DocumentsPanel
            documentPanelTab={documentPanelTab}
            setDocumentPanelTab={setDocumentPanelTab}
            addPdfSearchQuery={addPdfSearchQuery}
            setAddPdfSearchQuery={setAddPdfSearchQuery}
            project={project}
            slots={slots}
            unlockedSlots={unlockedSlots}
            slotAnnotations={slotAnnotations}
            ownedAnnotationIds={ownedAnnotationIds}
            selectedAnnotation={selectedAnnotation}
            checkedOutDocuments={checkedOutDocuments}
            filePageCounts={filePageCounts}
            onSlotNavigate={handleSlotNavigate}
            onFileClick={handleFileClick}
            onAddPage={handleAddPage}
            onFetchPageCount={handleFetchPageCount}
            onRemoveSlot={removeSlotFromCanvas}
            onRemoveFile={removeFileFromCanvas}
            onRemoveAll={removeAllFromCanvas}
            onToggleSlotLock={handleToggleSlotLock}
            onToggleAllLocks={handleToggleAllLocks}
            onSelectAnnotation={handlePanelSelectAnnotation}
            onDeleteAnnotation={handlePanelDeleteAnnotation}
            onClose={() => setShowAddPdfSearch(false)}
            viewLocked={viewLocked}
          />
        )}
      
      {/* Object Search Panel */}
      {showObjectSearch && (
        <ObjectSearchPanel
          objectSearchQuery={objectSearchQuery}
          setObjectSearchQuery={setObjectSearchQuery}
          debouncedSearchQuery={debouncedSearchQuery}
          hiddenClasses={hiddenClasses}
          setHiddenClasses={setHiddenClasses}
          allDetectedObjects={allDetectedObjects}
          filteredObjects={filteredObjects}
          navigateToObject={navigateToObject}
          drawnRegions={drawnRegions}
          filteredRegions={filteredRegions}
          navigateToRegion={navigateToRegion}
          onClose={() => setShowObjectSearch(false)}
          viewLocked={viewLocked}
          slots={slots}
        />
      )}
      {/* View Options Sidebar */}
      {showViewOptions && (
        <ViewOptionsPanel
          cropRegion={cropRegion}
          cropEnabled={cropEnabled}
          setCropEnabled={setCropEnabled}
          isDrawingCrop={isDrawingCrop}
          onStartCropDraw={handleStartCropDraw}
          onClearCrop={clearCropRegion}
          showMarkupsToolbar={showMarkupsToolbar}
          setShowMarkupsToolbar={setShowMarkupsToolbar}
          showObjectTags={showObjectTags}
          setShowObjectTags={setShowObjectTags}
          showObjects={showObjects}
          setShowObjects={setShowObjects}
          showLinks={showLinks}
          setShowLinks={setShowLinks}
          availableClasses={availableClasses}
          hiddenClasses={hiddenClasses}
          setHiddenClasses={setHiddenClasses}
          showShadows={showShadows}
          setShowShadows={setShowShadows}
          onOpenZoomSettings={() => setShowZoomSettingsDialog(true)}
          backgroundStyle={backgroundStyle}
          setBackgroundStyle={setBackgroundStyle}
          bgColors={bgColors}
          setBgColors={setBgColors}
          onClose={() => setShowViewOptions(false)}
        />
      )}
      
      {/* Symbols Panel */}
      {showSymbolsPanel && (
        <InfiniteSymbolsPanel
          isOpen={showSymbolsPanel}
          onClose={() => setShowSymbolsPanel(false)}
          savedSymbols={savedSymbols}
          setSavedSymbols={setSavedSymbols}
          symbolSearchQuery={symbolSearchQuery}
          onSearchQueryChange={setSymbolSearchQuery}
          symbolsViewMode={symbolsViewMode}
          onViewModeChange={setSymbolsViewMode}
          onDeleteSymbol={(id) => {
            setSavedSymbols(prev => prev.filter(s => s.id !== id));
          }}
          onDragStart={() => {}}
          onDragEnd={() => {}}
          canvasSize={{ width: 800, height: 1000 }}
          scale={zoom}
          defaultSignatureId={defaultSignatureId}
          onSetDefaultSignature={setDefaultSignatureId}
          onStartPlacement={(placementData) => {
            setPendingPlacement(placementData);
            setShowSymbolsPanel(false);
          }}
        />
      )}

      {/* Markup History Panel */}
      {showMarkupHistoryPanel && (
        <InfiniteMarkupHistoryPanel
          isOpen={showMarkupHistoryPanel}
          onClose={() => setShowMarkupHistoryPanel(false)}
          slotAnnotations={slotAnnotations}
          slots={slots}
          unlockedSlots={unlockedSlots}
          selectedSlotId={selectedAnnotation?.slotId || slots[0]?.id}
          onSelectMarkup={(m) => {
            if (!unlockedSlots.has(m._slotId)) return;
            const fullAnnotation = (slotAnnotations[m._slotId] || []).find(a => a.id === m.id);
            if (fullAnnotation) {
              setSelectedAnnotation(fullAnnotation);
              setMarkupMode(null);
            }
          }}
          onDeleteMarkup={(m) => {
            if (!unlockedSlots.has(m._slotId)) return;
            deleteAnnotationWithHistory(m._slotId, m.id);
            if (selectedAnnotation?.id === m.id) setSelectedAnnotation(null);
          }}
          onScrollToMarkup={(m) => {
            const slot = slots.find(s => s.id === m._slotId);
            if (slot && containerRef.current) {
              let cx, cy;
              if (m.points && m.points.length > 0) {
                const xs = m.points.map(p => p.x);
                const ys = m.points.map(p => p.y);
                cx = (Math.min(...xs) + Math.max(...xs)) / 2;
                cy = (Math.min(...ys) + Math.max(...ys)) / 2;
              } else if (m.x1 != null) {
                cx = (m.x1 + (m.x2 || m.x1)) / 2;
                cy = (m.y1 + (m.y2 || m.y1)) / 2;
              } else {
                cx = 0; cy = 0;
              }
              const canvasX = (slot.x + cx) * zoom;
              const canvasY = (slot.y + cy) * zoom;
              const rect = containerRef.current.getBoundingClientRect();
              containerRef.current.scrollTo({
                left: canvasX - rect.width / 2,
                top: canvasY - rect.height / 2,
                behavior: 'smooth'
              });
              if (unlockedSlots.has(m._slotId)) {
                const fullAnnotation = (slotAnnotations[m._slotId] || []).find(a => a.id === m.id);
                if (fullAnnotation) {
                  setSelectedAnnotation(fullAnnotation);
                  setMarkupMode(null);
                }
              }
            }
          }}
        />
      )}
      
      {/* Views Panel */}
      {showViewsPanel && (
        <InfiniteViewsPanel
          isOpen={showViewsPanel}
          onClose={() => setShowViewsPanel(false)}
          canvasShapes={canvasShapes}
          selectedCanvasShapeId={selectedCanvasShapeId}
          onUpdateShape={updateCanvasShape}
          onDeleteShape={deleteCanvasShape}
          onSelectShape={setSelectedCanvasShapeId}
          onAddShape={addCanvasShape}
          onStartDrawPolyline={startDrawPolyline}
          isDrawingPolyline={currentTool === 'drawPolyline'}
          savedViews={savedViews}
          onSaveView={handleSaveView}
          onLoadView={handleLoadView}
          onDeleteView={handleDeleteView}
          onRenameView={handleRenameView}
          savedBatches={savedBatches}
          onSaveBatch={handleSaveBatch}
          onLoadBatch={handleOpenLoadBatch}
          onDeleteBatch={handleDeleteBatch}
          onRenameBatch={handleRenameBatch}
          selectedSlotIds={selectedSlotIds}
          selectedShapeIds={selectedShapeIds}
          slots={slots}
          viewLocked={viewLocked}
          onToggleViewLock={() => setViewLocked(prev => !prev)}
        />
      )}
      
      {/* Canvas Area */}
      <div 
        className={`infinite-canvas-container bg-${backgroundStyle} ${isDragOverCanvas ? 'drag-over' : ''}`}
        ref={containerRef}
        style={{ '--bg-color': bgColors[backgroundStyle] || '#12121f', cursor: getCursor() }}
        onDragOver={handleCanvasDragOver}
        onDragEnter={handleCanvasDragEnter}
        onDragLeave={handleCanvasDragLeave}
        onDrop={handleCanvasDrop}
        onMouseDown={(e) => {
          // Close context menu on any click
          if (slotContextMenu) setSlotContextMenu(null);
          
          // Polyline drawing: click adds points
          if (currentTool === 'drawPolyline' && drawingPolylinePoints !== null) {
            const canvasPt = screenToCanvas(e.clientX, e.clientY);
            const pts = drawingPolylinePoints;
            const lastPt = pts.length > 0 ? pts[pts.length - 1] : null;
            const snapped = snapPoint(lastPt, canvasPt, e.shiftKey);
            setDrawingPolylinePoints(prev => [...(prev || []), snapped]);
            e.preventDefault();
            return;
          }
          
          // Don't start drag box if Ctrl/Cmd is held (user is multi-selecting slots)
          if (e.ctrlKey || e.metaKey) {
            return;
          }
          
          // Cancel crop drawing if clicking on empty canvas (not on a PDF)
          if (isDrawingCrop && !e.target.closest('.infinite-slot')) {
            setIsDrawingCrop(false);
            setCurrentTool('select');
          }
          
          const onSlotOrShape = e.target.closest('.infinite-slot') || e.target.closest('.canvas-shape');
          
          // Clear selection when clicking empty canvas (not on a slot or shape)
          if (!onSlotOrShape) {
            setSelectedSlotIds(new Set());
            setSelectedShapeIds(new Set());
            setSelectedCanvasShapeId(null);
          }
          
          // Always handle pan in pan mode
          if (currentTool === 'pan') {
            handleMouseDown(e);
          } else if (currentTool === 'zoom' && !onSlotOrShape) {
            // Start zoom box drag
            setDragBox({ startX: e.clientX, startY: e.clientY, endX: e.clientX, endY: e.clientY, type: 'zoom' });
          } else if (currentTool === 'select' && !onSlotOrShape) {
            // Start select box drag
            setDragBox({ startX: e.clientX, startY: e.clientY, endX: e.clientX, endY: e.clientY, type: 'select' });
          }
        }}
        onMouseMove={(e) => {
          // Track crosshair position for drawing modes
          if (showCrosshairs && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setCrosshairPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          } else if (crosshairPos) {
            setCrosshairPos(null);
          }
          
          // Track mouse for zoom-settings crosshairs/coordinates
          if (zoomSettings.showCrosshairs || zoomSettings.showCoordinates) {
            const rect = containerRef.current?.getBoundingClientRect();
            if (rect) {
              const screenX = e.clientX - rect.left;
              const screenY = e.clientY - rect.top;
              const canvasX = (screenX - rect.width / 2 - canvasPosition.x) / zoom;
              const canvasY = (screenY - rect.height / 2 - canvasPosition.y) / zoom;
              setMousePos({ screenX, screenY, canvasX: Math.round(canvasX), canvasY: Math.round(canvasY) });
            }
          } else if (mousePos) {
            setMousePos(null);
          }
          
          // Polyline drawing: track hover position
          if (currentTool === 'drawPolyline' && drawingPolylinePoints !== null) {
            const canvasPt = screenToCanvas(e.clientX, e.clientY);
            const pts = drawingPolylinePoints;
            const lastPt = pts.length > 0 ? pts[pts.length - 1] : null;
            setDrawingPolylineHover(snapPoint(lastPt, canvasPt, e.shiftKey));
          }
          // Update drag box if active
          if (dragBox) {
            setDragBox(prev => prev ? { ...prev, endX: e.clientX, endY: e.clientY } : null);
            return;
          }
          handleMouseMove(e);
        }}
        onMouseUp={(e) => {
          // Complete drag box if active
          if (dragBox) {
            if (dragBox.type === 'zoom') {
              completeZoomBox(dragBox);
            } else if (dragBox.type === 'select') {
              completeSelectBox(dragBox);
            }
            setDragBox(null);
            return;
          }
          handleMouseUp();
        }}
        onDoubleClick={(e) => {
          // Finish polyline drawing on double-click
          if (currentTool === 'drawPolyline' && drawingPolylinePoints !== null) {
            e.preventDefault();
            e.stopPropagation();
            finishDrawPolyline();
          }
        }}
        onMouseLeave={() => {
          setCrosshairPos(null);
          setMousePos(null);
          if (dragBox) {
            setDragBox(null);
          }
          handleMouseUp();
        }}
      >
        <div 
          className="infinite-canvas"
          ref={canvasRef}
          style={{
            transform: `translate(calc(-50% + ${canvasPosition.x}px), calc(-50% + ${canvasPosition.y}px)) scale(${zoom})`,
            transformOrigin: 'center center',
            transition: isAnimating ? 'transform 0.5s ease-out' : 'none'
          }}
        >
          {/* In-progress polyline drawing */}
          {currentTool === 'drawPolyline' && drawingPolylinePoints !== null && (() => {
            const allPts = drawingPolylineHover 
              ? [...drawingPolylinePoints, drawingPolylineHover] 
              : drawingPolylinePoints;
            if (allPts.length === 0) return null;
            let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
            allPts.forEach(p => { pMinX = Math.min(pMinX, p.x); pMinY = Math.min(pMinY, p.y); pMaxX = Math.max(pMaxX, p.x); pMaxY = Math.max(pMaxY, p.y); });
            const pad = 30;
            const svgMinX = pMinX - pad;
            const svgMinY = pMinY - pad;
            const svgW = (pMaxX - pMinX) + pad * 2;
            const svgH = Math.max((pMaxY - pMinY) + pad * 2, pad * 2);
            const committedPts = drawingPolylinePoints;
            const committedStr = committedPts.map(p => `${p.x - svgMinX},${p.y - svgMinY}`).join(' ');
            const handleSz = Math.max(6, 6 / zoom);
            return (
              <div style={{ position: 'absolute', left: svgMinX, top: svgMinY, width: svgW, height: svgH, zIndex: 9999, pointerEvents: 'none' }}>
                <svg width="100%" height="100%" style={{ overflow: 'visible' }}>
                  {/* Committed segments */}
                  {committedPts.length >= 2 && (
                    <polyline points={committedStr} fill="none" stroke="#2ecc71" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                  )}
                  {/* Ghost line to cursor */}
                  {committedPts.length >= 1 && drawingPolylineHover && (
                    <line
                      x1={committedPts[committedPts.length - 1].x - svgMinX}
                      y1={committedPts[committedPts.length - 1].y - svgMinY}
                      x2={drawingPolylineHover.x - svgMinX}
                      y2={drawingPolylineHover.y - svgMinY}
                      stroke="#2ecc71" strokeWidth={2} strokeDasharray="6 4" opacity={0.6}
                    />
                  )}
                  {/* Point handles */}
                  {committedPts.map((p, i) => (
                    <circle key={i} cx={p.x - svgMinX} cy={p.y - svgMinY} r={handleSz / 2}
                      fill="#2ecc71" stroke="#fff" strokeWidth={1} />
                  ))}
                </svg>
              </div>
            );
          })()}
          
          {/* Canvas Shapes - view-level decorations (not annotations) */}
          {canvasShapes.map(shape => {
            const isSelected = shape.id === selectedCanvasShapeId;
            const isBoxSelected = selectedShapeIds.has(shape.id);
            const showOutline = isSelected || isBoxSelected;
            const isEditing = shape.id === editingShapeTextId;
            const isDragging = shape.id === draggingShapeId;
            const handleSize = Math.max(8, 8 / zoom);
            const titleScale = 1 / zoom;
            
            const hexToRgba = (hex, alphaPct) => {
              if (!hex || hex === 'none') return 'transparent';
              if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex;
              const r = parseInt(hex.slice(1, 3), 16);
              const g = parseInt(hex.slice(3, 5), 16);
              const b = parseInt(hex.slice(5, 7), 16);
              const a = (alphaPct > 1 ? alphaPct / 100 : alphaPct); // support both percent and 0-1
              return `rgba(${r}, ${g}, ${b}, ${a})`;
            };
            
            // Shape title - always visible, scales inversely with zoom
            const titleEl = shape.title ? (
              <div className="canvas-shape-title" style={{
                position: 'absolute',
                bottom: '100%',
                left: '50%',
                transform: `translateX(-50%) scale(${titleScale})`,
                transformOrigin: 'bottom center',
                background: 'rgba(0, 0, 0, 0.85)',
                color: '#fff',
                padding: '4px 12px',
                borderRadius: '4px',
                fontSize: '13px',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                marginBottom: '4px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}>
                {shape.title}
              </div>
            ) : null;
            
            if (shape.type === 'arrow') {
              const x2 = shape.x + (shape.width || 200);
              const y2 = shape.y + (shape.height || 0);
              const minX = Math.min(shape.x, x2) - 20;
              const minY = Math.min(shape.y, y2) - 20;
              const svgW = Math.abs(x2 - shape.x) + 40;
              const svgH = Math.max(Math.abs(y2 - shape.y) + 40, 40);
              return (
                <div key={shape.id} style={{
                  position: 'absolute', left: minX, top: minY,
                  width: svgW, height: svgH, zIndex: 0,
                }}>
                  {titleEl}
                  <svg
                    className={`canvas-shape arrow ${showOutline ? 'selected' : ''}`}
                    style={{
                      width: '100%', height: '100%', overflow: 'visible',
                      cursor: isDragging ? 'grabbing' : 'grab',
                      pointerEvents: currentTool === 'pan' ? 'none' : 'auto',
                    }}
                    onMouseDown={(e) => { if (currentTool !== 'pan') handleShapeMouseDown(e, shape.id); }}
                  >
                    <defs>
                      <marker id={`arrowhead-${shape.id}`} markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" fill={shape.borderColor || '#e74c3c'} />
                      </marker>
                    </defs>
                    <line
                      x1={shape.x - minX} y1={shape.y - minY}
                      x2={x2 - minX} y2={y2 - minY}
                      stroke={shape.borderColor || '#e74c3c'}
                      strokeWidth={shape.borderWidth ?? 2}
                      markerEnd={`url(#arrowhead-${shape.id})`}
                    />
                    <line x1={shape.x - minX} y1={shape.y - minY}
                      x2={x2 - minX} y2={y2 - minY}
                      stroke="transparent" strokeWidth="12" />
                    {isSelected && (
                      <>
                        <circle cx={shape.x - minX} cy={shape.y - minY} r={handleSize / 2}
                          fill="#3498db" stroke="#fff" strokeWidth="1" style={{ cursor: 'move', pointerEvents: 'auto' }}
                          onMouseDown={(e) => handleShapeMouseDown(e, shape.id, 'nw')} />
                        <circle cx={x2 - minX} cy={y2 - minY} r={handleSize / 2}
                          fill="#3498db" stroke="#fff" strokeWidth="1" style={{ cursor: 'move', pointerEvents: 'auto' }}
                          onMouseDown={(e) => handleShapeMouseDown(e, shape.id, 'se')} />
                      </>
                    )}
                  </svg>
                </div>
              );
            }
            
            // ── Line rendering (like arrow without arrowhead) ──
            if (shape.type === 'line') {
              const x2 = shape.x + (shape.width || 200);
              const y2 = shape.y + (shape.height || 0);
              const pad = Math.max(20, (shape.borderWidth ?? 3) * 2);
              const minX = Math.min(shape.x, x2) - pad;
              const minY = Math.min(shape.y, y2) - pad;
              const svgW = Math.abs(x2 - shape.x) + pad * 2;
              const svgH = Math.max(Math.abs(y2 - shape.y) + pad * 2, pad * 2);
              const dashArray = shape.borderStyle === 'dashed' ? `${(shape.borderWidth ?? 3) * 3} ${(shape.borderWidth ?? 3) * 2}` : shape.borderStyle === 'dotted' ? `${shape.borderWidth ?? 3} ${(shape.borderWidth ?? 3) * 2}` : 'none';
              return (
                <div key={shape.id} style={{
                  position: 'absolute', left: minX, top: minY,
                  width: svgW, height: svgH, zIndex: 0,
                }}>
                  {titleEl}
                  <svg
                    className={`canvas-shape line ${showOutline ? 'selected' : ''}`}
                    style={{
                      width: '100%', height: '100%', overflow: 'visible',
                      cursor: isDragging ? 'grabbing' : 'grab',
                      pointerEvents: currentTool === 'pan' ? 'none' : 'auto',
                    }}
                    onMouseDown={(e) => { if (currentTool !== 'pan') handleShapeMouseDown(e, shape.id); }}
                  >
                    <line
                      x1={shape.x - minX} y1={shape.y - minY}
                      x2={x2 - minX} y2={y2 - minY}
                      stroke={shape.borderColor || '#f39c12'}
                      strokeWidth={shape.borderWidth ?? 3}
                      strokeLinecap="round"
                      strokeDasharray={dashArray}
                    />
                    {/* Fat invisible hit area */}
                    <line x1={shape.x - minX} y1={shape.y - minY}
                      x2={x2 - minX} y2={y2 - minY}
                      stroke="transparent" strokeWidth={Math.max(14, (shape.borderWidth ?? 3) + 10)} />
                    {isSelected && (
                      <>
                        <circle cx={shape.x - minX} cy={shape.y - minY} r={handleSize / 2}
                          fill="#3498db" stroke="#fff" strokeWidth="1" style={{ cursor: 'move', pointerEvents: 'auto' }}
                          onMouseDown={(e) => handleShapeMouseDown(e, shape.id, 'nw')} />
                        <circle cx={x2 - minX} cy={y2 - minY} r={handleSize / 2}
                          fill="#3498db" stroke="#fff" strokeWidth="1" style={{ cursor: 'move', pointerEvents: 'auto' }}
                          onMouseDown={(e) => handleShapeMouseDown(e, shape.id, 'se')} />
                      </>
                    )}
                  </svg>
                </div>
              );
            }
            
            // ── Polyline rendering ──
            if (shape.type === 'polyline' && shape.points?.length >= 2) {
              const pts = shape.points;
              let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
              pts.forEach(p => { pMinX = Math.min(pMinX, p.x); pMinY = Math.min(pMinY, p.y); pMaxX = Math.max(pMaxX, p.x); pMaxY = Math.max(pMaxY, p.y); });
              const pad = Math.max(20, (shape.borderWidth ?? 3) * 2);
              const svgMinX = pMinX - pad;
              const svgMinY = pMinY - pad;
              const svgW = (pMaxX - pMinX) + pad * 2;
              const svgH = Math.max((pMaxY - pMinY) + pad * 2, pad * 2);
              const pointsStr = pts.map(p => `${p.x - svgMinX},${p.y - svgMinY}`).join(' ');
              const dashArray = shape.borderStyle === 'dashed' ? `${(shape.borderWidth ?? 3) * 3} ${(shape.borderWidth ?? 3) * 2}` : shape.borderStyle === 'dotted' ? `${shape.borderWidth ?? 3} ${(shape.borderWidth ?? 3) * 2}` : 'none';
              return (
                <div key={shape.id} style={{
                  position: 'absolute', left: svgMinX, top: svgMinY,
                  width: svgW, height: svgH, zIndex: 0,
                  pointerEvents: 'none',
                }}>
                  {titleEl}
                  <svg
                    className={`canvas-shape polyline ${showOutline ? 'selected' : ''}`}
                    style={{
                      width: '100%', height: '100%', overflow: 'visible',
                      pointerEvents: 'none',
                    }}
                  >
                    <polyline
                      points={pointsStr}
                      fill="none"
                      stroke={shape.borderColor || '#2ecc71'}
                      strokeWidth={shape.borderWidth ?? 3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray={dashArray}
                      style={{ pointerEvents: 'none' }}
                    />
                    {/* Fat invisible hit area — only the stroke line itself captures events */}
                    <polyline
                      points={pointsStr}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={Math.max(14, (shape.borderWidth ?? 3) + 10)}
                      style={{ 
                        pointerEvents: currentTool === 'pan' ? 'none' : 'stroke',
                        cursor: isDragging ? 'grabbing' : 'grab',
                      }}
                      onMouseDown={(e) => { if (currentTool !== 'pan') handleShapeMouseDown(e, shape.id); }}
                    />
                    {isSelected && pts.map((p, i) => (
                      <circle key={i} cx={p.x - svgMinX} cy={p.y - svgMinY} r={handleSize / 2}
                        fill="#3498db" stroke="#fff" strokeWidth="1"
                        style={{ cursor: 'move', pointerEvents: 'auto' }}
                        onMouseDown={(e) => handleShapeMouseDown(e, shape.id, `pt-${i}`)} />
                    ))}
                    {/* Double-click on a segment to add a point */}
                    {isSelected && pts.length >= 2 && pts.slice(0, -1).map((p1, i) => {
                      const p2 = pts[i + 1];
                      const mx = (p1.x + p2.x) / 2 - svgMinX;
                      const my = (p1.y + p2.y) / 2 - svgMinY;
                      return (
                        <circle key={`add-${i}`} cx={mx} cy={my} r={handleSize / 3}
                          fill="transparent" stroke="#3498db" strokeWidth="1" strokeDasharray="2 2"
                          style={{ cursor: 'cell', pointerEvents: 'auto', opacity: 0.6 }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            const newPt = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
                            const newPoints = [...pts.slice(0, i + 1), newPt, ...pts.slice(i + 1)];
                            updateCanvasShape(shape.id, { points: newPoints });
                          }}
                        />
                      );
                    })}
                  </svg>
                </div>
              );
            }
            
            return (
              <div
                key={shape.id}
                className={`canvas-shape ${shape.type} ${showOutline ? 'selected' : ''}`}
                style={{
                  position: 'absolute',
                  left: shape.x, top: shape.y,
                  width: shape.width, height: shape.height,
                  backgroundColor: shape.type === 'circle' ? 'transparent' : hexToRgba(shape.fillColor, shape.fillOpacity ?? 15),
                  border: shape.type === 'circle' ? 'none' : `${shape.borderWidth ?? 2}px ${shape.borderStyle || 'solid'} ${shape.borderColor || '#3498db'}`,
                  borderRadius: shape.type === 'circle' ? '50%' : '4px',
                  zIndex: 0,
                  cursor: isDragging ? 'grabbing' : (currentTool === 'pan' ? 'inherit' : 'grab'),
                  pointerEvents: currentTool === 'pan' ? 'none' : 'auto',
                  outline: showOutline ? `${Math.max(2, 2 / zoom)}px solid ${isBoxSelected && !isSelected ? '#2ecc71' : '#3498db'}` : 'none',
                  outlineOffset: `${Math.max(2, 2 / zoom)}px`,
                  boxSizing: 'border-box',
                  display: 'flex', alignItems: 'center',
                  justifyContent: shape.textAlign === 'left' ? 'flex-start' : shape.textAlign === 'right' ? 'flex-end' : 'center',
                  overflow: 'visible',
                }}
                onMouseDown={(e) => {
                  if (currentTool === 'pan') return;
                  if (isEditing) return;
                  handleShapeMouseDown(e, shape.id);
                }}
                onDoubleClick={(e) => {
                  if (shape.type === 'text' && !viewLocked) { e.stopPropagation(); setEditingShapeTextId(shape.id); setSelectedCanvasShapeId(shape.id); }
                }}
              >
                {titleEl}
                {shape.type === 'circle' && (
                  <svg width="100%" height="100%" viewBox={`0 0 ${shape.width} ${shape.height}`} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
                    <ellipse cx={shape.width/2} cy={shape.height/2}
                      rx={shape.width/2 - (shape.borderWidth ?? 2)} ry={shape.height/2 - (shape.borderWidth ?? 2)}
                      fill={hexToRgba(shape.fillColor, shape.fillOpacity ?? 15)}
                      stroke={shape.borderColor || '#9b59b6'} strokeWidth={shape.borderWidth ?? 2} />
                  </svg>
                )}
                {shape.type === 'text' && (
                  isEditing ? (
                    <textarea autoFocus value={shape.text || ''}
                      onChange={(e) => updateCanvasShape(shape.id, { text: e.target.value })}
                      onBlur={() => setEditingShapeTextId(null)}
                      onKeyDown={(e) => { if (e.key === 'Escape') setEditingShapeTextId(null); }}
                      onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
                      style={{ width: '100%', height: '100%', padding: '8px', margin: 0, border: 'none',
                        background: 'transparent', color: shape.textColor || '#fff',
                        fontSize: shape.fontSize || 16, fontFamily: shape.fontFamily || 'Arial',
                        textAlign: shape.textAlign || 'center', resize: 'none', outline: 'none', lineHeight: 1.3 }} />
                  ) : (
                    <div style={{ width: '100%', padding: '8px', color: shape.textColor || '#fff',
                      fontSize: shape.fontSize || 16, fontFamily: shape.fontFamily || 'Arial',
                      textAlign: shape.textAlign || 'center', lineHeight: 1.3, wordBreak: 'break-word', userSelect: 'none' }}>
                      {shape.text || 'Double-click to edit'}
                    </div>
                  )
                )}
                {isSelected && !isEditing && ['nw','ne','sw','se'].map(handle => (
                  <div key={handle} style={{
                    position: 'absolute', width: handleSize, height: handleSize,
                    background: '#3498db', border: `${Math.max(1, 1/zoom)}px solid #fff`, borderRadius: '2px',
                    top: handle.includes('n') ? -handleSize/2 : 'auto',
                    bottom: handle.includes('s') ? -handleSize/2 : 'auto',
                    left: handle.includes('w') ? -handleSize/2 : 'auto',
                    right: handle.includes('e') ? -handleSize/2 : 'auto',
                    cursor: handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize',
                    zIndex: 10, pointerEvents: 'auto',
                  }} onMouseDown={(e) => handleShapeMouseDown(e, shape.id, handle)} />
                ))}
              </div>
            );
          })}
          {slots.map(slot => (
            <InfiniteSlot
              key={slot.id}
              slot={slot}
              project={project}
              allFiles={allFiles}
              detectedObjects={allDetectedObjects}
              drawnRegions={drawnRegions}
              onHotspotClick={(hotspot) => handleHotspotClick(hotspot, slot)}
              onDimensionsUpdate={(w, h) => updateSlotDimensions(slot.id, w, h)}
              onPositionUpdate={(x, y) => {
                batchedSingleDrag(slot.id, x, y);
              }}
              onDoubleClick={() => zoomToSlot(slot)}
              onDelete={() => removeSlotFromCanvas(slot)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSlotContextMenu({ x: e.clientX, y: e.clientY, slot });
              }}
              slotFileName={slot.fileName}
              onSlotClick={(e) => {
                const isCtrlClick = e && (e.ctrlKey || e.metaKey);
                if (isCtrlClick) {
                  // Ctrl+click to add/remove from selection
                  setSelectedSlotIds(prev => {
                    const next = new Set(prev);
                    if (next.has(slot.id)) {
                      next.delete(slot.id);
                    } else {
                      next.add(slot.id);
                    }
                    return next;
                  });
                  setAnchorSlotId(slot.id);
                } else if (selectedSlotIds.has(slot.id)) {
                  // Clicking on already selected PDF - don't change selection, just set anchor
                  setAnchorSlotId(slot.id);
                } else {
                  // Normal click on unselected PDF - select only this one
                  setSelectedSlotIds(new Set([slot.id]));
                  setAnchorSlotId(slot.id);
                }
              }}
              isAnchor={slot.id === anchorSlotId}
              isSelected={selectedSlotIds.has(slot.id)}
              selectedSlotIds={selectedSlotIds}
              isDragging={draggingSlotId === slot.id}
              onDragStart={() => setDraggingSlotId(slot.id)}
              onDragEnd={() => setDraggingSlotId(null)}
              onMultiDrag={(deltaX, deltaY) => {
                const idsToMove = selectedSlotIds.has(slot.id) 
                  ? selectedSlotIds 
                  : new Set([slot.id]);
                batchedMultiDrag(deltaX, deltaY, idsToMove);
              }}
              zoom={zoom}
              showLabel={zoom < 0.25}
              highlightedObjectId={highlightedObjectId}
              hiddenClasses={hiddenClasses}
              refreshKey={refreshKey}
              onObjectClick={async (obj) => {
                setSelectedObject({ ...obj });
                setShowObjectDialog(true);
                setHighlightedObjectId(obj.id);
                setObjectThumbnail(null);
                setTimeout(() => setHighlightedObjectId(null), 3000);
                
                // Fetch thumbnail
                try {
                  const response = await fetch(`${BACKEND_URL}/api/thumbnail`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      filename: obj.filename,
                      bbox: obj.bbox,
                      page: obj.page || 0,
                      expand: 0.935
                    })
                  });
                  if (response.ok) {
                    const data = await response.json();
                    setObjectThumbnail(data.thumbnail);
                  }
                } catch (error) {
                  console.error('Error fetching thumbnail:', error);
                }
              }}
              canDrag={currentTool === 'move'}
              currentTool={currentTool}
              isPanning={isPanning}
              showObjectTags={showObjectTags}
              showShadows={showShadows}
              cropRegion={cropEnabled ? cropRegion : null}
              isDrawingCrop={isDrawingCrop}
              onCropComplete={handleCropComplete}
              // Markup props
              markupMode={unlockedSlots.has(slot.id) ? markupMode : null}
              markupCursor={getMarkupCursor()}
              isSlotUnlocked={unlockedSlots.has(slot.id)}
              annotations={slotAnnotations[slot.id] || []}
              ownedAnnotationIds={ownedAnnotationIds[slot.id] || new Set()}
              onTakeOwnership={takeOwnershipOfAnnotation}
              onAnnotationAdd={(slotId, annotation) => {
                addAnnotationWithHistory(slotId, annotation);
              }}
              onAnnotationUpdate={(slotId, annotationId, updates) => {
                setSlotAnnotations(prev => ({
                  ...prev,
                  [slotId]: (prev[slotId] || []).map(a => 
                    a.id === annotationId ? { ...a, ...updates } : a
                  )
                }));
                // Keep selectedAnnotation in sync
                if (selectedAnnotation?.id === annotationId) {
                  setSelectedAnnotation(prev => prev ? { ...prev, ...updates } : null);
                }
              }}
              onAnnotationDelete={(slotId, annotationId) => {
                deleteAnnotationWithHistory(slotId, annotationId);
                if (selectedAnnotation?.id === annotationId) {
                  setSelectedAnnotation(null);
                }
              }}
              selectedAnnotation={selectedAnnotation}
              onAnnotationSelect={(annotation) => {
                setSelectedAnnotation(annotation ? { ...annotation, slotId: slot.id } : null);
              }}
              currentDrawing={currentDrawing}
              onDrawingStart={(drawing) => setCurrentDrawing(drawing)}
              onDrawingUpdate={(drawing) => setCurrentDrawing(drawing)}
              onDrawingEnd={() => setCurrentDrawing(null)}
              markupColor={markupColor}
              markupStrokeWidth={markupStrokeWidth}
              markupOpacity={markupOpacity}
              markupFillColor={markupFillColor}
              markupFillOpacity={markupFillOpacity}
              markupStrokeOpacity={markupStrokeOpacity}
              markupArrowHeadSize={markupArrowHeadSize}
              markupLineStyle={markupLineStyle}
              markupCloudArcSize={markupCloudArcSize}
              markupCloudInverted={markupCloudInverted}
              markupCloudIntensity={markupCloudIntensity}
              editingTextId={editingTextId}
              editingTextValue={editingTextValue}
              setEditingTextId={setEditingTextId}
              setEditingTextValue={setEditingTextValue}
              saveAnnotationHistory={saveAnnotationHistory}
              pendingPlacement={pendingPlacement}
              onPlaceSymbol={(pixelX, pixelY, slotCanvasSize) => {
                if (pendingPlacement) {
                  placeSymbolOnSlot(pendingPlacement.symbol, slot.id, pixelX, pixelY, slotCanvasSize);
                }
              }}
              onSymbolDrop={(symbol, pixelX, pixelY, slotCanvasSize) => {
                placeSymbolOnSlot(symbol, slot.id, pixelX, pixelY, slotCanvasSize);
              }}
            />
          ))}
          
        </div>
        
        {/* Drag box overlay (zoom-to-area or box-select) */}
        {dragBox && (() => {
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) return null;
          const left = Math.min(dragBox.startX, dragBox.endX) - rect.left;
          const top = Math.min(dragBox.startY, dragBox.endY) - rect.top;
          const width = Math.abs(dragBox.endX - dragBox.startX);
          const height = Math.abs(dragBox.endY - dragBox.startY);
          if (width < 3 && height < 3) return null;
          const isZoom = dragBox.type === 'zoom';
          return (
            <div style={{
              position: 'absolute', left, top, width, height,
              border: `2px ${isZoom ? 'solid' : 'dashed'} ${isZoom ? '#3498db' : '#2ecc71'}`,
              background: isZoom ? 'rgba(52, 152, 219, 0.12)' : 'rgba(46, 204, 113, 0.1)',
              borderRadius: isZoom ? '0' : '2px',
              zIndex: 9999,
              pointerEvents: 'none',
            }} />
          );
        })()}
        
        {/* Crosshair overlay for drawing modes */}
        {showCrosshairs && crosshairPos && (
          <>
            {/* Vertical line */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: crosshairPos.x,
                width: 0,
                height: '100%',
                borderLeft: `1px dashed ${markupMode ? 'rgba(231, 76, 60, 0.4)' : 'rgba(52, 152, 219, 0.4)'}`,
                zIndex: 9998,
                pointerEvents: 'none',
              }}
            />
            {/* Horizontal line */}
            <div
              style={{
                position: 'absolute',
                top: crosshairPos.y,
                left: 0,
                width: '100%',
                height: 0,
                borderTop: `1px dashed ${markupMode ? 'rgba(231, 76, 60, 0.4)' : 'rgba(52, 152, 219, 0.4)'}`,
                zIndex: 9998,
                pointerEvents: 'none',
              }}
            />
          </>
        )}
        
        {/* Pending Symbol Placement indicator */}
        {pendingPlacement && (
          <div style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(41, 128, 185, 0.95)',
            color: '#fff',
            padding: '8px 20px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 500,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            pointerEvents: 'auto',
          }}>
            <span>📍 Click on an unlocked document to place "{pendingPlacement.symbol?.name || 'symbol'}"</span>
            <button
              onClick={() => setPendingPlacement(null)}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: '#fff',
                borderRadius: '4px',
                padding: '3px 10px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >Cancel</button>
          </div>
        )}
        
        {/* Slot right-click context menu */}
        {slotContextMenu && (
          <SlotContextMenu
            x={slotContextMenu.x}
            y={slotContextMenu.y}
            slot={slotContextMenu.slot}
            isUnlocked={unlockedSlots.has(slotContextMenu.slot.id)}
            onToggleLock={() => {
              handleToggleSlotLock(slotContextMenu.slot);
              setSlotContextMenu(null);
            }}
            onRemove={() => {
              removeSlotFromCanvas(slotContextMenu.slot);
              setSlotContextMenu(null);
            }}
            onClose={() => setSlotContextMenu(null)}
          />
        )}
        
        {/* Crosshairs overlay */}
        {zoomSettings.showCrosshairs && mousePos && (
          <>
            <div className="iv-crosshair iv-crosshair-h" style={{ top: mousePos.screenY }} />
            <div className="iv-crosshair iv-crosshair-v" style={{ left: mousePos.screenX }} />
          </>
        )}

        {/* Coordinates display */}
        {zoomSettings.showCoordinates && mousePos && (
          <div className="iv-coordinates" style={{ left: mousePos.screenX + 16, top: mousePos.screenY + 16 }}>
            {mousePos.canvasX}, {mousePos.canvasY}
          </div>
        )}
        
        {/* Bottom Toolbar */}
        <CanvasToolbar
          currentTool={currentTool}
          setCurrentTool={setCurrentTool}
          zoom={zoom}
          setZoom={setZoom}
          onZoomToFitAll={zoomToFitAll}
          onRefresh={handleRefresh}
          viewLocked={viewLocked}
        />
        {/* Floating Markup Toolbar */}
        <InfiniteMarkupToolbar
          showMarkupsToolbar={showMarkupsToolbar}
          markupMode={markupMode}
          setMarkupMode={setMarkupMode}
          unlockedSlots={unlockedSlots}
          markupColor={markupColor} setMarkupColor={setMarkupColor}
          markupStrokeWidth={markupStrokeWidth} setMarkupStrokeWidth={setMarkupStrokeWidth}
          markupOpacity={markupOpacity} setMarkupOpacity={setMarkupOpacity}
          markupFillColor={markupFillColor} setMarkupFillColor={setMarkupFillColor}
          markupFillOpacity={markupFillOpacity} setMarkupFillOpacity={setMarkupFillOpacity}
          markupStrokeOpacity={markupStrokeOpacity} setMarkupStrokeOpacity={setMarkupStrokeOpacity}
          markupArrowHeadSize={markupArrowHeadSize} setMarkupArrowHeadSize={setMarkupArrowHeadSize}
          markupLineStyle={markupLineStyle} setMarkupLineStyle={setMarkupLineStyle}
          markupFontSize={markupFontSize} setMarkupFontSize={setMarkupFontSize}
          markupFontFamily={markupFontFamily} setMarkupFontFamily={setMarkupFontFamily}
          markupTextAlign={markupTextAlign} setMarkupTextAlign={setMarkupTextAlign}
          markupVerticalAlign={markupVerticalAlign} setMarkupVerticalAlign={setMarkupVerticalAlign}
          markupTextPadding={markupTextPadding} setMarkupTextPadding={setMarkupTextPadding}
          markupBorderColor={markupBorderColor} setMarkupBorderColor={setMarkupBorderColor}
          markupBorderWidth={markupBorderWidth} setMarkupBorderWidth={setMarkupBorderWidth}
          markupBorderStyle={markupBorderStyle} setMarkupBorderStyle={setMarkupBorderStyle}
          markupBorderOpacity={markupBorderOpacity} setMarkupBorderOpacity={setMarkupBorderOpacity}
          markupCloudArcSize={markupCloudArcSize} setMarkupCloudArcSize={setMarkupCloudArcSize}
          markupCloudIntensity={markupCloudIntensity} setMarkupCloudIntensity={setMarkupCloudIntensity}
          markupCloudInverted={markupCloudInverted} setMarkupCloudInverted={setMarkupCloudInverted}
          penHighlighterUIMode={penHighlighterUIMode} setPenHighlighterUIMode={setPenHighlighterUIMode}
          selectedAnnotation={selectedAnnotation}
          setSelectedAnnotation={setSelectedAnnotation}
          setSlotAnnotations={setSlotAnnotations}
          annotationHistory={annotationHistory}
          annotationFuture={annotationFuture}
          undoAnnotation={undoAnnotation}
          redoAnnotation={redoAnnotation}
          showSymbolsPanel={showSymbolsPanel}
          setShowSymbolsPanel={setShowSymbolsPanel}
          showMarkupHistoryPanel={showMarkupHistoryPanel}
          setShowMarkupHistoryPanel={setShowMarkupHistoryPanel}
          setShowObjectSearch={setShowObjectSearch}
          setShowViewOptions={setShowViewOptions}
          setShowViewsPanel={setShowViewsPanel}
          saveToolDefaults={saveToolDefaults}
        />
      </div>
      </div>
      {/* End of content wrapper */}
      
      {/* Object Detail Dialog */}
      {showObjectDialog && selectedObject && (
        <ObjectDetailDialog
          selectedObject={selectedObject}
          setSelectedObject={setSelectedObject}
          objectThumbnail={objectThumbnail}
          project={project}
          onSave={handleObjectSave}
          onClose={handleObjectDialogClose}
        />
      )}
      {/* Multi-Delete Confirmation Dialog */}
      {showMultiDeleteConfirm && selectedSlotIds.size > 0 && (
        <MultiDeleteDialog
          selectedSlotIds={selectedSlotIds}
          slots={slots}
          slotAnnotations={slotAnnotations}
          ownedAnnotationIds={ownedAnnotationIds}
          onConfirmDelete={handleMultiDelete}
          onClose={() => setShowMultiDeleteConfirm(false)}
        />
      )}
      {/* Batch Add Dialog */}
      {showBatchAdd && (
        <BatchAddDialog
          project={project}
          slots={slots}
          filePageCounts={filePageCounts}
          onFetchPageCount={handleFetchPageCount}
          onBatchAdd={handleBatchAdd}
          onClose={() => setShowBatchAdd(false)}
        />
      )}
      {showLoadBatchDialog && loadBatchTarget && (
        <LoadBatchDialog
          batch={loadBatchTarget}
          slots={slots}
          canvasShapes={canvasShapes}
          project={project}
          onLoadBatch={handleLoadBatchConfirm}
          onClose={() => { setShowLoadBatchDialog(false); setLoadBatchTarget(null); }}
        />
      )}

      {showZoomSettingsDialog && (
        <ZoomSettingsDialog
          settings={zoomSettings}
          onChange={setZoomSettings}
          onClose={() => setShowZoomSettingsDialog(false)}
        />
      )}
    </div>
  );
}

// Component for rendering a single PDF slot on the infinite canvas
/* ── Slot Context Menu (right-click) ────────────────────────────────── */

function SlotContextMenu({ x, y, slot, isUnlocked, onToggleLock, onRemove, onClose }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  // Adjust position so menu doesn't overflow viewport
  const adjustedX = Math.min(x, window.innerWidth - 180);
  const adjustedY = Math.min(y, window.innerHeight - 120);

  return (
    <div
      ref={menuRef}
      className="iv-slot-context-menu"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: adjustedX,
        top: adjustedY,
        zIndex: 10000,
      }}
    >
      <button
        className="iv-ctx-item"
        onClick={onToggleLock}
      >
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
          {isUnlocked ? (
            <>
              <rect x="3" y="8" width="10" height="7" rx="1.5" fill="#d4a017" stroke="#b8860b" strokeWidth="0.8"/>
              <path d="M5.5 8V5.5a2.5 2.5 0 015 0V8" stroke="#a8a8a8" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="8" cy="11.5" r="1" fill="#1a1a1a"/>
            </>
          ) : (
            <>
              <rect x="3" y="9" width="10" height="6.5" rx="1.5" fill="#f5c842" stroke="#e6b422" strokeWidth="0.8"/>
              <path d="M4.5 9V5a3 3 0 016 0" stroke="#e0e0e0" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="8" cy="12" r="1" fill="#1a1a1a"/>
            </>
          )}
        </svg>
        <span>{isUnlocked ? 'Lock' : 'Unlock'}</span>
      </button>
      <div className="iv-ctx-divider" />
      <button
        className="iv-ctx-item iv-ctx-danger"
        onClick={onRemove}
      >
        <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
          <path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4v9a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span>Remove</span>
      </button>
    </div>
  );
}


function InfiniteSlot({ 
  slot, 
  project, 
  allFiles,
  detectedObjects: allDetectedObjects,
  drawnRegions: allDrawnRegions,
  onHotspotClick, 
  onDimensionsUpdate,
  onPositionUpdate,
  onDoubleClick,
  onDelete,
  onContextMenu,
  onSlotClick,
  slotFileName,
  isAnchor,
  isSelected,
  selectedSlotIds,
  isDragging: isSlotDragging,
  onDragStart,
  onDragEnd,
  onMultiDrag,
  zoom,
  showLabel,
  canDrag,
  currentTool,
  isPanning,
  highlightedObjectId,
  hiddenClasses,
  refreshKey,
  onObjectClick,
  showObjectTags,
  showShadows,
  cropRegion,
  isDrawingCrop,
  onCropComplete,
  // Markup props
  markupMode,
  markupCursor,
  isSlotUnlocked,
  annotations,
  ownedAnnotationIds,
  onTakeOwnership,
  onAnnotationAdd,
  onAnnotationUpdate,
  onAnnotationDelete,
  selectedAnnotation,
  onAnnotationSelect,
  currentDrawing,
  onDrawingStart,
  onDrawingUpdate,
  onDrawingEnd,
  markupColor,
  markupStrokeWidth,
  markupOpacity,
  markupFillColor,
  markupFillOpacity,
  markupStrokeOpacity,
  markupArrowHeadSize,
  markupLineStyle,
  markupCloudArcSize,
  markupCloudInverted,
  markupCloudIntensity,
  editingTextId,
  editingTextValue,
  setEditingTextId,
  setEditingTextValue,
  saveAnnotationHistory,
  pendingPlacement,
  onPlaceSymbol,
  onSymbolDrop,
}) {
  const canvasRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [isRendered, setIsRendered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ lastX: 0, lastY: 0, active: false });
  const [isHovered, setIsHovered] = useState(false);
  const [hoveredObjectId, setHoveredObjectId] = useState(null);
  
  // Crop drawing state
  const [cropStart, setCropStart] = useState(null);
  const [tempCropRegion, setTempCropRegion] = useState(null);
  const tempCropRef = useRef(null); // Ref to avoid stale closure in mouseup
  
  // Local markup drawing state
  const [localDrawStart, setLocalDrawStart] = useState(null);
  const [penPoints, setPenPoints] = useState([]);
  const [polylinePoints, setPolylinePoints] = useState([]); // For polyline/cloudPolyline/polylineArrow
  const [polylineMousePos, setPolylineMousePos] = useState(null); // Preview line to cursor
  const textInputRef = useRef(null);
  const svgRef = useRef(null);
  const [isShiftPressed, setIsShiftPressed] = useState(false); // For snap functionality
  
  // Focus textarea when editing starts
  useEffect(() => {
    if (editingTextId && textInputRef.current) {
      // Small delay to ensure the textarea is rendered
      setTimeout(() => {
        if (textInputRef.current) {
          textInputRef.current.focus();
          // Put cursor at end of text
          const len = textInputRef.current.value?.length || 0;
          textInputRef.current.setSelectionRange(len, len);
        }
      }, 50);
    }
  }, [editingTextId]);
  
  // Manual double-click detection using click timing (native dblclick blocked by mousedown preventDefault)
  const lastClickRef = useRef({ time: 0, annId: null });
  
  const handleSvgClick = (e) => {
    // This only fires when clicking on empty space (not on annotations)
    // because annotations have stopPropagation in their onClick
    // Reset click tracking when clicking empty space
    lastClickRef.current = { time: 0, annId: null };
  };
  
  // Track shift key for snap functionality
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't capture events when typing in input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Shift') setIsShiftPressed(true);
      if (e.key === 'Escape' && polylinePoints.length > 0) {
        setPolylinePoints([]);
        setPolylineMousePos(null);
      }
    };
    const handleKeyUp = (e) => {
      if (e.key === 'Shift') setIsShiftPressed(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [polylinePoints]);
  
  // Clear polyline state when markup mode changes
  useEffect(() => {
    if (markupMode !== 'polyline' && markupMode !== 'polylineArrow' && markupMode !== 'cloudPolyline') {
      setPolylinePoints([]);
      setPolylineMousePos(null);
    }
  }, [markupMode]);
  
  // Annotation dragging/resizing state
  const [isMovingAnnotation, setIsMovingAnnotation] = useState(false);
  const [isResizingAnnotation, setIsResizingAnnotation] = useState(false);
  const [activeResizeHandle, setActiveResizeHandle] = useState(null);
  const [annotationMoveStart, setAnnotationMoveStart] = useState(null);
  const [draggingPolylinePoint, setDraggingPolylinePoint] = useState(null); // Index of point being dragged
  const [hoveredVertexIndex, setHoveredVertexIndex] = useState(null); // Index of vertex being hovered
  const [hoveredLineHandle, setHoveredLineHandle] = useState(null); // 'start' or 'end' for line handles
  const [hoveredRectHandle, setHoveredRectHandle] = useState(null); // 'nw', 'ne', etc for rect handles
  
  // Refs to track moving/resizing synchronously (avoid render delay)
  const isMovingRef = useRef(false);
  const isResizingRef = useRef(false);
  
  // Sync refs with state
  const wasMoveResizeRef = useRef(false);
  useEffect(() => {
    isMovingRef.current = isMovingAnnotation;
  }, [isMovingAnnotation]);
  
  useEffect(() => {
    isResizingRef.current = isResizingAnnotation;
  }, [isResizingAnnotation]);
  
  // Save history once when move/resize begins
  useEffect(() => {
    const isActive = isMovingAnnotation || isResizingAnnotation;
    if (isActive && !wasMoveResizeRef.current) {
      saveAnnotationHistory?.();
    }
    wasMoveResizeRef.current = isActive;
  }, [isMovingAnnotation, isResizingAnnotation, saveAnnotationHistory]);
  
  // Get bounds of an annotation for selection handles
  const getAnnotationBounds = (ann) => {
    if (!ann) return null;
    
    if (ann.type === 'pen' || ann.type === 'highlighter' || 
        ann.type === 'polyline' || ann.type === 'polylineArrow' || ann.type === 'cloudPolyline') {
      if (!ann.points || ann.points.length === 0) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      ann.points.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    
    const x = Math.min(ann.x1, ann.x2);
    const y = Math.min(ann.y1, ann.y2);
    const width = Math.abs(ann.x2 - ann.x1);
    const height = Math.abs(ann.y2 - ann.y1);
    return { x, y, width, height };
  };
  
  // Check if point is near a resize handle
  const getResizeHandleAtPoint = (x, y, bounds, annotation = null) => {
    if (!bounds) return null;
    // Larger hit area for easier grabbing (especially when zoomed out)
    const handleHitSize = 18;
    
    // For line/arrow/arc, check endpoint handles
    if (annotation && (annotation.type === 'line' || annotation.type === 'arrow' || annotation.type === 'arc')) {
      // Check start point
      if (Math.abs(x - annotation.x1) < handleHitSize && Math.abs(y - annotation.y1) < handleHitSize) {
        return 'start';
      }
      // Check end point
      if (Math.abs(x - annotation.x2) < handleHitSize && Math.abs(y - annotation.y2) < handleHitSize) {
        return 'end';
      }
      return null;
    }
    
    // For other shapes, check rectangle handles
    const handles = {
      nw: { x: bounds.x, y: bounds.y },
      ne: { x: bounds.x + bounds.width, y: bounds.y },
      sw: { x: bounds.x, y: bounds.y + bounds.height },
      se: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      n: { x: bounds.x + bounds.width / 2, y: bounds.y },
      s: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
      w: { x: bounds.x, y: bounds.y + bounds.height / 2 },
      e: { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 }
    };
    
    for (const [name, pos] of Object.entries(handles)) {
      if (Math.abs(x - pos.x) < handleHitSize && Math.abs(y - pos.y) < handleHitSize) {
        return name;
      }
    }
    return null;
  };
  
  // Check if point is inside annotation bounds
  const isPointInBounds = (x, y, bounds) => {
    if (!bounds) return false;
    return x >= bounds.x && x <= bounds.x + bounds.width &&
           y >= bounds.y && y <= bounds.y + bounds.height;
  };
  
  // Hover state for annotations
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState(null);
  
  // Helper to render annotation as SVG element
  // readOnly: if true, annotation is rendered but not interactive (for unowned PDF annotations)
  // ═══════════════════════════════════════════════════════════════════════
  // renderAnnotation bridge — converts pixel-coord annotations to normalized
  // format and delegates to the shared renderMarkupShape component.
  // This ensures rendering parity with PDFViewer (clouds, arrows, text, etc.)
  // ═══════════════════════════════════════════════════════════════════════
  const renderAnnotation = (ann, isPreview = false, readOnly = false) => {
    if (!canvasSize.width || !canvasSize.height) return null;
    
    const cw = canvasSize.width;
    const ch = canvasSize.height;
    
    // Line dash array helper (matches renderMarkupShape's expected signature)
    const getLineDash = (style, sw) => {
      const s = sw || 2;
      switch (style) {
        case 'dashed':   return [s * 4, s * 2];
        case 'dotted':   return [s, s * 2];
        case 'dashdot':  return [s * 4, s * 2, s, s * 2];
        case 'longdash': return [s * 8, s * 4];
        default:         return null;
      }
    };
    
    // Convert pixel-coord annotation to normalized format for renderMarkupShape
    const normalizedMarkup = { ...ann };
    
    // Convert x1/y1/x2/y2 (pixels) → startX/startY/endX/endY (0→1)
    if (ann.x1 !== undefined && ann.startX === undefined) {
      normalizedMarkup.startX = ann.x1 / cw;
      normalizedMarkup.startY = ann.y1 / ch;
      normalizedMarkup.endX = ann.x2 / cw;
      normalizedMarkup.endY = ann.y2 / ch;
    }
    
    // Convert pixel points to normalized
    if (ann.points && ann.points.length > 0 && ann.points[0].x !== undefined) {
      // Check if points are in pixel space (values > 1 likely means pixels)
      const firstPt = ann.points[0];
      const isPixelCoords = Math.abs(firstPt.x) > 1.5 || Math.abs(firstPt.y) > 1.5;
      if (isPixelCoords) {
        normalizedMarkup.points = ann.points.map(p => ({
          x: p.x / cw,
          y: p.y / ch
        }));
      }
    }
    
    // Arc type conversion
    if (ann.type === 'arc') {
      if (ann.x1 !== undefined && ann.point1X === undefined) {
        normalizedMarkup.point1X = ann.x1 / cw;
        normalizedMarkup.point1Y = ann.y1 / ch;
        normalizedMarkup.point2X = ann.x2 / cw;
        normalizedMarkup.point2Y = ann.y2 / ch;
        normalizedMarkup.arcBulge = ann.bulge || 0.3;
      }
    }
    
    // Ensure cloud properties are mapped
    if (ann.type === 'cloud' || ann.type === 'cloudPolyline') {
      normalizedMarkup.arcSize = ann.arcSize || ann.cloudArcSize || 15;
      normalizedMarkup.cloudArcSize = normalizedMarkup.arcSize;
      normalizedMarkup.inverted = ann.inverted ?? ann.cloudInverted ?? false;
      normalizedMarkup.cloudInverted = normalizedMarkup.inverted;
    }
    
    // Render options for renderMarkupShape
    const scale = 1; // InfiniteView SVG is 1:1 with pixels
    const scaledStrokeWidth = (ann.strokeWidth || 2) * scale;
    
    const isSelected = selectedAnnotation?.id === ann.id;
    const isHovered = hoveredAnnotationId === ann.id && !isPreview && !isMovingAnnotation && !isResizingAnnotation && !isSelected && !readOnly;
    
    // Render the shape via shared component
    const shapeJSX = renderMarkupShape(normalizedMarkup, {
      scaledWidth: cw,
      scaledHeight: ch,
      scale,
      scaledStrokeWidth,
      rotation: 0,
      getLineDashArray: getLineDash,
      selectedMarkup: selectedAnnotation,
      markupMode,
      selectMode: !markupMode || markupMode === 'select',
      editingTextMarkupId: editingTextId,
    });
    
    if (!shapeJSX) return null;
    
    // Wrap with interaction handlers (hover, click, mousedown)
    const hoverProps = (!isPreview && !readOnly) ? {
      'data-annotation-id': ann.id,
      onMouseEnter: () => isSlotUnlocked && !markupMode && !isMovingAnnotation && !isResizingAnnotation && !isSelected && setHoveredAnnotationId(ann.id),
      onMouseLeave: () => setHoveredAnnotationId(null),
      onMouseDown: (e) => {
        if (!isSlotUnlocked) return;
        
        // Double-click detection
        const now = Date.now();
        const timeDiff = now - lastClickRef.current.time;
        const sameAnnotation = lastClickRef.current.annId === ann.id;
        
        if (sameAnnotation && timeDiff < 500 && (ann.type === 'text' || ann.type === 'rectangle' || ann.type === 'circle' || ann.type === 'cloud')) {
          e.stopPropagation();
          e.preventDefault();
          setIsMovingAnnotation(false);
          setIsResizingAnnotation(false);
          setAnnotationMoveStart(null);
          setEditingTextId(ann.id);
          setEditingTextValue(ann.text || '');
          onAnnotationSelect?.(ann);
          lastClickRef.current = { time: 0, annId: null };
          return;
        }
        
        lastClickRef.current = { time: now, annId: ann.id };
        
        if (isMovingAnnotation || isResizingAnnotation) return;
        if (editingTextId === ann.id) return;
        
        if (editingTextId && editingTextId !== ann.id) {
          const currentText = textInputRef.current?.value ?? '';
          onAnnotationUpdate?.(slot.id, editingTextId, { text: currentText });
          setEditingTextId(null);
          setEditingTextValue('');
        }
        
        setHoveredAnnotationId(null);
        
        if (!markupMode || markupMode === 'select') {
          e.stopPropagation();
          e.preventDefault();
          
          if (!isSelected) {
            onAnnotationSelect?.(ann);
          } else {
            const svg = e.target.ownerSVGElement || e.currentTarget.ownerSVGElement;
            if (svg) {
              const point = svg.createSVGPoint();
              point.x = e.clientX;
              point.y = e.clientY;
              const ctm = svg.getScreenCTM();
              if (ctm) {
                const svgPoint = point.matrixTransform(ctm.inverse());
                const x = svgPoint.x;
                const y = svgPoint.y;
                const bounds = getAnnotationBounds(ann);
                const handle = getResizeHandleAtPoint(x, y, bounds, ann);
                if (handle) {
                  setIsResizingAnnotation(true);
                  setActiveResizeHandle(handle);
                  setAnnotationMoveStart({ x, y, annotation: { ...ann, slotId: slot.id } });
                } else {
                  setAnnotationMoveStart({ x, y, annotation: { ...ann, slotId: slot.id }, pending: true });
                }
              }
            }
          }
        }
      },
      onClick: (e) => {
        if (isSlotUnlocked) e.stopPropagation();
      },
      style: {
        cursor: !markupMode ? 'pointer' : 'crosshair',
        pointerEvents: 'auto'
      }
    } : { style: { pointerEvents: readOnly ? 'none' : 'auto' } };
    
    // Add hover highlight effect
    const hoverFilter = isHovered ? 'drop-shadow(0 0 3px rgba(0, 102, 255, 0.8))' : undefined;
    
    return (
      <g key={ann.id} {...hoverProps} style={{ ...hoverProps.style, filter: hoverFilter }}>
        {shapeJSX}
      </g>
    );
  };
  
  // Helper to get SVG coordinates from mouse event
  const getSvgCoords = (e) => {
    // Try to get SVG from currentTarget, or use svgRef as fallback
    let svg = e.currentTarget;
    if (!svg || !svg.createSVGPoint) {
      svg = svgRef.current;
    }
    if (!svg || !svg.createSVGPoint) {
      // Ultimate fallback - just use client coordinates
      const rect = e.target.closest('svg')?.getBoundingClientRect();
      if (rect) {
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      }
      return { x: 0, y: 0 };
    }
    const point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (ctm) {
      const svgPoint = point.matrixTransform(ctm.inverse());
      return { x: svgPoint.x, y: svgPoint.y };
    }
    // Fallback
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  
  // Handle markup mouse events
  const handleMarkupMouseDown = (e) => {
    // Skip markup handling during crop drawing
    if (isDrawingCrop || currentTool === 'crop') return;
    
    const { x, y } = getSvgCoords(e);
    
    // Handle pending symbol placement
    if (pendingPlacement && isSlotUnlocked) {
      e.stopPropagation();
      e.preventDefault();
      onPlaceSymbol?.(x, y, canvasSize);
      return;
    }
    
    // Close text editing if clicking outside the text box
    if (editingTextId) {
      const editingAnn = annotations.find(a => a.id === editingTextId);
      if (editingAnn) {
        const bounds = getAnnotationBounds(editingAnn);
        if (!bounds || !isPointInBounds(x, y, bounds)) {
          // Save and close
          const currentText = textInputRef.current?.value ?? '';
          onAnnotationUpdate?.(slot.id, editingTextId, { text: currentText });
          setEditingTextId(null);
          setEditingTextValue('');
          e.stopPropagation();
          e.preventDefault();
          return;
        }
      }
    }
    
    // If eraser mode, check if clicking on an annotation to delete
    if (markupMode === 'eraser') {
      e.stopPropagation();
      e.preventDefault();
      for (const ann of annotations) {
        const bounds = getAnnotationBounds(ann);
        if (bounds && isPointInBounds(x, y, bounds)) {
          onAnnotationDelete?.(slot.id, ann.id);
          return;
        }
      }
      return;
    }
    
    // If no markup mode or select mode, check for annotation interaction
    if (!markupMode || markupMode === 'select') {
      // Check if clicking on selected annotation's resize handle or body
      if (selectedAnnotation && selectedAnnotation.slotId === slot.id) {
        const bounds = getAnnotationBounds(selectedAnnotation);
        const handle = getResizeHandleAtPoint(x, y, bounds, selectedAnnotation);
        if (handle) {
          e.stopPropagation();
          e.preventDefault();
          setIsResizingAnnotation(true);
          setActiveResizeHandle(handle);
          setAnnotationMoveStart({ x, y, annotation: { ...selectedAnnotation } });
          return;
        }
        
        // Check if clicking inside selected annotation to move it
        if (bounds && isPointInBounds(x, y, bounds)) {
          e.stopPropagation();
          e.preventDefault();
          setIsMovingAnnotation(true);
          setAnnotationMoveStart({ x, y, annotation: { ...selectedAnnotation } });
          return;
        }
      }
      
      // Check if clicking on any annotation - let the annotation's own handler handle selection
      // This is just for fallback/bounds checking
      for (let i = annotations.length - 1; i >= 0; i--) {
        const ann = annotations[i];
        const bounds = getAnnotationBounds(ann);
        if (bounds && isPointInBounds(x, y, bounds)) {
          // Annotation's own handler should handle this, just return without deselecting
          return;
        }
      }
      
      // Clicked on empty space - deselect annotation
      if (selectedAnnotation) {
        onAnnotationSelect?.(null);
      }
      // Don't stop propagation - allow pan to work
      return;
    }
    
    // We have an active markup mode - stop propagation for drawing
    e.stopPropagation();
    e.preventDefault();
    
    // Polyline modes - click to add point
    if (markupMode === 'polyline' || markupMode === 'polylineArrow' || markupMode === 'cloudPolyline') {
      // Helper to snap coordinates
      const snapTo8Directions = (startX, startY, endX, endY) => {
        const dx = endX - startX;
        const dy = endY - startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.001) return { x: endX, y: endY };
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        const snapAngle = Math.round(angle / 45) * 45;
        const snapRad = snapAngle * Math.PI / 180;
        return {
          x: startX + dist * Math.cos(snapRad),
          y: startY + dist * Math.sin(snapRad)
        };
      };
      
      if (polylinePoints.length === 0) {
        // First point
        setPolylinePoints([{ x, y }]);
      } else {
        // Apply snap if shift is held
        let pointX = x, pointY = y;
        if (isShiftPressed) {
          const lastPt = polylinePoints[polylinePoints.length - 1];
          const snapped = snapTo8Directions(lastPt.x, lastPt.y, x, y);
          pointX = snapped.x;
          pointY = snapped.y;
        }
        
        // Check if clicking near start point to close (need at least 3 points)
        const startPt = polylinePoints[0];
        const dist = Math.sqrt(Math.pow(pointX - startPt.x, 2) + Math.pow(pointY - startPt.y, 2));
        const closeThreshold = 15;
        
        if (polylinePoints.length >= 3 && dist < closeThreshold) {
          // Close the polyline
          const newAnnotation = {
            id: `${markupMode}_${Date.now()}`,
            type: markupMode,
            slotId: slot.id,
            points: [...polylinePoints],
            closed: true,
            color: markupColor,
            strokeWidth: markupStrokeWidth,
            fillColor: markupFillColor,
            fillOpacity: markupFillOpacity,
            strokeOpacity: markupStrokeOpacity,
            lineStyle: markupLineStyle,
            arrowHeadSize: markupArrowHeadSize,
            arcSize: markupCloudArcSize,
            cloudInverted: markupCloudInverted,
            cloudIntensity: markupCloudIntensity
          };
          onAnnotationAdd?.(slot.id, newAnnotation);
          setPolylinePoints([]);
          setPolylineMousePos(null);
        } else {
          // Add point (with snap applied)
          setPolylinePoints(prev => [...prev, { x: pointX, y: pointY }]);
        }
      }
      return;
    }
    
    // Text mode - draw a box first, then add text on complete
    if (markupMode === 'text') {
      setLocalDrawStart({ x, y });
      onDrawingStart?.({
        id: `text_${Date.now()}`,
        type: 'text',
        slotId: slot.id,
        x1: x,
        y1: y,
        x2: x,
        y2: y,
        text: '',
        color: markupColor,
        textColor: markupColor,
        borderColor: markupColor,
        fillColor: markupFillColor,
        fillOpacity: markupFillOpacity,
        strokeWidth: markupStrokeWidth,
        strokeOpacity: markupStrokeOpacity,
        fontSize: 14,
        fontFamily: 'Arial',
        textAlign: 'left'
      });
      return;
    }
    
    // Drawing mode - start new annotation (drag-based shapes)
    setLocalDrawStart({ x, y });
    
    if (markupMode === 'pen' || markupMode === 'highlighter') {
      setPenPoints([{ x, y }]);
    }
    
    onDrawingStart?.({
      id: `${markupMode}_${Date.now()}`,
      type: markupMode,
      slotId: slot.id,
      x1: x,
      y1: y,
      x2: x,
      y2: y,
      color: markupColor,
      strokeWidth: markupMode === 'highlighter' ? markupStrokeWidth * 3 : markupStrokeWidth,
      opacity: markupOpacity,
      fillColor: markupFillColor,
      fillOpacity: markupFillOpacity,
      strokeOpacity: markupStrokeOpacity,
      arrowHeadSize: markupArrowHeadSize,
      lineStyle: markupLineStyle,
      arcSize: markupCloudArcSize,
      cloudInverted: markupCloudInverted,
      cloudIntensity: markupCloudIntensity,
      points: markupMode === 'pen' || markupMode === 'highlighter' ? [{ x, y }] : undefined
    });
  };
  
  const handleMarkupMouseMove = (e) => {
    let { x, y } = getSvgCoords(e);
    
    // Helper function to snap coordinates to 8 directions (0°, 45°, 90°, etc.)
    const snapTo8Directions = (startX, startY, endX, endY) => {
      const dx = endX - startX;
      const dy = endY - startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.001) return { x: endX, y: endY };
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const snapAngle = Math.round(angle / 45) * 45;
      const snapRad = snapAngle * Math.PI / 180;
      return {
        x: startX + dist * Math.cos(snapRad),
        y: startY + dist * Math.sin(snapRad)
      };
    };
    
    // Update polyline preview line with optional snap
    if ((markupMode === 'polyline' || markupMode === 'polylineArrow' || markupMode === 'cloudPolyline') && polylinePoints.length > 0) {
      e.stopPropagation();
      let previewX = x, previewY = y;
      if (isShiftPressed) {
        const lastPt = polylinePoints[polylinePoints.length - 1];
        const snapped = snapTo8Directions(lastPt.x, lastPt.y, x, y);
        previewX = snapped.x;
        previewY = snapped.y;
      }
      setPolylineMousePos({ x: previewX, y: previewY });
      return;
    }
    
    // Check for pending move (user dragging after mousedown)
    if (annotationMoveStart?.pending && selectedAnnotation) {
      const dx = Math.abs(x - annotationMoveStart.x);
      const dy = Math.abs(y - annotationMoveStart.y);
      // Start move if dragged more than 3 pixels
      if (dx > 3 || dy > 3) {
        setIsMovingAnnotation(true);
        setAnnotationMoveStart({ ...annotationMoveStart, pending: false });
      }
      return;
    }
    
    // Handle annotation resizing
    if (isResizingAnnotation && annotationMoveStart && selectedAnnotation) {
      e.stopPropagation();
      const orig = annotationMoveStart.annotation;
      let newX1 = orig.x1, newY1 = orig.y1, newX2 = orig.x2, newY2 = orig.y2;
      
      switch (activeResizeHandle) {
        // Line/arrow endpoint handles
        case 'start': newX1 = x; newY1 = y; break;
        case 'end': newX2 = x; newY2 = y; break;
        // Rectangle corner/edge handles
        case 'nw': newX1 = x; newY1 = y; break;
        case 'ne': newX2 = x; newY1 = y; break;
        case 'sw': newX1 = x; newY2 = y; break;
        case 'se': newX2 = x; newY2 = y; break;
        case 'n': newY1 = y; break;
        case 's': newY2 = y; break;
        case 'w': newX1 = x; break;
        case 'e': newX2 = x; break;
      }
      
      onAnnotationUpdate?.(slot.id, selectedAnnotation.id, { x1: newX1, y1: newY1, x2: newX2, y2: newY2 });
      return;
    }
    
    // Handle polyline point dragging
    if (draggingPolylinePoint !== null && annotationMoveStart && selectedAnnotation && selectedAnnotation.points) {
      e.stopPropagation();
      const newPoints = [...selectedAnnotation.points];
      newPoints[draggingPolylinePoint] = { x, y };
      onAnnotationUpdate?.(slot.id, selectedAnnotation.id, { points: newPoints });
      return;
    }
    
    // Handle annotation moving
    if (isMovingAnnotation && annotationMoveStart && selectedAnnotation) {
      e.stopPropagation();
      const dx = x - annotationMoveStart.x;
      const dy = y - annotationMoveStart.y;
      const orig = annotationMoveStart.annotation;
      
      if (orig.points) {
        // Move all points for pen/highlighter/polyline
        const newPoints = orig.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
        onAnnotationUpdate?.(slot.id, selectedAnnotation.id, { points: newPoints });
      } else {
        onAnnotationUpdate?.(slot.id, selectedAnnotation.id, {
          x1: orig.x1 + dx,
          y1: orig.y1 + dy,
          x2: orig.x2 + dx,
          y2: orig.y2 + dy
        });
      }
      return;
    }
    
    // Handle drawing
    if (!localDrawStart || !markupMode) return;
    
    e.stopPropagation();
    
    // Apply shift-snap for pen/highlighter
    if (markupMode === 'pen' || markupMode === 'highlighter') {
      if (isShiftPressed && penPoints.length > 0) {
        // Shift-snap: straight line from first point
        const firstPt = penPoints[0];
        const snapped = snapTo8Directions(firstPt.x, firstPt.y, x, y);
        const newPoints = [firstPt, snapped];
        setPenPoints(newPoints);
        onDrawingUpdate?.({
          ...currentDrawing,
          points: newPoints,
          x2: snapped.x,
          y2: snapped.y
        });
      } else {
        const newPoints = [...penPoints, { x, y }];
        setPenPoints(newPoints);
        onDrawingUpdate?.({
          ...currentDrawing,
          points: newPoints,
          x2: x,
          y2: y
        });
      }
    } else if (markupMode === 'line' || markupMode === 'arrow') {
      // Apply shift-snap for line/arrow
      let endX = x, endY = y;
      if (isShiftPressed) {
        const snapped = snapTo8Directions(localDrawStart.x, localDrawStart.y, x, y);
        endX = snapped.x;
        endY = snapped.y;
      }
      onDrawingUpdate?.({
        ...currentDrawing,
        x2: endX,
        y2: endY
      });
    } else {
      onDrawingUpdate?.({
        ...currentDrawing,
        x2: x,
        y2: y
      });
    }
  };
  
  // Handle double-click to complete polyline without closing
  const handleMarkupDoubleClick = (e) => {
    // Handle polyline completion on double-click
    if ((markupMode === 'polyline' || markupMode === 'polylineArrow' || markupMode === 'cloudPolyline') && polylinePoints.length >= 2) {
      e.stopPropagation();
      e.preventDefault();
      
      const newAnnotation = {
        id: `${markupMode}_${Date.now()}`,
        type: markupMode,
        slotId: slot.id,
        points: [...polylinePoints],
        closed: false,
        color: markupColor,
        strokeWidth: markupStrokeWidth,
        fillColor: markupFillColor,
        fillOpacity: markupFillOpacity,
        strokeOpacity: markupStrokeOpacity,
        lineStyle: markupLineStyle,
        arrowHeadSize: markupArrowHeadSize,
        arcSize: markupCloudArcSize,
        cloudInverted: markupCloudInverted,
        cloudIntensity: markupCloudIntensity
      };
      onAnnotationAdd?.(slot.id, newAnnotation);
      setPolylinePoints([]);
      setPolylineMousePos(null);
      return;
    }
    
    // Check if we double-clicked on a text-editable annotation
    const coords = getSvgCoords(e);
    if (!coords) return;
    
    const { x, y } = coords;
    
    // Find annotation at click position (reverse order to get topmost first)
    for (let i = (annotations || []).length - 1; i >= 0; i--) {
      const ann = annotations[i];
      if (ann.type === 'text' || ann.type === 'rectangle' || ann.type === 'circle' || ann.type === 'cloud') {
        const bounds = getAnnotationBounds(ann);
        if (bounds && x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height) {
          e.stopPropagation();
          e.preventDefault();
          // Clear move/resize state
          setIsMovingAnnotation(false);
          setIsResizingAnnotation(false);
          setAnnotationMoveStart(null);
          // Enter edit mode
          setEditingTextId(ann.id);
          setEditingTextValue(ann.text || '');
          onAnnotationSelect?.(ann);
          return;
        }
      }
    }
  };
  
  const handleMarkupMouseUp = (e) => {
    // Clear pending move state (user clicked but didn't drag)
    if (annotationMoveStart?.pending) {
      setAnnotationMoveStart(null);
      return;
    }
    
    // End polyline point dragging
    if (draggingPolylinePoint !== null) {
      setDraggingPolylinePoint(null);
      setAnnotationMoveStart(null);
      return;
    }
    
    // End annotation moving/resizing
    if (isMovingAnnotation || isResizingAnnotation) {
      setIsMovingAnnotation(false);
      setIsResizingAnnotation(false);
      setActiveResizeHandle(null);
      setAnnotationMoveStart(null);
      return;
    }
    
    if (!localDrawStart || !markupMode) return;
    
    // Helper to snap coordinates
    const snapTo8Directions = (startX, startY, endX, endY) => {
      const dx = endX - startX;
      const dy = endY - startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.001) return { x: endX, y: endY };
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const snapAngle = Math.round(angle / 45) * 45;
      const snapRad = snapAngle * Math.PI / 180;
      return {
        x: startX + dist * Math.cos(snapRad),
        y: startY + dist * Math.sin(snapRad)
      };
    };
    
    // Get final coordinates
    let x, y;
    if (e && e.currentTarget) {
      const coords = getSvgCoords(e);
      x = coords.x;
      y = coords.y;
    } else {
      // Use last known position
      x = currentDrawing?.x2 || localDrawStart.x;
      y = currentDrawing?.y2 || localDrawStart.y;
    }
    
    // Apply snap for line/arrow
    if (isShiftPressed && (markupMode === 'line' || markupMode === 'arrow')) {
      const snapped = snapTo8Directions(localDrawStart.x, localDrawStart.y, x, y);
      x = snapped.x;
      y = snapped.y;
    }
    
    // For pen/highlighter with shift, use the already-snapped penPoints
    let finalPoints = penPoints;
    if (isShiftPressed && (markupMode === 'pen' || markupMode === 'highlighter') && penPoints.length > 0) {
      const firstPt = penPoints[0];
      const snapped = snapTo8Directions(firstPt.x, firstPt.y, x, y);
      finalPoints = [firstPt, snapped];
    }
    
    const finalAnnotation = {
      ...currentDrawing,
      x2: x,
      y2: y,
      points: markupMode === 'pen' || markupMode === 'highlighter' ? finalPoints : undefined
    };
    
    // Only add if it has some size
    const hasSize = markupMode === 'pen' || markupMode === 'highlighter' 
      ? finalPoints.length > 1
      : Math.abs(finalAnnotation.x2 - finalAnnotation.x1) > 5 || Math.abs(finalAnnotation.y2 - finalAnnotation.y1) > 5;
    
    if (hasSize) {
      onAnnotationAdd?.(slot.id, finalAnnotation);
      
      // For text boxes, immediately enter edit mode
      if (markupMode === 'text') {
        setTimeout(() => {
          setEditingTextId(finalAnnotation.id);
          setEditingTextValue('');
        }, 50);
      }
    }
    
    setLocalDrawStart(null);
    setPenPoints([]);
    onDrawingEnd?.();
  };
  
  // Global mouse handlers for annotation move/resize (so it works even outside SVG)
  useEffect(() => {
    // Handle pending move transition (convert mousedown to move when drag threshold exceeded)
    if (annotationMoveStart?.pending && !isMovingAnnotation && !isResizingAnnotation) {
      const handlePendingMouseMove = (e) => {
        if (!svgRef.current) return;
        
        // Get SVG coordinates
        const svg = svgRef.current;
        const point = svg.createSVGPoint();
        point.x = e.clientX;
        point.y = e.clientY;
        const ctm = svg.getScreenCTM();
        if (!ctm) return;
        const svgPoint = point.matrixTransform(ctm.inverse());
        
        const dx = Math.abs(svgPoint.x - annotationMoveStart.x);
        const dy = Math.abs(svgPoint.y - annotationMoveStart.y);
        
        // Start move if dragged more than 3 pixels
        if (dx > 3 || dy > 3) {
          setIsMovingAnnotation(true);
          setAnnotationMoveStart({ ...annotationMoveStart, pending: false });
        }
      };
      
      const handlePendingMouseUp = () => {
        // User clicked but didn't drag - clear pending state
        setAnnotationMoveStart(null);
      };
      
      window.addEventListener('mousemove', handlePendingMouseMove);
      window.addEventListener('mouseup', handlePendingMouseUp);
      
      return () => {
        window.removeEventListener('mousemove', handlePendingMouseMove);
        window.removeEventListener('mouseup', handlePendingMouseUp);
      };
    }
    
    if (!isMovingAnnotation && !isResizingAnnotation && draggingPolylinePoint === null) return;
    
    // Clear hover state when moving/resizing starts
    setHoveredAnnotationId(null);
    
    const handleGlobalMouseMove = (e) => {
      if (!svgRef.current || !annotationMoveStart || !selectedAnnotation) return;
      
      // Get SVG coordinates
      const svg = svgRef.current;
      const point = svg.createSVGPoint();
      point.x = e.clientX;
      point.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const svgPoint = point.matrixTransform(ctm.inverse());
      const x = svgPoint.x;
      const y = svgPoint.y;
      
      // Handle polyline point dragging
      if (draggingPolylinePoint !== null && selectedAnnotation.points) {
        const newPoints = [...selectedAnnotation.points];
        newPoints[draggingPolylinePoint] = { x, y };
        onAnnotationUpdate?.(slot.id, selectedAnnotation.id, { points: newPoints });
        return;
      }
      
      if (isResizingAnnotation) {
        const orig = annotationMoveStart.annotation;
        let newX1 = orig.x1, newY1 = orig.y1, newX2 = orig.x2, newY2 = orig.y2;
        
        switch (activeResizeHandle) {
          case 'start': newX1 = x; newY1 = y; break;
          case 'end': newX2 = x; newY2 = y; break;
          case 'nw': newX1 = x; newY1 = y; break;
          case 'ne': newX2 = x; newY1 = y; break;
          case 'sw': newX1 = x; newY2 = y; break;
          case 'se': newX2 = x; newY2 = y; break;
          case 'n': newY1 = y; break;
          case 's': newY2 = y; break;
          case 'w': newX1 = x; break;
          case 'e': newX2 = x; break;
        }
        
        onAnnotationUpdate?.(slot.id, selectedAnnotation.id, { x1: newX1, y1: newY1, x2: newX2, y2: newY2 });
      } else if (isMovingAnnotation) {
        const dx = x - annotationMoveStart.x;
        const dy = y - annotationMoveStart.y;
        const orig = annotationMoveStart.annotation;
        
        if (orig.points) {
          const newPoints = orig.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
          onAnnotationUpdate?.(slot.id, selectedAnnotation.id, { points: newPoints });
        } else {
          onAnnotationUpdate?.(slot.id, selectedAnnotation.id, {
            x1: orig.x1 + dx,
            y1: orig.y1 + dy,
            x2: orig.x2 + dx,
            y2: orig.y2 + dy
          });
        }
      }
    };
    
    const handleGlobalMouseUp = () => {
      setIsMovingAnnotation(false);
      setIsResizingAnnotation(false);
      setActiveResizeHandle(null);
      setAnnotationMoveStart(null);
      setDraggingPolylinePoint(null);
    };
    
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isMovingAnnotation, isResizingAnnotation, draggingPolylinePoint, annotationMoveStart, selectedAnnotation, activeResizeHandle, slot.id, onAnnotationUpdate]);
  
  // Default colors for classes (no orange)
  const defaultColors = [
    '#3498db', '#e74c3c', '#2ecc71', '#9b59b6',
    '#1abc9c', '#e91e63', '#9c27b0', '#00bcd4', '#ff5722'
  ];
  
  const getClassColors = (classNameOrNames) => {
    // Accept single name or array of names to try
    const namesToTry = Array.isArray(classNameOrNames) 
      ? classNameOrNames.filter(Boolean) 
      : [classNameOrNames].filter(Boolean);
    
    const defaultColor = '#3498db';
    if (namesToTry.length === 0) return { fillColor: defaultColor, borderColor: defaultColor };
    
    const classes = project?.classes || [];
    const colors = project?.classColors || {};
    
    // Helper to generate hash-based color
    const getHashColor = (name) => {
      let hash = 0;
      for (let i = 0; i < (name || '').length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
      }
      return defaultColors[Math.abs(hash) % defaultColors.length];
    };
    
    // Try each name
    for (const className of namesToTry) {
      // Try exact match in project.classes FIRST - prefer root classes (no parentId) since they have the color
      let cls = classes.find(c => c.name === className && !c.parentId);
      
      // If not found as root, try any match
      if (!cls) {
        cls = classes.find(c => c.name === className);
      }
      
      // If not found, try matching the first part of a path
      if (!cls && className.includes(' > ')) {
        const parentName = className.split(' > ')[0];
        cls = classes.find(c => c.name === parentName && !c.parentId);
      }
      
      // If still not found, try case-insensitive match
      if (!cls) {
        cls = classes.find(c => c.name?.toLowerCase() === className?.toLowerCase());
      }
      
      // If found in project.classes, return fillColor and borderColor
      if (cls) {
        const legacyColor = cls.color || getHashColor(cls.name);
        return {
          fillColor: cls.fillColor !== undefined ? cls.fillColor : legacyColor,
          borderColor: cls.borderColor !== undefined ? cls.borderColor : legacyColor
        };
      }
      
      // Fall back to legacy classColors map
      if (colors[className]) {
        return { fillColor: colors[className], borderColor: colors[className] };
      }
    }
    
    // Generate a consistent default color based on first name
    const hashColor = getHashColor(namesToTry[0]);
    return { fillColor: hashColor, borderColor: hashColor };
  };

  // Get shape type for a class (from class definition)
  const getClassShapeType = (classNameOrNames) => {
    // Accept single name or array of names to try
    const namesToTry = Array.isArray(classNameOrNames) 
      ? classNameOrNames.filter(Boolean) 
      : [classNameOrNames].filter(Boolean);
    
    if (namesToTry.length === 0) return 'rectangle';
    
    const classes = project?.classes || [];
    
    // Try each name
    for (const className of namesToTry) {
      // Try exact match first
      let cls = classes.find(c => c.name === className);
      
      // If not found, try matching the first part of a path
      if (!cls && className.includes(' > ')) {
        const parentName = className.split(' > ')[0];
        cls = classes.find(c => c.name === parentName);
      }
      
      // If still not found, try case-insensitive match
      if (!cls) {
        cls = classes.find(c => c.name?.toLowerCase() === className?.toLowerCase());
      }
      
      if (cls?.shapeType) return cls.shapeType;
    }
    
    return 'rectangle';
  };
  
  // Click/drag handlers
  const handleMouseDown = (e) => {
    // Don't process hotspot clicks for dragging
    if (e.target.closest('.infinite-hotspot')) {
      return;
    }
    
    // Handle crop drawing
    if (isDrawingCrop && canvasRef.current) {
      e.stopPropagation();
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setCropStart({ x, y });
      setTempCropRegion({ x, y, width: 0, height: 0 });
      return;
    }
    
    // Only start dragging when Move tool is active
    if (canDrag && currentTool === 'move') {
      e.stopPropagation();
      const currentX = e.clientX / zoom;
      const currentY = e.clientY / zoom;
      dragRef.current = { lastX: currentX, lastY: currentY, active: true };
      setIsDragging(true);
      onDragStart?.();
    }
    // For pan tool, let event bubble up to canvas
  };
  
  const handleDoubleClick = (e) => {
    // Don't zoom during crop drawing
    if (isDrawingCrop || currentTool === 'crop') return;
    // Don't zoom if double-clicking on a hotspot
    if (e.target.closest('.infinite-hotspot')) {
      return;
    }
    // Don't zoom if double-clicking on annotation overlay
    if (e.target.closest('.annotation-overlay')) {
      return;
    }
    e.stopPropagation();
    onDoubleClick?.();
  };
  
  // Keep a ref for values the drag handler needs (avoids stale closures)
  const dragContextRef = useRef({ zoom, isSelected, selectedSlotIds, slot });
  dragContextRef.current = { zoom, isSelected, selectedSlotIds, slot };

  useEffect(() => {
    if (!isDragging && !cropStart) return;

    const onMove = (e) => {
      // Handle crop drawing
      if (cropStart && isDrawingCrop && canvasRef.current) {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const currentX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const currentY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        
        const x = Math.min(cropStart.x, currentX);
        const y = Math.min(cropStart.y, currentY);
        const width = Math.abs(currentX - cropStart.x);
        const height = Math.abs(currentY - cropStart.y);
        
        const region = { x, y, width, height };
        tempCropRef.current = region;
        setTempCropRegion(region);
        return;
      }

      if (dragRef.current.active) {
        e.stopPropagation();
        const ctx = dragContextRef.current;
        const currentX = e.clientX / ctx.zoom;
        const currentY = e.clientY / ctx.zoom;
        const deltaX = currentX - dragRef.current.lastX;
        const deltaY = currentY - dragRef.current.lastY;
        dragRef.current.lastX = currentX;
        dragRef.current.lastY = currentY;
        
        if (ctx.isSelected || ctx.selectedSlotIds?.size > 0) {
          onMultiDrag?.(deltaX, deltaY);
        } else {
          onPositionUpdate?.(ctx.slot.x + deltaX, ctx.slot.y + deltaY);
        }
      }
    };

    const onUp = () => {
      if (cropStart && isDrawingCrop) {
        const region = tempCropRef.current;
        if (region && region.width > 0.01 && region.height > 0.01) {
          onCropComplete?.(region);
        }
        setCropStart(null);
        setTempCropRegion(null);
        tempCropRef.current = null;
        return;
      }
      if (dragRef.current.active) {
        dragRef.current.active = false;
        setIsDragging(false);
        onDragEnd?.();
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, cropStart, isDrawingCrop]);
  
  // Render the PDF page
  useEffect(() => {
    let renderTask = null;
    let isCancelled = false;
    let retryCount = 0;
    let retryTimer = null;
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 500; // ms
    
    // Reset rendered state so loading placeholder shows during re-render
    setIsRendered(false);
    
    const renderPage = async () => {
      if (!slot.pdfDoc || !canvasRef.current || isCancelled) return;
      
      try {
        const page = await slot.pdfDoc.getPage(slot.page);
        if (isCancelled) return;
        
        const scale = 1.5; // Base scale for good quality
        const viewport = page.getViewport({ scale });
        
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const context = canvas.getContext('2d');
        if (!context) {
          // Browser canvas context limit reached — retry after a delay
          // to allow other canvases to be garbage collected
          console.warn(`Canvas context unavailable for slot ${slot.id} (attempt ${retryCount + 1}/${MAX_RETRIES})`);
          if (retryCount < MAX_RETRIES && !isCancelled) {
            retryCount++;
            retryTimer = setTimeout(() => {
              if (!isCancelled) renderPage();
            }, RETRY_DELAY * retryCount);
          }
          return;
        }
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        setCanvasSize({ width: viewport.width, height: viewport.height });
        onDimensionsUpdate?.(viewport.width, viewport.height);
        
        renderTask = page.render({
          canvasContext: context,
          viewport: viewport
        });
        
        await renderTask.promise;
        
        if (!isCancelled) {
          setIsRendered(true);
        }
      } catch (error) {
        if (isCancelled || error.name === 'RenderingCancelledException') return;
        
        console.error('Error rendering page:', error);
        
        // Retry on failure (e.g. concurrent render conflict on shared pdfDoc)
        if (retryCount < MAX_RETRIES && !isCancelled) {
          retryCount++;
          console.warn(`Retrying render for slot ${slot.id} (attempt ${retryCount}/${MAX_RETRIES})`);
          retryTimer = setTimeout(() => {
            if (!isCancelled) renderPage();
          }, RETRY_DELAY * retryCount);
        }
      }
    };
    
    renderPage();
    
    return () => {
      isCancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (renderTask) {
        try { renderTask.cancel(); } catch (e) { /* already finished */ }
      }
    };
  }, [slot.pdfDoc, slot.page, slot.renderKey]);
  
  // Get hotspots for this file/page
  const hotspots = (project?.hotspots?.[slot.fileId] || []).filter(
    h => h.page === undefined || h.page === slot.page - 1
  );
  
  // Get detected objects for this file/page
  const detectedObjects = (allDetectedObjects || []).filter(
    obj => obj.filename === slot.backendFilename && obj.page === slot.page - 1
  );

  // Get drawn regions for this file/page
  const slotRegions = (allDrawnRegions || []).filter(
    r => r.filename === slot.backendFilename && (r.page === slot.page - 1 || r.page === undefined)
  );

  // Get cursor based on tool
  const getSlotCursor = () => {
    if (isDragging) return 'grabbing';
    if (isPanning) return 'grabbing';
    if (isDrawingCrop || currentTool === 'crop') return 'crosshair';
    if (currentTool === 'pan') return 'grab';
    if (currentTool === 'move' || canDrag) return 'move';
    if (currentTool === 'zoom') return 'crosshair';
    return 'default';
  };

  // Calculate inverse scale for UI elements to maintain constant screen size
  const uiScale = 1 / zoom;
  
  // Calculate border thickness that stays constant on screen
  const borderThickness = 8 * uiScale; // 8px on screen regardless of zoom
  
  // Calculate cropped dimensions for display
  const displayWidth = cropRegion 
    ? canvasSize.width * cropRegion.width 
    : canvasSize.width;
  const displayHeight = cropRegion 
    ? canvasSize.height * cropRegion.height 
    : canvasSize.height;

  // ── Placeholder for missing files (from saved batches) ──
  if (slot.isPlaceholder) {
    return (
      <div
        className={`infinite-slot ${isSelected ? 'selected' : ''} ${!showShadows ? 'no-shadow' : ''}`}
        style={{
          position: 'absolute',
          left: slot.x,
          top: slot.y,
          width: slot.width || 900,
          height: slot.height || 1270,
          border: '2px dashed #555',
          borderRadius: 4,
          background: '#1a1a2e',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#666',
          fontSize: 14,
          userSelect: 'none',
          cursor: 'pointer',
          outline: isSelected ? '2px solid rgba(52, 152, 219, 0.6)' : 'none',
          outlineOffset: 2,
          zIndex: isSelected ? 500 : 1,
        }}
        onMouseDown={(e) => {
          if (e.button === 0) onSlotClick?.(slot.id, e);
        }}
      >
        <svg width={48} height={48} viewBox="0 0 24 24" fill="none" style={{ marginBottom: 12, opacity: 0.5 }}>
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="#555" strokeWidth="1.5"/>
          <path d="M14 2v6h6" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M12 11v6M9 14h6" stroke="#555" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <span style={{ fontWeight: 500, maxWidth: '80%', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {slot.fileName}
        </span>
        <span style={{ fontSize: 11, color: '#555', marginTop: 6 }}>File not found — placeholder</span>
      </div>
    );
  }

  return (
    <div 
      className={`infinite-slot ${isAnchor ? 'anchor' : ''} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${!showShadows ? 'no-shadow' : ''}`}
      style={{
        position: 'absolute',
        left: slot.x,
        top: slot.y,
        cursor: getSlotCursor(),
        zIndex: isHovered ? 1000 : (isSelected ? 500 : 1),
        outline: showShadows ? (isSelected ? `${Math.max(2, borderThickness * 0.7)}px solid rgba(52, 152, 219, 0.6)` : (isDragging ? `${borderThickness}px solid #3498db` : 'none')) : 'none',
        outlineOffset: showShadows ? `${2 * uiScale}px` : 0,
      }}
      onMouseDown={(e) => {
        // When drawing crop, skip selection and go straight to crop handler
        if (isDrawingCrop || currentTool === 'crop') {
          handleMouseDown(e);
          return;
        }
        // Check for Ctrl/Cmd click first
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+click to toggle selection - don't start drag
          e.stopPropagation();
          onSlotClick?.(e);
          return;
        }
        // Normal click - pass event and handle drag
        onSlotClick?.(e);
        handleMouseDown(e);
      }}
      onDoubleClick={handleDoubleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      
      {/* Hover label - shows when zoomed out below 25% */}
      {showLabel && isHovered && (
        <div 
          className="slot-hover-label"
          style={{
            transform: `translateX(-50%) scale(${uiScale})`,
            transformOrigin: 'bottom center'
          }}
        >
          {slot.fileName}{slot.numPages > 1 ? ` — Page ${slot.page}/${slot.numPages}` : ''}
        </div>
      )}
      
      {/* Canvas with optional crop */}
      <div 
        className={`slot-canvas-wrapper${isRendered ? ' rendered' : ''}`}
        style={{
          width: displayWidth || 'auto',
          height: displayHeight || 'auto',
          overflow: cropRegion ? 'hidden' : 'visible',
          minWidth: !isRendered ? (slot.width || 900) : undefined,
          minHeight: !isRendered ? (slot.height || 1270) : undefined,
        }}
        onMouseDownCapture={(e) => {
          // Skip annotation handling during crop drawing
          if (isDrawingCrop || currentTool === 'crop') return;
          // Handle all annotation interactions at wrapper level due to CSS transform issues with SVG events
          if (isSlotUnlocked && annotations?.length > 0 && (!markupMode || markupMode === 'select')) {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = (e.clientX - rect.left) / rect.width * canvasSize.width;
            const clickY = (e.clientY - rect.top) / rect.height * canvasSize.height;
            
            // Check if clicking on a resize handle of selected annotation first
            if (selectedAnnotation) {
              const bounds = getAnnotationBounds(selectedAnnotation);
              if (bounds) {
                const handle = getResizeHandleAtPoint(clickX, clickY, bounds, selectedAnnotation);
                if (handle) {
                  e.stopPropagation();
                  e.preventDefault();
                  setIsResizingAnnotation(true);
                  setActiveResizeHandle(handle);
                  setAnnotationMoveStart({ x: clickX, y: clickY, annotation: { ...selectedAnnotation, slotId: slot.id } });
                  return;
                }
              }
            }
            
            // Check all annotations (in reverse order - top items first)
            for (let i = annotations.length - 1; i >= 0; i--) {
              const ann = annotations[i];
              const bounds = getAnnotationBounds(ann);
              
              if (bounds && clickX >= bounds.x && clickX <= bounds.x + bounds.width && 
                  clickY >= bounds.y && clickY <= bounds.y + bounds.height) {
                
                // If this is a PDF annotation we don't own yet, take ownership first
                if (ann.fromPdf && !ownedAnnotationIds.has(ann.id)) {
                  e.stopPropagation();
                  e.preventDefault();
                  
                  // Take ownership
                  onTakeOwnership?.(slot.id, ann.id);
                  
                  // Select and prepare for drag
                  onAnnotationSelect?.({ ...ann, slotId: slot.id });
                  setAnnotationMoveStart({ x: clickX, y: clickY, annotation: { ...ann, slotId: slot.id }, pending: true });
                  return;
                }
                
                // Double-click detection for text editing
                const now = Date.now();
                const timeDiff = now - lastClickRef.current.time;
                const sameAnnotation = lastClickRef.current.annId === ann.id;
                const isTextEditable = ann.type === 'text' || ann.type === 'rectangle' || ann.type === 'circle' || ann.type === 'cloud';
                
                if (sameAnnotation && timeDiff < 500 && isTextEditable) {
                  // Double-click - enter edit mode
                  e.stopPropagation();
                  e.preventDefault();
                  setIsMovingAnnotation(false);
                  setIsResizingAnnotation(false);
                  setAnnotationMoveStart(null);
                  setEditingTextId(ann.id);
                  setEditingTextValue(ann.text || '');
                  onAnnotationSelect?.(ann);
                  lastClickRef.current = { time: 0, annId: null };
                  return;
                }
                
                // Record this click for double-click detection
                lastClickRef.current = { time: now, annId: ann.id };
                
                // Close text editing if clicking on a different annotation
                if (editingTextId && editingTextId !== ann.id) {
                  const currentText = textInputRef.current?.value ?? '';
                  onAnnotationUpdate?.(slot.id, editingTextId, { text: currentText });
                  setEditingTextId(null);
                  setEditingTextValue('');
                }
                
                e.stopPropagation();
                e.preventDefault();
                
                const isCurrentlySelected = selectedAnnotation?.id === ann.id;
                
                if (!isCurrentlySelected) {
                  // Select the annotation
                  onAnnotationSelect?.(ann);
                }
                
                // Always prepare for potential move (whether newly selected or already selected)
                setAnnotationMoveStart({ x: clickX, y: clickY, annotation: { ...ann, slotId: slot.id }, pending: true });
                return;
              }
            }
          }
        }}
        onClick={(e) => {
          // Text editing save is handled by textarea's onBlur, not here
          // This just ensures editingTextId is cleared if somehow still set
          if (editingTextId) {
            // Don't save here - onBlur already did it
            setEditingTextId(null);
            setEditingTextValue('');
          }
        }}
      >
        {/* Loading placeholder shown while PDF renders */}
        {!isRendered && (
          <div className="slot-loading-placeholder">
            <div className="loading-spinner" />
            <span>Loading…</span>
          </div>
        )}
        <canvas 
          ref={canvasRef}
          style={{
            marginLeft: cropRegion ? -cropRegion.x * canvasSize.width : 0,
            marginTop: cropRegion ? -cropRegion.y * canvasSize.height : 0
          }}
        />
        
        {/* Crop drawing overlay */}
        {isDrawingCrop && tempCropRegion && (
          <div 
            className="crop-drawing-overlay"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: canvasSize.width,
              height: canvasSize.height,
              pointerEvents: 'none',
              zIndex: 400
            }}
          >
            {/* Darkened areas outside selection */}
            <div className="crop-mask" style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${tempCropRegion.y * 100}%`,
              background: 'rgba(0,0,0,0.5)'
            }} />
            <div className="crop-mask" style={{
              position: 'absolute',
              top: `${(tempCropRegion.y + tempCropRegion.height) * 100}%`,
              left: 0,
              width: '100%',
              bottom: 0,
              background: 'rgba(0,0,0,0.5)'
            }} />
            <div className="crop-mask" style={{
              position: 'absolute',
              top: `${tempCropRegion.y * 100}%`,
              left: 0,
              width: `${tempCropRegion.x * 100}%`,
              height: `${tempCropRegion.height * 100}%`,
              background: 'rgba(0,0,0,0.5)'
            }} />
            <div className="crop-mask" style={{
              position: 'absolute',
              top: `${tempCropRegion.y * 100}%`,
              left: `${(tempCropRegion.x + tempCropRegion.width) * 100}%`,
              right: 0,
              height: `${tempCropRegion.height * 100}%`,
              background: 'rgba(0,0,0,0.5)'
            }} />
            {/* Selection border */}
            <div 
              className="crop-selection"
              style={{
                position: 'absolute',
                left: `${tempCropRegion.x * 100}%`,
                top: `${tempCropRegion.y * 100}%`,
                width: `${tempCropRegion.width * 100}%`,
                height: `${tempCropRegion.height * 100}%`,
                border: '2px dashed #3498db',
                boxSizing: 'border-box'
              }}
            />
          </div>
        )}
        
        {/* Hotspots and Objects overlay */}
        {isRendered && (
          <div 
            className="slot-overlay"
            style={{ 
              width: canvasSize.width, 
              height: canvasSize.height,
              pointerEvents: 'none',
              zIndex: 301,
              marginLeft: cropRegion ? -cropRegion.x * canvasSize.width : 0,
              marginTop: cropRegion ? -cropRegion.y * canvasSize.height : 0
            }}
          >
            {/* Detected Objects */}
            {detectedObjects?.filter(obj => {
              const className = obj.label || obj.className;
              return !hiddenClasses?.has(className);
            }).map((obj, idx) => {
              // Try multiple names: label, className, parentClass
              const classNames = [obj.label, obj.className, obj.parentClass];
              const { fillColor, borderColor: classBorderColor } = getClassColors(classNames);
              // Use object's shapeType, or fall back to class definition
              const shapeType = obj.shapeType || getClassShapeType(classNames);
              const isCircle = shapeType === 'circle';
              const isPolyline = shapeType === 'polyline';
              
              // Check if fill or border are 'none'
              const isNoFill = fillColor === 'none';
              const isNoBorder = classBorderColor === 'none';
              const isFullyHidden = isNoFill && isNoBorder;
              const isHighlighted = highlightedObjectId === obj.id;
              
              // Convert hex to rgba for background
              const hexToRgba = (hex, alpha) => {
                if (!hex || !hex.startsWith('#')) return `rgba(52, 152, 219, ${alpha})`;
                const r = parseInt(hex.slice(1, 3), 16);
                const g = parseInt(hex.slice(3, 5), 16);
                const b = parseInt(hex.slice(5, 7), 16);
                return `rgba(${r}, ${g}, ${b}, ${alpha})`;
              };
              
              const bgColor = isNoFill ? 'transparent' : hexToRgba(fillColor, 0.15);
              const borderColor = isNoBorder ? 'transparent' : classBorderColor;
              // For label background, prefer border color if fill is none
              const labelColor = isNoBorder ? (isNoFill ? '#666' : fillColor) : classBorderColor;
              
              const isObjHovered = hoveredObjectId === (obj.id || `obj_${idx}`);
              const objKey = obj.id || `obj_${idx}`;
              const displayLabel = obj.ocr_text || obj.subclassValues?.Tag || obj.label || obj.className || '';
              
              // For polylines, render as SVG
              if (isPolyline && obj.polylinePoints) {
                const isActive = isHighlighted || isObjHovered;
                return (
                  <React.Fragment key={objKey}>
                    <svg
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: canvasSize.width,
                        height: canvasSize.height,
                        pointerEvents: 'none',
                        zIndex: isObjHovered ? 100 : 5,
                      }}
                    >
                      <polygon
                        points={obj.polylinePoints.map(p => 
                          `${p.x * canvasSize.width},${p.y * canvasSize.height}`
                        ).join(' ')}
                        fill={isActive ? (isHighlighted ? 'rgba(52, 152, 219, 0.3)' : 'rgba(230, 126, 34, 0.25)') : (isNoFill ? 'transparent' : fillColor)}
                        fillOpacity={isActive ? 1 : (isNoFill ? 0 : 0.15)}
                        stroke={isActive ? (isHighlighted ? '#3498db' : '#d35400') : (isNoBorder ? 'transparent' : borderColor)}
                        strokeWidth={isActive ? 3 : (isNoBorder ? 0 : 2)}
                        style={{ pointerEvents: 'all', cursor: 'pointer' }}
                        onMouseEnter={() => setHoveredObjectId(objKey)}
                        onMouseLeave={() => setHoveredObjectId(null)}
                        onClick={(e) => {
                          e.stopPropagation();
                          onObjectClick?.(obj);
                        }}
                      />
                    </svg>
                    {isObjHovered && obj.bbox && (
                      <div className="object-hover-tooltip" style={{
                        left: (obj.bbox.x + obj.bbox.width / 2) * canvasSize.width,
                        top: obj.bbox.y * canvasSize.height,
                      }}>
                        <div className="hover-tooltip-label">{displayLabel}</div>
                        {obj.confidence != null && <div className="hover-tooltip-conf">{(obj.confidence * 100).toFixed(0)}%</div>}
                        <div className="hover-tooltip-hint">Click to view details</div>
                      </div>
                    )}
                  </React.Fragment>
                );
              }
              
              // For polylines WITHOUT polylinePoints, render as dashed rectangle
              if (isPolyline) {
                return (
                  <div
                    key={objKey}
                    className={`infinite-object ${isHighlighted ? 'highlighted' : ''} ${isObjHovered ? 'obj-hovered' : ''}`}
                    style={{
                      left: obj.bbox.x * canvasSize.width,
                      top: obj.bbox.y * canvasSize.height,
                      width: obj.bbox.width * canvasSize.width,
                      height: obj.bbox.height * canvasSize.height,
                      pointerEvents: 'auto',
                      cursor: 'pointer',
                      borderColor: isObjHovered ? '#d35400' : borderColor,
                      backgroundColor: isObjHovered ? 'rgba(230, 126, 34, 0.25)' : bgColor,
                      borderStyle: 'dashed',
                      borderWidth: isObjHovered ? '3px' : (isNoBorder ? '0' : '2px'),
                    }}
                    onMouseEnter={() => setHoveredObjectId(objKey)}
                    onMouseLeave={() => setHoveredObjectId(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onObjectClick?.(obj);
                    }}
                  >
                    {showObjectTags && (!isFullyHidden || isHighlighted || isObjHovered) && displayLabel && (
                      <span className="object-label" style={{ backgroundColor: isObjHovered ? '#d35400' : (isHighlighted ? '#3498db' : labelColor) }}>
                        {displayLabel}
                      </span>
                    )}
                    {isObjHovered && (
                      <div className="object-hover-tooltip">
                        <div className="hover-tooltip-label">{displayLabel}</div>
                        {obj.confidence != null && <div className="hover-tooltip-conf">{(obj.confidence * 100).toFixed(0)}%</div>}
                        <div className="hover-tooltip-hint">Click to view details</div>
                      </div>
                    )}
                  </div>
                );
              }
              
              // Rectangle or Circle
              return (
                <div
                  key={objKey}
                  className={`infinite-object ${isHighlighted ? 'highlighted' : ''} ${isObjHovered ? 'obj-hovered' : ''} ${isCircle ? 'circle-shape' : ''}`}
                  style={{
                    left: obj.bbox.x * canvasSize.width,
                    top: obj.bbox.y * canvasSize.height,
                    width: obj.bbox.width * canvasSize.width,
                    height: obj.bbox.height * canvasSize.height,
                    pointerEvents: 'auto',
                    cursor: 'pointer',
                    borderColor: isObjHovered ? '#d35400' : borderColor,
                    backgroundColor: isObjHovered ? 'rgba(230, 126, 34, 0.25)' : bgColor,
                    borderRadius: isCircle ? '50%' : '0',
                    borderWidth: isObjHovered ? '3px' : (isNoBorder ? '0' : '2px'),
                    zIndex: isObjHovered ? 100 : 'auto',
                    transition: 'border-color 0.15s, border-width 0.15s, background-color 0.15s',
                  }}
                  onMouseEnter={() => setHoveredObjectId(objKey)}
                  onMouseLeave={() => setHoveredObjectId(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onObjectClick?.(obj);
                  }}
                >
                  {showObjectTags && (!isFullyHidden || isHighlighted || isObjHovered) && displayLabel && (
                    <span className="object-label" style={{ backgroundColor: isObjHovered ? '#d35400' : (isHighlighted ? '#3498db' : labelColor) }}>
                      {displayLabel}
                    </span>
                  )}
                  {isObjHovered && (
                    <div className="object-hover-tooltip">
                      <div className="hover-tooltip-label">{displayLabel}</div>
                      {obj.confidence != null && <div className="hover-tooltip-conf">{(obj.confidence * 100).toFixed(0)}%</div>}
                      <div className="hover-tooltip-hint">Click to view details</div>
                    </div>
                  )}
                </div>
              );
            })}
            
            {/* Drawn Regions */}
            {slotRegions.map((region, idx) => {
              const fillColor = region.fillColor || '#3498db';
              const borderColor = region.borderColor || fillColor;
              const isHidden = hiddenClasses?.has(region.regionType);
              if (isHidden) return null;
              
              // Regions use normalized coords like objects
              const x = region.x != null ? region.x : (region.bbox?.x || 0);
              const y = region.y != null ? region.y : (region.bbox?.y || 0);
              const w = region.width != null ? region.width : (region.bbox?.width || 0);
              const h = region.height != null ? region.height : (region.bbox?.height || 0);
              
              if (!w || !h) return null;
              
              const hexToRgba = (hex, alpha) => {
                if (!hex || !hex.startsWith('#')) return `rgba(52, 152, 219, ${alpha})`;
                const r = parseInt(hex.slice(1, 3), 16);
                const g = parseInt(hex.slice(3, 5), 16);
                const b = parseInt(hex.slice(5, 7), 16);
                return `rgba(${r}, ${g}, ${b}, ${alpha})`;
              };
              
              const regionKey = region.id || `region_${idx}`;
              const isRegionHovered = hoveredObjectId === regionKey;
              const isRegionHighlighted = highlightedObjectId === region.id;
              
              return (
                <div
                  key={regionKey}
                  className={`infinite-object infinite-region ${isRegionHighlighted ? 'highlighted' : ''} ${isRegionHovered ? 'obj-hovered' : ''}`}
                  style={{
                    left: x * canvasSize.width,
                    top: y * canvasSize.height,
                    width: w * canvasSize.width,
                    height: h * canvasSize.height,
                    pointerEvents: 'auto',
                    cursor: 'pointer',
                    borderColor: isRegionHovered ? '#d35400' : borderColor,
                    backgroundColor: isRegionHovered ? 'rgba(230, 126, 34, 0.25)' : hexToRgba(fillColor, 0.12),
                    borderWidth: isRegionHovered ? '3px' : '2px',
                    borderStyle: 'dashed',
                  }}
                  onMouseEnter={() => setHoveredObjectId(regionKey)}
                  onMouseLeave={() => setHoveredObjectId(null)}
                >
                  {(showObjectTags || isRegionHovered) && (
                    <span className="object-label region-label" style={{ backgroundColor: isRegionHovered ? '#d35400' : borderColor }}>
                      {region.subRegionName || region.regionType || 'Region'}
                    </span>
                  )}
                </div>
              );
            })}

            {/* Hotspots - invisible click targets (visual comes from detected objects layer) */}
            {hotspots.map((hotspot, idx) => (
              <div
                key={hotspot.id || idx}
                className="infinite-hotspot"
                style={{
                  left: hotspot.x * canvasSize.width,
                  top: hotspot.y * canvasSize.height,
                  width: hotspot.width * canvasSize.width,
                  height: hotspot.height * canvasSize.height,
                  pointerEvents: 'auto',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onHotspotClick?.(hotspot);
                }}
              >
                {hotspot.label && (
                  <span className="hotspot-label">{hotspot.label}</span>
                )}
              </div>
            ))}
          </div>
        )}
        
        {/* Annotation SVG Overlay */}
        {isRendered && (
          <svg
            ref={svgRef}
            className="annotation-overlay"
            viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
            data-slot-unlocked={isSlotUnlocked}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: canvasSize.width,
              height: canvasSize.height,
              pointerEvents: (isDrawingCrop || currentTool === 'crop' || currentTool === 'pan') ? 'none' : (!isSlotUnlocked ? 'none' : 'auto'),
              zIndex: 300,
              marginLeft: cropRegion ? -cropRegion.x * canvasSize.width : 0,
              marginTop: cropRegion ? -cropRegion.y * canvasSize.height : 0,
              cursor: pendingPlacement && isSlotUnlocked
                ? 'copy'
                : markupMode && markupMode !== 'select' && markupMode !== 'eraser' 
                ? markupCursor || 'crosshair' 
                : markupMode === 'eraser' 
                  ? 'not-allowed'
                  : currentTool === 'pan' ? 'grab' : (selectedAnnotation ? 'default' : 'inherit')
            }}
            onMouseDown={isSlotUnlocked ? handleMarkupMouseDown : undefined}
            onMouseMove={isSlotUnlocked ? handleMarkupMouseMove : undefined}
            onMouseUp={isSlotUnlocked ? handleMarkupMouseUp : undefined}
            onMouseLeave={isSlotUnlocked ? handleMarkupMouseUp : undefined}
            onDoubleClick={isSlotUnlocked ? handleMarkupDoubleClick : undefined}
            onClick={(e) => {
              handleSvgClick(e);
              if (isSlotUnlocked) {
                e.stopPropagation();
              }
            }}
          >
            {/* Render user-created annotations AND owned PDF annotations */}
            {annotations?.filter(ann => {
              // Always show user-created annotations
              if (!ann.fromPdf) return true;
              // Only show PDF annotations we've taken ownership of
              if (ownedAnnotationIds.has(ann.id)) return true;
              return false;
            }).map(ann => renderAnnotation(ann))}
            
            {/* Hit-test overlay for unowned PDF annotations when slot is unlocked */}
            {/* These invisible rectangles let us click on PDF-rendered annotations to take ownership */}
            {isSlotUnlocked && annotations?.filter(ann => 
              ann.fromPdf && !ownedAnnotationIds.has(ann.id)
            ).map(ann => {
              const bounds = getAnnotationBounds(ann);
              if (!bounds) return null;
              
              const padding = 5;
              return (
                <rect
                  key={`hit-${ann.id}`}
                  x={bounds.x - padding}
                  y={bounds.y - padding}
                  width={bounds.width + padding * 2}
                  height={bounds.height + padding * 2}
                  fill="transparent"
                  stroke="none"
                  style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    
                    // Take ownership of this annotation (deletes from PDF, reloads)
                    onTakeOwnership?.(slot.id, ann.id);
                    
                    // Select this annotation
                    onAnnotationSelect?.({ ...ann, slotId: slot.id });
                    
                    // Set up for potential drag
                    const wrapperRect = e.currentTarget.closest('.slot-canvas-wrapper')?.getBoundingClientRect();
                    if (wrapperRect) {
                      const clickX = (e.clientX - wrapperRect.left) / wrapperRect.width * canvasSize.width;
                      const clickY = (e.clientY - wrapperRect.top) / wrapperRect.height * canvasSize.height;
                      setAnnotationMoveStart({ x: clickX, y: clickY, annotation: { ...ann, slotId: slot.id }, pending: true });
                    }
                  }}
                />
              );
            })}
            
            {/* Render current drawing preview */}
            {currentDrawing && currentDrawing.slotId === slot.id && renderAnnotation(currentDrawing, true)}
            
            {/* Render polyline preview */}
            {polylinePoints.length > 0 && (markupMode === 'polyline' || markupMode === 'polylineArrow' || markupMode === 'cloudPolyline') && (
              <g className="polyline-preview" opacity="0.7">
                {/* Draw lines between points */}
                {polylinePoints.length >= 2 && (
                  <polyline
                    points={polylinePoints.map(p => `${p.x},${p.y}`).join(' ')}
                    stroke={markupColor}
                    strokeWidth={markupStrokeWidth}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                
                {/* Draw preview line to cursor */}
                {polylineMousePos && polylinePoints.length > 0 && (
                  <line
                    x1={polylinePoints[polylinePoints.length - 1].x}
                    y1={polylinePoints[polylinePoints.length - 1].y}
                    x2={polylineMousePos.x}
                    y2={polylineMousePos.y}
                    stroke={markupColor}
                    strokeWidth={markupStrokeWidth}
                    strokeDasharray="4,4"
                  />
                )}
                
                {/* Draw dots at each point */}
                {polylinePoints.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={4}
                    fill={i === 0 && polylinePoints.length >= 3 ? '#2ecc71' : markupColor}
                    stroke="white"
                    strokeWidth="1"
                  />
                ))}
                
                {/* Close indicator when near start */}
                {polylineMousePos && polylinePoints.length >= 3 && (() => {
                  const startPt = polylinePoints[0];
                  const dist = Math.sqrt(Math.pow(polylineMousePos.x - startPt.x, 2) + Math.pow(polylineMousePos.y - startPt.y, 2));
                  if (dist < 15) {
                    return (
                      <circle
                        cx={startPt.x}
                        cy={startPt.y}
                        r={10}
                        fill="none"
                        stroke="#2ecc71"
                        strokeWidth="2"
                        strokeDasharray="3,3"
                      />
                    );
                  }
                  return null;
                })()}
              </g>
            )}
            
            {/* Selection handles for selected annotation - hide during move/resize */}
            {selectedAnnotation && selectedAnnotation.slotId === slot.id && !isMovingAnnotation && !isResizingAnnotation && (() => {
              const bounds = getAnnotationBounds(selectedAnnotation);
              if (!bounds) return null;
              
              // Scale handles inversely with zoom so they stay visible
              const baseHandleSize = 8;
              const minScale = 1;
              const maxScale = 3;
              const handleScale = Math.min(maxScale, Math.max(minScale, 1 / zoom));
              const handleSize = baseHandleSize * handleScale;
              
              // Larger hit area for polyline points (easier to grab)
              const polylineHitSize = 25 * handleScale;
              
              const isLineType = selectedAnnotation.type === 'line' || selectedAnnotation.type === 'arrow' || selectedAnnotation.type === 'arc';
              const isPolylineType = selectedAnnotation.type === 'polyline' || selectedAnnotation.type === 'polylineArrow' || 
                                     selectedAnnotation.type === 'cloudPolyline' || selectedAnnotation.type === 'pen' || selectedAnnotation.type === 'highlighter';
              
              // For polyline types, show point handles at each vertex
              if (isPolylineType && selectedAnnotation.points && selectedAnnotation.points.length > 0) {
                const validPoints = selectedAnnotation.points.filter(p => p && p.x !== undefined && p.y !== undefined);
                if (validPoints.length === 0) return null;
                
                return (
                  <g className="selection-handles polyline-handles">
                    {/* Draw connecting lines between points */}
                    {validPoints.map((point, i) => {
                      if (i === 0) return null;
                      const prevPoint = validPoints[i - 1];
                      return (
                        <line
                          key={`line-${i}`}
                          x1={prevPoint.x}
                          y1={prevPoint.y}
                          x2={point.x}
                          y2={point.y}
                          stroke="#333"
                          strokeWidth={1 * handleScale}
                          strokeDasharray="4,4"
                          style={{ pointerEvents: 'none', filter: 'none' }}
                        />
                      );
                    })}
                    {/* Close polyline if closed */}
                    {selectedAnnotation.closed && validPoints.length > 2 && (
                      <line
                        x1={validPoints[validPoints.length - 1].x}
                        y1={validPoints[validPoints.length - 1].y}
                        x2={validPoints[0].x}
                        y2={validPoints[0].y}
                        stroke="#333"
                        strokeWidth={1 * handleScale}
                        strokeDasharray="4,4"
                        style={{ pointerEvents: 'none', filter: 'none' }}
                      />
                    )}
                    {/* Point handles at each vertex - iterate with original indices */}
                    {/* When closed, render first point last so its hit area is on top near the close point */}
                    {(() => {
                      const points = selectedAnnotation.points;
                      // Reorder: if closed, put first point at end so it renders on top
                      const renderOrder = selectedAnnotation.closed && points.length > 2
                        ? [...points.slice(1).map((p, i) => ({ point: p, originalIndex: i + 1 })), { point: points[0], originalIndex: 0 }]
                        : points.map((p, i) => ({ point: p, originalIndex: i }));
                      
                      return renderOrder.map(({ point, originalIndex }) => {
                        // Skip invalid points
                        if (!point || point.x === undefined || point.y === undefined) return null;
                        
                        const isHovered = hoveredVertexIndex === originalIndex;
                        const isDragging = draggingPolylinePoint === originalIndex;
                        const isFirstPoint = originalIndex === 0;
                        const isLastPoint = originalIndex === points.length - 1;
                        
                        return (
                          <g key={`point-${originalIndex}`}>
                            {/* Invisible larger hit area for easier clicking */}
                            <circle
                              cx={point.x}
                              cy={point.y}
                              r={polylineHitSize}
                              fill="transparent"
                              style={{ cursor: 'move', pointerEvents: 'auto' }}
                              onMouseEnter={() => setHoveredVertexIndex(originalIndex)}
                              onMouseLeave={() => setHoveredVertexIndex(null)}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                const svg = e.target.ownerSVGElement;
                                if (svg) {
                                  const pt = svg.createSVGPoint();
                                  pt.x = e.clientX;
                                  pt.y = e.clientY;
                                  const ctm = svg.getScreenCTM();
                                  if (ctm) {
                                    const svgPoint = pt.matrixTransform(ctm.inverse());
                                    setDraggingPolylinePoint(originalIndex);
                                    setAnnotationMoveStart({ x: svgPoint.x, y: svgPoint.y, annotation: { ...selectedAnnotation } });
                                  }
                                }
                              }}
                            />
                            {/* Hover ring - shows when hovering */}
                            {isHovered && !isDragging && (
                              <circle
                                cx={point.x}
                                cy={point.y}
                                r={handleSize * 1.2}
                                fill="transparent"
                                stroke={isFirstPoint && selectedAnnotation.closed ? '#2ecc71' : '#3498db'}
                                strokeWidth={2 * handleScale}
                                strokeOpacity={0.5}
                                style={{ pointerEvents: 'none', filter: 'none' }}
                              />
                            )}
                            {/* Visible handle - first point is green when closed */}
                            <circle
                              cx={point.x}
                              cy={point.y}
                              r={isHovered || isDragging ? handleSize * 0.9 : handleSize * 0.7}
                              fill={isDragging ? '#3498db' : isHovered ? '#555' : (isFirstPoint && selectedAnnotation.closed ? '#27ae60' : '#333')}
                              stroke="#fff"
                              strokeWidth={1.5 * handleScale}
                              style={{ cursor: 'move', pointerEvents: 'none', filter: 'none' }}
                              className="polyline-point-handle"
                              data-point-index={originalIndex}
                            />
                          </g>
                        );
                      });
                    })()}
                  </g>
                );
              }
              
              // For line/arrow/arc, show circle handles at endpoints
              if (isLineType) {
                return (
                  <g className="selection-handles">
                    {/* Dashed line connecting endpoints */}
                    <line
                      x1={selectedAnnotation.x1}
                      y1={selectedAnnotation.y1}
                      x2={selectedAnnotation.x2}
                      y2={selectedAnnotation.y2}
                      stroke="#333"
                      strokeWidth={1 * handleScale}
                      strokeDasharray="4,4"
                      style={{ pointerEvents: 'none', filter: 'none' }}
                    />
                    {/* Start point handle - invisible hit area */}
                    <circle
                      cx={selectedAnnotation.x1}
                      cy={selectedAnnotation.y1}
                      r={polylineHitSize}
                      fill="transparent"
                      style={{ cursor: 'move', pointerEvents: 'auto' }}
                      data-handle="start"
                      onMouseEnter={() => setHoveredLineHandle('start')}
                      onMouseLeave={() => setHoveredLineHandle(null)}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const svg = e.target.ownerSVGElement;
                        if (svg) {
                          const point = svg.createSVGPoint();
                          point.x = e.clientX;
                          point.y = e.clientY;
                          const ctm = svg.getScreenCTM();
                          if (ctm) {
                            const svgPoint = point.matrixTransform(ctm.inverse());
                            setIsResizingAnnotation(true);
                            setActiveResizeHandle('start');
                            setAnnotationMoveStart({ x: svgPoint.x, y: svgPoint.y, annotation: { ...selectedAnnotation } });
                          }
                        }
                      }}
                    />
                    {/* Start point hover ring */}
                    {hoveredLineHandle === 'start' && activeResizeHandle !== 'start' && (
                      <circle
                        cx={selectedAnnotation.x1}
                        cy={selectedAnnotation.y1}
                        r={handleSize * 1.2}
                        fill="transparent"
                        stroke="#3498db"
                        strokeWidth={2 * handleScale}
                        strokeOpacity={0.5}
                        style={{ pointerEvents: 'none', filter: 'none' }}
                      />
                    )}
                    {/* Start point handle - visible */}
                    <circle
                      cx={selectedAnnotation.x1}
                      cy={selectedAnnotation.y1}
                      r={hoveredLineHandle === 'start' || activeResizeHandle === 'start' ? handleSize * 0.9 : handleSize * 0.7}
                      fill={activeResizeHandle === 'start' ? '#3498db' : hoveredLineHandle === 'start' ? '#555' : '#333'}
                      stroke="#fff"
                      strokeWidth={1.5 * handleScale}
                      style={{ pointerEvents: 'none', filter: 'none' }}
                    />
                    {/* End point handle - invisible hit area */}
                    <circle
                      cx={selectedAnnotation.x2}
                      cy={selectedAnnotation.y2}
                      r={polylineHitSize}
                      fill="transparent"
                      style={{ cursor: 'move', pointerEvents: 'auto' }}
                      data-handle="end"
                      onMouseEnter={() => setHoveredLineHandle('end')}
                      onMouseLeave={() => setHoveredLineHandle(null)}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const svg = e.target.ownerSVGElement;
                        if (svg) {
                          const point = svg.createSVGPoint();
                          point.x = e.clientX;
                          point.y = e.clientY;
                          const ctm = svg.getScreenCTM();
                          if (ctm) {
                            const svgPoint = point.matrixTransform(ctm.inverse());
                            setIsResizingAnnotation(true);
                            setActiveResizeHandle('end');
                            setAnnotationMoveStart({ x: svgPoint.x, y: svgPoint.y, annotation: { ...selectedAnnotation } });
                          }
                        }
                      }}
                    />
                    {/* End point hover ring */}
                    {hoveredLineHandle === 'end' && activeResizeHandle !== 'end' && (
                      <circle
                        cx={selectedAnnotation.x2}
                        cy={selectedAnnotation.y2}
                        r={handleSize * 1.2}
                        fill="transparent"
                        stroke="#3498db"
                        strokeWidth={2 * handleScale}
                        strokeOpacity={0.5}
                        style={{ pointerEvents: 'none', filter: 'none' }}
                      />
                    )}
                    {/* End point handle - visible */}
                    <circle
                      cx={selectedAnnotation.x2}
                      cy={selectedAnnotation.y2}
                      r={hoveredLineHandle === 'end' || activeResizeHandle === 'end' ? handleSize * 0.9 : handleSize * 0.7}
                      fill={activeResizeHandle === 'end' ? '#3498db' : hoveredLineHandle === 'end' ? '#555' : '#333'}
                      stroke="#fff"
                      strokeWidth={1.5 * handleScale}
                      style={{ pointerEvents: 'none', filter: 'none' }}
                    />
                  </g>
                );
              }
              
              // For other shapes, show rectangle handles
              const handles = [
                { name: 'nw', x: bounds.x, y: bounds.y, cursor: 'nwse-resize' },
                { name: 'ne', x: bounds.x + bounds.width, y: bounds.y, cursor: 'nesw-resize' },
                { name: 'sw', x: bounds.x, y: bounds.y + bounds.height, cursor: 'nesw-resize' },
                { name: 'se', x: bounds.x + bounds.width, y: bounds.y + bounds.height, cursor: 'nwse-resize' },
                { name: 'n', x: bounds.x + bounds.width / 2, y: bounds.y, cursor: 'ns-resize' },
                { name: 's', x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height, cursor: 'ns-resize' },
                { name: 'w', x: bounds.x, y: bounds.y + bounds.height / 2, cursor: 'ew-resize' },
                { name: 'e', x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2, cursor: 'ew-resize' }
              ];
              
              return (
                <g className="selection-handles">
                  {/* Selection border */}
                  <rect
                    x={bounds.x - 2 * handleScale}
                    y={bounds.y - 2 * handleScale}
                    width={bounds.width + 4 * handleScale}
                    height={bounds.height + 4 * handleScale}
                    fill="none"
                    stroke="#333"
                    strokeWidth={1 * handleScale}
                    strokeDasharray="4,4"
                    style={{ pointerEvents: 'none', filter: 'none' }}
                  />
                  
                  {/* Resize handles - with larger invisible hit areas */}
                  {handles.map(h => {
                    const isHovered = hoveredRectHandle === h.name;
                    const isActive = activeResizeHandle === h.name;
                    return (
                    <g key={h.name}>
                      {/* Invisible larger hit area */}
                      <rect
                        x={h.x - polylineHitSize / 2}
                        y={h.y - polylineHitSize / 2}
                        width={polylineHitSize}
                        height={polylineHitSize}
                        fill="transparent"
                        style={{ cursor: h.cursor, pointerEvents: 'auto' }}
                        onMouseEnter={() => setHoveredRectHandle(h.name)}
                        onMouseLeave={() => setHoveredRectHandle(null)}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const svg = e.target.ownerSVGElement;
                          if (svg) {
                            const point = svg.createSVGPoint();
                            point.x = e.clientX;
                            point.y = e.clientY;
                            const ctm = svg.getScreenCTM();
                            if (ctm) {
                              const svgPoint = point.matrixTransform(ctm.inverse());
                              setIsResizingAnnotation(true);
                              setActiveResizeHandle(h.name);
                              setAnnotationMoveStart({ x: svgPoint.x, y: svgPoint.y, annotation: { ...selectedAnnotation } });
                            }
                          }
                        }}
                      />
                      {/* Hover ring */}
                      {isHovered && !isActive && (
                        <rect
                          x={h.x - handleSize * 0.8}
                          y={h.y - handleSize * 0.8}
                          width={handleSize * 1.6}
                          height={handleSize * 1.6}
                          fill="transparent"
                          stroke="#3498db"
                          strokeWidth={2 * handleScale}
                          strokeOpacity={0.5}
                          style={{ pointerEvents: 'none', filter: 'none' }}
                        />
                      )}
                      {/* Visible handle */}
                      <rect
                        x={h.x - (isHovered || isActive ? handleSize * 0.6 : handleSize / 2)}
                        y={h.y - (isHovered || isActive ? handleSize * 0.6 : handleSize / 2)}
                        width={isHovered || isActive ? handleSize * 1.2 : handleSize}
                        height={isHovered || isActive ? handleSize * 1.2 : handleSize}
                        fill={isActive ? '#3498db' : isHovered ? '#555' : '#333'}
                        stroke="#fff"
                        strokeWidth={1 * handleScale}
                        style={{ pointerEvents: 'none', filter: 'none' }}
                      />
                    </g>
                  );
                  })}
                </g>
              );
            })()}
            
            {/* Text editing overlay - rendered separately on top of everything */}
            {editingTextId && (() => {
              const ann = annotations?.find(a => a.id === editingTextId);
              if (!ann) return null;
              
              const isTextEditable = ann.type === 'text' || ann.type === 'rectangle' || ann.type === 'circle' || ann.type === 'cloud';
              if (!isTextEditable) return null;
              
              const x = Math.min(ann.x1, ann.x2);
              const y = Math.min(ann.y1, ann.y2);
              const w = Math.abs(ann.x2 - ann.x1);
              const h = Math.abs(ann.y2 - ann.y1);
              
              const fontSize = ann.fontSize || 14;
              const fontFamily = ann.fontFamily || 'Arial';
              const textColor = ann.textColor || ann.color || '#000';
              const textAlign = ann.textAlign || (ann.type === 'text' ? 'left' : 'center');
              
              return (
                <foreignObject
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  style={{ overflow: 'visible', pointerEvents: 'auto' }}
                >
                  <textarea
                    xmlns="http://www.w3.org/1999/xhtml"
                    ref={textInputRef}
                    defaultValue={ann.text || ''}
                    onBlur={(e) => {
                      onAnnotationUpdate?.(slot.id, ann.id, { text: e.target.value });
                      setEditingTextId(null);
                    }}
                    onFocus={(e) => {
                      const len = e.target.value.length;
                      e.target.setSelectionRange(len, len);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Escape') {
                        // Escape cancels - just close without saving
                        setEditingTextId(null);
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    autoFocus
                    style={{
                      width: '100%',
                      height: '100%',
                      border: '2px solid #3498db',
                      borderRadius: ann.type === 'circle' ? '50%' : '0',
                      padding: '4px',
                      fontSize: `${fontSize}px`,
                      fontFamily: fontFamily + ', sans-serif',
                      color: textColor,
                      background: 'transparent',
                      outline: 'none',
                      resize: 'none',
                      boxSizing: 'border-box',
                      textAlign: textAlign,
                    }}
                    placeholder="Type text... (click outside to save, Esc to cancel)"
                  />
                </foreignObject>
              );
            })()}
          </svg>
        )}
      </div>
    </div>
  );
}
