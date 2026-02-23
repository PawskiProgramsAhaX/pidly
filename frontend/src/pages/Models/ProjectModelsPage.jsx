import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getProject, getModels, deleteModel, trainDetector, saveModel, captureRegion, runDetection, exportSingleModel } from '../../utils/storage';
import { DETECTOR_URL } from '../../utils/config';

// Hooks
import usePdfViewer from './hooks/usePdfViewer';

// Sidebars
import DocumentSidebar from './sidebars/DocumentSidebar';
import ModelsSidebar from './sidebars/ModelsSidebar';

// Panels
import TestPanel from './panels/TestPanel';
import TrainPanel from './panels/TrainPanel';

// Toolbars
import TrainingToolbar from './toolbars/TrainingToolbar';

// Dialogs
import SubclassDialog from './dialogs/SubclassDialog';
import ImportDialog from './dialogs/ImportDialog';

import './ProjectModelsPage.css';

export default function ProjectModelsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnToFile = location.state?.returnToFile || null;

  // ── Core state ─────────────────────────────────
  const [project, setProject] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [models, setModels] = useState([]);
  const [selectedItem, setSelectedItem] = useState('train');
  const [searchQuery, setSearchQuery] = useState('');

  // ── PDF / Document state ───────────────────────
  const [projectFiles, setProjectFiles] = useState([]);
  const [selectedPdf, setSelectedPdf] = useState(null);
  const [showDocSidebar, setShowDocSidebar] = useState(true);

  // PDF viewer hook
  const pdf = usePdfViewer();

  // ── Drawing state ──────────────────────────────
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState(null);
  const [currentRect, setCurrentRect] = useState(null);
  const [trainingBoxes, setTrainingBoxes] = useState([]);
  const [drawingShapeType, setDrawingShapeType] = useState('rectangle');
  const [pendingShape, setPendingShape] = useState(null);
  const [activeResizeHandle, setActiveResizeHandle] = useState(null);

  // ── Subclass region state ──────────────────────
  const [showSubclassDialog, setShowSubclassDialog] = useState(false);
  const [subclassRegions, setSubclassRegions] = useState({});
  const [subclassImageData, setSubclassImageData] = useState(null);
  const [subclassImageZoom, setSubclassImageZoom] = useState(1.0);
  const [isCapturingRegion, setIsCapturingRegion] = useState(false);

  // ── Training state ─────────────────────────────
  const [modelName, setModelName] = useState('');
  const [isTraining, setIsTraining] = useState(false);
  const [selectedClass, setSelectedClass] = useState('');
  const [projectClasses, setProjectClasses] = useState([]);
  const [trainingMode, setTrainingMode] = useState('separate');
  const [addToExistingModel, setAddToExistingModel] = useState(null);
  const [multiOrientation, setMultiOrientation] = useState(false);
  const [includeInverted, setIncludeInverted] = useState(false);

  // ── Import state ───────────────────────────────
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importData, setImportData] = useState(null);
  const [importError, setImportError] = useState(null);
  const [importMode, setImportMode] = useState('merge');

  // ── Test model state ───────────────────────────
  const [showTestPanel, setShowTestPanel] = useState(false);
  const [showTrainPanel, setShowTrainPanel] = useState(true);
  const [testConfidence, setTestConfidence] = useState(0.7);
  const [testOcrFormat, setTestOcrFormat] = useState('');
  const [testSubclassOcrFormats, setTestSubclassOcrFormats] = useState({});
  const [testResults, setTestResults] = useState([]);
  const [isTesting, setIsTesting] = useState(false);
  const [testModelId, setTestModelId] = useState(null);

  // ════════════════════════════════════════════════
  // Helpers
  // ════════════════════════════════════════════════

  const extractAllFiles = (folders, parentPath = '') => {
    let allFiles = [];
    (folders || []).forEach(folder => {
      const folderPath = parentPath ? `${parentPath} / ${folder.name}` : folder.name;
      (folder.files || []).forEach(file => {
        allFiles.push({ id: file.id, name: file.name, backendFilename: file.backendFilename, sourceFolder: file.sourceFolder || null, folderId: folder.id, folderName: folderPath });
      });
      if (folder.subfolders?.length > 0) {
        allFiles = [...allFiles, ...extractAllFiles(folder.subfolders, folderPath)];
      }
    });
    return allFiles;
  };

  const getSubclasses = (className) => {
    if (!project?.classes) return [];
    const parentClass = project.classes.find(c => c.name === className && !c.parentId);
    if (!parentClass) return [];
    return project.classes.filter(c => c.parentId === parentClass.id).map(c => c.name);
  };

  // ════════════════════════════════════════════════
  // Data loading
  // ════════════════════════════════════════════════

  useEffect(() => {
    (async () => {
      try {
        const p = await getProject(projectId);
        if (!p) { navigate('/'); return; }
        setProject(p);
        setProjectClasses((p.classes || []).filter(c => !c.parentId));
        const folderFiles = extractAllFiles(p.folders || []);
        const rootFiles = (p.files || []).map(f => ({ id: f.id, name: f.name, backendFilename: f.backendFilename, sourceFolder: f.sourceFolder || null, folderId: null, folderName: '(Root)' }));
        setProjectFiles([...rootFiles, ...folderFiles]);
      } catch { navigate('/'); }
      finally { setIsLoading(false); }
    })();
  }, [projectId, navigate]);

  // Load PDF when selectedPdf changes
  useEffect(() => {
    if (selectedPdf?.backendFilename) {
      pdf.loadPdfByFilename(selectedPdf.backendFilename, selectedPdf.sourceFolder);
    }
  }, [selectedPdf]);

  // Load models when project loads
  useEffect(() => {
    if (!project) return;
    (async () => {
      try { setModels(await getModels(projectId) || []); }
      catch { setModels([]); }
    })();
  }, [project, projectId]);

  // ════════════════════════════════════════════════
  // Keyboard: Escape
  // ════════════════════════════════════════════════

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setIsDrawing(false); setCurrentRect(null); setDrawStart(null);
        setPendingShape(null); setActiveResizeHandle(null);
        setSubclassRegions({}); setSubclassImageData(null);
        setSelectedClass('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ════════════════════════════════════════════════
  // Resize handles on pending shape
  // ════════════════════════════════════════════════

  useEffect(() => {
    if (!activeResizeHandle || !pendingShape) return;
    const onMove = (e) => {
      const canvas = pdf.canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = Math.max(0, Math.min(1, (e.clientX - rect.left) / pdf.scale / pdf.canvasSize.width));
      const my = Math.max(0, Math.min(1, (e.clientY - rect.top) / pdf.scale / pdf.canvasSize.height));
      const s = { ...pendingShape };
      const min = 0.01;
      if (activeResizeHandle.includes('e')) { const w = mx - s.x; if (w > min) s.width = w; }
      if (activeResizeHandle.includes('w')) { const w = (s.x + s.width) - mx; if (w > min && mx >= 0) { s.x = mx; s.width = w; } }
      if (activeResizeHandle.includes('s')) { const h = my - s.y; if (h > min) s.height = h; }
      if (activeResizeHandle.includes('n')) { const h = (s.y + s.height) - my; if (h > min && my >= 0) { s.y = my; s.height = h; } }
      setPendingShape(s);
    };
    const onUp = () => setActiveResizeHandle(null);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [activeResizeHandle, pendingShape, pdf.scale, pdf.canvasSize]);

  // ════════════════════════════════════════════════
  // Drawing handlers
  // ════════════════════════════════════════════════

  const handleMouseDown = (e) => {
    if (e.button === 1) { e.preventDefault(); pdf.startPan(e); return; }
    if ((!selectedClass && !addToExistingModel) || pendingShape) { pdf.startPan(e); return; }
    const canvas = pdf.canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / pdf.scale;
    const y = (e.clientY - rect.top) / pdf.scale;
    setIsDrawing(true);
    setDrawStart({ x, y });
    setCurrentRect({ x, y, width: 0, height: 0 });
  };

  const handleMouseMove = (e) => {
    if (!isDrawing || !drawStart || !pdf.canvasRef.current) return;
    const rect = pdf.canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / pdf.scale;
    const y = (e.clientY - rect.top) / pdf.scale;
    setCurrentRect({
      x: x < drawStart.x ? x : drawStart.x,
      y: y < drawStart.y ? y : drawStart.y,
      width: Math.abs(x - drawStart.x),
      height: Math.abs(y - drawStart.y),
    });
  };

  const handleMouseUp = () => {
    if (!isDrawing || !currentRect || (!selectedClass && !addToExistingModel)) {
      setIsDrawing(false); setCurrentRect(null); return;
    }
    if (currentRect.width > 10 && currentRect.height > 10) {
      setPendingShape({
        id: `box_${Date.now()}`,
        x: currentRect.x / pdf.canvasSize.width,
        y: currentRect.y / pdf.canvasSize.height,
        width: currentRect.width / pdf.canvasSize.width,
        height: currentRect.height / pdf.canvasSize.height,
        page: pdf.currentPage - 1,
        shapeType: drawingShapeType,
      });
    }
    setIsDrawing(false); setDrawStart(null); setCurrentRect(null);
  };

  // ════════════════════════════════════════════════
  // Shape confirm / cancel
  // ════════════════════════════════════════════════

  const handleConfirmShape = () => {
    if (!pendingShape) return;
    const className = addToExistingModel ? models.find(m => m.id === addToExistingModel)?.className : selectedClass;
    if (!className) return;
    const classData = projectClasses.find(c => c.name === className);
    const absRegions = {};
    for (const [sub, r] of Object.entries(subclassRegions)) {
      absRegions[sub] = {
        x: pendingShape.x + r.x * pendingShape.width, y: pendingShape.y + r.y * pendingShape.height,
        width: r.width * pendingShape.width, height: r.height * pendingShape.height,
        relativeX: r.x, relativeY: r.y, relativeWidth: r.width, relativeHeight: r.height,
      };
    }
    setTrainingBoxes(prev => [...prev, { ...pendingShape, className, color: classData?.color || '#3498db', subclassRegions: absRegions }]);
    setPendingShape(null); setSubclassRegions({}); setSubclassImageData(null); setSubclassImageZoom(1.0);
  };

  const handleCancelShape = () => {
    setPendingShape(null); setSubclassRegions({}); setSubclassImageData(null); setSubclassImageZoom(1.0);
  };

  // ════════════════════════════════════════════════
  // Subclass regions
  // ════════════════════════════════════════════════

  const handleDefineSubclassRegions = async () => {
    if (!pendingShape || isCapturingRegion || !selectedPdf?.backendFilename) return;
    const bbox = { x: pendingShape.x, y: pendingShape.y, width: pendingShape.width, height: pendingShape.height };
    const bboxKey = `${bbox.x.toFixed(6)}_${bbox.y.toFixed(6)}_${bbox.width.toFixed(6)}_${bbox.height.toFixed(6)}`;
    setShowSubclassDialog(true);
    if (!subclassImageData || subclassImageData.bboxKey !== bboxKey) {
      setIsCapturingRegion(true);
      try {
        const result = await captureRegion(selectedPdf.backendFilename, pdf.currentPage - 1, bbox, selectedPdf.sourceFolder);
        setSubclassImageData({ image: result.image, bboxKey }); setSubclassRegions({});
      } catch {
        // Fallback: capture from canvas
        const canvas = pdf.canvasRef.current;
        if (!canvas) { setIsCapturingRegion(false); return; }
        const px = Math.max(0, Math.floor(pendingShape.x * canvas.width));
        const py = Math.max(0, Math.floor(pendingShape.y * canvas.height));
        const pw = Math.min(canvas.width - px, Math.ceil(pendingShape.width * canvas.width));
        const ph = Math.min(canvas.height - py, Math.ceil(pendingShape.height * canvas.height));
        const tmp = document.createElement('canvas'); tmp.width = pw * 3; tmp.height = ph * 3;
        const ctx = tmp.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(canvas, px, py, pw, ph, 0, 0, pw * 3, ph * 3);
        setSubclassImageData({ image: tmp.toDataURL('image/png'), bboxKey }); setSubclassRegions({});
      }
      setIsCapturingRegion(false);
    }
  };

  // ════════════════════════════════════════════════
  // Training
  // ════════════════════════════════════════════════

  const handleTrain = async () => {
    if (trainingBoxes.length === 0) { alert('Please draw at least one training box'); return; }
    const uniqueClasses = [...new Set(trainingBoxes.map(b => b.className))];
    if (trainingMode === 'combined' && !modelName.trim()) { alert('Please enter a model name'); return; }

    if (!addToExistingModel) {
      const name = trainingMode === 'combined' ? modelName.trim()
        : (uniqueClasses.length === 1 && modelName.trim() ? modelName.trim() : null);
      if (name && models.find(m => m.className?.toLowerCase() === name.toLowerCase())) {
        alert(`A model named "${name}" already exists.`); return;
      }
      if (!name && trainingMode === 'separate') {
        const dups = uniqueClasses.filter(cn => models.some(m => m.className?.toLowerCase() === cn?.toLowerCase()));
        if (dups.length > 0) { alert(`Models already exist for: ${dups.join(', ')}`); return; }
      }
    }
    if (!selectedPdf?.backendFilename) { alert('No PDF selected'); return; }

    setIsTraining(true);
    try {
      const sanitized = trainingBoxes.map(box => {
        let cn;
        if (addToExistingModel) cn = models.find(m => m.id === addToExistingModel)?.className || box.className;
        else if (trainingMode === 'combined') cn = modelName.trim();
        else if (uniqueClasses.length === 1 && modelName.trim()) cn = modelName.trim();
        else cn = box.className;
        return { ...box, className: cn.replace(/[<>:"/\\|?*]/g, '-'), originalClassName: box.className };
      });
      await trainDetector(selectedPdf.backendFilename, sanitized, multiOrientation, includeInverted,
        addToExistingModel ? 'separate' : trainingMode, 'object', projectId, addToExistingModel || null, selectedPdf.sourceFolder);
      setModels(await getModels(projectId) || []);
      setTrainingBoxes([]); setModelName(''); setPendingShape(null); setAddToExistingModel(null);
      alert('Training complete!');
    } catch (error) {
      alert('Training failed: ' + error.message);
    } finally { setIsTraining(false); }
  };

  // ════════════════════════════════════════════════
  // Test model
  // ════════════════════════════════════════════════

  const handleTestModel = async (modelId) => {
    if (!selectedPdf?.backendFilename) { alert('Please select a PDF first'); return; }
    const model = models.find(m => m.id === modelId);
    if (!model) return;
    setIsTesting(true); setTestModelId(modelId); setTestResults([]);
    try {
      const enableOCR = testOcrFormat.length > 0 || Object.values(testSubclassOcrFormats).some(f => f?.length > 0);
      const result = await runDetection(selectedPdf.backendFilename, {
        confidence: testConfidence, selectedModels: [modelId], enableOCR,
        sourceFolder: selectedPdf.sourceFolder || null,
        perClassSettings: { [modelId]: { confidence: testConfidence, enableOCR, ocrFormat: testOcrFormat || null, className: model.className,
          subclassOcrFormats: Object.keys(testSubclassOcrFormats).length > 0 ? testSubclassOcrFormats : null } }
      });
      setTestResults((result.detections || [])
        .filter(d => d.page === undefined || d.page === pdf.currentPage - 1)
        .map((d, i) => ({ id: `test_${Date.now()}_${i}`, x: d.bbox.x, y: d.bbox.y, width: d.bbox.width, height: d.bbox.height,
          confidence: d.confidence, className: d.class_name || model.className, ocrText: d.ocr_text || '', page: d.page || 0, shapeType: d.shapeType || 'rectangle' })));
    } catch (error) { alert('Test failed: ' + error.message); }
    finally { setIsTesting(false); }
  };

  const handleSaveTestSettings = async () => {
    const model = models.find(m => m.id === testModelId);
    if (!model) return;
    const pattern = testOcrFormat ? testOcrFormat.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N') : null;
    const subPatterns = {};
    for (const [s, f] of Object.entries(testSubclassOcrFormats)) { if (f) subPatterns[s] = f.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N'); }
    await saveModel({ ...model, recommendedConfidence: testConfidence, recommendedOcrFormat: testOcrFormat || null, recommendedOcrPattern: pattern,
      subclassOcrFormats: Object.keys(testSubclassOcrFormats).length > 0 ? testSubclassOcrFormats : null,
      subclassOcrPatterns: Object.keys(subPatterns).length > 0 ? subPatterns : null });
    setModels(await getModels(projectId) || []);
    alert(`Saved settings for "${model.className}"`);
  };

  // ════════════════════════════════════════════════
  // Model CRUD
  // ════════════════════════════════════════════════

  const handleDeleteModel = async (modelId, name) => {
    if (!confirm(`Delete model "${name}"?\n\nThis cannot be undone.`)) return;
    try { await deleteModel(modelId); setModels(prev => prev.filter(m => m.id !== modelId)); if (selectedItem === modelId) setSelectedItem('train'); }
    catch { alert('Failed to delete model'); }
  };

  const handleExportModels = async () => {
    if (models.length === 0) { alert('No models to export'); return; }
    try {
      const res = await fetch(`${DETECTOR_URL}/models/export`);
      if (!res.ok) throw new Error((await res.json()).error || 'Export failed');
      const blob = await res.blob();
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
      const cd = res.headers.get('Content-Disposition');
      link.download = cd?.match(/filename=(.+)/)?.[1] || `models_export_${new Date().toISOString().slice(0, 10)}.zip`;
      link.click(); URL.revokeObjectURL(link.href);
    } catch (error) { alert('Export failed: ' + error.message); }
  };

  const handleExportSingleModel = async (modelId, className) => {
    try { await exportSingleModel(modelId, className); }
    catch (error) { alert('Export failed: ' + error.message); }
  };

  // ════════════════════════════════════════════════
  // Import
  // ════════════════════════════════════════════════

  const handleModelFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.name.endsWith('.zip')) {
      setImportData({ file, fileName: file.name, isZip: true }); setImportError(null); setShowImportDialog(true);
    } else if (file.name.endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const arr = (JSON.parse(ev.target.result).models || JSON.parse(ev.target.result));
          if (!Array.isArray(arr)) throw new Error('Invalid format');
          const valid = arr.filter(m => m.id && m.className);
          if (!valid.length) throw new Error('No valid models');
          setImportData({ models: valid, fileName: file.name, isZip: false }); setImportError(null); setShowImportDialog(true);
        } catch (err) { setImportError(err.message); setImportData(null); setShowImportDialog(true); }
      };
      reader.readAsText(file);
    } else { alert('Please select a .zip or .json file'); }
    e.target.value = '';
  };

  const handleImportModels = async () => {
    if (!importData) return;
    try {
      if (importData.isZip) {
        const fd = new FormData(); fd.append('file', importData.file);
        const url = importMode === 'replace' ? `${DETECTOR_URL}/models/import-overwrite` : `${DETECTOR_URL}/models/import`;
        const res = await fetch(url, { method: 'POST', body: fd }); const r = await res.json();
        if (!res.ok) throw new Error(r.error || 'Import failed');
        setModels(await getModels(projectId) || []);
        alert(`Imported ${r.imported?.length || 0} model(s)`);
      } else {
        if (importMode === 'replace') { for (const m of models) await deleteModel(m.id); }
        const merged = new Map(models.map(m => [m.id, m]));
        if (importMode !== 'replace') importData.models.forEach(im => merged.set(im.id, { ...merged.get(im.id), ...im }));
        else importData.models.forEach(im => merged.set(im.id, im));
        for (const m of merged.values()) await saveModel(m);
        setModels(await getModels(projectId) || []);
        alert(`Imported ${importData.models.length} model settings`);
      }
      setShowImportDialog(false); setImportData(null); setImportError(null);
    } catch (error) { alert('Import failed: ' + error.message); }
  };

  // ════════════════════════════════════════════════
  // Action handlers (wire child components)
  // ════════════════════════════════════════════════

  const handleSelectPdf = (file) => {
    setSelectedPdf(file);
    setTrainingBoxes([]); setPendingShape(null);
  };

  const handleSelectItem = (item) => {
    setSelectedItem(item);
    if (item !== 'train') {
      // Clicking a model — open canvas in view mode
      setPendingShape(null);
      setTrainingBoxes([]);
      setShowDocSidebar(true);
    }
  };

  const handleStartTraining = () => {
    setModelName(''); setTrainingBoxes([]); setPendingShape(null); setTestResults([]);
    setSelectedPdf(null); pdf.clearPdf(); setAddToExistingModel(null);
    setShowTestPanel(false); setShowTrainPanel(true); setTestModelId(null);
    setSelectedItem('train'); setShowDocSidebar(true);
    if (projectFiles.length > 0) setTimeout(() => handleSelectPdf(projectFiles[0]), 0);
  };

  const handleAddExamples = (model) => {
    setAddToExistingModel(model.id); setSelectedItem('train'); setShowDocSidebar(true);
    if (!selectedPdf && projectFiles.length > 0) handleSelectPdf(projectFiles[0]);
  };

  const handleTestModelFromSidebar = (model) => {
    setTestModelId(model.id); setShowTestPanel(true); setTestResults([]);
    if (model.recommendedConfidence) setTestConfidence(model.recommendedConfidence);
    setTestOcrFormat(model.recommendedOcrFormat || '');
    setTestSubclassOcrFormats(model.subclassOcrFormats || {});
    setSelectedItem(model.id); setShowDocSidebar(true);
    if (!selectedPdf && projectFiles.length > 0) handleSelectPdf(projectFiles[0]);
  };

  // ════════════════════════════════════════════════
  // Computed
  // ════════════════════════════════════════════════

  const objectModels = models.filter(m => m.modelType !== 'smart_link' && m.className !== 'PFD Links');
  const activeTestModel = selectedItem !== 'train' ? models.find(m => m.id === selectedItem) : null;
  const activeClassName = addToExistingModel ? models.find(m => m.id === addToExistingModel)?.className : selectedClass;

  if (isLoading) return <div className="loading">Loading...</div>;

  // ════════════════════════════════════════════════
  // Canvas overlays (training boxes, pending, test)
  // ════════════════════════════════════════════════

  const renderCanvasOverlays = () => (
    <>
      {/* Committed training boxes */}
      {trainingBoxes.filter(b => b.page === pdf.currentPage - 1).map(box => {
        const s = Math.max(0.5, Math.min(1.5, pdf.scale));
        return (
          <div key={box.id} className={`models-training-box ${box.shapeType === 'circle' ? 'circle' : ''}`}
            style={{ left: box.x * pdf.canvasSize.width * pdf.scale, top: box.y * pdf.canvasSize.height * pdf.scale,
              width: box.width * pdf.canvasSize.width * pdf.scale, height: box.height * pdf.canvasSize.height * pdf.scale,
              borderColor: box.color, backgroundColor: `${box.color}20`, borderRadius: box.shapeType === 'circle' ? '50%' : '0' }}>
            <span className="box-label" style={{ backgroundColor: box.color, transform: `scale(${s})`, transformOrigin: 'top left' }}>{box.className}</span>
            <button className="models-remove-box-btn" style={{ transform: `scale(${s})`, transformOrigin: 'top right' }}
              onClick={(e) => { e.stopPropagation(); setTrainingBoxes(prev => prev.filter(b => b.id !== box.id)); }}>
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="#e74c3c" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l6 6M7 1l-6 6"/></svg>
            </button>
          </div>
        );
      })}

      {/* Active drawing rect */}
      {currentRect && (
        <div className={`models-drawing-rect ${drawingShapeType === 'circle' ? 'circle' : ''}`}
          style={{ left: currentRect.x * pdf.scale, top: currentRect.y * pdf.scale,
            width: currentRect.width * pdf.scale, height: currentRect.height * pdf.scale,
            borderColor: projectClasses.find(c => c.name === selectedClass)?.color || '#3498db',
            borderRadius: drawingShapeType === 'circle' ? '50%' : '0' }} />
      )}

      {/* Pending shape + resize handles + action bar */}
      {pendingShape && pendingShape.page === pdf.currentPage - 1 && (
        <>
          <div className="pending-shape"
            style={{ left: pendingShape.x * pdf.canvasSize.width * pdf.scale, top: pendingShape.y * pdf.canvasSize.height * pdf.scale,
              width: pendingShape.width * pdf.canvasSize.width * pdf.scale, height: pendingShape.height * pdf.canvasSize.height * pdf.scale,
              borderRadius: pendingShape.shapeType === 'circle' ? '50%' : '0' }}>
            <span className="pending-label">{activeClassName}</span>
          </div>
          {['nw','ne','sw','se','n','s','e','w'].map(h => {
            let l, t;
            if (h.includes('w') && !h.includes('e')) l = pendingShape.x * pdf.canvasSize.width * pdf.scale - 5;
            else if (h.includes('e') && !h.includes('w')) l = (pendingShape.x + pendingShape.width) * pdf.canvasSize.width * pdf.scale - 5;
            else l = (pendingShape.x + pendingShape.width / 2) * pdf.canvasSize.width * pdf.scale - 5;
            if (h.includes('n') && !h.includes('s')) t = pendingShape.y * pdf.canvasSize.height * pdf.scale - 5;
            else if (h.includes('s') && !h.includes('n')) t = (pendingShape.y + pendingShape.height) * pdf.canvasSize.height * pdf.scale - 5;
            else t = (pendingShape.y + pendingShape.height / 2) * pdf.canvasSize.height * pdf.scale - 5;
            return <div key={h} className={`resize-handle ${h}`} style={{ left: l, top: t }}
              onMouseDown={(e) => { e.stopPropagation(); setActiveResizeHandle(h); }} />;
          })}
          <div className="pending-action-bar" onMouseDown={e => e.stopPropagation()}
            style={{ left: (pendingShape.x + pendingShape.width / 2) * pdf.canvasSize.width * pdf.scale,
              top: (pendingShape.y + pendingShape.height) * pdf.canvasSize.height * pdf.scale + 12 }}>
            {getSubclasses(activeClassName).length > 0 && (
              <button className={`action-bar-btn regions-btn ${Object.keys(subclassRegions).length > 0 ? 'has-regions' : ''}`}
                onClick={e => { e.stopPropagation(); handleDefineSubclassRegions(); }} onMouseDown={e => e.stopPropagation()} disabled={isCapturingRegion}>
                {Object.keys(subclassRegions).length > 0 ? `Regions (${Object.keys(subclassRegions).length}/${getSubclasses(activeClassName).length})` : 'Define Regions'}
              </button>
            )}
            <button className="action-bar-btn confirm-btn" onClick={e => { e.stopPropagation(); handleConfirmShape(); }} onMouseDown={e => e.stopPropagation()}>✓ Add</button>
            <button className="action-bar-btn cancel-btn" onClick={e => { e.stopPropagation(); handleCancelShape(); }} onMouseDown={e => e.stopPropagation()}>✕</button>
          </div>
        </>
      )}

      {/* Test results */}
      {testResults.filter(r => r.page === pdf.currentPage - 1 || r.page === undefined).map(r => (
        <div key={r.id} className={`test-result-box ${r.shapeType === 'circle' ? 'circle' : ''}`}
          style={{ left: r.x * pdf.canvasSize.width * pdf.scale, top: r.y * pdf.canvasSize.height * pdf.scale,
            width: r.width * pdf.canvasSize.width * pdf.scale, height: r.height * pdf.canvasSize.height * pdf.scale,
            borderRadius: r.shapeType === 'circle' ? '50%' : '0' }}>
          <span className="test-result-label">{r.ocrText || r.className} ({Math.round(r.confidence * 100)}%)</span>
        </div>
      ))}
    </>
  );

  // ════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════

  return (
    <div className="project-models-page">
      <header className="models-header">
        <button className="back-btn" onClick={() => navigate(`/project/${projectId}`, { state: { returnToFile } })}>← Back to Project</button>
        <h1>{project?.name} - Models</h1>
        <h1 className="brand-title">pidly</h1>
      </header>

      <div className="models-body">
        <ModelsSidebar
          projectId={projectId} returnToFile={returnToFile}
          selectedItem={selectedItem} onSelectItem={handleSelectItem}
          onStartTraining={handleStartTraining}
          objectModels={objectModels}
          searchQuery={searchQuery} setSearchQuery={setSearchQuery}
          onDeleteModel={handleDeleteModel} onExportSingleModel={handleExportSingleModel}
          onAddExamples={handleAddExamples} onTestModel={handleTestModelFromSidebar}
        />

        {showDocSidebar && (
          <DocumentSidebar
            projectFiles={projectFiles} selectedPdf={selectedPdf}
            onSelectPdf={handleSelectPdf} onClose={() => setShowDocSidebar(false)}
          />
        )}

        <div className="models-main">
          <div className="training-viewer">
              <div className="training-page-header">
                <h2>{activeTestModel ? `Test: ${activeTestModel.className}` : addToExistingModel ? `Add Examples to: ${models.find(m => m.id === addToExistingModel)?.className || 'Model'}` : 'Create Object Model'}</h2>
                {!showDocSidebar && (
                  <button className="show-docs-btn" onClick={() => setShowDocSidebar(true)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    </svg>
                    Documents
                  </button>
                )}
              </div>

              {selectedPdf ? (
                <div className="pdf-training-area">
                  <div className="pdf-training-header">
                    <div className="header-left">
                      <h2>{selectedPdf.name}</h2>
                      {pdf.numPages > 1 ? (
                        <div className="page-navigation">
                          <button className="page-nav-btn" onClick={() => pdf.setCurrentPage(p => Math.max(1, p - 1))} disabled={pdf.currentPage <= 1}>◀</button>
                          <span className="page-info">Page {pdf.currentPage} of {pdf.numPages}</span>
                          <button className="page-nav-btn" onClick={() => pdf.setCurrentPage(p => Math.min(pdf.numPages, p + 1))} disabled={pdf.currentPage >= pdf.numPages}>▶</button>
                        </div>
                      ) : (
                        <span className="page-info">Page {pdf.currentPage} of {pdf.numPages}</span>
                      )}
                    </div>
                    <div className="header-controls">
                      <button onClick={pdf.zoomOut}>−</button>
                      <span className="zoom-level">{Math.round(pdf.scale * 100)}%</span>
                      <button onClick={pdf.zoomIn}>+</button>
                    </div>
                  </div>

                  {!activeTestModel && (
                    <TrainingToolbar
                      trainingBoxes={trainingBoxes}
                      numPages={pdf.numPages} currentPage={pdf.currentPage}
                      onClearBoxes={() => setTrainingBoxes([])}
                      models={models}
                      showTrainPanel={showTrainPanel} onToggleTrainPanel={() => { setShowTrainPanel(!showTrainPanel); if (!showTrainPanel) setShowTestPanel(false); }}
                      showTestPanel={showTestPanel} onToggleTestPanel={() => { setShowTestPanel(!showTestPanel); if (!showTestPanel) setShowTrainPanel(false); }} isTesting={isTesting}
                    />
                  )}

                  <div className="training-content-area">
                    <div className="training-canvas-section">
                      {!activeTestModel && selectedClass && !pendingShape && (
                        <div className="shape-hint">
                          {drawingShapeType === 'rectangle' && '📐 Click and drag to draw • Scroll to zoom • Drag to pan when not drawing'}
                          {drawingShapeType === 'circle' && '⭕ Click and drag to draw • Scroll to zoom • Drag to pan when not drawing'}
                        </div>
                      )}
                      {!activeTestModel && !selectedClass && <div className="models-class-hint">⚠️ Select a class in the Train panel to start drawing • Drag to pan • Scroll to zoom</div>}

                      <div className="models-pdf-canvas-container" ref={pdf.containerRef}>
                        <div className="models-pdf-canvas-wrapper"
                          style={{ width: pdf.canvasSize.width * pdf.scale, height: pdf.canvasSize.height * pdf.scale, position: 'relative',
                            transform: `translate(${pdf.panOffset.x}px, ${pdf.panOffset.y}px)` }}
                          onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
                          <canvas ref={pdf.canvasRef}
                            style={{ width: pdf.canvasSize.width * pdf.scale, height: pdf.canvasSize.height * pdf.scale,
                              cursor: activeTestModel ? (pdf.isPanning ? 'grabbing' : 'grab') : (pdf.isPanning ? 'grabbing' : (selectedClass && !pendingShape ? 'crosshair' : 'grab')) }} />
                          {renderCanvasOverlays()}
                        </div>

                        {/* Floating page nav */}
                        {pdf.numPages > 1 && (
                          <div className="floating-page-nav">
                            <button
                              className="fpn-btn"
                              onClick={() => pdf.setCurrentPage(p => Math.max(1, p - 1))}
                              disabled={pdf.currentPage <= 1}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                            </button>
                            <span className="fpn-info">
                              <span className="fpn-current">{pdf.currentPage}</span>
                              <span className="fpn-sep">/</span>
                              <span className="fpn-total">{pdf.numPages}</span>
                            </span>
                            <button
                              className="fpn-btn"
                              onClick={() => pdf.setCurrentPage(p => Math.min(pdf.numPages, p + 1))}
                              disabled={pdf.currentPage >= pdf.numPages}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {(showTestPanel || activeTestModel) ? (
                      <TestPanel
                        models={models} objectModels={objectModels}
                        activeTestModel={activeTestModel}
                        projectId={projectId} setModels={setModels}
                        testModelId={testModelId} setTestModelId={setTestModelId}
                        testConfidence={testConfidence} setTestConfidence={setTestConfidence}
                        testOcrFormat={testOcrFormat} setTestOcrFormat={setTestOcrFormat}
                        testSubclassOcrFormats={testSubclassOcrFormats} setTestSubclassOcrFormats={setTestSubclassOcrFormats}
                        testResults={testResults} setTestResults={setTestResults}
                        isTesting={isTesting} getSubclasses={getSubclasses}
                        onTestModel={handleTestModel} onSaveSettings={handleSaveTestSettings}
                        onClose={activeTestModel ? undefined : () => setShowTestPanel(false)}
                      />
                    ) : showTrainPanel && !activeTestModel && (
                      <TrainPanel
                        selectedClass={selectedClass} setSelectedClass={setSelectedClass}
                        projectClasses={projectClasses}
                        drawingShapeType={drawingShapeType} setDrawingShapeType={setDrawingShapeType}
                        trainingMode={trainingMode} setTrainingMode={setTrainingMode}
                        addToExistingModel={addToExistingModel} setAddToExistingModel={setAddToExistingModel}
                        models={models} trainingBoxes={trainingBoxes}
                        modelName={modelName} setModelName={setModelName}
                        multiOrientation={multiOrientation} setMultiOrientation={setMultiOrientation}
                        includeInverted={includeInverted} setIncludeInverted={setIncludeInverted}
                        isTraining={isTraining} onTrain={handleTrain}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="training-empty-state">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <h3>Select a Document</h3>
                  <p>{activeTestModel
                    ? 'Choose a PDF to test detection on'
                    : 'Choose a PDF from the documents panel to start drawing training examples'}</p>
                  {!showDocSidebar && <button className="show-docs-btn large" onClick={() => setShowDocSidebar(true)}>Show Documents</button>}
                </div>
              )}
            </div>
        </div>
      </div>

      {showSubclassDialog && pendingShape && (
        <SubclassDialog
          pendingShape={pendingShape}
          selectedClass={activeClassName}
          subclasses={getSubclasses(activeClassName)}
          subclassRegions={subclassRegions} setSubclassRegions={setSubclassRegions}
          subclassImageData={subclassImageData} isCapturingRegion={isCapturingRegion}
          subclassImageZoom={subclassImageZoom} setSubclassImageZoom={setSubclassImageZoom}
          onClose={() => setShowSubclassDialog(false)}
        />
      )}

      {showImportDialog && (
        <ImportDialog
          importData={importData} importError={importError}
          importMode={importMode} setImportMode={setImportMode}
          onImport={handleImportModels}
          onClose={() => { setShowImportDialog(false); setImportData(null); setImportError(null); }}
        />
      )}
    </div>
  );
}
