// Storage utility
// Projects/folders stored in IndexedDB
// PDF files stored on backend server

const DB_NAME = 'PDFViewerDB';
const DB_VERSION = 2;
const PROJECTS_STORE = 'projects';

import { BACKEND_URL, DETECTOR_URL } from './config.js';

let db = null;

// =============================================================================
// CACHING LAYER - Reduces redundant network requests
// =============================================================================

const cache = {
  objects: new Map(),      // projectId -> { data, timestamp }
  regions: new Map(),      // projectId -> { data, timestamp }
  models: new Map(),       // projectId -> { data, timestamp }
  pdfUrls: new Map(),      // filename -> blobUrl
  pendingRequests: new Map(), // Deduplication of in-flight requests
};

const CACHE_TTL = 30000; // 30 seconds

const getCached = (cacheMap, key) => {
  const cached = cacheMap.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
};

const setCache = (cacheMap, key, data) => {
  cacheMap.set(key, { data, timestamp: Date.now() });
};

const invalidateCache = (cacheMap, key) => {
  cacheMap.delete(key);
};

// Deduplicate concurrent requests to same endpoint
const dedupeRequest = async (key, requestFn) => {
  if (cache.pendingRequests.has(key)) {
    return cache.pendingRequests.get(key);
  }
  
  const promise = requestFn().finally(() => {
    cache.pendingRequests.delete(key);
  });
  
  cache.pendingRequests.set(key, promise);
  return promise;
};

// =============================================================================
// IndexedDB Functions
// =============================================================================

// Initialize IndexedDB
export const initDB = () => {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Failed to open IndexedDB');
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(PROJECTS_STORE)) {
        database.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
      }
    };
  });
};

// Save a project
export const saveProject = async (project) => {
  await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PROJECTS_STORE], 'readwrite');
    const store = transaction.objectStore(PROJECTS_STORE);
    const request = store.put(project);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// Get all projects
export const getAllProjects = async () => {
  await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PROJECTS_STORE], 'readonly');
    const store = transaction.objectStore(PROJECTS_STORE);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
};

// Get a single project
export const getProject = async (projectId) => {
  await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PROJECTS_STORE], 'readonly');
    const store = transaction.objectStore(PROJECTS_STORE);
    const request = store.get(projectId);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

// Delete a project
export const deleteProject = async (projectId) => {
  await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PROJECTS_STORE], 'readwrite');
    const store = transaction.objectStore(PROJECTS_STORE);
    const request = store.delete(projectId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// Migrate from localStorage (if any old data exists)
export const migrateFromLocalStorage = async () => {
  const savedProjects = localStorage.getItem('projects');
  if (!savedProjects) return;

  try {
    const projects = JSON.parse(savedProjects);
    
    for (const project of projects) {
      // Save project to IndexedDB (without file data - that's on backend now)
      const cleanProject = {
        ...project,
        folders: project.folders?.map(folder => ({
          ...folder,
          files: folder.files?.map(file => ({
            id: file.id,
            name: file.name,
            backendFilename: file.backendFilename || file.name, // Use name as fallback
            folderId: file.folderId,
            uploadedAt: file.uploadedAt
          })) || []
        })) || []
      };
      await saveProject(cleanProject);
    }

    // Clear localStorage after migration
    localStorage.removeItem('projects');
    console.log('Migration from localStorage complete');
  } catch (error) {
    console.error('Migration failed:', error);
  }
};

// =============================================================================
// Project Line Styles (stored on the project object in IndexedDB)
// =============================================================================

// Get all line styles for a project
export const getProjectLineStyles = async (projectId) => {
  const project = await getProject(projectId);
  return project?.lineStyles || [];
};

// Save a new line style to a project (returns 'saved' | 'duplicate')
export const addProjectLineStyle = async (projectId, style) => {
  const project = await getProject(projectId);
  if (!project) throw new Error('Project not found');
  
  const styles = project.lineStyles || [];
  if (styles.some(s => s.name === style.name)) return 'duplicate';
  
  styles.push({ ...style, savedAt: Date.now() });
  project.lineStyles = styles;
  await saveProject(project);
  return 'saved';
};

// Remove a line style from a project by name
export const removeProjectLineStyle = async (projectId, styleName) => {
  const project = await getProject(projectId);
  if (!project) return;
  
  project.lineStyles = (project.lineStyles || []).filter(s => s.name !== styleName);
  await saveProject(project);
};

// Update/replace all line styles for a project (bulk save)
export const saveProjectLineStyles = async (projectId, styles) => {
  const project = await getProject(projectId);
  if (!project) throw new Error('Project not found');
  
  project.lineStyles = styles;
  await saveProject(project);
};

// =============================================================================
// Backend API calls for files
// =============================================================================

// Upload PDF to backend
export const uploadPdfToBackend = async (file) => {
  const formData = new FormData();
  formData.append('pdf', file);

  const response = await fetch(`${BACKEND_URL}/api/upload`, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error('Upload failed');
  }

  return response.json();
};

// Get PDF from backend (returns blob URL) - NO CACHING
// Note: We don't cache blob URLs because PDF.js caches documents internally by URL.
// When switching back to a previously loaded PDF, PDF.js tries to reuse the cached
// document which may have been destroyed, causing the load to hang.
// Creating a fresh blob URL each time ensures PDF.js loads a fresh document.
export const getPdfFromBackend = async (filename, sourceFolder) => {
  // Dedupe concurrent requests for same file (still useful for rapid clicks)
  const dedupeKey = sourceFolder ? `pdf:sf:${sourceFolder}:${filename}` : `pdf:${filename}`;
  return dedupeRequest(dedupeKey, async () => {
    let url;
    if (sourceFolder) {
      url = `${BACKEND_URL}/api/files/${encodeURIComponent(filename)}?sourceFolder=${encodeURIComponent(sourceFolder)}`;
    } else {
      url = `${BACKEND_URL}/api/files/${encodeURIComponent(filename)}`;
    }
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error('Failed to fetch PDF');
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    
    return blobUrl;
  });
};

// Delete PDF from backend
export const deletePdfFromBackend = async (filename) => {
  // Invalidate cache
  const cachedUrl = cache.pdfUrls.get(filename);
  if (cachedUrl) {
    URL.revokeObjectURL(cachedUrl);
    cache.pdfUrls.delete(filename);
  }

  const response = await fetch(`${BACKEND_URL}/api/files/${encodeURIComponent(filename)}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    throw new Error('Delete failed');
  }

  return response.json();
};

// Get list of all PDFs on backend
export const getBackendFiles = async () => {
  const response = await fetch(`${BACKEND_URL}/api/files`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch file list');
  }

  const data = await response.json();
  return data.files;
};

// =============================================================================
// Source Folder API — open and list PDFs from any folder on disk
// =============================================================================

// List PDFs in a source folder path
export const listSourceFolder = async (folderPath) => {
  const response = await fetch(`${BACKEND_URL}/api/source-folder/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath })
  });
  
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Failed to list source folder');
  }
  
  return response.json();
};

// Open native folder picker dialog and return selected path
export const browseSourceFolder = async () => {
  const response = await fetch(`${BACKEND_URL}/api/source-folder/browse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  
  if (!response.ok) {
    throw new Error('Failed to open folder picker');
  }
  
  return response.json();
};

// Open native file picker dialog and return selected file paths
export const browseSourceFiles = async () => {
  const response = await fetch(`${BACKEND_URL}/api/source-folder/browse-files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error('Failed to open file picker');
  }

  return response.json();
};

// =============================================================================
// Detector API calls
// =============================================================================

export const trainDetector = async (pdfFilename, boxes, multiOrientation = false, includeInverted = false, trainingMode = 'separate', modelType = 'object', projectId = null, addToExistingModel = null, sourceFolder = null) => {
  const body = {
    pdfFilename,
    boxes,
    multiOrientation,
    includeInverted,
    trainingMode,
    modelType,
    projectId,
    sourceFolder
  };
  
  // Only include addToModelId if it's set (to avoid backend errors if not supported)
  if (addToExistingModel) {
    body.addToModelId = addToExistingModel;  // Server expects addToModelId
  }
  
  const response = await fetch(`${BACKEND_URL}/api/detector/train`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Training failed');
  }

  // Invalidate models cache after training
  invalidateCache(cache.models, projectId || 'global');

  return response.json();
};

export const runDetection = async (pdfFilename, options) => {
  const response = await fetch(`${BACKEND_URL}/api/detector/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pdfFilename,
      confidence: options.confidence,
      selectedModels: options.selectedModels,
      enableOCR: options.enableOCR,
      ocrPadding: options.ocrPadding || 1.0,
      classPatterns: options.classPatterns,
      // Global format template (for Smart Links)
      formatTemplate: options.formatTemplate || null,
      // Per-class settings (confidence, OCR enable, and format per class)
      perClassSettings: options.perClassSettings || null,
      // Project ID for incremental saves
      projectId: options.projectId || null,
      // Pages to detect on (array of page numbers, null = all pages)
      pages: options.pages || null,
      // Source folder for non-uploaded PDFs
      sourceFolder: options.sourceFolder || null,
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Detection failed');
  }

  return response.json();
};

// Run full-page OCR to extract ALL text with bounding boxes
// Useful for finding pipe tags and other text not inside detected symbols
export const runFullPageOcr = async (pdfFilename, page = 1, dpi = 300, sourceFolder = null) => {
  const response = await fetch(`${BACKEND_URL}/api/ocr/fullpage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pdfFilename,
      page,
      dpi,
      sourceFolder,
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Full-page OCR failed');
  }

  return response.json();
};

export const getModels = async (projectId = null) => {
  const cacheKey = projectId || 'global';
  
  // Check cache
  const cached = getCached(cache.models, cacheKey);
  if (cached) {
    return cached;
  }

  // Dedupe concurrent requests
  return dedupeRequest(`models:${cacheKey}`, async () => {
    const url = projectId 
      ? `${BACKEND_URL}/api/models/list?projectId=${encodeURIComponent(projectId)}`
      : `${BACKEND_URL}/api/models/list`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error('Failed to fetch models');
    }

    const data = await response.json();
    const models = data.models;
    
    // Cache the result
    setCache(cache.models, cacheKey, models);
    
    return models;
  });
};

export const deleteModel = async (modelId) => {
  const response = await fetch(`${BACKEND_URL}/api/models/${modelId}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    throw new Error('Failed to delete model');
  }

  // Invalidate all model caches (we don't know which project this belongs to)
  cache.models.clear();

  return response.json();
};

// Save/update a model (for import functionality)
export const saveModel = async (model) => {
  const response = await fetch(`${BACKEND_URL}/api/models/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(model)
  });

  if (!response.ok) {
    throw new Error('Failed to save model');
  }

  // Invalidate models cache
  cache.models.clear();

  return response.json();
};

// Export a single model as ZIP (includes .pkl, metadata, examples)
export const exportSingleModel = async (modelId, className) => {
  const response = await fetch(`${DETECTOR_URL}/models/export/${encodeURIComponent(modelId)}`);
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Export failed');
  }

  const blob = await response.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  
  const safeName = (className || modelId).replace(/[^a-zA-Z0-9_-]/g, '_');
  link.download = `model_${safeName}_${new Date().toISOString().slice(0,10)}.zip`;
  link.click();
  URL.revokeObjectURL(link.href);
};

// Get thumbnail for an object
export const getThumbnail = async (filename, page, bbox, rotation = 0, inverted = false, sourceFolder = null) => {
  const response = await fetch(`${BACKEND_URL}/api/thumbnail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, page, bbox, rotation, inverted, sourceFolder })
  });

  if (!response.ok) {
    throw new Error('Failed to get thumbnail');
  }

  const data = await response.json();
  return data.thumbnail;
};

// Capture region from PDF at 300 DPI (for subclass region definition)
// Returns { image: base64, width: pixels, height: pixels, dpi: 300 }
export const captureRegion = async (filename, page, bbox, sourceFolder = null) => {
  const response = await fetch(`${BACKEND_URL}/api/capture-region`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, page, bbox, sourceFolder })
  });

  if (!response.ok) {
    throw new Error('Failed to capture region');
  }

  return response.json();
};

// =============================================================================
// Objects Storage API calls - WITH CACHING
// =============================================================================

// Get detected objects for a project from backend file
export const getObjectsFromBackend = async (projectId, forceRefresh = false) => {
  if (!forceRefresh) {
    const cached = getCached(cache.objects, projectId);
    if (cached) {
      return cached;
    }
  }

  // Dedupe concurrent requests
  return dedupeRequest(`objects:${projectId}`, async () => {
    const response = await fetch(`${BACKEND_URL}/api/objects/${encodeURIComponent(projectId)}`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch objects');
    }

    const data = await response.json();
    const objects = data.objects || [];
    
    // Cache the result
    setCache(cache.objects, projectId, objects);
    
    return objects;
  });
};

// Save detected objects for a project to backend file
export const saveObjectsToBackend = async (projectId, objects) => {
  // Invalidate cache before saving
  invalidateCache(cache.objects, projectId);

  const response = await fetch(`${BACKEND_URL}/api/objects/${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objects })
  });

  if (!response.ok) {
    throw new Error('Failed to save objects');
  }

  // Update cache with new data
  setCache(cache.objects, projectId, objects);

  return response.json();
};

// Delete objects file for a project
export const deleteObjectsFromBackend = async (projectId) => {
  // Invalidate cache
  invalidateCache(cache.objects, projectId);

  const response = await fetch(`${BACKEND_URL}/api/objects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    throw new Error('Failed to delete objects');
  }

  return response.json();
};

// =============================================================================
// Model Templates & Examples API calls
// =============================================================================

// Get templates for a model (base64 images)
export const getModelTemplates = async (modelId) => {
  const response = await fetch(`${BACKEND_URL}/api/models/${encodeURIComponent(modelId)}/templates`);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch templates');
  }

  const data = await response.json();
  return data.templates || [];
};

// Get examples for a model (original RGB images before preprocessing)
export const getModelExamples = async (modelId) => {
  const response = await fetch(`${BACKEND_URL}/api/models/${encodeURIComponent(modelId)}/examples`);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch examples');
  }

  const data = await response.json();
  // Fall back to templates for older models that don't have examples stored
  return data.examples || data.templates || [];
};

// Remove an example from a model (and regenerate templates)
export const removeModelExample = async (modelId, exampleId) => {
  const response = await fetch(
    `${BACKEND_URL}/api/models/${encodeURIComponent(modelId)}/examples/${encodeURIComponent(exampleId)}`,
    { method: 'DELETE' }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to remove example');
  }

  // Invalidate models cache
  cache.models.clear();

  return response.json();
};

// =============================================================================
// Local File Helpers
// =============================================================================

// Check if File System Access API is supported
export const isFileSystemAccessSupported = () => {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
};

// Get PDF URL - handles backend files, local blob URLs, and source folder files
export const getPdfUrl = async (file) => {
  if (file.blobUrl) {
    // Local file - already has blob URL
    return file.blobUrl;
  } else if (file.sourceFolder) {
    // Source folder file — served via backend with sourceFolder param
    return getPdfFromBackend(file.backendFilename || file.name, file.sourceFolder);
  } else if (file.backendFilename) {
    // Backend file - fetch from server (with caching)
    return getPdfFromBackend(file.backendFilename);
  } else {
    throw new Error('Invalid file: no blobUrl, sourceFolder, or backendFilename');
  }
};

// Create blob URL from File object
export const createBlobUrl = (fileObject) => {
  return URL.createObjectURL(fileObject);
};

// Revoke blob URL to free memory
export const revokeBlobUrl = (blobUrl) => {
  if (blobUrl && blobUrl.startsWith('blob:')) {
    URL.revokeObjectURL(blobUrl);
  }
};

// =============================================================================
// Regions Storage API calls - WITH CACHING
// =============================================================================

// Get drawn regions for a project from backend file
export const getRegionsFromBackend = async (projectId, forceRefresh = false) => {
  if (!forceRefresh) {
    const cached = getCached(cache.regions, projectId);
    if (cached) {
      return cached;
    }
  }

  // Dedupe concurrent requests
  return dedupeRequest(`regions:${projectId}`, async () => {
    const response = await fetch(`${BACKEND_URL}/api/regions/${encodeURIComponent(projectId)}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        // Cache empty result too
        setCache(cache.regions, projectId, []);
        return []; // No regions file yet
      }
      throw new Error('Failed to fetch regions');
    }

    const data = await response.json();
    const regions = data.regions || [];
    
    // Cache the result
    setCache(cache.regions, projectId, regions);
    
    return regions;
  });
};

// Save drawn regions for a project to backend file
export const saveRegionsToBackend = async (projectId, regions) => {
  // Invalidate cache before saving
  invalidateCache(cache.regions, projectId);

  const response = await fetch(`${BACKEND_URL}/api/regions/${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regions })
  });

  if (!response.ok) {
    throw new Error('Failed to save regions');
  }

  // Update cache with new data
  setCache(cache.regions, projectId, regions);

  return response.json();
};

// Delete regions file for a project
export const deleteRegionsFromBackend = async (projectId) => {
  // Invalidate cache
  invalidateCache(cache.regions, projectId);

  const response = await fetch(`${BACKEND_URL}/api/regions/${encodeURIComponent(projectId)}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    throw new Error('Failed to delete regions');
  }

  return response.json();
};

// =============================================================================
// Cache Management (for manual control if needed)
// =============================================================================

export const clearAllCaches = () => {
  // Revoke all blob URLs before clearing
  cache.pdfUrls.forEach(url => URL.revokeObjectURL(url));
  
  cache.objects.clear();
  cache.regions.clear();
  cache.models.clear();
  cache.pdfUrls.clear();
  cache.pendingRequests.clear();
};

export const clearProjectCache = (projectId) => {
  invalidateCache(cache.objects, projectId);
  invalidateCache(cache.regions, projectId);
  invalidateCache(cache.models, projectId);
  invalidateCache(cache.models, 'global');
};
