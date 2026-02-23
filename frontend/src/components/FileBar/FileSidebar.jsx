import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadPdfToBackend, deletePdfFromBackend, saveObjectsToBackend, getObjectsFromBackend, listSourceFolder, browseSourceFolder, browseSourceFiles } from '../../utils/storage';
import { BACKEND_URL } from '../../utils/config';
import { naturalSort, sortByName, findFolderById, getFolderPath, getAllNestedFiles, getAllNestedFolders } from '../../utils/fileUtils';
import './FileSidebar.css';

// Check if File System Access API is supported
const isFileSystemAccessSupported = () => {
  return 'showDirectoryPicker' in window;
};

export default function FileSidebar({ project, currentFile, onFileSelect, onProjectUpdate, unsavedFiles = new Set(), unlockedFiles = new Set(), onSaveFile, onDownloadWithAnnotations, isSaving = false, fileHistory = [] }) {
  const navigate = useNavigate();
  const [currentFolderId, setCurrentFolderId] = useState(null); // null = root level
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('#3498db');
  const [newFolderParentId, setNewFolderParentId] = useState(null); // For subfolders
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const [showOpenMenu, setShowOpenMenu] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const uploadMenuRef = useRef(null);
  const openMenuRef = useRef(null);
  
  // Multi-select state
  const [selectedFolders, setSelectedFolders] = useState(new Set());
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  
  // Linked local folder state
  const [linkedFolderHandles, setLinkedFolderHandles] = useState({}); // folderId -> DirectoryHandle
  const [linkedFolderFiles, setLinkedFolderFiles] = useState({}); // folderId -> [file objects]
  const [refreshingFolders, setRefreshingFolders] = useState(new Set());
  
  // Resizable sidebar state
  const [sidebarWidth, setSidebarWidth] = useState(project?.sidebarWidth || 320);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef(null);
  
  // Drag and drop state for folders and files
  const [draggedFolder, setDraggedFolder] = useState(null);
  const [dragOverFolder, setDragOverFolder] = useState(null);
  const [dropPosition, setDropPosition] = useState(null);
  const [draggedFile, setDraggedFile] = useState(null);
  const [dragOverTargetFolder, setDragOverTargetFolder] = useState(null);

  // Load saved sidebar width when project loads
  useEffect(() => {
    if (project?.sidebarWidth) {
      setSidebarWidth(project.sidebarWidth);
    }
  }, [project?.sidebarWidth]);

  // Close upload menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (uploadMenuRef.current && !uploadMenuRef.current.contains(e.target)) {
        setShowUploadMenu(false);
      }
    };
    if (showUploadMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUploadMenu]);

  // Close open folder menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (openMenuRef.current && !openMenuRef.current.contains(e.target)) {
        setShowOpenMenu(false);
      }
    };
    if (showOpenMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showOpenMenu]);

  // Sidebar resize handlers
  const handleResizeStart = (e) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e) => {
      const newWidth = Math.max(320, Math.min(500, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = async () => {
      setIsResizing(false);
      
      // Save to project
      if (project && onProjectUpdate) {
        const updatedProject = {
          ...project,
          sidebarWidth: sidebarWidth
        };
        onProjectUpdate(updatedProject);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, project, sidebarWidth, onProjectUpdate]);

  // ============ Local Folder Functions ============
  
  // Read PDF files from a directory handle
  const readPdfsFromDirectory = useCallback(async (directoryHandle, folderId) => {
    const files = [];
    try {
      for await (const entry of directoryHandle.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.pdf')) {
          const file = await entry.getFile();
          files.push({
            id: `local_${folderId}_${entry.name}`,
            name: entry.name,
            fileHandle: entry,
            file: file, // The actual File object
            isLocal: true,
            folderId: folderId,
            size: file.size,
            lastModified: file.lastModified
          });
        }
      }
      // Sort by name
      files.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      console.error('Error reading directory:', error);
    }
    return files;
  }, []);

  // Open local folder using File System Access API
  const handleOpenLocalFolder = async () => {
    if (!isFileSystemAccessSupported()) {
      alert('Your browser does not support the File System Access API. Please use Chrome or Edge.');
      return;
    }

    try {
      // Show directory picker
      const directoryHandle = await window.showDirectoryPicker({
        mode: 'read'
      });

      const folderName = directoryHandle.name;
      const folderId = `linked_${Date.now()}`;

      // Read PDF files from the directory
      setUploadProgress(`Reading files from ${folderName}...`);
      const files = await readPdfsFromDirectory(directoryHandle, folderId);

      if (files.length === 0) {
        alert(`No PDF files found in "${folderName}"`);
        setUploadProgress('');
        return;
      }

      // Store the directory handle
      setLinkedFolderHandles(prev => ({
        ...prev,
        [folderId]: directoryHandle
      }));

      // Store the files
      setLinkedFolderFiles(prev => ({
        ...prev,
        [folderId]: files
      }));

      // Create linked folder in project
      const newFolder = {
        id: folderId,
        name: folderName,
        isLinked: true, // Mark as linked folder
        localPath: folderName, // Store folder name for display
        files: [], // Linked folders don't store files in project data
        subfolders: []
      };

      const updatedProject = {
        ...project,
        folders: [...(project.folders || []), newFolder]
      };

      onProjectUpdate(updatedProject);
      navigateToFolder(folderId); // Navigate into the new linked folder
      setUploadProgress(`Linked "${folderName}" with ${files.length} PDF(s)`);
      setTimeout(() => setUploadProgress(''), 3000);

    } catch (error) {
      if (error.name === 'AbortError') {
        // User cancelled - that's fine
        return;
      }
      console.error('Error opening local folder:', error);
      alert('Failed to open folder: ' + error.message);
    }
    
    setShowOpenMenu(false);
  };

  // Open local files using File System Access API (individual PDF files, no upload)
  const handleOpenLocalFiles = async () => {
    try {
      const result = await browseSourceFiles();
      if (!result.success || !result.files?.length) return;

      const newFiles = result.files.map((f, i) => ({
        id: `sf_file_${Date.now()}_${i}_${f.filename}`,
        name: f.filename,
        backendFilename: f.filename,
        sourceFolder: f.sourceFolder,
        isLocal: true,
        size: f.size,
      }));

      if (currentFolderId) {
        // Inside a linked folder — add to linked folder files
        setLinkedFolderFiles(prev => ({
          ...prev,
          [currentFolderId]: sortByName([...(prev[currentFolderId] || []), ...newFiles])
        }));
      } else {
        // At root level — add to project files
        const updatedProject = {
          ...project,
          files: sortByName([...(project.files || []), ...newFiles])
        };
        onProjectUpdate(updatedProject);
      }

      setUploadProgress(`Opened ${newFiles.length} file(s)`);
      setTimeout(() => setUploadProgress(''), 3000);

      // Auto-select the first file
      if (newFiles.length > 0 && onFileSelect) {
        onFileSelect(newFiles[0]);
      }
    } catch (error) {
      console.error('Error opening files:', error);
      alert('Failed to open files: ' + error.message);
    }

    setShowOpenMenu(false);
  };

  // Open source folder — native folder picker, then backend reads PDFs directly
  const handleOpenSourceFolder = async () => {
    try {
      // Open native folder picker via backend
      const browseResult = await browseSourceFolder();
      
      if (!browseResult.success || browseResult.cancelled) {
        return; // User cancelled
      }
      
      const folderPath = browseResult.folderPath;
      
      setUploadProgress(`Scanning folder...`);
      const result = await listSourceFolder(folderPath);
      
      if ((!result.files || result.files.length === 0) && (!result.subfolders || result.subfolders.length === 0)) {
        alert(`No PDF files found in "${folderPath}"`);
        setUploadProgress('');
        return;
      }
      
      const rootFolderId = `sf_${Date.now()}`;
      
      // Recursively build folder structure from backend response
      const buildFolderTree = (backendFolder, parentId, sfPath) => {
        const folderId = parentId;
        
        const fileObjects = (backendFolder.files || []).map(f => ({
          id: `${folderId}_${f.name}`,
          name: f.name,
          backendFilename: f.name,
          sourceFolder: sfPath,
          size: f.size,
          lastModified: f.lastModified,
        }));
        
        const subfolders = (backendFolder.subfolders || []).map((sf, idx) => {
          const subId = `${folderId}_sub${idx}`;
          return buildFolderTree(
            sf, 
            subId, 
            sf.path // backend provides the full path for each subfolder
          );
        });
        
        return {
          id: folderId,
          name: backendFolder.name,
          isSourceFolder: true,
          sourceFolderPath: sfPath,
          files: fileObjects,
          subfolders,
        };
      };
      
      // Build the root folder
      const rootFolder = buildFolderTree(
        { name: result.folderName, files: result.files, subfolders: result.subfolders },
        rootFolderId,
        result.folderPath
      );
      
      const updatedProject = {
        ...project,
        folders: [...(project.folders || []), rootFolder],
      };
      
      onProjectUpdate(updatedProject);
      navigateToFolder(rootFolderId);
      setUploadProgress(`Opened "${result.folderName}" — ${result.totalPdfs} PDF(s)`);
      setTimeout(() => setUploadProgress(''), 3000);
      
    } catch (error) {
      console.error('Error opening source folder:', error);
      alert('Failed to open folder: ' + error.message);
      setUploadProgress('');
    }
  };

  // Refresh source folder — re-scan and update file list (recursive)
  const refreshSourceFolder = async (folderId) => {
    const folder = findFolderById(project.folders || [], folderId);
    if (!folder?.isSourceFolder || !folder.sourceFolderPath) return;
    
    setRefreshingFolders(prev => new Set([...prev, folderId]));
    
    try {
      const result = await listSourceFolder(folder.sourceFolderPath);
      
      // Rebuild the entire folder tree for this source folder
      const buildFolderTree = (backendFolder, parentId, sfPath) => {
        const id = parentId;
        
        const fileObjects = (backendFolder.files || []).map(f => ({
          id: `${id}_${f.name}`,
          name: f.name,
          backendFilename: f.name,
          sourceFolder: sfPath,
          size: f.size,
          lastModified: f.lastModified,
        }));
        
        const subfolders = (backendFolder.subfolders || []).map((sf, idx) => {
          const subId = `${id}_sub${idx}`;
          return buildFolderTree(sf, subId, sf.path);
        });
        
        return { files: fileObjects, subfolders };
      };
      
      const rebuilt = buildFolderTree(
        { files: result.files, subfolders: result.subfolders },
        folderId,
        result.folderPath
      );
      
      // Update the folder in the project tree
      const updateFolder = (folders) => folders.map(f => {
        if (f.id === folderId) return { ...f, files: rebuilt.files, subfolders: rebuilt.subfolders };
        if (f.subfolders?.length) return { ...f, subfolders: updateFolder(f.subfolders) };
        return f;
      });
      
      onProjectUpdate({
        ...project,
        folders: updateFolder(project.folders || []),
      });
      
      setUploadProgress(`Refreshed: ${result.totalPdfs} PDF(s)`);
      setTimeout(() => setUploadProgress(''), 2000);
      
    } catch (error) {
      console.error('Error refreshing source folder:', error);
      alert('Failed to refresh folder: ' + error.message);
    } finally {
      setRefreshingFolders(prev => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
    }
  };

  // Refresh linked folder contents
  const refreshLinkedFolder = async (folderId) => {
    const handle = linkedFolderHandles[folderId];
    if (!handle) {
      alert('Folder access lost. Please re-link the folder.');
      return;
    }

    setRefreshingFolders(prev => new Set([...prev, folderId]));

    try {
      // Check if we still have permission
      const permission = await handle.queryPermission({ mode: 'read' });
      if (permission !== 'granted') {
        // Request permission again
        const newPermission = await handle.requestPermission({ mode: 'read' });
        if (newPermission !== 'granted') {
          alert('Permission denied. Please re-link the folder.');
          setRefreshingFolders(prev => {
            const next = new Set(prev);
            next.delete(folderId);
            return next;
          });
          return;
        }
      }

      // Re-read files
      const files = await readPdfsFromDirectory(handle, folderId);
      setLinkedFolderFiles(prev => ({
        ...prev,
        [folderId]: files
      }));

      setUploadProgress(`Refreshed: ${files.length} PDF(s) found`);
      setTimeout(() => setUploadProgress(''), 2000);

    } catch (error) {
      console.error('Error refreshing folder:', error);
      alert('Failed to refresh folder. Try re-linking it.');
    } finally {
      setRefreshingFolders(prev => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
    }
  };

  // Unlink folder (remove from project but keep files on disk)
  const unlinkFolder = (folderId) => {
    if (!confirm('Unlink this folder? Files will remain on your computer.')) {
      return;
    }

    // Remove from handles and files
    setLinkedFolderHandles(prev => {
      const next = { ...prev };
      delete next[folderId];
      return next;
    });
    setLinkedFolderFiles(prev => {
      const next = { ...prev };
      delete next[folderId];
      return next;
    });

    // Remove from project
    const updatedFolders = (project.folders || []).filter(f => f.id !== folderId);
    const updatedProject = {
      ...project,
      folders: updatedFolders
    };
    onProjectUpdate(updatedProject);
    
    // Clear file selection if it was from this folder
    if (currentFile?.folderId === folderId) {
      onFileSelect(null);
    }
  };

  // ============ End Local Folder Functions ============

  // Navigate into a folder
  const navigateToFolder = (folderId) => {
    setCurrentFolderId(folderId);
    setSearchQuery(''); // Clear search when navigating
  };

  // Navigate to root
  const navigateToRoot = () => {
    setCurrentFolderId(null);
    setSearchQuery('');
  };

  // Get current folder and its contents
  const getCurrentFolderContents = () => {
    if (!currentFolderId) {
      // At root level - show root folders and project-level files
      return {
        folder: null,
        subfolders: project.folders || [],
        files: project.files || [],
        path: []
      };
    }
    
    const folder = findFolderById(project.folders || [], currentFolderId);
    if (!folder) {
      // Folder not found, go back to root
      setCurrentFolderId(null);
      return {
        folder: null,
        subfolders: project.folders || [],
        files: project.files || [],
        path: []
      };
    }
    
    // For linked folders, get files from linkedFolderFiles
    const files = folder.isLinked 
      ? (linkedFolderFiles[folder.id] || [])
      : (folder.files || []);
    
    return {
      folder,
      subfolders: folder.subfolders || [],
      files,
      path: getFolderPath(project.folders || [], currentFolderId) || []
    };
  };

  const createFolder = () => {
    if (!newFolderName.trim()) return;
    
    const newFolder = {
      id: `folder_${Date.now()}`,
      name: newFolderName.trim(),
      color: newFolderColor,
      files: [],
      subfolders: []
    };

    let updatedFolders;
    const parentId = newFolderParentId || currentFolderId;
    
    if (parentId) {
      // Creating a subfolder inside current folder
      const addSubfolder = (folders, targetParentId, subfolder) => {
        return folders.map(folder => {
          if (folder.id === targetParentId) {
            // Add and sort subfolders
            const newSubfolders = sortByName([...(folder.subfolders || []), subfolder]);
            return {
              ...folder,
              subfolders: newSubfolders
            };
          }
          if (folder.subfolders?.length > 0) {
            return {
              ...folder,
              subfolders: addSubfolder(folder.subfolders, targetParentId, subfolder)
            };
          }
          return folder;
        });
      };
      updatedFolders = addSubfolder(project.folders || [], parentId, newFolder);
    } else {
      // Creating a root-level folder - sort after adding
      updatedFolders = sortByName([...(project.folders || []), newFolder]);
    }

    const updatedProject = {
      ...project,
      folders: updatedFolders
    };
    onProjectUpdate(updatedProject);
    setShowNewFolderDialog(false);
    setNewFolderName('');
    setNewFolderColor('#3498db');
    setNewFolderParentId(null);
  };

  // Rename folder
  const renameFolder = (folderId, newName) => {
    if (!newName.trim()) return;
    
    const updateFolderName = (folders, targetId, name) => {
      return folders.map(folder => {
        if (folder.id === targetId) {
          return { ...folder, name: name };
        }
        if (folder.subfolders?.length > 0) {
          return {
            ...folder,
            subfolders: updateFolderName(folder.subfolders, targetId, name)
          };
        }
        return folder;
      });
    };
    
    const updatedFolders = updateFolderName(project.folders || [], folderId, newName.trim());
    const updatedProject = {
      ...project,
      folders: updatedFolders
    };
    onProjectUpdate(updatedProject);
  };

  // Change folder color
  const changeFolderColor = (folderId, color) => {
    const updateFolderColor = (folders, targetId, newColor) => {
      return folders.map(folder => {
        if (folder.id === targetId) {
          return { ...folder, color: newColor };
        }
        if (folder.subfolders?.length > 0) {
          return {
            ...folder,
            subfolders: updateFolderColor(folder.subfolders, targetId, newColor)
          };
        }
        return folder;
      });
    };
    
    const updatedFolders = updateFolderColor(project.folders || [], folderId, color);
    const updatedProject = {
      ...project,
      folders: updatedFolders
    };
    onProjectUpdate(updatedProject);
  };

  // Helper to delete folder from nested structure
  const deleteFolderFromStructure = (folders, folderId) => {
    return folders.filter(folder => {
      if (folder.id === folderId) return false;
      if (folder.subfolders?.length > 0) {
        folder.subfolders = deleteFolderFromStructure(folder.subfolders, folderId);
      }
      return true;
    });
  };

  // Helper to get all files in a folder and its subfolders
  const getAllFilesInFolder = (folder) => {
    let files = [...(folder.files || [])];
    if (folder.subfolders) {
      for (const subfolder of folder.subfolders) {
        files = [...files, ...getAllFilesInFolder(subfolder)];
      }
    }
    return files;
  };

  const deleteFolder = async (folderId) => {
    const folder = findFolderById(project.folders || [], folderId);
    if (!folder) return;

    const allFiles = getAllFilesInFolder(folder);
    const message = allFiles.length > 0 
      ? `Delete this folder and all ${allFiles.length} file(s) inside (including subfolders)?`
      : 'Delete this folder?';
    
    if (confirm(message)) {
      // Delete files from backend (only for uploaded files, not source folder files)
      for (const file of allFiles) {
        if (file.sourceFolder) continue; // Source folder files live on disk, don't delete
        try {
          await deletePdfFromBackend(file.backendFilename);
        } catch (error) {
          console.error('Error deleting file from backend:', error);
        }
      }
      
      // Also remove associated detected objects
      const fileNames = allFiles.map(f => f.backendFilename);
      const updatedObjects = (project.detectedObjects || []).filter(
        obj => !fileNames.includes(obj.filename)
      );

      const updatedFolders = deleteFolderFromStructure(project.folders || [], folderId);
      const updatedProject = {
        ...project,
        folders: updatedFolders,
        detectedObjects: updatedObjects
      };
      onProjectUpdate(updatedProject);
      
      if (currentFile && allFiles.some(f => f.id === currentFile.id)) {
        onFileSelect(null);
      }
    }
  };

  const startCreateSubfolder = (parentId, e) => {
    e.stopPropagation();
    setNewFolderParentId(parentId);
    setShowNewFolderDialog(true);
    setNewFolderName('');
    setNewFolderColor('#3498db');
  };

  // Drag and drop handlers
  const handleDragStart = (e, folder, parentId) => {
    e.stopPropagation();
    setDraggedFolder({ folder, parentId });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', folder.id);
    // Add drag image styling
    e.target.classList.add('dragging-active');
  };

  const handleDragEnd = (e) => {
    e.target.classList.remove('dragging-active');
    setDraggedFolder(null);
    setDragOverFolder(null);
    setDropPosition(null);
  };

  const handleDragOver = (e, folder, parentId) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedFolder || draggedFolder.folder.id === folder.id) {
      return;
    }
    
    // Don't allow dropping a folder into itself or its children
    if (isFolderDescendant(draggedFolder.folder, folder.id)) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    
    e.dataTransfer.dropEffect = 'move';
    
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;
    
    // Determine drop position based on mouse position
    let position;
    if (y < height * 0.3) {
      position = 'before';
    } else if (y > height * 0.7) {
      position = 'after';
    } else {
      position = 'inside'; // Drop as child
    }
    
    // Only update state if something changed
    if (dragOverFolder?.folder.id !== folder.id || dropPosition !== position) {
      setDragOverFolder({ folder, parentId });
      setDropPosition(position);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Only clear if we're actually leaving the element (not entering a child)
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverFolder(null);
      setDropPosition(null);
    }
  };

  const handleDrop = (e, targetFolder, targetParentId) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedFolder || !dropPosition) return;
    if (draggedFolder.folder.id === targetFolder.id) return;
    if (isFolderDescendant(draggedFolder.folder, targetFolder.id)) return;
    
    // Remove folder from its original location
    let updatedFolders = removeFolderFromTree(project.folders, draggedFolder.folder.id);
    
    // Add folder to new location based on drop position
    if (dropPosition === 'inside') {
      // Add as child of target folder - at the TOP (before files)
      updatedFolders = addFolderAsChild(updatedFolders, targetFolder.id, draggedFolder.folder);
      // Auto-expand the target folder
      setExpandedFolders(prev => new Set([...prev, targetFolder.id]));
    } else {
      // Add before or after target folder
      updatedFolders = addFolderAtPosition(updatedFolders, targetFolder.id, targetParentId, draggedFolder.folder, dropPosition);
    }
    
    const updatedProject = {
      ...project,
      folders: updatedFolders
    };
    onProjectUpdate(updatedProject);
    
    setDraggedFolder(null);
    setDragOverFolder(null);
    setDropPosition(null);
  };

  // Helper: Check if targetId is a descendant of folder
  const isFolderDescendant = (folder, targetId) => {
    if (!folder.subfolders) return false;
    for (const sub of folder.subfolders) {
      if (sub.id === targetId) return true;
      if (isFolderDescendant(sub, targetId)) return true;
    }
    return false;
  };

  // Helper: Remove folder from tree
  const removeFolderFromTree = (folders, folderId) => {
    return folders.filter(f => f.id !== folderId).map(f => ({
      ...f,
      subfolders: f.subfolders ? removeFolderFromTree(f.subfolders, folderId) : []
    }));
  };

  // Helper: Add folder as child of target - at the beginning of subfolders array
  const addFolderAsChild = (folders, targetId, folderToAdd) => {
    return folders.map(f => {
      if (f.id === targetId) {
        return {
          ...f,
          subfolders: [folderToAdd, ...(f.subfolders || [])] // Add at beginning
        };
      }
      return {
        ...f,
        subfolders: f.subfolders ? addFolderAsChild(f.subfolders, targetId, folderToAdd) : []
      };
    });
  };

  // Helper: Add folder before or after target
  const addFolderAtPosition = (folders, targetId, targetParentId, folderToAdd, position) => {
    // If target is at root level
    if (!targetParentId) {
      const targetIndex = folders.findIndex(f => f.id === targetId);
      if (targetIndex === -1) return folders;
      
      const newFolders = [...folders];
      const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
      newFolders.splice(insertIndex, 0, folderToAdd);
      return newFolders;
    }
    
    // Target is inside a parent folder
    return folders.map(f => {
      if (f.id === targetParentId) {
        const targetIndex = (f.subfolders || []).findIndex(sub => sub.id === targetId);
        if (targetIndex === -1) return f;
        
        const newSubfolders = [...(f.subfolders || [])];
        const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
        newSubfolders.splice(insertIndex, 0, folderToAdd);
        return { ...f, subfolders: newSubfolders };
      }
      return {
        ...f,
        subfolders: f.subfolders ? addFolderAtPosition(f.subfolders, targetId, targetParentId, folderToAdd, position) : []
      };
    });
  };

  // ============ File Drag and Drop Functions ============
  
  // Start dragging a file (or multiple selected files)
  const handleFileDragStart = (e, file, sourceFolderId) => {
    e.stopPropagation();
    
    // If this file is part of a multi-selection, drag all selected files
    if (selectedFiles.has(file.id) && selectedFiles.size > 1) {
      // Gather all selected files with their source folders
      const filesToMove = [];
      
      // Check root level files
      for (const f of (project.files || [])) {
        if (selectedFiles.has(f.id)) {
          filesToMove.push({ file: f, sourceFolderId: null });
        }
      }
      
      // Check folder files recursively
      const gatherSelectedFromFolders = (folders) => {
        for (const folder of folders) {
          for (const f of (folder.files || [])) {
            if (selectedFiles.has(f.id)) {
              filesToMove.push({ file: f, sourceFolderId: folder.id });
            }
          }
          if (folder.subfolders?.length > 0) {
            gatherSelectedFromFolders(folder.subfolders);
          }
        }
      };
      gatherSelectedFromFolders(project.folders || []);
      
      setDraggedFile({ files: filesToMove, isMultiple: true });
    } else {
      setDraggedFile({ file, sourceFolderId, isMultiple: false });
    }
    
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `file:${file.id}`);
    e.target.classList.add('dragging-active');
  };

  // End file drag
  const handleFileDragEnd = (e) => {
    e.target.classList.remove('dragging-active');
    setDraggedFile(null);
    setDragOverTargetFolder(null);
  };

  // Handle folder receiving a dragged file
  const handleFolderDragOverForFile = (e, folder) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedFile) return;
    
    // Don't allow dropping on linked folders
    if (folder.isLinked) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    
    // Don't allow dropping on the same folder
    if (draggedFile.sourceFolderId === folder.id) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    
    e.dataTransfer.dropEffect = 'move';
    setDragOverTargetFolder(folder.id);
  };

  // Handle file drop on folder
  const handleFileDropOnFolder = (e, targetFolder) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedFile || targetFolder.isLinked || targetFolder.isSourceFolder) return;
    
    // Helper to remove file from a folder
    const removeFileFromFolder = (folders, folderId, fileId) => {
      return folders.map(folder => {
        if (folder.id === folderId) {
          return {
            ...folder,
            files: (folder.files || []).filter(f => f.id !== fileId)
          };
        }
        if (folder.subfolders?.length > 0) {
          return {
            ...folder,
            subfolders: removeFileFromFolder(folder.subfolders, folderId, fileId)
          };
        }
        return folder;
      });
    };
    
    // Helper to add file to a folder
    const addFileToFolder = (folders, folderId, fileToAdd) => {
      return folders.map(folder => {
        if (folder.id === folderId) {
          return {
            ...folder,
            files: sortByName([...(folder.files || []), fileToAdd])
          };
        }
        if (folder.subfolders?.length > 0) {
          return {
            ...folder,
            subfolders: addFileToFolder(folder.subfolders, folderId, fileToAdd)
          };
        }
        return folder;
      });
    };
    
    let updatedFolders = project.folders || [];
    let updatedProjectFiles = project.files || [];
    
    if (draggedFile.isMultiple) {
      // Move multiple files
      for (const { file, sourceFolderId } of draggedFile.files) {
        // Skip if file is already in target folder
        if (sourceFolderId === targetFolder.id) continue;
        // Skip local files
        if (file.isLocal) continue;
        // Skip source folder files (they belong to the source path)
        if (file.sourceFolder) continue;
        
        // Remove from source
        if (sourceFolderId === null) {
          updatedProjectFiles = updatedProjectFiles.filter(f => f.id !== file.id);
        } else {
          updatedFolders = removeFileFromFolder(updatedFolders, sourceFolderId, file.id);
        }
        
        // Add to target
        const movedFile = { ...file, folderId: targetFolder.id };
        updatedFolders = addFileToFolder(updatedFolders, targetFolder.id, movedFile);
      }
    } else {
      // Single file
      if (draggedFile.sourceFolderId === targetFolder.id) return;
      
      const { file, sourceFolderId } = draggedFile;
      
      // Remove from source
      if (sourceFolderId === null) {
        updatedProjectFiles = updatedProjectFiles.filter(f => f.id !== file.id);
      } else {
        updatedFolders = removeFileFromFolder(updatedFolders, sourceFolderId, file.id);
      }
      
      // Add to target
      const movedFile = { ...file, folderId: targetFolder.id };
      updatedFolders = addFileToFolder(updatedFolders, targetFolder.id, movedFile);
    }
    
    const updatedProject = {
      ...project,
      folders: updatedFolders,
      files: updatedProjectFiles
    };
    onProjectUpdate(updatedProject);
    
    // Clear selection after moving
    clearSelection();
    setDraggedFile(null);
    setDragOverTargetFolder(null);
  };

  // Handle dropping file on root (breadcrumb home)
  const handleFileDropOnRoot = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedFile) return;
    
    // Helper to remove file from a folder
    const removeFileFromFolder = (folders, folderId, fileId) => {
      return folders.map(folder => {
        if (folder.id === folderId) {
          return {
            ...folder,
            files: (folder.files || []).filter(f => f.id !== fileId)
          };
        }
        if (folder.subfolders?.length > 0) {
          return {
            ...folder,
            subfolders: removeFileFromFolder(folder.subfolders, folderId, fileId)
          };
        }
        return folder;
      });
    };
    
    let updatedFolders = project.folders || [];
    let updatedProjectFiles = [...(project.files || [])];
    
    if (draggedFile.isMultiple) {
      // Move multiple files to root
      for (const { file, sourceFolderId } of draggedFile.files) {
        // Skip if already at root
        if (sourceFolderId === null) continue;
        // Skip local files
        if (file.isLocal) continue;
        
        // Skip source folder files
        if (file.sourceFolder) continue;
        // Remove from source folder
        updatedFolders = removeFileFromFolder(updatedFolders, sourceFolderId, file.id);
        
        // Add to root
        const movedFile = { ...file, folderId: null };
        updatedProjectFiles.push(movedFile);
      }
    } else {
      // Single file
      if (draggedFile.sourceFolderId === null) return; // Already at root
      
      const { file, sourceFolderId } = draggedFile;
      
      // Remove from source folder
      updatedFolders = removeFileFromFolder(updatedFolders, sourceFolderId, file.id);
      
      // Add to root
      const movedFile = { ...file, folderId: null };
      updatedProjectFiles.push(movedFile);
    }
    
    const updatedProject = {
      ...project,
      folders: updatedFolders,
      files: sortByName(updatedProjectFiles)
    };
    onProjectUpdate(updatedProject);
    
    // Clear selection after moving
    clearSelection();
    setDraggedFile(null);
    setDragOverTargetFolder(null);
  };

  const handleFileUpload = async (folderId, e) => {
    const files = Array.from(e.target.files);
    const pdfFiles = files.filter(f => f.type === 'application/pdf');

    if (pdfFiles.length === 0) {
      alert('Please select PDF files only');
      return;
    }

    setIsUploading(true);
    const newFiles = [];

    try {
      for (let i = 0; i < pdfFiles.length; i++) {
        const file = pdfFiles[i];
        setUploadProgress(`Uploading ${i + 1}/${pdfFiles.length}: ${file.name}`);

        // Upload to backend
        const result = await uploadPdfToBackend(file);

        // Add file metadata (store backend filename)
        newFiles.push({
          id: `file_${Date.now()}_${i}`,
          name: file.name,
          backendFilename: result.filename, // The actual filename on backend
          folderId: folderId,
          uploadedAt: new Date().toISOString()
        });
      }

      // Helper function to add files to folder in nested structure
      const addFilesToFolder = (folders, targetFolderId, files) => {
        return folders.map(folder => {
          if (folder.id === targetFolderId) {
            // Add files and sort by name
            const allFiles = sortByName([...(folder.files || []), ...files]);
            return {
              ...folder,
              files: allFiles
            };
          }
          if (folder.subfolders?.length > 0) {
            return {
              ...folder,
              subfolders: addFilesToFolder(folder.subfolders, targetFolderId, files)
            };
          }
          return folder;
        });
      };

      const updatedFolders = addFilesToFolder(project.folders || [], folderId, newFiles);

      const updatedProject = {
        ...project,
        folders: updatedFolders
      };

      onProjectUpdate(updatedProject);
      setUploadProgress(`Uploaded ${pdfFiles.length} file(s) successfully!`);
      
      setTimeout(() => setUploadProgress(''), 3000);
      
    } catch (error) {
      console.error('Error uploading files:', error);
      alert('Failed to upload some files: ' + error.message);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  // Handle file upload from header button - files go to current folder or project level
  const handleFilesUpload = async (e) => {
    // If we're inside a folder, upload to that folder
    if (currentFolderId) {
      return handleFileUpload(currentFolderId, e);
    }
    
    // Otherwise upload to project root
    const files = Array.from(e.target.files);
    const pdfFiles = files.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));

    if (pdfFiles.length === 0) {
      alert('Please select PDF files only');
      e.target.value = '';
      return;
    }

    setIsUploading(true);
    const newFiles = [];

    try {
      for (let i = 0; i < pdfFiles.length; i++) {
        const file = pdfFiles[i];
        setUploadProgress(`Uploading ${i + 1}/${pdfFiles.length}: ${file.name}`);

        const result = await uploadPdfToBackend(file);

        newFiles.push({
          id: `file_${Date.now()}_${i}`,
          name: file.name,
          backendFilename: result.filename,
          folderId: null, // No folder - project level
          uploadedAt: new Date().toISOString()
        });
      }

      const updatedProject = {
        ...project,
        files: sortByName([...(project.files || []), ...newFiles])
      };

      onProjectUpdate(updatedProject);
      setUploadProgress(`Uploaded ${pdfFiles.length} file(s) successfully!`);
      
      setTimeout(() => setUploadProgress(''), 3000);
      
    } catch (error) {
      console.error('Error uploading files:', error);
      alert('Failed to upload some files: ' + error.message);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  // Handle folder upload from header button - creates a new folder with the uploaded folder's name
  const handleFolderUpload = async (e) => {
    const files = Array.from(e.target.files);
    const pdfFiles = files.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));

    if (pdfFiles.length === 0) {
      alert('No PDF files found in the selected folder');
      e.target.value = '';
      return;
    }

    // Get folder name from the first file's path
    const firstFile = files[0];
    const pathParts = firstFile.webkitRelativePath.split('/');
    const folderName = pathParts.length > 1 ? pathParts[0] : 'Uploaded Folder';

    // Create new folder
    const newFolderId = `folder_${Date.now()}`;
    const newFolder = {
      id: newFolderId,
      name: folderName,
      files: [],
      subfolders: []
    };

    setIsUploading(true);
    const newFiles = [];

    try {
      for (let i = 0; i < pdfFiles.length; i++) {
        const file = pdfFiles[i];
        setUploadProgress(`Uploading ${i + 1}/${pdfFiles.length}: ${file.name}`);

        const result = await uploadPdfToBackend(file);

        newFiles.push({
          id: `file_${Date.now()}_${i}`,
          name: file.name,
          backendFilename: result.filename,
          folderId: newFolderId,
          uploadedAt: new Date().toISOString()
        });
      }

      // Add files to the new folder (sorted)
      newFolder.files = sortByName(newFiles);

      let updatedProject;
      
      if (currentFolderId) {
        // Add as subfolder to current folder (sorted)
        const addSubfolderToFolder = (folders, targetFolderId, subfolder) => {
          return folders.map(folder => {
            if (folder.id === targetFolderId) {
              return {
                ...folder,
                subfolders: sortByName([...(folder.subfolders || []), subfolder])
              };
            }
            if (folder.subfolders?.length > 0) {
              return {
                ...folder,
                subfolders: addSubfolderToFolder(folder.subfolders, targetFolderId, subfolder)
              };
            }
            return folder;
          });
        };
        
        updatedProject = {
          ...project,
          folders: addSubfolderToFolder(project.folders || [], currentFolderId, newFolder)
        };
      } else {
        // Add to root level (sorted)
        updatedProject = {
          ...project,
          folders: sortByName([...(project.folders || []), newFolder])
        };
      }

      onProjectUpdate(updatedProject);
      navigateToFolder(newFolderId); // Navigate into the new folder
      setUploadProgress(`Created folder "${folderName}" with ${pdfFiles.length} file(s)`);
      
      setTimeout(() => setUploadProgress(''), 3000);
      
    } catch (error) {
      console.error('Error uploading folder:', error);
      alert('Failed to upload folder: ' + error.message);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  // Delete file from folder
  const deleteFile = async (folderId, fileId, e) => {
    e.stopPropagation();

    const folder = findFolderById(project.folders || [], folderId);
    // Check both folder.files and linkedFolderFiles for the file
    const file = folder?.files?.find(f => f.id === fileId)
      || (linkedFolderFiles[folderId] || []).find(f => f.id === fileId);

    // Local files: simple remove from project, no backend file deletion
    if (file?.isLocal) {
      if (confirm('Remove this file?')) {
        // Remove from linkedFolderFiles if it's in a linked folder
        setLinkedFolderFiles(prev => ({
          ...prev,
          [folderId]: (prev[folderId] || []).filter(f => f.id !== fileId)
        }));
        // Also try removing from project folders in case it's in a regular folder
        const removeFileFromFolders = (folders, targetFolderId, targetFileId) => {
          return folders.map(f => {
            if (f.id === targetFolderId) {
              return { ...f, files: (f.files || []).filter(fi => fi.id !== targetFileId) };
            }
            if (f.subfolders?.length > 0) {
              return { ...f, subfolders: removeFileFromFolders(f.subfolders, targetFolderId, targetFileId) };
            }
            return f;
          });
        };
        const updatedFolders = removeFileFromFolders(project.folders || [], folderId, fileId);
        onProjectUpdate({ ...project, folders: updatedFolders });
        if (currentFile && currentFile.id === fileId) {
          onFileSelect(null);
        }
      }
      return;
    }

    // Load current objects from backend
    let currentObjects = [];
    try {
      currentObjects = await getObjectsFromBackend(project.id);
    } catch (err) {
      console.error('Error loading objects:', err);
    }

    // Count objects that will be orphaned
    const objectCount = currentObjects.filter(
      obj => obj.filename === file?.backendFilename
    ).length;

    const message = objectCount > 0
      ? `Delete this file?\n\n${objectCount} object(s) will be orphaned (not deleted). You can reassign them to another file later from the Classes page.`
      : 'Delete this file?';

    if (confirm(message)) {
      try {
        // Delete from backend (skip source folder files)
        if (file?.backendFilename && !file?.sourceFolder) {
          await deletePdfFromBackend(file.backendFilename);
        }

        // Helper function to remove file from nested folders
        const removeFileFromFolders = (folders, targetFolderId, targetFileId) => {
          return folders.map(folder => {
            if (folder.id === targetFolderId) {
              return {
                ...folder,
                files: (folder.files || []).filter(f => f.id !== targetFileId)
              };
            }
            if (folder.subfolders?.length > 0) {
              return {
                ...folder,
                subfolders: removeFileFromFolders(folder.subfolders, targetFolderId, targetFileId)
              };
            }
            return folder;
          });
        };

        const updatedFolders = removeFileFromFolders(project.folders || [], folderId, fileId);

        // Orphan objects instead of deleting them
        const updatedObjects = currentObjects.map(obj => {
          if (obj.filename === file?.backendFilename) {
            return {
              ...obj,
              status: 'orphaned',
              originalFilename: obj.filename,
              filename: null
            };
          }
          return obj;
        });

        const updatedProject = {
          ...project,
          folders: updatedFolders
        };

        onProjectUpdate(updatedProject);

        // Save orphaned objects to backend
        try {
          await saveObjectsToBackend(project.id, updatedObjects);
        } catch (objError) {
          console.error('Error saving orphaned objects to backend:', objError);
        }

        if (currentFile && currentFile.id === fileId) {
          onFileSelect(null);
        }
      } catch (error) {
        console.error('Error deleting file:', error);
        alert('Failed to delete file');
      }
    }
  };

  // Delete project-level file (not in a folder)
  const deleteProjectFile = async (folderId, fileId, e) => {
    e.stopPropagation();

    const file = (project.files || []).find(f => f.id === fileId);

    // Local files: simple remove from project, no backend file deletion
    if (file?.isLocal) {
      if (confirm('Remove this file?')) {
        const updatedFiles = (project.files || []).filter(f => f.id !== fileId);
        onProjectUpdate({ ...project, files: updatedFiles });
        if (currentFile && currentFile.id === fileId) {
          onFileSelect(null);
        }
      }
      return;
    }

    // Load current objects from backend
    let currentObjects = [];
    try {
      currentObjects = await getObjectsFromBackend(project.id);
    } catch (err) {
      console.error('Error loading objects:', err);
    }

    // Count objects that will be orphaned
    const objectCount = currentObjects.filter(
      obj => obj.filename === file?.backendFilename
    ).length;

    const message = objectCount > 0
      ? `Delete this file?\n\n${objectCount} object(s) will be orphaned (not deleted). You can reassign them to another file later from the Classes page.`
      : 'Delete this file?';

    if (confirm(message)) {
      try {
        // Delete from backend (skip source folder files)
        if (file?.backendFilename && !file?.sourceFolder) {
          await deletePdfFromBackend(file.backendFilename);
        }

        const updatedFiles = (project.files || []).filter(f => f.id !== fileId);

        // Orphan objects instead of deleting them
        const updatedObjects = currentObjects.map(obj => {
          if (obj.filename === file?.backendFilename) {
            return {
              ...obj,
              status: 'orphaned',
              originalFilename: obj.filename,
              filename: null
            };
          }
          return obj;
        });

        const updatedProject = {
          ...project,
          files: updatedFiles
        };

        onProjectUpdate(updatedProject);

        // Save orphaned objects to backend
        try {
          await saveObjectsToBackend(project.id, updatedObjects);
        } catch (objError) {
          console.error('Error saving orphaned objects to backend:', objError);
        }

        if (currentFile && currentFile.id === fileId) {
          onFileSelect(null);
        }
      } catch (error) {
        console.error('Error deleting file:', error);
        alert('Failed to delete file');
      }
    }
  };

  // Move file from one folder to another (for breadcrumb drag/drop)
  const moveFileToFolder = (file, sourceFolderId, targetFolderId) => {
    if (!file || sourceFolderId === targetFolderId) return;
    
    // Don't move local files
    if (file.isLocal) {
      alert('Local files cannot be moved between folders.');
      return;
    }
    
    // Helper to remove file from source folder
    const removeFileFromFolder = (folders, folderId, fileId) => {
      return folders.map(folder => {
        if (folder.id === folderId) {
          return {
            ...folder,
            files: (folder.files || []).filter(f => f.id !== fileId)
          };
        }
        if (folder.subfolders?.length > 0) {
          return {
            ...folder,
            subfolders: removeFileFromFolder(folder.subfolders, folderId, fileId)
          };
        }
        return folder;
      });
    };
    
    // Helper to add file to target folder
    const addFileToFolder = (folders, folderId, file) => {
      return folders.map(folder => {
        if (folder.id === folderId) {
          return {
            ...folder,
            files: [...(folder.files || []), file]
          };
        }
        if (folder.subfolders?.length > 0) {
          return {
            ...folder,
            subfolders: addFileToFolder(folder.subfolders, folderId, file)
          };
        }
        return folder;
      });
    };
    
    let updatedFolders = [...(project.folders || [])];
    let updatedProjectFiles = [...(project.files || [])];
    
    // Remove from source
    if (sourceFolderId) {
      updatedFolders = removeFileFromFolder(updatedFolders, sourceFolderId, file.id);
    } else {
      // Source is root level
      updatedProjectFiles = updatedProjectFiles.filter(f => f.id !== file.id);
    }
    
    // Add to target
    if (targetFolderId) {
      updatedFolders = addFileToFolder(updatedFolders, targetFolderId, file);
    } else {
      // Target is root level
      updatedProjectFiles = [...updatedProjectFiles, file];
    }
    
    const updatedProject = {
      ...project,
      folders: updatedFolders,
      files: updatedProjectFiles
    };
    
    onProjectUpdate(updatedProject);
  };

  const selectFile = (file) => {
    console.log('Selecting file:', file.name, file.backendFilename);
    onFileSelect(file);
  };

  // Download file function
  const downloadFile = async (file, e) => {
    e?.stopPropagation();
    
    try {
      // Get the file from backend
      const response = await fetch(`${BACKEND_URL}/api/pdf/${encodeURIComponent(file.backendFilename)}`);
      if (!response.ok) throw new Error('Failed to fetch file');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading file:', error);
      alert('Failed to download file: ' + error.message);
    }
  };

  // Get recent colors from existing folders
  const recentColors = [...new Set(
    (project.folders || [])
      .map(f => f.color)
      .filter(Boolean)
  )].slice(0, 5);

  // Get current folder contents for drill-down navigation
  const currentContents = getCurrentFolderContents();
  const folderPath = currentContents.path;

  // Multi-select functions
  const [lastSelectedFolderId, setLastSelectedFolderId] = useState(null);
  const [lastSelectedFileId, setLastSelectedFileId] = useState(null);

  const handleFolderClick = (folder, e) => {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle selection
      const newSelected = new Set(selectedFolders);
      if (newSelected.has(folder.id)) {
        newSelected.delete(folder.id);
      } else {
        newSelected.add(folder.id);
      }
      setSelectedFolders(newSelected);
      setLastSelectedFolderId(folder.id);
      setIsMultiSelectMode(newSelected.size > 0 || selectedFiles.size > 0);
    } else if (e.shiftKey && lastSelectedFolderId) {
      // Shift+click: range selection
      const folderIds = currentContents.subfolders.map(f => f.id);
      const startIdx = folderIds.indexOf(lastSelectedFolderId);
      const endIdx = folderIds.indexOf(folder.id);
      if (startIdx !== -1 && endIdx !== -1) {
        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const rangeIds = folderIds.slice(from, to + 1);
        const newSelected = new Set([...selectedFolders, ...rangeIds]);
        setSelectedFolders(newSelected);
        setLastSelectedFolderId(folder.id);
        setIsMultiSelectMode(true);
      }
    } else {
      // Normal click: navigate into folder, clear selection
      clearSelection();
      navigateToFolder(folder.id);
    }
  };

  const handleFileClick = (file, e) => {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle selection
      const newSelected = new Set(selectedFiles);
      if (newSelected.has(file.id)) {
        newSelected.delete(file.id);
      } else {
        newSelected.add(file.id);
      }
      setSelectedFiles(newSelected);
      setLastSelectedFileId(file.id);
      setIsMultiSelectMode(selectedFolders.size > 0 || newSelected.size > 0);
    } else if (e.shiftKey && lastSelectedFileId) {
      // Shift+click: range selection
      const fileIds = currentContents.files.map(f => f.id);
      const startIdx = fileIds.indexOf(lastSelectedFileId);
      const endIdx = fileIds.indexOf(file.id);
      if (startIdx !== -1 && endIdx !== -1) {
        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const rangeIds = fileIds.slice(from, to + 1);
        const newSelected = new Set([...selectedFiles, ...rangeIds]);
        setSelectedFiles(newSelected);
        setLastSelectedFileId(file.id);
        setIsMultiSelectMode(true);
      }
    } else {
      // Normal click: open file, clear selection
      clearSelection();
      selectFile(file);
    }
  };

  const clearSelection = () => {
    setSelectedFolders(new Set());
    setSelectedFiles(new Set());
    setIsMultiSelectMode(false);
  };

  // Keyboard shortcuts for selection
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedFolders.size > 0 || selectedFiles.size > 0) {
          e.preventDefault();
          const totalCount = selectedFolders.size + selectedFiles.size;
          if (confirm(`Delete ${totalCount} selected item(s)?`)) {
            // Delete folders first
            for (const folderId of selectedFolders) {
              deleteFolder(folderId);
            }
            // Then delete files
            for (const fileId of selectedFiles) {
              if (currentFolderId) {
                deleteFile(currentFolderId, fileId, { stopPropagation: () => {} });
              } else {
                deleteProjectFile(null, fileId, { stopPropagation: () => {} });
              }
            }
            clearSelection();
          }
        }
      } else if (e.key === 'Escape') {
        clearSelection();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedFolders, selectedFiles, currentFolderId, deleteFolder, deleteFile, deleteProjectFile]);

  // Bulk actions
  const bulkDeleteFolders = async () => {
    if (selectedFolders.size === 0) return;
    if (!confirm(`Delete ${selectedFolders.size} folder(s) and all their contents?`)) return;
    
    for (const folderId of selectedFolders) {
      await deleteFolder(folderId);
    }
    clearSelection();
  };

  const bulkDeleteFiles = async () => {
    if (selectedFiles.size === 0) return;
    if (!confirm(`Delete ${selectedFiles.size} file(s)?`)) return;
    
    for (const fileId of selectedFiles) {
      if (currentFolderId) {
        await deleteFile(currentFolderId, fileId, { stopPropagation: () => {} });
      } else {
        await deleteProjectFile(null, fileId, { stopPropagation: () => {} });
      }
    }
    clearSelection();
  };

  const bulkChangeFolderColor = (color) => {
    for (const folderId of selectedFolders) {
      changeFolderColor(folderId, color);
    }
  };

  return (
    <>
      {/* Hover zone to expand when collapsed */}
      {isCollapsed && (
        <div 
          className="sidebar-expand-zone"
          onClick={() => setIsCollapsed(false)}
          title="Expand file sidebar"
        >
          <div className="sidebar-expand-tab">
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>
      )}
      {/* Collapse tab - positioned at sidebar edge, visible when open */}
      {!isCollapsed && (
        <div 
          className="sidebar-collapse-tab"
          onClick={() => setIsCollapsed(true)}
          title="Collapse sidebar"
          style={{ left: sidebarWidth }}
        >
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      )}
      <div 
        className={`file-sidebar ${isResizing ? 'resizing' : ''} ${isCollapsed ? 'collapsed' : ''}`}
        ref={sidebarRef}
        style={{ width: isCollapsed ? 0 : sidebarWidth }}
    >
      {/* Dark header bar - Row 1: Buttons on left */}
      <div className="sidebar-header-dark">
        <div className="toolbar-left">
          <input
            type="file"
            id="sidebar-upload-input"
            multiple
            accept=".pdf"
            onChange={handleFilesUpload}
            style={{ display: 'none' }}
            disabled={isUploading}
          />
          <input
            type="file"
            id="sidebar-folder-upload-input"
            webkitdirectory=""
            directory=""
            multiple
            accept=".pdf"
            onChange={handleFolderUpload}
            style={{ display: 'none' }}
            disabled={isUploading}
          />
          <button
            className="sidebar-header-btn"
            onClick={() => setShowNewFolderDialog(true)}
            title="New folder (coming soon)"
            disabled
            style={{ opacity: 0.4, cursor: 'not-allowed' }}
          >
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Folder
          </button>
          <div className="upload-dropdown-container" ref={openMenuRef}>
            <button
              className={`sidebar-header-btn${showOpenMenu ? ' active' : ''}`}
              onClick={() => setShowOpenMenu(!showOpenMenu)}
              title="Open files or folder from disk"
            >
              <svg viewBox="0 0 16 16" fill="none">
                <path d="M2 4C2 3.44772 2.44772 3 3 3H6.5L8 5H13C13.5523 5 14 5.44772 14 6V12C14 12.5523 13.5523 13 13 13H3C2.44772 13 2 12.5523 2 12V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Open
            </button>
            {showOpenMenu && (
              <div className="upload-dropdown-menu">
                <button onClick={() => {
                  setShowOpenMenu(false);
                  handleOpenLocalFiles();
                }}>
                  Open Files
                </button>
                <button onClick={() => {
                  setShowOpenMenu(false);
                  handleOpenSourceFolder();
                }}>
                  Open Folder
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Folder path breadcrumb - file location */}
      <div className="sidebar-breadcrumb-row">
        <div className="folder-breadcrumb">
          <span 
            className={`breadcrumb-item ${!currentFolderId ? 'active' : ''} ${draggedFile && dragOverTargetFolder === 'root' ? 'drop-target' : ''}`}
            onClick={navigateToRoot}
            title={draggedFile ? (draggedFile.isMultiple ? `Move ${draggedFile.files.length} files to Root` : "Move to Root") : "Root"}
            onDragOver={(e) => {
              if (draggedFile && draggedFile.sourceFolderId !== null) {
                e.preventDefault();
                setDragOverTargetFolder('root');
              }
            }}
            onDragLeave={() => setDragOverTargetFolder(null)}
            onDrop={handleFileDropOnRoot}
          >
            <svg className="breadcrumb-home" viewBox="0 0 16 16" fill="none">
              <path d="M2 8L8 2L14 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4 7V13H12V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
          {folderPath.length > 3 ? (
            <>
              {/* Show ellipsis for collapsed folders */}
              <span className="breadcrumb-item">
                <span className="breadcrumb-arrow">›</span>
                <span className="breadcrumb-ellipsis" title="Click to go back">…</span>
              </span>
              {/* Show last 2 folders */}
              {folderPath.slice(-2).map((folder, idx) => (
                <span key={folder.id} className="breadcrumb-item">
                  <span className="breadcrumb-arrow">›</span>
                  <span 
                    className={`breadcrumb-folder ${idx === 1 ? 'active' : ''} ${draggedFile && dragOverTargetFolder === folder.id ? 'drop-target' : ''}`}
                    onClick={() => navigateToFolder(folder.id)}
                    title={draggedFile ? (draggedFile.isMultiple ? `Move ${draggedFile.files.length} files to ${folder.name}` : `Move to ${folder.name}`) : folder.name}
                    onDragOver={(e) => {
                      if (draggedFile && (!draggedFile.isMultiple ? draggedFile.sourceFolderId !== folder.id : true)) {
                        e.preventDefault();
                        setDragOverTargetFolder(folder.id);
                      }
                    }}
                    onDragLeave={() => setDragOverTargetFolder(null)}
                    onDrop={(e) => handleFileDropOnFolder(e, folder)}
                  >
                    {folder.name.length > 12 ? folder.name.substring(0, 12) + '…' : folder.name}
                  </span>
                </span>
              ))}
            </>
          ) : (
            folderPath.map((folder, idx) => (
              <span key={folder.id} className="breadcrumb-item">
                <span className="breadcrumb-arrow">›</span>
                <span 
                  className={`breadcrumb-folder ${idx === folderPath.length - 1 ? 'active' : ''} ${draggedFile && dragOverTargetFolder === folder.id ? 'drop-target' : ''}`}
                  onClick={() => navigateToFolder(folder.id)}
                  title={draggedFile ? (draggedFile.isMultiple ? `Move ${draggedFile.files.length} files to ${folder.name}` : `Move to ${folder.name}`) : folder.name}
                  onDragOver={(e) => {
                    if (draggedFile && (!draggedFile.isMultiple ? draggedFile.sourceFolderId !== folder.id : true)) {
                      e.preventDefault();
                      setDragOverTargetFolder(folder.id);
                    }
                  }}
                  onDragLeave={() => setDragOverTargetFolder(null)}
                  onDrop={(e) => handleFileDropOnFolder(e, folder)}
                >
                  {folder.name.length > 12 ? folder.name.substring(0, 12) + '…' : folder.name}
                </span>
              </span>
            ))
          )}
        </div>
      </div>

      {/* Row 3: Search bar */}
      <div className="sidebar-search-row">
        <div className="sidebar-search">
          <svg className="search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4" stroke="#888" strokeWidth="1.5"/>
            <path d="M10 10L13 13" stroke="#888" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="clear-search" onClick={() => setSearchQuery('')}>×</button>
          )}
        </div>
      </div>

      {/* New Folder Dialog */}
      {showNewFolderDialog && (
        <div className="new-folder-dialog-overlay">
          <div className="new-folder-dialog new-folder-dialog-compact" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>{newFolderParentId ? 'New Subfolder' : 'New Folder'}</h3>
              <button 
                className="dialog-close-btn"
                onClick={() => { setShowNewFolderDialog(false); setNewFolderName(''); setNewFolderColor('#3498db'); setNewFolderParentId(null); }}
              >
                ×
              </button>
            </div>
            
            {newFolderParentId && (
              <div className="dialog-subfolder-note">
                Creating inside: {findFolderById(project.folders || [], newFolderParentId)?.name}
              </div>
            )}
            
            <div className="dialog-body">
              <div className="dialog-row">
                <label>Name</label>
                <input
                  type="text"
                  placeholder="Folder name..."
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && newFolderName.trim() && createFolder()}
                  autoFocus
                />
              </div>
              
              <div className="dialog-row">
                <label>Colour</label>
                <input
                  type="color"
                  value={newFolderColor}
                  onChange={(e) => setNewFolderColor(e.target.value)}
                  className="color-input-full"
                />
              </div>
            </div>
            
            <div className="dialog-footer">
              <button 
                className="dialog-btn cancel"
                onClick={() => { setShowNewFolderDialog(false); setNewFolderName(''); setNewFolderColor('#3498db'); setNewFolderParentId(null); }}
              >
                Cancel
              </button>
              <button 
                className="dialog-btn create"
                onClick={createFolder}
                disabled={!newFolderName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {uploadProgress && (
        <div className="upload-progress">
          {uploadProgress}
        </div>
      )}

      <div className="folder-list">
        {/* Filter contents based on search - searches all nested items */}
        {(() => {
          let filteredSubfolders, filteredFiles;
          
          if (searchQuery) {
            // When searching, search ALL nested items from current folder
            const allNestedFolders = getAllNestedFolders(currentContents.subfolders);
            const allNestedFiles = [
              ...currentContents.files.map(f => ({ ...f, folderName: null })),
              ...getAllNestedFiles(currentContents.subfolders, linkedFolderFiles)
            ];
            
            filteredSubfolders = sortByName(allNestedFolders.filter(
              folder => folder.name.toLowerCase().includes(searchQuery.toLowerCase())
            ));
            filteredFiles = sortByName(allNestedFiles.filter(
              file => file.name.toLowerCase().includes(searchQuery.toLowerCase())
            ));
          } else {
            // No search - just show current folder contents (sorted)
            filteredSubfolders = sortByName(currentContents.subfolders);
            filteredFiles = sortByName(currentContents.files);
          }
          
          if (filteredSubfolders.length === 0 && filteredFiles.length === 0) {
            return (
              <div className="empty-state-sidebar">
                {searchQuery ? (
                  <>
                    <p>No matches found</p>
                    <small>Try a different search term</small>
                  </>
                ) : (
                  <>
                    <p>{currentFolderId ? 'This folder is empty' : 'No files yet'}</p>
                    <small>Upload PDFs or create a folder to get started</small>
                  </>
                )}
              </div>
            );
          }
          
          return (
            <>
              {/* Subfolders - click to navigate, ctrl+click to select */}
              {filteredSubfolders.map(folder => (
                <FolderRow
                  key={folder.id}
                  folder={folder}
                  isSelected={selectedFolders.has(folder.id)}
                  onClick={(e) => handleFolderClick(folder, e)}
                  onDelete={deleteFolder}
                  onRename={renameFolder}
                  onChangeColor={changeFolderColor}
                  linkedFolderFiles={linkedFolderFiles}
                  refreshLinkedFolder={refreshLinkedFolder}
                  refreshSourceFolder={refreshSourceFolder}
                  unlinkFolder={unlinkFolder}
                  isRefreshing={refreshingFolders.has(folder.id)}
                  recentColors={recentColors}
                  selectedFolders={selectedFolders}
                  onBulkDelete={bulkDeleteFolders}
                  onBulkChangeColor={bulkChangeFolderColor}
                  onFileDragOver={handleFolderDragOverForFile}
                  onFileDrop={handleFileDropOnFolder}
                  isDragOverForFile={dragOverTargetFolder === folder.id}
                  draggedFile={draggedFile}
                />
              ))}
              
              {/* Files in current folder */}
              {filteredFiles.map(file => (
                <FileItem
                  key={file.id}
                  file={file}
                  folderId={file.folderIdRef || currentFolderId}
                  currentFile={currentFile}
                  onClick={(e) => handleFileClick(file, e)}
                  deleteFile={currentFolderId ? deleteFile : deleteProjectFile}
                  downloadFile={downloadFile}
                  isLocal={file.isLocal}
                  unsavedFiles={unsavedFiles}
                  unlockedFiles={unlockedFiles}
                  onSaveFile={onSaveFile}
                  onDownloadWithAnnotations={onDownloadWithAnnotations}
                  isSaving={isSaving}
                  isMultiSelected={selectedFiles.has(file.id)}
                  selectedFiles={selectedFiles}
                  onBulkDelete={bulkDeleteFiles}
                  searchQuery={searchQuery}
                  onShowInFolder={file.folderIdRef ? () => navigateToFolder(file.folderIdRef) : null}
                  onDragStart={handleFileDragStart}
                  onDragEnd={handleFileDragEnd}
                />
              ))}
            </>
          );
        })()}
      </div>
      
      {/* Resize handle */}
      <div 
        className="sidebar-resize-handle"
        onMouseDown={handleResizeStart}
      />
    </div>
    </>
  );
}

// Folder item component with drag and drop support
function FolderItem({ 
  folder, 
  parentId,
  depth,
  searchQuery, 
  expandedFolders, 
  toggleFolder, 
  deleteFolder, 
  handleFileUpload,
  deleteFile,
  downloadFile,
  selectFile,
  currentFile,
  isUploading,
  startCreateSubfolder,
  renameFolder,
  changeFolderColor,
  recentColors,
  // Drag and drop props
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  draggedFolder,
  dragOverFolder,
  dropPosition,
  // Linked folder props
  linkedFolderFiles,
  refreshLinkedFolder,
  refreshSourceFolder,
  unlinkFolder,
  refreshingFolders,
  // Unsaved files tracking
  unsavedFiles = new Set(),
  // Save/download handlers
  onSaveFile,
  onDownloadWithAnnotations,
  isSaving = false
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const menuRef = useRef(null);
  const fileInputRef = useRef(null);
  
  const isExpanded = expandedFolders.has(folder.id);
  const isLinkedFolder = folder.isLinked;
  const isSourceFolder = folder.isSourceFolder;
  const isExternalFolder = isLinkedFolder || isSourceFolder;
  const isRefreshing = refreshingFolders?.has(folder.id);
  
  // Get files for this folder (either linked, source, or regular)
  const folderFiles = isLinkedFolder 
    ? (linkedFolderFiles?.[folder.id] || [])
    : (folder.files || []);
  
  const filteredFiles = searchQuery 
    ? folderFiles.filter(file => file.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : folderFiles;
    
  // Check if this folder or its subfolders contain the search query
  const hasSearchMatch = searchQuery && (
    folder.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    filteredFiles.length > 0 ||
    folder.subfolders?.some(sf => 
      sf.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (sf.files || []).some(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    )
  );
  
  // Auto-expand folders that match search
  useEffect(() => {
    if (searchQuery && hasSearchMatch && !expandedFolders.has(folder.id)) {
      toggleFolder(folder.id);
    }
  }, [searchQuery, hasSearchMatch]);
  
  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
        setShowColorPicker(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);
  
  const handleMenuClick = (e) => {
    e.stopPropagation();
    setShowMenu(!showMenu);
    setShowColorPicker(false);
  };
  
  const handleAddFiles = (e) => {
    e.stopPropagation();
    setShowMenu(false);
    fileInputRef.current?.click();
  };
  
  const handleDelete = (e) => {
    e.stopPropagation();
    setShowMenu(false);
    if (isLinkedFolder) {
      unlinkFolder(folder.id);
    } else if (isSourceFolder) {
      if (confirm(`Remove "${folder.name}" from project? Files on disk will not be affected.`)) {
        deleteFolder(folder.id);
      }
    } else {
      deleteFolder(folder.id);
    }
  };
  
  const handleStartRename = (e) => {
    e.stopPropagation();
    setShowMenu(false);
    setIsRenaming(true);
    setRenameValue(folder.name);
  };
  
  const handleRenameSubmit = (e) => {
    e?.preventDefault();
    if (renameValue.trim() && renameValue !== folder.name) {
      renameFolder(folder.id, renameValue);
    }
    setIsRenaming(false);
  };
  
  const handleRenameKeyDown = (e) => {
    if (e.key === 'Escape') {
      setIsRenaming(false);
      setRenameValue(folder.name);
    }
  };

  // Drag and drop
  const isDragging = draggedFolder?.folder.id === folder.id;
  const isDragOver = dragOverFolder?.folder.id === folder.id;

  return (
    <div 
      className={`folder-item ${isDragging ? 'dragging' : ''}`}
      style={{ marginLeft: depth * 12 }}
    >
      {/* Drop indicator for 'before' position */}
      {isDragOver && dropPosition === 'before' && (
        <div className="drop-indicator drop-before" />
      )}
      
      <div 
        className={`folder-header ${isExternalFolder ? 'linked-folder' : ''} ${isDragOver && dropPosition === 'inside' ? 'drop-inside' : ''}`}
        onClick={() => toggleFolder(folder.id)}
        draggable={!isExternalFolder}
        onDragStart={(e) => onDragStart(e, folder, parentId)}
        onDragEnd={onDragEnd}
        onDragOver={(e) => onDragOver(e, folder, parentId)}
        onDragLeave={onDragLeave}
        onDrop={(e) => onDrop(e, folder, parentId)}
      >
        {!isExternalFolder && (
          <span 
            className="drag-handle"
            onMouseDown={(e) => e.stopPropagation()}
          >
            ⋮⋮
          </span>
        )}
        <span className="folder-icon">
          <span style={{ fontSize: '10px' }}>{isExpanded ? '▼' : '▶'}</span>
          <span className="folder-icon-svg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill={folder.color || '#3498db'} stroke="none">
              <path d="M3 6c0-1.1.9-2 2-2h5l2 2h9c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V6z"/>
            </svg>
          </span>
          {isLinkedFolder && <span className="linked-badge">🔗</span>}
          {isSourceFolder && <span className="linked-badge" title={folder.sourceFolderPath}>📂</span>}
        </span>
        {isRenaming ? (
          <input
            type="text"
            className="folder-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={handleRenameKeyDown}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span className="folder-name">{folder.name}</span>
        )}
        
        {/* Refresh button for linked/source folders */}
        {isExternalFolder && (
          <button
            className="folder-refresh-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (isSourceFolder) {
                refreshSourceFolder(folder.id);
              } else {
                refreshLinkedFolder(folder.id);
              }
            }}
            disabled={isRefreshing}
            title="Refresh folder contents"
          >
            <svg viewBox="0 0 16 16" fill="none" style={{ width: 14, height: 14 }}>
              <path d="M13.5 8a5.5 5.5 0 11-1.5-3.78" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M12 1v3.5h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        
        <div className="folder-menu-container" ref={menuRef}>
          <button 
            className="folder-menu-btn"
            onClick={handleMenuClick}
            title="Folder options"
          >
            ⋮
          </button>
          {showMenu && (
            <div className="folder-menu-dropdown">
              {isExternalFolder ? (
                <>
                  <button onClick={(e) => {
                    e.stopPropagation();
                    if (isSourceFolder) {
                      refreshSourceFolder(folder.id);
                    } else {
                      refreshLinkedFolder(folder.id);
                    }
                    setShowMenu(false);
                  }}>
                    Refresh
                  </button>
                  <div className="dropdown-divider" />
                  <button onClick={handleDelete} className="delete-option">
                    {isSourceFolder ? 'Remove Folder' : 'Unlink Folder'}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={handleAddFiles}>
                    Add Files
                  </button>
                  <button onClick={(e) => startCreateSubfolder(folder.id, e)}>
                    New Subfolder
                  </button>
                  <button onClick={handleStartRename}>
                    Rename
                  </button>
                  {/* Color picker section */}
                  {!showColorPicker ? (
                    <button onClick={(e) => {
                      e.stopPropagation();
                      setShowColorPicker(true);
                    }}>
                      Change Color
                    </button>
                  ) : (
                    <div className="color-picker-popup" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="color"
                        className="color-input-large"
                        value={folder.color || '#3498db'}
                        onChange={(e) => {
                          changeFolderColor(folder.id, e.target.value);
                        }}
                      />
                      {recentColors.length > 0 && (
                        <>
                          <div className="recent-label">Recent colors</div>
                          <div className="recent-colors">
                            {recentColors.map(color => (
                              <button
                                key={color}
                                className="recent-color"
                                style={{ backgroundColor: color }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  changeFolderColor(folder.id, color);
                                }}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  <button onClick={handleDelete} className="delete-option">
                    Delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {/* Hidden file input for adding files */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf"
          onChange={(e) => handleFileUpload(folder.id, e)}
          style={{ display: 'none' }}
          disabled={isUploading}
        />
      </div>

      {isExpanded && (
        <div className="folder-content">
          {/* Render subfolders FIRST (above files) */}
          {folder.subfolders?.map(subfolder => (
            <FolderItem 
              key={subfolder.id}
              folder={subfolder}
              parentId={folder.id}
              depth={depth + 1}
              searchQuery={searchQuery}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              deleteFolder={deleteFolder}
              handleFileUpload={handleFileUpload}
              deleteFile={deleteFile}
              downloadFile={downloadFile}
              selectFile={selectFile}
              currentFile={currentFile}
              isUploading={isUploading}
              startCreateSubfolder={startCreateSubfolder}
              renameFolder={renameFolder}
              changeFolderColor={changeFolderColor}
              recentColors={recentColors}
              // Pass drag and drop props
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              draggedFolder={draggedFolder}
              dragOverFolder={dragOverFolder}
              dropPosition={dropPosition}
              // Pass linked folder props to nested FolderItems
              linkedFolderFiles={linkedFolderFiles}
              refreshLinkedFolder={refreshLinkedFolder}
              refreshSourceFolder={refreshSourceFolder}
              unlinkFolder={unlinkFolder}
              refreshingFolders={refreshingFolders}
              // Pass unsaved files tracking
              unsavedFiles={unsavedFiles}
              // Pass save/download handlers
              onSaveFile={onSaveFile}
              onDownloadWithAnnotations={onDownloadWithAnnotations}
              isSaving={isSaving}
            />
          ))}
          
          {/* Render files AFTER subfolders */}
          <div className="file-list">
            {filteredFiles.length === 0 && !folder.subfolders?.length ? (
              <div className="empty-folder-hint">
                {isLinkedFolder || isSourceFolder
                  ? (isRefreshing ? 'Loading...' : 'No PDFs found. Click refresh to update.')
                  : 'No files yet'
                }
              </div>
            ) : (
              filteredFiles.map(file => (
                <FileItem
                  key={file.id}
                  file={file}
                  folderId={folder.id}
                  currentFile={currentFile}
                  onClick={() => selectFile(file)}
                  deleteFile={deleteFile}
                  downloadFile={downloadFile}
                  isLocal={file.isLocal}
                  unsavedFiles={unsavedFiles}
                  unlockedFiles={unlockedFiles}
                  onSaveFile={onSaveFile}
                  onDownloadWithAnnotations={onDownloadWithAnnotations}
                  isSaving={isSaving}
                />
              ))
            )}
          </div>
        </div>
      )}
      
      {/* Drop indicator for 'after' position */}
      {isDragOver && dropPosition === 'after' && (
        <div className="drop-indicator drop-after" />
      )}
    </div>
  );
}

// Folder row component with menu for drill-down navigation
function FolderRow({ 
  folder, 
  isSelected, 
  onClick, 
  onDelete, 
  onRename, 
  onChangeColor,
  linkedFolderFiles,
  refreshLinkedFolder,
  refreshSourceFolder,
  unlinkFolder,
  isRefreshing,
  recentColors,
  selectedFolders,
  onBulkDelete,
  onBulkChangeColor,
  // File drag props
  onFileDragOver,
  onFileDrop,
  isDragOverForFile,
  draggedFile
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editName, setEditName] = useState(folder.name);
  const [editColor, setEditColor] = useState(folder.color || '#3498db');
  const menuRef = useRef(null);

  const hasMultipleSelected = selectedFolders && selectedFolders.size > 1;
  const isInSelection = selectedFolders && selectedFolders.has(folder.id);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const handleMenuClick = (e) => {
    e.stopPropagation();
    setShowMenu(!showMenu);
  };

  const handleEdit = (e) => {
    e.stopPropagation();
    setShowMenu(false);
    setEditName(folder.name);
    setEditColor(folder.color || '#3498db');
    setShowEditDialog(true);
  };

  const handleEditSave = () => {
    if (editName.trim()) {
      if (editName.trim() !== folder.name) {
        onRename(folder.id, editName.trim());
      }
      if (editColor !== folder.color) {
        onChangeColor(folder.id, editColor);
      }
    }
    setShowEditDialog(false);
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    setShowMenu(false);
    if (hasMultipleSelected && isInSelection) {
      onBulkDelete();
    } else {
      onDelete(folder.id);
    }
  };

  const handleRefresh = (e) => {
    e.stopPropagation();
    setShowMenu(false);
    if (folder.isSourceFolder) {
      refreshSourceFolder(folder.id);
    } else {
      refreshLinkedFolder(folder.id);
    }
  };

  const handleUnlink = (e) => {
    e.stopPropagation();
    setShowMenu(false);
    if (folder.isSourceFolder) {
      if (confirm(`Remove "${folder.name}" from project? Files on disk will not be affected.`)) {
        onDelete(folder.id);
      }
    } else {
      unlinkFolder(folder.id);
    }
  };

  const isExternalFolder = folder.isLinked || folder.isSourceFolder;
  const itemCount = folder.isLinked 
    ? `${(linkedFolderFiles[folder.id] || []).length} files`
    : `${(folder.files || []).length + (folder.subfolders || []).length} items`;

  return (
    <>
      <div 
        className={`folder-row ${isExternalFolder ? 'linked-folder' : ''} ${isSelected ? 'selected' : ''} ${isDragOverForFile ? 'drag-over-file' : ''}`}
        onClick={onClick}
        onDragOver={(e) => onFileDragOver && onFileDragOver(e, folder)}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => onFileDrop && onFileDrop(e, folder)}
        style={isSelected ? { background: 'white' } : undefined}
        title={draggedFile ? (draggedFile.isMultiple ? `Move ${draggedFile.files.length} files to ${folder.name}` : `Move to ${folder.name}`) : (folder.sourceFolderPath || folder.name)}
      >
        <div className="folder-row-icon" style={{ color: folder.color || '#3498db' }}>
          <svg viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 3.5A1.5 1.5 0 012.5 2h3.172a1.5 1.5 0 011.06.44l.658.658A1.5 1.5 0 008.45 3.5H13.5A1.5 1.5 0 0115 5v7.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z"/>
          </svg>
        </div>
        <span className="folder-row-name">{folder.name}</span>
        {folder.isLinked && <span className="linked-badge">🔗</span>}
        {folder.isSourceFolder && <span className="linked-badge" title={folder.sourceFolderPath}>📂</span>}
        <span className="folder-row-count">{itemCount}</span>
        
        <div className="folder-menu-container" ref={menuRef}>
          <button 
            className="folder-menu-btn"
            onClick={handleMenuClick}
            title="Folder options"
          >
            ⋮
          </button>
          {showMenu && (
            <div className="folder-menu-dropdown">
              {hasMultipleSelected && isInSelection ? (
                <>
                  <div className="menu-section-label">{selectedFolders.size} folders selected</div>
                  <button onClick={handleDelete} className="delete-option">
                    Delete {selectedFolders.size} Folders
                  </button>
                </>
              ) : isExternalFolder ? (
                <>
                  <button onClick={handleRefresh} disabled={isRefreshing}>
                    {isRefreshing ? 'Refreshing...' : 'Refresh'}
                  </button>
                  <button onClick={handleUnlink}>
                    {folder.isSourceFolder ? 'Remove Folder' : 'Unlink Folder'}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={handleEdit}>
                    Edit
                  </button>
                  <button onClick={handleDelete} className="delete-option">
                    Delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        
        <svg className="folder-row-chevron" viewBox="0 0 16 16" fill="none">
          <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      
      {/* Edit Folder Dialog */}
      {showEditDialog && (
        <div className="new-folder-dialog-overlay">
          <div className="new-folder-dialog new-folder-dialog-compact" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>Edit Folder</h3>
              <button 
                className="dialog-close-btn"
                onClick={() => setShowEditDialog(false)}
              >
                ×
              </button>
            </div>
            
            <div className="dialog-body">
              <div className="dialog-row">
                <label>Name</label>
                <input
                  type="text"
                  placeholder="Folder name..."
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && editName.trim() && handleEditSave()}
                  autoFocus
                />
              </div>
              
              <div className="dialog-row">
                <label>Colour</label>
                <input
                  type="color"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                  className="color-input-full"
                />
              </div>
            </div>
            
            <div className="dialog-footer">
              <button 
                className="dialog-btn cancel"
                onClick={() => setShowEditDialog(false)}
              >
                Cancel
              </button>
              <button 
                className="dialog-btn create"
                onClick={handleEditSave}
                disabled={!editName.trim()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// File item component with three-dot menu
function FileItem({ file, folderId, currentFile, onClick, deleteFile, downloadFile, isLocal, unsavedFiles = new Set(), unlockedFiles = new Set(), onSaveFile, onDownloadWithAnnotations, isSaving = false, isMultiSelected = false, selectedFiles, onBulkDelete, searchQuery, onShowInFolder, onDragStart, onDragEnd }) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);
  
  const hasMultipleSelected = selectedFiles && selectedFiles.size > 1;
  const isInSelection = selectedFiles && selectedFiles.has(file.id);
  
  // Check if this file has unsaved markup changes
  // Match by backendFilename or by name for local files
  const fileIdentifier = file.backendFilename || file.name;
  const hasUnsavedChanges = unsavedFiles.has(fileIdentifier) ||
    (file.isLocal && unsavedFiles.has(file.name)) ||
    // Also check if the file object matches any identifier in unsavedFiles
    Array.from(unsavedFiles).some(id => id === file.name || id === file.backendFilename);
  const isUnlocked = unlockedFiles.has(file.backendFilename || file.name) || (file.isLocal && unlockedFiles.has(file.id));
  
  // Show folder location when searching and file has a folder
  const showFolderLocation = searchQuery && file.folderName;
  
  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);
  
  const handleMenuClick = (e) => {
    e.stopPropagation();
    setShowMenu(!showMenu);
  };
  
  const handleDownload = (e) => {
    e.stopPropagation();
    setShowMenu(false);
    if (isLocal && file.file) {
      // For local files, create a download from the File object
      const url = URL.createObjectURL(file.file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } else if (onDownloadWithAnnotations && isSelected) {
      // If this file is selected and we have annotation download, use it
      onDownloadWithAnnotations();
    } else {
      downloadFile(file, e);
    }
  };
  
  const handleSave = (e) => {
    e.stopPropagation();
    setShowMenu(false);
    if (onSaveFile) {
      onSaveFile();
    }
  };
  
  const handleDelete = (e) => {
    e.stopPropagation();
    setShowMenu(false);
    if (hasMultipleSelected && isInSelection) {
      onBulkDelete();
    } else {
      deleteFile(folderId, file.id, e);
    }
  };
  
  const handleShowInFolder = (e) => {
    e.stopPropagation();
    if (onShowInFolder) {
      onShowInFolder();
    }
  };
  
  // Check if this file is selected (handle both local and backend files)
  const isSelected = currentFile?.id === file.id || 
    (currentFile?.name === file.name && currentFile?.isLocal === file.isLocal);
  
  // Can save if: file is selected, has backend filename, and save handler exists
  const canSave = isSelected && file.backendFilename && onSaveFile;
  
  return (
    <div
      className={`file-item ${isSelected ? 'selected' : ''} ${isLocal ? 'local-file' : ''} ${hasUnsavedChanges ? 'has-unsaved' : ''} ${isMultiSelected ? 'multi-selected' : ''} ${showFolderLocation ? 'with-folder-location' : ''}`}
      onClick={onClick}
      style={isMultiSelected && !isSelected ? { background: '#333' } : undefined}
      draggable={!isLocal}
      onDragStart={(e) => {
        if (!isLocal && onDragStart) {
          onDragStart(e, file, folderId);
        }
      }}
      onDragEnd={(e) => {
        if (onDragEnd) {
          onDragEnd(e);
        }
      }}
    >
      <span className="file-icon">{isUnlocked ? '🔓' : '📄'}</span>
      <div className="file-info">
        <span className="file-name">
          {file.name}
          {hasUnsavedChanges && <span className="unsaved-indicator" title="Unsaved markup changes">*</span>}
        </span>
        {showFolderLocation && (
          <span 
            className="file-folder-location" 
            onClick={handleShowInFolder}
            title={`Show in folder: ${file.folderName}`}
          >
            📁 {file.folderName}
          </span>
        )}
      </div>
      <div className="file-menu-container" ref={menuRef}>
        <button 
          className="file-menu-btn"
          onClick={handleMenuClick}
          title="File options"
        >
          ⋮
        </button>
        {showMenu && (
          <div className="file-menu-dropdown">
            {hasMultipleSelected && isInSelection ? (
              <>
                <div className="menu-section-label">{selectedFiles.size} files selected</div>
                <button onClick={handleDelete} className="delete-option">
                  Delete {selectedFiles.size} Files
                </button>
              </>
            ) : (
              <>
                {/* Show in folder option - only in search results */}
                {onShowInFolder && (
                  <button onClick={handleShowInFolder}>
                    Show in Folder
                  </button>
                )}
                {/* Save option - only for selected backend files */}
                {canSave && (
                  <button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                )}
                <button onClick={handleDownload} disabled={isSaving}>
                  {isSaving ? '...' : 'Download'}
                </button>
                {isLocal ? (
                  <button onClick={handleDelete} className="delete-option">
                    Remove
                  </button>
                ) : (
                  <button onClick={handleDelete} className="delete-option">
                    Delete
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
