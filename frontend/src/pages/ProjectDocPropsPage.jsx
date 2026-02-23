import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getProject, saveProject, getPdfFromBackend, trainDetector, runDetection } from '../utils/storage';
import './ProjectDocPropsPage.css';

// Template Preview Component - displays saved preview image
function TemplatePreview({ template }) {
  if (!template?.previewImage) {
    return (
      <div className="docprops-preview-error">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        <span>No preview available</span>
      </div>
    );
  }

  return (
    <div className="docprops-preview-container">
      <img 
        src={template.previewImage} 
        alt="Template preview" 
        className="docprops-preview-image"
      />
    </div>
  );
}

export default function ProjectDocPropsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnToFile = location.state?.returnToFile || null;
  const [project, setProject] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState('home');
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('docprops_sidebar_width');
    return saved ? parseInt(saved, 10) : 320;
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [templatesSectionHeight, setTemplatesSectionHeight] = useState(() => {
    const saved = localStorage.getItem('docprops_templates_height');
    return saved ? parseInt(saved, 10) : 250;
  });
  const [isResizingTemplates, setIsResizingTemplates] = useState(false);
  
  const [projectFiles, setProjectFiles] = useState([]);
  const [projectFolders, setProjectFolders] = useState([]);
  
  // Wizard state
  const [showWizard, setShowWizard] = useState(false);
  const [wizardPhase, setWizardPhase] = useState('select-pdf');
  const [templateName, setTemplateName] = useState('');
  const [selectedPdf, setSelectedPdf] = useState(null);
  const [properties, setProperties] = useState([]);
  const [outerBoundary, setOuterBoundary] = useState(null);
  const [propertyRegions, setPropertyRegions] = useState([]);
  const [activePropertyIndex, setActivePropertyIndex] = useState(0);
  const [pdfSearchQuery, setPdfSearchQuery] = useState('');
  
  // PDF viewer state
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  const canvasRef = useRef(null);
  const croppedCanvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [croppedSize, setCroppedSize] = useState({ width: 0, height: 0 });
  const isRenderingRef = useRef(false);
  
  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState(null);
  const [currentRect, setCurrentRect] = useState(null);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [viewMode, setViewMode] = useState('select');

  // Extraction state
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState({ current: 0, total: 0 });
  const [testExtractionResults, setTestExtractionResults] = useState(null);
  const [showTestResults, setShowTestResults] = useState(false);
  
  // Training state
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState('');
  
  // Extraction dialog state
  const [showExtractionDialog, setShowExtractionDialog] = useState(false);
  const [extractionScope, setExtractionScope] = useState('all'); // 'assigned', 'unassigned', 'all'
  const [extractionConfidence, setExtractionConfidence] = useState(0.5);
  const [extractionEnableOCR, setExtractionEnableOCR] = useState(true);
  const [extractionPropertyFormats, setExtractionPropertyFormats] = useState({}); // {propName: format}
  const [extractionResults, setExtractionResults] = useState(null); // {success: n, failed: n, results: []}

  // Load project
  useEffect(() => {
    const loadData = async () => {
      try {
        const loadedProject = await getProject(projectId);
        if (loadedProject) {
          setProject(loadedProject);
          const files = [];
          const folders = loadedProject.folders || [];
          setProjectFolders(folders);
          
          const extractFiles = (folderList) => {
            folderList.forEach(folder => {
              if (folder.files) {
                folder.files.forEach(f => files.push({ ...f, folderName: folder.name, folderId: folder.id }));
              }
              if (folder.subfolders) extractFiles(folder.subfolders);
            });
          };
          extractFiles(folders);
          setProjectFiles(files);
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
    loadData();
  }, [projectId, navigate]);

  // Keyboard shortcuts for wizard
  useEffect(() => {
    if (!showWizard) return;
    
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      
      if (e.key === 'v' || e.key === 'V') {
        setViewMode(e.shiftKey ? 'pan' : 'select');
        e.preventDefault();
      } else if (e.key === 'z' || e.key === 'Z') {
        setViewMode('zoom');
        e.preventDefault();
      } else if (e.key === 'Escape') {
        setViewMode('select');
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showWizard]);

  const docPropTemplates = project?.docPropTemplates || [];
  const filteredTemplates = docPropTemplates.filter(t =>
    t.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const selectedTemplate = selectedItem !== 'home' ? docPropTemplates.find(t => t.id === selectedItem) : null;

  const getTemplateFileCount = (templateId) => projectFiles.filter(f => f.docPropTemplateId === templateId).length;
  const getTemplateIssueCount = (templateId) => projectFiles.filter(f => f.docPropTemplateId === templateId && f.docPropExtractionFailed).length;

  // Sidebar resize
  useEffect(() => {
    if (!isResizingSidebar) return;
    const handleMouseMove = (e) => setSidebarWidth(Math.max(320, Math.min(500, e.clientX)));
    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      localStorage.setItem('docprops_sidebar_width', sidebarWidth.toString());
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar, sidebarWidth]);

  // Templates section resize
  useEffect(() => {
    if (!isResizingTemplates) return;
    const handleMouseMove = (e) => {
      const sidebarRect = document.querySelector('.docprops-sidebar')?.getBoundingClientRect();
      if (sidebarRect) {
        const relativeY = e.clientY - sidebarRect.top - 100;
        setTemplatesSectionHeight(Math.max(100, Math.min(400, relativeY)));
      }
    };
    const handleMouseUp = () => {
      setIsResizingTemplates(false);
      localStorage.setItem('docprops_templates_height', templatesSectionHeight.toString());
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingTemplates, templatesSectionHeight]);

  // Wizard functions
  const openWizard = () => {
    setShowWizard(true);
    setWizardPhase('select-pdf');
    setTemplateName('');
    setSelectedPdf(null);
    setProperties([]);
    setOuterBoundary(null);
    setPropertyRegions([]);
    setActivePropertyIndex(0);
    setPdfDoc(null);
    setScale(1);
    setPanOffset({ x: 0, y: 0 });
    setPdfSearchQuery('');
    setViewMode('select');
  };

  const closeWizard = () => {
    setShowWizard(false);
    setPdfDoc(null);
  };

  // Load PDF
  const loadPdf = async (file) => {
    try {
      setSelectedPdf(file);
      const pdfUrl = await getPdfFromBackend(file.backendFilename);
      const pdf = await window.pdfjsLib.getDocument(pdfUrl).promise;
      setPdfDoc(pdf);
      setNumPages(pdf.numPages);
      setCurrentPage(1);
      setScale(1);
      setPanOffset({ x: 0, y: 0 });
    } catch (error) {
      console.error('Error loading PDF:', error);
      alert('Failed to load PDF');
    }
  };

  // Render PDF (full page for step 2)
  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current || isRenderingRef.current) return;
    isRenderingRef.current = true;
    
    try {
      const page = await pdfDoc.getPage(currentPage);
      const baseScale = 2;
      const viewport = page.getViewport({ scale: baseScale });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      setCanvasSize({ width: viewport.width / baseScale, height: viewport.height / baseScale });

      await page.render({ canvasContext: context, viewport }).promise;
    } catch (error) {
      console.error('Render error:', error);
    } finally {
      isRenderingRef.current = false;
    }
  }, [pdfDoc, currentPage]);

  // Render cropped PDF (just title block for step 4)
  const renderCroppedPage = useCallback(async () => {
    if (!pdfDoc || !croppedCanvasRef.current || !outerBoundary || isRenderingRef.current) return;
    isRenderingRef.current = true;
    
    try {
      const page = await pdfDoc.getPage(outerBoundary.page);
      const baseScale = 3; // Higher scale for better quality when cropped
      const fullViewport = page.getViewport({ scale: baseScale });
      
      // Calculate crop area in pixels
      const cropX = outerBoundary.bbox.x * fullViewport.width;
      const cropY = outerBoundary.bbox.y * fullViewport.height;
      const cropW = outerBoundary.bbox.width * fullViewport.width;
      const cropH = outerBoundary.bbox.height * fullViewport.height;
      
      // Create a temporary canvas for full page render
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = fullViewport.width;
      tempCanvas.height = fullViewport.height;
      const tempContext = tempCanvas.getContext('2d');
      
      await page.render({ canvasContext: tempContext, viewport: fullViewport }).promise;
      
      // Now copy just the cropped area to the visible canvas
      const canvas = croppedCanvasRef.current;
      const context = canvas.getContext('2d');
      
      canvas.width = cropW;
      canvas.height = cropH;
      setCroppedSize({ width: cropW / baseScale, height: cropH / baseScale });
      
      context.drawImage(tempCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    } catch (error) {
      console.error('Render cropped error:', error);
    } finally {
      isRenderingRef.current = false;
    }
  }, [pdfDoc, outerBoundary]);

  useEffect(() => {
    if (pdfDoc && wizardPhase === 'draw-boundary') {
      renderPage();
    }
  }, [pdfDoc, currentPage, wizardPhase, renderPage]);

  useEffect(() => {
    if (pdfDoc && wizardPhase === 'draw-regions' && outerBoundary) {
      renderCroppedPage();
    }
  }, [pdfDoc, wizardPhase, outerBoundary, renderCroppedPage]);

  // Reset pan/zoom when entering step 4 and center the cropped canvas
  useEffect(() => {
    if (wizardPhase === 'draw-regions' && croppedSize.width > 0 && containerRef.current) {
      setTimeout(() => {
        if (!containerRef.current) return;
        const containerRect = containerRef.current.getBoundingClientRect();
        const centerX = (containerRect.width - croppedSize.width) / 2 - 20;
        const centerY = (containerRect.height - croppedSize.height) / 2 - 20;
        setScale(1);
        setPanOffset({ x: centerX, y: centerY });
      }, 50);
    }
  }, [wizardPhase, croppedSize]);

  // Zoom with wheel - use ref to attach non-passive listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e) => {
      e.preventDefault();
      
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setScale(prevScale => {
        const newScale = Math.max(0.25, Math.min(5, prevScale * delta));
        
        const rect = container.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;
        
        setPanOffset(prevPan => {
          const canvasPointX = (cursorX - prevPan.x) / prevScale;
          const canvasPointY = (cursorY - prevPan.y) / prevScale;
          return {
            x: cursorX - canvasPointX * newScale,
            y: cursorY - canvasPointY * newScale
          };
        });
        
        return newScale;
      });
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [wizardPhase]); // Re-attach when phase changes since containerRef points to different element

  // Mouse handlers
  const handleMouseDown = (e) => {
    if (!containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const activeCanvasSize = wizardPhase === 'draw-regions' ? croppedSize : canvasSize;
    
    // Right-click or middle-click always pans
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      return;
    }
    
    // Use viewMode for both steps (controlled by keyboard shortcuts)
    if (viewMode === 'pan' && e.button === 0) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      return;
    }
    
    if (viewMode === 'zoom' && e.button === 0) {
      e.preventDefault();
      const zoomFactor = e.shiftKey ? 0.7 : 1.4;
      const newScale = Math.max(0.25, Math.min(5, scale * zoomFactor));
      
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const canvasPointX = (cursorX - panOffset.x) / scale;
      const canvasPointY = (cursorY - panOffset.y) / scale;
      
      setScale(newScale);
      setPanOffset({
        x: cursorX - canvasPointX * newScale,
        y: cursorY - canvasPointY * newScale
      });
      return;
    }
    
    if (viewMode === 'select' && e.button === 0 && activeCanvasSize.width > 0) {
      e.preventDefault();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      // Convert screen coords to canvas coords
      // The canvas container is at fixed (20,20) then has pan and scale applied
      const x = (mouseX - 20 - panOffset.x) / scale / activeCanvasSize.width;
      const y = (mouseY - 20 - panOffset.y) / scale / activeCanvasSize.height;
      
      const clampedX = Math.max(0, Math.min(1, x));
      const clampedY = Math.max(0, Math.min(1, y));
      
      setIsDrawing(true);
      setDrawStart({ x: clampedX, y: clampedY });
      setCurrentRect({ x: clampedX, y: clampedY, width: 0, height: 0 });
    }
  };

  const handleMouseMove = (e) => {
    if (isPanning) {
      setPanOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }
    
    const activeCanvasSize = wizardPhase === 'draw-regions' ? croppedSize : canvasSize;
    if (!isDrawing || !drawStart || !containerRef.current || activeCanvasSize.width === 0) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const x = (mouseX - 20 - panOffset.x) / scale / activeCanvasSize.width;
    const y = (mouseY - 20 - panOffset.y) / scale / activeCanvasSize.height;
    
    const clampedX = Math.max(0, Math.min(1, x));
    const clampedY = Math.max(0, Math.min(1, y));
    
    setCurrentRect({
      x: Math.min(drawStart.x, clampedX),
      y: Math.min(drawStart.y, clampedY),
      width: Math.abs(clampedX - drawStart.x),
      height: Math.abs(clampedY - drawStart.y)
    });
  };

  const handleMouseUp = () => {
    if (isPanning) { setIsPanning(false); return; }
    
    if (!isDrawing || !currentRect) {
      setIsDrawing(false);
      setCurrentRect(null);
      setDrawStart(null);
      return;
    }
    
    if (currentRect.width > 0.01 && currentRect.height > 0.01) {
      if (wizardPhase === 'draw-boundary') {
        setOuterBoundary({ bbox: currentRect, page: currentPage });
      } else if (wizardPhase === 'draw-regions' && properties[activePropertyIndex]) {
        const propId = properties[activePropertyIndex].id;
        // Store regions relative to the title block (coordinates are 0-1 within the cropped area)
        setPropertyRegions(prev => [...prev.filter(r => r.propertyId !== propId), {
          propertyId: propId,
          bbox: currentRect,
          page: outerBoundary?.page || 1
        }]);
      }
    }
    
    setIsDrawing(false);
    setCurrentRect(null);
    setDrawStart(null);
  };

  const handleContextMenu = (e) => e.preventDefault();

  // Property helpers
  const addProperty = () => {
    setProperties(prev => [...prev, { id: `prop_${Date.now()}`, name: '', type: 'text' }]);
  };

  const updateProperty = (id, field, value) => {
    setProperties(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const removeProperty = (id) => {
    setProperties(prev => prev.filter(p => p.id !== id));
    setPropertyRegions(prev => prev.filter(r => r.propertyId !== id));
  };

  const getPropertyColor = (idx) => {
    const colors = ['#3498db', '#27ae60', '#e74c3c', '#9b59b6', '#f39c12', '#1abc9c', '#e91e63', '#00bcd4'];
    return colors[idx % colors.length];
  };

  // Extract text from a PDF region using PDF.js text layer
  const extractTextFromRegion = async (pdf, pageNum, regionBbox, outerBbox) => {
    try {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      
      // Convert outer boundary (0-1 relative to page) to absolute coordinates
      const outerX = outerBbox.x * viewport.width;
      const outerY = outerBbox.y * viewport.height;
      const outerW = outerBbox.width * viewport.width;
      const outerH = outerBbox.height * viewport.height;
      
      // Convert region (0-1 relative to outer boundary) to absolute page coordinates
      const regionX = outerX + (regionBbox.x * outerW);
      const regionY = outerY + (regionBbox.y * outerH);
      const regionW = regionBbox.width * outerW;
      const regionH = regionBbox.height * outerH;
      
      // Find text items within the region
      const textInRegion = [];
      textContent.items.forEach(item => {
        const tx = item.transform[4];
        // PDF.js uses bottom-left origin, so flip Y
        const ty = viewport.height - item.transform[5];
        const itemWidth = item.width || (item.str.length * 5); // estimate if no width
        const itemHeight = item.height || 10;
        
        // Check if text item overlaps with region (with some tolerance)
        const tolerance = 2;
        if (tx + itemWidth >= regionX - tolerance && 
            tx <= regionX + regionW + tolerance &&
            ty + itemHeight >= regionY - tolerance && 
            ty <= regionY + regionH + tolerance) {
          textInRegion.push({
            text: item.str,
            x: tx,
            y: ty
          });
        }
      });
      
      // Sort by position (top to bottom, left to right)
      textInRegion.sort((a, b) => {
        const yDiff = a.y - b.y;
        if (Math.abs(yDiff) > 5) return yDiff; // Different lines
        return a.x - b.x; // Same line, sort by x
      });
      
      // Join text
      return textInRegion.map(t => t.text).join(' ').trim();
    } catch (error) {
      console.error('Error extracting text from region:', error);
      return '';
    }
  };

  // Extract all properties from a PDF using a template
  // If template has a modelId, runs detection first to find title block
  // Otherwise falls back to fixed coordinates
  const extractPropertiesFromPdf = async (pdfFilename, template, options = {}) => {
    try {
      const { useDetection = true, pageNum = null } = options;
      
      // If template has a trained model, use detection
      if (template.modelId && useDetection) {
        console.log('Running detection with model:', template.modelId);
        
        // Run detection to find title block
        const detectResult = await runDetection(pdfFilename, {
          confidence: 0.5, // Lower threshold for title blocks
          selectedModels: [template.modelId],
          enableOCR: true, // Enable OCR for subclass extraction
          ocrPadding: 1.0,
          classPatterns: null,
          formatTemplate: null,
          perClassSettings: null,
          projectId: projectId,
          pages: pageNum ? [pageNum] : null, // Search specific page or all pages
        });
        
        if (!detectResult?.detections?.length) {
          return { 
            success: false, 
            error: 'Title block not found in document',
            noDetection: true 
          };
        }
        
        // Use the first (highest confidence) detection
        const detection = detectResult.detections[0];
        console.log('Detection found:', detection);
        
        // Extract properties from subclassValues if available
        const results = {};
        if (detection.subclassValues) {
          for (const prop of (template.properties || [])) {
            if (detection.subclassValues[prop.name] !== undefined) {
              results[prop.name] = detection.subclassValues[prop.name] || '';
            }
          }
        }
        
        return { 
          success: true, 
          properties: results,
          detection: {
            page: detection.page + 1, // Convert to 1-indexed
            confidence: detection.confidence,
            bbox: detection.bbox
          }
        };
      }
      
      // Fallback: Use PDF.js text layer extraction with fixed coordinates
      console.log('Using PDF.js text layer extraction (no model)');
      const pdfUrl = await getPdfFromBackend(pdfFilename);
      const pdf = await window.pdfjsLib.getDocument(pdfUrl).promise;
      
      const results = {};
      const targetPage = pageNum || template.outerBoundary?.page || 1;
      
      for (const region of (template.regions || [])) {
        const prop = template.properties?.find(p => p.id === region.propertyId);
        if (!prop) continue;
        
        const text = await extractTextFromRegion(
          pdf, 
          targetPage, 
          region.bbox, 
          template.outerBoundary.bbox
        );
        
        results[prop.name] = text;
      }
      
      return { success: true, properties: results, usedFallback: true };
    } catch (error) {
      console.error('Error extracting properties:', error);
      return { success: false, error: error.message };
    }
  };

  // Test extraction on the source PDF
  const handleTestExtraction = async (template) => {
    if (!template?.sourcePdf?.backendFilename) {
      alert('No source PDF associated with this template');
      return;
    }
    
    setIsExtracting(true);
    setShowTestResults(true);
    
    try {
      const result = await extractPropertiesFromPdf(
        template.sourcePdf.backendFilename,
        template
      );
      
      setTestExtractionResults({
        pdfName: template.sourcePdf.name,
        ...result
      });
    } catch (error) {
      setTestExtractionResults({
        pdfName: template.sourcePdf.name,
        success: false,
        error: error.message
      });
    } finally {
      setIsExtracting(false);
    }
  };

  // Extract properties from all documents assigned to a template
  const handleExtractAll = async (template) => {
    const assignedFiles = projectFiles.filter(f => f.docPropTemplateId === template.id);
    
    if (assignedFiles.length === 0) {
      alert('No documents are assigned to this template');
      return;
    }
    
    if (!confirm(`Extract properties from ${assignedFiles.length} document(s)?`)) {
      return;
    }
    
    setIsExtracting(true);
    setExtractionProgress({ current: 0, total: assignedFiles.length });
    
    try {
      const updatedProject = { ...project };
      let successCount = 0;
      let failCount = 0;
      
      // Helper to find and update a file in folders
      const updateFileInFolders = (folders, fileId, updates) => {
        return folders.map(folder => ({
          ...folder,
          files: (folder.files || []).map(f => 
            f.id === fileId ? { ...f, ...updates } : f
          ),
          subfolders: folder.subfolders ? updateFileInFolders(folder.subfolders, fileId, updates) : []
        }));
      };
      
      for (let i = 0; i < assignedFiles.length; i++) {
        const file = assignedFiles[i];
        setExtractionProgress({ current: i + 1, total: assignedFiles.length });
        
        const result = await extractPropertiesFromPdf(file.backendFilename, template);
        
        const updates = result.success 
          ? { extractedProperties: result.properties, docPropExtractionFailed: false, extractedAt: new Date().toISOString() }
          : { docPropExtractionFailed: true, extractionError: result.error };
        
        if (result.success) successCount++;
        else failCount++;
        
        // Update file in project structure
        if (file.folderId) {
          updatedProject.folders = updateFileInFolders(updatedProject.folders, file.id, updates);
        } else {
          updatedProject.files = (updatedProject.files || []).map(f => 
            f.id === file.id ? { ...f, ...updates } : f
          );
        }
      }
      
      // Save project
      await saveProject(updatedProject);
      setProject(updatedProject);
      
      // Refresh projectFiles state
      const files = [];
      const extractFilesFromFolders = (folderList) => {
        folderList.forEach(folder => {
          if (folder.files) {
            folder.files.forEach(f => files.push({ ...f, folderId: folder.id }));
          }
          if (folder.subfolders) extractFilesFromFolders(folder.subfolders);
        });
      };
      extractFilesFromFolders(updatedProject.folders || []);
      (updatedProject.files || []).forEach(f => files.push({ ...f, folderId: null }));
      setProjectFiles(files);
      
      alert(`Extraction complete!\n\nSuccessful: ${successCount}\nFailed: ${failCount}`);
    } catch (error) {
      console.error('Extraction error:', error);
      alert('Extraction failed: ' + error.message);
    } finally {
      setIsExtracting(false);
      setExtractionProgress({ current: 0, total: 0 });
    }
  };

  // Open extraction dialog with template settings
  const openExtractionDialog = (template) => {
    if (!template?.modelId) {
      alert('This template needs a trained model before extraction can run.');
      return;
    }
    
    // Initialize property formats from template
    const formats = {};
    (template.properties || []).forEach(prop => {
      formats[prop.name] = '';
    });
    setExtractionPropertyFormats(formats);
    setExtractionResults(null);
    setShowExtractionDialog(true);
  };

  // Get files to process based on scope
  const getFilesForExtractionScope = (template, scope) => {
    if (scope === 'assigned') {
      // Only files assigned to this template
      return projectFiles.filter(f => f.docPropTemplateId === template.id);
    } else if (scope === 'unassigned') {
      // Files without any template assigned
      return projectFiles.filter(f => !f.docPropTemplateId);
    } else if (scope === 'all') {
      // All files in project
      return projectFiles;
    }
    return [];
  };

  // Run extraction on multiple documents
  const handleRunExtraction = async () => {
    const template = selectedTemplate;
    if (!template?.modelId) {
      console.error('No modelId on template');
      return;
    }
    
    console.log('Starting extraction with template:', template.name, 'modelId:', template.modelId);
    
    const filesToProcess = getFilesForExtractionScope(template, extractionScope);
    
    if (filesToProcess.length === 0) {
      alert('No documents to process for the selected scope.');
      return;
    }
    
    console.log('Files to process:', filesToProcess.length, filesToProcess.map(f => f.name));
    
    setIsExtracting(true);
    setExtractionProgress({ current: 0, total: filesToProcess.length, phase: 'detecting' });
    
    try {
      const updatedProject = { ...project };
      let successCount = 0;
      let failCount = 0;
      const results = [];
      
      // Helper to find and update a file in folders
      const updateFileInFolders = (folders, fileId, updates) => {
        return folders.map(folder => ({
          ...folder,
          files: (folder.files || []).map(f => 
            f.id === fileId ? { ...f, ...updates } : f
          ),
          subfolders: folder.subfolders ? updateFileInFolders(folder.subfolders, fileId, updates) : []
        }));
      };
      
      // Build subclass formats from property formats
      const subclassFormats = {};
      Object.entries(extractionPropertyFormats).forEach(([propName, format]) => {
        if (format) {
          subclassFormats[propName] = format;
        }
      });
      
      console.log('Subclass formats:', subclassFormats);
      
      for (let i = 0; i < filesToProcess.length; i++) {
        const file = filesToProcess[i];
        console.log(`Processing file ${i + 1}/${filesToProcess.length}: ${file.name} (${file.backendFilename})`);
        
        setExtractionProgress({ 
          current: i + 1, 
          total: filesToProcess.length, 
          phase: 'detecting',
          currentFile: file.name 
        });
        
        try {
          console.log('Calling runDetection with modelId:', template.modelId);
          
          // Run detection on all pages - simplified call matching PDFViewer
          const detectResult = await runDetection(file.backendFilename, {
            confidence: extractionConfidence,
            selectedModels: [template.modelId],
            enableOCR: extractionEnableOCR,
            ocrPadding: 1.0,
            perClassSettings: {
              [template.modelId]: {
                confidence: extractionConfidence,
                enableOCR: extractionEnableOCR,
                subclassFormats: Object.keys(subclassFormats).length > 0 ? subclassFormats : null,
                className: template.name
              }
            },
            projectId: projectId,
            pages: null, // Search all pages
          });
          
          console.log('Detection result:', detectResult);
          
          if (!detectResult?.detections?.length) {
            // No title block found
            console.log('No detections found for', file.name);
            results.push({
              file: file.name,
              success: false,
              error: 'Title block not found'
            });
            failCount++;
            
            const updates = { 
              docPropExtractionFailed: true, 
              extractionError: 'Title block not found',
              extractedAt: new Date().toISOString()
            };
            
            if (file.folderId) {
              updatedProject.folders = updateFileInFolders(updatedProject.folders, file.id, updates);
            } else {
              updatedProject.files = (updatedProject.files || []).map(f => 
                f.id === file.id ? { ...f, ...updates } : f
              );
            }
            continue;
          }
          
          // Use highest confidence detection
          const detection = detectResult.detections[0];
          console.log('Best detection:', detection);
          
          // Extract properties from subclassValues
          const extractedProps = {};
          if (detection.subclassValues) {
            for (const prop of (template.properties || [])) {
              if (detection.subclassValues[prop.name] !== undefined) {
                extractedProps[prop.name] = detection.subclassValues[prop.name] || '';
              }
            }
          }
          
          console.log('Extracted properties:', extractedProps);
          
          results.push({
            file: file.name,
            success: true,
            properties: extractedProps,
            confidence: detection.confidence,
            page: detection.page + 1
          });
          successCount++;
          
          // Update file with extracted properties and assign template
          const updates = { 
            extractedProperties: extractedProps, 
            docPropExtractionFailed: false, 
            docPropTemplateId: template.id, // Assign template to file
            extractedAt: new Date().toISOString(),
            extractionConfidence: detection.confidence,
            extractionPage: detection.page + 1
          };
          
          if (file.folderId) {
            updatedProject.folders = updateFileInFolders(updatedProject.folders, file.id, updates);
          } else {
            updatedProject.files = (updatedProject.files || []).map(f => 
              f.id === file.id ? { ...f, ...updates } : f
            );
          }
          
        } catch (error) {
          console.error(`Error processing ${file.name}:`, error);
          results.push({
            file: file.name,
            success: false,
            error: error.message
          });
          failCount++;
        }
      }
      
      // Save project
      console.log('Saving project...');
      setExtractionProgress({ current: filesToProcess.length, total: filesToProcess.length, phase: 'saving' });
      await saveProject(updatedProject);
      setProject(updatedProject);
      
      // Refresh projectFiles state
      const files = [];
      const extractFilesFromFolders = (folderList) => {
        folderList.forEach(folder => {
          if (folder.files) {
            folder.files.forEach(f => files.push({ ...f, folderId: folder.id }));
          }
          if (folder.subfolders) extractFilesFromFolders(folder.subfolders);
        });
      };
      extractFilesFromFolders(updatedProject.folders || []);
      (updatedProject.files || []).forEach(f => files.push({ ...f, folderId: null }));
      setProjectFiles(files);
      
      // Show results
      console.log('Extraction complete:', { successCount, failCount });
      setExtractionResults({
        success: successCount,
        failed: failCount,
        total: filesToProcess.length,
        results: results
      });
      setExtractionProgress({ current: 0, total: 0, phase: 'complete' });
      
    } catch (error) {
      console.error('Extraction error:', error);
      alert('Extraction failed: ' + error.message);
      setExtractionProgress({ current: 0, total: 0 });
    } finally {
      setIsExtracting(false);
    }
  };

  // Generate preview image with regions drawn on it
  const generatePreviewImage = () => {
    if (!croppedCanvasRef.current || croppedSize.width === 0) return null;
    
    // Create a new canvas to draw the preview with regions
    const previewCanvas = document.createElement('canvas');
    const srcCanvas = croppedCanvasRef.current;
    previewCanvas.width = srcCanvas.width;
    previewCanvas.height = srcCanvas.height;
    const ctx = previewCanvas.getContext('2d');
    
    // Draw the cropped PDF
    ctx.drawImage(srcCanvas, 0, 0);
    
    // Draw each property region
    propertyRegions.forEach((region, i) => {
      const propIndex = properties.findIndex(p => p.id === region.propertyId);
      const color = getPropertyColor(propIndex >= 0 ? propIndex : i);
      const propName = properties.find(p => p.id === region.propertyId)?.name || '';
      
      const x = region.bbox.x * srcCanvas.width;
      const y = region.bbox.y * srcCanvas.height;
      const w = region.bbox.width * srcCanvas.width;
      const h = region.bbox.height * srcCanvas.height;
      
      // Draw semi-transparent fill
      ctx.fillStyle = color + '40';
      ctx.fillRect(x, y, w, h);
      
      // Draw border
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, w, h);
      
      // Draw label background
      ctx.fillStyle = color;
      const fontSize = Math.max(12, Math.min(16, srcCanvas.width / 40));
      ctx.font = `bold ${fontSize}px sans-serif`;
      const textWidth = ctx.measureText(propName).width;
      const labelPadding = 6;
      ctx.fillRect(x, y, textWidth + labelPadding * 2, fontSize + labelPadding * 2);
      
      // Draw label text
      ctx.fillStyle = 'white';
      ctx.fillText(propName, x + labelPadding, y + fontSize + labelPadding - 2);
    });
    
    return previewCanvas.toDataURL('image/png');
  };

  // Save template and train model
  const saveTemplate = async () => {
    if (!templateName.trim()) { alert('Please enter a template name'); return; }
    if (!selectedPdf?.backendFilename) { alert('No PDF selected'); return; }
    
    setIsTraining(true);
    setTrainingProgress('Generating preview...');
    
    try {
      // Generate preview image with regions
      const previewImage = generatePreviewImage();
      
      setTrainingProgress('Training detection model...');
      
      // Convert property regions to subclass regions format for the model
      // Property regions are stored as 0-1 coords relative to outer boundary
      // We need to convert them to page-absolute coords for training
      const subclassRegions = {};
      for (const region of propertyRegions) {
        const prop = properties.find(p => p.id === region.propertyId);
        if (!prop) continue;
        
        subclassRegions[prop.name] = {
          // Absolute page coordinates
          x: outerBoundary.bbox.x + (region.bbox.x * outerBoundary.bbox.width),
          y: outerBoundary.bbox.y + (region.bbox.y * outerBoundary.bbox.height),
          width: region.bbox.width * outerBoundary.bbox.width,
          height: region.bbox.height * outerBoundary.bbox.height,
          // Store relative coords for reference
          relativeX: region.bbox.x,
          relativeY: region.bbox.y,
          relativeWidth: region.bbox.width,
          relativeHeight: region.bbox.height,
        };
      }
      
      // Prepare training box (the outer boundary becomes the detection template)
      const trainingBox = {
        x: outerBoundary.bbox.x,
        y: outerBoundary.bbox.y,
        width: outerBoundary.bbox.width,
        height: outerBoundary.bbox.height,
        page: outerBoundary.page - 1, // Backend uses 0-indexed pages
        className: templateName.trim(),
        shapeType: 'rectangle',
        subclassRegions: subclassRegions,
      };
      
      // Train the detector model
      const trainResult = await trainDetector(
        selectedPdf.backendFilename,
        [trainingBox],
        false, // multiOrientation
        false, // includeInverted
        'separate', // trainingMode
        'docprop', // modelType - use 'docprop' to distinguish from regular object detection
        projectId,
        null // not adding to existing model
      );
      
      if (!trainResult?.models?.[0]) {
        throw new Error('Training failed - no model created');
      }
      
      const modelId = trainResult.models[0].modelId;
      
      setTrainingProgress('Saving template...');
      
      const newTemplate = {
        id: `docprop_${Date.now()}`,
        name: templateName.trim(),
        modelId, // Link to trained model
        properties: properties.map(p => ({ id: p.id, name: p.name.trim(), type: p.type })),
        outerBoundary,
        // Regions are stored with coordinates relative to the outer boundary (0-1 normalized)
        regions: propertyRegions.map(r => ({
          propertyId: r.propertyId,
          propertyName: properties.find(p => p.id === r.propertyId)?.name || '',
          bbox: r.bbox, // coordinates are relative to outer boundary, not full page
          page: r.page
        })),
        regionsRelativeToOuterBoundary: true,
        previewImage, // Saved preview with regions drawn
        sourcePdf: selectedPdf ? { id: selectedPdf.id, name: selectedPdf.name, backendFilename: selectedPdf.backendFilename } : null,
        created: new Date().toISOString()
      };

      const updatedProject = { ...project, docPropTemplates: [...docPropTemplates, newTemplate] };
      setProject(updatedProject);
      await saveProject(updatedProject);
      closeWizard();
      setSelectedItem(newTemplate.id);
      
      alert('Template created successfully!\n\nThe detection model has been trained. You can now extract properties from documents.');
    } catch (error) {
      console.error('Save template error:', error);
      alert('Failed to save template: ' + error.message);
    } finally {
      setIsTraining(false);
      setTrainingProgress('');
    }
  };

  // Delete template
  const handleDeleteTemplate = async (templateId, name) => {
    if (!window.confirm(`Delete template "${name}"?\n\nThis will remove the template but won't affect extracted data on files.`)) return;
    const updatedProject = { ...project, docPropTemplates: docPropTemplates.filter(t => t.id !== templateId) };
    setProject(updatedProject);
    await saveProject(updatedProject);
    if (selectedItem === templateId) setSelectedItem('home');
  };

  // Current active property
  const activeProperty = properties[activePropertyIndex];
  const activePropertyHasRegion = activeProperty && propertyRegions.some(r => r.propertyId === activeProperty.id);

  if (isLoading) {
    return (
      <div className="project-docprops-page">
        <div className="docprops-loading-state">
          <div className="docprops-spinner" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="project-docprops-page">
      <header className="docprops-header">
        <button className="back-btn" onClick={() => navigate(`/project/${projectId}`, { state: { returnToFile } })}>
          ← Back to Project
        </button>
        <h1>{project?.name} - Doc Properties</h1>
        <h1 className="brand-title">pidly</h1>
      </header>

      <div className="docprops-body">
        <div className="docprops-sidebar" style={{ width: sidebarWidth, minWidth: 320, maxWidth: 500, position: 'relative' }}>
          {/* Overview */}
          <div 
            className={`docprops-sidebar-item home-item ${selectedItem === 'home' ? 'selected' : ''}`} 
            onClick={() => setSelectedItem('home')}
          >
            <span className="item-name">Overview</span>
          </div>

          {/* Document Properties button */}
          <button 
            className="docprops-nav-btn"
            onClick={openWizard}
          >
            Document Properties
          </button>

          {/* Detection Settings button */}
          <button 
            className="docprops-nav-btn"
            onClick={() => setSelectedItem('detection-settings')}
          >
            Detection Settings
          </button>

          {/* Templates section */}
          <div className="docprops-templates-section" style={{ height: templatesSectionHeight, maxHeight: templatesSectionHeight }}>
            <div className="docprops-templates-section-header">
              <span className="section-title">Templates</span>
            </div>

            <div className="docprops-search">
              <input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>

            <div className="docprops-templates-list">
              {filteredTemplates.length === 0 ? (
                <p className="docprops-no-templates">{searchQuery ? 'No templates found' : 'No templates yet'}</p>
              ) : filteredTemplates.map(t => (
                <div 
                  key={t.id} 
                  className={`docprops-template-list-item ${selectedItem === t.id ? 'selected' : ''}`} 
                  onClick={() => setSelectedItem(t.id)}
                  onMouseEnter={(e) => { 
                    if (selectedItem !== t.id) e.currentTarget.style.background = '#252525'; 
                    e.currentTarget.querySelector('.docprops-template-item-actions').style.opacity = '1';
                  }}
                  onMouseLeave={(e) => { 
                    if (selectedItem !== t.id) e.currentTarget.style.background = 'transparent'; 
                    e.currentTarget.querySelector('.docprops-template-item-actions').style.opacity = '0';
                  }}
                >
                  <div className="docprops-template-item-info">
                    <div className="docprops-template-item-name">{t.name}</div>
                    <div className="docprops-template-item-meta">
                      {t.properties?.length || 0} properties
                      {getTemplateIssueCount(t.id) > 0 && <span className="docprops-issue-badge">{getTemplateIssueCount(t.id)} issues</span>}
                    </div>
                  </div>
                  <div className="docprops-template-item-actions">
                    <button className="docprops-template-action-btn delete" title="Delete" onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(t.id, t.name); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={`docprops-section-resize-handle ${isResizingTemplates ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setIsResizingTemplates(true); }}>
            <div className="docprops-resize-handle-bar" />
          </div>

          <div className="docprops-folders-section">
            <div className="docprops-folders-section-header">
              <span className="section-title">Folders</span>
            </div>
            <div className="docprops-folders-list">
              {projectFolders.length === 0 ? (
                <p className="docprops-no-folders">No folders in project</p>
              ) : projectFolders.map(f => (
                <div key={f.id} className="docprops-folder-list-item">
                  <div className="docprops-folder-item-icon" style={{ color: f.color || '#f4c542' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                    </svg>
                  </div>
                  <div className="docprops-folder-item-info">
                    <div className="docprops-folder-item-name">{f.name}</div>
                    <div className="docprops-folder-item-meta">{f.files?.length || 0} files</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="docprops-sidebar-resize-handle" onMouseDown={(e) => { e.preventDefault(); setIsResizingSidebar(true); }} />
        </div>

        <div className="docprops-content">
          {selectedItem === 'home' ? (
            <div className="docprops-home-content">
              <div className="home-header-section">
                <div className="home-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <line x1="10" y1="9" x2="8" y2="9"/>
                  </svg>
                </div>
                <h2>Document Properties</h2>
                <p className="home-subtitle">Extract and manage structured data from documents</p>
              </div>

              <div className="home-stats-row">
                <div className="stat-card" style={{ background: 'transparent', border: '1px solid #333' }}>
                  <div className="stat-number" style={{ color: '#fff', fontWeight: 700 }}>{docPropTemplates.length}</div>
                  <div className="stat-label" style={{ color: '#888', fontWeight: 600 }}>Templates</div>
                </div>
                <div className="stat-card" style={{ background: 'transparent', border: '1px solid #333' }}>
                  <div className="stat-number" style={{ color: '#fff', fontWeight: 700 }}>{projectFiles.length}</div>
                  <div className="stat-label" style={{ color: '#888', fontWeight: 600 }}>Documents</div>
                </div>
                <div className="stat-card" style={{ background: 'transparent', border: '1px solid #333' }}>
                  <div className="stat-number" style={{ color: '#fff', fontWeight: 700 }}>{projectFiles.filter(f => f.docPropTemplateId).length}</div>
                  <div className="stat-label" style={{ color: '#888', fontWeight: 600 }}>Assigned</div>
                </div>
                <div className="stat-card" style={{ background: 'transparent', border: '1px solid #333' }}>
                  <div className="stat-number" style={{ color: projectFiles.filter(f => f.docPropExtractionFailed).length > 0 ? '#e74c3c' : '#fff', fontWeight: 700 }}>{projectFiles.filter(f => f.docPropExtractionFailed).length}</div>
                  <div className="stat-label" style={{ color: '#888', fontWeight: 600 }}>Issues</div>
                </div>
              </div>

              {/* Templates overview */}
              {docPropTemplates.length > 0 && (
                <div style={{ width: '100%', marginBottom: '24px' }}>
                  <h3 style={{ color: '#fff', fontWeight: 700, marginBottom: '16px', fontSize: '14px' }}>Templates</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {docPropTemplates.map(t => {
                      const assignedCount = projectFiles.filter(f => f.docPropTemplateId === t.id).length;
                      const issueCount = getTemplateIssueCount(t.id);
                      return (
                        <div 
                          key={t.id}
                          onClick={() => setSelectedItem(t.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '12px 16px',
                            background: 'linear-gradient(135deg, #252525 0%, #2a2a2a 100%)',
                            border: '1px solid #3a3a3a',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            gap: '12px',
                            transition: 'all 0.15s'
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3498db'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#3a3a3a'; }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="1.5" style={{ flexShrink: 0 }}>
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                          </svg>
                          <div style={{ flex: 1, fontWeight: 600, color: '#fff', fontSize: '13px' }}>{t.name}</div>
                          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                            <span style={{ color: '#888', fontSize: '12px' }}>{t.properties?.length || 0} props</span>
                            <span style={{ color: '#3498db', fontSize: '12px', fontWeight: 600 }}>{assignedCount} doc{assignedCount !== 1 ? 's' : ''}</span>
                            {issueCount > 0 && <span style={{ color: '#e74c3c', fontSize: '11px', fontWeight: 500 }}>{issueCount} issues</span>}
                            {t.modelId && (
                              <span style={{ color: '#27ae60', fontSize: '11px' }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ verticalAlign: 'middle' }}>
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ width: '100%' }}>
                <h3 style={{ color: '#fff', fontWeight: 700, fontSize: '14px', marginBottom: '12px' }}>Quick Actions</h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    onClick={openWizard}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px',
                      background: '#333', border: '1px solid #444', borderRadius: '6px',
                      color: '#fff', fontSize: '12px', fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3498db'; e.currentTarget.style.background = '#3a3a3a'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#444'; e.currentTarget.style.background = '#333'; }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M12 5v14M5 12h14"/>
                    </svg>
                    New Template
                  </button>
                  <button 
                    onClick={() => navigate(`/project/${projectId}`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px',
                      background: '#333', border: '1px solid #444', borderRadius: '6px',
                      color: '#fff', fontSize: '12px', fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3498db'; e.currentTarget.style.background = '#3a3a3a'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#444'; e.currentTarget.style.background = '#333'; }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    View Documents
                  </button>
                </div>
              </div>
            </div>
          ) : selectedItem === 'detection-settings' ? (
            <div className="docprops-home-content">
              <div className="home-header-section">
                <div className="home-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                  </svg>
                </div>
                <h2>Detection Settings</h2>
                <p className="home-subtitle">Configure detection and extraction parameters</p>
              </div>

              <div style={{ width: '100%', maxWidth: '600px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ background: 'linear-gradient(135deg, #252525 0%, #2a2a2a 100%)', border: '1px solid #3a3a3a', borderRadius: '8px', padding: '20px' }}>
                  <div style={{ color: '#fff', fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>Confidence Threshold</div>
                  <div style={{ color: '#888', fontSize: '12px', marginBottom: '12px' }}>Minimum confidence score for title block detection</div>
                  <div style={{ color: '#666', fontSize: '13px', fontStyle: 'italic' }}>Coming soon</div>
                </div>
                <div style={{ background: 'linear-gradient(135deg, #252525 0%, #2a2a2a 100%)', border: '1px solid #3a3a3a', borderRadius: '8px', padding: '20px' }}>
                  <div style={{ color: '#fff', fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>OCR Engine Settings</div>
                  <div style={{ color: '#888', fontSize: '12px', marginBottom: '12px' }}>Configure text recognition parameters</div>
                  <div style={{ color: '#666', fontSize: '13px', fontStyle: 'italic' }}>Coming soon</div>
                </div>
                <div style={{ background: 'linear-gradient(135deg, #252525 0%, #2a2a2a 100%)', border: '1px solid #3a3a3a', borderRadius: '8px', padding: '20px' }}>
                  <div style={{ color: '#fff', fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>Multi-page Scanning</div>
                  <div style={{ color: '#888', fontSize: '12px', marginBottom: '12px' }}>Control which pages to scan for title blocks</div>
                  <div style={{ color: '#666', fontSize: '13px', fontStyle: 'italic' }}>Coming soon</div>
                </div>
              </div>
            </div>
          ) : selectedTemplate ? (
            <div className="docprops-template-detail">
              <div className="docprops-template-detail-header">
                <div className="docprops-template-header-left">
                  <h2>{selectedTemplate.name}</h2>
                  <div className="docprops-template-meta-row">
                    <span className="docprops-template-meta">
                      Created {selectedTemplate.created ? new Date(selectedTemplate.created).toLocaleDateString() : '-'}
                    </span>
                    {selectedTemplate.modelId ? (
                      <span className="docprops-model-badge trained">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Model Trained
                      </span>
                    ) : (
                      <span className="docprops-model-badge no-model">
                        No detection model
                      </span>
                    )}
                  </div>
                </div>
                <div className="docprops-template-header-actions">
                  <button 
                    className="docprops-btn secondary small" 
                    onClick={() => handleTestExtraction(selectedTemplate)}
                    disabled={isExtracting}
                  >
                    {isExtracting ? 'Testing...' : 'Test Extraction'}
                  </button>
                  <button 
                    className="docprops-btn primary small" 
                    onClick={() => openExtractionDialog(selectedTemplate)}
                    disabled={!selectedTemplate.modelId || isExtracting}
                    title={!selectedTemplate.modelId ? 'Template needs a trained model' : 'Run extraction on documents'}
                  >
                    🔍 Run Extraction
                  </button>
                  <button className="docprops-btn secondary small" onClick={() => handleDeleteTemplate(selectedTemplate.id, selectedTemplate.name)}>Delete</button>
                </div>
              </div>

              {/* Test Results Panel */}
              {showTestResults && testExtractionResults && (
                <div className="docprops-test-results">
                  <div className="docprops-test-results-header">
                    <h4>Test Extraction Results</h4>
                    <button className="docprops-close-btn" onClick={() => setShowTestResults(false)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                  <p className="docprops-test-source">Source: {testExtractionResults.pdfName}</p>
                  
                  {/* Detection info */}
                  {testExtractionResults.detection && (
                    <div className="docprops-detection-info">
                      <span className="docprops-detection-badge success">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Title block found
                      </span>
                      <span className="docprops-detection-details">
                        Page {testExtractionResults.detection.page} • {Math.round(testExtractionResults.detection.confidence * 100)}% confidence
                      </span>
                    </div>
                  )}
                  {testExtractionResults.usedFallback && (
                    <div className="docprops-detection-info">
                      <span className="docprops-detection-badge warning">
                        ⚠️ Using fixed coordinates (no model)
                      </span>
                    </div>
                  )}
                  {testExtractionResults.noDetection && (
                    <div className="docprops-detection-info">
                      <span className="docprops-detection-badge error">
                        ✕ Title block not detected
                      </span>
                    </div>
                  )}
                  
                  {testExtractionResults.success ? (
                    <div className="docprops-test-properties">
                      {selectedTemplate.properties?.map((prop, i) => (
                        <div key={i} className="docprops-test-property">
                          <div className="docprops-test-property-name">
                            <div className="docprops-color-dot small" style={{ backgroundColor: getPropertyColor(i) }} />
                            {prop.name}
                          </div>
                          <div className="docprops-test-property-value">
                            {testExtractionResults.properties[prop.name] || <span className="empty">No text found</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="docprops-test-error">
                      <span>⚠️ Extraction failed: {testExtractionResults.error}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="docprops-template-preview-section">
                <div className="docprops-preview-card">
                  <h3>Template Preview</h3>
                  <TemplatePreview template={selectedTemplate} />
                </div>
                
                <div className="docprops-properties-card">
                  <h3>Properties ({selectedTemplate.properties?.length || 0})</h3>
                  <div className="docprops-properties-list">
                    {selectedTemplate.properties?.map((p, i) => (
                      <div key={i} className="docprops-property-item">
                        <div className="docprops-color-dot" style={{ backgroundColor: getPropertyColor(i) }} />
                        <span className="docprops-property-name">{p.name}</span>
                        <span className="docprops-property-type">{p.type}</span>
                      </div>
                    ))}
                    {(!selectedTemplate.properties || selectedTemplate.properties.length === 0) && (
                      <p className="docprops-empty-text">No properties defined</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="docprops-documents-section">
                <div className="docprops-documents-header">
                  <h3>Documents ({getTemplateFileCount(selectedTemplate.id)})</h3>
                  {getTemplateFileCount(selectedTemplate.id) > 0 && (
                    <button 
                      className="docprops-btn primary small"
                      onClick={() => handleExtractAll(selectedTemplate)}
                      disabled={isExtracting}
                    >
                      {isExtracting && extractionProgress.total > 0 
                        ? `Extracting ${extractionProgress.current}/${extractionProgress.total}...` 
                        : 'Extract All'}
                    </button>
                  )}
                </div>
                
                {getTemplateFileCount(selectedTemplate.id) === 0 ? (
                  <div className="docprops-documents-empty">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <p>No documents using this template</p>
                    <span>Assign this template to documents to start extracting properties</span>
                  </div>
                ) : (
                  <div className="docprops-documents-table">
                    <div className="docprops-table-header">
                      <div className="docprops-table-cell doc-name">Document</div>
                      {selectedTemplate.properties?.map((p, i) => (
                        <div key={i} className="docprops-table-cell prop-value">
                          <div className="docprops-color-dot small" style={{ backgroundColor: getPropertyColor(i) }} />
                          {p.name}
                        </div>
                      ))}
                      <div className="docprops-table-cell status">Status</div>
                    </div>
                    <div className="docprops-table-body">
                      {projectFiles.filter(f => f.docPropTemplateId === selectedTemplate.id).map(file => (
                        <div key={file.id} className={`docprops-table-row ${file.docPropExtractionFailed ? 'has-issue' : ''}`}>
                          <div className="docprops-table-cell doc-name">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" strokeWidth="1.5">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                              <polyline points="14 2 14 8 20 8"/>
                            </svg>
                            <span>{file.name}</span>
                          </div>
                          {selectedTemplate.properties?.map((p, i) => (
                            <div key={i} className="docprops-table-cell prop-value">
                              {file.extractedProperties?.[p.name] || <span className="docprops-empty-value">—</span>}
                            </div>
                          ))}
                          <div className="docprops-table-cell status">
                            {file.docPropExtractionFailed ? (
                              <span className="docprops-status-badge error">Failed</span>
                            ) : file.extractedProperties ? (
                              <span className="docprops-status-badge success">Extracted</span>
                            ) : (
                              <span className="docprops-status-badge pending">Pending</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="docprops-no-selection"><p>Select a template to view details</p></div>
          )}
        </div>
      </div>

      {/* Wizard Modal */}
      {showWizard && (
        <div className="docprops-wizard-overlay">
          <div className={`docprops-wizard-modal ${(wizardPhase === 'draw-boundary' || wizardPhase === 'draw-regions') ? 'large' : ''}`}>
            <div className="docprops-wizard-header">
              <h2>
                {wizardPhase === 'select-pdf' && 'Step 1: Select PDF'}
                {wizardPhase === 'draw-boundary' && 'Step 2: Draw Title Block'}
                {wizardPhase === 'define-props' && 'Step 3: Define Properties'}
                {wizardPhase === 'draw-regions' && 'Step 4: Map Property Regions'}
              </h2>
              <button className="docprops-wizard-close" onClick={closeWizard}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {/* Step 1: Select PDF */}
            {wizardPhase === 'select-pdf' && (
              <div className="docprops-wizard-body">
                <div className="docprops-form-group">
                  <label>Template Name</label>
                  <input type="text" placeholder="e.g., Standard Title Block" value={templateName} onChange={(e) => setTemplateName(e.target.value)} autoFocus />
                </div>
                <div className="docprops-form-group">
                  <label>Select a PDF to use as reference</label>
                  <input type="text" className="docprops-pdf-search" placeholder="Search PDFs..." value={pdfSearchQuery} onChange={(e) => setPdfSearchQuery(e.target.value)} />
                  <div className="docprops-pdf-list">
                    {projectFiles
                      .filter(f => f.name?.toLowerCase().endsWith('.pdf'))
                      .filter(f => !pdfSearchQuery || f.name.toLowerCase().includes(pdfSearchQuery.toLowerCase()) || f.folderName?.toLowerCase().includes(pdfSearchQuery.toLowerCase()))
                      .map(f => (
                        <div key={f.id} className={`docprops-pdf-item ${selectedPdf?.id === f.id ? 'selected' : ''}`} onClick={() => setSelectedPdf(f)}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" strokeWidth="1.5">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                          </svg>
                          <div className="docprops-pdf-item-text">
                            <div className="docprops-pdf-name">{f.name}</div>
                            <div className="docprops-pdf-folder">{f.folderName}</div>
                          </div>
                          {selectedPdf?.id === f.id && (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#27ae60" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                          )}
                        </div>
                      ))}
                    {projectFiles.filter(f => f.name?.toLowerCase().endsWith('.pdf')).length === 0 && (
                      <div className="docprops-pdf-empty">No PDF files in project</div>
                    )}
                  </div>
                </div>
                <div className="docprops-wizard-footer">
                  <button className="docprops-btn secondary" onClick={closeWizard}>Cancel</button>
                  <button className="docprops-btn primary" onClick={async () => {
                    if (!templateName.trim()) { alert('Please enter a template name'); return; }
                    if (!selectedPdf) { alert('Please select a PDF'); return; }
                    await loadPdf(selectedPdf);
                    setWizardPhase('draw-boundary');
                  }}>Next →</button>
                </div>
              </div>
            )}

            {/* Step 2: Draw Boundary */}
            {wizardPhase === 'draw-boundary' && (
              <div className="docprops-wizard-body-full">
                <div className="docprops-draw-sidebar">
                  <button className="docprops-btn secondary small" onClick={() => setWizardPhase('select-pdf')}>← Back</button>
                  
                  <div className="docprops-instruction-box">
                    <h4>Draw the Title Block</h4>
                    <p>Click and drag to draw a rectangle around the document properties area.</p>
                  </div>

                  {outerBoundary && (
                    <div className="docprops-success-box">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#27ae60" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                      <span>Boundary drawn!</span>
                      <button onClick={() => setOuterBoundary(null)}>Redraw</button>
                    </div>
                  )}

                  <div className="docprops-tips">
                    <p><strong>Controls:</strong></p>
                    <ul>
                      <li><kbd>V</kbd> - Draw mode</li>
                      <li><kbd>Shift+V</kbd> - Pan mode</li>
                      <li><kbd>Z</kbd> - Zoom mode</li>
                      <li>Scroll to zoom</li>
                      <li>Right-click drag to pan</li>
                    </ul>
                  </div>

                  <div style={{ flex: 1 }} />

                  {outerBoundary && (
                    <button className="docprops-btn primary full" onClick={() => setWizardPhase('define-props')}>Continue →</button>
                  )}
                </div>
                
                <div className="docprops-pdf-viewer">
                  <div className="docprops-pdf-toolbar">
                    {numPages > 1 && (
                      <>
                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}>◀</button>
                        <span>{currentPage} / {numPages}</span>
                        <button onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))} disabled={currentPage >= numPages}>▶</button>
                        <span className="docprops-toolbar-sep">|</span>
                      </>
                    )}
                    <button onClick={() => setScale(s => Math.max(0.25, s / 1.25))}>−</button>
                    <span>{Math.round(scale * 100)}%</span>
                    <button onClick={() => setScale(s => Math.min(5, s * 1.25))}>+</button>
                    <button onClick={() => { setScale(1); setPanOffset({ x: 0, y: 0 }); }}>Fit</button>
                  </div>
                  <div 
                    className="docprops-pdf-canvas-area" 
                    ref={containerRef}
                    onMouseDown={handleMouseDown} 
                    onMouseMove={handleMouseMove} 
                    onMouseUp={handleMouseUp} 
                    onMouseLeave={handleMouseUp} 
                    onContextMenu={handleContextMenu}
                    style={{ cursor: isPanning ? 'grabbing' : viewMode === 'pan' ? 'grab' : viewMode === 'zoom' ? 'zoom-in' : 'crosshair' }}
                  >
                    <div style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${scale})`, transformOrigin: '0 0', position: 'absolute', top: 20, left: 20 }}>
                      <canvas ref={canvasRef} style={{ display: 'block', boxShadow: '0 4px 20px rgba(0,0,0,0.3)', width: canvasSize.width || 'auto', height: canvasSize.height || 'auto' }} />
                      {outerBoundary && outerBoundary.page === currentPage && (
                        <div className="docprops-drawn-region outer" style={{
                          left: outerBoundary.bbox.x * canvasSize.width,
                          top: outerBoundary.bbox.y * canvasSize.height,
                          width: outerBoundary.bbox.width * canvasSize.width,
                          height: outerBoundary.bbox.height * canvasSize.height
                        }}><span className="docprops-region-label">Title Block</span></div>
                      )}
                      {currentRect && wizardPhase === 'draw-boundary' && (
                        <div className="docprops-drawing-rect" style={{
                          left: currentRect.x * canvasSize.width,
                          top: currentRect.y * canvasSize.height,
                          width: currentRect.width * canvasSize.width,
                          height: currentRect.height * canvasSize.height,
                          borderColor: '#e67e22'
                        }} />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Define Properties */}
            {wizardPhase === 'define-props' && (
              <div className="docprops-wizard-body">
                <div className="docprops-form-group">
                  <label>What properties do you want to extract?</label>
                  <p className="docprops-hint">Add each field from the title block (e.g., Document Number, Revision, Title)</p>
                  <div className="docprops-props-list">
                    {properties.length === 0 ? (
                      <div className="docprops-props-empty">
                        <p>No properties added yet</p>
                        <span>Click "Add Property" to start defining fields to extract</span>
                      </div>
                    ) : (
                      properties.map((p, i) => (
                        <div key={p.id} className="docprops-prop-row">
                          <div className="docprops-color-dot" style={{ backgroundColor: getPropertyColor(i) }} />
                          <input type="text" placeholder="Enter property name..." value={p.name} onChange={(e) => updateProperty(p.id, 'name', e.target.value)} />
                          <select value={p.type} onChange={(e) => updateProperty(p.id, 'type', e.target.value)}>
                            <option value="text">Text</option>
                            <option value="number">Number</option>
                            <option value="date">Date</option>
                          </select>
                          <button className="docprops-remove-btn" onClick={() => removeProperty(p.id)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M18 6L6 18M6 6l12 12"/>
                            </svg>
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <button className="docprops-add-btn" onClick={addProperty}>+ Add Property</button>
                </div>
                <div className="docprops-wizard-footer">
                  <button className="docprops-btn secondary" onClick={() => { setViewMode('select'); setWizardPhase('draw-boundary'); }}>← Back</button>
                  <button className="docprops-btn primary" onClick={() => {
                    if (properties.length === 0) { alert('Please add at least one property'); return; }
                    if (properties.some(p => !p.name.trim())) { alert('Please name all properties'); return; }
                    setActivePropertyIndex(0);
                    setViewMode('select');
                    setWizardPhase('draw-regions');
                  }}>Next →</button>
                </div>
              </div>
            )}

            {/* Step 4: Draw Regions */}
            {wizardPhase === 'draw-regions' && activeProperty && (
              <div className="docprops-wizard-body-full">
                <div className="docprops-draw-sidebar">
                  <button className="docprops-btn secondary small" onClick={() => setWizardPhase('define-props')}>← Back</button>

                  <div className="docprops-instruction-box highlight">
                    <div className="docprops-current-prop">
                      <div className="docprops-color-dot large" style={{ backgroundColor: getPropertyColor(activePropertyIndex) }} />
                      <h4>{activeProperty.name}</h4>
                    </div>
                    <p>Draw a rectangle around this property.</p>
                  </div>
                  
                  {activePropertyHasRegion && (
                    <div className="docprops-success-box">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#27ae60" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                      <span>Region drawn!</span>
                    </div>
                  )}

                  <div className="docprops-progress-section">
                    <span>{propertyRegions.length} of {properties.length} mapped</span>
                    <div className="docprops-progress-bar">
                      <div className="docprops-progress-fill" style={{ width: `${(propertyRegions.length / properties.length) * 100}%` }} />
                    </div>
                  </div>
                  
                  <div className="docprops-props-nav">
                    {properties.map((p, i) => {
                      const hasRegion = propertyRegions.some(r => r.propertyId === p.id);
                      return (
                        <div key={p.id} className={`docprops-prop-nav-item ${i === activePropertyIndex ? 'active' : ''} ${hasRegion ? 'done' : ''}`} onClick={() => setActivePropertyIndex(i)}>
                          <div className="docprops-color-dot" style={{ backgroundColor: getPropertyColor(i) }} />
                          <span>{p.name}</span>
                          {hasRegion && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#27ae60" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>}
                        </div>
                      );
                    })}
                  </div>
                  
                  <div className="docprops-tips">
                    <p><strong>Controls:</strong></p>
                    <ul>
                      <li><kbd>V</kbd> - Draw mode</li>
                      <li><kbd>Shift+V</kbd> - Pan mode</li>
                      <li><kbd>Z</kbd> - Zoom mode</li>
                    </ul>
                  </div>
                  
                  <button 
                    className="docprops-btn primary full" 
                    onClick={saveTemplate} 
                    disabled={propertyRegions.length === 0 || isTraining}
                  >
                    {isTraining ? (trainingProgress || 'Training...') : 'Save Template'}
                  </button>
                </div>
                
                <div className="docprops-pdf-viewer">
                  <div className="docprops-pdf-toolbar">
                    <button onClick={() => setScale(s => Math.max(0.25, s / 1.25))}>−</button>
                    <span>{Math.round(scale * 100)}%</span>
                    <button onClick={() => setScale(s => Math.min(5, s * 1.25))}>+</button>
                    <button onClick={() => { setScale(1); setPanOffset({ x: 0, y: 0 }); }}>Fit</button>
                  </div>
                  <div 
                    className="docprops-pdf-canvas-area" 
                    ref={containerRef}
                    onMouseDown={handleMouseDown} 
                    onMouseMove={handleMouseMove} 
                    onMouseUp={handleMouseUp} 
                    onMouseLeave={handleMouseUp} 
                    onContextMenu={handleContextMenu}
                    style={{ cursor: isPanning ? 'grabbing' : viewMode === 'pan' ? 'grab' : viewMode === 'zoom' ? 'zoom-in' : 'crosshair' }}
                  >
                    <div style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${scale})`, transformOrigin: '0 0', position: 'absolute', top: 20, left: 20 }}>
                      <canvas ref={croppedCanvasRef} style={{ display: 'block', boxShadow: '0 4px 20px rgba(0,0,0,0.3)', width: croppedSize.width || 'auto', height: croppedSize.height || 'auto' }} />
                      
                      {propertyRegions.map(r => {
                        const idx = properties.findIndex(p => p.id === r.propertyId);
                        const prop = properties[idx];
                        const color = getPropertyColor(idx);
                        const isActive = r.propertyId === activeProperty?.id;
                        return (
                          <div key={r.propertyId} className={`docprops-drawn-region prop ${isActive ? 'active' : ''}`} style={{
                            left: r.bbox.x * croppedSize.width,
                            top: r.bbox.y * croppedSize.height,
                            width: r.bbox.width * croppedSize.width,
                            height: r.bbox.height * croppedSize.height,
                            borderColor: color,
                            backgroundColor: `${color}30`
                          }}><span className="docprops-region-label" style={{ backgroundColor: color }}>{prop?.name}</span></div>
                        );
                      })}
                      
                      {currentRect && wizardPhase === 'draw-regions' && (
                        <div className="docprops-drawing-rect" style={{
                          left: currentRect.x * croppedSize.width,
                          top: currentRect.y * croppedSize.height,
                          width: currentRect.width * croppedSize.width,
                          height: currentRect.height * croppedSize.height,
                          borderColor: getPropertyColor(activePropertyIndex),
                          backgroundColor: `${getPropertyColor(activePropertyIndex)}30`
                        }} />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Extraction Dialog Modal */}
      {showExtractionDialog && selectedTemplate && (
        <div className="docprops-modal-overlay" onClick={() => !isExtracting && setShowExtractionDialog(false)}>
          <div className="docprops-modal docprops-extraction-modal" onClick={(e) => e.stopPropagation()}>
            <div className="docprops-modal-header">
              <h2>Run Property Extraction</h2>
              <p className="docprops-modal-subtitle">Extract properties from documents using "{selectedTemplate.name}"</p>
            </div>
            
            {/* Results View */}
            {extractionResults ? (
              <div className="docprops-extraction-results">
                <div className="docprops-results-summary">
                  <div className="docprops-result-stat success">
                    <span className="stat-number">{extractionResults.success}</span>
                    <span className="stat-label">Successful</span>
                  </div>
                  <div className="docprops-result-stat failed">
                    <span className="stat-number">{extractionResults.failed}</span>
                    <span className="stat-label">Failed</span>
                  </div>
                  <div className="docprops-result-stat total">
                    <span className="stat-number">{extractionResults.total}</span>
                    <span className="stat-label">Total</span>
                  </div>
                </div>
                
                <div className="docprops-results-list">
                  <h4>Details</h4>
                  <div className="docprops-results-scroll">
                    {extractionResults.results.map((r, i) => (
                      <div key={i} className={`docprops-result-item ${r.success ? 'success' : 'failed'}`}>
                        <span className="result-icon">{r.success ? '✓' : '✕'}</span>
                        <span className="result-file">{r.file}</span>
                        {r.success ? (
                          <span className="result-info">Page {r.page} • {Math.round(r.confidence * 100)}%</span>
                        ) : (
                          <span className="result-error">{r.error}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="docprops-modal-actions">
                  <button 
                    className="docprops-btn primary"
                    onClick={() => {
                      setShowExtractionDialog(false);
                      setExtractionResults(null);
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              /* Settings View */
              <>
                <div className="docprops-extraction-settings">
                  {/* Scope */}
                  <div className="docprops-setting-group">
                    <label>Documents to Process:</label>
                    <select 
                      value={extractionScope} 
                      onChange={(e) => setExtractionScope(e.target.value)}
                      disabled={isExtracting}
                    >
                      <option value="assigned">
                        Assigned to this template ({projectFiles.filter(f => f.docPropTemplateId === selectedTemplate.id).length} files)
                      </option>
                      <option value="unassigned">
                        Unassigned documents ({projectFiles.filter(f => !f.docPropTemplateId).length} files)
                      </option>
                      <option value="all">
                        All documents ({projectFiles.length} files)
                      </option>
                    </select>
                  </div>
                  
                  {/* Confidence */}
                  <div className="docprops-setting-group">
                    <div className="docprops-setting-row">
                      <label>Detection Confidence:</label>
                      <span className="docprops-setting-value">{Math.round(extractionConfidence * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.2"
                      max="0.95"
                      step="0.05"
                      value={extractionConfidence}
                      onChange={(e) => setExtractionConfidence(parseFloat(e.target.value))}
                      disabled={isExtracting}
                    />
                  </div>
                  
                  {/* OCR toggle */}
                  <div className="docprops-setting-group">
                    <label className="docprops-checkbox-label">
                      <input
                        type="checkbox"
                        checked={extractionEnableOCR}
                        onChange={(e) => setExtractionEnableOCR(e.target.checked)}
                        disabled={isExtracting}
                      />
                      Enable Text Extraction (OCR)
                    </label>
                  </div>
                  
                  {/* Property formats */}
                  {extractionEnableOCR && selectedTemplate.properties?.length > 0 && (
                    <div className="docprops-setting-group">
                      <label>Property Formats (optional):</label>
                      <p className="docprops-setting-help">
                        Format templates help OCR correct errors. E.g., "FI-12345" → L=letter, N=number
                      </p>
                      <div className="docprops-format-list">
                        {selectedTemplate.properties.map((prop, i) => (
                          <div key={prop.id} className="docprops-format-row">
                            <div className="docprops-color-dot small" style={{ backgroundColor: getPropertyColor(i) }} />
                            <span className="docprops-format-name">{prop.name}</span>
                            <input
                              type="text"
                              placeholder="e.g. ABC-12345"
                              value={extractionPropertyFormats[prop.name] || ''}
                              onChange={(e) => setExtractionPropertyFormats(prev => ({
                                ...prev,
                                [prop.name]: e.target.value.toUpperCase()
                              }))}
                              disabled={isExtracting}
                              className="docprops-format-input"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Progress */}
                {isExtracting && extractionProgress.total > 0 && (
                  <div className="docprops-extraction-progress">
                    <div className="docprops-progress-bar-container">
                      <div 
                        className="docprops-progress-bar-fill" 
                        style={{ 
                          width: `${(extractionProgress.current / extractionProgress.total) * 100}%`,
                          background: extractionProgress.phase === 'saving' ? '#27ae60' : '#3498db'
                        }} 
                      />
                    </div>
                    <div className="docprops-progress-text">
                      {extractionProgress.phase === 'detecting' && (
                        <>Processing {extractionProgress.current} of {extractionProgress.total}: {extractionProgress.currentFile}</>
                      )}
                      {extractionProgress.phase === 'saving' && 'Saving results...'}
                    </div>
                  </div>
                )}
                
                <div className="docprops-modal-actions">
                  <button 
                    className="docprops-btn secondary"
                    onClick={() => setShowExtractionDialog(false)}
                    disabled={isExtracting}
                  >
                    Cancel
                  </button>
                  <button 
                    className="docprops-btn primary"
                    onClick={handleRunExtraction}
                    disabled={isExtracting || getFilesForExtractionScope(selectedTemplate, extractionScope).length === 0}
                  >
                    {isExtracting ? 'Extracting...' : `🔍 Extract from ${getFilesForExtractionScope(selectedTemplate, extractionScope).length} Documents`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
