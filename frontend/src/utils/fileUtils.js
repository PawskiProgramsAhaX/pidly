/**
 * fileUtils.js
 * 
 * Shared pure utility functions for file/folder operations.
 * Used by both FileSidebar (PDFViewer) and DocumentsPanel (InfiniteView).
 */

// Natural alphanumeric sort function for files and folders
// Handles cases like "2000-f12 rev 0" < "2000-f12 rev 1" < "2000-f12 rev 10"
export const naturalSort = (a, b) => {
  const nameA = (a.name || '').toLowerCase();
  const nameB = (b.name || '').toLowerCase();
  
  const splitByNumbers = (str) => str.split(/(\d+)/).filter(s => s !== '');
  
  const partsA = splitByNumbers(nameA);
  const partsB = splitByNumbers(nameB);
  
  const maxLen = Math.max(partsA.length, partsB.length);
  
  for (let i = 0; i < maxLen; i++) {
    const partA = partsA[i] || '';
    const partB = partsB[i] || '';
    
    const numA = parseInt(partA, 10);
    const numB = parseInt(partB, 10);
    
    if (!isNaN(numA) && !isNaN(numB)) {
      if (numA !== numB) return numA - numB;
    } else {
      if (partA !== partB) return partA.localeCompare(partB);
    }
  }
  
  return 0;
};

// Sort array (non-mutating) using natural sort
export const sortByName = (arr) => {
  return [...arr].sort(naturalSort);
};

// Find a folder by ID in a nested folder structure
export const findFolderById = (folders, folderId) => {
  for (const folder of folders) {
    if (folder.id === folderId) return folder;
    if (folder.subfolders?.length > 0) {
      const found = findFolderById(folder.subfolders, folderId);
      if (found) return found;
    }
  }
  return null;
};

// Get the path from root to a target folder (for breadcrumbs)
// Returns array of folders from root to target, or null if not found
export const getFolderPath = (folders, targetId, path = []) => {
  for (const folder of folders) {
    if (folder.id === targetId) {
      return [...path, folder];
    }
    if (folder.subfolders?.length > 0) {
      const found = getFolderPath(folder.subfolders, targetId, [...path, folder]);
      if (found) return found;
    }
  }
  return null;
};

// Recursively get all files from a folder tree (for search)
// Optional linkedFolderFiles map for linked local folders (FileSidebar)
export const getAllNestedFiles = (folders, linkedFolderFiles = null) => {
  let allFiles = [];
  for (const folder of folders) {
    const folderFiles = (linkedFolderFiles && folder.isLinked)
      ? (linkedFolderFiles[folder.id] || [])
      : (folder.files || []);
    allFiles = [...allFiles, ...folderFiles.map(f => ({ 
      ...f, 
      folderName: folder.name, 
      folderIdRef: folder.id 
    }))];
    if (folder.subfolders?.length > 0) {
      allFiles = [...allFiles, ...getAllNestedFiles(folder.subfolders, linkedFolderFiles)];
    }
  }
  return allFiles;
};

// Recursively get all folders from a folder tree (for search)
export const getAllNestedFolders = (folders) => {
  let allFolders = [];
  for (const folder of folders) {
    allFolders.push(folder);
    if (folder.subfolders?.length > 0) {
      allFolders = [...allFolders, ...getAllNestedFolders(folder.subfolders)];
    }
  }
  return allFolders;
};
