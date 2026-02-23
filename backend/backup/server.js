const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');
const { PDFDocument, rgb, StandardFonts, PDFName, PDFArray, PDFDict, PDFNumber, PDFString, PDFRef, pushGraphicsState, popGraphicsState, setFillingColor, moveTo, lineTo, closePath, fill } = require('pdf-lib');

const app = express();
const PORT = 3001;

// Flask detector server URL
const FLASK_SERVER_URL = 'http://localhost:5000';

// Helper to check if Flask server is running
const isFlaskServerRunning = async () => {
  return new Promise((resolve) => {
    const req = http.get(`${FLASK_SERVER_URL}/health`, { timeout: 1000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
};

// Helper to call Flask server
const callFlaskServer = async (endpoint, data) => {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const url = new URL(endpoint, FLASK_SERVER_URL);
    
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 600000 // 10 minute timeout for long operations
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${data}`));
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.write(postData);
    req.end();
  });
};

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for YOLO training data

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Objects storage directory (for detected objects per project)
const objectsDir = path.join(__dirname, 'objects');
if (!fs.existsSync(objectsDir)) {
  fs.mkdirSync(objectsDir);
}

// Ensure regions directory exists
const regionsDir = path.join(__dirname, 'regions');
if (!fs.existsSync(regionsDir)) {
  fs.mkdirSync(regionsDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    let filename = file.originalname;
    let counter = 1;
    
    while (fs.existsSync(path.join(__dirname, 'uploads', filename))) {
      const ext = path.extname(file.originalname);
      const nameWithoutExt = path.basename(file.originalname, ext);
      filename = `${nameWithoutExt}_${counter}${ext}`;
      counter++;
    }
    
    cb(null, filename);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed!'));
    }
  }
});

// Separate storage for overwrite uploads (uses original filename)
const overwriteStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    // Use the original filename directly for overwrites
    cb(null, file.originalname);
  }
});

const uploadOverwrite = multer({ 
  storage: overwriteStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed!'));
    }
  }
});

// Python executable path - using system Python (has PaddleOCR installed)
const PYTHON_PATH = 'C:\\Users\\KirstyDellow-Pawski\\Desktop\\pdf-viewer\\backend\\venv\\Scripts\\python.exe';

// Regular upload (creates unique filename if exists)
app.post('/api/upload', (req, res, next) => {
  // Check if this is an overwrite request
  // We need to peek at the body, but multer hasn't parsed it yet
  // So we'll check for overwrite header or query param
  const isOverwrite = req.query.overwrite === 'true' || req.headers['x-overwrite'] === 'true';
  
  if (isOverwrite) {
    uploadOverwrite.single('pdf')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      console.log('File overwritten:', req.file.filename);
      
      res.json({
        success: true,
        message: 'File overwritten successfully',
        filename: req.file.filename,
        originalName: req.file.originalname,
        overwritten: true
      });
    });
  } else {
    upload.single('pdf')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      console.log('File uploaded:', req.file.filename);
      
      res.json({
        success: true,
        message: 'File uploaded successfully',
        filename: req.file.filename,
        originalName: req.file.originalname
      });
    });
  }
});

app.put('/api/files/:filename/rename', (req, res) => {
  try {
    const oldFilename = req.params.filename;
    const { newFilename } = req.body;
    
    if (!newFilename || !newFilename.endsWith('.pdf')) {
      return res.status(400).json({ error: 'New filename must end with .pdf' });
    }
    
    const oldPath = path.join(uploadsDir, oldFilename);
    const newPath = path.join(uploadsDir, newFilename);
    
    if (!fs.existsSync(oldPath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    if (fs.existsSync(newPath)) {
      return res.status(400).json({ error: 'A file with that name already exists' });
    }
    
    fs.renameSync(oldPath, newPath);
    console.log('File renamed:', oldFilename, '->', newFilename);
    
    res.json({ 
      success: true, 
      message: 'File renamed successfully',
      oldFilename,
      newFilename
    });
  } catch (error) {
    console.error('Rename error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/files/:filename', (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);
  
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// Alias for /api/files/:filename - used by PDFViewerArea
app.get('/api/pdf/:filename', (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);
  
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

app.get('/api/files', (req, res) => {
  fs.readdir(uploadsDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Unable to read files' });
    }
    
    const pdfFiles = files.filter(file => file.endsWith('.pdf'));
    res.json({ files: pdfFiles });
  });
});

app.delete('/api/files/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadsDir, filename);
  
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log('File deleted:', filename);
    res.json({ success: true, message: 'File deleted successfully' });
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

app.post('/api/files/rename', (req, res) => {
  const { oldFilename, newFilename } = req.body;
  
  if (!oldFilename || !newFilename) {
    return res.status(400).json({ error: 'Both old and new filenames are required' });
  }
  
  const oldPath = path.join(uploadsDir, oldFilename);
  const newPath = path.join(uploadsDir, newFilename);
  
  if (!fs.existsSync(oldPath)) {
    return res.status(404).json({ error: 'Original file not found' });
  }
  
  if (fs.existsSync(newPath)) {
    return res.status(400).json({ error: 'A file with the new name already exists' });
  }
  
  try {
    fs.renameSync(oldPath, newPath);
    console.log('File renamed:', oldFilename, '->', newFilename);
    res.json({ success: true, message: 'File renamed successfully', newFilename });
  } catch (error) {
    console.error('Rename error:', error);
    res.status(500).json({ error: 'Failed to rename file' });
  }
});

// ============ Objects Storage API ============

// Get objects for a project
app.get('/api/objects/:projectId', (req, res) => {
  const { projectId } = req.params;
  const filePath = path.join(objectsDir, `${projectId}.json`);
  
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      const objects = JSON.parse(data);
      console.log(`Loaded ${objects.length} objects for project ${projectId}`);
      res.json({ success: true, objects });
    } catch (error) {
      console.error('Error reading objects file:', error);
      res.status(500).json({ error: 'Failed to read objects file' });
    }
  } else {
    // No objects file yet - return empty array
    res.json({ success: true, objects: [] });
  }
});

// Save objects for a project
app.put('/api/objects/:projectId', (req, res) => {
  const { projectId } = req.params;
  const { objects } = req.body;
  const filePath = path.join(objectsDir, `${projectId}.json`);
  
  if (!Array.isArray(objects)) {
    return res.status(400).json({ error: 'Objects must be an array' });
  }
  
  try {
    fs.writeFileSync(filePath, JSON.stringify(objects, null, 2));
    console.log(`Saved ${objects.length} objects for project ${projectId}`);
    res.json({ success: true, message: 'Objects saved successfully', count: objects.length });
  } catch (error) {
    console.error('Error writing objects file:', error);
    res.status(500).json({ error: 'Failed to save objects file' });
  }
});

// Delete objects for a project
app.delete('/api/objects/:projectId', (req, res) => {
  const { projectId } = req.params;
  const filePath = path.join(objectsDir, `${projectId}.json`);
  
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      console.log(`Deleted objects file for project ${projectId}`);
      res.json({ success: true, message: 'Objects file deleted' });
    } catch (error) {
      console.error('Error deleting objects file:', error);
      res.status(500).json({ error: 'Failed to delete objects file' });
    }
  } else {
    // File doesn't exist, that's fine
    res.json({ success: true, message: 'No objects file to delete' });
  }
});

// ============ Regions Storage API ============

// Get regions for a project
app.get('/api/regions/:projectId', (req, res) => {
  const { projectId } = req.params;
  const filePath = path.join(regionsDir, `${projectId}.json`);
  
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      const regions = JSON.parse(data);
      console.log(`Loaded ${regions.length} regions for project ${projectId}`);
      res.json({ success: true, regions });
    } catch (error) {
      console.error('Error reading regions file:', error);
      res.status(500).json({ error: 'Failed to read regions file' });
    }
  } else {
    // No regions file yet - return empty array
    res.json({ success: true, regions: [] });
  }
});

// Save regions for a project
app.put('/api/regions/:projectId', (req, res) => {
  const { projectId } = req.params;
  const { regions } = req.body;
  const filePath = path.join(regionsDir, `${projectId}.json`);
  
  if (!Array.isArray(regions)) {
    return res.status(400).json({ error: 'Regions must be an array' });
  }
  
  try {
    fs.writeFileSync(filePath, JSON.stringify(regions, null, 2));
    console.log(`Saved ${regions.length} regions for project ${projectId}`);
    res.json({ success: true, message: 'Regions saved successfully', count: regions.length });
  } catch (error) {
    console.error('Error writing regions file:', error);
    res.status(500).json({ error: 'Failed to save regions file' });
  }
});

// Delete regions for a project
app.delete('/api/regions/:projectId', (req, res) => {
  const { projectId } = req.params;
  const filePath = path.join(regionsDir, `${projectId}.json`);
  
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      console.log(`Deleted regions file for project ${projectId}`);
      res.json({ success: true, message: 'Regions file deleted' });
    } catch (error) {
      console.error('Error deleting regions file:', error);
      res.status(500).json({ error: 'Failed to delete regions file' });
    }
  } else {
    // File doesn't exist, that's fine
    res.json({ success: true, message: 'No regions file to delete' });
  }
});

// Train Detector Endpoint - Template Matching
app.post('/api/detector/train', async (req, res) => {
  try {
    const { pdfFilename, boxes, multiOrientation, includeInverted, trainingMode, modelType, projectId, addToModelId } = req.body;
    
    console.log('=== TRAIN REQUEST ===');
    console.log('addToModelId received:', addToModelId, 'type:', typeof addToModelId);
    console.log('Full request body keys:', Object.keys(req.body));
    
    const pdfPath = path.join(__dirname, 'uploads', pdfFilename);
    const pythonScript = path.join(__dirname, 'python-detector', 'train_detector.py');
    
    const args = [
      pythonScript,
      '--pdf', pdfPath,
      '--boxes', JSON.stringify(boxes)
    ];
    
    // Add multi-orientation flag if enabled
    if (multiOrientation) {
      args.push('--multi-orientation');
    }
    
    // Add include-inverted flag if enabled
    if (includeInverted) {
      args.push('--include-inverted');
    }
    
    // Add training mode (separate or combined)
    if (trainingMode) {
      args.push('--mode', trainingMode);
    }
    
    // Add model type (link or object)
    if (modelType) {
      args.push('--model-type', modelType);
    }
    
    // Add to existing model if specified
    if (addToModelId) {
      console.log('>>> ADDING TO EXISTING MODEL:', addToModelId);
      args.push('--add-to-model', addToModelId);
    } else {
      console.log('>>> CREATING NEW MODEL (addToModelId is falsy)');
    }
    
    console.log('Python args (excluding boxes):', args.filter(a => !a.startsWith('{')));
    
    const python = spawn(PYTHON_PATH, args, {
      cwd: path.join(__dirname, 'python-detector')
    });
    
    let result = '';
    let error = '';
    
    python.stdout.on('data', (data) => {
      result += data.toString();
    });
    
    python.stderr.on('data', (data) => {
      error += data.toString();
      console.error('Python stderr:', data.toString());
    });
    
    python.on('close', (code) => {
      console.log('Python process exited with code:', code);
      console.log('Result:', result);
      
      if (code === 0) {
        try {
          const response = JSON.parse(result);
          
          // Update metadata files with modelType and projectId if provided
          const modelsDir = path.join(__dirname, 'python-detector', 'models');
          
          // If response has modelIds, use them
          let modelIds = response.modelIds || [];
          
          // If no modelIds in response, find recently created metadata files (within last 30 seconds)
          if (modelIds.length === 0 && fs.existsSync(modelsDir)) {
            const now = Date.now();
            const files = fs.readdirSync(modelsDir);
            files.forEach(f => {
              if (f.endsWith('_metadata.json')) {
                const filePath = path.join(modelsDir, f);
                const stats = fs.statSync(filePath);
                // If created within last 30 seconds, it's probably from this training
                if (now - stats.mtimeMs < 30000) {
                  modelIds.push(f.replace('_metadata.json', ''));
                }
              }
            });
          }
          
          modelIds.forEach(modelId => {
            const metadataPath = path.join(modelsDir, `${modelId}_metadata.json`);
            if (fs.existsSync(metadataPath)) {
              const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
              if (modelType) metadata.modelType = modelType;
              if (projectId) metadata.projectId = projectId;
              
              // Extract shapeType from boxes for this model's className
              if (boxes && Array.isArray(boxes)) {
                const modelBox = boxes.find(b => 
                  (b.className && metadata.className && b.className === metadata.className) ||
                  (b.parentClass && metadata.className && b.parentClass === metadata.className)
                );
                if (modelBox?.shapeType) {
                  metadata.shapeType = modelBox.shapeType;
                  console.log(`Set shapeType=${modelBox.shapeType} for model ${modelId} (${metadata.className})`);
                }
              }
              
              fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
              console.log(`Updated metadata for ${modelId} with modelType: ${modelType}, projectId: ${projectId}`);
            }
          });
          
          res.json(response);
        } catch (e) {
          console.error('Failed to parse Python output:', result);
          res.status(500).json({ error: 'Failed to parse training result' });
        }
      } else {
        console.error('Training failed with error:', error);
        res.status(500).json({ error: error || 'Training failed' });
      }
    });
    
  } catch (error) {
    console.error('Training error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Run Detection Endpoint - Template Matching
app.post('/api/detector/detect', async (req, res) => {
  try {
    const { 
      pdfFilename, 
      confidence, 
      selectedModels,
      enableOCR, 
      ocrPadding, 
      classPatterns,
      // Global format template (for Smart Links)
      formatTemplate,
      // Page-specific detection
      pages,  // Array of page numbers (1-indexed) or null for all pages
      // Per-class settings (confidence, enableOCR, ocrFormat per class)
      perClassSettings,
      // Project ID for incremental saves
      projectId
    } = req.body;
    
    console.log('Running detection with:', { 
      pdfFilename, 
      confidence, 
      selectedModels,
      enableOCR,
      formatTemplate: formatTemplate || 'none',
      pages: pages || 'all',
      classPatterns: classPatterns ? Object.keys(classPatterns) : null,
      perClassSettings: perClassSettings ? Object.keys(perClassSettings).map(k => `${k}: conf=${perClassSettings[k]?.confidence}, ocr=${perClassSettings[k]?.enableOCR}, fmt=${perClassSettings[k]?.ocrFormat || 'none'}`) : null,
      projectId: projectId || 'none'
    });
    
    if (!selectedModels || selectedModels.length === 0) {
      return res.status(400).json({ error: 'No models selected. Please select at least one model.' });
    }
    
    const pdfPath = path.join(__dirname, 'uploads', pdfFilename);
    
    // Use lowest confidence from perClassSettings or fallback to global confidence
    let effectiveConfidence = confidence || 0.65;
    if (perClassSettings) {
      const confidences = Object.values(perClassSettings).map(s => s.confidence).filter(c => c !== undefined);
      if (confidences.length > 0) {
        effectiveConfidence = Math.min(...confidences);
      }
    }
    
    // Check if any class has OCR enabled
    let anyOcrEnabled = enableOCR;
    if (perClassSettings) {
      anyOcrEnabled = Object.values(perClassSettings).some(s => s.enableOCR);
    }
    
    // Try Flask server first (faster due to persistent PaddleOCR)
    const flaskRunning = await isFlaskServerRunning();
    
    if (flaskRunning) {
      console.log('Using Flask detector server...');
      try {
        const flaskResult = await callFlaskServer('/detect', {
          pdfPath: pdfPath,
          modelIds: selectedModels,
          confidence: effectiveConfidence,
          pages: pages,
          perClassSettings: perClassSettings,
          enableOCR: anyOcrEnabled,
          ocrPadding: ocrPadding || 1.0,
          projectId: projectId,
          filename: pdfFilename,
          formatTemplate: formatTemplate || null  // Global format for Smart Links
        });
        
        if (flaskResult.error) {
          throw new Error(flaskResult.error);
        }
        
        // Add shapeTypes from model metadata
        const shapeTypes = {};
        const modelsDir = path.join(__dirname, 'python-detector', 'models');
        for (const modelId of selectedModels) {
          const metadataPath = path.join(modelsDir, `${modelId}_metadata.json`);
          if (fs.existsSync(metadataPath)) {
            try {
              const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
              // Use shapeTypes map (new format) if available
              if (metadata.shapeTypes && typeof metadata.shapeTypes === 'object') {
                for (const [className, shapeType] of Object.entries(metadata.shapeTypes)) {
                  shapeTypes[className] = shapeType;
                }
              } else if (metadata.shapeType) {
                // Old format: single shapeType for the model
                const className = metadata.originalClassName || metadata.className;
                shapeTypes[className] = metadata.shapeType;
              }
            } catch (e) {
              console.warn(`Could not read metadata for ${modelId}:`, e.message);
            }
          }
        }
        
        return res.json({ ...flaskResult, shapeTypes });
      } catch (flaskError) {
        console.warn('Flask server error, falling back to subprocess:', flaskError.message);
        // Fall through to subprocess method
      }
    }
    
    // Fallback: Use subprocess method
    console.log('Using subprocess detector...');
    const pythonScript = path.join(__dirname, 'python-detector', 'run_detector.py');
    
    const args = [
      pythonScript,
      '--pdf', pdfPath,
      '--confidence', effectiveConfidence.toString(),
      '--model-ids', JSON.stringify(selectedModels)
    ];
    
    // Add per-class settings as JSON
    if (perClassSettings) {
      args.push('--per-class-settings', JSON.stringify(perClassSettings));
    }
    
    // Add pages parameter if specified
    if (pages && Array.isArray(pages) && pages.length > 0) {
      args.push('--pages', JSON.stringify(pages));
    }
    
    if (anyOcrEnabled) {
      args.push('--ocr');
      args.push('--padding', (ocrPadding || 1.0).toString());
      
      // Pass per-class OCR settings
      if (perClassSettings) {
        args.push('--per-class-ocr', JSON.stringify(
          Object.fromEntries(
            Object.entries(perClassSettings).map(([k, v]) => [k, v.enableOCR])
          )
        ));
        
        // Pass per-class OCR format settings (keyed by className for easy matching)
        const perClassFormats = {};
        const perSubclassFormats = {};  // For classes with subclasses
        Object.entries(perClassSettings).forEach(([modelId, settings]) => {
          console.log(`  Model ${modelId}: ocrFormat=${settings.ocrFormat}, className=${settings.className}, subclassFormats=${JSON.stringify(settings.subclassFormats)}`);
          if (settings.ocrFormat && settings.className) {
            perClassFormats[settings.className] = settings.ocrFormat;
          }
          // Extract subclass formats if present
          if (settings.subclassFormats && settings.className) {
            const subFormats = {};
            Object.entries(settings.subclassFormats).forEach(([subclassName, format]) => {
              if (format) {
                subFormats[subclassName] = format;
              }
            });
            if (Object.keys(subFormats).length > 0) {
              perSubclassFormats[settings.className] = subFormats;
            }
          }
        });
        console.log('Per-class formats to pass:', perClassFormats);
        console.log('Per-subclass formats to pass:', perSubclassFormats);
        if (Object.keys(perClassFormats).length > 0) {
          args.push('--per-class-format', JSON.stringify(perClassFormats));
        }
        if (Object.keys(perSubclassFormats).length > 0) {
          args.push('--per-subclass-format', JSON.stringify(perSubclassFormats));
        }
      }
      
      // Send class patterns as JSON string
      if (classPatterns && Object.keys(classPatterns).length > 0) {
        const patterns = {};
        Object.keys(classPatterns).forEach(className => {
          if (classPatterns[className].regex) {
            patterns[className] = classPatterns[className].regex;
          }
        });
        args.push('--class-patterns', JSON.stringify(patterns));
      }
      
      // Global format template (for Smart Links - applies to all classes)
      if (formatTemplate) {
        args.push('--format-template', formatTemplate);
      }
    }
    
    const python = spawn(PYTHON_PATH, args, {
      cwd: path.join(__dirname, 'python-detector')
    });
    
    let result = '';
    let error = '';
    
    python.stdout.on('data', (data) => {
      result += data.toString();
    });
    
    python.stderr.on('data', (data) => {
      error += data.toString();
      console.error('Python stderr:', data.toString());
    });
    
    python.on('close', (code) => {
      console.log('Python process exited with code:', code);
      console.log('Result:', result);
      
      if (code === 0) {
        try {
          const response = JSON.parse(result);
          
          // Add shapeTypes from model metadata
          const shapeTypes = {};
          const modelsDir = path.join(__dirname, 'python-detector', 'models');
          for (const modelId of selectedModels) {
            const metadataPath = path.join(modelsDir, `${modelId}_metadata.json`);
            if (fs.existsSync(metadataPath)) {
              try {
                const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                // Use shapeTypes map (new format) if available
                if (metadata.shapeTypes && typeof metadata.shapeTypes === 'object') {
                  for (const [className, shapeType] of Object.entries(metadata.shapeTypes)) {
                    shapeTypes[className] = shapeType;
                  }
                } else if (metadata.shapeType) {
                  // Old format: single shapeType for the model
                  const className = metadata.originalClassName || metadata.className;
                  shapeTypes[className] = metadata.shapeType;
                }
              } catch (e) {
                console.warn(`Could not read metadata for ${modelId}:`, e.message);
              }
            }
          }
          response.shapeTypes = shapeTypes;
          
          // If projectId provided and we're using subprocess, save objects
          if (projectId && response.detections) {
            const objectsPath = path.join(objectsDir, `${projectId}.json`);
            let existingObjects = [];
            if (fs.existsSync(objectsPath)) {
              try {
                existingObjects = JSON.parse(fs.readFileSync(objectsPath, 'utf8'));
              } catch (e) {
                console.warn('Could not read existing objects:', e);
              }
            }
            // Remove old detections for this file
            existingObjects = existingObjects.filter(o => o.filename !== pdfFilename);
            // Add new detections with filename and shapeType from model metadata
            const newDetections = response.detections.map((d, i) => ({
              ...d,
              id: `det_${pdfFilename}_${Date.now()}_${i}`,
              filename: pdfFilename,
              // Add shapeType from the shapeTypes map (looked up by label)
              shapeType: d.shapeType || shapeTypes[d.label] || 'rectangle'
            }));
            existingObjects.push(...newDetections);
            fs.writeFileSync(objectsPath, JSON.stringify(existingObjects, null, 2));
            console.log(`Saved ${newDetections.length} objects for project ${projectId}`);
          }
          
          res.json(response);
        } catch (e) {
          console.error('Failed to parse Python output:', result);
          res.status(500).json({ error: 'Failed to parse detection result' });
        }
      } else {
        console.error('Detection failed with error:', error);
        res.status(500).json({ error: error || 'Detection failed' });
      }
    });
    
  } catch (error) {
    console.error('Detection error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== MODEL MANAGEMENT ENDPOINTS ====================

// List all saved models - Updated to show YOLO vs Template
app.get('/api/models/list', (req, res) => {
  try {
    const { projectId } = req.query;
    const modelsDir = path.join(__dirname, 'python-detector', 'models');
    
    // Create models directory if it doesn't exist
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true });
      return res.json({ models: [] });
    }
    
    // Read all .json metadata files
    const files = fs.readdirSync(modelsDir);
    const metadataFiles = files.filter(f => f.endsWith('_metadata.json'));
    
    let models = metadataFiles.map(filename => {
      const metadataPath = path.join(modelsDir, filename);
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      
      // Determine detector type
      const isYolo = metadata.detectorType === 'yolo' || metadata.id?.includes('_yolo_');
      
      return {
        ...metadata,
        detectorType: isYolo ? 'yolo' : 'template',
        displayType: isYolo ? '🧠 YOLO' : '⚡ Template'
      };
    });
    
    // Filter by projectId if provided
    if (projectId) {
      models = models.filter(m => m.projectId === projectId);
    }
    
    // Sort by creation date (newest first)
    models.sort((a, b) => new Date(b.created) - new Date(a.created));
    
    res.json({ models });
  } catch (error) {
    console.error('Error listing models:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a model - Updated to handle both .pkl and .pt files
app.delete('/api/models/:modelId', (req, res) => {
  try {
    const { modelId } = req.params;
    const modelsDir = path.join(__dirname, 'python-detector', 'models');
    
    // Delete .pkl (template), .pt (YOLO), and _metadata.json files
    const pklPath = path.join(modelsDir, `${modelId}.pkl`);
    const ptPath = path.join(modelsDir, `${modelId}.pt`);
    const metadataPath = path.join(modelsDir, `${modelId}_metadata.json`);
    
    let deleted = false;
    
    if (fs.existsSync(pklPath)) {
      fs.unlinkSync(pklPath);
      deleted = true;
    }
    if (fs.existsSync(ptPath)) {
      fs.unlinkSync(ptPath);
      deleted = true;
    }
    if (fs.existsSync(metadataPath)) {
      fs.unlinkSync(metadataPath);
      deleted = true;
    }
    
    if (deleted) {
      console.log('Deleted model:', modelId);
      res.json({ success: true, message: 'Model deleted' });
    } else {
      res.status(404).json({ error: 'Model not found' });
    }
  } catch (error) {
    console.error('Error deleting model:', error);
    res.status(500).json({ error: error.message });
  }
});

// Save/update model metadata (for import functionality)
app.post('/api/models/save', (req, res) => {
  try {
    const model = req.body;
    
    if (!model || !model.id) {
      return res.status(400).json({ error: 'Model must have an id' });
    }
    
    const modelsDir = path.join(__dirname, 'python-detector', 'models');
    
    // Create models directory if it doesn't exist
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true });
    }
    
    const metadataPath = path.join(modelsDir, `${model.id}_metadata.json`);
    
    // Save metadata (won't restore actual templates, just metadata)
    fs.writeFileSync(metadataPath, JSON.stringify(model, null, 2));
    
    console.log('Saved model metadata:', model.id);
    res.json({ success: true, message: 'Model metadata saved', model });
  } catch (error) {
    console.error('Error saving model:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// SERVER.JS ADDITIONS
// ADD THIS CODE AFTER app.post('/api/models/save', ...) endpoint
// (around line 756 in your server.js)
// ============================================================

// Get templates for a model (proxies to Flask detector server)
app.get('/api/models/:modelId/templates', async (req, res) => {
  try {
    const { modelId } = req.params;
    
    // First check if Flask server is running
    const flaskRunning = await isFlaskServerRunning();
    
    if (flaskRunning) {
      // Proxy to Flask server
      const flaskResponse = await new Promise((resolve, reject) => {
        const options = {
          hostname: 'localhost',
          port: 5000,
          path: `/models/${encodeURIComponent(modelId)}/templates`,
          method: 'GET',
          timeout: 30000
        };
        
        const req = http.request(options, (response) => {
          let data = '';
          response.on('data', (chunk) => { data += chunk; });
          response.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`Invalid JSON: ${data}`));
            }
          });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });
        
        req.end();
      });
      
      return res.json(flaskResponse);
    }
    
    // Fall back to extracting from pkl file directly using Python
    const modelsDir = path.join(__dirname, 'python-detector', 'models');
    const pklPath = path.join(modelsDir, `${modelId}.pkl`);
    
    if (!fs.existsSync(pklPath)) {
      return res.status(404).json({ error: 'Model not found' });
    }
    
    // Use inline Python to extract templates
    const pythonScript = `
import sys
import pickle
import json
import base64
from PIL import Image
from io import BytesIO

model_path = sys.argv[1]

with open(model_path, 'rb') as f:
    detector = pickle.load(f)

templates = []
seen_example_ids = set()

for label, template_list in detector.templates.items():
    for t in template_list:
        if isinstance(t, dict):
            rotation = t.get('rotation', 0)
            inverted = t.get('inverted', False)
            example_id = t.get('example_id')
            img = t['image']
        else:
            rotation = 0
            inverted = False
            example_id = None
            img = t
        
        # Only include base templates (rotation=0, inverted=False)
        if rotation == 0 and not inverted:
            if example_id and example_id in seen_example_ids:
                continue
            if example_id:
                seen_example_ids.add(example_id)
            
            # Convert to base64
            pil_img = Image.fromarray(img)
            buffer = BytesIO()
            pil_img.save(buffer, format='PNG')
            b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
            
            templates.append({
                'image': f'data:image/png;base64,{b64}',
                'label': label,
                'className': label,
                'example_id': example_id
            })

print(json.dumps({'success': True, 'templates': templates, 'count': len(templates)}))
`;
    
    const python = spawn(PYTHON_PATH, ['-c', pythonScript, pklPath]);
    
    let result = '';
    let error = '';
    
    python.stdout.on('data', (data) => { result += data.toString(); });
    python.stderr.on('data', (data) => { error += data.toString(); });
    
    python.on('close', (code) => {
      if (code === 0) {
        try {
          res.json(JSON.parse(result));
        } catch (e) {
          res.status(500).json({ error: 'Failed to parse templates' });
        }
      } else {
        console.error('Template extraction error:', error);
        res.status(500).json({ error: error || 'Failed to extract templates' });
      }
    });
    
  } catch (error) {
    console.error('Error getting templates:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get examples for a model (proxies to Flask detector server)
app.get('/api/models/:modelId/examples', async (req, res) => {
  try {
    const { modelId } = req.params;
    
    const flaskRunning = await isFlaskServerRunning();
    
    if (flaskRunning) {
      // Proxy to Flask server
      const flaskResponse = await new Promise((resolve, reject) => {
        const options = {
          hostname: 'localhost',
          port: 5000,
          path: `/models/${encodeURIComponent(modelId)}/examples`,
          method: 'GET',
          timeout: 30000
        };
        
        const req = http.request(options, (response) => {
          let data = '';
          response.on('data', (chunk) => { data += chunk; });
          response.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`Invalid JSON: ${data}`));
            }
          });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });
        
        req.end();
      });
      
      return res.json(flaskResponse);
    }
    
    // Fall back to templates if Flask not running
    // For full examples support, Flask server needs to be running
    // Try to at least return templates
    const modelsDir = path.join(__dirname, 'python-detector', 'models');
    const pklPath = path.join(modelsDir, `${modelId}.pkl`);
    
    if (!fs.existsSync(pklPath)) {
      return res.status(404).json({ error: 'Model not found' });
    }
    
    // Redirect to templates endpoint as fallback
    res.redirect(`/api/models/${modelId}/templates`);
    
  } catch (error) {
    console.error('Error getting examples:', error);
    res.status(500).json({ error: error.message });
  }
});

// Remove an example from a model (proxies to Flask detector server)
app.delete('/api/models/:modelId/examples/:exampleId', async (req, res) => {
  try {
    const { modelId, exampleId } = req.params;
    
    const flaskRunning = await isFlaskServerRunning();
    
    if (!flaskRunning) {
      return res.status(503).json({ 
        error: 'Detector server not running. Start detector_server.py to remove examples.' 
      });
    }
    
    // Proxy DELETE to Flask server
    const flaskResponse = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: 5000,
        path: `/models/${encodeURIComponent(modelId)}/examples/${encodeURIComponent(exampleId)}`,
        method: 'DELETE',
        timeout: 30000
      };
      
      const req = http.request(options, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          try {
            resolve({ status: response.statusCode, data: JSON.parse(data) });
          } catch (e) {
            reject(new Error(`Invalid JSON: ${data}`));
          }
        });
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      req.end();
    });
    
    res.status(flaskResponse.status).json(flaskResponse.data);
    
  } catch (error) {
    console.error('Error removing example:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// END OF SERVER.JS ADDITIONS
// ============================================================


// OCR Test Endpoint - test OCR on a specific region
app.post('/api/ocr/test', async (req, res) => {
  try {
    const { 
      pdfFilename, 
      bbox, 
      page,
      formatTemplate,
      extraLetters,
      extraDigits,
      trailingLetters
    } = req.body;
    
    console.log('OCR test request:', { pdfFilename, bbox, page, formatTemplate });
    
    const pdfPath = path.join(__dirname, 'uploads', pdfFilename);
    const pythonScript = path.join(__dirname, 'python-detector', 'ocr_test.py');
    
    const args = [
      pythonScript,
      '--pdf', pdfPath,
      '--bbox', JSON.stringify(bbox),
      '--page', (page || 0).toString()
    ];
    
    if (formatTemplate) {
      args.push('--format-template', formatTemplate);
      args.push('--extra-letters', (extraLetters ?? 2).toString());
      args.push('--extra-digits', (extraDigits ?? 1).toString());
      args.push('--trailing-letters', (trailingLetters ?? 1).toString());
    }
    
    const python = spawn(PYTHON_PATH, args, {
      cwd: path.join(__dirname, 'python-detector')
    });
    
    let result = '';
    let error = '';
    
    python.stdout.on('data', (data) => {
      result += data.toString();
    });
    
    python.stderr.on('data', (data) => {
      error += data.toString();
      console.error('Python stderr:', data.toString());
    });
    
    python.on('close', (code) => {
      console.log('OCR test result:', result);
      
      if (code === 0) {
        try {
          const response = JSON.parse(result);
          res.json(response);
        } catch (e) {
          console.error('Failed to parse OCR output:', result);
          res.status(500).json({ error: 'Failed to parse OCR result' });
        }
      } else {
        console.error('OCR test failed:', error);
        res.status(500).json({ error: error || 'OCR test failed' });
      }
    });
    
  } catch (error) {
    console.error('OCR test error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate thumbnail for an object
app.post('/api/thumbnail', async (req, res) => {
  try {
    const { filename, page, bbox, rotation, inverted } = req.body;
    
    if (!filename || bbox === undefined) {
      return res.status(400).json({ error: 'Missing filename or bbox' });
    }
    
    const pdfPath = path.join(uploadsDir, filename);
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: 'PDF not found' });
    }
    
    const pythonScript = `
import sys
import json
import base64
from pdf2image import convert_from_path
from PIL import Image, ImageOps
import io

filename = sys.argv[1]
page_num = int(sys.argv[2])
bbox = json.loads(sys.argv[3])
rotation = int(sys.argv[4]) if len(sys.argv) > 4 else 0
inverted = sys.argv[5].lower() == 'true' if len(sys.argv) > 5 else False

# Convert PDF page to image
pages = convert_from_path(filename, first_page=page_num+1, last_page=page_num+1, dpi=150)
if not pages:
    print(json.dumps({"error": "Could not render page"}))
    sys.exit(1)

img = pages[0]
width, height = img.size

# Calculate crop coordinates with padding
padding = 10
x = int(bbox['x'] * width) - padding
y = int(bbox['y'] * height) - padding
w = int(bbox['width'] * width) + padding * 2
h = int(bbox['height'] * height) + padding * 2

# Ensure bounds are valid
x = max(0, x)
y = max(0, y)
x2 = min(width, x + w)
y2 = min(height, y + h)

# Crop the image
cropped = img.crop((x, y, x2, y2))

# First, flip horizontally if detected from inverted template
if inverted:
    cropped = ImageOps.mirror(cropped)

# Then rotate back to 0° if detected at a different orientation
# This normalizes all thumbnails to appear upright
if rotation == 90:
    cropped = cropped.rotate(90, expand=True)
elif rotation == 180:
    cropped = cropped.rotate(180, expand=True)
elif rotation == 270:
    cropped = cropped.rotate(270, expand=True)

# Resize if too large (max 200px wide)
if cropped.width > 200:
    ratio = 200 / cropped.width
    new_size = (200, int(cropped.height * ratio))
    cropped = cropped.resize(new_size, Image.LANCZOS)

# Convert to base64
buffer = io.BytesIO()
cropped.save(buffer, format='PNG')
img_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

print(json.dumps({"thumbnail": f"data:image/png;base64,{img_base64}"}))
`;

    const tempScriptPath = path.join(__dirname, 'temp_thumbnail.py');
    fs.writeFileSync(tempScriptPath, pythonScript);
    
    const pageNum = page || 0;
    const rotationVal = rotation || 0;
    const invertedVal = inverted ? 'true' : 'false';
    const process = spawn('python', [tempScriptPath, pdfPath, pageNum.toString(), JSON.stringify(bbox), rotationVal.toString(), invertedVal]);
    
    let result = '';
    let error = '';
    
    process.stdout.on('data', (data) => { result += data.toString(); });
    process.stderr.on('data', (data) => { error += data.toString(); });
    
    process.on('close', (code) => {
      // Clean up temp script
      try { fs.unlinkSync(tempScriptPath); } catch (e) {}
      
      if (code === 0) {
        try {
          const response = JSON.parse(result);
          res.json(response);
        } catch (e) {
          console.error('Failed to parse thumbnail output:', result);
          res.status(500).json({ error: 'Failed to generate thumbnail' });
        }
      } else {
        console.error('Thumbnail generation failed:', error);
        res.status(500).json({ error: error || 'Thumbnail generation failed' });
      }
    });
    
  } catch (error) {
    console.error('Thumbnail error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Capture region from PDF at high DPI (300) for subclass region definition
// This ensures the popup image matches detection resolution exactly
app.post('/api/capture-region', async (req, res) => {
  try {
    const { filename, page, bbox } = req.body;
    
    if (!filename || bbox === undefined) {
      return res.status(400).json({ error: 'Missing filename or bbox' });
    }
    
    const pdfPath = path.join(uploadsDir, filename);
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: 'PDF not found' });
    }
    
    const pythonScript = `
import sys
import json
import base64
from pdf2image import convert_from_path
from PIL import Image
import io

filename = sys.argv[1]
page_num = int(sys.argv[2])
bbox = json.loads(sys.argv[3])

# Convert PDF page to image at 300 DPI (same as detection)
pages = convert_from_path(filename, first_page=page_num+1, last_page=page_num+1, dpi=300)
if not pages:
    print(json.dumps({"error": "Could not render page"}))
    sys.exit(1)

img = pages[0]
width, height = img.size

# Calculate crop coordinates (NO padding - exact box)
x = int(bbox['x'] * width)
y = int(bbox['y'] * height)
w = int(bbox['width'] * width)
h = int(bbox['height'] * height)

# Ensure bounds are valid
x = max(0, x)
y = max(0, y)
x2 = min(width, x + w)
y2 = min(height, y + h)

# Crop the image
cropped = img.crop((x, y, x2, y2))

# Return dimensions for coordinate verification
crop_width, crop_height = cropped.size

# Convert to base64
buffer = io.BytesIO()
cropped.save(buffer, format='PNG')
img_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

print(json.dumps({
    "image": f"data:image/png;base64,{img_base64}",
    "width": crop_width,
    "height": crop_height,
    "dpi": 300
}))
`;

    const tempScriptPath = path.join(__dirname, 'temp_capture_region.py');
    fs.writeFileSync(tempScriptPath, pythonScript);
    
    const pageNum = page || 0;
    const process = spawn('python', [tempScriptPath, pdfPath, pageNum.toString(), JSON.stringify(bbox)]);
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      // Clean up temp file
      try { fs.unlinkSync(tempScriptPath); } catch (e) {}
      
      if (code !== 0) {
        console.error('Capture region error:', stderr);
        return res.status(500).json({ error: 'Failed to capture region' });
      }
      
      try {
        const result = JSON.parse(stdout.trim());
        if (result.error) {
          return res.status(500).json({ error: result.error });
        }
        res.json(result);
      } catch (e) {
        console.error('Failed to parse capture region output:', stdout);
        res.status(500).json({ error: 'Failed to capture region' });
      }
    });
    
  } catch (error) {
    console.error('Capture region error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Claude Vision OCR endpoint
app.post('/api/ocr/claude', async (req, res) => {
  try {
    const { image, format, context } = req.body;
    
    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }
    
    // Check for API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }
    
    // Build the prompt based on context
    let prompt = `You are an expert at reading instrument tags and labels from P&ID (Piping and Instrumentation Diagram) drawings.

Look at this cropped image from a P&ID and extract the text/tag visible.

Rules:
- Return ONLY the extracted text, nothing else
- If you see an instrument tag (like "21-FIC-001" or "P-101"), return it exactly as shown
- Preserve any hyphens, slashes, or special characters
- If the text is partially obscured or unclear, make your best guess
- If no readable text is found, return "NO_TEXT"`;

    if (format) {
      prompt += `\n\nThe expected format pattern is: ${format}`;
    }
    
    if (context) {
      prompt += `\n\nAdditional context: ${context}`;
    }

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: image.replace(/^data:image\/\w+;base64,/, '')
                }
              },
              {
                type: 'text',
                text: prompt
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error:', errorText);
      return res.status(response.status).json({ error: 'Claude API error', details: errorText });
    }

    const data = await response.json();
    const extractedText = data.content[0]?.text?.trim() || '';
    
    console.log('Claude OCR result:', extractedText);
    
    res.json({
      success: true,
      text: extractedText === 'NO_TEXT' ? '' : extractedText,
      raw: extractedText
    });
    
  } catch (error) {
    console.error('Claude OCR error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Batch Claude Vision OCR endpoint
app.post('/api/ocr/claude/batch', async (req, res) => {
  try {
    const { objects, format, context } = req.body;
    
    if (!objects || !Array.isArray(objects) || objects.length === 0) {
      return res.status(400).json({ error: 'No objects provided' });
    }
    
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }
    
    const results = [];
    
    // Process objects in parallel with a concurrency limit
    const concurrencyLimit = 5;
    for (let i = 0; i < objects.length; i += concurrencyLimit) {
      const batch = objects.slice(i, i + concurrencyLimit);
      
      const batchPromises = batch.map(async (obj) => {
        try {
          let prompt = `Extract the instrument tag or label text from this P&ID image crop. Return ONLY the text, nothing else. If no text is visible, return "NO_TEXT".`;
          
          if (format) {
            prompt += ` Expected format: ${format}`;
          }

          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 50,
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'image',
                      source: {
                        type: 'base64',
                        media_type: 'image/png',
                        data: obj.image.replace(/^data:image\/\w+;base64,/, '')
                      }
                    },
                    {
                      type: 'text',
                      text: prompt
                    }
                  ]
                }
              ]
            })
          });

          if (!response.ok) {
            return { id: obj.id, text: '', error: 'API error' };
          }

          const data = await response.json();
          const extractedText = data.content[0]?.text?.trim() || '';
          
          return {
            id: obj.id,
            text: extractedText === 'NO_TEXT' ? '' : extractedText
          };
        } catch (err) {
          return { id: obj.id, text: '', error: err.message };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    console.log(`Claude batch OCR completed: ${results.length} objects processed`);
    
    res.json({
      success: true,
      results
    });
    
  } catch (error) {
    console.error('Claude batch OCR error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ PDF Markups API ============

// Helper to convert hex color to RGB
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return {
      r: parseInt(result[1], 16) / 255,
      g: parseInt(result[2], 16) / 255,
      b: parseInt(result[3], 16) / 255
    };
  }
  return { r: 0, g: 0, b: 0 };
}

// Save PDF with markups
app.post('/api/pdf/save-markups', async (req, res) => {
  console.log('\n\n========================================');
  console.log('=== SAVE MARKUPS REQUEST RECEIVED ===');
  console.log('========================================\n');
  
  try {
    const { pdfFilename, markups, annotationsToRemove, flatten, saveInPlace, canvasWidth, canvasHeight } = req.body;
    
    console.log('Request data:', {
      pdfFilename,
      markupCount: markups?.length,
      annotationsToRemove: annotationsToRemove?.length || 0,
      flatten,
      saveInPlace,
      canvasWidth,
      canvasHeight
    });
    
    if (!pdfFilename || !markups) {
      console.log('Error: Missing required fields');
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (!canvasWidth || !canvasHeight || canvasWidth === 0 || canvasHeight === 0) {
      console.log('Error: Invalid canvas dimensions');
      return res.status(400).json({ error: 'Invalid canvas dimensions' });
    }
    
    // Load the original PDF
    const pdfPath = path.join(uploadsDir, pdfFilename);
    console.log('PDF path:', pdfPath);
    
    if (!fs.existsSync(pdfPath)) {
      console.log('Error: PDF file not found at', pdfPath);
      return res.status(404).json({ error: 'PDF file not found', path: pdfPath });
    }
    
    console.log('Loading PDF...');
    const existingPdfBytes = fs.readFileSync(pdfPath);
    console.log('PDF loaded, size:', existingPdfBytes.length, 'bytes');
    
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const pages = pdfDoc.getPages();
    console.log('PDF has', pages.length, 'pages');
    
    // Load font for text annotations
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    
    // Group markups by page
    const markupsByPage = {};
    markups.forEach(m => {
      if (m.page !== undefined && m.page !== null) {
        if (!markupsByPage[m.page]) markupsByPage[m.page] = [];
        markupsByPage[m.page].push(m);
      }
    });
    
    console.log('Processing markups for pages:', Object.keys(markupsByPage));
    console.log('Flatten mode:', flatten);
    
    // Helper to convert hex to PDF color array [r, g, b] in 0-1 range
    const hexToPdfColor = (hex) => {
      const c = hexToRgb(hex || '#ff0000');
      return [c.r, c.g, c.b];
    };
    
    // Create set of annotation IDs to remove (for quick lookup)
    const removeIds = new Set(annotationsToRemove || []);
    console.log('Annotations to remove:', removeIds.size > 0 ? [...removeIds] : 'none');
    
    // Process each page
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      const { width: pageWidth, height: pageHeight } = page.getSize();
      const pageMarkups = markupsByPage[pageIndex] || [];
      
      // Setup for annotation mode
      const context = pdfDoc.context;
      let annotsArray = null;
      
      // Handle existing annotations (preserve unmodified ones, remove modified ones)
      if (!flatten) {
        // Get existing annotations array
        const existingAnnotsRef = page.node.get(PDFName.of('Annots'));
        let existingAnnots = [];
        
        if (existingAnnotsRef) {
          // Resolve the reference to get the actual array
          const annotsObj = context.lookup(existingAnnotsRef);
          if (annotsObj && annotsObj.array) {
            existingAnnots = [...annotsObj.array];
            console.log(`Page ${pageIndex}: Found ${existingAnnots.length} existing annotations`);
          }
        }
        
        // Filter out annotations that should be removed
        let keptAnnots = [];
        if (removeIds.size > 0) {
          // Normalize remove IDs - extract just the object number
          const normalizedRemoveIds = new Set();
          for (const id of removeIds) {
            // Handle formats like "33R", "33 0 R", "33"
            const match = String(id).match(/^(\d+)/);
            if (match) {
              normalizedRemoveIds.add(match[1]);
            }
            // Also keep original for NM field matching
            normalizedRemoveIds.add(String(id));
          }
          console.log('Normalized remove IDs:', [...normalizedRemoveIds]);
          
          for (const annotRef of existingAnnots) {
            try {
              const annot = context.lookup(annotRef);
              if (annot) {
                // Try to get the annotation's ID - it might be in NM (name) field
                const nmObj = annot.get ? annot.get(PDFName.of('NM')) : null;
                const annotId = nmObj ? nmObj.toString().replace(/[()]/g, '') : null;
                
                // Get the object number from the reference (e.g., "33 0 R" -> "33")
                const refStr = annotRef.toString();
                const refMatch = refStr.match(/^(\d+)/);
                const objNum = refMatch ? refMatch[1] : null;
                
                console.log(`Checking annotation: NM=${annotId}, ref=${refStr}, objNum=${objNum}`);
                
                // Check if any of these IDs should be removed
                const shouldRemove = normalizedRemoveIds.has(annotId) || 
                                     normalizedRemoveIds.has(objNum) ||
                                     normalizedRemoveIds.has(refStr);
                
                if (!shouldRemove) {
                  keptAnnots.push(annotRef);
                } else {
                  console.log(`*** REMOVING annotation: NM=${annotId}, objNum=${objNum}`);
                }
              } else {
                keptAnnots.push(annotRef);
              }
            } catch (e) {
              console.log('Error inspecting annotation:', e.message);
              // If we can't inspect it, keep it
              keptAnnots.push(annotRef);
            }
          }
          console.log(`Page ${pageIndex}: Kept ${keptAnnots.length} of ${existingAnnots.length} annotations`);
        } else {
          keptAnnots = existingAnnots;
        }
        
        // Create new annotations array with kept annotations
        annotsArray = context.obj([...keptAnnots]);
        page.node.set(PDFName.of('Annots'), annotsArray);
      }
      
      // Skip if no markups for this page
      if (pageMarkups.length === 0) {
        if (!flatten && annotsArray) {
          console.log(`Page ${pageIndex}: No new markups, preserved existing annotations`);
        }
        continue;
      }
      
      console.log(`Page ${pageIndex}: ${pageWidth}x${pageHeight}, processing ${pageMarkups.length} markups`);
      
      // Helper to create Form XObject (appearance stream) for annotations
      // Now supports separate strokeOpacity and fillOpacity
      const createAppearanceStream = (width, height, streamContent, strokeOpacity = 1, fillOpacity = 1, extraResources = {}) => {
        // IMPORTANT: If any opacity < 1, prepend the graphics state command to apply it
        let finalContent = streamContent;
        const needsOpacity = strokeOpacity < 1 || fillOpacity < 1;
        if (needsOpacity) {
          // Insert /GS0 gs after the first 'q ' to apply transparency
          // This assumes stream starts with 'q ' (graphics state save)
          if (finalContent.startsWith('q ')) {
            finalContent = 'q /GS0 gs ' + finalContent.substring(2);
          } else {
            finalContent = '/GS0 gs ' + finalContent;
          }
        }
        
        const streamBytes = Buffer.from(finalContent, 'utf8');
        
        // Build resources - include ExtGState if opacity is needed, plus any extra resources
        let resourcesObj = { ...extraResources };
        if (needsOpacity) {
          // Create ExtGState for transparency with SEPARATE stroke and fill opacities
          const gsDict = context.obj({
            Type: PDFName.of('ExtGState'),
            CA: PDFNumber.of(strokeOpacity),  // Stroke alpha
            ca: PDFNumber.of(fillOpacity),    // Fill alpha
          });
          const gsRef = context.register(gsDict);
          
          resourcesObj.ExtGState = context.obj({
            GS0: gsRef
          });
        }
        
        // Convert extraResources to PDF objects if needed
        const resources = context.obj(resourcesObj);
        
        const formDict = context.obj({
          Type: PDFName.of('XObject'),
          Subtype: PDFName.of('Form'),
          FormType: PDFNumber.of(1),
          BBox: context.obj([0, 0, width, height]),
          Resources: resources,
          Length: PDFNumber.of(streamBytes.length),
        });
        
        const stream = context.stream(streamBytes, formDict);
        return context.register(stream);
      };
      
      // Helper to create annotation dict with appearance stream
      // Now supports separate strokeOpacity and fillOpacity (pass as object { stroke: x, fill: y } or single number for both)
      const createAnnotWithAP = (subtype, rect, pdfColor, strokeWidth, streamContent, extraProps = {}, opacity = 1, extraResources = {}) => {
        const [x1, y1, x2, y2] = rect;
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        
        // Handle opacity - can be single number or { stroke, fill } object
        let strokeOpacity = 1;
        let fillOpacity = 1;
        if (typeof opacity === 'object') {
          strokeOpacity = opacity.stroke !== undefined ? opacity.stroke : 1;
          fillOpacity = opacity.fill !== undefined ? opacity.fill : 1;
        } else {
          strokeOpacity = opacity;
          fillOpacity = opacity;
        }
        
        // Create appearance stream with separate opacities
        const apStream = createAppearanceStream(width, height, streamContent, strokeOpacity, fillOpacity, extraResources);
        
        // Build annotation dict with CA (stroke opacity) and ca (fill opacity) at annotation level for persistence
        const annotDictObj = {
          Type: PDFName.of('Annot'),
          Subtype: PDFName.of(subtype),
          Rect: context.obj(rect),
          C: context.obj(pdfColor),
          Border: context.obj([0, 0, 0]),
          F: PDFNumber.of(4),
          AP: context.obj({ N: apStream }),
          ...extraProps
        };
        
        // Add opacity properties for persistence (only if < 1)
        if (strokeOpacity < 1) {
          annotDictObj.CA = PDFNumber.of(strokeOpacity);
        }
        if (fillOpacity < 1) {
          annotDictObj.ca = PDFNumber.of(fillOpacity);
        }
        
        const annotDict = context.obj(annotDictObj);
        
        return context.register(annotDict);
      };
      
      for (const markup of pageMarkups) {
        try {
          console.log(`Processing markup: type=${markup.type}, hasPoints=${!!markup.points}, pointCount=${markup.points?.length || 0}, closed=${markup.closed}, arcSize=${markup.arcSize}, strokeWidth=${markup.strokeWidth}, hasText=${!!markup.text}, textLength=${markup.text?.length || 0}`);
          
          // Handle 'none' color - use black as fallback for parsing
          const colorHex = (markup.color && markup.color !== 'none') ? markup.color : '#000000';
          const color = hexToRgb(colorHex);
          const rgbColor = rgb(color.r, color.g, color.b);
          const pdfColor = hexToPdfColor(colorHex);
          const strokeWidth = Math.max(0.5, (markup.strokeWidth || 2) * (pageWidth / canvasWidth));
          
          if (flatten) {
            // FLATTEN MODE: Draw directly on page (non-editable)
            if (markup.type === 'pen' || markup.type === 'highlighter') {
              if (markup.points && markup.points.length >= 2) {
                const opacity = markup.type === 'highlighter' ? (markup.opacity || 0.4) : 1;
                
                for (let i = 1; i < markup.points.length; i++) {
                  const p1 = markup.points[i - 1];
                  const p2 = markup.points[i];
                  
                  const x1 = p1.x * pageWidth;
                  const y1 = pageHeight - (p1.y * pageHeight);
                  const x2 = p2.x * pageWidth;
                  const y2 = pageHeight - (p2.y * pageHeight);
                  
                  page.drawLine({
                    start: { x: x1, y: y1 },
                    end: { x: x2, y: y2 },
                    thickness: strokeWidth,
                    color: rgbColor,
                    opacity: opacity
                  });
                }
              }
            } else if (markup.type === 'rectangle') {
              const x = Math.min(markup.startX, markup.endX) * pageWidth;
              const y = pageHeight - (Math.max(markup.startY, markup.endY) * pageHeight);
              const w = Math.abs(markup.endX - markup.startX) * pageWidth;
              const h = Math.abs(markup.endY - markup.startY) * pageHeight;
              
              if (w > 0 && h > 0) {
                // Handle fill and stroke colors
                const hasFill = markup.fillColor && markup.fillColor !== 'none';
                const hasStroke = markup.color && markup.color !== 'none';
                
                let fillColor = undefined;
                if (hasFill) {
                  const fill = hexToRgb(markup.fillColor);
                  fillColor = rgb(fill.r, fill.g, fill.b);
                }
                
                // Get separate opacities
                const fillOpacity = markup.fillOpacity !== undefined ? markup.fillOpacity : (markup.opacity || 1);
                const strokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
                
                // Get dash array based on lineStyle
                let dashArray = undefined;
                const sw = strokeWidth;
                if (markup.lineStyle === 'dashed') {
                  dashArray = [sw * 6, sw * 4];
                } else if (markup.lineStyle === 'dotted') {
                  dashArray = [sw * 1.5, sw * 3];
                } else if (markup.lineStyle === 'dashdot') {
                  dashArray = [sw * 6, sw * 3, sw * 1.5, sw * 3];
                } else if (markup.lineStyle === 'longdash') {
                  dashArray = [sw * 12, sw * 4];
                }
                
                // Debug log
                console.log('Rectangle flatten:', { hasFill, hasStroke, fillOpacity, strokeOpacity, lineStyle: markup.lineStyle, dashArray });
                
                // Draw fill first if present (solid fill, no border)
                if (hasFill) {
                  page.drawRectangle({
                    x, y, width: w, height: h,
                    color: fillColor,
                    opacity: fillOpacity
                  });
                }
                
                // Draw stroke separately (supports dash pattern via SVG path for dashed styles)
                if (hasStroke) {
                  if (dashArray) {
                    // For dashed styles, draw as 4 lines with dash pattern
                    const corners = [
                      { x: x, y: y },           // bottom-left
                      { x: x + w, y: y },       // bottom-right
                      { x: x + w, y: y + h },   // top-right
                      { x: x, y: y + h }        // top-left
                    ];
                    for (let i = 0; i < 4; i++) {
                      const start = corners[i];
                      const end = corners[(i + 1) % 4];
                      page.drawLine({
                        start, end,
                        thickness: strokeWidth,
                        color: rgbColor,
                        opacity: strokeOpacity,
                        dashArray: dashArray
                      });
                    }
                  } else {
                    // Solid stroke
                    page.drawRectangle({
                      x, y, width: w, height: h,
                      borderColor: rgbColor,
                      borderWidth: strokeWidth,
                      borderOpacity: strokeOpacity
                    });
                  }
                }
                
                // Draw text inside rectangle if present
                if (markup.text && markup.text.trim()) {
                  const fontSize = Math.max(8, (markup.fontSize || 12) * (pageWidth / canvasWidth));
                  const textColor = markup.textColor ? hexToRgb(markup.textColor) : { r: 0, g: 0, b: 0 };
                  const padding = 4 * (pageWidth / canvasWidth);
                  
                  // Split text into lines that fit
                  const maxTextWidth = w - (padding * 2);
                  const lines = [];
                  const paragraphs = markup.text.split('\n');
                  
                  for (const para of paragraphs) {
                    const words = para.split(' ');
                    let currentLine = '';
                    for (const word of words) {
                      const testLine = currentLine ? currentLine + ' ' + word : word;
                      const testWidth = font.widthOfTextAtSize(testLine, fontSize);
                      if (testWidth > maxTextWidth && currentLine) {
                        lines.push(currentLine);
                        currentLine = word;
                      } else {
                        currentLine = testLine;
                      }
                    }
                    if (currentLine) lines.push(currentLine);
                  }
                  
                  const lineHeight = fontSize * 1.2;
                  const totalTextHeight = lines.length * lineHeight;
                  
                  // Vertical alignment
                  let startY;
                  if (markup.verticalAlign === 'top') {
                    startY = y + h - padding - fontSize;
                  } else if (markup.verticalAlign === 'bottom') {
                    startY = y + padding + totalTextHeight - lineHeight;
                  } else { // center
                    startY = y + (h + totalTextHeight) / 2 - lineHeight;
                  }
                  
                  for (let i = 0; i < lines.length; i++) {
                    const lineY = startY - (i * lineHeight);
                    if (lineY < y) break;
                    
                    let lineX = x + padding;
                    const lineWidth = font.widthOfTextAtSize(lines[i], fontSize);
                    if (markup.textAlign === 'center') {
                      lineX = x + (w - lineWidth) / 2;
                    } else if (markup.textAlign === 'right') {
                      lineX = x + w - padding - lineWidth;
                    }
                    
                    page.drawText(lines[i], {
                      x: lineX,
                      y: lineY,
                      size: fontSize,
                      font: font,
                      color: rgb(textColor.r, textColor.g, textColor.b),
                      opacity: markup.opacity || 1
                    });
                  }
                }
              }
            } else if (markup.type === 'circle') {
              const cx = ((markup.startX + markup.endX) / 2) * pageWidth;
              const cy = pageHeight - (((markup.startY + markup.endY) / 2) * pageHeight);
              const rx = Math.abs(markup.endX - markup.startX) * pageWidth / 2;
              const ry = Math.abs(markup.endY - markup.startY) * pageHeight / 2;
              
              if (rx > 0 && ry > 0) {
                // Handle fill and stroke colors
                const hasFill = markup.fillColor && markup.fillColor !== 'none';
                const hasStroke = markup.color && markup.color !== 'none';
                
                let fillColor = undefined;
                if (hasFill) {
                  const fill = hexToRgb(markup.fillColor);
                  fillColor = rgb(fill.r, fill.g, fill.b);
                }
                
                // Get separate opacities
                const fillOpacity = markup.fillOpacity !== undefined ? markup.fillOpacity : (markup.opacity || 1);
                const strokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
                
                // Get dash array based on lineStyle
                let dashArray = undefined;
                const sw = strokeWidth;
                if (markup.lineStyle === 'dashed') {
                  dashArray = [sw * 6, sw * 4];
                } else if (markup.lineStyle === 'dotted') {
                  dashArray = [sw * 1.5, sw * 3];
                } else if (markup.lineStyle === 'dashdot') {
                  dashArray = [sw * 6, sw * 3, sw * 1.5, sw * 3];
                } else if (markup.lineStyle === 'longdash') {
                  dashArray = [sw * 12, sw * 4];
                }
                
                // Debug log
                console.log('Circle flatten:', { hasFill, hasStroke, fillOpacity, strokeOpacity, lineStyle: markup.lineStyle });
                
                // Draw fill first if present
                if (hasFill) {
                  page.drawEllipse({
                    x: cx, y: cy,
                    xScale: rx, yScale: ry,
                    color: fillColor,
                    opacity: fillOpacity
                  });
                }
                
                // Draw stroke - note: pdf-lib drawEllipse doesn't support dashArray for borders
                // For dashed circles, use SVG path
                if (hasStroke) {
                  if (dashArray) {
                    // Approximate ellipse with bezier curves for dashed stroke
                    // Using the standard 4-bezier approximation (kappa = 0.5522847498)
                    const k = 0.5522847498;
                    const ox = rx * k;
                    const oy = ry * k;
                    
                    // Build SVG-style path for the ellipse
                    const ellipsePath = 
                      `M ${cx} ${cy + ry} ` +
                      `C ${cx + ox} ${cy + ry} ${cx + rx} ${cy + oy} ${cx + rx} ${cy} ` +
                      `C ${cx + rx} ${cy - oy} ${cx + ox} ${cy - ry} ${cx} ${cy - ry} ` +
                      `C ${cx - ox} ${cy - ry} ${cx - rx} ${cy - oy} ${cx - rx} ${cy} ` +
                      `C ${cx - rx} ${cy + oy} ${cx - ox} ${cy + ry} ${cx} ${cy + ry}`;
                    
                    page.drawSvgPath(ellipsePath, {
                      borderColor: rgbColor,
                      borderWidth: strokeWidth,
                      borderOpacity: strokeOpacity,
                      borderDashArray: dashArray
                    });
                  } else {
                    // Solid stroke
                    page.drawEllipse({
                      x: cx, y: cy,
                      xScale: rx, yScale: ry,
                      borderColor: rgbColor,
                      borderWidth: strokeWidth,
                      borderOpacity: strokeOpacity
                    });
                  }
                }
                
                // Draw text inside circle if present
                if (markup.text && markup.text.trim()) {
                  const fontSize = Math.max(8, (markup.fontSize || 12) * (pageWidth / canvasWidth));
                  const textColor = markup.textColor ? hexToRgb(markup.textColor) : { r: 0, g: 0, b: 0 };
                  const padding = 4 * (pageWidth / canvasWidth);
                  
                  // For circles, use inscribed rectangle for text area
                  const textAreaW = rx * 1.4; // ~70% of diameter
                  const textAreaH = ry * 1.4;
                  
                  // Split text into lines that fit
                  const maxTextWidth = textAreaW - (padding * 2);
                  const lines = [];
                  const paragraphs = markup.text.split('\n');
                  
                  for (const para of paragraphs) {
                    const words = para.split(' ');
                    let currentLine = '';
                    for (const word of words) {
                      const testLine = currentLine ? currentLine + ' ' + word : word;
                      const testWidth = font.widthOfTextAtSize(testLine, fontSize);
                      if (testWidth > maxTextWidth && currentLine) {
                        lines.push(currentLine);
                        currentLine = word;
                      } else {
                        currentLine = testLine;
                      }
                    }
                    if (currentLine) lines.push(currentLine);
                  }
                  
                  const lineHeight = fontSize * 1.2;
                  const totalTextHeight = lines.length * lineHeight;
                  
                  // Center text vertically and horizontally in circle
                  let startY = cy + totalTextHeight / 2 - fontSize * 0.3;
                  
                  for (let i = 0; i < lines.length; i++) {
                    const lineY = startY - (i * lineHeight);
                    const lineWidth = font.widthOfTextAtSize(lines[i], fontSize);
                    let lineX = cx - lineWidth / 2; // Center horizontally
                    
                    if (markup.textAlign === 'left') {
                      lineX = cx - textAreaW / 2 + padding;
                    } else if (markup.textAlign === 'right') {
                      lineX = cx + textAreaW / 2 - padding - lineWidth;
                    }
                    
                    page.drawText(lines[i], {
                      x: lineX,
                      y: lineY,
                      size: fontSize,
                      font: font,
                      color: rgb(textColor.r, textColor.g, textColor.b),
                      opacity: markup.opacity || 1
                    });
                  }
                }
              }
            } else if (markup.type === 'arrow') {
              const x1 = markup.startX * pageWidth;
              const y1 = pageHeight - (markup.startY * pageHeight);
              const x2 = markup.endX * pageWidth;
              const y2 = pageHeight - (markup.endY * pageHeight);
              // Use strokeOpacity if available, fallback to general opacity
              const opacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
              
              const angle = Math.atan2(y2 - y1, x2 - x1);
              // Use arrowHeadSize from markup, fallback to 12
              const arrowLength = (markup.arrowHeadSize || 12) * (pageWidth / canvasWidth);
              const arrowAngle = Math.PI / 7; // Match frontend
              
              // Shorten line so it doesn't poke through arrowhead (matching frontend)
              const lineEndX = x2 - arrowLength * 0.7 * Math.cos(angle);
              const lineEndY = y2 - arrowLength * 0.7 * Math.sin(angle);
              
              // Draw main line (shortened)
              page.drawLine({
                start: { x: x1, y: y1 },
                end: { x: lineEndX, y: lineEndY },
                thickness: strokeWidth,
                color: rgbColor,
                opacity: opacity
              });
              
              // Calculate arrowhead points
              const ax1 = x2 - arrowLength * Math.cos(angle - arrowAngle);
              const ay1 = y2 - arrowLength * Math.sin(angle - arrowAngle);
              const ax2 = x2 - arrowLength * Math.cos(angle + arrowAngle);
              const ay2 = y2 - arrowLength * Math.sin(angle + arrowAngle);
              
              // Draw filled triangle arrowhead
              page.drawSvgPath(`M ${x2} ${y2} L ${ax1} ${ay1} L ${ax2} ${ay2} Z`, {
                color: rgbColor,
                opacity: opacity
              });
            } else if (markup.type === 'text') {
              // Support both old format (x, y) and new text box format (startX, startY, endX, endY)
              const isTextBox = markup.startX !== undefined && markup.endX !== undefined;
              const fontSize = Math.max(8, (markup.fontSize || 12) * (pageWidth / canvasWidth));
              
              if (isTextBox) {
                // New text box format
                const boxX = Math.min(markup.startX, markup.endX) * pageWidth;
                const boxY = pageHeight - (Math.max(markup.startY, markup.endY) * pageHeight);
                const boxW = Math.abs(markup.endX - markup.startX) * pageWidth;
                const boxH = Math.abs(markup.endY - markup.startY) * pageHeight;
                const opacity = markup.opacity || 1;
                
                // Draw fill background if specified
                if (markup.fillColor && markup.fillColor !== 'none') {
                  const fill = hexToRgb(markup.fillColor);
                  page.drawRectangle({
                    x: boxX, y: boxY, width: boxW, height: boxH,
                    color: rgb(fill.r, fill.g, fill.b),
                    opacity: opacity
                  });
                }
                
                // Draw border if specified
                if (markup.borderColor && markup.borderColor !== 'none') {
                  const border = hexToRgb(markup.borderColor);
                  page.drawRectangle({
                    x: boxX, y: boxY, width: boxW, height: boxH,
                    borderColor: rgb(border.r, border.g, border.b),
                    borderWidth: 1,
                    opacity: opacity
                  });
                }
                
                // Draw text with word wrap
                if (markup.text) {
                  const padding = 4 * (pageWidth / canvasWidth);
                  const textX = boxX + padding;
                  const textStartY = boxY + boxH - padding - fontSize;
                  
                  // Simple word wrap
                  const maxWidth = boxW - (padding * 2);
                  const lines = [];
                  const paragraphs = markup.text.split('\n');
                  
                  for (const para of paragraphs) {
                    const words = para.split(' ');
                    let currentLine = '';
                    
                    for (const word of words) {
                      const testLine = currentLine ? currentLine + ' ' + word : word;
                      const testWidth = font.widthOfTextAtSize(testLine, fontSize);
                      
                      if (testWidth > maxWidth && currentLine) {
                        lines.push(currentLine);
                        currentLine = word;
                      } else {
                        currentLine = testLine;
                      }
                    }
                    if (currentLine) lines.push(currentLine);
                  }
                  
                  // Draw each line
                  const lineHeight = fontSize * 1.2;
                  for (let i = 0; i < lines.length; i++) {
                    const lineY = textStartY - (i * lineHeight);
                    if (lineY < boxY) break;
                    
                    let lineX = textX;
                    if (markup.textAlign === 'center') {
                      const lineWidth = font.widthOfTextAtSize(lines[i], fontSize);
                      lineX = boxX + (boxW - lineWidth) / 2;
                    } else if (markup.textAlign === 'right') {
                      const lineWidth = font.widthOfTextAtSize(lines[i], fontSize);
                      lineX = boxX + boxW - padding - lineWidth;
                    }
                    
                    page.drawText(lines[i], {
                      x: lineX, y: lineY,
                      size: fontSize,
                      font: font,
                      color: rgbColor
                    });
                  }
                }
              } else if (markup.text) {
                // Old format - single position text (only if text exists)
                const x = markup.x * pageWidth;
                const y = pageHeight - (markup.y * pageHeight) - fontSize;
                
                page.drawText(markup.text, {
                  x, y,
                  size: fontSize,
                  font: font,
                  color: rgbColor
                });
              }
            } else if (markup.type === 'line') {
              // Simple line without arrowhead
              const x1 = markup.startX * pageWidth;
              const y1 = pageHeight - (markup.startY * pageHeight);
              const x2 = markup.endX * pageWidth;
              const y2 = pageHeight - (markup.endY * pageHeight);
              const lineOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
              
              page.drawLine({
                start: { x: x1, y: y1 },
                end: { x: x2, y: y2 },
                thickness: strokeWidth,
                color: rgbColor,
                opacity: lineOpacity
              });
            } else if (markup.type === 'note') {
              // For flattened mode, draw a sticky note icon with text
              const x = markup.x * pageWidth;
              const y = pageHeight - (markup.y * pageHeight);
              const opacity = markup.opacity || 1;
              
              // Draw note background
              page.drawRectangle({
                x: x - 12,
                y: y - 12,
                width: 24,
                height: 24,
                color: rgbColor,
                borderColor: rgb(0, 0, 0),
                borderWidth: 0.5,
                opacity: opacity
              });
              
              // If there's text, draw it next to the note
              if (markup.text) {
                const fontSize = 10;
                page.drawText(markup.text.substring(0, 50), {
                  x: x + 15,
                  y: y,
                  size: fontSize,
                  font: font,
                  color: rgb(0, 0, 0)
                });
              }
            } else if (markup.type === 'cloud') {
              // Draw cloud rectangle with bumpy edges using bezier curves
              const x = Math.min(markup.startX, markup.endX) * pageWidth;
              const y = pageHeight - (Math.max(markup.startY, markup.endY) * pageHeight);
              const w = Math.abs(markup.endX - markup.startX) * pageWidth;
              const h = Math.abs(markup.endY - markup.startY) * pageHeight;
              
              if (w > 0 && h > 0) {
                const arcSize = (markup.arcSize || 8) * (pageWidth / canvasWidth);
                const inverted = markup.inverted || false;
                
                const hasFill = markup.fillColor && markup.fillColor !== 'none';
                const hasStroke = markup.color && markup.color !== 'none';
                
                const cloudStrokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
                const cloudFillOpacity = markup.fillOpacity !== undefined ? markup.fillOpacity : (markup.opacity || 1);
                
                let dashArray = undefined;
                const sw = strokeWidth;
                if (markup.lineStyle === 'dashed') {
                  dashArray = [sw * 6, sw * 4];
                } else if (markup.lineStyle === 'dotted') {
                  dashArray = [sw * 1.5, sw * 3];
                } else if (markup.lineStyle === 'dashdot') {
                  dashArray = [sw * 6, sw * 3, sw * 1.5, sw * 3];
                } else if (markup.lineStyle === 'longdash') {
                  dashArray = [sw * 12, sw * 4];
                }
                
                // Generate cloud path using bezier curves for smooth arcs
                const kappa = 0.5522847498;
                
                // Build SVG-style path for the cloud shape
                let svgPath = '';
                let isFirst = true;
                
                const addCloudArcs = (startX, startY, endX, endY) => {
                  const edgeDx = endX - startX;
                  const edgeDy = endY - startY;
                  const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
                  if (edgeLen < 0.1) return;
                  
                  const numArcs = Math.max(1, Math.round(edgeLen / (arcSize * 2)));
                  const arcChordLen = edgeLen / numArcs;
                  const r = arcChordLen / 2;
                  
                  const ux = edgeDx / edgeLen;
                  const uy = edgeDy / edgeLen;
                  const px = inverted ? uy : -uy;
                  const py = inverted ? -ux : ux;
                  
                  for (let j = 0; j < numArcs; j++) {
                    const arcStartX = startX + edgeDx * (j / numArcs);
                    const arcStartY = startY + edgeDy * (j / numArcs);
                    const arcEndX = startX + edgeDx * ((j + 1) / numArcs);
                    const arcEndY = startY + edgeDy * ((j + 1) / numArcs);
                    
                    const cx = (arcStartX + arcEndX) / 2;
                    const cy = (arcStartY + arcEndY) / 2;
                    
                    const apexX = cx + r * px;
                    const apexY = cy + r * py;
                    
                    const cpDist = r * kappa;
                    
                    const cp1x = arcStartX + cpDist * px;
                    const cp1y = arcStartY + cpDist * py;
                    const cp2x = apexX - cpDist * ux;
                    const cp2y = apexY - cpDist * uy;
                    const cp3x = apexX + cpDist * ux;
                    const cp3y = apexY + cpDist * uy;
                    const cp4x = arcEndX + cpDist * px;
                    const cp4y = arcEndY + cpDist * py;
                    
                    if (isFirst) {
                      svgPath += `M ${arcStartX} ${arcStartY} `;
                      isFirst = false;
                    }
                    
                    svgPath += `C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${apexX} ${apexY} `;
                    svgPath += `C ${cp3x} ${cp3y} ${cp4x} ${cp4y} ${arcEndX} ${arcEndY} `;
                  }
                };
                
                // Generate arcs for all four edges
                addCloudArcs(x, y + h, x + w, y + h); // Top
                addCloudArcs(x + w, y + h, x + w, y); // Right
                addCloudArcs(x + w, y, x, y);         // Bottom
                addCloudArcs(x, y, x, y + h);         // Left
                
                svgPath += 'Z'; // Close path
                
                // Draw fill first if present
                if (hasFill) {
                  const fill = hexToRgb(markup.fillColor);
                  page.drawSvgPath(svgPath, {
                    color: rgb(fill.r, fill.g, fill.b),
                    opacity: cloudFillOpacity
                  });
                }
                
                // Draw stroke if present
                if (hasStroke) {
                  page.drawSvgPath(svgPath, {
                    borderColor: rgbColor,
                    borderWidth: strokeWidth,
                    borderOpacity: cloudStrokeOpacity,
                    borderDashArray: dashArray
                  });
                }
                
                console.log('Cloud flatten: fill:', hasFill, ', stroke:', hasStroke);
              }
            } else if (markup.type === 'callout') {
              // Draw callout as rectangle with text
              const x = Math.min(markup.startX, markup.endX) * pageWidth;
              const y = pageHeight - (Math.max(markup.startY, markup.endY) * pageHeight);
              const w = Math.abs(markup.endX - markup.startX) * pageWidth;
              const h = Math.abs(markup.endY - markup.startY) * pageHeight;
              const opacity = markup.opacity || 1;
              
              if (w > 0 && h > 0) {
                // Draw background
                page.drawRectangle({
                  x, y, width: w, height: h,
                  color: rgb(1, 1, 1),
                  borderColor: rgbColor,
                  borderWidth: strokeWidth,
                  opacity: opacity
                });
                
                // Draw text if present
                if (markup.text) {
                  page.drawText(markup.text.substring(0, 100), {
                    x: x + 5,
                    y: y + h - 15,
                    size: 10,
                    font: font,
                    color: rgbColor,
                    opacity: opacity
                  });
                }
              }
            } else if (markup.type === 'polyline' || markup.type === 'polylineArrow' || markup.type === 'cloudPolyline' || markup.type === 'polygon') {
              // Draw polyline/polygon as connected lines
              if (markup.points && markup.points.length >= 2) {
                
                // Check for fill and stroke
                const hasFill = markup.fillColor && markup.fillColor !== 'none' && markup.closed;
                const hasStroke = markup.color && markup.color !== 'none';
                
                // Get separate opacities
                const polyStrokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
                const polyFillOpacity = markup.fillOpacity !== undefined ? markup.fillOpacity : (markup.opacity || 1);
                
                // Get dash array based on lineStyle
                let dashArray = undefined;
                const sw = strokeWidth;
                if (markup.lineStyle === 'dashed') {
                  dashArray = [sw * 6, sw * 4];
                } else if (markup.lineStyle === 'dotted') {
                  dashArray = [sw * 1.5, sw * 3];
                } else if (markup.lineStyle === 'dashdot') {
                  dashArray = [sw * 6, sw * 3, sw * 1.5, sw * 3];
                } else if (markup.lineStyle === 'longdash') {
                  dashArray = [sw * 12, sw * 4];
                }
                
                // Convert points to absolute coordinates
                const absPoints = markup.points.map(pt => ({
                  x: pt.x * pageWidth,
                  y: pageHeight - (pt.y * pageHeight)
                }));
                
                if (markup.type === 'cloudPolyline') {
                  console.log('>>> Processing cloudPolyline FLATTEN mode');
                  const arcSize = (markup.arcSize || 8) * (pageWidth / canvasWidth);
                  const kappa = 0.5522847498;
                  
                  // Build SVG path for cloud polyline
                  let svgPath = '';
                  let isFirst = true;
                  
                  const numEdges = markup.closed ? absPoints.length : absPoints.length - 1;
                  
                  for (let i = 0; i < numEdges; i++) {
                    const p1 = absPoints[i];
                    const p2 = absPoints[(i + 1) % absPoints.length];
                    
                    const edgeDx = p2.x - p1.x;
                    const edgeDy = p2.y - p1.y;
                    const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
                    
                    if (edgeLen < 0.1) continue;
                    
                    const numArcs = Math.max(1, Math.round(edgeLen / (arcSize * 2)));
                    const arcChordLen = edgeLen / numArcs;
                    const r = arcChordLen / 2;
                    
                    const ux = edgeDx / edgeLen;
                    const uy = edgeDy / edgeLen;
                    const px = -uy;
                    const py = ux;
                    
                    for (let j = 0; j < numArcs; j++) {
                      const arcStartX = p1.x + edgeDx * (j / numArcs);
                      const arcStartY = p1.y + edgeDy * (j / numArcs);
                      const arcEndX = p1.x + edgeDx * ((j + 1) / numArcs);
                      const arcEndY = p1.y + edgeDy * ((j + 1) / numArcs);
                      
                      const cx = (arcStartX + arcEndX) / 2;
                      const cy = (arcStartY + arcEndY) / 2;
                      const apexX = cx + r * px;
                      const apexY = cy + r * py;
                      
                      const cpDist = r * kappa;
                      const cp1x = arcStartX + cpDist * px;
                      const cp1y = arcStartY + cpDist * py;
                      const cp2x = apexX - cpDist * ux;
                      const cp2y = apexY - cpDist * uy;
                      const cp3x = apexX + cpDist * ux;
                      const cp3y = apexY + cpDist * uy;
                      const cp4x = arcEndX + cpDist * px;
                      const cp4y = arcEndY + cpDist * py;
                      
                      if (isFirst) {
                        svgPath += `M ${arcStartX} ${arcStartY} `;
                        isFirst = false;
                      }
                      
                      svgPath += `C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${apexX} ${apexY} `;
                      svgPath += `C ${cp3x} ${cp3y} ${cp4x} ${cp4y} ${arcEndX} ${arcEndY} `;
                    }
                  }
                  
                  if (markup.closed) svgPath += 'Z';
                  
                  // Draw fill first if present
                  if (hasFill) {
                    const fill = hexToRgb(markup.fillColor);
                    page.drawSvgPath(svgPath, {
                      color: rgb(fill.r, fill.g, fill.b),
                      opacity: polyFillOpacity
                    });
                  }
                  
                  // Draw stroke
                  if (hasStroke) {
                    page.drawSvgPath(svgPath, {
                      borderColor: rgbColor,
                      borderWidth: strokeWidth,
                      borderOpacity: polyStrokeOpacity,
                      borderDashArray: dashArray
                    });
                  }
                } else {
                  // Regular polyline/polygon - straight lines
                  // Build SVG path
                  let svgPath = `M ${absPoints[0].x} ${absPoints[0].y} `;
                  for (let i = 1; i < absPoints.length; i++) {
                    svgPath += `L ${absPoints[i].x} ${absPoints[i].y} `;
                  }
                  if (markup.closed) svgPath += 'Z';
                  
                  // Draw fill first if present (only for closed polygons)
                  if (hasFill) {
                    const fill = hexToRgb(markup.fillColor);
                    page.drawSvgPath(svgPath, {
                      color: rgb(fill.r, fill.g, fill.b),
                      opacity: polyFillOpacity
                    });
                  }
                  
                  // Draw stroke
                  if (hasStroke) {
                    page.drawSvgPath(svgPath, {
                      borderColor: rgbColor,
                      borderWidth: strokeWidth,
                      borderOpacity: polyStrokeOpacity,
                      borderDashArray: dashArray
                    });
                  }
                }
                
                // Draw arrowhead for polylineArrow
                if (markup.type === 'polylineArrow' && absPoints.length >= 2) {
                  const lastPt = absPoints[absPoints.length - 1];
                  const prevPt = absPoints[absPoints.length - 2];
                  
                  const angle = Math.atan2(lastPt.y - prevPt.y, lastPt.x - prevPt.x);
                  const arrowLength = (markup.arrowHeadSize || 12) * (pageWidth / canvasWidth);
                  const arrowAngle = Math.PI / 7;
                  
                  // Draw filled arrowhead using SVG path
                  // Arrowhead should use strokeOpacity to match the line (not fillOpacity which is for polygon fill)
                  const ax1 = lastPt.x - arrowLength * Math.cos(angle - arrowAngle);
                  const ay1 = lastPt.y - arrowLength * Math.sin(angle - arrowAngle);
                  const ax2 = lastPt.x - arrowLength * Math.cos(angle + arrowAngle);
                  const ay2 = lastPt.y - arrowLength * Math.sin(angle + arrowAngle);
                  
                  const arrowPath = `M ${lastPt.x} ${lastPt.y} L ${ax1} ${ay1} L ${ax2} ${ay2} Z`;
                  page.drawSvgPath(arrowPath, {
                    color: rgbColor,
                    opacity: polyStrokeOpacity  // Match line opacity, not fill opacity
                  });
                }
                
                console.log('Polyline/polygon flatten:', markup.type, ', fill:', hasFill, ', stroke:', hasStroke, ', closed:', markup.closed);
              }
            }
          } else {
            // ANNOTATION MODE: Create PDF annotation objects with appearance streams
            
            if (markup.type === 'rectangle') {
              const x1 = Math.min(markup.startX, markup.endX) * pageWidth;
              const y1 = pageHeight - (Math.max(markup.startY, markup.endY) * pageHeight);
              const x2 = Math.max(markup.startX, markup.endX) * pageWidth;
              const y2 = pageHeight - (Math.min(markup.startY, markup.endY) * pageHeight);
              const w = x2 - x1;
              const h = y2 - y1;
              
              // Check for fill and stroke
              const hasFill = markup.fillColor && markup.fillColor !== 'none';
              const hasStroke = markup.color && markup.color !== 'none';
              const hasText = markup.text && markup.text.trim();
              
              // Get dash pattern based on lineStyle
              let dashOp = '';
              let bsStyle = 'S'; // Solid
              const sw = strokeWidth;
              if (markup.lineStyle === 'dashed') {
                dashOp = `[${sw * 6} ${sw * 4}] 0 d `;
                bsStyle = 'D';
              } else if (markup.lineStyle === 'dotted') {
                dashOp = `[${sw * 1.5} ${sw * 3}] 0 d `;
                bsStyle = 'D';
              } else if (markup.lineStyle === 'dashdot') {
                dashOp = `[${sw * 6} ${sw * 3} ${sw * 1.5} ${sw * 3}] 0 d `;
                bsStyle = 'D';
              } else if (markup.lineStyle === 'longdash') {
                dashOp = `[${sw * 12} ${sw * 4}] 0 d `;
                bsStyle = 'D';
              }
              
              // Build appearance stream
              let apContent = 'q ';
              if (hasFill) {
                const fill = hexToRgb(markup.fillColor);
                apContent += `${fill.r} ${fill.g} ${fill.b} rg `;
              }
              if (hasStroke) {
                apContent += `${pdfColor[0]} ${pdfColor[1]} ${pdfColor[2]} RG ${strokeWidth} w ${dashOp}`;
              }
              apContent += `0 0 ${w} ${h} re `;
              if (hasFill && hasStroke) apContent += 'B ';
              else if (hasFill) apContent += 'f ';
              else if (hasStroke) apContent += 'S ';
              apContent += 'Q';
              
              // Add text to appearance stream if present
              if (hasText) {
                const fontSize = Math.max(8, (markup.fontSize || 12) * (pageWidth / canvasWidth));
                const textColor = markup.textColor ? hexToRgb(markup.textColor) : { r: 0, g: 0, b: 0 };
                const padding = 4 * (pageWidth / canvasWidth);
                
                // Word wrap text
                const maxTextWidth = w - (padding * 2);
                const lines = [];
                const paragraphs = markup.text.split('\n');
                for (const para of paragraphs) {
                  const words = para.split(' ');
                  let currentLine = '';
                  for (const word of words) {
                    const testLine = currentLine ? currentLine + ' ' + word : word;
                    const testWidth = testLine.length * fontSize * 0.5;
                    if (testWidth > maxTextWidth && currentLine) {
                      lines.push(currentLine);
                      currentLine = word;
                    } else {
                      currentLine = testLine;
                    }
                  }
                  if (currentLine) lines.push(currentLine);
                }
                
                const lineHeight = fontSize * 1.2;
                const totalTextHeight = lines.length * lineHeight;
                
                // Calculate starting Y based on vertical alignment
                let startY;
                if (markup.verticalAlign === 'top') {
                  startY = h - padding - fontSize;
                } else if (markup.verticalAlign === 'bottom') {
                  startY = padding + totalTextHeight - lineHeight;
                } else { // center
                  startY = (h + totalTextHeight) / 2 - lineHeight;
                }
                
                apContent += ` BT /Helv ${fontSize} Tf ${textColor.r} ${textColor.g} ${textColor.b} rg `;
                for (let i = 0; i < lines.length; i++) {
                  const lineY = startY - (i * lineHeight);
                  if (lineY < 0) break;
                  
                  let lineX = padding;
                  const lineWidth = lines[i].length * fontSize * 0.5;
                  if (markup.textAlign === 'center') {
                    lineX = (w - lineWidth) / 2;
                  } else if (markup.textAlign === 'right') {
                    lineX = w - padding - lineWidth;
                  }
                  
                  const escapedLine = lines[i].replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
                  apContent += `${lineX} ${lineY} Td (${escapedLine}) Tj `;
                  if (i < lines.length - 1) {
                    apContent += `${-lineX} ${-lineHeight} Td `;
                  }
                }
                apContent += 'ET';
              }
              
              // If there's text, we need font resources
              const extraResources = hasText ? {
                Font: context.obj({
                  Helv: context.obj({
                    Type: PDFName.of('Font'),
                    Subtype: PDFName.of('Type1'),
                    BaseFont: PDFName.of('Helvetica'),
                  })
                })
              } : {};
              
              // Get separate stroke and fill opacities
              const rectStrokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
              const rectFillOpacity = markup.fillOpacity !== undefined ? markup.fillOpacity : (markup.opacity || 1);
              
              const annotRef = createAnnotWithAP('Square', [x1, y1, x2, y2], hasStroke ? pdfColor : [0,0,0], strokeWidth, apContent, {
                BS: context.obj({ W: PDFNumber.of(hasStroke ? strokeWidth : 0), S: PDFName.of(bsStyle) }),
                Contents: hasText ? PDFString.of(markup.text) : undefined
              }, { stroke: rectStrokeOpacity, fill: rectFillOpacity }, extraResources);
              annotsArray.push(annotRef);
              console.log('Added Square annotation with AP' + (hasText ? ' and text' : '') + ', strokeOpacity:', rectStrokeOpacity, ', fillOpacity:', rectFillOpacity, ', lineStyle:', markup.lineStyle || 'solid');
              
            } else if (markup.type === 'circle') {
              const x1 = Math.min(markup.startX, markup.endX) * pageWidth;
              const y1 = pageHeight - (Math.max(markup.startY, markup.endY) * pageHeight);
              const x2 = Math.max(markup.startX, markup.endX) * pageWidth;
              const y2 = pageHeight - (Math.min(markup.startY, markup.endY) * pageHeight);
              const w = x2 - x1;
              const h = y2 - y1;
              const cx = w / 2;
              const cy = h / 2;
              const rx = w / 2;
              const ry = h / 2;
              
              // Check for fill, stroke, and text
              const hasFill = markup.fillColor && markup.fillColor !== 'none';
              const hasStroke = markup.color && markup.color !== 'none';
              const hasText = markup.text && markup.text.trim();
              
              // Get dash pattern based on lineStyle
              let dashOp = '';
              let bsStyle = 'S'; // Solid
              const sw = strokeWidth;
              if (markup.lineStyle === 'dashed') {
                dashOp = `[${sw * 6} ${sw * 4}] 0 d `;
                bsStyle = 'D';
              } else if (markup.lineStyle === 'dotted') {
                dashOp = `[${sw * 1.5} ${sw * 3}] 0 d `;
                bsStyle = 'D';
              } else if (markup.lineStyle === 'dashdot') {
                dashOp = `[${sw * 6} ${sw * 3} ${sw * 1.5} ${sw * 3}] 0 d `;
                bsStyle = 'D';
              } else if (markup.lineStyle === 'longdash') {
                dashOp = `[${sw * 12} ${sw * 4}] 0 d `;
                bsStyle = 'D';
              }
              
              // Bezier curve approximation for ellipse (kappa = 0.5522847498)
              const k = 0.5522847498;
              const ox = rx * k;
              const oy = ry * k;
              
              // Build appearance stream
              let apContent = 'q ';
              if (hasFill) {
                const fill = hexToRgb(markup.fillColor);
                apContent += `${fill.r} ${fill.g} ${fill.b} rg `;
              }
              if (hasStroke) {
                apContent += `${pdfColor[0]} ${pdfColor[1]} ${pdfColor[2]} RG ${strokeWidth} w ${dashOp}`;
              }
              
              // Ellipse path
              apContent += `${cx} ${cy + ry} m ` +
                `${cx + ox} ${cy + ry} ${cx + rx} ${cy + oy} ${cx + rx} ${cy} c ` +
                `${cx + rx} ${cy - oy} ${cx + ox} ${cy - ry} ${cx} ${cy - ry} c ` +
                `${cx - ox} ${cy - ry} ${cx - rx} ${cy - oy} ${cx - rx} ${cy} c ` +
                `${cx - rx} ${cy + oy} ${cx - ox} ${cy + ry} ${cx} ${cy + ry} c `;
              
              if (hasFill && hasStroke) apContent += 'B ';
              else if (hasFill) apContent += 'f ';
              else if (hasStroke) apContent += 'S ';
              apContent += 'Q';
              
              // Add text to appearance stream if present
              if (hasText) {
                const fontSize = Math.max(8, (markup.fontSize || 12) * (pageWidth / canvasWidth));
                const textColor = markup.textColor ? hexToRgb(markup.textColor) : { r: 0, g: 0, b: 0 };
                const padding = 4 * (pageWidth / canvasWidth);
                
                // For circles, use inscribed area for text
                const textAreaW = rx * 1.4;
                
                // Word wrap text
                const lines = [];
                const paragraphs = markup.text.split('\n');
                for (const para of paragraphs) {
                  const words = para.split(' ');
                  let currentLine = '';
                  for (const word of words) {
                    const testLine = currentLine ? currentLine + ' ' + word : word;
                    const testWidth = testLine.length * fontSize * 0.5;
                    if (testWidth > textAreaW && currentLine) {
                      lines.push(currentLine);
                      currentLine = word;
                    } else {
                      currentLine = testLine;
                    }
                  }
                  if (currentLine) lines.push(currentLine);
                }
                
                const lineHeight = fontSize * 1.2;
                const totalTextHeight = lines.length * lineHeight;
                
                // Center text vertically in circle
                let startY = cy + totalTextHeight / 2 - fontSize * 0.3;
                
                apContent += ` BT /Helv ${fontSize} Tf ${textColor.r} ${textColor.g} ${textColor.b} rg `;
                for (let i = 0; i < lines.length; i++) {
                  const lineY = startY - (i * lineHeight);
                  const lineWidth = lines[i].length * fontSize * 0.5;
                  let lineX = cx - lineWidth / 2; // Center horizontally
                  
                  if (markup.textAlign === 'left') {
                    lineX = cx - textAreaW / 2 + padding;
                  } else if (markup.textAlign === 'right') {
                    lineX = cx + textAreaW / 2 - padding - lineWidth;
                  }
                  
                  const escapedLine = lines[i].replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
                  apContent += `${lineX} ${lineY} Td (${escapedLine}) Tj `;
                  if (i < lines.length - 1) {
                    apContent += `${-lineX} ${-lineHeight} Td `;
                  }
                }
                apContent += 'ET';
              }
              
              // If there's text, we need font resources
              const extraResources = hasText ? {
                Font: context.obj({
                  Helv: context.obj({
                    Type: PDFName.of('Font'),
                    Subtype: PDFName.of('Type1'),
                    BaseFont: PDFName.of('Helvetica'),
                  })
                })
              } : {};
              
              // Get separate stroke and fill opacities
              const circleStrokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
              const circleFillOpacity = markup.fillOpacity !== undefined ? markup.fillOpacity : (markup.opacity || 1);
              
              const annotRef = createAnnotWithAP('Circle', [x1, y1, x2, y2], hasStroke ? pdfColor : [0,0,0], strokeWidth, apContent, {
                BS: context.obj({ W: PDFNumber.of(hasStroke ? strokeWidth : 0), S: PDFName.of(bsStyle) }),
                Contents: hasText ? PDFString.of(markup.text) : undefined
              }, { stroke: circleStrokeOpacity, fill: circleFillOpacity }, extraResources);
              annotsArray.push(annotRef);
              console.log('Added Circle annotation with AP' + (hasText ? ' and text' : '') + ', strokeOpacity:', circleStrokeOpacity, ', fillOpacity:', circleFillOpacity, ', lineStyle:', markup.lineStyle || 'solid');
              
            } else if (markup.type === 'arrow') {
              const ax1 = markup.startX * pageWidth;
              const ay1 = pageHeight - (markup.startY * pageHeight);
              const ax2 = markup.endX * pageWidth;
              const ay2 = pageHeight - (markup.endY * pageHeight);
              
              // Arrow parameters matching frontend - use markup's arrowHeadSize
              const angle = Math.atan2(ay2 - ay1, ax2 - ax1);
              const arrowLen = (markup.arrowHeadSize || 12) * (pageWidth / canvasWidth);
              const arrowAngle = Math.PI / 7;
              const arrowOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
              
              // Shorten line endpoint so it doesn't poke through arrowhead
              const lineEndX = ax2 - arrowLen * 0.7 * Math.cos(angle);
              const lineEndY = ay2 - arrowLen * 0.7 * Math.sin(angle);
              
              // Bounding rect with padding
              const padding = arrowLen + strokeWidth;
              const rectX1 = Math.min(ax1, ax2) - padding;
              const rectY1 = Math.min(ay1, ay2) - padding;
              const rectX2 = Math.max(ax1, ax2) + padding;
              const rectY2 = Math.max(ay1, ay2) + padding;
              const w = rectX2 - rectX1;
              const h = rectY2 - rectY1;
              
              // Convert to local coordinates (relative to bounding box)
              const lx1 = ax1 - rectX1;
              const ly1 = ay1 - rectY1;
              const lx2 = ax2 - rectX1;
              const ly2 = ay2 - rectY1;
              const lLineEndX = lineEndX - rectX1;
              const lLineEndY = lineEndY - rectY1;
              
              // Arrow head points in local coordinates
              const ahx1 = lx2 - arrowLen * Math.cos(angle - arrowAngle);
              const ahy1 = ly2 - arrowLen * Math.sin(angle - arrowAngle);
              const ahx2 = lx2 - arrowLen * Math.cos(angle + arrowAngle);
              const ahy2 = ly2 - arrowLen * Math.sin(angle + arrowAngle);
              
              // Get dash pattern based on lineStyle
              let dashOp = '';
              let bsStyle = 'S'; // Solid
              const sw = strokeWidth;
              if (markup.lineStyle === 'dashed') {
                dashOp = `[${sw * 6} ${sw * 4}] 0 d `;
                bsStyle = 'D';
              } else if (markup.lineStyle === 'dotted') {
                dashOp = `[${sw * 1.5} ${sw * 3}] 0 d `;
                bsStyle = 'D';
              } else if (markup.lineStyle === 'dashdot') {
                dashOp = `[${sw * 6} ${sw * 3} ${sw * 1.5} ${sw * 3}] 0 d `;
                bsStyle = 'D';
              } else if (markup.lineStyle === 'longdash') {
                dashOp = `[${sw * 12} ${sw * 4}] 0 d `;
                bsStyle = 'D';
              }
              
              // Appearance stream: draw shortened line, then filled triangle arrowhead
              const apContent = `q ` +
                // Draw the line (shortened) with optional dash
                `${pdfColor[0]} ${pdfColor[1]} ${pdfColor[2]} RG ${strokeWidth} w ${dashOp}` +
                `${lx1} ${ly1} m ${lLineEndX} ${lLineEndY} l S ` +
                // Draw filled triangle arrowhead (always solid)
                `[] 0 d ` +
                `${pdfColor[0]} ${pdfColor[1]} ${pdfColor[2]} rg ` +
                `${lx2} ${ly2} m ${ahx1} ${ahy1} l ${ahx2} ${ahy2} l h f ` +
                `Q`;
              
              const annotRef = createAnnotWithAP('Line', [rectX1, rectY1, rectX2, rectY2], pdfColor, strokeWidth, apContent, {
                L: context.obj([ax1, ay1, ax2, ay2]),
                LE: context.obj([PDFName.of('None'), PDFName.of('ClosedArrow')]),
                BS: context.obj({ W: PDFNumber.of(strokeWidth), S: PDFName.of(bsStyle) })
              }, { stroke: arrowOpacity, fill: arrowOpacity });
              annotsArray.push(annotRef);
              console.log('Added Line (arrow) annotation with AP, lineStyle:', markup.lineStyle || 'solid', ', arrowHeadSize:', markup.arrowHeadSize || 12, ', opacity:', arrowOpacity);
              
            } else if (markup.type === 'pen' || markup.type === 'highlighter') {
              if (markup.points && markup.points.length >= 2) {
                // Calculate bounds and convert points
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                const absPoints = [];
                
                for (const pt of markup.points) {
                  const x = pt.x * pageWidth;
                  const y = pageHeight - (pt.y * pageHeight);
                  absPoints.push({ x, y });
                  minX = Math.min(minX, x);
                  minY = Math.min(minY, y);
                  maxX = Math.max(maxX, x);
                  maxY = Math.max(maxY, y);
                }
                
                const padding = strokeWidth * 2;
                const rectX1 = minX - padding;
                const rectY1 = minY - padding;
                const rectX2 = maxX + padding;
                const rectY2 = maxY + padding;
                const w = rectX2 - rectX1;
                const h = rectY2 - rectY1;
                
                // Build ink list for annotation and path for appearance
                const inkList = [];
                let pathCommands = '';
                for (let i = 0; i < absPoints.length; i++) {
                  const pt = absPoints[i];
                  inkList.push(PDFNumber.of(pt.x));
                  inkList.push(PDFNumber.of(pt.y));
                  
                  // Local coordinates for appearance
                  const lx = pt.x - rectX1;
                  const ly = pt.y - rectY1;
                  if (i === 0) {
                    pathCommands += `${lx} ${ly} m `;
                  } else {
                    pathCommands += `${lx} ${ly} l `;
                  }
                }
                
                const opacity = markup.type === 'highlighter' ? (markup.opacity || 0.4) : (markup.opacity || 1);
                
                // Build appearance stream content - include ExtGState reference for transparency
                let apContent;
                if (opacity < 1) {
                  // For transparency, reference the ExtGState defined in Resources
                  apContent = `q /GS0 gs ${pdfColor[0]} ${pdfColor[1]} ${pdfColor[2]} RG ${strokeWidth} w ${pathCommands}S Q`;
                } else {
                  apContent = `q ${pdfColor[0]} ${pdfColor[1]} ${pdfColor[2]} RG ${strokeWidth} w ${pathCommands}S Q`;
                }
                
                const extraProps = {
                  InkList: context.obj([context.obj(inkList)]),
                  BS: context.obj({ W: PDFNumber.of(strokeWidth), S: PDFName.of('S') })
                };
                
                // Use object format for opacity consistency
                const annotRef = createAnnotWithAP('Ink', [rectX1, rectY1, rectX2, rectY2], pdfColor, strokeWidth, apContent, extraProps, { stroke: opacity, fill: 1 });
                annotsArray.push(annotRef);
                console.log('Added Ink annotation with AP,', markup.points.length, 'points, opacity:', opacity);
              }
              
            } else if (markup.type === 'text') {
              // Support both old format (x, y) and new text box format (startX, startY, endX, endY)
              const isTextBox = markup.startX !== undefined && markup.endX !== undefined;
              const fontSize = Math.max(8, (markup.fontSize || 12) * (pageWidth / canvasWidth));
              
              if (isTextBox) {
                // New text box format
                const boxX = Math.min(markup.startX, markup.endX) * pageWidth;
                const boxY = pageHeight - (Math.max(markup.startY, markup.endY) * pageHeight);
                const boxW = Math.abs(markup.endX - markup.startX) * pageWidth;
                const boxH = Math.abs(markup.endY - markup.startY) * pageHeight;
                
                const rectX1 = boxX;
                const rectY1 = boxY;
                const rectX2 = boxX + boxW;
                const rectY2 = boxY + boxH;
                
                // Build appearance stream
                let apContent = 'q ';
                
                // Fill background if specified
                if (markup.fillColor && markup.fillColor !== 'none') {
                  const fill = hexToRgb(markup.fillColor);
                  apContent += `${fill.r} ${fill.g} ${fill.b} rg 0 0 ${boxW} ${boxH} re f `;
                }
                
                // Border if specified
                if (markup.borderColor && markup.borderColor !== 'none') {
                  const border = hexToRgb(markup.borderColor);
                  apContent += `${border.r} ${border.g} ${border.b} RG 1 w 0 0 ${boxW} ${boxH} re S `;
                }
                
                // Draw text with word wrap
                const padding = 4 * (pageWidth / canvasWidth);
                const maxTextWidth = boxW - (padding * 2);
                const lines = [];
                const paragraphs = markup.text.split('\n');
                
                for (const para of paragraphs) {
                  const words = para.split(' ');
                  let currentLine = '';
                  
                  for (const word of words) {
                    const testLine = currentLine ? currentLine + ' ' + word : word;
                    // Approximate width (Helvetica avg char width ~0.5 of fontSize)
                    const testWidth = testLine.length * fontSize * 0.5;
                    
                    if (testWidth > maxTextWidth && currentLine) {
                      lines.push(currentLine);
                      currentLine = word;
                    } else {
                      currentLine = testLine;
                    }
                  }
                  if (currentLine) lines.push(currentLine);
                }
                
                // Add text to appearance stream
                apContent += `BT /Helv ${fontSize} Tf ${pdfColor[0]} ${pdfColor[1]} ${pdfColor[2]} rg `;
                
                const lineHeight = fontSize * 1.2;
                for (let i = 0; i < lines.length; i++) {
                  const lineY = boxH - padding - fontSize - (i * lineHeight);
                  if (lineY < 0) break;
                  
                  let lineX = padding;
                  if (markup.textAlign === 'center') {
                    const lineWidth = lines[i].length * fontSize * 0.5;
                    lineX = (boxW - lineWidth) / 2;
                  } else if (markup.textAlign === 'right') {
                    const lineWidth = lines[i].length * fontSize * 0.5;
                    lineX = boxW - padding - lineWidth;
                  }
                  
                  const escapedLine = lines[i].replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
                  apContent += `${lineX} ${lineY} Td (${escapedLine}) Tj `;
                  // Reset position for next line
                  if (i < lines.length - 1) {
                    apContent += `${-lineX} ${-lineHeight} Td `;
                  }
                }
                
                apContent += 'ET Q';
                
                // Create appearance stream with font resources
                const streamBytes = Buffer.from(apContent, 'utf8');
                
                const formDict = context.obj({
                  Type: PDFName.of('XObject'),
                  Subtype: PDFName.of('Form'),
                  FormType: PDFNumber.of(1),
                  BBox: context.obj([0, 0, boxW, boxH]),
                  Resources: context.obj({
                    Font: context.obj({
                      Helv: context.obj({
                        Type: PDFName.of('Font'),
                        Subtype: PDFName.of('Type1'),
                        BaseFont: PDFName.of('Helvetica'),
                      })
                    })
                  }),
                  Length: PDFNumber.of(streamBytes.length),
                });
                
                const apStream = context.stream(streamBytes, formDict);
                const apRef = context.register(apStream);
                
                // Store text data for re-import
                const textPosition = {
                  startX: markup.startX,
                  startY: markup.startY,
                  endX: markup.endX,
                  endY: markup.endY,
                  fontSize: markup.fontSize || 12,
                  textAlign: markup.textAlign || 'left',
                  fillColor: markup.fillColor || 'none',
                  borderColor: markup.borderColor || 'none'
                };
                
                const annotDict = context.obj({
                  Type: PDFName.of('Annot'),
                  Subtype: PDFName.of('FreeText'),
                  Rect: context.obj([rectX1, rectY1, rectX2, rectY2]),
                  C: context.obj(pdfColor),
                  Contents: PDFString.of(markup.text || ''),
                  DA: PDFString.of(`/Helv ${fontSize} Tf ${pdfColor[0]} ${pdfColor[1]} ${pdfColor[2]} rg`),
                  F: PDFNumber.of(4),
                  AP: context.obj({ N: apRef }),
                  // Store text box data for re-import
                  textPosition: PDFString.of(JSON.stringify(textPosition))
                });
                const annotRef = context.register(annotDict);
                annotsArray.push(annotRef);
                console.log('Added FreeText (text box) annotation with AP');
                
              } else if (markup.text) {
                // Old format - single position text (only if text exists)
                const x = markup.x * pageWidth;
                const y = pageHeight - (markup.y * pageHeight) - fontSize;
                const textWidth = markup.text.length * fontSize * 0.6;
                const textHeight = fontSize * 1.5;
                
                const rectX1 = x;
                const rectY1 = y - fontSize * 0.3;
                const rectX2 = x + textWidth + 10;
                const rectY2 = y + fontSize * 1.2;
                
                const escapedText = markup.text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
                
                const apContent = `q BT /Helv ${fontSize} Tf ${pdfColor[0]} ${pdfColor[1]} ${pdfColor[2]} rg 2 ${fontSize * 0.3} Td (${escapedText}) Tj ET Q`;
                
                const apWidth = rectX2 - rectX1;
                const apHeight = rectY2 - rectY1;
                const streamBytes = Buffer.from(apContent, 'utf8');
                
                const formDict = context.obj({
                  Type: PDFName.of('XObject'),
                  Subtype: PDFName.of('Form'),
                  FormType: PDFNumber.of(1),
                  BBox: context.obj([0, 0, apWidth, apHeight]),
                  Resources: context.obj({
                    Font: context.obj({
                      Helv: context.obj({
                        Type: PDFName.of('Font'),
                        Subtype: PDFName.of('Type1'),
                        BaseFont: PDFName.of('Helvetica'),
                      })
                    })
                  }),
                  Length: PDFNumber.of(streamBytes.length),
                });
                
                const apStream = context.stream(streamBytes, formDict);
                const apRef = context.register(apStream);
                
                const annotDict = context.obj({
                  Type: PDFName.of('Annot'),
                  Subtype: PDFName.of('FreeText'),
                  Rect: context.obj([rectX1, rectY1, rectX2, rectY2]),
                  C: context.obj(pdfColor),
                  Contents: PDFString.of(markup.text),
                  DA: PDFString.of(`/Helv ${fontSize} Tf ${pdfColor[0]} ${pdfColor[1]} ${pdfColor[2]} rg`),
                  F: PDFNumber.of(4),
                  AP: context.obj({ N: apRef }),
                });
                const annotRef = context.register(annotDict);
                annotsArray.push(annotRef);
                console.log('Added FreeText annotation with AP');
              }
            } else if (markup.type === 'line') {
              // Line annotation (no arrowhead)
              const lx1 = markup.startX * pageWidth;
              const ly1 = pageHeight - (markup.startY * pageHeight);
              const lx2 = markup.endX * pageWidth;
              const ly2 = pageHeight - (markup.endY * pageHeight);
              
              const padding = strokeWidth * 2;
              const rectX1 = Math.min(lx1, lx2) - padding;
              const rectY1 = Math.min(ly1, ly2) - padding;
              const rectX2 = Math.max(lx1, lx2) + padding;
              const rectY2 = Math.max(ly1, ly2) + padding;
              const w = rectX2 - rectX1;
              const h = rectY2 - rectY1;
              
              // Local coordinates
              const localX1 = lx1 - rectX1;
              const localY1 = ly1 - rectY1;
              const localX2 = lx2 - rectX1;
              const localY2 = ly2 - rectY1;
              
              // Get dash pattern based on lineStyle
              let dashOp = '';
              let bsStyle = 'S'; // Solid
              const sw = strokeWidth;
              if (markup.lineStyle === 'dashed') {
                dashOp = `[${sw * 6} ${sw * 4}] 0 d `;
                bsStyle = 'D';
              } else if (markup.lineStyle === 'dotted') {
                dashOp = `[${sw * 1.5} ${sw * 3}] 0 d `;
                bsStyle = 'D';
              } else if (markup.lineStyle === 'dashdot') {
                dashOp = `[${sw * 6} ${sw * 3} ${sw * 1.5} ${sw * 3}] 0 d `;
                bsStyle = 'D';
              } else if (markup.lineStyle === 'longdash') {
                dashOp = `[${sw * 12} ${sw * 4}] 0 d `;
                bsStyle = 'D';
              }
              
              const apContent = `q ${pdfColor[0]} ${pdfColor[1]} ${pdfColor[2]} RG ${strokeWidth} w ${dashOp}${localX1} ${localY1} m ${localX2} ${localY2} l S Q`;
              
              const lineOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
              const annotRef = createAnnotWithAP('Line', [rectX1, rectY1, rectX2, rectY2], pdfColor, strokeWidth, apContent, {
                L: context.obj([lx1, ly1, lx2, ly2]),
                BS: context.obj({ W: PDFNumber.of(strokeWidth), S: PDFName.of(bsStyle) })
              }, { stroke: lineOpacity, fill: 1 });
              annotsArray.push(annotRef);
              console.log('Added Line annotation with AP, lineStyle:', markup.lineStyle || 'solid', ', strokeOpacity:', lineOpacity);
              
            } else if (markup.type === 'note') {
              // Sticky note (Text annotation in PDF terms)
              const x = markup.x * pageWidth;
              const y = pageHeight - (markup.y * pageHeight);
              
              const annotDict = context.obj({
                Type: PDFName.of('Annot'),
                Subtype: PDFName.of('Text'),
                Rect: context.obj([x - 12, y - 12, x + 12, y + 12]),
                C: context.obj(pdfColor),
                Contents: PDFString.of(markup.text || ''),
                T: PDFString.of(markup.author || 'User'),
                Name: PDFName.of('Note'),
                F: PDFNumber.of(4),
                Open: context.obj(false),
              });
              const annotRef = context.register(annotDict);
              annotsArray.push(annotRef);
              console.log('Added Text (Note) annotation');
              
            } else if (markup.type === 'cloud' || markup.type === 'callout') {
              // For cloud and callout, we use Square annotation with cloud effect or FreeText with callout
              const x1 = Math.min(markup.startX, markup.endX) * pageWidth;
              const y1 = pageHeight - (Math.max(markup.startY, markup.endY) * pageHeight);
              const x2 = Math.max(markup.startX, markup.endX) * pageWidth;
              const y2 = pageHeight - (Math.min(markup.startY, markup.endY) * pageHeight);
              const w = x2 - x1;
              const h = y2 - y1;
              
              if (markup.type === 'cloud') {
                // Cloud is rendered with bumpy semicircular arcs along each edge
                const arcSize = (markup.arcSize || 8) * (pageWidth / canvasWidth);
                const inverted = markup.inverted || false;
                
                const hasFill = markup.fillColor && markup.fillColor !== 'none';
                const hasStroke = markup.color && markup.color !== 'none';
                
                const cloudStrokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
                const cloudFillOpacity = markup.fillOpacity !== undefined ? markup.fillOpacity : (markup.opacity || 1);
                
                let dashOp = '';
                let bsStyle = 'S';
                const sw = strokeWidth;
                if (markup.lineStyle === 'dashed') {
                  dashOp = `[${sw * 6} ${sw * 4}] 0 d `;
                  bsStyle = 'D';
                } else if (markup.lineStyle === 'dotted') {
                  dashOp = `[${sw * 1.5} ${sw * 3}] 0 d `;
                  bsStyle = 'D';
                } else if (markup.lineStyle === 'dashdot') {
                  dashOp = `[${sw * 6} ${sw * 3} ${sw * 1.5} ${sw * 3}] 0 d `;
                  bsStyle = 'D';
                } else if (markup.lineStyle === 'longdash') {
                  dashOp = `[${sw * 12} ${sw * 4}] 0 d `;
                  bsStyle = 'D';
                }
                
                const padding = arcSize + strokeWidth;
                const expandedX1 = x1 - padding;
                const expandedY1 = y1 - padding;
                const expandedX2 = x2 + padding;
                const expandedY2 = y2 + padding;
                
                const offsetX = padding;
                const offsetY = padding;
                
                // Generate cloud arcs using bezier curves for smooth semicircles
                // Each arc is drawn as 2 cubic bezier curves for accuracy
                const kappa = 0.5522847498; // Magic number for circular arc approximation
                
                let pathCommands = '';
                let isFirst = true;
                
                const addCloudArcs = (startX, startY, endX, endY) => {
                  const edgeDx = endX - startX;
                  const edgeDy = endY - startY;
                  const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
                  if (edgeLen < 0.1) return;
                  
                  const numArcs = Math.max(1, Math.round(edgeLen / (arcSize * 2)));
                  const arcChordLen = edgeLen / numArcs;
                  const r = arcChordLen / 2; // Arc radius
                  
                  const ux = edgeDx / edgeLen;
                  const uy = edgeDy / edgeLen;
                  // Perpendicular direction (outward by default)
                  const px = inverted ? uy : -uy;
                  const py = inverted ? -ux : ux;
                  
                  for (let j = 0; j < numArcs; j++) {
                    // Arc goes from arcStart to arcEnd along the edge
                    const arcStartX = startX + edgeDx * (j / numArcs);
                    const arcStartY = startY + edgeDy * (j / numArcs);
                    const arcEndX = startX + edgeDx * ((j + 1) / numArcs);
                    const arcEndY = startY + edgeDy * ((j + 1) / numArcs);
                    
                    // Center of the chord
                    const cx = (arcStartX + arcEndX) / 2;
                    const cy = (arcStartY + arcEndY) / 2;
                    
                    // Apex of the arc (perpendicular to edge at radius distance)
                    const apexX = cx + r * px;
                    const apexY = cy + r * py;
                    
                    // For a semicircle, we need 2 bezier curves (each covering 90 degrees)
                    // Control point distance for 90-degree arc: r * kappa
                    const cpDist = r * kappa;
                    
                    // First bezier: from arcStart to apex
                    // Control point 1: perpendicular from arcStart
                    const cp1x = arcStartX + cpDist * px;
                    const cp1y = arcStartY + cpDist * py;
                    // Control point 2: along edge direction from apex
                    const cp2x = apexX - cpDist * ux;
                    const cp2y = apexY - cpDist * uy;
                    
                    // Second bezier: from apex to arcEnd
                    // Control point 3: along edge direction from apex
                    const cp3x = apexX + cpDist * ux;
                    const cp3y = apexY + cpDist * uy;
                    // Control point 4: perpendicular from arcEnd
                    const cp4x = arcEndX + cpDist * px;
                    const cp4y = arcEndY + cpDist * py;
                    
                    if (isFirst) {
                      pathCommands += `${arcStartX.toFixed(2)} ${arcStartY.toFixed(2)} m `;
                      isFirst = false;
                    }
                    
                    // First bezier curve (arcStart to apex)
                    pathCommands += `${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${apexX.toFixed(2)} ${apexY.toFixed(2)} c `;
                    // Second bezier curve (apex to arcEnd)
                    pathCommands += `${cp3x.toFixed(2)} ${cp3y.toFixed(2)} ${cp4x.toFixed(2)} ${cp4y.toFixed(2)} ${arcEndX.toFixed(2)} ${arcEndY.toFixed(2)} c `;
                  }
                };
                
                // Generate arcs for all four edges
                addCloudArcs(offsetX, offsetY + h, offsetX + w, offsetY + h); // Top
                addCloudArcs(offsetX + w, offsetY + h, offsetX + w, offsetY); // Right
                addCloudArcs(offsetX + w, offsetY, offsetX, offsetY);         // Bottom
                addCloudArcs(offsetX, offsetY, offsetX, offsetY + h);         // Left
                
                pathCommands += 'h '; // Close path
                
                // Build appearance stream
                let apContent = 'q ';
                
                if (hasFill) {
                  const fill = hexToRgb(markup.fillColor);
                  apContent += `${fill.r} ${fill.g} ${fill.b} rg `;
                }
                
                if (hasStroke) {
                  apContent += `${pdfColor[0]} ${pdfColor[1]} ${pdfColor[2]} RG ${strokeWidth} w ${dashOp}`;
                }
                
                apContent += pathCommands;
                
                if (hasFill && hasStroke) {
                  apContent += 'B ';
                } else if (hasFill) {
                  apContent += 'f ';
                } else if (hasStroke) {
                  apContent += 'S ';
                }
                
                apContent += 'Q';
                
                const vertices = [
                  PDFNumber.of(x1), PDFNumber.of(y1 + h),
                  PDFNumber.of(x1 + w), PDFNumber.of(y1 + h),
                  PDFNumber.of(x1 + w), PDFNumber.of(y1),
                  PDFNumber.of(x1), PDFNumber.of(y1)
                ];
                
                const extraProps = {
                  IT: PDFName.of('PolygonCloud'),
                  Vertices: context.obj(vertices),
                  BS: context.obj({ W: PDFNumber.of(strokeWidth), S: PDFName.of(bsStyle) })
                };
                
                if (hasFill) {
                  const fill = hexToRgb(markup.fillColor);
                  extraProps.IC = context.obj([fill.r, fill.g, fill.b]);
                }
                
                const annotRef = createAnnotWithAP('Polygon', [expandedX1, expandedY1, expandedX2, expandedY2], pdfColor, strokeWidth, apContent, extraProps, { stroke: cloudStrokeOpacity, fill: cloudFillOpacity });
                annotsArray.push(annotRef);
                console.log('Added Cloud annotation with bezier arcs, fill:', hasFill, ', stroke:', hasStroke);
              } else {
                // Callout is a FreeText with callout line
                const apContent = `q ${pdfColor[0]} ${pdfColor[1]} ${pdfColor[2]} RG ${strokeWidth} w 0 0 ${w} ${h} re S Q`;
                
                const annotRef = createAnnotWithAP('FreeText', [x1, y1, x2, y2], pdfColor, strokeWidth, apContent, {
                  IT: PDFName.of('FreeTextCallout'),
                  BS: context.obj({ W: PDFNumber.of(strokeWidth), S: PDFName.of('S') }),
                  Contents: PDFString.of(markup.text || '')
                });
                annotsArray.push(annotRef);
                console.log('Added FreeText (Callout) annotation');
              }
              
            } else if (markup.type === 'polyline' || markup.type === 'polylineArrow' || markup.type === 'cloudPolyline' || markup.type === 'polygon') {
              // Polyline/Polygon annotation
              if (markup.points && markup.points.length >= 2) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                const absPoints = [];
                
                for (const pt of markup.points) {
                  const x = pt.x * pageWidth;
                  const y = pageHeight - (pt.y * pageHeight);
                  absPoints.push({ x, y });
                  minX = Math.min(minX, x);
                  minY = Math.min(minY, y);
                  maxX = Math.max(maxX, x);
                  maxY = Math.max(maxY, y);
                }
                
                // Check for fill and stroke
                const hasFill = markup.fillColor && markup.fillColor !== 'none' && markup.closed;
                const hasStroke = markup.color && markup.color !== 'none';
                
                console.log(`>>> Annotation mode polyline/polygon: type=${markup.type}, hasFill=${hasFill}, fillColor=${markup.fillColor}, closed=${markup.closed}, hasStroke=${hasStroke}`);
                
                // Get separate opacities
                const polyStrokeOpacity = markup.strokeOpacity !== undefined ? markup.strokeOpacity : (markup.opacity || 1);
                const polyFillOpacity = markup.fillOpacity !== undefined ? markup.fillOpacity : (markup.opacity || 1);
                
                // Get dash pattern based on lineStyle
                let dashOp = '';
                let bsStyle = 'S';
                const sw = strokeWidth;
                if (markup.lineStyle === 'dashed') {
                  dashOp = `[${sw * 6} ${sw * 4}] 0 d `;
                  bsStyle = 'D';
                } else if (markup.lineStyle === 'dotted') {
                  dashOp = `[${sw * 1.5} ${sw * 3}] 0 d `;
                  bsStyle = 'D';
                } else if (markup.lineStyle === 'dashdot') {
                  dashOp = `[${sw * 6} ${sw * 3} ${sw * 1.5} ${sw * 3}] 0 d `;
                  bsStyle = 'D';
                } else if (markup.lineStyle === 'longdash') {
                  dashOp = `[${sw * 12} ${sw * 4}] 0 d `;
                  bsStyle = 'D';
                }
                
                const padding = strokeWidth * 2 + (markup.type === 'cloudPolyline' ? ((markup.arcSize || 8) * (pageWidth / canvasWidth)) : 0);
                const rectX1 = minX - padding;
                const rectY1 = minY - padding;
                const rectX2 = maxX + padding;
                const rectY2 = maxY + padding;
                
                // Build vertices array for PDF annotation
                const vertices = [];
                for (let i = 0; i < absPoints.length; i++) {
                  vertices.push(PDFNumber.of(absPoints[i].x));
                  vertices.push(PDFNumber.of(absPoints[i].y));
                }
                
                // Build path commands
                let pathCommands = '';
                
                if (markup.type === 'cloudPolyline') {
                  // Generate cloud bumps using bezier curves
                  const arcSize = (markup.arcSize || 8) * (pageWidth / canvasWidth);
                  const kappa = 0.5522847498;
                  const numEdges = markup.closed ? absPoints.length : absPoints.length - 1;
                  let isFirst = true;
                  
                  for (let i = 0; i < numEdges; i++) {
                    const p1 = absPoints[i];
                    const p2 = absPoints[(i + 1) % absPoints.length];
                    
                    const lx1 = p1.x - rectX1;
                    const ly1 = p1.y - rectY1;
                    const lx2 = p2.x - rectX1;
                    const ly2 = p2.y - rectY1;
                    
                    const edgeDx = lx2 - lx1;
                    const edgeDy = ly2 - ly1;
                    const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
                    
                    if (edgeLen < 0.1) continue;
                    
                    const numArcs = Math.max(1, Math.round(edgeLen / (arcSize * 2)));
                    const arcChordLen = edgeLen / numArcs;
                    const r = arcChordLen / 2;
                    
                    const ux = edgeDx / edgeLen;
                    const uy = edgeDy / edgeLen;
                    const px = -uy;
                    const py = ux;
                    
                    for (let j = 0; j < numArcs; j++) {
                      const arcStartX = lx1 + edgeDx * (j / numArcs);
                      const arcStartY = ly1 + edgeDy * (j / numArcs);
                      const arcEndX = lx1 + edgeDx * ((j + 1) / numArcs);
                      const arcEndY = ly1 + edgeDy * ((j + 1) / numArcs);
                      
                      const cx = (arcStartX + arcEndX) / 2;
                      const cy = (arcStartY + arcEndY) / 2;
                      const apexX = cx + r * px;
                      const apexY = cy + r * py;
                      
                      const cpDist = r * kappa;
                      const cp1x = arcStartX + cpDist * px;
                      const cp1y = arcStartY + cpDist * py;
                      const cp2x = apexX - cpDist * ux;
                      const cp2y = apexY - cpDist * uy;
                      const cp3x = apexX + cpDist * ux;
                      const cp3y = apexY + cpDist * uy;
                      const cp4x = arcEndX + cpDist * px;
                      const cp4y = arcEndY + cpDist * py;
                      
                      if (isFirst) {
                        pathCommands += `${arcStartX.toFixed(2)} ${arcStartY.toFixed(2)} m `;
                        isFirst = false;
                      }
                      
                      pathCommands += `${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${apexX.toFixed(2)} ${apexY.toFixed(2)} c `;
                      pathCommands += `${cp3x.toFixed(2)} ${cp3y.toFixed(2)} ${cp4x.toFixed(2)} ${cp4y.toFixed(2)} ${arcEndX.toFixed(2)} ${arcEndY.toFixed(2)} c `;
                    }
                  }
                  
                  if (markup.closed) pathCommands += 'h ';
                } else {
                  // Regular polyline/polygon - straight lines
                  for (let i = 0; i < absPoints.length; i++) {
                    const lx = absPoints[i].x - rectX1;
                    const ly = absPoints[i].y - rectY1;
                    if (i === 0) {
                      pathCommands += `${lx} ${ly} m `;
                    } else {
                      pathCommands += `${lx} ${ly} l `;
                    }
                  }
                  
                  if (markup.closed) pathCommands += 'h ';
                }
                
                // Build appearance stream with fill and stroke
                let apContent = 'q ';
                
                if (hasFill) {
                  const fill = hexToRgb(markup.fillColor);
                  apContent += `${fill.r} ${fill.g} ${fill.b} rg `;
                }
                
                if (hasStroke) {
                  apContent += `${pdfColor[0]} ${pdfColor[1]} ${pdfColor[2]} RG ${strokeWidth} w ${dashOp}`;
                }
                
                apContent += pathCommands;
                
                // Fill and/or stroke
                if (hasFill && hasStroke) {
                  apContent += 'B ';
                } else if (hasFill) {
                  apContent += 'f ';
                } else if (hasStroke) {
                  apContent += 'S ';
                }
                
                // Add arrowhead for polylineArrow
                if (markup.type === 'polylineArrow' && absPoints.length >= 2) {
                  const lastPt = absPoints[absPoints.length - 1];
                  const prevPt = absPoints[absPoints.length - 2];
                  const angle = Math.atan2(lastPt.y - prevPt.y, lastPt.x - prevPt.x);
                  const arrowLength = (markup.arrowHeadSize || 12) * (pageWidth / canvasWidth);
                  const arrowAngle = Math.PI / 7;
                  
                  const ax1 = lastPt.x - arrowLength * Math.cos(angle - arrowAngle) - rectX1;
                  const ay1 = lastPt.y - arrowLength * Math.sin(angle - arrowAngle) - rectY1;
                  const ax2 = lastPt.x - arrowLength * Math.cos(angle + arrowAngle) - rectX1;
                  const ay2 = lastPt.y - arrowLength * Math.sin(angle + arrowAngle) - rectY1;
                  const tipX = lastPt.x - rectX1;
                  const tipY = lastPt.y - rectY1;
                  
                  apContent += `${pdfColor[0]} ${pdfColor[1]} ${pdfColor[2]} rg ${tipX} ${tipY} m ${ax1} ${ay1} l ${ax2} ${ay2} l h f `;
                }
                
                apContent += 'Q';
                
                // Use PolyLine for open paths, Polygon for closed
                const annotType = markup.closed ? 'Polygon' : 'PolyLine';
                
                // Build extra props
                const extraProps = {
                  Vertices: context.obj(vertices),
                  BS: context.obj({ W: PDFNumber.of(strokeWidth), S: PDFName.of(bsStyle) })
                };
                
                // Add interior color if fill is present
                if (hasFill) {
                  const fill = hexToRgb(markup.fillColor);
                  extraProps.IC = context.obj([fill.r, fill.g, fill.b]);
                }
                
                // For cloudPolyline, add IT (Intent) entry to mark as cloud
                // Use PolygonCloud for closed, PolyLineCloud for open
                if (markup.type === 'cloudPolyline') {
                  const itValue = markup.closed ? 'PolygonCloud' : 'PolyLineCloud';
                  extraProps.IT = PDFName.of(itValue);
                  console.log(`>>> cloudPolyline: Setting IT=${itValue}, closed=${markup.closed}`);
                }
                
                // For polylineArrow, the arrowhead is filled so we need fill opacity = stroke opacity
                // Otherwise the arrowhead would use polyFillOpacity which is wrong
                const isPolylineArrow = markup.type === 'polylineArrow';
                console.log(`>>> Creating ${annotType} annotation with extraProps:`, Object.keys(extraProps), 'IT=', extraProps.IT?.toString(), 'IC=', extraProps.IC?.toString());
                const annotRef = createAnnotWithAP(annotType, [rectX1, rectY1, rectX2, rectY2], pdfColor, strokeWidth, apContent, extraProps, { 
                  stroke: polyStrokeOpacity, 
                  fill: isPolylineArrow ? polyStrokeOpacity : polyFillOpacity 
                });
                annotsArray.push(annotRef);
                console.log(`Added ${annotType} annotation, fill:`, hasFill, ', stroke:', hasStroke, ', lineStyle:', markup.lineStyle || 'solid');
              }
            }
          }
        } catch (markupError) {
          console.error('Error processing markup:', markup.type, markupError.message);
          // Continue with other markups
        }
      }
    }
    
    console.log('Saving PDF document...');
    const pdfBytes = await pdfDoc.save();
    console.log('PDF saved, output size:', pdfBytes.length, 'bytes');
    
    if (pdfBytes.length < 100) {
      throw new Error('Generated PDF is too small, something went wrong');
    }
    
    // Check if saveInPlace is requested - overwrite the source file
    if (saveInPlace) {
      const outputPath = path.join(uploadsDir, pdfFilename);
      fs.writeFileSync(outputPath, pdfBytes);
      console.log('Saved annotations in place to:', outputPath);
      console.log('=== Save Markups Complete (in-place) ===');
      return res.json({ 
        success: true, 
        message: 'Saved annotations to file',
        filename: pdfFilename,
        size: pdfBytes.length
      });
    }
    
    // Otherwise, return as downloadable PDF
    const outputFilename = flatten 
      ? pdfFilename.replace('.pdf', '_flattened.pdf')
      : pdfFilename.replace('.pdf', '_annotated.pdf');
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBytes.length);
    res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}"`);
    res.send(Buffer.from(pdfBytes));
    
    console.log('=== Save Markups Complete ===');
    
  } catch (error) {
    console.error('Error saving markups:', error);
    res.status(500).json({ 
      error: 'Failed to save markups', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});
app.listen(PORT, () => {
  console.log(`\n=== SERVER STARTED (Cloud Fix v4 - expanded rect) ===`);
  console.log(`Backend server running on http://localhost:${PORT}`);
  console.log(`Ready to receive PDF uploads!`);
  console.log(`YOLO training endpoint: POST /api/train/yolo`);
  console.log(`Claude OCR endpoint: POST /api/ocr/claude`);
});
