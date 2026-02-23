import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import FileSidebar from '../components/FileBar/FileSidebar';
import PDFViewerArea from '../components/MainView/PDFViewerArea';
import InfiniteView from '../components/InfiniteView/InfiniteView';
import { getProject, saveProject, getPdfFromBackend, getModels } from '../utils/storage';
import './ProjectWorkspace.css';

export default function ProjectWorkspace() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [project, setProject] = useState(null);
  const [currentFile, setCurrentFile] = useState(null);
  const [currentPdfUrl, setCurrentPdfUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [showInfiniteView, setShowInfiniteView] = useState(false);
  const [infiniteViewInitial, setInfiniteViewInitial] = useState({ file: null, page: 1 });
  const handledReturnRef = useRef(false);
  const handledNavigateRef = useRef(false);
  
  // Home screen panel states - restore from sessionStorage
  const getStoredPanelState = () => {
    try {
      const stored = sessionStorage.getItem(`panelState_${projectId}`);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.error('Error reading panel state:', e);
    }
    return { search: true, objectFinder: false, smartLinks: false, view: false, ocr: false };
  };
  
  const storedPanelState = getStoredPanelState();
  const [homeShowSearchPanel, setHomeShowSearchPanel] = useState(storedPanelState.search);
  const [homeShowObjectFinder, setHomeShowObjectFinder] = useState(storedPanelState.objectFinder);
  const [homeShowSmartLinks, setHomeShowSmartLinks] = useState(storedPanelState.smartLinks);
  const [homeShowViewPanel, setHomeShowViewPanel] = useState(storedPanelState.view);
  const [homeShowOcrPanel, setHomeShowOcrPanel] = useState(storedPanelState.ocr);
  const [homeSearchQuery, setHomeSearchQuery] = useState('');
  const [refreshKey, setRefreshKey] = useState(0); // Increment to force PDFViewerArea to reload objects
  const [unsavedFiles, setUnsavedFiles] = useState(new Set()); // Track files with unsaved markup changes
  const [saveHandler, setSaveHandler] = useState(null); // Save to original file handler from PDFViewerArea
  const [downloadHandler, setDownloadHandler] = useState(null); // Download with annotations handler from PDFViewerArea
  const [isSavingMarkups, setIsSavingMarkups] = useState(false); // Track if saving is in progress
  const [fileHistory, setFileHistory] = useState([]); // Track file navigation history
  const [unlockedFiles, setUnlockedFiles] = useState(new Set()); // Track files unlocked for markup editing
  
  // Links panel state
  const [homeSavedModels, setHomeSavedModels] = useState([]);
  const [homeLinksPanelModelsHeight, setHomeLinksPanelModelsHeight] = useState(() => {
    try {
      const saved = localStorage.getItem('linksPanelModelsHeight');
      return saved ? parseInt(saved, 10) : 200;
    } catch (e) {
      return 200;
    }
  });
  const [homeLinksModelSearch, setHomeLinksModelSearch] = useState('');
  
  // Read showMarkupToolbar from localStorage (matches PDFViewerArea)
  const [showMarkupToolbar, setShowMarkupToolbar] = useState(() => {
    try {
      const saved = localStorage.getItem('showMarkupToolbar');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  
  // Listen for storage changes to sync showMarkupToolbar when changed in PDFViewerArea
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === 'showMarkupToolbar') {
        setShowMarkupToolbar(e.newValue === null ? true : e.newValue === 'true');
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);
  
  // Re-read showMarkupToolbar from localStorage when returning to home screen
  // (since storage event doesn't fire for same-tab changes)
  useEffect(() => {
    if (!currentFile) {
      try {
        const saved = localStorage.getItem('showMarkupToolbar');
        setShowMarkupToolbar(saved === null ? true : saved === 'true');
      } catch {
        // Keep current value
      }
    }
  }, [currentFile]);

  // Memoized callbacks to prevent infinite loops when registering handlers
  const handleRegisterSave = useCallback((fn) => {
    setSaveHandler(() => fn);
  }, []);
  
  const handleRegisterDownload = useCallback((fn) => {
    setDownloadHandler(() => fn);
  }, []);

  const handleUnlockFile = useCallback((fileIdentifier) => {
    setUnlockedFiles(prev => new Set([...prev, fileIdentifier]));
  }, []);

  const handleLockFile = useCallback((fileIdentifier) => {
    setUnlockedFiles(prev => {
      const next = new Set(prev);
      next.delete(fileIdentifier);
      return next;
    });
  }, []);

  // Save panel state to sessionStorage when it changes
  useEffect(() => {
    try {
      sessionStorage.setItem(`panelState_${projectId}`, JSON.stringify({
        search: homeShowSearchPanel,
        objectFinder: homeShowObjectFinder,
        smartLinks: homeShowSmartLinks,
        view: homeShowViewPanel,
        ocr: homeShowOcrPanel
      }));
    } catch (e) {
      console.error('Error saving panel state:', e);
    }
  }, [projectId, homeShowSearchPanel, homeShowObjectFinder, homeShowSmartLinks, homeShowViewPanel, homeShowOcrPanel]);

  // Save links panel models height to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('linksPanelModelsHeight', homeLinksPanelModelsHeight.toString());
    } catch (e) {
      console.warn('Failed to save linksPanelModelsHeight:', e);
    }
  }, [homeLinksPanelModelsHeight]);

  // Links panel resize handler
  const startHomeLinksPanelResize = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = homeLinksPanelModelsHeight;
    
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    
    const handleMouseMove = (moveEvent) => {
      const dy = moveEvent.clientY - startY;
      const newHeight = Math.max(100, Math.min(500, startHeight + dy));
      setHomeLinksPanelModelsHeight(newHeight);
    };
    
    const handleMouseUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Prevent browser zoom (Ctrl+scroll, Ctrl+plus/minus)
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

  // Callback for PDFViewerArea to report panel state changes
  const handlePanelStateChange = useCallback((panelState) => {
    setHomeShowSearchPanel(panelState.search);
    setHomeShowObjectFinder(panelState.objectFinder);
    setHomeShowSmartLinks(panelState.smartLinks);
    setHomeShowViewPanel(panelState.view);
    setHomeShowOcrPanel(panelState.ocr);
  }, []);

  // Handle navigating back with unsaved changes warning
  const handleBackToProjects = useCallback(() => {
    if (unsavedFiles.size > 0) {
      const fileNames = Array.from(unsavedFiles).slice(0, 3).join(', ');
      const moreCount = unsavedFiles.size > 3 ? ` and ${unsavedFiles.size - 3} more` : '';
      const message = `You have unsaved markup changes on: ${fileNames}${moreCount}.\n\nAre you sure you want to leave? Your changes will be lost.`;
      if (!window.confirm(message)) {
        return;
      }
    }
    navigate('/');
  }, [unsavedFiles, navigate]);

  // Load project data - reload on every navigation to get fresh data
  useEffect(() => {
    // Reset the return/navigate handler refs on new navigation
    handledReturnRef.current = false;
    handledNavigateRef.current = false;
    
    const loadProject = async () => {
      try {
        const loadedProject = await getProject(projectId);
        
        if (loadedProject) {
          setProject(loadedProject);
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
  }, [projectId, navigate, location.key]); // Add location.key to reload on navigation

  // Load models for Links panel
  useEffect(() => {
    const loadModels = async () => {
      try {
        const models = await getModels();
        // Filter to only show 'Smart Link' type models
        const linkModels = (models || []).filter(m => m.modelType === 'Smart Link');
        setHomeSavedModels(linkModels);
      } catch (error) {
        console.error('Error loading models:', error);
      }
    };
    loadModels();
  }, [projectId]);

  // Get flat list of all files for navigation (including nested folders)
  const allFiles = useMemo(() => {
    if (!project?.folders) return [];
    
    const files = [];
    
    // Recursive function to get all files from nested folders
    const collectFiles = (folders, parentPath = '') => {
      folders.forEach(folder => {
        const folderPath = parentPath ? `${parentPath}/${folder.name}` : folder.name;
        if (folder.files) {
          folder.files.forEach(file => {
            files.push({ ...file, folderName: folderPath });
          });
        }
        if (folder.subfolders?.length > 0) {
          collectFiles(folder.subfolders, folderPath);
        }
      });
    };
    
    collectFiles(project.folders);
    return files;
  }, [project]);

  // Check for navigation state (from Classes page)
  useEffect(() => {
    if (location.state?.navigateToObject && project && allFiles.length > 0 && !handledNavigateRef.current) {
      handledNavigateRef.current = true;
      const obj = location.state.navigateToObject;
      
      // Find and select the file that contains this object
      if (obj.filename) {
        const targetFile = allFiles.find(f => f.backendFilename === obj.filename);
        if (targetFile) {
          // If different file, select it first
          if (!currentFile || currentFile.backendFilename !== obj.filename) {
            setCurrentFile(targetFile);
          }
          // Set pending navigation - will be handled after PDF loads
          setPendingNavigation(obj);
        }
      }
      
      // Clear the state so it doesn't persist on refresh
      window.history.replaceState({}, document.title);
    }
    // Handle openFile state (from Regions page with goToPage)
    else if (location.state?.openFile && project && allFiles.length > 0 && !handledReturnRef.current) {
      handledReturnRef.current = true;
      const fileInfo = location.state.openFile;
      const goToPage = location.state.goToPage;
      const targetFile = allFiles.find(f => 
        f.backendFilename === fileInfo.backendFilename || f.id === fileInfo.id
      );
      if (targetFile && (!currentFile || currentFile.id !== targetFile.id)) {
        setCurrentFile(targetFile);
        // If goToPage is specified, set pending navigation
        if (goToPage) {
          setPendingNavigation({ page: goToPage - 1, filename: targetFile.backendFilename });
        }
      }
      // Clear the state
      window.history.replaceState({}, document.title);
    }
    // Handle returning to a specific file (from Classes/Models page)
    else if (location.state?.returnToFile && project && allFiles.length > 0 && !handledReturnRef.current) {
      handledReturnRef.current = true;
      const fileInfo = location.state.returnToFile;
      const targetFile = allFiles.find(f => 
        f.backendFilename === fileInfo.backendFilename || f.id === fileInfo.id
      );
      // Only set if different from current file
      if (targetFile && (!currentFile || currentFile.id !== targetFile.id)) {
        setCurrentFile(targetFile);
      }
      // Clear the state
      window.history.replaceState({}, document.title);
    }
  }, [location.state, project, allFiles]);

  // Reset navigation refs when location key changes (new navigation)
  useEffect(() => {
    handledNavigateRef.current = false;
    handledReturnRef.current = false;
  }, [location.key]);

  // Load PDF from backend when current file changes
  useEffect(() => {
    const loadPdf = async () => {
      // Revoke old blob URL to prevent memory leak
      if (currentPdfUrl) {
        URL.revokeObjectURL(currentPdfUrl);
        setCurrentPdfUrl(null);
      }

      // Use backendFilename if available, otherwise try the file name
      const filename = currentFile?.backendFilename || currentFile?.name;

      if (filename) {
        setIsLoadingPdf(true);
        try {
          const url = await getPdfFromBackend(filename, currentFile?.sourceFolder);
          setCurrentPdfUrl(url);
        } catch (error) {
          console.error('Error loading PDF:', error);
          setCurrentPdfUrl(null);
        } finally {
          setIsLoadingPdf(false);
        }
      }
    };

    loadPdf();

    // Cleanup on unmount
    return () => {
      if (currentPdfUrl) {
        URL.revokeObjectURL(currentPdfUrl);
      }
    };
  }, [currentFile]);

  // Save project changes
  const updateProject = async (updatedProject) => {
    setProject(updatedProject);
    
    try {
      await saveProject(updatedProject);
    } catch (error) {
      console.error('Error saving project:', error);
    }
  };

  // Handle file selection (with optional object to navigate to)
  const handleFileSelect = useCallback((file, navigateToObj = null) => {
    console.log('File selected:', file?.name, file?.id, navigateToObj ? 'with navigation' : '');
    setCurrentFile(file);
    
    // Add file to history if it's a valid file and not already the last item
    if (file) {
      setFileHistory(prev => {
        // Don't add if it's the same as the last file
        if (prev.length > 0 && prev[prev.length - 1]?.id === file.id) {
          return prev;
        }
        // Keep last 10 files, but we only display 3
        const newHistory = [...prev, file].slice(-10);
        return newHistory;
      });
    }
    
    // If an object was passed, set it as pending navigation
    if (navigateToObj) {
      setPendingNavigation(navigateToObj);
    }
  }, []);

  // Helper function to find folder containing file in nested structure
  const findFolderContainingFile = useCallback((folders, backendFilename) => {
    for (const folder of folders) {
      if (folder.files?.some(f => f.backendFilename === backendFilename)) {
        return folder;
      }
      if (folder.subfolders?.length > 0) {
        const found = findFolderContainingFile(folder.subfolders, backendFilename);
        if (found) return found;
      }
    }
    return null;
  }, []);

  // Navigate to next/previous file (within same folder only)
  const handleNavigateFile = useCallback((direction) => {
    if (!currentFile || !project?.folders) return;
    
    // Find the folder containing the current file
    const currentFolder = findFolderContainingFile(project.folders, currentFile.backendFilename);
    if (!currentFolder || !currentFolder.files?.length) return;
    
    // Get files in current folder only
    const folderFiles = currentFolder.files;
    const currentIndex = folderFiles.findIndex(f => f.id === currentFile.id);
    if (currentIndex === -1) return;
    
    let newIndex;
    if (direction === 'next') {
      newIndex = currentIndex + 1;
      if (newIndex >= folderFiles.length) newIndex = 0; // Wrap to start
    } else {
      newIndex = currentIndex - 1;
      if (newIndex < 0) newIndex = folderFiles.length - 1; // Wrap to end
    }
    
    const newFile = folderFiles[newIndex];
    console.log('Navigating to:', newFile?.name, 'in folder:', currentFolder.name);
    setCurrentFile(newFile);
  }, [currentFile, project, findFolderContainingFile]);

  if (isLoading) {
    return <div className="loading">Loading project...</div>;
  }

  if (!project) {
    return <div className="loading">Project not found</div>;
  }

  // Show Infinite View as full page when active
  if (showInfiniteView) {
    return (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }}>
        <InfiniteView
          initialFile={infiniteViewInitial.file}
          initialPage={infiniteViewInitial.page}
          project={project}
          allFiles={allFiles}
          onClose={() => setShowInfiniteView(false)}
          onProjectUpdate={updateProject}
          onRefresh={async () => {
            try {
              const loadedProject = await getProject(projectId);
              if (loadedProject) {
                setProject(loadedProject);
              }
              // Increment refreshKey to reload detected objects
              setRefreshKey(prev => prev + 1);
            } catch (error) {
              console.error('Error refreshing project:', error);
            }
          }}
        />
      </div>
    );
  }

  // Home screen content when no file is selected
  const renderHomeScreen = () => (
    <div className="pdf-viewer-area">
      {/* Toolbar - same as PDF view */}
      <div className="pdf-toolbar pdf-toolbar-top">
        <div className="toolbar-left">
        </div>
        
        <div className="toolbar-right">
          <button 
            onClick={() => navigate(`/project/${projectId}/docprops`)}
            title="Document Properties"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="white" strokeWidth="1.5"/>
              <polyline points="14 2 14 8 20 8" stroke="white" strokeWidth="1.5"/>
              <line x1="16" y1="13" x2="8" y2="13" stroke="white" strokeWidth="1.5"/>
              <line x1="16" y1="17" x2="8" y2="17" stroke="white" strokeWidth="1.5"/>
              <line x1="10" y1="9" x2="8" y2="9" stroke="white" strokeWidth="1.5"/>
            </svg>
            Properties
          </button>
          
          <button 
            onClick={() => {
              setHomeShowOcrPanel(!homeShowOcrPanel);
              if (!homeShowOcrPanel) {
                setHomeShowSmartLinks(false);
                setHomeShowObjectFinder(false);
                setHomeShowSearchPanel(false);
                setHomeShowViewPanel(false);
              }
            }}
            className={homeShowOcrPanel ? 'active' : ''}
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
              <rect x="2" y="3" width="12" height="10" rx="1" stroke="white" strokeWidth="1.5" fill="none"/>
              <path d="M5 7H11M5 10H9" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            OCR
          </button>
          
          <button 
            onClick={() => {
              setHomeShowSmartLinks(!homeShowSmartLinks);
              if (!homeShowSmartLinks) {
                setHomeShowOcrPanel(false);
                setHomeShowObjectFinder(false);
                setHomeShowSearchPanel(false);
                setHomeShowViewPanel(false);
              }
            }}
            className={homeShowSmartLinks ? 'active' : ''}
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle', transform: 'rotate(45deg)'}}>
              <path d="M6.5 10.5L9.5 7.5M7 5H5C3.89543 5 3 5.89543 3 7V9C3 10.1046 3.89543 11 5 11H7M9 5H11C12.1046 5 13 5.89543 13 7V9C13 10.1046 12.1046 11 11 11H9" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Links
          </button>
          
          <button 
            onClick={() => {
              setHomeShowObjectFinder(!homeShowObjectFinder);
              if (!homeShowObjectFinder) {
                setHomeShowOcrPanel(false);
                setHomeShowSmartLinks(false);
                setHomeShowSearchPanel(false);
                setHomeShowViewPanel(false);
              }
            }}
            className={homeShowObjectFinder ? 'active' : ''}
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
              <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M8 8V15M8 8L2 4.5M8 8L14 4.5" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
            Objects
          </button>
          
          <button 
            onClick={() => {
              setHomeShowSearchPanel(!homeShowSearchPanel);
              if (!homeShowSearchPanel) {
                setHomeShowOcrPanel(false);
                setHomeShowSmartLinks(false);
                setHomeShowObjectFinder(false);
                setHomeShowViewPanel(false);
              }
            }}
            className={homeShowSearchPanel ? 'active' : ''}
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
              <circle cx="7" cy="7" r="4" stroke="white" strokeWidth="1.5"/>
              <path d="M10 10L13 13" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Search
          </button>
          
          <button 
            onClick={() => {
              setHomeShowViewPanel(!homeShowViewPanel);
              if (!homeShowViewPanel) {
                setHomeShowOcrPanel(false);
                setHomeShowSmartLinks(false);
                setHomeShowObjectFinder(false);
                setHomeShowSearchPanel(false);
              }
            }}
            className={homeShowViewPanel ? 'active' : ''}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px', verticalAlign: 'middle' }}>
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            View
          </button>
        </div>
      </div>

      {/* Markup toolbar - conditionally visible based on user preference */}
      {showMarkupToolbar && (
      <div className="pdf-toolbar pdf-toolbar-markup markup-toolbar-disabled">
        {/* Left - empty spacer */}
        <div className="markup-toolbar-left"></div>
        
        {/* Center - Markup tools */}
        <div className="markup-toolbar-tools">
          <button className="markup-tb-btn" disabled title="Select a PDF first">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M11.5 1.5L14.5 4.5L5 14H2V11L11.5 1.5Z" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M9 4L12 7" stroke="white" strokeWidth="1.5"/>
            </svg>
          </button>
          <button className="markup-tb-btn" disabled title="Select a PDF first">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="4" y="2" width="8" height="10" rx="1" stroke="white" strokeWidth="1.5"/>
              <path d="M6 12V14H10V12" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="6" y1="5" x2="10" y2="5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <button className="markup-tb-btn" disabled title="Select a PDF first">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <line x1="2" y1="14" x2="12" y2="4" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M12 4L12 9M12 4L7 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button className="markup-tb-btn" disabled title="Select a PDF first">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <line x1="2" y1="14" x2="14" y2="2" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <button className="markup-tb-btn" disabled title="Select a PDF first">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="3" width="12" height="10" rx="1" stroke="white" strokeWidth="1.5"/>
            </svg>
          </button>
          <button className="markup-tb-btn" disabled title="Select a PDF first">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <ellipse cx="8" cy="8" rx="6" ry="5" stroke="white" strokeWidth="1.5"/>
            </svg>
          </button>
          <button className="markup-tb-btn" disabled title="Select a PDF first">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 12C3 12 5 4 13 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
            </svg>
          </button>
          <button className="markup-tb-btn" disabled title="Select a PDF first">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 11C2.5 11 2 9.5 3 8.5C2 7.5 3 6 4.5 6C4.5 4 6 3 8 3C10 3 11.5 4 11.5 6C13 6 14 7.5 13 8.5C14 9.5 13.5 11 12 11" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4 11C5 12 7 12 8 12C9 12 11 12 12 11" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <button className="markup-tb-btn" disabled title="Select a PDF first">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <polyline points="2,12 5,5 9,10 14,3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
          </button>
          <button className="markup-tb-btn" disabled title="Select a PDF first">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <polyline points="2,12 5,5 9,10 13,4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <path d="M13 4L13 7.5M13 4L9.5 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button className="markup-tb-btn" disabled title="Select a PDF first">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 12 Q3.5 10 5 12 Q6.5 14 8 12 Q9.5 10 11 12 Q12.5 14 14 12" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
              <path d="M2 7 Q3.5 5 5 7 Q6.5 9 8 7 Q9.5 5 11 7 Q12.5 9 14 7" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
            </svg>
          </button>
          
          <span className="markup-tb-divider"></span>
          
          <button className="markup-tb-btn" disabled title="Select a PDF first">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <text x="4" y="12" fill="white" fontSize="12" fontWeight="bold" fontFamily="Arial">T</text>
            </svg>
          </button>
          <button className="markup-tb-btn" disabled title="Select a PDF first">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 3H14V10H6L3 13V10H2V3Z" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button className="markup-tb-btn" disabled title="Select a PDF first">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="12" height="12" rx="1" stroke="white" strokeWidth="1.5"/>
              <path d="M10 2V6H14" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="4" y1="7" x2="8" y2="7" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="4" y1="10" x2="10" y2="10" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          
          <span className="markup-tb-divider"></span>
          
          <button className="markup-tb-btn" disabled title="Select a PDF first">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 14H14" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M2 10L6 14L14 6L10 2L2 10Z" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M6 6L10 10" stroke="white" strokeWidth="1.5"/>
            </svg>
          </button>
          
          <span className="markup-tb-divider"></span>
          
          <button className="markup-tb-btn" disabled title="Select a PDF first">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="5" height="5" rx="1" stroke="white" strokeWidth="1.5"/>
              <rect x="9" y="2" width="5" height="5" rx="1" stroke="white" strokeWidth="1.5"/>
              <rect x="2" y="9" width="5" height="5" rx="1" stroke="white" strokeWidth="1.5"/>
              <rect x="9" y="9" width="5" height="5" rx="1" stroke="white" strokeWidth="1.5"/>
            </svg>
          </button>
        </div>
        
        {/* Right - Document name */}
        <span className="markup-toolbar-docname">No document</span>
      </div>
      )}
      
      {/* Tool Options Bar - conditionally visible based on user preference */}
      {showMarkupToolbar && (
      <div className="pdf-toolbar pdf-toolbar-options">
        <div className="tool-options-row">
        </div>
        
        {/* Unlock button - disabled when no file */}
        <button 
          className="unlock-btn"
          disabled={true}
          title="Select a PDF to unlock editing"
        >
          🔒 Document Locked
        </button>
      </div>
      )}

      <div className="viewer-content">
        <div className="no-file-selected">
        </div>
        
        {/* Smart Links Panel */}
        {homeShowSmartLinks && (
          <div className="smart-links-panel">
            <div className="panel-header">
              <h3>Links</h3>
              <button className="close-panel" onClick={() => setHomeShowSmartLinks(false)}>×</button>
            </div>
            <div className="panel-content">
              {/* Navigation Link */}
              <div className="panel-nav-links">
                <button 
                  className="nav-link-btn"
                  onClick={() => navigate(`/project/${projectId}/smartlinks`)}
                >
                  Document Link Properties
                </button>
              </div>

              <div className="panel-section">
                <div className="mode-buttons">
                  <button className="disabled-btn" disabled>
                    Assign Document Link
                  </button>
                </div>
                <p className="mode-hint disabled-hint">Select a document to assign links</p>
              </div>

              <div className="panel-section panel-section-resizable" style={{ height: homeLinksPanelModelsHeight, minHeight: 100, maxHeight: 500, opacity: 0.5 }}>
                <h4>Models ({homeSavedModels.length})</h4>
                {homeSavedModels.length === 0 ? (
                  <p className="no-models">No models trained yet</p>
                ) : (
                  <>
                    <input
                      type="text"
                      className="model-search-input"
                      placeholder="Search models..."
                      value={homeLinksModelSearch}
                      onChange={(e) => setHomeLinksModelSearch(e.target.value)}
                      disabled
                    />
                    <div className="models-list scrollable" style={{ height: 'calc(100% - 60px)' }}>
                      {homeSavedModels
                        .filter(model => 
                          model.className.toLowerCase().includes(homeLinksModelSearch.toLowerCase())
                        )
                        .map(model => (
                          <div key={model.id} className="model-item disabled">
                            <label className="model-checkbox">
                              <input
                                type="checkbox"
                                checked={false}
                                disabled
                              />
                              <span>{model.className}</span>
                            </label>
                            <span className="model-info">{model.numTemplates} templates</span>
                          </div>
                        ))}
                    </div>
                  </>
                )}
              </div>

              {/* Resizer handle */}
              <div 
                className="panel-section-resizer"
                onMouseDown={startHomeLinksPanelResize}
                title="Drag to resize"
              />

              <div className="panel-section" style={{ opacity: 0.5 }}>
                <h4>Find Links</h4>
                <p className="mode-hint disabled-hint">Select a document to find links</p>
              </div>
            </div>
          </div>
        )}

        {/* Object Finder Panel */}
        {homeShowObjectFinder && (
          <div className="smart-links-panel">
            <div className="panel-header">
              <h3>Objects</h3>
              <button className="close-panel" onClick={() => setHomeShowObjectFinder(false)}>×</button>
            </div>
            <div className="panel-content">
              {/* Navigation Links */}
              <div className="panel-nav-links">
                <button 
                  className="nav-link-btn"
                  onClick={() => navigate(`/project/${projectId}/models`)}
                >
                  Models
                </button>
                <button 
                  className="nav-link-btn"
                  onClick={() => navigate(`/project/${projectId}/classes`)}
                >
                  Classes
                </button>
                <button 
                  className="nav-link-btn"
                  onClick={() => navigate(`/project/${projectId}/regions`)}
                >
                  Regions
                </button>
              </div>
              
              {/* Search Section */}
              <div className="panel-section">
                <h4>Search Objects</h4>
                <input
                  type="text"
                  placeholder="Search objects, tags, links..."
                  value={homeSearchQuery}
                  onChange={(e) => setHomeSearchQuery(e.target.value)}
                  className="search-input"
                />
              </div>
              
              <div className="panel-section search-results-section">
                <h4>Search Results</h4>
                <div className="search-results">
                  {homeSearchQuery.trim() ? (
                    (() => {
                      const results = (project?.detectedObjects || []).filter(obj => {
                        const query = homeSearchQuery.toLowerCase();
                        if (obj.ocr_text?.toLowerCase().includes(query)) return true;
                        if (obj.label?.toLowerCase().includes(query)) return true;
                        if (obj.className?.toLowerCase().includes(query)) return true;
                        if (obj.filename?.toLowerCase().includes(query)) return true;
                        if (obj.subclassValues) {
                          for (const value of Object.values(obj.subclassValues)) {
                            if (value && String(value).toLowerCase().includes(query)) return true;
                          }
                        }
                        return false;
                      });
                      
                      if (results.length === 0) {
                        return <p className="no-results">No results found</p>;
                      }
                      
                      return results.slice(0, 50).map((obj, idx) => (
                        <div 
                          key={obj.id || idx} 
                          className="search-result-item"
                          onClick={() => {
                            if (obj.filename) {
                              const file = allFiles.find(f => f.backendFilename === obj.filename);
                              if (file) {
                                handleFileSelect(file, obj);
                              }
                            }
                          }}
                        >
                          {obj.subclassValues && Object.keys(obj.subclassValues).length > 0 ? (
                            Object.entries(obj.subclassValues).map(([k, v]) => (
                              <div key={k} className="result-line">{k}: {v || '-'}</div>
                            ))
                          ) : (
                            <div className="result-tag">{obj.ocr_text || obj.label || 'Unknown'}</div>
                          )}
                          <div className="result-meta">
                            <span className="result-class">{obj.className}</span>
                            <span className="result-file">{obj.filename}</span>
                          </div>
                        </div>
                      ));
                    })()
                  ) : (
                    <p className="no-results">Enter a search term to find objects</p>
                  )}
                </div>
              </div>
              
              {/* Stats Section */}
              <div className="panel-section">
                <h4>📊 Project Stats</h4>
                <div className="stats-mini">
                  <div className="stat-item">
                    <span className="stat-value">{(project?.detectedObjects || []).length}</span>
                    <span className="stat-label">Objects</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">{(project?.classes || []).filter(c => !c.parentId).length}</span>
                    <span className="stat-label">Classes</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">{(project?.regionTypes || []).length}</span>
                    <span className="stat-label">Regions</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Search Panel */}
        {homeShowSearchPanel && (
          <div className="smart-links-panel">
            <div className="panel-header">
              <h3>Search</h3>
              <button className="close-panel" onClick={() => setHomeShowSearchPanel(false)}>×</button>
            </div>
            <div className="panel-content">
              <div className="panel-section">
                <input
                  type="text"
                  placeholder="Search objects, tags, links..."
                  value={homeSearchQuery}
                  onChange={(e) => setHomeSearchQuery(e.target.value)}
                  className="search-input"
                  autoFocus
                />
              </div>
              
              <div className="panel-section search-results-section">
                <h4>Search Results</h4>
                <div className="search-results">
                  {homeSearchQuery.trim() ? (
                    (() => {
                      const results = (project?.detectedObjects || []).filter(obj => {
                        const query = homeSearchQuery.toLowerCase();
                        if (obj.ocr_text?.toLowerCase().includes(query)) return true;
                        if (obj.label?.toLowerCase().includes(query)) return true;
                        if (obj.className?.toLowerCase().includes(query)) return true;
                        if (obj.filename?.toLowerCase().includes(query)) return true;
                        if (obj.subclassValues) {
                          for (const value of Object.values(obj.subclassValues)) {
                            if (value && String(value).toLowerCase().includes(query)) return true;
                          }
                        }
                        return false;
                      });
                      
                      if (results.length === 0) {
                        return <p className="no-results">No results found</p>;
                      }
                      
                      return results.slice(0, 50).map((obj, idx) => (
                        <div 
                          key={obj.id || idx} 
                          className="search-result-item"
                          onClick={() => {
                            if (obj.filename) {
                              const file = allFiles.find(f => f.backendFilename === obj.filename);
                              if (file) {
                                handleFileSelect(file, obj);
                              }
                            }
                          }}
                        >
                          {obj.subclassValues && Object.keys(obj.subclassValues).length > 0 ? (
                            Object.entries(obj.subclassValues).map(([k, v]) => (
                              <div key={k} className="result-line">{k}: {v || '-'}</div>
                            ))
                          ) : (
                            <div className="result-tag">{obj.ocr_text || obj.label || 'Unknown'}</div>
                          )}
                          <div className="result-meta">
                            <span className="result-class">{obj.className}</span>
                            <span className="result-file">{obj.filename}</span>
                          </div>
                        </div>
                      ));
                    })()
                  ) : (
                    <p className="no-results">Type to search across all documents</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* View Panel */}
        {homeShowViewPanel && (
          <div className="smart-links-panel">
            <div className="panel-header">
              <h3>View Mode</h3>
              <button className="close-panel" onClick={() => setHomeShowViewPanel(false)}>×</button>
            </div>
            <div className="panel-content">
              <div className="panel-section">
                <h4>Page Layout</h4>
                <div className="view-mode-options-simple">
                  <label 
                    className="view-mode-option-simple selected disabled"
                  >
                    <input 
                      type="radio" 
                      name="viewMode" 
                      checked={true} 
                      onChange={() => {}}
                      disabled
                    />
                    <span>Single Page</span>
                  </label>
                  
                  <label 
                    className="view-mode-option-simple disabled"
                  >
                    <input 
                      type="radio" 
                      name="viewMode" 
                      checked={false} 
                      onChange={() => {}}
                      disabled
                    />
                    <span>Continuous</span>
                  </label>
                  
                  <label 
                    className={`view-mode-option-simple ${allFiles.length === 0 ? 'disabled' : ''}`}
                    onClick={() => {
                      if (allFiles.length > 0) {
                        setHomeShowViewPanel(false);
                        setInfiniteViewInitial({ file: allFiles[0], page: 1 });
                        setShowInfiniteView(true);
                      }
                    }}
                  >
                    <input 
                      type="radio" 
                      name="viewMode" 
                      checked={false} 
                      onChange={() => {}}
                    />
                    <span>Infinite Canvas</span>
                  </label>
                </div>
                
                <p className="view-mode-tip-small">
                  Select a document to change view mode.
                </p>
              </div>
              
              <div className="panel-section">
                <h4>View Preferences</h4>
                <div className="view-preferences">
                  <div className="view-pref-row">
                    <label>Background Colour</label>
                    <input 
                      type="color" 
                      value="#525659"
                      onChange={() => {}}
                      className="color-input-small"
                      disabled
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* OCR Panel - disabled when no file */}
        {homeShowOcrPanel && (
          <div className="smart-links-panel ocr-panel">
            <div className="panel-header">
              <h3>OCR</h3>
              <button className="close-panel" onClick={() => setHomeShowOcrPanel(false)}>×</button>
            </div>
            <div className="panel-content">
              <div className="panel-section">
                <h4>OCR Mode</h4>
                <div className="mode-buttons">
                  <button className="disabled-btn" disabled>
                    Current Page
                  </button>
                  <button className="disabled-btn" disabled>
                    All Pages
                  </button>
                </div>
                <p className="mode-hint disabled-hint">Select a document to run OCR</p>
              </div>

              <div className="panel-section" style={{ opacity: 0.5 }}>
                <h4>Run OCR</h4>
                <button className="primary-btn" disabled style={{ width: '100%' }}>
                  🔍 Run OCR
                </button>
              </div>

              <div className="panel-section" style={{ opacity: 0.5 }}>
                <h4>Filter Results</h4>
                <input
                  type="text"
                  className="model-search-input"
                  placeholder="Filter text..."
                  disabled
                />
                <div className="quick-filters" style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  <button className="quick-filter-btn" disabled>TI</button>
                  <button className="quick-filter-btn" disabled>FI</button>
                  <button className="quick-filter-btn" disabled>LI</button>
                  <button className="quick-filter-btn" disabled>PI</button>
                  <button className="quick-filter-btn" disabled>HS</button>
                </div>
              </div>

              <div className="panel-section" style={{ opacity: 0.5 }}>
                <h4>Results</h4>
                <p className="no-models">No OCR results yet</p>
              </div>
            </div>
          </div>
        )}
        
        {/* Bottom floating toolbar - disabled when no file */}
        <div 
          className="pdf-toolbar pdf-toolbar-bottom"
          style={{
            left: (homeShowSmartLinks || homeShowObjectFinder || homeShowSearchPanel || homeShowViewPanel || homeShowOcrPanel) 
              ? 'calc((100% - 320px) / 2)'
              : '50%',
            transform: 'translateX(-50%)'
          }}
        >
          <div className="toolbar-group toolbar-mode-buttons">
            <button disabled title="Select (V)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
                <path d="M13 13l6 6"/>
              </svg>
            </button>
            
            <button disabled title="Pan (Shift+V)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/>
                <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/>
                <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/>
                <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
              </svg>
            </button>
            
            <button disabled title="Zoom (Z)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                <line x1="11" y1="8" x2="11" y2="14"/>
                <line x1="8" y1="11" x2="14" y2="11"/>
              </svg>
            </button>
          </div>
          
          <div className="toolbar-divider" />
          
          <div className="toolbar-group">
            <button disabled title="Zoom out" style={{ color: 'white' }}>−</button>
            <input type="text" className="zoom-input" value="100%" disabled readOnly />
            <button disabled title="Zoom in" style={{ color: 'white' }}>+</button>
          </div>
          
          <div className="toolbar-divider" />
          
          <div className="toolbar-group">
            <button disabled title="Rotate" style={{ color: 'white' }}>↻</button>
          </div>
          
          <div className="toolbar-divider" />
          
          <div className="toolbar-group" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button disabled title="Previous" style={{ color: 'white' }}>◀</button>
            <span className="page-info" style={{ color: 'white', fontSize: '12px' }}>- / -</span>
            <button disabled title="Next" style={{ color: 'white' }}>▶</button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="project-workspace">
      <header className="workspace-header">
        <button className="back-btn" onClick={handleBackToProjects}>
          ← Back to Projects
        </button>
        <h1>{project.name}</h1>
        <h1 className="brand-title">pidly</h1>
      </header>

      <div className="workspace-content">
        <FileSidebar
          project={project}
          currentFile={currentFile}
          onFileSelect={handleFileSelect}
          onProjectUpdate={updateProject}
          unsavedFiles={unsavedFiles}
          unlockedFiles={unlockedFiles}
          onSaveFile={saveHandler}
          onDownloadWithAnnotations={downloadHandler}
          isSaving={isSavingMarkups}
          fileHistory={fileHistory}
        />
        
        {!currentFile ? (
          renderHomeScreen()
        ) : (
          <PDFViewerArea
            currentFile={currentFile}
            pdfUrl={currentPdfUrl}
            isLoadingPdf={isLoadingPdf}
            project={project}
            allFiles={allFiles}
            onFileSelect={handleFileSelect}
            onNavigateFile={handleNavigateFile}
            onProjectUpdate={updateProject}
            pendingNavigation={pendingNavigation}
            onNavigationComplete={() => setPendingNavigation(null)}
            unlockedFiles={unlockedFiles}
            onUnlockFile={handleUnlockFile}
            onLockFile={handleLockFile}
            initialShowSearchPanel={homeShowSearchPanel}
            initialShowObjectFinder={homeShowObjectFinder}
            initialShowSmartLinks={homeShowSmartLinks}
            initialShowViewPanel={homeShowViewPanel}
            initialShowOcrPanel={homeShowOcrPanel}
            onPanelStateChange={handlePanelStateChange}
            onUnsavedChangesUpdate={setUnsavedFiles}
            onRegisterSaveHandler={handleRegisterSave}
            onRegisterDownloadHandler={handleRegisterDownload}
            onSavingStateChange={setIsSavingMarkups}
            refreshKey={refreshKey}
            onOpenInfiniteView={(file, page) => {
              setInfiniteViewInitial({ file, page });
              setShowInfiniteView(true);
            }}
            onRefresh={async () => {
              try {
                const loadedProject = await getProject(projectId);
                if (loadedProject) {
                  setProject(loadedProject);
                }
                // Increment refreshKey to reload detected objects
                setRefreshKey(prev => prev + 1);
              } catch (error) {
                console.error('Error refreshing project:', error);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
