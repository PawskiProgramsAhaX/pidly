import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getProject, saveProject } from '../utils/storage';
import { BACKEND_URL } from '../utils/config';
import './ProjectSymbolsPage.css';

// Markup types available for symbol creation
const MARKUP_TYPES = [
  { id: 'rectangle', name: 'Rectangle', icon: '▢' },
  { id: 'ellipse', name: 'Ellipse', icon: '○' },
  { id: 'arrow', name: 'Arrow', icon: '→' },
  { id: 'line', name: 'Line', icon: '/' },
  { id: 'polyline', name: 'Polyline', icon: '⌇' },
  { id: 'polygon', name: 'Polygon', icon: '⬡' },
  { id: 'text', name: 'Text Box', icon: 'T' },
  { id: 'cloud', name: 'Cloud', icon: '☁' },
  { id: 'callout', name: 'Callout', icon: '💬' },
];

export default function ProjectSymbolsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnToFile = location.state?.returnToFile || null;
  const [project, setProject] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [symbols, setSymbols] = useState([]);
  const [selectedItem, setSelectedItem] = useState('home');
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('symbols_sidebar_width');
    return saved ? parseInt(saved, 10) : 280;
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  // PDF state
  const [projectFiles, setProjectFiles] = useState([]);
  const [selectedPdf, setSelectedPdf] = useState(null);
  const [pdfSearchQuery, setPdfSearchQuery] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [isRendering, setIsRendering] = useState(false);
  const [pdfPageSize, setPdfPageSize] = useState({ width: 0, height: 0 }); // Raw PDF page dimensions (in PDF points)
  
  // Pan state
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Symbol Creation Mode state
  const [creationMode, setCreationMode] = useState('extract'); // 'extract' or 'draw'
  const [activeMarkupType, setActiveMarkupType] = useState(null);
  const [symbolMarkups, setSymbolMarkups] = useState([]); // Markups being created for new symbol
  const [selectedSymbolMarkup, setSelectedSymbolMarkup] = useState(null);
  
  // Drawing state for markup creation
  const [isDrawingMarkup, setIsDrawingMarkup] = useState(false);
  const [drawStart, setDrawStart] = useState(null);
  const [currentMarkup, setCurrentMarkup] = useState(null);
  const [polylinePoints, setPolylinePoints] = useState([]);
  
  // Markup properties
  const [markupColor, setMarkupColor] = useState('#ff0000');
  const [markupFillColor, setMarkupFillColor] = useState('none');
  const [markupStrokeWidth, setMarkupStrokeWidth] = useState(2);
  const [markupFillOpacity, setMarkupFillOpacity] = useState(0.3);
  const [markupFontSize, setMarkupFontSize] = useState(12);
  const [markupText, setMarkupText] = useState('');
  
  // Selection/extraction state (for extract mode)
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentRect, setCurrentRect] = useState(null);
  const [selectedRegion, setSelectedRegion] = useState(null);

  // Extraction state
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedSymbol, setExtractedSymbol] = useState(null);
  const [extractionSettings, setExtractionSettings] = useState({
    threshold: 128,
    simplifyTolerance: 2,
    minPathLength: 5
  });

  // Symbol naming
  const [symbolName, setSymbolName] = useState('');
  const [symbolCategory, setSymbolCategory] = useState('');

  // Testing/Placement state
  const [testingSymbol, setTestingSymbol] = useState(null);
  const [placedSymbols, setPlacedSymbols] = useState([]);
  const [editableMarkups, setEditableMarkups] = useState([]); // Converted markups that can be edited
  const [selectedEditableMarkup, setSelectedEditableMarkup] = useState(null); // Currently selected markup for editing
  const [isDraggingMarkup, setIsDraggingMarkup] = useState(false);
  const [isResizingMarkup, setIsResizingMarkup] = useState(false);
  const [resizeHandle, setResizeHandle] = useState(null);
  const [markupDragStart, setMarkupDragStart] = useState(null);
  const [placementSettings, setPlacementSettings] = useState({
    scale: 1,
    rotation: 0,
    color: '#ff0000',
    strokeWidth: 2,
    preserveColors: true,
    autoConvert: true // Auto-convert to editable markups on placement
  });
  const [isPlacingMode, setIsPlacingMode] = useState(false);

  // Refs
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const testContainerRef = useRef(null);
  const drawingCanvasRef = useRef(null);

  // Helper function to recursively extract all files from folders
  const extractAllFiles = (folders, parentPath = '') => {
    let allFiles = [];
    (folders || []).forEach(folder => {
      const folderPath = parentPath ? `${parentPath} / ${folder.name}` : folder.name;
      (folder.files || []).forEach(file => {
        allFiles.push({
          id: file.id,
          name: file.name,
          backendFilename: file.backendFilename,
          folderId: folder.id,
          folderName: folderPath
        });
      });
      if (folder.subfolders && folder.subfolders.length > 0) {
        allFiles = [...allFiles, ...extractAllFiles(folder.subfolders, folderPath)];
      }
    });
    return allFiles;
  };

  // Load project
  useEffect(() => {
    const loadProject = async () => {
      try {
        const loadedProject = await getProject(projectId);
        if (loadedProject) {
          setProject(loadedProject);
          setSymbols(loadedProject.symbols || []);
          
          const folderFiles = extractAllFiles(loadedProject.folders || []);
          const rootFiles = (loadedProject.files || []).map(file => ({
            id: file.id,
            name: file.name,
            backendFilename: file.backendFilename,
            folderId: null,
            folderName: '(Root)'
          }));
          setProjectFiles([...rootFiles, ...folderFiles]);
        } else {
          navigate('/');
        }
      } catch (error) {
        console.error('Error loading project:', error);
        navigate('/');
      } finally {
        setIsLoading(false);
      }
    };

    loadProject();
  }, [projectId, navigate]);

  // Save symbols when they change
  useEffect(() => {
    if (project && symbols) {
      const saveSymbolsToProject = async () => {
        const updatedProject = { ...project, symbols };
        await saveProject(updatedProject);
        setProject(updatedProject);
      };
      // Debounce save
      const timeout = setTimeout(saveSymbolsToProject, 500);
      return () => clearTimeout(timeout);
    }
  }, [symbols]);

  // Initialize PDF.js
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

  // Load PDF when selected
  const handleSelectPdf = async (file) => {
    setSelectedPdf(file);
    setPdfSearchQuery(null);
    setSelectedRegion(null);
    setExtractedSymbol(null);
    setSymbolMarkups([]);
    setPlacedSymbols([]);
    
    try {
      const pdfUrl = `${BACKEND_URL}/api/pdf/${encodeURIComponent(file.backendFilename)}?t=${Date.now()}`;
      const loadingTask = window.pdfjsLib.getDocument({ url: pdfUrl, verbosity: 0 });
      const pdf = await loadingTask.promise;
      setPdfDoc(pdf);
      setNumPages(pdf.numPages);
      setCurrentPage(1);
      setScale(1);
      setPanOffset({ x: 0, y: 0 });
    } catch (error) {
      console.error('Error loading PDF:', error);
      alert('Failed to load PDF: ' + error.message);
    }
  };

  // Render PDF page
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    
    const renderPage = async () => {
      if (isRendering) return;
      setIsRendering(true);
      
      try {
        const page = await pdfDoc.getPage(currentPage);
        const viewport = page.getViewport({ scale });
        
        // Store raw PDF page dimensions
        const baseViewport = page.getViewport({ scale: 1 });
        setPdfPageSize({ width: baseViewport.width, height: baseViewport.height });
        
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        setCanvasSize({ width: viewport.width, height: viewport.height });
        
        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise;
      } catch (error) {
        console.error('Error rendering page:', error);
      } finally {
        setIsRendering(false);
      }
    };
    
    renderPage();
  }, [pdfDoc, currentPage, scale]);

  // Sidebar resize handlers
  const handleSidebarMouseDown = (e) => {
    e.preventDefault();
    setIsResizingSidebar(true);
  };

  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMouseMove = (e) => {
      const newWidth = Math.max(200, Math.min(500, e.clientX));
      setSidebarWidth(newWidth);
      localStorage.setItem('symbols_sidebar_width', newWidth.toString());
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

  // Prevent browser zoom (Ctrl+scroll, Ctrl+plus/minus) and handle keyboard shortcuts
  useEffect(() => {
    const preventZoom = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
        e.preventDefault();
      }
    };
    
    // Global wheel zoom prevention - must be on document level with passive:false
    const preventWheelZoom = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // Handle PDF zoom here
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setScale(s => Math.max(0.25, Math.min(5, s * delta)));
      }
    };
    
    // Handle keyboard shortcuts
    const handleKeyDown = (e) => {
      // Prevent zoom shortcuts
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
        e.preventDefault();
      }
      // Delete selected markup
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEditableMarkup && !e.target.matches('input, textarea')) {
        e.preventDefault();
        deleteEditableMarkup(selectedEditableMarkup.id);
      }
      // Escape to deselect
      if (e.key === 'Escape') {
        setSelectedEditableMarkup(null);
        setIsPlacingMode(false);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('wheel', preventWheelZoom, { passive: false });
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('wheel', preventWheelZoom);
    };
  }, [selectedEditableMarkup]);

  // Mouse handlers for canvas interaction
  const handleCanvasMouseDown = (e) => {
    if (e.button === 1) {
      // Middle-click pan
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      return;
    }
    
    if (!canvasRef.current || e.button !== 0) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Get position in SVG/canvas coordinates (scaled)
    const svgX = e.clientX - rect.left;
    const svgY = e.clientY - rect.top;
    
    // Normalized 0-1 coordinates
    const normalizedX = svgX / canvasSize.width;
    const normalizedY = svgY / canvasSize.height;
    
    // Check if clicking on a resize handle first (when markup is selected)
    if (selectedEditableMarkup) {
      const handle = getResizeHandleAtPoint(selectedEditableMarkup, normalizedX, normalizedY);
      if (handle) {
        setIsResizingMarkup(true);
        setResizeHandle(handle);
        setMarkupDragStart({
          x: normalizedX,
          y: normalizedY,
          originalMarkup: { ...selectedEditableMarkup }
        });
        return;
      }
    }
    
    // Check if clicking on an editable markup (for selection/dragging)
    if (editableMarkups.length > 0 && !isPlacingMode) {
      const clickedMarkup = findMarkupAtPoint(normalizedX, normalizedY);
      if (clickedMarkup) {
        if (selectedEditableMarkup?.id === clickedMarkup.id) {
          // Start dragging the already selected markup
          setIsDraggingMarkup(true);
          setMarkupDragStart({
            x: normalizedX,
            y: normalizedY,
            originalMarkup: { ...clickedMarkup }
          });
        } else {
          // Select the markup
          setSelectedEditableMarkup(clickedMarkup);
        }
        return;
      } else {
        // Clicked on empty space, deselect
        setSelectedEditableMarkup(null);
      }
    }
    
    // Placement mode - place symbol
    if (isPlacingMode && testingSymbol) {
      placeSymbolAtPosition(normalizedX, normalizedY);
      return;
    }
    
    // Draw mode - create markup
    if (creationMode === 'draw' && activeMarkupType) {
      if (activeMarkupType === 'polyline' || activeMarkupType === 'polygon') {
        // Polyline mode - add points with click
        setPolylinePoints(prev => [...prev, { x: normalizedX, y: normalizedY }]);
      } else {
        // Start drawing shape
        setIsDrawingMarkup(true);
        setDrawStart({ x: normalizedX, y: normalizedY, svgX, svgY });
        setCurrentMarkup({
          type: activeMarkupType,
          startX: normalizedX,
          startY: normalizedY,
          endX: normalizedX,
          endY: normalizedY,
          color: markupColor,
          fillColor: markupFillColor,
          strokeWidth: markupStrokeWidth,
          fillOpacity: markupFillOpacity,
        });
      }
      return;
    }
    
    // Extract mode - draw selection rectangle (use SVG coords for rect display)
    if (creationMode === 'extract') {
      setIsDrawing(true);
      setDrawStart({ x: svgX, y: svgY });
      setCurrentRect({ x: svgX, y: svgY, width: 0, height: 0 });
      setSelectedRegion(null);
      setExtractedSymbol(null);
    }
  };

  const handleCanvasMouseMove = (e) => {
    if (isPanning) {
      setPanOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
      return;
    }
    
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Get position in SVG/canvas coordinates (scaled)
    const svgX = e.clientX - rect.left;
    const svgY = e.clientY - rect.top;
    
    // Normalized 0-1 coordinates
    const normalizedX = svgX / canvasSize.width;
    const normalizedY = svgY / canvasSize.height;
    
    // Handle markup resizing
    if (isResizingMarkup && selectedEditableMarkup && markupDragStart && resizeHandle) {
      const deltaX = normalizedX - markupDragStart.x;
      const deltaY = normalizedY - markupDragStart.y;
      const orig = markupDragStart.originalMarkup;
      
      let newStartX = orig.startX;
      let newStartY = orig.startY;
      let newEndX = orig.endX;
      let newEndY = orig.endY;
      
      // Apply delta based on which handle is being dragged
      if (resizeHandle.includes('w')) newStartX = orig.startX + deltaX;
      if (resizeHandle.includes('e')) newEndX = orig.endX + deltaX;
      if (resizeHandle.includes('n')) newStartY = orig.startY + deltaY;
      if (resizeHandle.includes('s')) newEndY = orig.endY + deltaY;
      
      // Update the markup
      setEditableMarkups(prev => prev.map(m => 
        m.id === selectedEditableMarkup.id 
          ? { ...m, startX: newStartX, startY: newStartY, endX: newEndX, endY: newEndY }
          : m
      ));
      setSelectedEditableMarkup(prev => ({ 
        ...prev, 
        startX: newStartX, 
        startY: newStartY, 
        endX: newEndX, 
        endY: newEndY 
      }));
      return;
    }
    
    // Handle markup dragging
    if (isDraggingMarkup && selectedEditableMarkup && markupDragStart) {
      const deltaX = normalizedX - markupDragStart.x;
      const deltaY = normalizedY - markupDragStart.y;
      const orig = markupDragStart.originalMarkup;
      
      const updatedMarkup = {
        ...selectedEditableMarkup,
        startX: orig.startX + deltaX,
        startY: orig.startY + deltaY,
        endX: orig.endX + deltaX,
        endY: orig.endY + deltaY,
      };
      
      // Update points for polyline/polygon
      if (orig.points) {
        updatedMarkup.points = orig.points.map(p => ({
          x: p.x + deltaX,
          y: p.y + deltaY
        }));
      }
      
      setEditableMarkups(prev => prev.map(m => 
        m.id === selectedEditableMarkup.id ? updatedMarkup : m
      ));
      setSelectedEditableMarkup(updatedMarkup);
      return;
    }
    
    // Drawing markup
    if (isDrawingMarkup && currentMarkup && drawStart) {
      setCurrentMarkup(prev => ({
        ...prev,
        endX: normalizedX,
        endY: normalizedY
      }));
      return;
    }
    
    // Drawing selection rect (use SVG coords)
    if (isDrawing && drawStart) {
      const width = svgX - drawStart.x;
      const height = svgY - drawStart.y;
      
      setCurrentRect({
        x: width < 0 ? svgX : drawStart.x,
        y: height < 0 ? svgY : drawStart.y,
        width: Math.abs(width),
        height: Math.abs(height)
      });
    }
  };

  const handleCanvasMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }
    
    // Finish resizing markup
    if (isResizingMarkup) {
      setIsResizingMarkup(false);
      setResizeHandle(null);
      setMarkupDragStart(null);
      return;
    }
    
    // Finish dragging markup
    if (isDraggingMarkup) {
      setIsDraggingMarkup(false);
      setMarkupDragStart(null);
      return;
    }
    
    // Finish drawing markup
    if (isDrawingMarkup && currentMarkup) {
      const minSize = 0.01;
      const width = Math.abs(currentMarkup.endX - currentMarkup.startX);
      const height = Math.abs(currentMarkup.endY - currentMarkup.startY);
      
      if (width > minSize || height > minSize || currentMarkup.type === 'text') {
        // Normalize coordinates so startX < endX, startY < endY
        const normalized = {
          ...currentMarkup,
          id: `markup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          startX: Math.min(currentMarkup.startX, currentMarkup.endX),
          startY: Math.min(currentMarkup.startY, currentMarkup.endY),
          endX: Math.max(currentMarkup.startX, currentMarkup.endX),
          endY: Math.max(currentMarkup.startY, currentMarkup.endY),
        };
        
        if (currentMarkup.type === 'text') {
          normalized.text = markupText || 'Text';
          normalized.fontSize = markupFontSize;
        }
        
        setSymbolMarkups(prev => [...prev, normalized]);
      }
      
      setIsDrawingMarkup(false);
      setCurrentMarkup(null);
      setDrawStart(null);
      return;
    }
    
    // Finish drawing selection rect
    if (isDrawing && currentRect) {
      if (currentRect.width > 10 && currentRect.height > 10) {
        // Convert from SVG coords to normalized 0-1
        setSelectedRegion({
          x: currentRect.x / canvasSize.width,
          y: currentRect.y / canvasSize.height,
          width: currentRect.width / canvasSize.width,
          height: currentRect.height / canvasSize.height,
          page: currentPage - 1,
          // Store PDF page dimensions for scale calculation
          pdfWidth: pdfPageSize.width,
          pdfHeight: pdfPageSize.height
        });
      }
      
      setIsDrawing(false);
      setDrawStart(null);
      setCurrentRect(null);
    }
  };

  // Complete polyline/polygon
  const completePolyline = () => {
    if (polylinePoints.length < 2) return;
    
    const xs = polylinePoints.map(p => p.x);
    const ys = polylinePoints.map(p => p.y);
    
    const markup = {
      id: `markup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: activeMarkupType,
      points: polylinePoints,
      startX: Math.min(...xs),
      startY: Math.min(...ys),
      endX: Math.max(...xs),
      endY: Math.max(...ys),
      color: markupColor,
      fillColor: activeMarkupType === 'polygon' ? markupFillColor : 'none',
      strokeWidth: markupStrokeWidth,
      fillOpacity: markupFillOpacity,
    };
    
    setSymbolMarkups(prev => [...prev, markup]);
    setPolylinePoints([]);
  };

  // Cancel polyline drawing
  const cancelPolyline = () => {
    setPolylinePoints([]);
  };

  // Recolor an image data URL and return new data URL
  const recolorImageDataUrl = useCallback((dataUrl, newColor) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Parse hex color to RGB
        const hex = newColor.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha > 10) {
            // Preserve the luminance/intensity of the original pixel
            const origGray = (data[i] + data[i + 1] + data[i + 2]) / 3;
            const intensity = origGray / 255;
            
            // Apply color with intensity
            data[i] = Math.round(r * (1 - intensity * 0.3));
            data[i + 1] = Math.round(g * (1 - intensity * 0.3));
            data[i + 2] = Math.round(b * (1 - intensity * 0.3));
          }
        }
        
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = dataUrl;
    });
  }, []);

  // Place symbol at position and convert to editable markups
  const placeSymbolAtPosition = async (centerX, centerY) => {
    if (!testingSymbol) return;
    
    const symbol = testingSymbol;
    const symW = (symbol.originalWidth || 0.1) * placementSettings.scale;
    const symH = (symbol.originalHeight || 0.1) * placementSettings.scale;
    const offsetX = centerX - symW / 2;
    const offsetY = centerY - symH / 2;
    
    // Handle image-type symbols (bitmap captures)
    if (symbol.type === 'image' && symbol.image) {
      let imageData = symbol.image;
      
      // Apply color override if not preserving colors
      if (!placementSettings.preserveColors && placementSettings.color) {
        imageData = await recolorImageDataUrl(symbol.image, placementSettings.color);
      }
      
      const imageMarkup = {
        id: `editable_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'image',
        image: imageData,
        page: currentPage,
        startX: offsetX,
        startY: offsetY,
        endX: offsetX + symW,
        endY: offsetY + symH,
        rotation: placementSettings.rotation || 0,
      };
      setEditableMarkups(prev => [...prev, imageMarkup]);
      return;
    }
    
    if (placementSettings.autoConvert && symbol.markups) {
      // Convert symbol to individual editable markups
      const newMarkups = symbol.markups.map((m, idx) => {
        const markup = {
          ...m,
          id: `editable_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 9)}`,
          page: currentPage,
          color: placementSettings.preserveColors ? m.color : placementSettings.color,
          strokeWidth: placementSettings.strokeWidth || m.strokeWidth,
          rotation: (m.rotation || 0) + (placementSettings.rotation || 0),
        };
        
        // Transform coordinates based on placement
        if (m.points) {
          markup.points = m.points.map(p => ({
            x: offsetX + p.x * symW,
            y: offsetY + p.y * symH
          }));
          const xs = markup.points.map(p => p.x);
          const ys = markup.points.map(p => p.y);
          markup.startX = Math.min(...xs);
          markup.startY = Math.min(...ys);
          markup.endX = Math.max(...xs);
          markup.endY = Math.max(...ys);
        } else {
          markup.startX = offsetX + (m.startX || 0) * symW;
          markup.startY = offsetY + (m.startY || 0) * symH;
          markup.endX = offsetX + (m.endX || 1) * symW;
          markup.endY = offsetY + (m.endY || 1) * symH;
        }
        
        return markup;
      });
      
      setEditableMarkups(prev => [...prev, ...newMarkups]);
    } else {
      // Keep as symbol group (legacy behavior)
      const newPlacement = {
        id: `placed_${Date.now()}`,
        symbolId: testingSymbol.id,
        symbol: testingSymbol,
        x: centerX,
        y: centerY,
        scale: placementSettings.scale,
        rotation: placementSettings.rotation,
        color: placementSettings.preserveColors ? null : placementSettings.color,
        strokeWidth: placementSettings.strokeWidth,
        page: currentPage,
        pdfWidth: pdfPageSize.width,
        pdfHeight: pdfPageSize.height,
      };
      
      setPlacedSymbols(prev => [...prev, newPlacement]);
    }
  };

  // Find markup at a given point (for selection)
  const findMarkupAtPoint = useCallback((x, y) => {
    const hitPadding = 0.01; // Hit testing padding in normalized coords
    
    // Check in reverse order (top-most first)
    for (let i = editableMarkups.length - 1; i >= 0; i--) {
      const m = editableMarkups[i];
      if (m.page !== currentPage) continue;
      
      const minX = Math.min(m.startX, m.endX) - hitPadding;
      const maxX = Math.max(m.startX, m.endX) + hitPadding;
      const minY = Math.min(m.startY, m.endY) - hitPadding;
      const maxY = Math.max(m.startY, m.endY) + hitPadding;
      
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
        return m;
      }
    }
    return null;
  }, [editableMarkups, currentPage]);

  // Get resize handle at point (if any)
  const getResizeHandleAtPoint = useCallback((markup, x, y) => {
    if (!markup) return null;
    
    const handleSize = 0.015; // Size of handle in normalized coords
    const minX = Math.min(markup.startX, markup.endX);
    const maxX = Math.max(markup.startX, markup.endX);
    const minY = Math.min(markup.startY, markup.endY);
    const maxY = Math.max(markup.startY, markup.endY);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    
    const handles = {
      'nw': { x: minX, y: minY },
      'n':  { x: midX, y: minY },
      'ne': { x: maxX, y: minY },
      'e':  { x: maxX, y: midY },
      'se': { x: maxX, y: maxY },
      's':  { x: midX, y: maxY },
      'sw': { x: minX, y: maxY },
      'w':  { x: minX, y: midY },
    };
    
    for (const [handleName, handlePos] of Object.entries(handles)) {
      if (Math.abs(x - handlePos.x) < handleSize && Math.abs(y - handlePos.y) < handleSize) {
        return handleName;
      }
    }
    return null;
  }, []);

  // Delete selected editable markup
  const deleteEditableMarkup = useCallback((markupId) => {
    setEditableMarkups(prev => prev.filter(m => m.id !== markupId));
    if (selectedEditableMarkup?.id === markupId) {
      setSelectedEditableMarkup(null);
    }
  }, [selectedEditableMarkup]);

  // Update selected markup properties
  const updateMarkupProperty = useCallback((property, value) => {
    if (!selectedEditableMarkup) return;
    
    setEditableMarkups(prev => prev.map(m => 
      m.id === selectedEditableMarkup.id ? { ...m, [property]: value } : m
    ));
    setSelectedEditableMarkup(prev => ({ ...prev, [property]: value }));
  }, [selectedEditableMarkup]);

  // Convert placed symbols to markup objects (for saving/exporting)
  const convertPlacementsToMarkups = useCallback(() => {
    const allMarkups = [];
    
    placedSymbols.forEach(placement => {
      const symbol = placement.symbol;
      if (!symbol || !symbol.markups) return;
      
      const placementScale = placement.scale;
      const symbolWidth = symbol.originalWidth || 0.1;
      const symbolHeight = symbol.originalHeight || 0.1;
      const scaledWidth = symbolWidth * placementScale;
      const scaledHeight = symbolHeight * placementScale;
      
      // Calculate top-left from center
      const offsetX = placement.x - scaledWidth / 2;
      const offsetY = placement.y - scaledHeight / 2;
      
      symbol.markups.forEach(m => {
        const newMarkup = {
          ...m,
          id: `${m.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          page: placement.page - 1, // 0-indexed
          color: placement.color || m.color,
          strokeWidth: placement.strokeWidth || m.strokeWidth,
          rotation: (m.rotation || 0) + (placement.rotation || 0),
        };
        
        // Transform coordinates
        if (m.points) {
          // Polyline/polygon points
          newMarkup.points = m.points.map(p => ({
            x: offsetX + p.x * scaledWidth,
            y: offsetY + p.y * scaledHeight
          }));
          const xs = newMarkup.points.map(p => p.x);
          const ys = newMarkup.points.map(p => p.y);
          newMarkup.startX = Math.min(...xs);
          newMarkup.startY = Math.min(...ys);
          newMarkup.endX = Math.max(...xs);
          newMarkup.endY = Math.max(...ys);
        } else if (m.startX !== undefined) {
          // Rectangle, ellipse, arrow, etc.
          newMarkup.startX = offsetX + m.startX * scaledWidth;
          newMarkup.startY = offsetY + m.startY * scaledHeight;
          newMarkup.endX = offsetX + m.endX * scaledWidth;
          newMarkup.endY = offsetY + m.endY * scaledHeight;
        }
        
        allMarkups.push(newMarkup);
      });
    });
    
    return allMarkups;
  }, [placedSymbols]);

  // Douglas-Peucker line simplification
  const douglasPeucker = (points, tolerance) => {
    if (points.length <= 2) return points;
    
    let maxDist = 0;
    let maxIdx = 0;
    
    const first = points[0];
    const last = points[points.length - 1];
    
    for (let i = 1; i < points.length - 1; i++) {
      const dist = perpendicularDistance(points[i], first, last);
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }
    
    if (maxDist > tolerance) {
      const left = douglasPeucker(points.slice(0, maxIdx + 1), tolerance);
      const right = douglasPeucker(points.slice(maxIdx), tolerance);
      return [...left.slice(0, -1), ...right];
    } else {
      return [first, last];
    }
  };

  const perpendicularDistance = (point, lineStart, lineEnd) => {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    
    if (dx === 0 && dy === 0) {
      return Math.sqrt(
        Math.pow(point.x - lineStart.x, 2) + 
        Math.pow(point.y - lineStart.y, 2)
      );
    }
    
    const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy);
    const nearestX = lineStart.x + t * dx;
    const nearestY = lineStart.y + t * dy;
    
    return Math.sqrt(
      Math.pow(point.x - nearestX, 2) + 
      Math.pow(point.y - nearestY, 2)
    );
  };

  // ============================================
  // BITMAP CAPTURE & EDITING
  // ============================================
  
  // Editing state for captured symbol
  const [capturedImage, setCapturedImage] = useState(null); // { canvas, imageData, width, height }
  const [editTool, setEditTool] = useState('eraser'); // 'eraser', 'restore', 'fill'
  const [editBrushSize, setEditBrushSize] = useState(10);
  const [isEditingSymbol, setIsEditingSymbol] = useState(false);
  const [removeWhiteBackground, setRemoveWhiteBackground] = useState(true);
  const [symbolColor, setSymbolColor] = useState('#000000'); // Color for recoloring
  const editCanvasRef = useRef(null);
  const [isDrawingOnEdit, setIsDrawingOnEdit] = useState(false);

  // Capture region from PDF as bitmap
  const captureRegion = useCallback(async () => {
    if (!selectedRegion || !pdfDoc || !canvasRef.current) return;
    
    setIsExtracting(true);
    
    try {
      const extractionScale = 3; // High res capture
      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale: extractionScale });
      
      const regionWidth = Math.round(selectedRegion.width * viewport.width);
      const regionHeight = Math.round(selectedRegion.height * viewport.height);
      const regionX = Math.round(selectedRegion.x * viewport.width);
      const regionY = Math.round(selectedRegion.y * viewport.height);
      
      // Render full page at high res
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = viewport.width;
      tempCanvas.height = viewport.height;
      const tempCtx = tempCanvas.getContext('2d');
      
      await page.render({
        canvasContext: tempCtx,
        viewport: viewport
      }).promise;
      
      // Extract region
      const regionCanvas = document.createElement('canvas');
      regionCanvas.width = regionWidth;
      regionCanvas.height = regionHeight;
      const regionCtx = regionCanvas.getContext('2d');
      
      regionCtx.drawImage(
        tempCanvas,
        regionX, regionY, regionWidth, regionHeight,
        0, 0, regionWidth, regionHeight
      );
      
      // Store for editing
      setCapturedImage({
        canvas: regionCanvas,
        width: regionWidth,
        height: regionHeight,
        originalData: regionCtx.getImageData(0, 0, regionWidth, regionHeight),
        // Store normalized dimensions for proper scaling when placed
        normalizedWidth: selectedRegion.width,
        normalizedHeight: selectedRegion.height,
      });
      setIsEditingSymbol(true);
      
    } catch (error) {
      console.error('Error capturing region:', error);
      alert('Failed to capture region: ' + error.message);
    } finally {
      setIsExtracting(false);
    }
  }, [selectedRegion, pdfDoc, currentPage]);

  // Initialize edit canvas when captured image changes
  useEffect(() => {
    if (capturedImage && editCanvasRef.current) {
      const ctx = editCanvasRef.current.getContext('2d');
      ctx.drawImage(capturedImage.canvas, 0, 0);
    }
  }, [capturedImage]);

  // Handle drawing on edit canvas (erase/restore)
  const handleEditCanvasMouseDown = (e) => {
    if (!editCanvasRef.current || !capturedImage) return;
    setIsDrawingOnEdit(true);
    handleEditCanvasDraw(e);
  };

  const handleEditCanvasMouseMove = (e) => {
    if (!isDrawingOnEdit || !editCanvasRef.current) return;
    handleEditCanvasDraw(e);
  };

  const handleEditCanvasMouseUp = () => {
    setIsDrawingOnEdit(false);
  };

  const handleEditCanvasDraw = (e) => {
    if (!editCanvasRef.current || !capturedImage) return;
    
    const canvas = editCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    const ctx = canvas.getContext('2d');
    
    if (editTool === 'eraser') {
      // Erase to transparent
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(x, y, editBrushSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (editTool === 'restore') {
      // Restore from original
      const origCtx = capturedImage.canvas.getContext('2d');
      const origData = capturedImage.originalData;
      
      // Draw circular region from original
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, editBrushSize, 0, Math.PI * 2);
      ctx.clip();
      ctx.putImageData(origData, 0, 0);
      ctx.restore();
    } else if (editTool === 'fill') {
      // Fill with white (for cleaning up)
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(x, y, editBrushSize, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // Remove white/light background (make transparent)
  const removeBackground = useCallback((tolerance = 240) => {
    if (!editCanvasRef.current) return;
    
    const canvas = editCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // If pixel is white-ish, make transparent
      if (r > tolerance && g > tolerance && b > tolerance) {
        data[i + 3] = 0; // Set alpha to 0
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
  }, []);

  // Remove color noise (keep only dark pixels)
  const removeNoise = useCallback((threshold = 200) => {
    if (!editCanvasRef.current) return;
    
    const canvas = editCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const gray = (r + g + b) / 3;
      
      if (gray > threshold) {
        // Light pixel - make transparent
        data[i + 3] = 0;
      } else {
        // Dark pixel - make fully black and opaque
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
  }, []);

  // Remove small specks (isolated blobs smaller than minSize pixels)
  const removeSpecks = useCallback((minSize = 30) => {
    if (!editCanvasRef.current) return;
    
    const canvas = editCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = imageData;
    
    // Create binary mask of non-transparent dark pixels
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const alpha = data[i * 4 + 3];
      const gray = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
      mask[i] = (alpha > 128 && gray < 200) ? 1 : 0;
    }
    
    // Find connected components
    const labels = new Int32Array(width * height);
    const sizes = new Map();
    let labelCount = 0;
    
    const floodFill = (startX, startY, label) => {
      const stack = [[startX, startY]];
      let size = 0;
      
      while (stack.length > 0) {
        const [x, y] = stack.pop();
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        
        const idx = y * width + x;
        if (mask[idx] === 0 || labels[idx] !== 0) continue;
        
        labels[idx] = label;
        size++;
        
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      return size;
    };
    
    // Label all components
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (mask[idx] === 1 && labels[idx] === 0) {
          labelCount++;
          const size = floodFill(x, y, labelCount);
          sizes.set(labelCount, size);
        }
      }
    }
    
    // Remove small components
    for (let i = 0; i < width * height; i++) {
      const label = labels[i];
      if (label > 0 && sizes.get(label) < minSize) {
        // Make transparent
        data[i * 4 + 3] = 0;
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
  }, []);

  // Recolor - change all dark/visible pixels to a specific color (ignores white background)
  const recolorSymbol = useCallback((newColor) => {
    if (!editCanvasRef.current) return;
    
    const canvas = editCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Parse hex color to RGB
    const hex = newColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      const origR = data[i];
      const origG = data[i + 1];
      const origB = data[i + 2];
      const gray = (origR + origG + origB) / 3;
      
      // Only recolor non-transparent AND dark pixels (not white/light background)
      if (alpha > 10 && gray < 200) {
        const darkness = 1 - (gray / 200); // How dark the pixel is (0-1)
        
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        // Preserve alpha based on darkness
        data[i + 3] = Math.min(255, Math.round(255 * darkness));
      } else if (alpha > 10 && gray >= 200) {
        // Light pixel - make it transparent (it's background)
        data[i + 3] = 0;
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
  }, []);

  // Invert colors
  const invertColors = useCallback(() => {
    if (!editCanvasRef.current) return;
    
    const canvas = editCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) { // Only invert non-transparent
        data[i] = 255 - data[i];
        data[i + 1] = 255 - data[i + 1];
        data[i + 2] = 255 - data[i + 2];
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
  }, []);

  // Reset to original
  const resetToOriginal = useCallback(() => {
    if (!editCanvasRef.current || !capturedImage) return;
    
    const ctx = editCanvasRef.current.getContext('2d');
    ctx.clearRect(0, 0, editCanvasRef.current.width, editCanvasRef.current.height);
    ctx.putImageData(capturedImage.originalData, 0, 0);
  }, [capturedImage]);

  // Auto-trim transparent edges
  const trimTransparent = useCallback(() => {
    if (!editCanvasRef.current || !capturedImage) return;
    
    const canvas = editCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const w = canvas.width;
    const h = canvas.height;
    
    let minX = w, minY = h, maxX = 0, maxY = 0;
    
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const alpha = data[(y * w + x) * 4 + 3];
        if (alpha > 0) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    
    if (maxX < minX) return; // All transparent
    
    const trimW = maxX - minX + 1;
    const trimH = maxY - minY + 1;
    const trimmedData = ctx.getImageData(minX, minY, trimW, trimH);
    
    // Calculate how much we're trimming as a ratio
    const widthRatio = trimW / w;
    const heightRatio = trimH / h;
    
    // Resize canvas and put trimmed data
    canvas.width = trimW;
    canvas.height = trimH;
    ctx.putImageData(trimmedData, 0, 0);
    
    // Update normalized dimensions proportionally
    setCapturedImage(prev => ({
      ...prev,
      width: trimW,
      height: trimH,
      normalizedWidth: (prev.normalizedWidth || 0.1) * widthRatio,
      normalizedHeight: (prev.normalizedHeight || 0.1) * heightRatio,
    }));
  }, [capturedImage]);

  // Save edited symbol
  const saveEditedSymbol = useCallback(() => {
    if (!editCanvasRef.current) return;
    
    const canvas = editCanvasRef.current;
    const dataUrl = canvas.toDataURL('image/png');
    
    const newSymbol = {
      id: `symbol_${Date.now()}`,
      name: symbolName || `Symbol ${symbols.length + 1}`,
      category: symbolCategory || 'General',
      type: 'image', // Mark as image-based symbol
      image: dataUrl,
      width: canvas.width,
      height: canvas.height,
      // Use normalized dimensions from capture for proper scaling
      originalWidth: capturedImage?.normalizedWidth || 0.1,
      originalHeight: capturedImage?.normalizedHeight || 0.1,
      aspectRatio: canvas.width / canvas.height,
      preview: dataUrl,
      createdAt: new Date().toISOString()
    };
    
    setSymbols(prev => [...prev, newSymbol]);
    setCapturedImage(null);
    setIsEditingSymbol(false);
    setSelectedRegion(null);
    setSymbolName('');
    setSymbolCategory('');
    setSelectedItem(newSymbol.id);
  }, [symbolName, symbolCategory, symbols.length, capturedImage]);

  // Cancel editing
  const cancelEditing = useCallback(() => {
    setCapturedImage(null);
    setIsEditingSymbol(false);
  }, []);

  // Generate SVG preview from markups
  const generateSVGPreview = (markups, width = 100, height = 100) => {
    if (!markups || markups.length === 0) return null;
    
    const elements = markups.map((m, idx) => {
      const color = m.color || '#000000';
      const strokeWidth = Math.max(1, (m.strokeWidth || 2) * 0.5);
      const fill = m.fillColor && m.fillColor !== 'none' ? m.fillColor : 'none';
      
      switch (m.type) {
        case 'rectangle':
          return `<rect x="${m.startX * width}" y="${m.startY * height}" width="${(m.endX - m.startX) * width}" height="${(m.endY - m.startY) * height}" stroke="${color}" stroke-width="${strokeWidth}" fill="${fill}" fill-opacity="${m.fillOpacity || 0.3}"/>`;
        
        case 'ellipse':
          const cx = m.cx !== undefined ? m.cx * width : (m.startX + m.endX) / 2 * width;
          const cy = m.cy !== undefined ? m.cy * height : (m.startY + m.endY) / 2 * height;
          const rx = m.rx !== undefined ? m.rx * width : Math.abs(m.endX - m.startX) / 2 * width;
          const ry = m.ry !== undefined ? m.ry * height : Math.abs(m.endY - m.startY) / 2 * height;
          return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="${color}" stroke-width="${strokeWidth}" fill="${fill}" fill-opacity="${m.fillOpacity || 0.3}"/>`;
        
        case 'line':
          return `<line x1="${m.startX * width}" y1="${m.startY * height}" x2="${m.endX * width}" y2="${m.endY * height}" stroke="${color}" stroke-width="${strokeWidth}"/>`;
        
        case 'arc':
          if (m.cx !== undefined && m.radius !== undefined) {
            const arcCx = m.cx * width;
            const arcCy = m.cy * height;
            const arcR = m.radius * Math.min(width, height);
            const startAngle = m.startAngle || 0;
            const endAngle = m.endAngle || Math.PI;
            const arcStartX = arcCx + arcR * Math.cos(startAngle);
            const arcStartY = arcCy + arcR * Math.sin(startAngle);
            const arcEndX = arcCx + arcR * Math.cos(endAngle);
            const arcEndY = arcCy + arcR * Math.sin(endAngle);
            let angleDiff = endAngle - startAngle;
            while (angleDiff < 0) angleDiff += 2 * Math.PI;
            const largeArc = angleDiff > Math.PI ? 1 : 0;
            return `<path d="M ${arcStartX} ${arcStartY} A ${arcR} ${arcR} 0 ${largeArc} 1 ${arcEndX} ${arcEndY}" stroke="${color}" stroke-width="${strokeWidth}" fill="none"/>`;
          }
          return '';
        
        case 'polygon':
          if (m.points) {
            const pts = m.points.map(p => `${p.x * width},${p.y * height}`).join(' ');
            return `<polygon points="${pts}" stroke="${color}" stroke-width="${strokeWidth}" fill="${fill}" fill-opacity="${m.fillOpacity || 0.3}"/>`;
          }
          return '';
        
        case 'polyline':
          if (m.points) {
            const pts = m.points.map(p => `${p.x * width},${p.y * height}`).join(' ');
            return `<polyline points="${pts}" stroke="${color}" stroke-width="${strokeWidth}" fill="none"/>`;
          }
          return '';
        
        default:
          return '';
      }
    }).join('');
    
    return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${elements}</svg>`;
  };

  // Extract symbol from selected region (vectorization)
  // extractSymbol now just calls captureRegion for bitmap workflow
  const extractSymbol = captureRegion;

  // Create symbol from drawn markups
  const createSymbolFromMarkups = useCallback(() => {
    if (symbolMarkups.length === 0) return;
    
    // Calculate bounding box of all markups
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    symbolMarkups.forEach(m => {
      if (m.points) {
        m.points.forEach(p => {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        });
      } else {
        minX = Math.min(minX, m.startX, m.endX);
        minY = Math.min(minY, m.startY, m.endY);
        maxX = Math.max(maxX, m.startX, m.endX);
        maxY = Math.max(maxY, m.startY, m.endY);
      }
    });
    
    const width = maxX - minX;
    const height = maxY - minY;
    
    // Normalize markups to 0-1 within bounding box
    const normalizedMarkups = symbolMarkups.map(m => {
      const normalized = { ...m };
      
      if (m.points) {
        normalized.points = m.points.map(p => ({
          x: (p.x - minX) / width,
          y: (p.y - minY) / height
        }));
        normalized.startX = (m.startX - minX) / width;
        normalized.startY = (m.startY - minY) / height;
        normalized.endX = (m.endX - minX) / width;
        normalized.endY = (m.endY - minY) / height;
      } else {
        normalized.startX = (m.startX - minX) / width;
        normalized.startY = (m.startY - minY) / height;
        normalized.endX = (m.endX - minX) / width;
        normalized.endY = (m.endY - minY) / height;
      }
      
      return normalized;
    });
    
    // Generate preview SVG
    const previewSize = 100;
    const padding = 5;
    const drawSize = previewSize - padding * 2;
    
    let svgContent = '';
    normalizedMarkups.forEach(m => {
      const x1 = padding + m.startX * drawSize;
      const y1 = padding + m.startY * drawSize;
      const x2 = padding + m.endX * drawSize;
      const y2 = padding + m.endY * drawSize;
      
      if (m.type === 'rectangle') {
        svgContent += `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" stroke="${m.color}" stroke-width="1" fill="${m.fillColor === 'none' ? 'none' : m.fillColor}" fill-opacity="${m.fillOpacity}"/>`;
      } else if (m.type === 'ellipse') {
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        svgContent += `<ellipse cx="${cx}" cy="${cy}" rx="${(x2 - x1) / 2}" ry="${(y2 - y1) / 2}" stroke="${m.color}" stroke-width="1" fill="${m.fillColor === 'none' ? 'none' : m.fillColor}" fill-opacity="${m.fillOpacity}"/>`;
      } else if (m.type === 'arrow' || m.type === 'line') {
        svgContent += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${m.color}" stroke-width="1"/>`;
        if (m.type === 'arrow') {
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const arrowLen = 8;
          const arrowAngle = Math.PI / 7;
          svgContent += `<polygon points="${x2},${y2} ${x2 - arrowLen * Math.cos(angle - arrowAngle)},${y2 - arrowLen * Math.sin(angle - arrowAngle)} ${x2 - arrowLen * Math.cos(angle + arrowAngle)},${y2 - arrowLen * Math.sin(angle + arrowAngle)}" fill="${m.color}"/>`;
        }
      } else if (m.type === 'polyline' || m.type === 'polygon') {
        const points = m.points.map(p => `${padding + p.x * drawSize},${padding + p.y * drawSize}`).join(' ');
        if (m.type === 'polygon') {
          svgContent += `<polygon points="${points}" stroke="${m.color}" stroke-width="1" fill="${m.fillColor === 'none' ? 'none' : m.fillColor}" fill-opacity="${m.fillOpacity}"/>`;
        } else {
          svgContent += `<polyline points="${points}" stroke="${m.color}" stroke-width="1" fill="none"/>`;
        }
      } else if (m.type === 'text') {
        svgContent += `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" stroke="${m.color}" stroke-width="1" fill="white"/>`;
        const fontSize = Math.min(10, (y2 - y1) * 0.6);
        svgContent += `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 + fontSize / 3}" font-size="${fontSize}" fill="${m.color}" text-anchor="middle">${(m.text || 'T').substring(0, 3)}</text>`;
      }
    });
    
    const preview = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${previewSize} ${previewSize}"><rect width="${previewSize}" height="${previewSize}" fill="white" rx="4"/>${svgContent}</svg>`;
    
    const newSymbol = {
      id: `symbol_${Date.now()}`,
      name: symbolName || `Symbol ${symbols.length + 1}`,
      category: symbolCategory || 'General',
      markups: normalizedMarkups,
      originalWidth: width,
      originalHeight: height,
      aspectRatio: width / height,
      preview: preview,
      createdAt: new Date().toISOString(),
      // Store source PDF info if available
      sourceScale: selectedPdf ? {
        pdfWidth: pdfPageSize.width,
        pdfHeight: pdfPageSize.height,
      } : null,
    };
    
    setSymbols(prev => [...prev, newSymbol]);
    setSymbolMarkups([]);
    setSymbolName('');
    setSymbolCategory('');
    setSelectedItem(newSymbol.id);
  }, [symbolMarkups, symbolName, symbolCategory, symbols.length, selectedPdf, pdfPageSize]);

  // Save extracted symbol
  const saveExtractedSymbol = () => {
    if (!extractedSymbol) return;
    
    const newSymbol = {
      ...extractedSymbol,
      name: symbolName || 'Untitled Symbol',
      category: symbolCategory || 'General',
      createdAt: new Date().toISOString()
    };
    
    setSymbols(prev => [...prev, newSymbol]);
    setSelectedRegion(null);
    setExtractedSymbol(null);
    setSymbolName('');
    setSymbolCategory('');
    setSelectedItem(newSymbol.id);
  };

  // Start testing a symbol
  const startTestingSymbol = (symbol) => {
    setTestingSymbol(symbol);
    setSelectedItem('test');
    setPlacedSymbols([]);
    setIsPlacingMode(true);
    
    // Use symbol's original color if available
    if (symbol.markups?.[0]?.color) {
      setPlacementSettings(prev => ({
        ...prev,
        color: symbol.markups[0].color,
        preserveColors: true
      }));
    }
  };

  // Remove placed symbol
  const removePlacedSymbol = (id) => {
    setPlacedSymbols(prev => prev.filter(p => p.id !== id));
  };

  // Clear all placed symbols
  const clearPlacedSymbols = () => {
    setPlacedSymbols([]);
  };

  // Export placements as markups
  const exportAsMarkups = () => {
    const markups = convertPlacementsToMarkups();
    console.log('Exported markups:', markups);
    // Could save to project, download as JSON, etc.
    alert(`Exported ${markups.length} markup(s). Check console for data.`);
  };

  // Delete symbol
  const deleteSymbol = (symbolId) => {
    if (confirm('Delete this symbol?')) {
      setSymbols(prev => prev.filter(s => s.id !== symbolId));
      setSelectedItem('home');
    }
  };

  // Delete markup from symbol being created
  const deleteSymbolMarkup = (markupId) => {
    setSymbolMarkups(prev => prev.filter(m => m.id !== markupId));
    setSelectedSymbolMarkup(null);
  };

  // Filter symbols
  const filteredSymbols = symbols.filter(symbol =>
    symbol.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    symbol.category?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredProjectFiles = projectFiles.filter(file =>
    file.name.toLowerCase().includes((pdfSearchQuery || '').toLowerCase())
  );

  // Group symbols by category
  const symbolsByCategory = useMemo(() => {
    const grouped = {};
    filteredSymbols.forEach(symbol => {
      const cat = symbol.category || 'General';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(symbol);
    });
    return grouped;
  }, [filteredSymbols]);

  // Zoom controls
  const handleZoomIn = () => setScale(s => Math.min(s * 1.25, 5));
  const handleZoomOut = () => setScale(s => Math.max(s / 1.25, 0.25));

  // Render markup preview in SVG
  const renderMarkupSVG = (markup, scaledW, scaledH) => {
    const x1 = markup.startX * scaledW;
    const y1 = markup.startY * scaledH;
    const x2 = markup.endX * scaledW;
    const y2 = markup.endY * scaledH;
    
    switch (markup.type) {
      case 'rectangle':
        return (
          <rect
            key={markup.id}
            x={Math.min(x1, x2)}
            y={Math.min(y1, y2)}
            width={Math.abs(x2 - x1)}
            height={Math.abs(y2 - y1)}
            stroke={markup.color}
            strokeWidth={markup.strokeWidth}
            fill={markup.fillColor === 'none' ? 'transparent' : markup.fillColor}
            fillOpacity={markup.fillOpacity}
          />
        );
      case 'ellipse':
        // Use stored center/radii if available, otherwise calculate from bounds
        const cx = markup.cx !== undefined ? markup.cx * scaledW : (x1 + x2) / 2;
        const cy = markup.cy !== undefined ? markup.cy * scaledH : (y1 + y2) / 2;
        const rx = markup.rx !== undefined ? markup.rx * scaledW : Math.abs(x2 - x1) / 2;
        const ry = markup.ry !== undefined ? markup.ry * scaledH : Math.abs(y2 - y1) / 2;
        return (
          <ellipse
            key={markup.id}
            cx={cx}
            cy={cy}
            rx={rx}
            ry={ry}
            stroke={markup.color}
            strokeWidth={markup.strokeWidth}
            fill={markup.fillColor === 'none' ? 'transparent' : markup.fillColor}
            fillOpacity={markup.fillOpacity}
          />
        );
      case 'arc':
        // Draw an arc using SVG path
        const arcCx = (markup.cx || 0) * scaledW;
        const arcCy = (markup.cy || 0) * scaledH;
        const arcRadius = (markup.radius || 0.1) * Math.min(scaledW, scaledH);
        const startAngle = markup.startAngle || 0;
        const endAngle = markup.endAngle || Math.PI;
        
        // Calculate start and end points on the arc
        const arcStartX = arcCx + arcRadius * Math.cos(startAngle);
        const arcStartY = arcCy + arcRadius * Math.sin(startAngle);
        const arcEndX = arcCx + arcRadius * Math.cos(endAngle);
        const arcEndY = arcCy + arcRadius * Math.sin(endAngle);
        
        // Determine if it's a large arc (more than 180 degrees)
        let angleDiff = endAngle - startAngle;
        while (angleDiff < 0) angleDiff += 2 * Math.PI;
        while (angleDiff > 2 * Math.PI) angleDiff -= 2 * Math.PI;
        const largeArc = angleDiff > Math.PI ? 1 : 0;
        const sweep = 1; // Clockwise
        
        const pathD = `M ${arcStartX} ${arcStartY} A ${arcRadius} ${arcRadius} 0 ${largeArc} ${sweep} ${arcEndX} ${arcEndY}`;
        
        return (
          <path
            key={markup.id}
            d={pathD}
            stroke={markup.color}
            strokeWidth={markup.strokeWidth}
            fill="none"
          />
        );
      case 'arrow':
      case 'line':
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const arrowLen = 10 * (markup.strokeWidth || 2);
        const arrowAngle = Math.PI / 7;
        return (
          <g key={markup.id}>
            <line
              x1={x1}
              y1={y1}
              x2={markup.type === 'arrow' ? x2 - arrowLen * 0.7 * Math.cos(angle) : x2}
              y2={markup.type === 'arrow' ? y2 - arrowLen * 0.7 * Math.sin(angle) : y2}
              stroke={markup.color}
              strokeWidth={markup.strokeWidth}
            />
            {markup.type === 'arrow' && (
              <polygon
                points={`${x2},${y2} ${x2 - arrowLen * Math.cos(angle - arrowAngle)},${y2 - arrowLen * Math.sin(angle - arrowAngle)} ${x2 - arrowLen * Math.cos(angle + arrowAngle)},${y2 - arrowLen * Math.sin(angle + arrowAngle)}`}
                fill={markup.color}
              />
            )}
          </g>
        );
      case 'polyline':
      case 'polygon':
        const points = markup.points?.map(p => `${p.x * scaledW},${p.y * scaledH}`).join(' ') || '';
        if (markup.type === 'polygon') {
          return (
            <polygon
              key={markup.id}
              points={points}
              stroke={markup.color}
              strokeWidth={markup.strokeWidth}
              fill={markup.fillColor === 'none' ? 'transparent' : markup.fillColor}
              fillOpacity={markup.fillOpacity}
            />
          );
        }
        return (
          <polyline
            key={markup.id}
            points={points}
            stroke={markup.color}
            strokeWidth={markup.strokeWidth}
            fill="none"
          />
        );
      case 'text':
        return (
          <g key={markup.id}>
            <rect
              x={Math.min(x1, x2)}
              y={Math.min(y1, y2)}
              width={Math.abs(x2 - x1)}
              height={Math.abs(y2 - y1)}
              stroke={markup.color}
              strokeWidth={1}
              fill="white"
              fillOpacity={0.9}
            />
            <text
              x={(x1 + x2) / 2}
              y={(y1 + y2) / 2 + (markup.fontSize || 12) / 3}
              fontSize={markup.fontSize || 12}
              fill={markup.color}
              textAnchor="middle"
            >
              {markup.text || 'Text'}
            </text>
          </g>
        );
      case 'image':
        return (
          <image
            key={markup.id}
            href={markup.image}
            x={Math.min(x1, x2)}
            y={Math.min(y1, y2)}
            width={Math.abs(x2 - x1)}
            height={Math.abs(y2 - y1)}
            preserveAspectRatio="none"
            style={{ 
              transform: markup.rotation ? `rotate(${markup.rotation}deg)` : undefined,
              transformOrigin: 'center'
            }}
          />
        );
      default:
        return null;
    }
  };

  if (isLoading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="project-symbols-page">
      <header className="symbols-header">
        <button 
          className="back-btn"
          onClick={() => navigate(`/project/${projectId}`, { state: { returnToFile } })}
        >
          ← Back to Project
        </button>
        <h1>{project?.name} - Symbols</h1>
        <h1 className="brand-title">pidly</h1>
      </header>

      <div className="symbols-body">
        {/* Sidebar */}
        <div 
          className="symbols-sidebar" 
          style={{ width: sidebarWidth, minWidth: 200, maxWidth: 500, position: 'relative' }}
        >
          <div 
            className={`sidebar-item home-item ${selectedItem === 'home' ? 'selected' : ''}`}
            onClick={() => { 
              setSelectedItem('home'); 
              setSelectedPdf(null); 
              setPdfDoc(null); 
              setSelectedRegion(null); 
              setExtractedSymbol(null); 
              setTestingSymbol(null);
              setPlacedSymbols([]);
              setIsPlacingMode(false);
              setSymbolMarkups([]);
            }}
          >
            <span className="item-name">Overview</span>
          </div>

          <button 
            className={`create-symbol-btn ${selectedItem === 'create' ? 'selected' : ''}`}
            onClick={() => {
              setSelectedItem('create');
              setTestingSymbol(null);
              setPlacedSymbols([]);
              setIsPlacingMode(false);
            }}
          >
            + Create Symbol
          </button>

          <div className="symbols-section">
            <div className="symbols-section-header">
              <span className="section-title">Symbols Library</span>
              <span className="symbol-count">{symbols.length}</span>
            </div>
            
            <div className="symbols-search">
              <input
                type="text"
                placeholder="Search symbols..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            <div className="symbols-list">
              {Object.keys(symbolsByCategory).length === 0 ? (
                <p className="no-symbols">
                  {searchQuery ? 'No symbols found' : 'No symbols created yet'}
                </p>
              ) : (
                Object.entries(symbolsByCategory).map(([category, categorySymbols]) => (
                  <div key={category} className="symbol-category">
                    <div className="category-header">{category}</div>
                    {categorySymbols.map(symbol => (
                      <div
                        key={symbol.id}
                        className={`symbol-list-item ${selectedItem === symbol.id ? 'selected' : ''}`}
                        onClick={() => setSelectedItem(symbol.id)}
                      >
                        {symbol.preview ? (
                          symbol.preview.startsWith('<svg') ? (
                            <div 
                              className="symbol-thumbnail svg-thumb"
                              dangerouslySetInnerHTML={{ __html: symbol.preview }}
                            />
                          ) : (
                            <img src={symbol.preview} alt="" className="symbol-thumbnail" />
                          )
                        ) : (
                          <div className="symbol-thumbnail placeholder">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <rect x="3" y="3" width="18" height="18" rx="2" />
                            </svg>
                          </div>
                        )}
                        <div className="symbol-item-info">
                          <div className="symbol-item-name">{symbol.name}</div>
                          <div className="symbol-item-meta">
                            {symbol.markups?.length || symbol.paths?.length || 0} elements
                          </div>
                        </div>
                        <button
                          className="symbol-test-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            startTestingSymbol(symbol);
                          }}
                          title="Test/Place Symbol"
                        >
                          ▶
                        </button>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
          
          <div className="sidebar-resize-handle" onMouseDown={handleSidebarMouseDown} />
        </div>

        {/* Main Content */}
        <div className="symbols-main">
          {selectedItem === 'home' && (
            <div className="home-view">
              <div className="home-header">
                <h2>Symbol Library</h2>
                <p className="home-subtitle">Create reusable symbols from markups or PDF extractions</p>
              </div>
              
              <div className="home-stats-row">
                <div className="stat-card">
                  <div className="stat-number">{symbols.length}</div>
                  <div className="stat-label">Symbols</div>
                </div>
                <div className="stat-card">
                  <div className="stat-number">{Object.keys(symbolsByCategory).length}</div>
                  <div className="stat-label">Categories</div>
                </div>
                <div className="stat-card">
                  <div className="stat-number">{projectFiles.length}</div>
                  <div className="stat-label">Source PDFs</div>
                </div>
              </div>

              <div className="home-actions-section">
                <h3>Quick Actions</h3>
                <div className="home-actions-grid">
                  <div className="action-card" onClick={() => setSelectedItem('create')}>
                    <div className="action-row">
                      <div className="action-icon">✏️</div>
                      <div className="action-title">Create Symbol</div>
                    </div>
                    <div className="action-desc">Draw or extract a new symbol</div>
                  </div>
                  {symbols.length > 0 && (
                    <div className="action-card" onClick={() => startTestingSymbol(symbols[0])}>
                      <div className="action-row">
                        <div className="action-icon">📍</div>
                        <div className="action-title">Place Symbols</div>
                      </div>
                      <div className="action-desc">Add symbols to documents</div>
                    </div>
                  )}
                </div>
              </div>

              <div className="feature-preview">
                <h3>How It Works</h3>
                <div className="feature-steps">
                  <div className="feature-step">
                    <div className="step-number">1</div>
                    <div className="step-content">
                      <div className="step-title">Create Symbols</div>
                      <div className="step-desc">Draw using markup tools or extract from PDF regions</div>
                    </div>
                  </div>
                  <div className="feature-step">
                    <div className="step-number">2</div>
                    <div className="step-content">
                      <div className="step-title">Scale Preserved</div>
                      <div className="step-desc">Symbol dimensions are stored relative to PDF size</div>
                    </div>
                  </div>
                  <div className="feature-step">
                    <div className="step-number">3</div>
                    <div className="step-content">
                      <div className="step-title">Place as Markups</div>
                      <div className="step-desc">Symbols convert to editable markups when placed</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedItem === 'create' && (
            <div className="create-symbol-view">
              <div className="create-page-header">
                <h2>Create Symbol</h2>
                <div className="creation-mode-tabs">
                  <button 
                    className={`mode-tab ${creationMode === 'draw' ? 'active' : ''}`}
                    onClick={() => setCreationMode('draw')}
                  >
                    ✏️ Draw
                  </button>
                  <button 
                    className={`mode-tab ${creationMode === 'extract' ? 'active' : ''}`}
                    onClick={() => setCreationMode('extract')}
                  >
                    📷 Extract from PDF
                  </button>
                </div>
              </div>

              {/* PDF Selection */}
              <div className="pdf-selection-row">
                <label>Source PDF:</label>
                <div className="searchable-dropdown">
                  <input
                    type="text"
                    className="pdf-search-input"
                    placeholder={selectedPdf ? selectedPdf.name : 'Select or search PDF...'}
                    value={pdfSearchQuery !== null ? pdfSearchQuery : (selectedPdf?.name || '')}
                    onChange={(e) => setPdfSearchQuery(e.target.value)}
                    onFocus={() => setPdfSearchQuery('')}
                  />
                  {selectedPdf && (
                    <button className="clear-pdf-btn" onClick={() => { setSelectedPdf(null); setPdfDoc(null); }}>×</button>
                  )}
                  {pdfSearchQuery !== null && (
                    <div className="pdf-dropdown-list">
                      {filteredProjectFiles.length === 0 ? (
                        <div className="pdf-dropdown-empty">No PDFs found</div>
                      ) : (
                        filteredProjectFiles.map(file => (
                          <div
                            key={file.id}
                            className={`pdf-dropdown-item ${selectedPdf?.id === file.id ? 'selected' : ''}`}
                            onClick={() => handleSelectPdf(file)}
                          >
                            <div className="pdf-item-name">{file.name}</div>
                            <div className="pdf-item-folder">{file.folderName}</div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>

              {creationMode === 'draw' && (
                <div className="draw-mode-content">
                  {/* Markup Tools */}
                  <div className="markup-tools-row">
                    <span className="tools-label">Tools:</span>
                    <div className="markup-tools">
                      {MARKUP_TYPES.map(tool => (
                        <button
                          key={tool.id}
                          className={`markup-tool-btn ${activeMarkupType === tool.id ? 'active' : ''}`}
                          onClick={() => {
                            setActiveMarkupType(activeMarkupType === tool.id ? null : tool.id);
                            setPolylinePoints([]);
                          }}
                          title={tool.name}
                        >
                          <span className="tool-icon">{tool.icon}</span>
                        </button>
                      ))}
                    </div>
                    <div className="tool-properties">
                      <div className="prop-group">
                        <label>Color:</label>
                        <input 
                          type="color" 
                          value={markupColor} 
                          onChange={(e) => setMarkupColor(e.target.value)} 
                        />
                      </div>
                      <div className="prop-group">
                        <label>Fill:</label>
                        <input 
                          type="color" 
                          value={markupFillColor === 'none' ? '#ffffff' : markupFillColor} 
                          onChange={(e) => setMarkupFillColor(e.target.value)} 
                        />
                        <button 
                          className={`no-fill-btn ${markupFillColor === 'none' ? 'active' : ''}`}
                          onClick={() => setMarkupFillColor(markupFillColor === 'none' ? markupColor : 'none')}
                          title="Toggle fill"
                        >
                          ∅
                        </button>
                      </div>
                      <div className="prop-group">
                        <label>Stroke:</label>
                        <input 
                          type="range" 
                          min="1" 
                          max="10" 
                          value={markupStrokeWidth} 
                          onChange={(e) => setMarkupStrokeWidth(parseInt(e.target.value))} 
                        />
                        <span>{markupStrokeWidth}px</span>
                      </div>
                    </div>
                  </div>

                  {activeMarkupType === 'text' && (
                    <div className="text-input-row">
                      <label>Text:</label>
                      <input
                        type="text"
                        value={markupText}
                        onChange={(e) => setMarkupText(e.target.value)}
                        placeholder="Enter text..."
                      />
                      <label>Size:</label>
                      <input
                        type="number"
                        min="8"
                        max="72"
                        value={markupFontSize}
                        onChange={(e) => setMarkupFontSize(parseInt(e.target.value))}
                      />
                    </div>
                  )}

                  {(activeMarkupType === 'polyline' || activeMarkupType === 'polygon') && polylinePoints.length > 0 && (
                    <div className="polyline-controls">
                      <span>{polylinePoints.length} points</span>
                      <button onClick={completePolyline} disabled={polylinePoints.length < 2}>
                        Complete {activeMarkupType === 'polygon' ? 'Polygon' : 'Polyline'}
                      </button>
                      <button onClick={cancelPolyline}>Cancel</button>
                    </div>
                  )}
                </div>
              )}

              {creationMode === 'extract' && (
                <div className="extract-mode-content">
                  <div className="extract-instructions">
                    Draw a rectangle on the PDF to select a region to extract
                  </div>
                  <div className="extraction-settings">
                    <div className="setting-row">
                      <label>Threshold:</label>
                      <input 
                        type="range" 
                        min="50" 
                        max="200" 
                        value={extractionSettings.threshold}
                        onChange={(e) => setExtractionSettings(s => ({ ...s, threshold: parseInt(e.target.value) }))}
                      />
                      <span>{extractionSettings.threshold}</span>
                    </div>
                    <div className="setting-row">
                      <label>Simplify:</label>
                      <input 
                        type="range" 
                        min="1" 
                        max="10" 
                        value={extractionSettings.simplifyTolerance}
                        onChange={(e) => setExtractionSettings(s => ({ ...s, simplifyTolerance: parseInt(e.target.value) }))}
                      />
                      <span>{extractionSettings.simplifyTolerance}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Canvas Area */}
              {selectedPdf && pdfDoc ? (
                <div className="extraction-workspace">
                  <div className="pdf-viewer-section">
                    <div className="pdf-viewer-header">
                      <span className="page-info">Page {currentPage} / {numPages}</span>
                      <div className="page-nav">
                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}>←</button>
                        <button onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))} disabled={currentPage >= numPages}>→</button>
                      </div>
                      <div className="zoom-controls">
                        <button onClick={handleZoomOut}>−</button>
                        <span>{Math.round(scale * 100)}%</span>
                        <button onClick={handleZoomIn}>+</button>
                      </div>
                    </div>
                    
                    <div 
                      className="pdf-canvas-container"
                      ref={containerRef}
                      style={{ cursor: isPanning ? 'grabbing' : (activeMarkupType ? 'crosshair' : 'default') }}
                    >
                      <div 
                        className="canvas-wrapper"
                        style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)` }}
                        onMouseDown={handleCanvasMouseDown}
                        onMouseMove={handleCanvasMouseMove}
                        onMouseUp={handleCanvasMouseUp}
                        onMouseLeave={handleCanvasMouseUp}
                      >
                        <canvas ref={canvasRef} className="pdf-canvas" />
                        
                        {/* SVG overlay for markups and selections */}
                        <svg 
                          className="markup-overlay"
                          width={canvasSize.width}
                          height={canvasSize.height}
                          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
                        >
                          {/* Selection rectangle (extract mode) */}
                          {creationMode === 'extract' && currentRect && (
                            <rect
                              x={currentRect.x}
                              y={currentRect.y}
                              width={currentRect.width}
                              height={currentRect.height}
                              fill="rgba(52, 152, 219, 0.2)"
                              stroke="#3498db"
                              strokeWidth="2"
                              strokeDasharray="5,5"
                            />
                          )}
                          
                          {/* Selected region highlight */}
                          {selectedRegion && (
                            <rect
                              x={selectedRegion.x * canvasSize.width}
                              y={selectedRegion.y * canvasSize.height}
                              width={selectedRegion.width * canvasSize.width}
                              height={selectedRegion.height * canvasSize.height}
                              fill="rgba(46, 204, 113, 0.2)"
                              stroke="#2ecc71"
                              strokeWidth="2"
                            />
                          )}
                          
                          {/* Symbol markups being created */}
                          {creationMode === 'draw' && symbolMarkups.map(m => 
                            renderMarkupSVG(m, canvasSize.width, canvasSize.height)
                          )}
                          
                          {/* Current markup being drawn */}
                          {currentMarkup && renderMarkupSVG(currentMarkup, canvasSize.width, canvasSize.height)}
                          
                          {/* Polyline preview */}
                          {polylinePoints.length > 0 && (
                            <polyline
                              points={polylinePoints.map(p => `${p.x * canvasSize.width},${p.y * canvasSize.height}`).join(' ')}
                              stroke={markupColor}
                              strokeWidth={markupStrokeWidth}
                              fill="none"
                              strokeDasharray="5,5"
                            />
                          )}
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* Symbol Creation Panel */}
                  <div className="creation-panel">
                    <h3>Symbol Details</h3>
                    
                    <div className="symbol-name-input">
                      <label>Name:</label>
                      <input
                        type="text"
                        value={symbolName}
                        onChange={(e) => setSymbolName(e.target.value)}
                        placeholder="Enter symbol name..."
                      />
                    </div>
                    
                    <div className="symbol-category-input">
                      <label>Category:</label>
                      <input
                        type="text"
                        value={symbolCategory}
                        onChange={(e) => setSymbolCategory(e.target.value)}
                        placeholder="e.g., Valves, Instruments..."
                        list="existing-categories"
                      />
                      <datalist id="existing-categories">
                        {[...new Set(symbols.map(s => s.category).filter(Boolean))].map(cat => (
                          <option key={cat} value={cat} />
                        ))}
                      </datalist>
                    </div>

                    {creationMode === 'draw' && (
                      <div className="markups-list">
                        <h4>Elements ({symbolMarkups.length})</h4>
                        {symbolMarkups.map(m => (
                          <div 
                            key={m.id} 
                            className={`markup-item ${selectedSymbolMarkup === m.id ? 'selected' : ''}`}
                            onClick={() => setSelectedSymbolMarkup(m.id)}
                          >
                            <span className="markup-type">{m.type}</span>
                            <button 
                              className="delete-markup-btn"
                              onClick={(e) => { e.stopPropagation(); deleteSymbolMarkup(m.id); }}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        {symbolMarkups.length === 0 && (
                          <p className="no-markups">Draw shapes to add to symbol</p>
                        )}
                      </div>
                    )}

                    {creationMode === 'extract' && selectedRegion && !isEditingSymbol && (
                      <div className="extraction-preview">
                        <button 
                          className="extract-btn"
                          onClick={captureRegion}
                          disabled={isExtracting}
                        >
                          {isExtracting ? 'Capturing...' : 'Capture Region'}
                        </button>
                      </div>
                    )}

                    <div className="creation-actions">
                      {creationMode === 'draw' && symbolMarkups.length > 0 && (
                        <button className="save-symbol-btn" onClick={createSymbolFromMarkups}>
                          💾 Save Symbol
                        </button>
                      )}
                      <button 
                        className="clear-btn"
                        onClick={() => {
                          setSymbolMarkups([]);
                          setSelectedRegion(null);
                          setExtractedSymbol(null);
                          setCapturedImage(null);
                          setIsEditingSymbol(false);
                          setPolylinePoints([]);
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="no-pdf-selected">
                  <div className="empty-icon">📄</div>
                  <p>Select a PDF to start creating symbols</p>
                </div>
              )}
            </div>
          )}

          {selectedItem === 'test' && testingSymbol && (
            <div className="test-symbol-view">
              <div className="test-page-header">
                <h2>Place Symbol: {testingSymbol.name}</h2>
                <button 
                  className="back-to-symbol-btn"
                  onClick={() => {
                    setSelectedItem(testingSymbol.id);
                    setTestingSymbol(null);
                    setPlacedSymbols([]);
                    setIsPlacingMode(false);
                  }}
                >
                  ← Back
                </button>
              </div>

              {/* PDF Selection for testing */}
              <div className="pdf-selection-row">
                <label>Target PDF:</label>
                <div className="searchable-dropdown">
                  <input
                    type="text"
                    className="pdf-search-input"
                    placeholder={selectedPdf ? selectedPdf.name : 'Select PDF...'}
                    value={pdfSearchQuery !== null ? pdfSearchQuery : (selectedPdf?.name || '')}
                    onChange={(e) => setPdfSearchQuery(e.target.value)}
                    onFocus={() => setPdfSearchQuery('')}
                  />
                  {selectedPdf && (
                    <button className="clear-pdf-btn" onClick={() => { setSelectedPdf(null); setPdfDoc(null); }}>×</button>
                  )}
                  {pdfSearchQuery !== null && (
                    <div className="pdf-dropdown-list">
                      {filteredProjectFiles.length === 0 ? (
                        <div className="pdf-dropdown-empty">No PDFs found</div>
                      ) : (
                        filteredProjectFiles.map(file => (
                          <div
                            key={file.id}
                            className={`pdf-dropdown-item ${selectedPdf?.id === file.id ? 'selected' : ''}`}
                            onClick={() => handleSelectPdf(file)}
                          >
                            <div className="pdf-item-name">{file.name}</div>
                            <div className="pdf-item-folder">{file.folderName}</div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>

              {selectedPdf && pdfDoc ? (
                <div className="test-workspace">
                  <div className="pdf-viewer-section">
                    <div className="pdf-viewer-header">
                      <span className="page-info">Page {currentPage} / {numPages}</span>
                      <div className="page-nav">
                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}>←</button>
                        <button onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))} disabled={currentPage >= numPages}>→</button>
                      </div>
                      <div className="zoom-controls">
                        <button onClick={handleZoomOut}>−</button>
                        <span>{Math.round(scale * 100)}%</span>
                        <button onClick={handleZoomIn}>+</button>
                      </div>
                    </div>
                    
                    <div 
                      className="pdf-canvas-container"
                      ref={testContainerRef}
                      style={{ cursor: isPanning ? 'grabbing' : (isPlacingMode ? 'crosshair' : 'default') }}
                    >
                      <div 
                        className="canvas-wrapper"
                        style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)` }}
                        onMouseDown={handleCanvasMouseDown}
                        onMouseMove={handleCanvasMouseMove}
                        onMouseUp={handleCanvasMouseUp}
                        onMouseLeave={handleCanvasMouseUp}
                      >
                        <canvas ref={canvasRef} className="pdf-canvas" />
                        
                        {/* Placed symbols and editable markups overlay */}
                        <svg 
                          className="placement-overlay"
                          width={canvasSize.width}
                          height={canvasSize.height}
                          style={{ position: 'absolute', top: 0, left: 0 }}
                        >
                          {/* Legacy placed symbols (grouped) */}
                          {placedSymbols
                            .filter(p => p.page === currentPage)
                            .map(placement => {
                              const symbol = placement.symbol;
                              const symW = (symbol.originalWidth || 0.1) * placement.scale;
                              const symH = (symbol.originalHeight || 0.1) * placement.scale;
                              const offsetX = placement.x - symW / 2;
                              const offsetY = placement.y - symH / 2;
                              
                              return (
                                <g 
                                  key={placement.id}
                                  style={{ pointerEvents: 'all', cursor: 'pointer' }}
                                  onClick={() => removePlacedSymbol(placement.id)}
                                  transform={placement.rotation ? `rotate(${placement.rotation}, ${placement.x * canvasSize.width}, ${placement.y * canvasSize.height})` : undefined}
                                >
                                  {symbol.markups?.map((m, idx) => {
                                    const transformed = {
                                      ...m,
                                      id: `${placement.id}_${idx}`,
                                      color: placement.color || m.color,
                                      strokeWidth: placement.strokeWidth || m.strokeWidth,
                                      startX: offsetX + (m.startX || 0) * symW,
                                      startY: offsetY + (m.startY || 0) * symH,
                                      endX: offsetX + (m.endX || 1) * symW,
                                      endY: offsetY + (m.endY || 1) * symH,
                                      points: m.points?.map(p => ({
                                        x: offsetX + p.x * symW,
                                        y: offsetY + p.y * symH
                                      }))
                                    };
                                    return renderMarkupSVG(transformed, canvasSize.width, canvasSize.height);
                                  })}
                                  {/* If symbol has paths (vectorized) */}
                                  {!symbol.markups && symbol.paths?.map((path, idx) => (
                                    <polyline
                                      key={idx}
                                      points={path.points.map(p => 
                                        `${(offsetX + p.x * symW) * canvasSize.width},${(offsetY + p.y * symH) * canvasSize.height}`
                                      ).join(' ')}
                                      fill={path.closed ? (placement.color || '#3498db') : 'none'}
                                      fillOpacity={0.2}
                                      stroke={placement.color || '#3498db'}
                                      strokeWidth={placement.strokeWidth}
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  ))}
                                </g>
                              );
                            })}
                          
                          {/* Editable markups (individual, selectable) */}
                          {editableMarkups
                            .filter(m => m.page === currentPage)
                            .map(m => (
                              <g 
                                key={m.id}
                                style={{ pointerEvents: 'all', cursor: selectedEditableMarkup?.id === m.id ? 'move' : 'pointer' }}
                                data-markup-id={m.id}
                              >
                                {renderMarkupSVG(m, canvasSize.width, canvasSize.height)}
                              </g>
                            ))}
                          
                          {/* Selection handles for selected markup */}
                          {selectedEditableMarkup && selectedEditableMarkup.page === currentPage && (() => {
                            const m = selectedEditableMarkup;
                            const minX = Math.min(m.startX, m.endX) * canvasSize.width;
                            const maxX = Math.max(m.startX, m.endX) * canvasSize.width;
                            const minY = Math.min(m.startY, m.endY) * canvasSize.height;
                            const maxY = Math.max(m.startY, m.endY) * canvasSize.height;
                            const midX = (minX + maxX) / 2;
                            const midY = (minY + maxY) / 2;
                            const handleSize = 8;
                            
                            const handles = [
                              { name: 'nw', x: minX, y: minY, cursor: 'nw-resize' },
                              { name: 'n', x: midX, y: minY, cursor: 'n-resize' },
                              { name: 'ne', x: maxX, y: minY, cursor: 'ne-resize' },
                              { name: 'e', x: maxX, y: midY, cursor: 'e-resize' },
                              { name: 'se', x: maxX, y: maxY, cursor: 'se-resize' },
                              { name: 's', x: midX, y: maxY, cursor: 's-resize' },
                              { name: 'sw', x: minX, y: maxY, cursor: 'sw-resize' },
                              { name: 'w', x: minX, y: midY, cursor: 'w-resize' },
                            ];
                            
                            return (
                              <g className="selection-handles">
                                {/* Selection border */}
                                <rect
                                  x={minX}
                                  y={minY}
                                  width={maxX - minX}
                                  height={maxY - minY}
                                  fill="none"
                                  stroke="#3498db"
                                  strokeWidth="1"
                                  strokeDasharray="4,4"
                                  pointerEvents="none"
                                />
                                {/* Resize handles */}
                                {handles.map(h => (
                                  <rect
                                    key={h.name}
                                    x={h.x - handleSize / 2}
                                    y={h.y - handleSize / 2}
                                    width={handleSize}
                                    height={handleSize}
                                    fill="#fff"
                                    stroke="#3498db"
                                    strokeWidth="1"
                                    style={{ cursor: h.cursor, pointerEvents: 'all' }}
                                    data-handle={h.name}
                                  />
                                ))}
                              </g>
                            );
                          })()}
                        </svg>
                      </div>
                      
                      <div className="canvas-instructions">
                        {selectedEditableMarkup 
                          ? 'Drag to move • Handles to resize • Press Delete to remove'
                          : isPlacingMode 
                            ? 'Click to place symbol as editable markups' 
                            : 'Click markup to select and edit'}
                      </div>
                    </div>
                  </div>

                  {/* Placement Controls */}
                  <div className="placement-panel">
                    <h3>Placement Settings</h3>
                    
                    <div className="placement-symbol-preview">
                      {testingSymbol.preview?.startsWith('<svg') ? (
                        <div 
                          className="preview-svg"
                          dangerouslySetInnerHTML={{ __html: testingSymbol.preview }}
                        />
                      ) : testingSymbol.preview ? (
                        <img src={testingSymbol.preview} alt="Symbol" className="preview-img" />
                      ) : (
                        <div className="preview-placeholder">No preview</div>
                      )}
                    </div>

                    <div className="setting-row">
                      <label>Scale:</label>
                      <input 
                        type="range" 
                        min="0.25" 
                        max="4" 
                        step="0.1"
                        value={placementSettings.scale}
                        onChange={(e) => setPlacementSettings(s => ({ ...s, scale: parseFloat(e.target.value) }))}
                      />
                      <span className="setting-value">{placementSettings.scale.toFixed(2)}x</span>
                    </div>
                    
                    <div className="setting-row">
                      <label>Rotation:</label>
                      <input 
                        type="range" 
                        min="0" 
                        max="360" 
                        step="15"
                        value={placementSettings.rotation}
                        onChange={(e) => setPlacementSettings(s => ({ ...s, rotation: parseInt(e.target.value) }))}
                      />
                      <span className="setting-value">{placementSettings.rotation}°</span>
                    </div>
                    
                    <div className="setting-row">
                      <label>Stroke:</label>
                      <input 
                        type="range" 
                        min="1" 
                        max="8" 
                        step="0.5"
                        value={placementSettings.strokeWidth}
                        onChange={(e) => setPlacementSettings(s => ({ ...s, strokeWidth: parseFloat(e.target.value) }))}
                      />
                      <span className="setting-value">{placementSettings.strokeWidth}px</span>
                    </div>
                    
                    <div className="setting-row color-row">
                      <label>Override Color:</label>
                      <label className="checkbox-label">
                        <input 
                          type="checkbox"
                          checked={!placementSettings.preserveColors}
                          onChange={(e) => setPlacementSettings(s => ({ ...s, preserveColors: !e.target.checked }))}
                        />
                        <span>Custom</span>
                      </label>
                      <input 
                        type="color" 
                        value={placementSettings.color}
                        onChange={(e) => setPlacementSettings(s => ({ ...s, color: e.target.value, preserveColors: false }))}
                        disabled={placementSettings.preserveColors}
                      />
                    </div>

                    {/* Quick color presets for faster workflow */}
                    <div className="setting-row color-presets-row">
                      <label>Quick Colors:</label>
                      <div className="color-presets">
                        {['#000000', '#ff0000', '#0000ff', '#00aa00', '#ff6600', '#9900cc', '#00aaaa'].map(color => (
                          <button
                            key={color}
                            className={`color-preset-btn ${placementSettings.color === color && !placementSettings.preserveColors ? 'active' : ''}`}
                            style={{ backgroundColor: color }}
                            onClick={() => setPlacementSettings(s => ({ ...s, color: color, preserveColors: false }))}
                            title={color}
                          />
                        ))}
                        <button
                          className={`color-preset-btn original ${placementSettings.preserveColors ? 'active' : ''}`}
                          onClick={() => setPlacementSettings(s => ({ ...s, preserveColors: true }))}
                          title="Original color"
                        >
                          ○
                        </button>
                      </div>
                    </div>
                    
                    <div className="setting-row">
                      <label>Convert to Editable:</label>
                      <label className="checkbox-label">
                        <input 
                          type="checkbox"
                          checked={placementSettings.autoConvert}
                          onChange={(e) => setPlacementSettings(s => ({ ...s, autoConvert: e.target.checked }))}
                        />
                        <span>{placementSettings.autoConvert ? 'Individual Markups' : 'Grouped Symbol'}</span>
                      </label>
                    </div>

                    <div className="placement-mode-toggle">
                      <button 
                        className={`mode-btn ${isPlacingMode ? 'active' : ''}`}
                        onClick={() => setIsPlacingMode(!isPlacingMode)}
                      >
                        {isPlacingMode ? '✓ Placing Mode ON' : 'Enable Placing Mode'}
                      </button>
                    </div>

                    {/* Editable Markups Section */}
                    <div className="editable-markups-section">
                      <h4>Placed Markups ({editableMarkups.filter(m => m.page === currentPage).length})</h4>
                      
                      {selectedEditableMarkup && (
                        <div className="selected-markup-props">
                          <div className="prop-row">
                            <label>Type:</label>
                            <span className="prop-value">{selectedEditableMarkup.type}</span>
                          </div>
                          <div className="prop-row">
                            <label>Color:</label>
                            <input 
                              type="color" 
                              value={selectedEditableMarkup.color || '#ff0000'}
                              onChange={(e) => updateMarkupProperty('color', e.target.value)}
                            />
                          </div>
                          <div className="prop-row">
                            <label>Stroke:</label>
                            <input 
                              type="range" 
                              min="1" 
                              max="10" 
                              value={selectedEditableMarkup.strokeWidth || 2}
                              onChange={(e) => updateMarkupProperty('strokeWidth', parseInt(e.target.value))}
                            />
                            <span>{selectedEditableMarkup.strokeWidth || 2}px</span>
                          </div>
                          {selectedEditableMarkup.fillColor && selectedEditableMarkup.fillColor !== 'none' && (
                            <div className="prop-row">
                              <label>Fill:</label>
                              <input 
                                type="color" 
                                value={selectedEditableMarkup.fillColor}
                                onChange={(e) => updateMarkupProperty('fillColor', e.target.value)}
                              />
                            </div>
                          )}
                          <button 
                            className="delete-markup-btn"
                            onClick={() => deleteEditableMarkup(selectedEditableMarkup.id)}
                          >
                            🗑 Delete Markup
                          </button>
                        </div>
                      )}
                      
                      {editableMarkups.length === 0 && !selectedEditableMarkup && (
                        <p className="no-markups-hint">Place symbols to create editable markups</p>
                      )}
                    </div>

                    <div className="placed-count">
                      <span>{editableMarkups.filter(m => m.page === currentPage).length} markups on page</span>
                      <span>({editableMarkups.length} total)</span>
                    </div>

                    {editableMarkups.length > 0 && (
                      <>
                        <button className="export-markups-btn" onClick={() => {
                          console.log('Editable markups:', editableMarkups);
                          alert(`Exported ${editableMarkups.length} markup(s). Check console for data.`);
                        }}>
                          📤 Export Markups
                        </button>
                        <button className="clear-all-btn" onClick={() => {
                          setEditableMarkups([]);
                          setSelectedEditableMarkup(null);
                        }}>
                          Clear All Markups
                        </button>
                      </>
                    )}

                    {placedSymbols.length > 0 && (
                      <div className="legacy-symbols-section">
                        <h4>Grouped Symbols ({placedSymbols.length})</h4>
                        <button className="clear-all-btn" onClick={clearPlacedSymbols}>
                          Clear Grouped
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="no-pdf-selected">
                  <div className="empty-icon">📄</div>
                  <p>Select a PDF to place symbols</p>
                </div>
              )}
            </div>
          )}

          {/* Symbol Details View */}
          {selectedItem !== 'home' && selectedItem !== 'create' && selectedItem !== 'test' && (() => {
            const symbol = symbols.find(s => s.id === selectedItem);
            if (!symbol) return <div className="symbol-details"><p>Symbol not found</p></div>;
            
            return (
              <div className="symbol-details">
                <h2>{symbol.name}</h2>
                {symbol.category && <div className="symbol-category-badge">{symbol.category}</div>}
                
                <div className="symbol-detail-preview">
                  {symbol.preview?.startsWith('<svg') ? (
                    <div 
                      className="symbol-detail-svg"
                      dangerouslySetInnerHTML={{ __html: symbol.preview }}
                    />
                  ) : symbol.preview ? (
                    <img src={symbol.preview} alt="Symbol" className="symbol-detail-img" />
                  ) : (
                    <div className="symbol-placeholder">No preview</div>
                  )}
                </div>
                
                <div className="symbol-detail-stats">
                  <div className="detail-stat">
                    <span className="stat-label">Type:</span>
                    <span className="stat-value">{symbol.type === 'image' ? 'Bitmap Image' : 'Vector'}</span>
                  </div>
                  {symbol.type !== 'image' && (
                    <div className="detail-stat">
                      <span className="stat-label">Elements:</span>
                      <span className="stat-value">{symbol.markups?.length || symbol.paths?.length || 0}</span>
                    </div>
                  )}
                  {symbol.width && symbol.height && (
                    <div className="detail-stat">
                      <span className="stat-label">Size:</span>
                      <span className="stat-value">{symbol.width}×{symbol.height} px</span>
                    </div>
                  )}
                  <div className="detail-stat">
                    <span className="stat-label">Aspect Ratio:</span>
                    <span className="stat-value">{symbol.aspectRatio?.toFixed(2) || 'N/A'}</span>
                  </div>
                  {symbol.createdAt && (
                    <div className="detail-stat">
                      <span className="stat-label">Created:</span>
                      <span className="stat-value">{new Date(symbol.createdAt).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
                
                <div className="symbol-actions">
                  <button 
                    className="test-symbol-btn"
                    onClick={() => startTestingSymbol(symbol)}
                  >
                    📍 Place Symbol
                  </button>
                  <button 
                    className="delete-symbol-btn"
                    onClick={() => deleteSymbol(symbol.id)}
                  >
                    🗑 Delete
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Cleanup Editor Modal */}
      {isEditingSymbol && capturedImage && (
        <div className="cleanup-modal-overlay" onClick={cancelEditing}>
          <div className="cleanup-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cleanup-modal-header">
              <h3>Edit Symbol</h3>
              <button className="close-modal-btn" onClick={cancelEditing}>×</button>
            </div>
            
            <div className="cleanup-modal-body">
              {/* Large Preview Canvas */}
              <div className="cleanup-canvas-container">
                <canvas 
                  ref={editCanvasRef}
                  width={capturedImage.width}
                  height={capturedImage.height}
                  className="cleanup-canvas"
                  onMouseDown={handleEditCanvasMouseDown}
                  onMouseMove={handleEditCanvasMouseMove}
                  onMouseUp={handleEditCanvasMouseUp}
                  onMouseLeave={handleEditCanvasMouseUp}
                  style={{ cursor: editTool === 'eraser' || editTool === 'fill' ? 'crosshair' : 'default' }}
                />
              </div>
              
              {/* Tools Panel */}
              <div className="cleanup-tools-panel">
                {/* Symbol Name */}
                <div className="tool-section">
                  <label>Symbol Name:</label>
                  <input 
                    type="text"
                    value={symbolName}
                    onChange={(e) => setSymbolName(e.target.value)}
                    placeholder="Enter name..."
                    className="symbol-name-input"
                  />
                </div>

                {/* Drawing Tools */}
                <div className="tool-section">
                  <label>Tools:</label>
                  <div className="tool-buttons">
                    <button 
                      className={`tool-btn ${editTool === 'eraser' ? 'active' : ''}`}
                      onClick={() => setEditTool('eraser')}
                      title="Eraser - paint to remove"
                    >
                      🧹 Eraser
                    </button>
                    <button 
                      className={`tool-btn ${editTool === 'fill' ? 'active' : ''}`}
                      onClick={() => setEditTool('fill')}
                      title="Fill with white"
                    >
                      ⬜ Fill White
                    </button>
                  </div>
                </div>
                
                {(editTool === 'eraser' || editTool === 'fill') && (
                  <div className="tool-section">
                    <label>Brush Size: {editBrushSize}px</label>
                    <input 
                      type="range" 
                      min="2" 
                      max="50" 
                      value={editBrushSize}
                      onChange={(e) => setEditBrushSize(parseInt(e.target.value))}
                    />
                  </div>
                )}
                
                {/* Quick Actions */}
                <div className="tool-section">
                  <label>Quick Actions:</label>
                  <div className="cleanup-actions-grid">
                    <button onClick={() => removeBackground(240)} title="Make white pixels transparent">
                      🔲 Remove BG
                    </button>
                    <button onClick={() => removeNoise(200)} title="Convert to black & white">
                      ✨ Threshold
                    </button>
                    <button onClick={() => removeSpecks(30)} title="Remove small specks">
                      🧹 Remove Specks
                    </button>
                    <button onClick={invertColors} title="Invert colors">
                      🔄 Invert
                    </button>
                    <button onClick={trimTransparent} title="Crop to content">
                      ✂️ Trim
                    </button>
                    <button onClick={resetToOriginal} title="Reset to original">
                      ↩️ Reset
                    </button>
                  </div>
                </div>
                
                {/* Recolor */}
                <div className="tool-section">
                  <label>Recolor:</label>
                  <div className="recolor-row">
                    <input 
                      type="color" 
                      value={symbolColor}
                      onChange={(e) => setSymbolColor(e.target.value)}
                      className="color-picker-large"
                    />
                    <button 
                      className="apply-color-btn"
                      onClick={() => recolorSymbol(symbolColor)}
                    >
                      Apply
                    </button>
                  </div>
                  <div className="preset-colors-large">
                    {['#000000', '#ff0000', '#0000ff', '#00aa00', '#ff6600', '#9900cc', '#00cccc', '#cc00cc'].map(color => (
                      <button
                        key={color}
                        className="preset-color-large"
                        style={{ backgroundColor: color }}
                        onClick={() => {
                          setSymbolColor(color);
                          recolorSymbol(color);
                        }}
                        title={color}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Modal Footer */}
            <div className="cleanup-modal-footer">
              <button className="cancel-btn" onClick={cancelEditing}>
                Cancel
              </button>
              <button className="save-symbol-btn" onClick={saveEditedSymbol}>
                💾 Save Symbol
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
