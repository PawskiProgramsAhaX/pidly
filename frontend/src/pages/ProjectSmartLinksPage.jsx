import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getProject, saveProject, getModels, deleteModel, getPdfFromBackend, trainDetector, getThumbnail, runDetection, saveModel } from '../utils/storage';
import { BACKEND_URL, DETECTOR_URL } from '../utils/config';
import './ProjectSmartLinksPage.css';

export default function ProjectSmartLinksPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnToFile = location.state?.returnToFile || null;
  const [project, setProject] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [models, setModels] = useState([]);
  const [selectedItem, setSelectedItem] = useState('home'); // 'home', 'links', 'train', or model id
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  
  // Models section height state
  const [modelsSectionHeight, setModelsSectionHeight] = useState(() => {
    const saved = localStorage.getItem('smartlinks_modelsSectionHeight');
    return saved ? parseInt(saved, 10) : 200; // Default 200px
  });
  const [isResizingModels, setIsResizingModels] = useState(false);
  const modelsResizeStartY = useRef(0);
  const modelsResizeStartHeight = useRef(0);
  
  // PDF selection state
  const [projectFiles, setProjectFiles] = useState([]);
  const [selectedPdf, setSelectedPdf] = useState(null);
  const [pdfSearchQuery, setPdfSearchQuery] = useState('');
  const [showPdfDropdown, setShowPdfDropdown] = useState(false);
  const pdfDropdownRef = useRef(null);
  
  // PDF viewer state
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [isRendering, setIsRendering] = useState(false);
  
  // Pan state
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  
  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState(null);
  const [currentRect, setCurrentRect] = useState(null);
  const [trainingBoxes, setTrainingBoxes] = useState([]);
  
  // Pending shape confirmation
  const [pendingShape, setPendingShape] = useState(null);
  const [activeResizeHandle, setActiveResizeHandle] = useState(null);
  
  // Training state
  const [modelName, setModelName] = useState('');
  const [isTraining, setIsTraining] = useState(false);
  
  // Test model state
  const [showTestPanel, setShowTestPanel] = useState(false);
  const [testConfidence, setTestConfidence] = useState(0.7);
  const [testOcrFormat, setTestOcrFormat] = useState('');
  const [testResults, setTestResults] = useState([]);
  const [isTesting, setIsTesting] = useState(false);
  const [testModelId, setTestModelId] = useState(null);
  
  // Template viewing state
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateImages, setTemplateImages] = useState([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  
  // Model editing state
  const [editConfidence, setEditConfidence] = useState(0.7);
  const [editOcrFormat, setEditOcrFormat] = useState('');
  const [editAssignmentMode, setEditAssignmentMode] = useState('link'); // 'link' or 'property'
  const [editPropertyTemplateId, setEditPropertyTemplateId] = useState('');
  const [editPropertyName, setEditPropertyName] = useState('');
  
  // Links view state
  const [linkThumbnails, setLinkThumbnails] = useState({});
  const [loadingLinkThumbnails, setLoadingLinkThumbnails] = useState({});
  const [linkFilters, setLinkFilters] = useState({});
  const [linkColumnWidths, setLinkColumnWidths] = useState({});
  const [resizingColumn, setResizingColumn] = useState(null);
  const tableRef = useRef(null);
  
  // Find and replace state
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [findField, setFindField] = useState('label'); // Which field to search in
  const [matchCase, setMatchCase] = useState(false);
  
  // Import/Export state
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importData, setImportData] = useState(null);
  const [importError, setImportError] = useState(null);
  const [importMode, setImportMode] = useState('merge');
  const linksFileInputRef = useRef(null);
  
  // Reassign orphaned links state
  const [showReassignDialog, setShowReassignDialog] = useState(false);
  const [reassignSourceFile, setReassignSourceFile] = useState(null); // original filename of deleted file
  const [reassignTargetFile, setReassignTargetFile] = useState(null); // file object to reassign to
  const [isReassigning, setIsReassigning] = useState(false);
  const [showOrphanedPanel, setShowOrphanedPanel] = useState(false);
  
  // Reassign broken links state (target file deleted)
  const [showBrokenPanel, setShowBrokenPanel] = useState(false);
  const [showBrokenReassignDialog, setShowBrokenReassignDialog] = useState(false);
  const [brokenReassignOldTarget, setBrokenReassignOldTarget] = useState(null); // deleted target file ID
  const [brokenReassignNewTarget, setBrokenReassignNewTarget] = useState(null); // new target file object
  
  // Individual link target reassignment state
  const [showLinkReassignDialog, setShowLinkReassignDialog] = useState(false);
  const [linkToReassign, setLinkToReassign] = useState(null);
  const [newTargetFileId, setNewTargetFileId] = useState('');
  
  // Label edit dialog state
  const [showLabelEditDialog, setShowLabelEditDialog] = useState(false);
  const [labelEditLink, setLabelEditLink] = useState(null);
  const [labelEditValue, setLabelEditValue] = useState('');
  
  // Default column widths for links table
  const defaultLinkColumnWidths = {
    label: 200,
    source: 200,
    target: 200,
    targetLinkNumber: 150,
    assignedType: 200,
    status: 120
  };
  
  // Column alignments state
  const [linkColumnAlignments, setLinkColumnAlignments] = useState({});
  
  // Get column alignment (default: center)
  const getLinkColumnAlignment = (columnId) => {
    return linkColumnAlignments[columnId] || 'center';
  };
  
  // Toggle column alignment (left -> center -> right -> left)
  const toggleLinkColumnAlignment = (columnId) => {
    const currentAlign = getLinkColumnAlignment(columnId);
    const nextAlign = currentAlign === 'left' ? 'center' : currentAlign === 'center' ? 'right' : 'left';
    setLinkColumnAlignments(prev => ({
      ...prev,
      [columnId]: nextAlign
    }));
  };
  
  // Get column width
  const getLinkColumnWidth = (columnId) => {
    return linkColumnWidths[columnId] || defaultLinkColumnWidths[columnId] || 150;
  };

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
          sourceFolder: file.sourceFolder || null,
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

  // Load project and models
  useEffect(() => {
    const loadData = async () => {
      try {
        const loadedProject = await getProject(projectId);
        setProject(loadedProject);
        
        if (loadedProject) {
          // Get files from folders
          const folderFiles = extractAllFiles(loadedProject.folders);
          
          // Get root-level files (files not in any folder)
          const rootFiles = (loadedProject.files || []).map(file => ({
            id: file.id,
            name: file.name,
            backendFilename: file.backendFilename,
            sourceFolder: file.sourceFolder || null,
            folderId: null,
            folderName: '(Root)'
          }));
          
          // Combine both
          setProjectFiles([...rootFiles, ...folderFiles]);
          
          // Load saved column widths
          if (loadedProject.linkColumnWidths) {
            setLinkColumnWidths(loadedProject.linkColumnWidths);
          }
        }
        
        // Load only Smart Link models
        const allModels = await getModels(projectId);
        const smartLinkModels = (allModels || []).filter(m => m.modelType === 'Smart Link');
        setModels(smartLinkModels);
      } catch (error) {
        console.error('Error loading data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [projectId]);

  // Close PDF dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (pdfDropdownRef.current && !pdfDropdownRef.current.contains(e.target)) {
        setShowPdfDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Prevent browser zoom on this page
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

  // Load PDF when selected
  useEffect(() => {
    const loadSelectedPdf = async () => {
      if (selectedPdf?.backendFilename && window.pdfjsLib) {
        try {
          const blobUrl = await getPdfFromBackend(selectedPdf.backendFilename, selectedPdf.sourceFolder);
          loadPdf(blobUrl);
        } catch (error) {
          console.error('Error loading PDF:', error);
          alert('Failed to load PDF');
        }
      }
    };
    loadSelectedPdf();
  }, [selectedPdf]);

  // Load PDF function
  const loadPdf = async (url) => {
    try {
      const pdf = await window.pdfjsLib.getDocument(url).promise;
      setPdfDoc(pdf);
      setNumPages(pdf.numPages);
      setCurrentPage(1);
      setScale(1);
      setTrainingBoxes([]); // Clear boxes when loading new PDF
      setTestResults([]); // Clear test results when loading new PDF
    } catch (error) {
      console.error('Error loading PDF:', error);
    }
  };

  // Render PDF page
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
      
      const displayWidth = viewport.width / baseScale;
      const displayHeight = viewport.height / baseScale;
      setCanvasSize({ width: displayWidth, height: displayHeight });

      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;
      
    } catch (error) {
      console.error('Render error:', error);
    } finally {
      setIsRendering(false);
    }
  }, [pdfDoc, currentPage]);

  useEffect(() => {
    if (pdfDoc) {
      renderPage();
    }
  }, [pdfDoc, currentPage, renderPage]);

  // Handle sidebar resize
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizingSidebar) {
        const newWidth = Math.max(200, Math.min(500, e.clientX));
        setSidebarWidth(newWidth);
      }
    };
    
    const handleMouseUp = () => {
      setIsResizingSidebar(false);
    };
    
    if (isResizingSidebar) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

  // Handle models section resize
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizingModels) {
        const delta = e.clientY - modelsResizeStartY.current;
        const newHeight = Math.max(80, Math.min(500, modelsResizeStartHeight.current + delta));
        setModelsSectionHeight(newHeight);
      }
    };
    
    const handleMouseUp = () => {
      if (isResizingModels) {
        setIsResizingModels(false);
        localStorage.setItem('smartlinks_modelsSectionHeight', modelsSectionHeight.toString());
      }
    };
    
    if (isResizingModels) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingModels, modelsSectionHeight]);

  const handleModelsResizeStart = (e) => {
    e.preventDefault();
    modelsResizeStartY.current = e.clientY;
    modelsResizeStartHeight.current = modelsSectionHeight;
    setIsResizingModels(true);
  };

  // Wheel zoom handler - zoom towards cursor like single view
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pdfDoc) return;

    const handleWheel = (e) => {
      // Don't zoom if canvas size isn't ready
      if (!canvasSize.width || !canvasSize.height) return;
      
      // Always zoom when scrolling on PDF area (no Ctrl required)
      e.preventDefault();
      e.stopPropagation();
      
      const oldScale = scale;
      // Multiplicative zoom - each tick multiplies/divides by factor
      const factor = 1.25;
      const newScale = e.deltaY > 0 
        ? Math.max(0.25, oldScale / factor)
        : Math.min(5, oldScale * factor);
      
      if (newScale === oldScale) return;
      
      // Get container rect for calculations
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      
      // Mouse position relative to container
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      // Calculate where the mouse is pointing on the PDF (in unscaled coordinates)
      // Account for pan offset
      const pdfX = (mouseX - panOffset.x) / oldScale;
      const pdfY = (mouseY - panOffset.y) / oldScale;
      
      // Calculate new pan offset to keep the same PDF point under cursor
      const newPanX = mouseX - pdfX * newScale;
      const newPanY = mouseY - pdfY * newScale;
      
      // Constrain pan to reasonable bounds
      const pdfWidth = canvasSize.width * newScale;
      const pdfHeight = canvasSize.height * newScale;
      const margin = 100;
      
      const minX = Math.min(0, rect.width - pdfWidth - margin);
      const maxX = margin;
      const minY = Math.min(0, rect.height - pdfHeight - margin);
      const maxY = margin;
      
      setPanOffset({
        x: Math.max(minX, Math.min(maxX, newPanX)),
        y: Math.max(minY, Math.min(maxY, newPanY))
      });
      setScale(newScale);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [pdfDoc, scale, panOffset.x, panOffset.y, canvasSize.width, canvasSize.height]);

  // Keyboard shortcuts for training view
  useEffect(() => {
    if (selectedItem !== 'train') return;
    
    const handleKeyDown = (e) => {
      // Don't trigger if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        return;
      }
      
      // V or Shift+V - Confirm pending shape
      if (e.key === 'v' || e.key === 'V') {
        // Will be handled by the pendingShape effect below
        return;
      }
      
      // Z - Undo (remove last training box)
      if (e.key === 'z' || e.key === 'Z') {
        setTrainingBoxes(prev => prev.slice(0, -1));
        return;
      }
      
      // Escape - Cancel pending shape
      if (e.key === 'Escape') {
        setPendingShape(null);
        return;
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedItem]);
  
  // Separate effect for V key to confirm shape (needs pendingShape dependency)
  useEffect(() => {
    if (selectedItem !== 'train') return;
    
    const handleVKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        return;
      }
      
      if ((e.key === 'v' || e.key === 'V') && pendingShape) {
        const newBox = {
          ...pendingShape,
          className: 'Smart Link',
          color: '#e74c3c',
        };
        setTrainingBoxes(prev => [...prev, newBox]);
        setPendingShape(null);
      }
    };
    
    document.addEventListener('keydown', handleVKey);
    return () => document.removeEventListener('keydown', handleVKey);
  }, [selectedItem, pendingShape]);

  // Pan handlers
  useEffect(() => {
    if (!isPanning) return;

    const handleMouseMove = (e) => {
      const container = containerRef.current;
      if (!container) return;
      
      const containerRect = container.getBoundingClientRect();
      const pdfWidth = canvasSize.width * scale;
      const pdfHeight = canvasSize.height * scale;
      
      // Allow some margin (100px) beyond edges
      const margin = 100;
      
      setPanOffset(prev => {
        let newX = prev.x + e.movementX;
        let newY = prev.y + e.movementY;
        
        // Constrain X: don't let PDF go too far right or left
        const minX = Math.min(0, containerRect.width - pdfWidth - margin);
        const maxX = margin;
        newX = Math.max(minX, Math.min(maxX, newX));
        
        // Constrain Y: don't let PDF go too far down or up
        const minY = Math.min(0, containerRect.height - pdfHeight - margin);
        const maxY = margin;
        newY = Math.max(minY, Math.min(maxY, newY));
        
        return { x: newX, y: newY };
      });
    };

    const handleMouseUp = () => {
      setIsPanning(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isPanning, canvasSize, scale]);

  // Handle resize handles for pending shape
  useEffect(() => {
    if (!activeResizeHandle || !pendingShape) return;
    
    const handleMouseMove = (e) => {
      if (!canvasRef.current || !canvasSize.width) return;
      
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale / canvasSize.width;
      const y = (e.clientY - rect.top) / scale / canvasSize.height;
      
      setPendingShape(prev => {
        if (!prev) return null;
        
        let newX = prev.x, newY = prev.y, newW = prev.width, newH = prev.height;
        const minSize = 0.01;
        
        switch (activeResizeHandle) {
          case 'nw':
            newW = prev.x + prev.width - x;
            newH = prev.y + prev.height - y;
            newX = x;
            newY = y;
            break;
          case 'ne':
            newW = x - prev.x;
            newH = prev.y + prev.height - y;
            newY = y;
            break;
          case 'sw':
            newW = prev.x + prev.width - x;
            newH = y - prev.y;
            newX = x;
            break;
          case 'se':
            newW = x - prev.x;
            newH = y - prev.y;
            break;
          case 'n':
            newH = prev.y + prev.height - y;
            newY = y;
            break;
          case 's':
            newH = y - prev.y;
            break;
          case 'e':
            newW = x - prev.x;
            break;
          case 'w':
            newW = prev.x + prev.width - x;
            newX = x;
            break;
        }
        
        if (newW < minSize) { newW = minSize; newX = prev.x + prev.width - minSize; }
        if (newH < minSize) { newH = minSize; newY = prev.y + prev.height - minSize; }
        
        return { ...prev, x: newX, y: newY, width: newW, height: newH };
      });
    };
    
    const handleMouseUp = () => {
      setActiveResizeHandle(null);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeResizeHandle, pendingShape, canvasSize, scale]);

  // Mouse handlers for drawing
  const handleMouseDown = (e) => {
    // Middle mouse button always pans
    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      return;
    }
    
    // If already have a pending shape, pan instead
    if (pendingShape || activeResizeHandle) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      return;
    }
    
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    
    // Start drawing
    setIsDrawing(true);
    setDrawStart({ x, y });
    setCurrentRect({ x, y, width: 0, height: 0 });
  };

  const handleMouseMove = (e) => {
    if (!isDrawing || !drawStart || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    
    const width = x - drawStart.x;
    const height = y - drawStart.y;
    
    setCurrentRect({
      x: width < 0 ? x : drawStart.x,
      y: height < 0 ? y : drawStart.y,
      width: Math.abs(width),
      height: Math.abs(height)
    });
  };

  const handleMouseUp = () => {
    if (!isDrawing || !currentRect) {
      setIsDrawing(false);
      setCurrentRect(null);
      return;
    }
    
    // Only create pending shape if it has some size
    if (currentRect.width > 10 && currentRect.height > 10) {
      const newBox = {
        id: `box_${Date.now()}`,
        x: currentRect.x / canvasSize.width,
        y: currentRect.y / canvasSize.height,
        width: currentRect.width / canvasSize.width,
        height: currentRect.height / canvasSize.height,
        page: currentPage - 1,
        pdfFilename: selectedPdf?.backendFilename,
      };
      setPendingShape(newBox);
    }
    
    setIsDrawing(false);
    setDrawStart(null);
    setCurrentRect(null);
  };

  // Confirm pending shape as training box
  const handleConfirmShape = () => {
    if (!pendingShape) return;
    
    const newBox = {
      ...pendingShape,
      className: 'Smart Link',
      color: '#e74c3c',
    };
    
    setTrainingBoxes(prev => [...prev, newBox]);
    setPendingShape(null);
  };

  // Cancel pending shape
  const handleCancelShape = () => {
    setPendingShape(null);
  };

  // Remove a training box
  const handleRemoveBox = (boxId) => {
    setTrainingBoxes(prev => prev.filter(b => b.id !== boxId));
  };

  // Train Smart Link model
  const handleTrain = async () => {
    if (trainingBoxes.length === 0) {
      alert('Please draw at least one training box');
      return;
    }
    
    if (!modelName.trim()) {
      alert('Please enter a model name');
      return;
    }
    
    // Check for duplicate names
    const isDuplicate = models.some(m => 
      m.className?.toLowerCase() === modelName.trim().toLowerCase()
    );
    
    if (isDuplicate) {
      alert('A model with this name already exists. Please choose a different name.');
      return;
    }
    
    if (!selectedPdf?.backendFilename) {
      alert('No PDF selected');
      return;
    }

    setIsTraining(true);
    
    try {
      const sanitizedBoxes = trainingBoxes.map(box => ({
        ...box,
        className: modelName.trim().replace(/[<>:"/\\|?*]/g, '-'),
      }));
      
      const result = await trainDetector(
        selectedPdf.backendFilename,
        sanitizedBoxes,
        false,          // multiOrientation
        false,          // includeInverted
        'separate',     // trainingMode
        'Smart Link',   // modelType
        projectId,      // projectId
        null,           // addToExistingModel
        selectedPdf.sourceFolder || null  // sourceFolder
      );
      
      console.log('Training result:', result);
      
      // Refresh models list
      const allModels = await getModels(projectId);
      const smartLinkModels = (allModels || []).filter(m => m.modelType === 'Smart Link');
      setModels(smartLinkModels);
      
      // Clear training state
      setTrainingBoxes([]);
      setModelName('');
      setPendingShape(null);
      
      alert(`Training complete! Model "${modelName}" created with ${trainingBoxes.length} example(s).`);
    } catch (error) {
      console.error('Training error:', error);
      alert('Training failed: ' + error.message);
    } finally {
      setIsTraining(false);
    }
  };

  // Test model on current PDF
  const handleTestModel = async (modelId) => {
    if (!selectedPdf?.backendFilename) {
      alert('Please select a PDF first');
      return;
    }
    
    const model = models.find(m => m.id === modelId);
    if (!model) {
      alert('Model not found');
      return;
    }
    
    setIsTesting(true);
    setTestModelId(modelId);
    setTestResults([]);
    
    try {
      const enableOCR = testOcrFormat.length > 0;
      const result = await runDetection(selectedPdf.backendFilename, {
        confidence: testConfidence,
        selectedModels: [modelId],
        enableOCR: enableOCR,
        sourceFolder: selectedPdf.sourceFolder || null,
        perClassSettings: {
          [modelId]: {
            confidence: testConfidence,
            enableOCR: enableOCR,
            ocrFormat: testOcrFormat || null,
            className: model.className
          }
        }
      });
      
      console.log('Test detection result:', result);
      
      if (result.detections && result.detections.length > 0) {
        // Filter detections for current page
        const pageDetections = result.detections.filter(det => 
          det.page === undefined || det.page === currentPage - 1
        );
        
        setTestResults(pageDetections.map((det, idx) => ({
          id: `test_${Date.now()}_${idx}`,
          x: det.bbox.x,
          y: det.bbox.y,
          width: det.bbox.width,
          height: det.bbox.height,
          confidence: det.confidence,
          className: det.class_name || model.className,
          ocrText: det.ocr_text || '',
          page: det.page || 0
        })));
      } else {
        setTestResults([]);
      }
    } catch (error) {
      console.error('Test detection error:', error);
      alert('Test detection failed: ' + error.message);
    } finally {
      setIsTesting(false);
    }
  };

  // Delete a model
  const handleDeleteModel = async (modelId, modelName) => {
    if (!window.confirm(`Delete model "${modelName}"?`)) return;
    
    try {
      await deleteModel(modelId);
      setModels(prev => prev.filter(m => m.id !== modelId));
      if (selectedItem === modelId) {
        setSelectedItem('home');
      }
    } catch (error) {
      console.error('Error deleting model:', error);
      alert('Failed to delete model');
    }
  };

  // Load model templates/examples
  const loadModelTemplates = async (model) => {
    if (!model) return;
    
    setIsLoadingTemplates(true);
    setTemplateImages([]);
    
    console.log('Loading examples for Smart Link model:', model.id, model);
    
    // Try Flask server examples endpoint first (port 5000)
    try {
      const flaskResponse = await fetch(`${DETECTOR_URL}/models/${model.id}/examples`);
      if (flaskResponse.ok) {
        const data = await flaskResponse.json();
        console.log('Flask examples response:', data);
        if (data.examples && data.examples.length > 0) {
          // Examples have bbox info - we need to generate thumbnails
          const examplesWithThumbnails = await Promise.all(
            data.examples.map(async (ex) => {
              try {
                // Get thumbnail from backend
                const thumbResponse = await fetch(`${BACKEND_URL}/api/thumbnail`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    filename: data.pdfFilename,
                    page: ex.page || 0,
                    bbox: ex.bbox
                  })
                });
                if (thumbResponse.ok) {
                  const thumbData = await thumbResponse.json();
                  return {
                    ...ex,
                    image: thumbData.thumbnail
                  };
                }
              } catch (e) {
                console.log('Failed to get thumbnail for example:', ex.id, e);
              }
              return ex;
            })
          );
          setTemplateImages(examplesWithThumbnails);
          setIsLoadingTemplates(false);
          return;
        }
      }
    } catch (error) {
      console.log('Flask examples fetch failed:', error.message);
    }
    
    // Try Node.js backend templates endpoint
    try {
      const response = await fetch(`${BACKEND_URL}/api/models/${model.id}/templates`);
      if (response.ok) {
        const data = await response.json();
        console.log('Template API response:', data);
        if (data.templates && data.templates.length > 0) {
          setTemplateImages(data.templates);
          setIsLoadingTemplates(false);
          return;
        }
      }
    } catch (error) {
      console.log('Backend template fetch failed:', error.message);
    }
    
    // Fallback: check various places templates might be stored in the model object
    console.log('Checking model object for templates:', model);
    
    // Check different possible template storage locations
    const templateSources = [
      model.templates,
      model.templateImages,
      model.templateData,
      model.trainingData?.templates,
      model.trainingImages,
    ].filter(Boolean);
    
    for (const source of templateSources) {
      if (Array.isArray(source) && source.length > 0) {
        console.log('Found templates in model object:', source.length);
        const processedTemplates = source.map((t, idx) => {
          if (typeof t === 'string') {
            return {
              id: `template-${idx}`,
              image: t.startsWith('data:') || t.startsWith('http') ? t : `data:image/png;base64,${t}`,
              label: `Template ${idx + 1}`
            };
          }
          return { ...t, id: t.id || t.example_id || `template-${idx}` };
        });
        setTemplateImages(processedTemplates);
        setIsLoadingTemplates(false);
        return;
      }
    }
    
    // No templates found
    console.log('No templates found for model');
    setTemplateImages([]);
    setIsLoadingTemplates(false);
  };

  // Toggle templates view
  const handleToggleTemplates = () => {
    if (!showTemplates && selectedModel) {
      loadModelTemplates(selectedModel);
    }
    setShowTemplates(!showTemplates);
  };

  // Zoom controls
  const handleZoomIn = () => setScale(s => Math.min(s * 1.25, 5));
  const handleZoomOut = () => setScale(s => Math.max(s / 1.25, 0.25));

  // Filter models by search
  const filteredModels = models.filter(model =>
    model.className?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    model.id?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Filter PDFs by search
  const filteredProjectFiles = projectFiles.filter(file =>
    file.name?.toLowerCase().includes(pdfSearchQuery.toLowerCase()) ||
    file.folderName?.toLowerCase().includes(pdfSearchQuery.toLowerCase())
  );

  // Get selected model
  const selectedModel = selectedItem !== 'home' && selectedItem !== 'train'
    ? models.find(m => m.id === selectedItem) 
    : null;

  // Get all hotspots/links from project (for the links list)
  const allLinks = useMemo(() => {
    if (!project?.hotspots) return [];
    if (Array.isArray(project.hotspots)) return project.hotspots;
    // Flatten object to array, preserving the file ID as sourceFileId
    const links = [];
    Object.entries(project.hotspots).forEach(([fileId, fileHotspots]) => {
      if (Array.isArray(fileHotspots)) {
        fileHotspots.forEach(hotspot => {
          links.push({
            ...hotspot,
            sourceFileId: hotspot.sourceFileId || fileId // Use existing or add from key
          });
        });
      }
    });
    return links;
  }, [project?.hotspots]);

  // Compute orphaned links info (links where source file has been deleted)
  const orphanedLinksInfo = useMemo(() => {
    const orphaned = allLinks.filter(link => {
      const sourceFile = projectFiles.find(f => f.id === link.sourceFileId);
      return !sourceFile && link.sourceFileId;
    });
    
    // Group by original source file ID
    const byFile = {};
    const fileNames = {}; // Store original filename for each fileId
    orphaned.forEach(link => {
      const key = link.sourceFileId || 'Unknown';
      if (!byFile[key]) {
        byFile[key] = [];
        // Try to get the original filename from the first link
        fileNames[key] = link.sourceFilename || link.originalFilename || null;
      }
      byFile[key].push(link);
    });
    
    return {
      total: orphaned.length,
      byFile,
      fileIds: Object.keys(byFile),
      fileNames // Map of fileId -> original filename
    };
  }, [allLinks, projectFiles]);

  // Compute broken links info (links where target file has been deleted)
  const brokenLinksInfo = useMemo(() => {
    const broken = allLinks.filter(link => {
      const sourceFile = projectFiles.find(f => f.id === link.sourceFileId);
      const targetFile = projectFiles.find(f => f.id === link.targetFileId);
      // Source exists but target was assigned and is now missing
      return sourceFile && link.targetFileId && !targetFile;
    });
    
    // Group by original target file ID
    const byFile = {};
    const fileNames = {}; // Store original filename for each fileId
    broken.forEach(link => {
      const key = link.targetFileId || 'Unknown';
      if (!byFile[key]) {
        byFile[key] = [];
        // Try to get the original filename from the link
        fileNames[key] = link.targetFilename || null;
      }
      byFile[key].push(link);
    });
    
    return {
      total: broken.length,
      byFile,
      fileIds: Object.keys(byFile),
      fileNames // Map of fileId -> original filename
    };
  }, [allLinks, projectFiles]);

  // Load thumbnail for a link
  const loadLinkThumbnail = async (link) => {
    if (!link?.id || !link?.sourceFileId) return;
    if (linkThumbnails[link.id] || loadingLinkThumbnails[link.id]) return;
    
    setLoadingLinkThumbnails(prev => ({ ...prev, [link.id]: true }));
    
    try {
      // Find the source file
      const sourceFile = projectFiles.find(f => f.id === link.sourceFileId);
      if (!sourceFile?.backendFilename) throw new Error('Source file not found');
      
      const bbox = {
        x: link.x,
        y: link.y,
        width: link.width,
        height: link.height
      };
      
      const thumbnail = await getThumbnail(sourceFile.backendFilename, link.page || 0, bbox, 0, false, sourceFile.sourceFolder);
      setLinkThumbnails(prev => ({ ...prev, [link.id]: thumbnail }));
    } catch (error) {
      console.error('Failed to load link thumbnail:', error);
      setLinkThumbnails(prev => ({ ...prev, [link.id]: null }));
    } finally {
      setLoadingLinkThumbnails(prev => ({ ...prev, [link.id]: false }));
    }
  };

  // Get filtered links based on filters
  const filteredLinks = useMemo(() => {
    return allLinks.filter(link => {
      // Filter by label
      if (linkFilters.label && !link.label?.toLowerCase().includes(linkFilters.label.toLowerCase())) {
        return false;
      }
      // Filter by status
      const sourceFile = projectFiles.find(f => f.id === link.sourceFileId);
      const targetFile = projectFiles.find(f => f.id === link.targetFileId);
      const isBroken = sourceFile && link.targetFileId && !targetFile;
      const isOrphaned = !sourceFile && link.sourceFileId;
      const isAssigned = link.targetFileId && targetFile;
      
      if (linkFilters.status === 'assigned' && !isAssigned) return false;
      if (linkFilters.status === 'unassigned' && (link.targetFileId || isOrphaned)) return false;
      if (linkFilters.status === 'broken' && !isBroken) return false;
      if (linkFilters.status === 'orphaned' && !isOrphaned) return false;
      
      // Filter by target
      if (linkFilters.target) {
        if (!targetFile?.name?.toLowerCase().includes(linkFilters.target.toLowerCase())) {
          return false;
        }
      }
      // Filter by source
      if (linkFilters.source) {
        if (!sourceFile?.name?.toLowerCase().includes(linkFilters.source.toLowerCase())) {
          return false;
        }
      }
      // Filter by assigned type
      if (linkFilters.assignedType) {
        const assignedType = !link.targetFileId ? 'Unassigned' : link.assignmentMode === 'property' ? 'Property' : link.assignmentMode === 'manual' ? 'Manual' : link.assignmentMode === 'drawn' ? 'Drawn' : 'Document Name';
        if (linkFilters.assignedType !== assignedType) {
          return false;
        }
      }
      return true;
    });
  }, [allLinks, linkFilters, projectFiles]);

  // Handle find link - navigate to PDF viewer with link (same pattern as Classes page)
  const handleFindLink = (link) => {
    const sourceFile = projectFiles.find(f => f.id === link.sourceFileId);
    if (sourceFile) {
      // Create navigation object in the same format as detected objects
      const navObject = {
        id: link.id,
        filename: sourceFile.backendFilename,
        page: link.page || 0,
        bbox: {
          x: link.x,
          y: link.y,
          width: link.width,
          height: link.height
        }
      };
      
      navigate(`/project/${projectId}`, { 
        state: { 
          navigateToObject: navObject
        } 
      });
    }
  };

  // Handle delete link
  const handleDeleteLink = async (linkId) => {
    if (!confirm('Delete this link?')) return;
    
    const updatedHotspots = { ...project.hotspots };
    // Remove link from all arrays in hotspots
    Object.keys(updatedHotspots).forEach(key => {
      if (Array.isArray(updatedHotspots[key])) {
        updatedHotspots[key] = updatedHotspots[key].filter(h => h.id !== linkId);
      }
    });
    
    const updatedProject = { ...project, hotspots: updatedHotspots };
    setProject(updatedProject);
    await saveProject(updatedProject);
  };

  // Handle individual link target reassignment
  const handleLinkTargetReassign = async () => {
    if (!linkToReassign || !newTargetFileId) return;
    
    const updatedHotspots = { ...project.hotspots };
    Object.keys(updatedHotspots).forEach(key => {
      if (Array.isArray(updatedHotspots[key])) {
        updatedHotspots[key] = updatedHotspots[key].map(h => {
          if (h.id === linkToReassign.id) {
            const targetFile = projectFiles.find(f => f.id === newTargetFileId);
            return {
              ...h,
              targetFileId: newTargetFileId || null,
              targetFilename: targetFile?.name || null,
              assignmentMode: newTargetFileId ? 'manual' : null
            };
          }
          return h;
        });
      }
    });
    
    const updatedProject = { ...project, hotspots: updatedHotspots };
    setProject(updatedProject);
    await saveProject(updatedProject);
    
    setShowLinkReassignDialog(false);
    setLinkToReassign(null);
    setNewTargetFileId('');
  };

  // Handle label edit save
  const handleLabelSave = async () => {
    if (!labelEditLink) return;
    
    const updatedHotspots = { ...project.hotspots };
    Object.keys(updatedHotspots).forEach(key => {
      if (Array.isArray(updatedHotspots[key])) {
        updatedHotspots[key] = updatedHotspots[key].map(h => {
          if (h.id === labelEditLink.id) {
            return {
              ...h,
              label: labelEditValue
            };
          }
          return h;
        });
      }
    });
    
    const updatedProject = { ...project, hotspots: updatedHotspots };
    setProject(updatedProject);
    await saveProject(updatedProject);
    
    setShowLabelEditDialog(false);
    setLabelEditLink(null);
    setLabelEditValue('');
  };

  // Handle delete filtered/all links
  const handleDeleteFilteredLinks = async () => {
    if (filteredLinks.length === 0) return;
    
    const hasFilters = Object.values(linkFilters).some(v => v && v.trim && v.trim());
    
    const message = hasFilters
      ? `Delete ${filteredLinks.length} filtered link(s)?\n\nThis will delete all currently filtered/visible links.`
      : `Delete all ${filteredLinks.length} link(s)?\n\nThis cannot be undone.`;
    
    if (!confirm(message)) return;
    
    const idsToDelete = new Set(filteredLinks.map(link => link.id));
    
    const updatedHotspots = { ...project.hotspots };
    Object.keys(updatedHotspots).forEach(key => {
      if (Array.isArray(updatedHotspots[key])) {
        updatedHotspots[key] = updatedHotspots[key].filter(h => !idsToDelete.has(h.id));
      }
    });
    
    // Clear thumbnails for deleted links
    const newThumbnails = { ...linkThumbnails };
    idsToDelete.forEach(id => delete newThumbnails[id]);
    setLinkThumbnails(newThumbnails);
    
    const updatedProject = { ...project, hotspots: updatedHotspots };
    setProject(updatedProject);
    await saveProject(updatedProject);
  };

  // Handle reassign orphaned links - keep existing coordinates
  const handleReassignKeepCoords = async () => {
    if (!reassignSourceFile || !reassignTargetFile) return;
    
    setIsReassigning(true);
    try {
      const updatedHotspots = { ...project.hotspots };
      
      // Get orphaned links for this source file
      const orphanedLinks = orphanedLinksInfo.byFile[reassignSourceFile] || [];
      
      // Create new array for target file if it doesn't exist
      if (!updatedHotspots[reassignTargetFile.id]) {
        updatedHotspots[reassignTargetFile.id] = [];
      }
      
      // Move orphaned links to new file
      orphanedLinks.forEach(link => {
        // Remove from old location (by sourceFileId key)
        Object.keys(updatedHotspots).forEach(key => {
          if (Array.isArray(updatedHotspots[key])) {
            updatedHotspots[key] = updatedHotspots[key].filter(h => h.id !== link.id);
          }
        });
        
        // Add to new file with updated sourceFileId
        updatedHotspots[reassignTargetFile.id].push({
          ...link,
          sourceFileId: reassignTargetFile.id,
          originalSourceFileId: link.sourceFileId // Keep track of original
        });
      });
      
      const updatedProject = { ...project, hotspots: updatedHotspots };
      setProject(updatedProject);
      await saveProject(updatedProject);
      
      alert(`✓ Reassigned ${orphanedLinks.length} link(s) to "${reassignTargetFile.name}"`);
      
      setShowReassignDialog(false);
      setReassignSourceFile(null);
      setReassignTargetFile(null);
    } catch (error) {
      console.error('Error reassigning links:', error);
      alert('Failed to reassign links: ' + error.message);
    } finally {
      setIsReassigning(false);
    }
  };

  // Handle delete orphaned links for a specific file
  const handleDeleteOrphanedForFile = async (sourceFileId) => {
    const count = orphanedLinksInfo.byFile[sourceFileId]?.length || 0;
    if (!confirm(`Delete ${count} orphaned link(s) from deleted file "${sourceFileId}"?\n\nThis cannot be undone.`)) return;
    
    const idsToDelete = new Set((orphanedLinksInfo.byFile[sourceFileId] || []).map(l => l.id));
    
    const updatedHotspots = { ...project.hotspots };
    Object.keys(updatedHotspots).forEach(key => {
      if (Array.isArray(updatedHotspots[key])) {
        updatedHotspots[key] = updatedHotspots[key].filter(h => !idsToDelete.has(h.id));
      }
    });
    
    const updatedProject = { ...project, hotspots: updatedHotspots };
    setProject(updatedProject);
    await saveProject(updatedProject);
  };

  // Handle delete all orphaned links
  const handleDeleteAllOrphaned = async () => {
    if (orphanedLinksInfo.total === 0) return;
    
    if (!confirm(`Delete all ${orphanedLinksInfo.total} orphaned link(s)?\n\nThese links reference deleted files and cannot be navigated to.\n\nThis cannot be undone.`)) return;
    
    const orphanedIds = new Set(
      Object.values(orphanedLinksInfo.byFile).flat().map(l => l.id)
    );
    
    const updatedHotspots = { ...project.hotspots };
    Object.keys(updatedHotspots).forEach(key => {
      if (Array.isArray(updatedHotspots[key])) {
        updatedHotspots[key] = updatedHotspots[key].filter(h => !orphanedIds.has(h.id));
      }
    });
    
    const updatedProject = { ...project, hotspots: updatedHotspots };
    setProject(updatedProject);
    await saveProject(updatedProject);
    
    alert(`✓ Deleted ${orphanedLinksInfo.total} orphaned link(s)`);
  };

  // Handle reassign broken links (target file deleted) to a new target
  const handleBrokenReassign = async () => {
    if (!brokenReassignOldTarget || !brokenReassignNewTarget) return;
    
    setIsReassigning(true);
    try {
      const updatedHotspots = { ...project.hotspots };
      
      // Get broken links for this old target file
      const brokenLinks = brokenLinksInfo.byFile[brokenReassignOldTarget] || [];
      
      // Update targetFileId for each broken link
      Object.keys(updatedHotspots).forEach(key => {
        if (Array.isArray(updatedHotspots[key])) {
          updatedHotspots[key] = updatedHotspots[key].map(h => {
            if (brokenLinks.some(bl => bl.id === h.id)) {
              return {
                ...h,
                targetFileId: brokenReassignNewTarget.id,
                targetFilename: brokenReassignNewTarget.name,
                originalTargetFileId: h.targetFileId // Keep track of original
              };
            }
            return h;
          });
        }
      });
      
      const updatedProject = { ...project, hotspots: updatedHotspots };
      setProject(updatedProject);
      await saveProject(updatedProject);
      
      alert(`✓ Reassigned ${brokenLinks.length} link(s) to target "${brokenReassignNewTarget.name}"`);
      
      setShowBrokenReassignDialog(false);
      setBrokenReassignOldTarget(null);
      setBrokenReassignNewTarget(null);
    } catch (error) {
      console.error('Error reassigning broken links:', error);
      alert('Failed to reassign links: ' + error.message);
    } finally {
      setIsReassigning(false);
    }
  };

  // Handle delete broken links for a specific deleted target file
  const handleDeleteBrokenForFile = async (targetFileId) => {
    const count = brokenLinksInfo.byFile[targetFileId]?.length || 0;
    const fileName = brokenLinksInfo.fileNames[targetFileId] || targetFileId.substring(0, 12) + '...';
    if (!confirm(`Delete ${count} broken link(s) targeting deleted file "${fileName}"?\n\nThis cannot be undone.`)) return;
    
    const idsToDelete = new Set((brokenLinksInfo.byFile[targetFileId] || []).map(l => l.id));
    
    const updatedHotspots = { ...project.hotspots };
    Object.keys(updatedHotspots).forEach(key => {
      if (Array.isArray(updatedHotspots[key])) {
        updatedHotspots[key] = updatedHotspots[key].filter(h => !idsToDelete.has(h.id));
      }
    });
    
    const updatedProject = { ...project, hotspots: updatedHotspots };
    setProject(updatedProject);
    await saveProject(updatedProject);
  };

  // Handle delete all broken links
  const handleDeleteAllBroken = async () => {
    if (brokenLinksInfo.total === 0) return;
    
    if (!confirm(`Delete all ${brokenLinksInfo.total} broken link(s)?\n\nThese links target deleted files.\n\nThis cannot be undone.`)) return;
    
    const brokenIds = new Set(
      Object.values(brokenLinksInfo.byFile).flat().map(l => l.id)
    );
    
    const updatedHotspots = { ...project.hotspots };
    Object.keys(updatedHotspots).forEach(key => {
      if (Array.isArray(updatedHotspots[key])) {
        updatedHotspots[key] = updatedHotspots[key].filter(h => !brokenIds.has(h.id));
      }
    });
    
    const updatedProject = { ...project, hotspots: updatedHotspots };
    setProject(updatedProject);
    await saveProject(updatedProject);
    
    alert(`✓ Deleted ${brokenLinksInfo.total} broken link(s)`);
  };

  // Export all links as JSON
  const handleExportLinks = () => {
    if (allLinks.length === 0) {
      alert('No links to export');
      return;
    }
    
    const exportData = {
      projectId,
      projectName: project?.name || 'Unknown',
      exportDate: new Date().toISOString(),
      linkCount: allLinks.length,
      links: allLinks,
      hotspots: project?.hotspots || {}
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${project?.name || 'links'}_smartlinks_export.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  // Export links as CSV
  const handleExportLinksCSV = () => {
    if (allLinks.length === 0) {
      alert('No links to export');
      return;
    }
    
    const headers = ['id', 'label', 'sourceFile', 'sourcePage', 'targetFile', 'targetLinkNumber', 'status', 'x', 'y', 'width', 'height'];
    
    const rows = allLinks.map(link => {
      const row = [
        link.id || '',
        link.label || '',
        link.sourceFile || link.filename || '',
        link.page ?? '',
        link.targetFile || '',
        link.targetLinkNumber ?? '',
        link.isLinked ? 'linked' : 'unlinked',
        link.x ?? '',
        link.y ?? '',
        link.width ?? '',
        link.height ?? ''
      ];
      return row.map(v => {
        const str = String(v);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(',');
    });
    
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${project?.name || 'links'}_smartlinks_export.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  // Handle file selection for import
  const handleLinksFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        
        if (data.hotspots && typeof data.hotspots === 'object') {
          setImportData({ 
            format: 'hotspots', 
            hotspots: data.hotspots, 
            linkCount: data.linkCount || Object.values(data.hotspots).flat().length,
            fileName: file.name 
          });
        } else if (data.links && Array.isArray(data.links)) {
          setImportData({ 
            format: 'links', 
            links: data.links, 
            linkCount: data.links.length,
            fileName: file.name 
          });
        } else {
          throw new Error('Invalid format: expected hotspots object or links array');
        }
        
        setImportError(null);
        setShowImportDialog(true);
      } catch (error) {
        setImportError(error.message);
        setImportData(null);
        setShowImportDialog(true);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Execute import
  const handleImportLinks = async () => {
    if (!importData) return;
    
    try {
      let newHotspots;
      
      if (importMode === 'replace') {
        if (importData.format === 'hotspots') {
          newHotspots = importData.hotspots;
        } else {
          newHotspots = {};
          importData.links.forEach(link => {
            const fileId = link.fileId || link.sourceFile || 'unknown';
            if (!newHotspots[fileId]) {
              newHotspots[fileId] = [];
            }
            newHotspots[fileId].push(link);
          });
        }
      } else {
        newHotspots = { ...project.hotspots };
        
        if (importData.format === 'hotspots') {
          Object.entries(importData.hotspots).forEach(([fileId, links]) => {
            if (!newHotspots[fileId]) {
              newHotspots[fileId] = [];
            }
            const existingIds = new Set(newHotspots[fileId].map(h => h.id));
            links.forEach(link => {
              if (!existingIds.has(link.id)) {
                newHotspots[fileId].push(link);
              } else {
                const idx = newHotspots[fileId].findIndex(h => h.id === link.id);
                if (idx !== -1) {
                  newHotspots[fileId][idx] = { ...newHotspots[fileId][idx], ...link };
                }
              }
            });
          });
        } else {
          importData.links.forEach(link => {
            const fileId = link.fileId || link.sourceFile || 'unknown';
            if (!newHotspots[fileId]) {
              newHotspots[fileId] = [];
            }
            const existingIdx = newHotspots[fileId].findIndex(h => h.id === link.id);
            if (existingIdx === -1) {
              newHotspots[fileId].push(link);
            } else {
              newHotspots[fileId][existingIdx] = { ...newHotspots[fileId][existingIdx], ...link };
            }
          });
        }
      }
      
      const updatedProject = { ...project, hotspots: newHotspots };
      setProject(updatedProject);
      await saveProject(updatedProject);
      
      alert(`Successfully imported ${importData.linkCount} link(s) (${importMode} mode)`);
      setShowImportDialog(false);
      setImportData(null);
      setImportError(null);
    } catch (error) {
      console.error('Import failed:', error);
      alert('Import failed: ' + error.message);
    }
  };

  // Column resize handler
  const handleLinkColumnResizeStart = (e, columnId) => {
    e.preventDefault();
    setResizingColumn(columnId);
    
    const startX = e.clientX;
    const startWidth = getLinkColumnWidth(columnId);
    let currentWidth = startWidth;
    
    const handleMouseMove = (moveEvent) => {
      const diff = moveEvent.clientX - startX;
      currentWidth = Math.max(80, startWidth + diff);
      setLinkColumnWidths(prev => ({
        ...prev,
        [columnId]: currentWidth
      }));
    };
    
    const handleMouseUp = async () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      setResizingColumn(null);
      
      // Save column widths to project
      const newColumnWidths = {
        ...linkColumnWidths,
        [columnId]: currentWidth
      };
      const updatedProject = {
        ...project,
        linkColumnWidths: newColumnWidths
      };
      setProject(updatedProject);
      try {
        await saveProject(updatedProject);
      } catch (error) {
        console.error('Error saving column widths:', error);
      }
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Find matching links
  const findMatches = useMemo(() => {
    if (!findText) return [];
    
    const searchText = matchCase ? findText : findText.toLowerCase();
    
    return filteredLinks.filter(link => {
      const fieldValue = link[findField] || '';
      const compareValue = matchCase ? fieldValue : fieldValue.toLowerCase();
      return compareValue.includes(searchText);
    });
  }, [findText, findField, matchCase, filteredLinks]);

  // Replace in single link
  const handleReplaceSingle = async (linkId) => {
    if (!findText) return;
    
    const updatedHotspots = { ...project.hotspots };
    
    Object.keys(updatedHotspots).forEach(key => {
      if (Array.isArray(updatedHotspots[key])) {
        updatedHotspots[key] = updatedHotspots[key].map(h => {
          if (h.id === linkId) {
            const currentValue = h[findField] || '';
            const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
            return { ...h, [findField]: currentValue.replace(regex, replaceText) };
          }
          return h;
        });
      }
    });
    
    const updatedProject = { ...project, hotspots: updatedHotspots };
    setProject(updatedProject);
    
    try {
      await saveProject(updatedProject);
    } catch (error) {
      console.error('Error replacing:', error);
    }
  };

  // Replace all matches
  const handleReplaceAll = async () => {
    if (!findText || findMatches.length === 0) return;
    
    const matchIds = new Set(findMatches.map(l => l.id));
    const updatedHotspots = { ...project.hotspots };
    
    Object.keys(updatedHotspots).forEach(key => {
      if (Array.isArray(updatedHotspots[key])) {
        updatedHotspots[key] = updatedHotspots[key].map(h => {
          if (matchIds.has(h.id)) {
            const currentValue = h[findField] || '';
            const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
            return { ...h, [findField]: currentValue.replace(regex, replaceText) };
          }
          return h;
        });
      }
    });
    
    const updatedProject = { ...project, hotspots: updatedHotspots };
    setProject(updatedProject);
    
    try {
      await saveProject(updatedProject);
      alert(`Replaced ${findMatches.length} occurrence(s)`);
    } catch (error) {
      console.error('Error replacing all:', error);
    }
  };

  // Refresh links - try to auto-assign unassigned links based on label
  const handleRefreshLinks = async () => {
    // Get unassigned links
    const unassignedLinks = allLinks.filter(link => !link.targetFileId && link.label);
    
    if (unassignedLinks.length === 0) {
      alert('No unassigned links with labels to process.');
      return;
    }
    
    let matchedCount = 0;
    const updatedHotspots = { ...project.hotspots };
    
    // For each unassigned link, try to find a matching file
    unassignedLinks.forEach(link => {
      const label = link.label.trim().toLowerCase();
      if (!label) return;
      
      // Try to find a matching file
      // Strategy: Check if filename contains the label or label contains filename (without extension)
      const matchingFile = projectFiles.find(file => {
        const fileName = file.name.toLowerCase();
        const fileNameNoExt = fileName.replace(/\.[^/.]+$/, ''); // Remove extension
        
        // Exact match (without extension)
        if (fileNameNoExt === label) return true;
        
        // File name contains the label
        if (fileNameNoExt.includes(label)) return true;
        
        // Label contains the file name (for cases like "See DWG-001" matching "DWG-001.pdf")
        if (label.includes(fileNameNoExt)) return true;
        
        return false;
      });
      
      if (matchingFile) {
        // Update the hotspot with the target file
        Object.keys(updatedHotspots).forEach(key => {
          if (Array.isArray(updatedHotspots[key])) {
            updatedHotspots[key] = updatedHotspots[key].map(h => {
              if (h.id === link.id) {
                return { ...h, targetFileId: matchingFile.id };
              }
              return h;
            });
          }
        });
        matchedCount++;
      }
    });
    
    if (matchedCount === 0) {
      alert(`No matches found for ${unassignedLinks.length} unassigned link(s).\n\nTip: Make sure the label matches a PDF filename in your project.`);
      return;
    }
    
    const updatedProject = { ...project, hotspots: updatedHotspots };
    setProject(updatedProject);
    
    try {
      await saveProject(updatedProject);
      alert(`Successfully matched ${matchedCount} of ${unassignedLinks.length} unassigned link(s) to documents.`);
    } catch (error) {
      console.error('Error refreshing links:', error);
    }
  };

  if (isLoading) {
    return <div className="project-smartlinks-page loading">Loading...</div>;
  }

  if (!project) {
    return <div className="project-smartlinks-page loading">Project not found</div>;
  }

  return (
    <div className="project-smartlinks-page">
      <header className="smartlinks-header">
        <button 
          className="back-btn"
          onClick={() => navigate(`/project/${projectId}`, { state: { returnToFile } })}
        >
          ← Back to Project
        </button>
        <h1>{project?.name} - Links</h1>
        <h1 className="brand-title">pidly</h1>
      </header>

      <div className="smartlinks-body">
        {/* Sidebar */}
        <div 
          className="smartlinks-sidebar" 
          style={{ width: sidebarWidth, minWidth: 200, maxWidth: 500, position: 'relative' }}
        >
          {/* Overview button */}
          <div 
            className={`sidebar-item home-item ${selectedItem === 'home' ? 'selected' : ''}`}
            onClick={() => { 
              setSelectedItem('home'); 
              setSelectedPdf(null); 
              setPdfDoc(null); 
              setPendingShape(null);
              setTestResults([]);
              setTrainingBoxes([]);
              setCanvasSize({ width: 0, height: 0 });
              setScale(1);
              setPanOffset({ x: 0, y: 0 });
              setShowTemplates(false);
              setTemplateImages([]);
            }}
          >
            <span className="item-name">Overview</span>
          </div>

          {/* Document Links button */}
          <div 
            className={`sidebar-item home-item ${selectedItem === 'links' ? 'selected' : ''}`}
            onClick={() => { 
              setSelectedItem('links'); 
              setSelectedPdf(null); 
              setPdfDoc(null); 
              setPendingShape(null);
              setTestResults([]);
              setTrainingBoxes([]);
              setCanvasSize({ width: 0, height: 0 });
              setScale(1);
              setPanOffset({ x: 0, y: 0 });
              setShowTemplates(false);
              setTemplateImages([]);
            }}
          >
            <span className="item-name">Document Links</span>
          </div>

          {/* Create Link Model button */}
          <button 
            className="create-model-btn"
            onClick={() => {
              // Clear any existing training state
              setModelName('');
              setTrainingBoxes([]);
              setPendingShape(null);
              setTestResults([]);
              setSelectedPdf(null);
              setPdfDoc(null);
              setCurrentPage(1);
              // Go to training view
              setSelectedItem('train');
            }}
          >
            Create Link Model
          </button>

          {/* Models section */}
          <div className="models-section">
            <div className="models-section-header">
              <span className="section-title">Current Models</span>
            </div>
            
            {/* Search */}
            <div className="models-search">
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            {/* Models list */}
            <div className="models-list">
            {filteredModels.length === 0 ? (
              <p className="no-models">
                {searchQuery ? 'No models found' : 'No link models yet'}
              </p>
            ) : (
              filteredModels.map(model => (
                <div
                  key={model.id}
                  className={`model-list-item ${selectedItem === model.id ? 'selected' : ''}`}
                  onClick={() => { 
                    setSelectedItem(model.id); 
                    setSelectedPdf(null); 
                    setPdfDoc(null); 
                    setPendingShape(null);
                    setTestResults([]);
                    setTrainingBoxes([]);
                    setCanvasSize({ width: 0, height: 0 });
                    setScale(1);
                    setPanOffset({ x: 0, y: 0 });
                    setShowTemplates(false);
                    setTemplateImages([]);
                    // Set edit values from model
                    setEditConfidence(model.recommendedConfidence || 0.7);
                    setEditOcrFormat(model.recommendedOcrFormat || '');
                    setEditAssignmentMode(model.assignmentMode || 'link');
                    setEditPropertyTemplateId(model.propertyTemplateId || '');
                    setEditPropertyName(model.propertyName || '');
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    marginBottom: '2px',
                    transition: 'all 0.15s',
                    background: selectedItem === model.id ? '#2a2a2a' : 'transparent',
                    borderTop: 'none',
                    borderRight: 'none',
                    borderBottom: 'none',
                    borderLeft: selectedItem === model.id ? '3px solid #3498db' : '3px solid transparent',
                    outline: 'none'
                  }}
                  onMouseEnter={(e) => { 
                    if (selectedItem !== model.id) e.currentTarget.style.background = '#252525'; 
                    e.currentTarget.querySelector('.model-action-btn').style.opacity = '1';
                  }}
                  onMouseLeave={(e) => { 
                    if (selectedItem !== model.id) e.currentTarget.style.background = 'transparent'; 
                    e.currentTarget.querySelector('.model-action-btn').style.opacity = '0';
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                  <div className="model-item-info" style={{ flex: 1, minWidth: 0 }}>
                    <div className="model-item-name" style={{ fontSize: '13px', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{model.className}</div>
                  </div>
                  <button
                    className="model-action-btn delete"
                    title="Delete model"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteModel(model.id, model.className);
                    }}
                    style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'all 0.15s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#e74c3c'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#666'; }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                  </button>
                </div>
              ))
            )}
            </div>
          </div>

          {/* Sidebar Footer */}
          <div className="sidebar-footer">
            <div className="sidebar-footer-hint">Need to set up document properties?</div>
            <button 
              className="properties-link"
              onClick={() => navigate(`/project/${projectId}/docprops`, { state: { returnToFile } })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              Document Properties
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="arrow-icon">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </div>

          {/* Resize handle */}
          <div 
            className="sidebar-resize-handle"
            onMouseDown={() => setIsResizingSidebar(true)}
          />
        </div>

        {/* Main Content */}
        <div className="smartlinks-main">
          {selectedItem === 'train' ? (
            // Training View
            <div className="training-viewer">
              <div className="training-page-header">
                <h2>Create Link Model</h2>
              </div>
              <div className="training-form">
                <div className="training-form-row">
                  <label>Select Document</label>
                  <div className="searchable-dropdown" ref={pdfDropdownRef}>
                    <input
                      type="text"
                      className={`pdf-search-input ${!selectedPdf && !showPdfDropdown ? 'no-selection' : ''}`}
                      value={showPdfDropdown ? pdfSearchQuery : (selectedPdf?.name || '')}
                      onChange={(e) => {
                        setPdfSearchQuery(e.target.value);
                        setShowPdfDropdown(true);
                      }}
                      onFocus={() => {
                        setShowPdfDropdown(true);
                        setPdfSearchQuery('');
                      }}
                      placeholder={showPdfDropdown ? "Search..." : (!selectedPdf ? "No Document Selected" : "")}
                    />
                    {selectedPdf && !showPdfDropdown && (
                      <button 
                        className="clear-pdf-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPdf(null);
                          setPdfDoc(null);
                          setTrainingBoxes([]);
                          setCurrentPage(1);
                          setPdfSearchQuery('');
                        }}
                      >
                        ×
                      </button>
                    )}
                    {showPdfDropdown && (
                      <div className="pdf-dropdown-list">
                        {filteredProjectFiles.length === 0 ? (
                          <div className="pdf-dropdown-empty">No matching PDFs</div>
                        ) : (
                          filteredProjectFiles.map(file => (
                            <div
                              key={file.id}
                              className={`pdf-dropdown-item ${selectedPdf?.id === file.id ? 'selected' : ''}`}
                              onClick={() => {
                                setSelectedPdf(file);
                                setShowPdfDropdown(false);
                                setPdfSearchQuery('');
                              }}
                            >
                              <span className="pdf-item-name">{file.name}</span>
                              {file.folderName && <span className="pdf-item-folder">{file.folderName}</span>}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="training-form-row">
                  <label>Enter Model Name</label>
                  <input
                    type="text"
                    className={`training-form-input ${modelName.trim() && models.some(m => m.className?.toLowerCase() === modelName.trim().toLowerCase()) ? 'error' : ''}`}
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder=""
                  />
                  {modelName.trim() && models.some(m => m.className?.toLowerCase() === modelName.trim().toLowerCase()) && (
                    <span className="model-name-error">Name already exists</span>
                  )}
                </div>
              </div>
              
              <div className="training-toolbar">
                <div className="toolbar-row">
                  <span className="box-count">{trainingBoxes.length} example{trainingBoxes.length !== 1 ? 's' : ''}</span>
                  
                  <button 
                    className="clear-boxes-btn"
                    onClick={() => setTrainingBoxes([])}
                    disabled={trainingBoxes.length === 0}
                  >
                    Clear
                  </button>
                  <button
                    className="train-btn"
                    onClick={handleTrain}
                    disabled={isTraining || trainingBoxes.length === 0 || !modelName.trim() || !selectedPdf || models.some(m => m.className?.toLowerCase() === modelName.trim().toLowerCase())}
                  >
                    {isTraining ? 'Training...' : 'Train'}
                  </button>
                  {models.length > 0 && selectedPdf && (
                    <button 
                      className={`test-model-btn ${showTestPanel ? 'active' : ''} ${isTesting ? 'testing' : ''}`}
                      onClick={() => setShowTestPanel(!showTestPanel)}
                      disabled={isTesting}
                      title="Test a model on the current PDF"
                    >
                      {isTesting ? 'Testing...' : 'Test'}
                    </button>
                  )}
                  
                  <div className="toolbar-spacer" />
                  
                  {selectedPdf && (
                    <div className="zoom-controls">
                      <button onClick={handleZoomOut}>−</button>
                      <span className="zoom-level">{Math.round(scale * 100)}%</span>
                      <button onClick={handleZoomIn}>+</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Training Content Area - holds page nav, canvas and side panel */}
              {selectedPdf ? (
                <div className="training-content-area">
                  <div className="training-canvas-section">
                    {/* Page navigation */}
                    <div className="page-nav">
                      <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1 || !pdfDoc}>
                        ← Prev
                      </button>
                      <span>Page {currentPage} of {numPages || '...'}</span>
                      <button onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))} disabled={currentPage >= numPages || !pdfDoc}>
                        Next →
                      </button>
                    </div>

                  {/* PDF Canvas */}
                  <div 
                    className="pdf-container"
                    ref={containerRef}
                  >
                    <div 
                      className="pdf-canvas-wrapper"
                      style={{
                        width: canvasSize.width * scale,
                        height: canvasSize.height * scale,
                        position: 'relative',
                        transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
                      }}
                      onMouseDown={handleMouseDown}
                      onMouseMove={handleMouseMove}
                      onMouseUp={handleMouseUp}
                      onMouseLeave={handleMouseUp}
                    >
                      <canvas
                        ref={canvasRef}
                        style={{
                          width: canvasSize.width * scale,
                          height: canvasSize.height * scale,
                          cursor: isPanning ? 'grabbing' : (pendingShape ? 'default' : 'crosshair')
                        }}
                      />
                      
                      {/* Current drawing rectangle */}
                      {currentRect && (
                        <div
                          className="drawing-rect"
                          style={{
                            left: currentRect.x * scale,
                            top: currentRect.y * scale,
                            width: currentRect.width * scale,
                            height: currentRect.height * scale,
                          }}
                        />
                      )}
                      
                      {/* Existing training boxes for current page */}
                      {trainingBoxes
                        .filter(box => box.page === currentPage - 1)
                        .map(box => (
                          <div
                            key={box.id}
                            className="training-box"
                            style={{
                              left: box.x * canvasSize.width * scale,
                              top: box.y * canvasSize.height * scale,
                              width: box.width * canvasSize.width * scale,
                              height: box.height * canvasSize.height * scale,
                            }}
                          >
                            <span className="box-label" style={{ backgroundColor: '#e74c3c' }}>Link</span>
                            <button 
                              className="remove-box-btn"
                              onClick={(e) => { e.stopPropagation(); handleRemoveBox(box.id); }}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      
                      {/* Pending shape confirmation overlay */}
                      {pendingShape && pendingShape.page === currentPage - 1 && (
                        <div
                          className="pending-shape-overlay"
                          style={{
                            left: pendingShape.x * canvasSize.width * scale,
                            top: pendingShape.y * canvasSize.height * scale,
                            width: pendingShape.width * canvasSize.width * scale,
                            height: pendingShape.height * canvasSize.height * scale,
                          }}
                        >
                          <div className="pending-shape-border" />
                          
                          {/* Resize handles */}
                          <div className="shape-handle handle-nw" onMouseDown={(e) => { e.stopPropagation(); setActiveResizeHandle('nw'); }} />
                          <div className="shape-handle handle-ne" onMouseDown={(e) => { e.stopPropagation(); setActiveResizeHandle('ne'); }} />
                          <div className="shape-handle handle-sw" onMouseDown={(e) => { e.stopPropagation(); setActiveResizeHandle('sw'); }} />
                          <div className="shape-handle handle-se" onMouseDown={(e) => { e.stopPropagation(); setActiveResizeHandle('se'); }} />
                          <div className="shape-handle handle-n" onMouseDown={(e) => { e.stopPropagation(); setActiveResizeHandle('n'); }} />
                          <div className="shape-handle handle-s" onMouseDown={(e) => { e.stopPropagation(); setActiveResizeHandle('s'); }} />
                          <div className="shape-handle handle-e" onMouseDown={(e) => { e.stopPropagation(); setActiveResizeHandle('e'); }} />
                          <div className="shape-handle handle-w" onMouseDown={(e) => { e.stopPropagation(); setActiveResizeHandle('w'); }} />
                          
                          {/* Confirmation buttons */}
                          <div className="shape-actions">
                            <button className="confirm-btn" onClick={handleConfirmShape} title="Add as example">✓</button>
                            <button className="cancel-btn" onClick={handleCancelShape} title="Cancel">✕</button>
                          </div>
                        </div>
                      )}
                      
                      {/* Test detection results overlay */}
                      {testResults
                        .filter(result => result.page === currentPage - 1 || result.page === undefined)
                        .map(result => (
                          <div
                            key={result.id}
                            className="test-result-box"
                            style={{
                              left: result.x * canvasSize.width * scale,
                              top: result.y * canvasSize.height * scale,
                              width: result.width * canvasSize.width * scale,
                              height: result.height * canvasSize.height * scale,
                            }}
                          >
                            <span className="test-result-label">
                              {result.ocrText || result.className} ({Math.round(result.confidence * 100)}%)
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                  
                  <p className="training-hint">
                    📐 Click and drag to draw rectangles around link examples • Scroll to zoom • Drag to pan when not drawing
                  </p>
                </div>
                
                {/* Test Model Panel - Right Sidebar */}
                {showTestPanel && (
                  <div className="test-panel-sidebar">
                    <div className="panel-header">
                      <h3>🔍 Test Model</h3>
                      <button className="close-panel" onClick={() => setShowTestPanel(false)}>×</button>
                    </div>
                    <div className="panel-content">
                      {/* Model Selection */}
                      <div className="panel-section">
                        <h4>Select Model</h4>
                        <select 
                          value={testModelId || ''} 
                          onChange={(e) => { 
                            setTestModelId(e.target.value); 
                            setTestResults([]); 
                            const model = models.find(m => m.id === e.target.value);
                            if (model) {
                              setTestConfidence(model.recommendedConfidence || 0.7);
                              setTestOcrFormat(model.recommendedOcrFormat || '');
                            } else {
                              setTestConfidence(0.7);
                              setTestOcrFormat('');
                            }
                          }}
                          className="panel-select"
                        >
                          <option value="">-- Select model --</option>
                          {models.map(m => (
                            <option key={m.id} value={m.id}>{m.className}</option>
                          ))}
                        </select>
                      </div>
                      
                      {/* Recommended Settings */}
                      {testModelId && (
                        <div className="panel-section">
                          <h4>📋 Recommended Settings</h4>
                          
                          <div className="panel-setting-row">
                            <label>Confidence</label>
                            <div className="panel-slider-control">
                              <input 
                                type="range" 
                                min="0.1" 
                                max="1" 
                                step="0.025"
                                value={testConfidence}
                                onChange={(e) => setTestConfidence(parseFloat(e.target.value))}
                              />
                              <span className="panel-value">{Math.round(testConfidence * 100)}%</span>
                            </div>
                          </div>
                          
                          <div className="panel-setting-row">
                            <label>Format</label>
                            <span className="format-helper-text">Enter the example format of the text</span>
                            <input 
                              type="text"
                              className="panel-input"
                              placeholder="Enter text"
                              value={testOcrFormat}
                              onChange={(e) => setTestOcrFormat(e.target.value.toUpperCase())}
                            />
                            {testOcrFormat ? (
                              <span className="panel-pattern">
                                Pattern: {testOcrFormat.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N')}
                              </span>
                            ) : (
                              <span className="format-hint">If left blank, there will be no format to look for and training won't extract text</span>
                            )}
                          </div>
                          
                          <button 
                            className="panel-action-btn run-detection-btn"
                            onClick={() => handleTestModel(testModelId)}
                            disabled={!testModelId || isTesting}
                          >
                            {isTesting ? '⏳ Running...' : '▶ Run Detection'}
                          </button>
                          
                          {testResults.length > 0 && (
                            <div className="panel-results-badge">{testResults.length} found</div>
                          )}
                          
                          <button 
                            className="panel-save-btn"
                            onClick={async () => {
                              const model = models.find(m => m.id === testModelId);
                              if (model) {
                                const pattern = testOcrFormat ? testOcrFormat.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N') : null;
                                const updatedModel = { 
                                  ...model, 
                                  recommendedConfidence: testConfidence,
                                  recommendedOcrFormat: testOcrFormat || null,
                                  recommendedOcrPattern: pattern
                                };
                                await saveModel(updatedModel);
                                const allModels = await getModels(projectId);
                                const smartLinkModels = (allModels || []).filter(m => m.modelType === 'Smart Link');
                                setModels(smartLinkModels);
                                alert(`✓ Saved settings for "${model.className}"`);
                              }
                            }}
                          >
                            Save Settings
                          </button>
                          <span className="save-settings-hint">This will be the default in the Links detector panel</span>
                        </div>
                      )}
                      
                      {/* Results Actions */}
                      {testResults.length > 0 && (
                        <div className="panel-section">
                          <h4>Results</h4>
                          <div className="panel-guidance">
                            <span>⬇️ Missed similar? Lower confidence</span>
                            <span>⬆️ False positives? Raise confidence</span>
                          </div>
                          <button 
                            className="panel-clear-btn"
                            onClick={() => setTestResults([])}
                          >
                            Clear Results
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              ) : (
                <div className="training-empty-state">
                  <span className="empty-state-text">No Document Selected</span>
                </div>
              )}
            </div>
          ) : selectedItem === 'home' ? (
            // Home content
            <div className="home-content">
              <div className="home-header-section">
                <div className="home-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                </div>
                <h2>Links Overview</h2>
                <p className="home-subtitle">Manage document cross-references and hyperlinks</p>
              </div>
              
              <div className="home-stats-row">
                <div className="stat-card" style={{ background: 'transparent', border: '1px solid #333' }}>
                  <div className="stat-number" style={{ color: '#fff', fontWeight: 700 }}>{models.length}</div>
                  <div className="stat-label" style={{ color: '#888', fontWeight: 600 }}>Models</div>
                </div>
                <div className="stat-card" style={{ background: 'transparent', border: '1px solid #333' }}>
                  <div className="stat-number" style={{ color: '#fff', fontWeight: 700 }}>{allLinks.length}</div>
                  <div className="stat-label" style={{ color: '#888', fontWeight: 600 }}>Total Links</div>
                </div>
                <div className="stat-card" style={{ background: 'transparent', border: '1px solid #333' }}>
                  <div className="stat-number" style={{ color: project?.linkColors?.assigned?.stroke || '#27ae60', fontWeight: 700 }}>{allLinks.filter(l => {
                    const targetFile = projectFiles.find(f => f.id === l.targetFileId);
                    return l.targetFileId && targetFile;
                  }).length}</div>
                  <div className="stat-label" style={{ color: '#888', fontWeight: 600 }}>Assigned</div>
                </div>
                <div className="stat-card" style={{ background: 'transparent', border: '1px solid #333' }}>
                  <div className="stat-number" style={{ color: project?.linkColors?.unassigned?.stroke || '#e74c3c', fontWeight: 700 }}>{allLinks.filter(l => !l.targetFileId).length}</div>
                  <div className="stat-label" style={{ color: '#888', fontWeight: 600 }}>Unassigned</div>
                </div>
              </div>

              {/* Link Distribution Pie Chart with Color Selection */}
              {allLinks.length > 0 && (
                <div className="link-distribution-section" style={{ background: 'transparent', border: 'none', width: '100%', marginBottom: '24px' }}>
                  <h3 style={{ color: '#fff', fontWeight: 700, textAlign: 'center', marginBottom: '20px' }}>Link Distribution</h3>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '48px' }}>
                    {/* Pie Chart */}
                    <div style={{ position: 'relative', width: '200px', height: '200px' }}>
                      <svg width="200" height="200" viewBox="0 0 200 200">
                        {(() => {
                          const assignedCount = allLinks.filter(l => {
                            const targetFile = projectFiles.find(f => f.id === l.targetFileId);
                            return l.targetFileId && targetFile;
                          }).length;
                          const unassignedCount = allLinks.filter(l => !l.targetFileId).length;
                          const total = assignedCount + unassignedCount;
                          if (total === 0) return null;
                          
                          const assignedPercent = assignedCount / total;
                          const assignedAngle = assignedPercent * 360;
                          const assignedStrokeColor = project?.linkColors?.assigned?.stroke || '#27ae60';
                          const assignedFillColor = project?.linkColors?.assigned?.fill || 'rgba(39, 174, 96, 0.3)';
                          const unassignedStrokeColor = project?.linkColors?.unassigned?.stroke || '#e74c3c';
                          const unassignedFillColor = project?.linkColors?.unassigned?.fill || 'rgba(231, 76, 60, 0.3)';
                          const assignedShowFill = project?.linkColors?.assigned?.showFill !== false;
                          const assignedShowLine = project?.linkColors?.assigned?.showLine !== false;
                          const unassignedShowFill = project?.linkColors?.unassigned?.showFill !== false;
                          const unassignedShowLine = project?.linkColors?.unassigned?.showLine !== false;
                          
                          // Create pie slices using arc paths
                          const cx = 100, cy = 100, r = 85;
                          const startAngle = -90; // Start from top
                          
                          const polarToCartesian = (angle) => {
                            const rad = (angle * Math.PI) / 180;
                            return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
                          };
                          
                          const start1 = polarToCartesian(startAngle);
                          const end1 = polarToCartesian(startAngle + assignedAngle);
                          const largeArc1 = assignedAngle > 180 ? 1 : 0;
                          
                          const start2 = end1;
                          const end2 = polarToCartesian(startAngle + 360);
                          const largeArc2 = (360 - assignedAngle) > 180 ? 1 : 0;
                          
                          return (
                            <>
                              {assignedCount > 0 && (assignedShowFill || assignedShowLine) && (
                                <path
                                  d={assignedCount === total 
                                    ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
                                    : `M ${cx} ${cy} L ${start1.x} ${start1.y} A ${r} ${r} 0 ${largeArc1} 1 ${end1.x} ${end1.y} Z`
                                  }
                                  fill={assignedShowFill ? assignedFillColor : 'transparent'}
                                  stroke={assignedShowLine ? assignedStrokeColor : 'none'}
                                  strokeWidth={assignedShowLine ? 3 : 0}
                                />
                              )}
                              {unassignedCount > 0 && (unassignedShowFill || unassignedShowLine) && (
                                <path
                                  d={unassignedCount === total
                                    ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
                                    : `M ${cx} ${cy} L ${start2.x} ${start2.y} A ${r} ${r} 0 ${largeArc2} 1 ${end2.x} ${end2.y} Z`
                                  }
                                  fill={unassignedShowFill ? unassignedFillColor : 'transparent'}
                                  stroke={unassignedShowLine ? unassignedStrokeColor : 'none'}
                                  strokeWidth={unassignedShowLine ? 3 : 0}
                                />
                              )}
                            </>
                          );
                        })()}
                      </svg>
                    </div>
                    
                    {/* Color Selection */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                      {/* Assigned Options */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ color: '#fff', fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                          Assigned
                          <span style={{ color: '#888', fontWeight: 400, fontSize: '12px', marginLeft: '8px' }}>
                            {allLinks.filter(l => {
                              const targetFile = projectFiles.find(f => f.id === l.targetFileId);
                              return l.targetFileId && targetFile;
                            }).length} links ({allLinks.length > 0 ? Math.round(allLinks.filter(l => {
                              const targetFile = projectFiles.find(f => f.id === l.targetFileId);
                              return l.targetFileId && targetFile;
                            }).length / allLinks.length * 100) : 0}%)
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '16px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: project?.linkColors?.assigned?.showLine === false ? '#555' : '#aaa', fontSize: '12px', transition: 'color 0.15s' }}>
                            <input 
                              type="checkbox" 
                              checked={project?.linkColors?.assigned?.showLine !== false}
                              onChange={async (e) => {
                                const colors = { ...project?.linkColors };
                                colors.assigned = { ...colors.assigned, showLine: e.target.checked };
                                const updated = { ...project, linkColors: colors };
                                setProject(updated);
                                await saveProject(updated);
                              }}
                            />
                            Line
                            <input 
                              type="color" 
                              value={project?.linkColors?.assigned?.stroke || '#27ae60'}
                              disabled={project?.linkColors?.assigned?.showLine === false}
                              onChange={async (e) => {
                                const colors = { ...project?.linkColors };
                                colors.assigned = { ...colors.assigned, stroke: e.target.value };
                                const updated = { ...project, linkColors: colors };
                                setProject(updated);
                                await saveProject(updated);
                              }}
                              style={{ width: '24px', height: '24px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'transparent', opacity: project?.linkColors?.assigned?.showLine === false ? 0.3 : 1 }}
                            />
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: project?.linkColors?.assigned?.showFill === false ? '#555' : '#aaa', fontSize: '12px', transition: 'color 0.15s' }}>
                            <input 
                              type="checkbox" 
                              checked={project?.linkColors?.assigned?.showFill !== false}
                              onChange={async (e) => {
                                const colors = { ...project?.linkColors };
                                colors.assigned = { ...colors.assigned, showFill: e.target.checked };
                                const updated = { ...project, linkColors: colors };
                                setProject(updated);
                                await saveProject(updated);
                              }}
                            />
                            Fill
                            <input 
                              type="color" 
                              value={(() => {
                                const fill = project?.linkColors?.assigned?.fill;
                                if (!fill) return '#27ae60';
                                const match = fill.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                                if (match) {
                                  const [_, r, g, b] = match;
                                  return '#' + [r, g, b].map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
                                }
                                return fill;
                              })()}
                              disabled={project?.linkColors?.assigned?.showFill === false}
                              onChange={async (e) => {
                                const hex = e.target.value;
                                const r = parseInt(hex.slice(1,3), 16);
                                const g = parseInt(hex.slice(3,5), 16);
                                const b = parseInt(hex.slice(5,7), 16);
                                const colors = { ...project?.linkColors };
                                colors.assigned = { ...colors.assigned, fill: `rgba(${r}, ${g}, ${b}, 0.3)` };
                                const updated = { ...project, linkColors: colors };
                                setProject(updated);
                                await saveProject(updated);
                              }}
                              style={{ width: '24px', height: '24px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'transparent', opacity: project?.linkColors?.assigned?.showFill === false ? 0.3 : 1 }}
                            />
                          </label>
                        </div>
                      </div>
                      
                      {/* Unassigned Options */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ color: '#fff', fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                          Unassigned
                          <span style={{ color: '#888', fontWeight: 400, fontSize: '12px', marginLeft: '8px' }}>
                            {allLinks.filter(l => !l.targetFileId).length} links ({allLinks.length > 0 ? Math.round(allLinks.filter(l => !l.targetFileId).length / allLinks.length * 100) : 0}%)
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '16px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: project?.linkColors?.unassigned?.showLine === false ? '#555' : '#aaa', fontSize: '12px', transition: 'color 0.15s' }}>
                            <input 
                              type="checkbox" 
                              checked={project?.linkColors?.unassigned?.showLine !== false}
                              onChange={async (e) => {
                                const colors = { ...project?.linkColors };
                                colors.unassigned = { ...colors.unassigned, showLine: e.target.checked };
                                const updated = { ...project, linkColors: colors };
                                setProject(updated);
                                await saveProject(updated);
                              }}
                            />
                            Line
                            <input 
                              type="color" 
                              value={project?.linkColors?.unassigned?.stroke || '#e74c3c'}
                              disabled={project?.linkColors?.unassigned?.showLine === false}
                              onChange={async (e) => {
                                const colors = { ...project?.linkColors };
                                colors.unassigned = { ...colors.unassigned, stroke: e.target.value };
                                const updated = { ...project, linkColors: colors };
                                setProject(updated);
                                await saveProject(updated);
                              }}
                              style={{ width: '24px', height: '24px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'transparent', opacity: project?.linkColors?.unassigned?.showLine === false ? 0.3 : 1 }}
                            />
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: project?.linkColors?.unassigned?.showFill === false ? '#555' : '#aaa', fontSize: '12px', transition: 'color 0.15s' }}>
                            <input 
                              type="checkbox" 
                              checked={project?.linkColors?.unassigned?.showFill !== false}
                              onChange={async (e) => {
                                const colors = { ...project?.linkColors };
                                colors.unassigned = { ...colors.unassigned, showFill: e.target.checked };
                                const updated = { ...project, linkColors: colors };
                                setProject(updated);
                                await saveProject(updated);
                              }}
                            />
                            Fill
                            <input 
                              type="color" 
                              value={(() => {
                                const fill = project?.linkColors?.unassigned?.fill;
                                if (!fill) return '#e74c3c';
                                const match = fill.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                                if (match) {
                                  const [_, r, g, b] = match;
                                  return '#' + [r, g, b].map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
                                }
                                return fill;
                              })()}
                              disabled={project?.linkColors?.unassigned?.showFill === false}
                              onChange={async (e) => {
                                const hex = e.target.value;
                                const r = parseInt(hex.slice(1,3), 16);
                                const g = parseInt(hex.slice(3,5), 16);
                                const b = parseInt(hex.slice(5,7), 16);
                                const colors = { ...project?.linkColors };
                                colors.unassigned = { ...colors.unassigned, fill: `rgba(${r}, ${g}, ${b}, 0.3)` };
                                const updated = { ...project, linkColors: colors };
                                setProject(updated);
                                await saveProject(updated);
                              }}
                              style={{ width: '24px', height: '24px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'transparent', opacity: project?.linkColors?.unassigned?.showFill === false ? 0.3 : 1 }}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Quick Actions */}
              <div className="home-actions-section" style={{ background: 'transparent', border: 'none', padding: 0, width: '100%' }}>
                <h3 style={{ color: '#fff', fontWeight: 700, textAlign: 'center', marginBottom: '16px' }}>Quick Actions</h3>
                <div className="home-actions-grid" style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                  <div className="action-card" onClick={() => {
                    setSelectedItem('train');
                    setSelectedPdf(null);
                    setModelName('');
                    setTrainingBoxes([]);
                  }}>
                    <div className="action-row">
                      <div className="action-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                          <path d="M12 5v14M5 12h14"/>
                        </svg>
                      </div>
                      <div className="action-title">Train Model</div>
                    </div>
                    <div className="action-desc">Create a new link detector</div>
                  </div>
                  
                  <div className="action-card" onClick={handleExportLinks}>
                    <div className="action-row">
                      <div className="action-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                        </svg>
                      </div>
                      <div className="action-title">Export JSON</div>
                    </div>
                    <div className="action-desc">Full backup of all links</div>
                  </div>
                  
                  <div className="action-card" onClick={handleExportLinksCSV}>
                    <div className="action-row">
                      <div className="action-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <path d="M14 2v6h6M8 13h8M8 17h8"/>
                        </svg>
                      </div>
                      <div className="action-title">Export CSV</div>
                    </div>
                    <div className="action-desc">Spreadsheet format</div>
                  </div>
                  
                  <div className="action-card" onClick={() => linksFileInputRef.current?.click()}>
                    <div className="action-row">
                      <div className="action-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                        </svg>
                      </div>
                      <div className="action-title">Import</div>
                    </div>
                    <div className="action-desc">Load JSON file</div>
                  </div>
                </div>
                <input
                  ref={linksFileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleLinksFileSelect}
                  style={{ display: 'none' }}
                />
              </div>

              {(brokenLinksInfo.total > 0 || orphanedLinksInfo.total > 0) && (
                <div className="home-warnings-section">
                  <h3>Attention Required</h3>
                  <div className="warnings-grid">
                    {brokenLinksInfo.total > 0 && (
                      <div className="warning-card broken">
                        <div className="warning-number">{brokenLinksInfo.total}</div>
                        <div className="warning-label">Broken Links</div>
                        <div className="warning-desc">Target files have been removed</div>
                      </div>
                    )}
                    {orphanedLinksInfo.total > 0 && (
                      <div className="warning-card orphaned">
                        <div className="warning-number">{orphanedLinksInfo.total}</div>
                        <div className="warning-label">Orphaned Links</div>
                        <div className="warning-desc">Source files have been removed</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : selectedItem === 'links' ? (
            // Document Links view
            <div className="links-data-view">
              <div className="links-data-header">
                <div className="header-left">
                  <h2>Document Links</h2>
                  <span className="link-count">{filteredLinks.length} of {allLinks.length} links</span>
                </div>
                <div className="header-actions">
                  <button 
                    className="header-action-btn"
                    onClick={handleRefreshLinks}
                    title="Auto-assign unassigned links based on their labels"
                  >
                    Refresh
                  </button>
                  <button 
                    className="header-action-btn"
                    disabled={allLinks.length === 0}
                    onClick={() => {
                      if (allLinks.length === 0) return;
                      // Export links to CSV
                      const headers = ['#', 'Status', 'Assigned Type', 'Source Document', 'Label - Extracted Text', 'Target Document', 'Target Link Number', 'Page', 'X', 'Y', 'Width', 'Height'];
                      const rows = filteredLinks.map((link, index) => {
                        const sourceFile = projectFiles.find(f => f.id === link.sourceFileId);
                        const targetFile = projectFiles.find(f => f.id === link.targetFileId);
                        const assignedType = !link.targetFileId ? 'Unassigned' : link.assignmentMode === 'property' ? 'Detector - Document Property' : link.assignmentMode === 'manual' ? 'Target Document Changed' : link.assignmentMode === 'drawn' ? 'Assigned on Document' : 'Detector - Document Name';
                        return [
                          index + 1,
                          link.targetFileId ? 'Assigned' : 'Unassigned',
                          assignedType,
                          sourceFile?.name || '',
                          link.label || '',
                          targetFile?.name || '',
                          link.targetLinkNumber || '',
                          (link.page || 0) + 1,
                          link.x?.toFixed(4) || '',
                          link.y?.toFixed(4) || '',
                          link.width?.toFixed(4) || '',
                          link.height?.toFixed(4) || ''
                        ].join(',');
                      });
                      const csv = [headers.join(','), ...rows].join('\n');
                      const blob = new Blob([csv], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${project?.name || 'project'}_links.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    title={allLinks.length === 0 ? "No links to export" : "Export links to CSV"}
                  >
                    Export
                  </button>
                  <button 
                    className={`header-action-btn ${showFindReplace ? 'active' : ''}`}
                    onClick={() => setShowFindReplace(!showFindReplace)}
                    title="Find and Replace (Ctrl+H)"
                  >
                    Find & Replace
                  </button>
                  {/* Orphaned links dropdown */}
                  {orphanedLinksInfo.total > 0 && (
                    <div className="orphaned-dropdown-container">
                      <button 
                        className={`orphaned-dropdown-trigger ${showOrphanedPanel ? 'active' : ''}`}
                        onClick={() => setShowOrphanedPanel(!showOrphanedPanel)}
                        title="View orphaned links by deleted file"
                      >
                        <span className="orphaned-badge">⚠️ {orphanedLinksInfo.total} orphaned</span>
                        <span className="dropdown-arrow">{showOrphanedPanel ? '▲' : '▼'}</span>
                      </button>
                      {showOrphanedPanel && (
                        <div className="orphaned-dropdown-panel">
                          <div className="orphaned-panel-header">
                            <span>Orphaned Links by Deleted File</span>
                            <button 
                              className="delete-all-orphaned-btn"
                              onClick={() => { handleDeleteAllOrphaned(); setShowOrphanedPanel(false); }}
                              title="Delete all orphaned links"
                            >
                              Delete All
                            </button>
                          </div>
                          <div className="orphaned-files-list">
                            {orphanedLinksInfo.fileIds.map(fileId => (
                              <div key={fileId} className="orphaned-file-row">
                                <div className="orphaned-file-info">
                                  <span className="orphaned-file-name">
                                    {orphanedLinksInfo.fileNames[fileId] || `ID: ${fileId.substring(0, 12)}...`}
                                  </span>
                                  <span className="orphaned-file-count">
                                    {orphanedLinksInfo.byFile[fileId]?.length} link{orphanedLinksInfo.byFile[fileId]?.length !== 1 ? 's' : ''}
                                  </span>
                                </div>
                                <div className="orphaned-file-actions">
                                  <button 
                                    className="reassign-file-btn"
                                    onClick={() => {
                                      setReassignSourceFile(fileId);
                                      setReassignTargetFile(null);
                                      setShowReassignDialog(true);
                                      setShowOrphanedPanel(false);
                                    }}
                                    title="Reassign these links to another file"
                                  >
                                    Reassign
                                  </button>
                                  <button 
                                    className="delete-file-orphans-btn"
                                    onClick={() => { handleDeleteOrphanedForFile(fileId); }}
                                    title="Delete orphaned links from this file"
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Broken links dropdown */}
                  {brokenLinksInfo.total > 0 && (
                    <div className="orphaned-dropdown-container">
                      <button 
                        className={`orphaned-dropdown-trigger broken ${showBrokenPanel ? 'active' : ''}`}
                        onClick={() => setShowBrokenPanel(!showBrokenPanel)}
                        title="View broken links by deleted target"
                      >
                        <span className="orphaned-badge">🔗 {brokenLinksInfo.total} broken</span>
                        <span className="dropdown-arrow">{showBrokenPanel ? '▲' : '▼'}</span>
                      </button>
                      {showBrokenPanel && (
                        <div className="orphaned-dropdown-panel">
                          <div className="orphaned-panel-header broken">
                            <span>Broken Links by Deleted Target</span>
                            <button 
                              className="delete-all-orphaned-btn"
                              onClick={() => { handleDeleteAllBroken(); setShowBrokenPanel(false); }}
                              title="Delete all broken links"
                            >
                              Delete All
                            </button>
                          </div>
                          <div className="orphaned-files-list">
                            {brokenLinksInfo.fileIds.map(fileId => (
                              <div key={fileId} className="orphaned-file-row">
                                <div className="orphaned-file-info">
                                  <span className="orphaned-file-name">
                                    {brokenLinksInfo.fileNames[fileId] || `ID: ${fileId.substring(0, 12)}...`}
                                  </span>
                                  <span className="orphaned-file-count">
                                    {brokenLinksInfo.byFile[fileId]?.length} link{brokenLinksInfo.byFile[fileId]?.length !== 1 ? 's' : ''}
                                  </span>
                                </div>
                                <div className="orphaned-file-actions">
                                  <button 
                                    className="reassign-file-btn"
                                    onClick={() => {
                                      setBrokenReassignOldTarget(fileId);
                                      setBrokenReassignNewTarget(null);
                                      setShowBrokenReassignDialog(true);
                                      setShowBrokenPanel(false);
                                    }}
                                    title="Reassign these links to a new target"
                                  >
                                    Reassign
                                  </button>
                                  <button 
                                    className="delete-file-orphans-btn"
                                    onClick={() => { handleDeleteBrokenForFile(fileId); }}
                                    title="Delete broken links targeting this file"
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {filteredLinks.length > 0 && (
                    <button 
                      className="header-action-btn danger"
                      onClick={handleDeleteFilteredLinks}
                      title={Object.values(linkFilters).some(v => v && v.trim && v.trim()) 
                        ? `Delete ${filteredLinks.length} filtered link(s)` 
                        : `Delete all ${filteredLinks.length} link(s)`}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              
              {/* Find and Replace Panel */}
              {showFindReplace && (
                <div className="find-replace-panel">
                  <div className="find-replace-row">
                    <label>Find</label>
                    <input
                      type="text"
                      value={findText}
                      onChange={(e) => setFindText(e.target.value)}
                      placeholder="Search text..."
                      autoFocus
                    />
                    <span className="field-label">in</span>
                    <select value={findField} onChange={(e) => setFindField(e.target.value)}>
                      <option value="label">Label - Extracted Text</option>
                    </select>
                    <label className="match-case-label">
                      <input
                        type="checkbox"
                        checked={matchCase}
                        onChange={(e) => setMatchCase(e.target.checked)}
                      />
                      Match case
                    </label>
                  </div>
                  <div className="find-replace-row">
                    <label>Replace</label>
                    <input
                      type="text"
                      value={replaceText}
                      onChange={(e) => setReplaceText(e.target.value)}
                      placeholder="Replace with..."
                    />
                    <span className="match-count">
                      {findText ? `${findMatches.length} match${findMatches.length !== 1 ? 'es' : ''}` : ''}
                    </span>
                    <button 
                      className="replace-all-btn"
                      onClick={handleReplaceAll}
                      disabled={!findText || findMatches.length === 0}
                    >
                      Replace All
                    </button>
                    <button 
                      className="close-find-btn"
                      onClick={() => { setShowFindReplace(false); setFindText(''); setReplaceText(''); }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              )}
              
              <div ref={tableRef} className="links-table-wrapper">
                <table className="links-table">
                  <thead>
                    <tr>
                      <th className="find-column">
                        <div className="th-content">
                          <div className="th-header"><span>Find</span></div>
                        </div>
                      </th>
                      <th className="image-column">
                        <div className="th-content">
                          <div className="th-header">
                            <span>Image</span>
                            <button 
                              className="show-all-images-btn"
                              onClick={() => {
                                filteredLinks.forEach(link => {
                                  if (!linkThumbnails[link.id] && !loadingLinkThumbnails[link.id]) {
                                    loadLinkThumbnail(link);
                                  }
                                });
                              }}
                            >
                              Show All
                            </button>
                          </div>
                        </div>
                      </th>
                      <th className="index-column">
                        <div className="th-content">
                          <div className="th-header"><span>#</span></div>
                        </div>
                      </th>
                      <th className="status-column" style={{ width: getLinkColumnWidth('status'), minWidth: getLinkColumnWidth('status') }}>
                        <div className="th-content">
                          <div className="th-header"><span>Status</span></div>
                          <select
                            value={linkFilters.status || ''}
                            onChange={(e) => setLinkFilters(prev => ({ ...prev, status: e.target.value }))}
                            className="th-filter-select"
                          >
                            <option value="">All</option>
                            <option value="assigned">Assigned</option>
                            <option value="unassigned">Unassigned</option>
                            {brokenLinksInfo.total > 0 && (
                              <option value="broken">Broken ({brokenLinksInfo.total})</option>
                            )}
                            {orphanedLinksInfo.total > 0 && (
                              <option value="orphaned">Orphaned ({orphanedLinksInfo.total})</option>
                            )}
                          </select>
                        </div>
                        <div className="column-resizer" onMouseDown={(e) => handleLinkColumnResizeStart(e, 'status')} />
                      </th>
                      <th style={{ width: getLinkColumnWidth('assignedType'), minWidth: getLinkColumnWidth('assignedType') }}>
                        <div className="th-content">
                          <div className="th-header"><span>Assigned Type</span></div>
                          <div className="th-controls">
                            <select
                              value={linkFilters.assignedType || ''}
                              onChange={(e) => setLinkFilters(prev => ({ ...prev, assignedType: e.target.value }))}
                              className="th-filter-select"
                            >
                              <option value="">All</option>
                              <option value="Document Name">Detector - Document Name</option>
                              <option value="Property">Detector - Document Property</option>
                              <option value="Manual">Target Document Changed</option>
                              <option value="Drawn">Assigned on Document</option>
                              <option value="Unassigned">Unassigned</option>
                            </select>
                          </div>
                        </div>
                        <div className="column-resizer" onMouseDown={(e) => handleLinkColumnResizeStart(e, 'assignedType')} />
                      </th>
                      <th style={{ width: getLinkColumnWidth('source'), minWidth: getLinkColumnWidth('source') }}>
                        <div className="th-content">
                          <div className="th-header"><span>Source Document</span></div>
                          <div className="th-controls">
                            <input
                              type="text"
                              placeholder="Filter..."
                              value={linkFilters.source || ''}
                              onChange={(e) => setLinkFilters(prev => ({ ...prev, source: e.target.value }))}
                              className="th-filter-input"
                            />
                            <button
                              className="align-btn"
                              onClick={(e) => { e.stopPropagation(); toggleLinkColumnAlignment('source'); }}
                              title={`Align ${getLinkColumnAlignment('source')} (click to change)`}
                            >
                              {getLinkColumnAlignment('source') === 'left' && (
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v1H2V3zm0 4h8v1H2V7zm0 4h10v1H2v-1z"/></svg>
                              )}
                              {getLinkColumnAlignment('source') === 'center' && (
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v1H2V3zm2 4h8v1H4V7zm1 4h6v1H5v-1z"/></svg>
                              )}
                              {getLinkColumnAlignment('source') === 'right' && (
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v1H2V3zm6 4h6v1H8V7zm4 4h2v1h-2v-1z"/></svg>
                              )}
                            </button>
                          </div>
                        </div>
                        <div className="column-resizer" onMouseDown={(e) => handleLinkColumnResizeStart(e, 'source')} />
                      </th>
                      <th style={{ width: getLinkColumnWidth('label'), minWidth: getLinkColumnWidth('label') }}>
                        <div className="th-content">
                          <div className="th-header"><span>Label - Extracted Text</span></div>
                          <div className="th-controls">
                            <input
                              type="text"
                              placeholder="Filter..."
                              value={linkFilters.label || ''}
                              onChange={(e) => setLinkFilters(prev => ({ ...prev, label: e.target.value }))}
                              className="th-filter-input"
                            />
                            <button
                              className="align-btn"
                              onClick={(e) => { e.stopPropagation(); toggleLinkColumnAlignment('label'); }}
                              title={`Align ${getLinkColumnAlignment('label')} (click to change)`}
                            >
                              {getLinkColumnAlignment('label') === 'left' && (
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v1H2V3zm0 4h8v1H2V7zm0 4h10v1H2v-1z"/></svg>
                              )}
                              {getLinkColumnAlignment('label') === 'center' && (
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v1H2V3zm2 4h8v1H4V7zm1 4h6v1H5v-1z"/></svg>
                              )}
                              {getLinkColumnAlignment('label') === 'right' && (
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v1H2V3zm6 4h6v1H8V7zm4 4h2v1h-2v-1z"/></svg>
                              )}
                            </button>
                          </div>
                        </div>
                        <div className="column-resizer" onMouseDown={(e) => handleLinkColumnResizeStart(e, 'label')} />
                      </th>
                      <th style={{ width: getLinkColumnWidth('target'), minWidth: getLinkColumnWidth('target') }}>
                        <div className="th-content">
                          <div className="th-header"><span>Target Document</span></div>
                          <div className="th-controls">
                            <input
                              type="text"
                              placeholder="Filter..."
                              value={linkFilters.target || ''}
                              onChange={(e) => setLinkFilters(prev => ({ ...prev, target: e.target.value }))}
                              className="th-filter-input"
                            />
                            <button
                              className="align-btn"
                              onClick={(e) => { e.stopPropagation(); toggleLinkColumnAlignment('target'); }}
                              title={`Align ${getLinkColumnAlignment('target')} (click to change)`}
                            >
                              {getLinkColumnAlignment('target') === 'left' && (
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v1H2V3zm0 4h8v1H2V7zm0 4h10v1H2v-1z"/></svg>
                              )}
                              {getLinkColumnAlignment('target') === 'center' && (
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v1H2V3zm2 4h8v1H4V7zm1 4h6v1H5v-1z"/></svg>
                              )}
                              {getLinkColumnAlignment('target') === 'right' && (
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v1H2V3zm6 4h6v1H8V7zm4 4h2v1h-2v-1z"/></svg>
                              )}
                            </button>
                          </div>
                        </div>
                        <div className="column-resizer" onMouseDown={(e) => handleLinkColumnResizeStart(e, 'target')} />
                      </th>
                      <th style={{ width: getLinkColumnWidth('targetLinkNumber'), minWidth: getLinkColumnWidth('targetLinkNumber') }}>
                        <div className="th-content">
                          <div className="th-header"><span>Target Link Number - Optional</span></div>
                        </div>
                        <div className="column-resizer" onMouseDown={(e) => handleLinkColumnResizeStart(e, 'targetLinkNumber')} />
                      </th>
                      <th className="delete-column">
                        <div className="th-content">
                          <div className="th-header"><span>Delete</span></div>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLinks.length === 0 ? (
                      <tr>
                        <td colSpan="10" className="no-results-row">
                          {allLinks.length === 0 ? 'No links created yet' : 'No links match the filters'}
                        </td>
                      </tr>
                    ) : (
                      filteredLinks.map((link, index) => {
                        const sourceFile = projectFiles.find(f => f.id === link.sourceFileId);
                        const targetFile = projectFiles.find(f => f.id === link.targetFileId);
                        const isAssigned = !!link.targetFileId && !!targetFile; // Only truly assigned if target exists
                        const sourceMissing = !sourceFile && link.sourceFileId;
                        const targetMissing = !targetFile && link.targetFileId; // Target was assigned but file is deleted
                        
                        // Build row class - only highlight problem rows
                        let rowClass = '';
                        if (sourceMissing) {
                          rowClass = 'missing-source-row';
                        } else if (targetMissing) {
                          rowClass = 'broken-target-row';
                        }
                        
                        return (
                          <tr key={link.id} className={rowClass}>
                            <td className="find-cell">
                              <button 
                                className="find-btn"
                                onClick={() => handleFindLink(link)}
                                title="Find in PDF"
                                disabled={sourceMissing}
                              >
                                🔍
                              </button>
                            </td>
                            <td className="image-cell">
                              {linkThumbnails[link.id] ? (
                                <img 
                                  src={linkThumbnails[link.id]} 
                                  alt="Link" 
                                  className="link-thumbnail"
                                />
                              ) : loadingLinkThumbnails[link.id] ? (
                                <span className="loading-thumbnail">...</span>
                              ) : (
                                <button 
                                  className="load-thumbnail-btn"
                                  onClick={() => loadLinkThumbnail(link)}
                                  title="Load image"
                                  disabled={sourceMissing}
                                >
                                  📷
                                </button>
                              )}
                            </td>
                            <td className="index-cell">{index + 1}</td>
                            <td className="status-cell">
                              {sourceMissing ? (
                                <span className="status-badge orphaned">⚠ Orphaned</span>
                              ) : targetMissing ? (
                                <span className="status-badge broken">⚠ Broken</span>
                              ) : (
                                <span 
                                  className="status-text"
                                  style={{
                                    color: isAssigned 
                                      ? (project?.linkColors?.assigned?.stroke || '#27ae60')
                                      : (project?.linkColors?.unassigned?.stroke || '#e74c3c')
                                  }}
                                >
                                  {isAssigned ? '✓ Assigned' : '○ Unassigned'}
                                </span>
                              )}
                            </td>
                            <td className="assigned-type-cell" style={{ textAlign: getLinkColumnAlignment('assignedType') }}>
                              {!link.targetFileId ? (
                                <span style={{ color: '#666' }}>-</span>
                              ) : link.assignmentMode === 'property' ? (
                                <span>Detector - Document Property</span>
                              ) : link.assignmentMode === 'manual' ? (
                                <span>Target Document Changed</span>
                              ) : link.assignmentMode === 'drawn' ? (
                                <span>Assigned on Document</span>
                              ) : (
                                <span>Detector - Document Name</span>
                              )}
                            </td>
                            <td className={sourceMissing ? 'missing-file-cell' : ''} style={{ textAlign: getLinkColumnAlignment('source') }}>
                              {sourceMissing ? (
                                <div className="missing-file-info">
                                  <span className="missing-file-text">⚠ Deleted</span>
                                  <span className="original-file-note" title={`Original File ID: ${link.sourceFileId}`}>
                                    {link.sourceFilename || link.originalFilename || `ID: ${link.sourceFileId?.substring(0, 8)}...`}
                                  </span>
                                </div>
                              ) : (
                                sourceFile?.name || '-'
                              )}
                            </td>
                            <td 
                              className={`clickable-cell ${findText && findMatches.some(m => m.id === link.id) ? 'highlight-match' : ''}`}
                              style={{ textAlign: getLinkColumnAlignment('label') }}
                              onClick={() => {
                                setLabelEditLink(link);
                                setLabelEditValue(link.label || '');
                                setShowLabelEditDialog(true);
                              }}
                              title="Click to edit label"
                            >
                              <span className="cell-text">
                                {link.label || '-'}
                                <span className="edit-icon">✎</span>
                              </span>
                              {findText && findMatches.some(m => m.id === link.id) && (
                                <button 
                                  className="replace-single-btn"
                                  onClick={(e) => { e.stopPropagation(); handleReplaceSingle(link.id); }}
                                  title="Replace in this row"
                                >
                                  ↺
                                </button>
                              )}
                            </td>
                            <td 
                              className={`clickable-cell ${targetMissing ? 'missing-file-cell' : ''}`}
                              style={{ textAlign: getLinkColumnAlignment('target') }}
                              onClick={() => {
                                setLinkToReassign(link);
                                setNewTargetFileId('');
                                setShowLinkReassignDialog(true);
                              }}
                              title="Click to reassign target"
                            >
                              {targetMissing ? (
                                <div className="missing-file-info">
                                  <span className="missing-file-text">⚠ Deleted</span>
                                  <span className="original-file-note" title={`Original File ID: ${link.targetFileId}`}>
                                    {link.targetFilename || `ID: ${link.targetFileId?.substring(0, 8)}...`}
                                  </span>
                                </div>
                              ) : (
                                <span className="cell-text">
                                  {targetFile?.name || <span style={{ color: '#666' }}>- Click to assign -</span>}
                                  <span className="edit-icon">✎</span>
                                </span>
                              )}
                            </td>
                            <td style={{ textAlign: 'center', color: '#666' }}>
                              {link.targetLinkNumber || '-'}
                            </td>
                            <td className="delete-cell">
                              <button 
                                className="delete-link-btn"
                                onClick={() => handleDeleteLink(link.id)}
                                title="Delete this link"
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : selectedModel ? (
            // Model details
            <div className="model-details">
              <div className="model-details-header">
                <h2>{selectedModel.className}</h2>
                <button 
                  className={`view-templates-btn ${showTemplates ? 'active' : ''}`}
                  onClick={handleToggleTemplates}
                  title="View template images used by this model"
                >
                  {showTemplates ? 'Hide' : 'View'} Examples
                </button>
              </div>

              <p className="model-usage-hint">
                Go to the PDF viewer and open the Links panel. Select this model and click "Find Links" to detect similar link tags in your documents.
              </p>

              <div className="model-info-row">
                <span className="info-item"><span className="info-label">Templates:</span> {selectedModel.numTemplates}</span>
                <span className="info-item"><span className="info-label">Created:</span> {selectedModel.created ? new Date(selectedModel.created).toLocaleDateString() : '-'}</span>
              </div>

              {/* Editable Recommended Settings Section */}
              <div className="model-default-settings">
                <h3>Set Default Settings</h3>
                
                <div className="setting-row compact">
                  <label>Confidence Threshold</label>
                  <div className="setting-input-row">
                    <input 
                      type="range" 
                      min="0.1" 
                      max="1" 
                      step="0.025"
                      value={editConfidence}
                      onChange={(e) => setEditConfidence(parseFloat(e.target.value))}
                    />
                    <span className="confidence-display">
                      {(editConfidence * 100) % 1 === 0 ? Math.round(editConfidence * 100) : (editConfidence * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                
                <div className="setting-row">
                  <label>Expected Text Pattern</label>
                  <div className="setting-input-row">
                    <input 
                      type="text"
                      className="format-text-input"
                      placeholder="Enter example text"
                      value={editOcrFormat}
                      onChange={(e) => setEditOcrFormat(e.target.value.toUpperCase())}
                    />
                    {editOcrFormat && (
                      <span className="pattern-display">
                        {editOcrFormat.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N')}
                      </span>
                    )}
                  </div>
                </div>
                
                {/* Assignment Mode Section */}
                <div className="assignment-mode-section">
                  <h4>Extracted Text Assignment</h4>
                  <div className="assignment-mode-options">
                    <label 
                      className={`mode-option ${editAssignmentMode === 'link' ? 'active' : ''}`}
                      onClick={() => setEditAssignmentMode('link')}
                    >
                      <span className="mode-check">{editAssignmentMode === 'link' ? '✓' : ''}</span>
                      Match by Filename
                    </label>
                    <label 
                      className={`mode-option ${editAssignmentMode === 'property' ? 'active' : ''}`}
                      onClick={() => setEditAssignmentMode('property')}
                    >
                      <span className="mode-check">{editAssignmentMode === 'property' ? '✓' : ''}</span>
                      Match by Property
                    </label>
                  </div>
                  
                  {editAssignmentMode === 'link' && (
                    <p className="mode-description">
                      Extracted text will be matched against document filenames for assignment.
                    </p>
                  )}
                  
                  {editAssignmentMode === 'property' && (
                    <div className="property-assignment-config">
                      <p className="mode-description">
                        Extracted text will be matched against the selected document property field values.
                      </p>
                      
                      <div className="property-selectors">
                        <div className="property-selector-group">
                          <label>Property Template:</label>
                          <select 
                            value={editPropertyTemplateId}
                            onChange={(e) => {
                              setEditPropertyTemplateId(e.target.value);
                              setEditPropertyName(''); // Reset property when template changes
                            }}
                          >
                            <option value="">Select template...</option>
                            {(project?.docPropTemplates || []).map(t => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                        </div>
                        
                        {editPropertyTemplateId && (
                          <div className="property-selector-group">
                            <label>Property:</label>
                            <select 
                              value={editPropertyName}
                              onChange={(e) => setEditPropertyName(e.target.value)}
                            >
                              <option value="">Select property...</option>
                              {(project?.docPropTemplates?.find(t => t.id === editPropertyTemplateId)?.properties || []).map(p => (
                                <option key={p.id} value={p.name}>{p.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                      
                      {!project?.docPropTemplates?.length && (
                        <p className="no-templates-warning">
                          No document property templates found. <span className="inline-link" onClick={() => navigate(`/project/${projectId}/docprops`, { state: { returnToFile } })}>Set up properties →</span> Will default to match by filename.
                        </p>
                      )}
                    </div>
                  )}
                </div>
                
                <button 
                  className="save-settings-btn"
                  onClick={async () => {
                    const pattern = editOcrFormat ? editOcrFormat.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N') : null;
                    const updatedModel = { 
                      ...selectedModel, 
                      recommendedConfidence: editConfidence,
                      recommendedOcrFormat: editOcrFormat || null,
                      recommendedOcrPattern: pattern,
                      assignmentMode: editAssignmentMode,
                      propertyTemplateId: editAssignmentMode === 'property' ? editPropertyTemplateId : null,
                      propertyName: editAssignmentMode === 'property' ? editPropertyName : null
                    };
                    await saveModel(updatedModel);
                    const allModels = await getModels(projectId);
                    const smartLinkModels = (allModels || []).filter(m => m.modelType === 'Smart Link');
                    setModels(smartLinkModels);
                    alert(`Settings saved for "${selectedModel.className}"`);
                  }}
                >
                  Save
                </button>
              </div>

              {/* Templates View Section */}
              {showTemplates && (
                <div className="model-templates-section">
                  <h3>
                    Training Examples ({templateImages.length || selectedModel.numTemplates || 0})
                    <span className="templates-help-text">Click ✕ to remove an example from the model</span>
                  </h3>
                  <div className="templates-container">
                    {isLoadingTemplates ? (
                      <div className="templates-loading">
                        <span>Loading examples...</span>
                      </div>
                    ) : templateImages.length > 0 ? (
                      <div className="templates-grid">
                        {templateImages.map((template, idx) => (
                          <div key={template.id || idx} className="template-item">
                            <img 
                              src={template.image} 
                              alt={`Example ${idx + 1}`}
                              title={template.label || `Example ${idx + 1}`}
                            />
                            {template.label && (
                              <span className="template-label">{template.label}</span>
                            )}
                            {(template.id) && (
                              <button 
                                className="remove-example-btn"
                                title="Remove this example from the model"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const exampleId = template.id;
                                  if (!confirm(`Remove this example from "${selectedModel.className}"?\n\nThis will regenerate the model without this training example.`)) {
                                    return;
                                  }
                                  try {
                                    const response = await fetch(
                                      `${DETECTOR_URL}/models/${selectedModel.id}/examples/${encodeURIComponent(exampleId)}`,
                                      { method: 'DELETE' }
                                    );
                                    const result = await response.json();
                                    
                                    if (result.modelDeleted) {
                                      alert('Model deleted (no examples remaining).');
                                      setSelectedItem('home');
                                      setShowTemplates(false);
                                      const allModels = await getModels(projectId);
                                      const smartLinkModels = (allModels || []).filter(m => m.modelType === 'Smart Link');
                                      setModels(smartLinkModels);
                                    } else if (result.success) {
                                      alert(`Example removed and model retrained. ${result.remainingExamples} examples remaining.`);
                                      loadModelTemplates(selectedModel);
                                      const allModels = await getModels(projectId);
                                      const smartLinkModels = (allModels || []).filter(m => m.modelType === 'Smart Link');
                                      setModels(smartLinkModels);
                                    } else {
                                      alert('Failed to remove example: ' + (result.error || 'Unknown error'));
                                    }
                                  } catch (error) {
                                    console.error('Error removing example:', error);
                                    alert('Failed to remove example: ' + error.message);
                                  }
                                }}
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="templates-empty">
                        <p>No template images available</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
          ) : (
            <div className="no-selection">
              <p>Select a model from the sidebar</p>
            </div>
          )}
        </div>
      </div>

      {/* Import Dialog */}
      {showImportDialog && (
        <div className="modal-overlay" onClick={() => { setShowImportDialog(false); setImportData(null); setImportError(null); }}>
          <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Import Links</h2>
            
            {importError ? (
              <div className="import-error">
                <span className="error-icon">⚠️</span>
                <p>{importError}</p>
              </div>
            ) : importData ? (
              <>
                <div className="import-summary">
                  <p><strong>File:</strong> {importData.fileName}</p>
                  <p><strong>Format:</strong> {importData.format}</p>
                  <p><strong>Links found:</strong> {importData.linkCount}</p>
                </div>
                
                <div className="import-mode">
                  <p className="mode-label">Import Mode:</p>
                  <div className="mode-toggle">
                    <button 
                      className={`mode-btn ${importMode === 'merge' ? 'active' : ''}`}
                      onClick={() => setImportMode('merge')}
                    >
                      <span className="mode-title">Merge</span>
                      <span className="mode-desc">Add new, update existing</span>
                    </button>
                    <button 
                      className={`mode-btn ${importMode === 'replace' ? 'active' : ''}`}
                      onClick={() => setImportMode('replace')}
                    >
                      <span className="mode-title">Replace All</span>
                      <span className="mode-desc">Clear & import fresh</span>
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p>Processing file...</p>
            )}
            
            <div className="modal-buttons">
              <button onClick={() => { setShowImportDialog(false); setImportData(null); setImportError(null); }}>
                Cancel
              </button>
              {importData && !importError && (
                <button 
                  className="primary-btn"
                  onClick={handleImportLinks}
                >
                  Import {importData.linkCount} Links
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reassign Orphaned Links Dialog */}
      {showReassignDialog && (
        <div className="modal-overlay" onClick={() => { setShowReassignDialog(false); setReassignSourceFile(null); setReassignTargetFile(null); }}>
          <div className="modal reassign-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Reassign Orphaned Links</h2>
            
            {reassignSourceFile ? (
              <>
                <div className="reassign-source-info">
                  <div className="source-label">From deleted file:</div>
                  <div className="source-file-name">
                    {orphanedLinksInfo.fileNames[reassignSourceFile] || `ID: ${reassignSourceFile.substring(0, 12)}...`}
                  </div>
                  <div className="source-link-count">
                    {orphanedLinksInfo.byFile[reassignSourceFile]?.length} link{orphanedLinksInfo.byFile[reassignSourceFile]?.length !== 1 ? 's' : ''} to reassign
                  </div>
                  {orphanedLinksInfo.fileIds.length > 1 && (
                    <button 
                      className="change-source-btn"
                      onClick={() => setReassignSourceFile(null)}
                    >
                      Change
                    </button>
                  )}
                </div>
                
                <div className="form-group">
                  <label>Select new file to reassign to:</label>
                  <select
                    value={reassignTargetFile?.id || ''}
                    onChange={(e) => {
                      const file = projectFiles.find(f => f.id === e.target.value);
                      setReassignTargetFile(file || null);
                    }}
                    autoFocus
                  >
                    <option value="">-- Select target file --</option>
                    {projectFiles.map(file => (
                      <option key={file.id} value={file.id}>
                        {file.name} {file.folderName ? `(${file.folderName})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <>
                <p className="modal-description">
                  Select which deleted file's links you want to reassign to a new file.
                </p>
                
                <div className="form-group">
                  <label>Source File (deleted)</label>
                  <select
                    value=""
                    onChange={(e) => {
                      setReassignSourceFile(e.target.value || null);
                      setReassignTargetFile(null);
                    }}
                    autoFocus
                  >
                    <option value="">-- Select source file --</option>
                    {orphanedLinksInfo.fileIds.map(fileId => (
                      <option key={fileId} value={fileId}>
                        {orphanedLinksInfo.fileNames[fileId] || `ID: ${fileId.substring(0, 12)}...`} ({orphanedLinksInfo.byFile[fileId]?.length} links)
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            
            {reassignSourceFile && reassignTargetFile && (
              <div className="reassign-info-box">
                <div className="reassign-info-icon">📦</div>
                <div className="reassign-info-content">
                  <strong>Keep Existing Positions</strong>
                  <p>All link coordinates will be preserved on the new file.</p>
                </div>
              </div>
            )}
            
            <div className="reassign-note">
              <strong>💡 When to use:</strong>
              <ul>
                <li><strong>Reassign</strong> – if the new PDF has the same layout and link positions haven't moved</li>
                <li><strong>Delete & Re-detect</strong> – if the layout has changed, delete these orphaned links and run the Links model again on the new file</li>
              </ul>
            </div>
            
            <div className="modal-buttons">
              <button onClick={() => { setShowReassignDialog(false); setReassignSourceFile(null); setReassignTargetFile(null); }}>
                Cancel
              </button>
              {reassignSourceFile && reassignTargetFile && (
                <button 
                  className="primary-btn"
                  onClick={handleReassignKeepCoords}
                  disabled={isReassigning}
                >
                  {isReassigning ? 'Reassigning...' : `Reassign ${orphanedLinksInfo.byFile[reassignSourceFile]?.length} Link(s)`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Broken Links Reassign Dialog */}
      {showBrokenReassignDialog && (
        <div className="modal-overlay" onClick={() => { setShowBrokenReassignDialog(false); setBrokenReassignOldTarget(null); setBrokenReassignNewTarget(null); }}>
          <div className="modal reassign-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Reassign Broken Links</h2>
            
            {brokenReassignOldTarget ? (
              <>
                <div className="reassign-source-info broken">
                  <div className="source-label">Links targeting deleted file:</div>
                  <div className="source-file-name">
                    {brokenLinksInfo.fileNames[brokenReassignOldTarget] || `ID: ${brokenReassignOldTarget.substring(0, 12)}...`}
                  </div>
                  <div className="source-link-count">
                    {brokenLinksInfo.byFile[brokenReassignOldTarget]?.length} link{brokenLinksInfo.byFile[brokenReassignOldTarget]?.length !== 1 ? 's' : ''} to reassign
                  </div>
                  {brokenLinksInfo.fileIds.length > 1 && (
                    <button 
                      className="change-source-btn"
                      onClick={() => setBrokenReassignOldTarget(null)}
                    >
                      Change
                    </button>
                  )}
                </div>
                
                <div className="form-group">
                  <label>Select new target file:</label>
                  <select
                    value={brokenReassignNewTarget?.id || ''}
                    onChange={(e) => {
                      const file = projectFiles.find(f => f.id === e.target.value);
                      setBrokenReassignNewTarget(file || null);
                    }}
                    autoFocus
                  >
                    <option value="">-- Select new target --</option>
                    {projectFiles.map(file => (
                      <option key={file.id} value={file.id}>
                        {file.name} {file.folderName ? `(${file.folderName})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <>
                <p className="modal-description">
                  Select which deleted target file's links you want to reassign to a new target.
                </p>
                
                <div className="form-group">
                  <label>Deleted Target File</label>
                  <select
                    value=""
                    onChange={(e) => {
                      setBrokenReassignOldTarget(e.target.value || null);
                      setBrokenReassignNewTarget(null);
                    }}
                    autoFocus
                  >
                    <option value="">-- Select deleted target --</option>
                    {brokenLinksInfo.fileIds.map(fileId => (
                      <option key={fileId} value={fileId}>
                        {brokenLinksInfo.fileNames[fileId] || `ID: ${fileId.substring(0, 12)}...`} ({brokenLinksInfo.byFile[fileId]?.length} links)
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            
            {brokenReassignOldTarget && brokenReassignNewTarget && (
              <div className="reassign-info-box">
                <div className="reassign-info-icon">🔗</div>
                <div className="reassign-info-content">
                  <strong>Update Target References</strong>
                  <p>All links will point to the new target file instead.</p>
                </div>
              </div>
            )}
            
            <div className="reassign-note">
              <strong>💡 When to use:</strong>
              <ul>
                <li><strong>Reassign</strong> – if you uploaded a new revision of the deleted target file</li>
                <li><strong>Delete</strong> – if the target file is no longer needed and links should be removed</li>
              </ul>
            </div>
            
            <div className="modal-buttons">
              <button onClick={() => { setShowBrokenReassignDialog(false); setBrokenReassignOldTarget(null); setBrokenReassignNewTarget(null); }}>
                Cancel
              </button>
              {brokenReassignOldTarget && brokenReassignNewTarget && (
                <button 
                  className="primary-btn"
                  onClick={handleBrokenReassign}
                  disabled={isReassigning}
                >
                  {isReassigning ? 'Reassigning...' : `Reassign ${brokenLinksInfo.byFile[brokenReassignOldTarget]?.length} Link(s)`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Individual Link Target Reassign Dialog */}
      {showLinkReassignDialog && linkToReassign && (
        <div className="modal-overlay" onClick={() => { setShowLinkReassignDialog(false); setLinkToReassign(null); setNewTargetFileId(''); }}>
          <div className="modal reassign-modal link-reassign-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Assign Target Document</h2>
              <button 
                className="modal-close-btn"
                onClick={() => { setShowLinkReassignDialog(false); setLinkToReassign(null); setNewTargetFileId(''); }}
              >
                ×
              </button>
            </div>
            
            <div className="link-info-box">
              <div className="link-info-label">Link Label</div>
              <div className="link-info-value">{linkToReassign.label || '(No label)'}</div>
            </div>
            
            {linkToReassign.targetFileId && (
              <div className="link-info-box">
                <div className="link-info-label">Currently Assigned To</div>
                <div className="link-info-value">{projectFiles.find(f => f.id === linkToReassign.targetFileId)?.name || '(Unknown)'}</div>
              </div>
            )}
            
            <div className="form-group">
              <label>Target Document</label>
              <select
                value={newTargetFileId}
                onChange={(e) => setNewTargetFileId(e.target.value)}
              >
                <option value="">— None (unassigned) —</option>
                {projectFiles.map(file => (
                  <option key={file.id} value={file.id}>
                    {file.name} {file.folderName ? `(${file.folderName})` : ''}
                  </option>
                ))}
              </select>
            </div>
            
            {newTargetFileId && (
              <div className="reassign-info-box">
                <div className="reassign-info-icon">✓</div>
                <div className="reassign-info-content">
                  <strong>Manual Assignment</strong>
                  <p>This link will be marked as manually assigned.</p>
                </div>
              </div>
            )}
            
            <div className="modal-buttons">
              <button onClick={() => { setShowLinkReassignDialog(false); setLinkToReassign(null); setNewTargetFileId(''); }}>
                Cancel
              </button>
              <button 
                className="primary-btn"
                onClick={handleLinkTargetReassign}
              >
                {newTargetFileId ? 'Save Assignment' : 'Remove Target'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Label Edit Modal */}
      {showLabelEditDialog && labelEditLink && (
        <div className="modal-overlay" onClick={() => { setShowLabelEditDialog(false); setLabelEditLink(null); setLabelEditValue(''); }}>
          <div className="modal reassign-modal label-edit-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '450px' }}>
            <div className="modal-header">
              <h2>Edit Label</h2>
              <button 
                className="modal-close-btn"
                onClick={() => { setShowLabelEditDialog(false); setLabelEditLink(null); setLabelEditValue(''); }}
              >
                ×
              </button>
            </div>
            
            <div style={{ padding: '0 24px 20px' }}>
              <div style={{ 
                background: 'rgba(241, 196, 15, 0.08)', 
                border: '1px solid rgba(241, 196, 15, 0.2)', 
                borderRadius: '8px', 
                padding: '12px 14px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                marginBottom: '20px'
              }}>
                <span style={{ color: '#f1c40f', fontSize: '16px' }}>⚠</span>
                <div style={{ fontSize: '12px', color: '#aaa', lineHeight: '1.5' }}>
                  Changing the label may affect automatic target document matching.
                </div>
              </div>
              
              <div style={{ marginBottom: '8px' }}>
                <label style={{ display: 'block', color: '#fff', fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>
                  Label - Extracted Text
                </label>
                <input
                  type="text"
                  value={labelEditValue}
                  onChange={(e) => setLabelEditValue(e.target.value)}
                  autoFocus
                  style={{ 
                    width: '100%', 
                    padding: '10px 12px', 
                    border: '1px solid #444', 
                    borderRadius: '6px', 
                    background: '#1e1e1e', 
                    color: '#fff',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleLabelSave();
                    } else if (e.key === 'Escape') {
                      setShowLabelEditDialog(false);
                      setLabelEditLink(null);
                      setLabelEditValue('');
                    }
                  }}
                />
              </div>
            </div>
            
            <div className="modal-buttons" style={{ borderTop: '1px solid #333', padding: '16px 24px', background: '#1e1e1e' }}>
              <button 
                onClick={() => { setShowLabelEditDialog(false); setLabelEditLink(null); setLabelEditValue(''); }}
                style={{ background: 'transparent', border: '1px solid #444', color: '#aaa' }}
              >
                Cancel
              </button>
              <button 
                className="primary-btn"
                onClick={handleLabelSave}
                style={{ background: '#3498db', border: 'none', color: '#fff', fontWeight: 600 }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
