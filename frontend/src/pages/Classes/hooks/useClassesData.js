import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProject, saveProject, getThumbnail, getObjectsFromBackend, saveObjectsToBackend } from '../../../utils/storage';

/**
 * Core data hook for ProjectClassesPage.
 * Manages: project loading, classes extraction, object CRUD,
 * column/subclass management, orphaned objects, thumbnails.
 */
export default function useClassesData(projectId) {
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [detectedObjects, setDetectedObjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [thumbnails, setThumbnails] = useState({});
  const [loadingThumbnails, setLoadingThumbnails] = useState({});

  // Column state
  const [classColumnWidths, setClassColumnWidths] = useState({});
  const [columnAlignments, setColumnAlignments] = useState({});
  const [columnFilters, setColumnFilters] = useState({});

  // Cell editing
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');

  // Undo/Redo stacks
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  // Orphaned objects dialog state
  const [showReassignDialog, setShowReassignDialog] = useState(false);
  const [reassignSourceFile, setReassignSourceFile] = useState(null);
  const [reassignTargetFile, setReassignTargetFile] = useState(null);
  const [isReassigning, setIsReassigning] = useState(false);
  const [showDeleteOrphanedDialog, setShowDeleteOrphanedDialog] = useState(false);

  // ─── System columns ──────────────────────────────────────────────────
  const endColumns = [
    { id: 'filename', name: 'Document', editable: false, deletable: false, filterable: true, defaultWidth: 280 },
    { id: 'page', name: 'Page', editable: false, deletable: false, filterable: true, defaultWidth: 80 },
    { id: 'confidence', name: 'Confidence', editable: false, deletable: false, filterable: true, defaultWidth: 120 },
  ];

  // ─── Extract classes from project + objects ──────────────────────────
  const extractClasses = useCallback((proj, objects = []) => {
    if (objects.length === 0 && !proj?.classes) return [];
    const classMap = {};

    if (proj?.classes) {
      proj.classes.forEach(cls => {
        if (!cls.parentId) {
          classMap[cls.name] = { ...cls, count: 0, objects: [] };
        }
      });
    }

    objects.forEach(obj => {
      const className = obj.label || obj.className;
      if (className) {
        if (!classMap[className]) {
          classMap[className] = { name: className, count: 0, objects: [] };
        }
        classMap[className].count++;
        classMap[className].objects.push(obj);
      }
    });

    return Object.values(classMap).sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  // ─── Load project ────────────────────────────────────────────────────
  useEffect(() => {
    const loadProject = async () => {
      try {
        const loadedProject = await getProject(projectId);
        if (loadedProject) {
          setProject(loadedProject);

          try {
            const objects = await getObjectsFromBackend(projectId);
            if (objects.length > 0) {
              setDetectedObjects(objects);
            } else if (loadedProject.detectedObjects?.length > 0) {
              setDetectedObjects(loadedProject.detectedObjects);
              await saveObjectsToBackend(projectId, loadedProject.detectedObjects);
            }
          } catch (objError) {
            console.error('Error loading objects from backend:', objError);
            if (loadedProject.detectedObjects) {
              setDetectedObjects(loadedProject.detectedObjects);
            }
          }

          if (loadedProject.classColumnWidths) {
            setClassColumnWidths(loadedProject.classColumnWidths);
          }
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

  // ─── Sync classes when objects/project change ────────────────────────
  useEffect(() => {
    if (project) {
      setClasses(extractClasses(project, detectedObjects));
    }
  }, [detectedObjects, project?.classes, extractClasses]);

  // ─── Refresh data ────────────────────────────────────────────────────
  const refreshData = useCallback(async () => {
    try {
      const loadedProject = await getProject(projectId);
      if (loadedProject) {
        setProject(loadedProject);
        try {
          const objects = await getObjectsFromBackend(projectId);
          setDetectedObjects(objects);
        } catch (objError) {
          console.error('Error refreshing objects:', objError);
        }
        if (selectedClass) {
          const updatedClass = classes.find(c => c.name === selectedClass.name);
          setSelectedClass(updatedClass || null);
        }
        setThumbnails({});
      }
    } catch (error) {
      console.error('Error refreshing data:', error);
    }
  }, [projectId, selectedClass, classes]);

  // ─── Derived: all project classes, project files ─────────────────────
  const allProjectClasses = project?.classes || [];

  const allProjectFiles = useMemo(() => {
    if (!project) return [];
    const files = [];
    const collectFiles = (folders) => {
      folders?.forEach(folder => {
        folder.files?.forEach(file => files.push(file));
        if (folder.subfolders) collectFiles(folder.subfolders);
      });
    };
    collectFiles(project.folders);
    project.files?.forEach(file => files.push(file));
    return files;
  }, [project]);

  // ─── Subclass / column helpers ───────────────────────────────────────
  const getSelectedClassSubclasses = useCallback(() => {
    if (!selectedClass || !project?.classes) return [];
    const rootClass = project.classes.find(c => c.name === selectedClass.name && !c.parentId);
    if (!rootClass) return [];
    return project.classes.filter(c => c.parentId === rootClass.id);
  }, [selectedClass, project?.classes]);

  const getClassCustomColumns = useCallback(() => {
    if (!selectedClass || !project?.classColumns) return [];
    return (project.classColumns[selectedClass.name] || []).map(col => ({
      ...col,
      editable: col.editable !== false,
      deletable: true,
      filterable: true,
      isCustom: true,
      defaultWidth: col.defaultWidth || 180,
    }));
  }, [selectedClass, project?.classColumns]);

  // Computed columns for selected class
  const columns = useMemo(() => {
    const subclasses = getSelectedClassSubclasses();
    const userColumns = subclasses.length > 0
      ? subclasses.map(sub => ({
          id: `subclass_${sub.name}`,
          name: `${sub.name} (SUBCLASS)`,
          subclassName: sub.name,
          subclassId: sub.id,
          editable: true,
          deletable: true,
          filterable: true,
          defaultWidth: 180,
          isSubclass: true,
        }))
      : [{ id: 'ocr_text', name: 'Tag', editable: true, deletable: false, filterable: true, defaultWidth: 180 }];
    return [...userColumns, ...getClassCustomColumns(), ...endColumns];
  }, [getSelectedClassSubclasses, getClassCustomColumns]);

  // Column width / alignment helpers
  const getColumnWidth = useCallback((columnId) => {
    if (!selectedClass) return 150;
    return classColumnWidths[selectedClass.name]?.[columnId] || columns.find(c => c.id === columnId)?.defaultWidth || 180;
  }, [selectedClass, classColumnWidths, columns]);

  const getColumnAlignment = useCallback((columnId) => {
    if (!selectedClass) return 'center';
    return columnAlignments[selectedClass.name]?.[columnId] || 'center';
  }, [selectedClass, columnAlignments]);

  const toggleColumnAlignment = useCallback((columnId) => {
    if (!selectedClass) return;
    const current = getColumnAlignment(columnId);
    const next = current === 'left' ? 'center' : current === 'center' ? 'right' : 'left';
    setColumnAlignments(prev => ({
      ...prev,
      [selectedClass.name]: { ...(prev[selectedClass.name] || {}), [columnId]: next },
    }));
  }, [selectedClass, getColumnAlignment]);

  // ─── Cell value helpers ──────────────────────────────────────────────
  const getCellValue = useCallback((obj, column) => {
    if (column.isSubclass) {
      return (obj.subclassValues || {})[column.subclassName] || '-';
    }
    switch (column.id) {
      case 'filename': return obj.filename?.replace('.pdf', '') || '-';
      case 'page': return obj.page || 1;
      case 'confidence': return obj.confidence ? `${(obj.confidence * 100).toFixed(0)}%` : '-';
      case 'ocr_confidence':
        return typeof obj.ocr_confidence === 'number' ? `${(obj.ocr_confidence * 100).toFixed(0)}%` : (obj.ocr_confidence || '-');
      default: return obj[column.id] || '-';
    }
  }, []);

  const getRawCellValue = useCallback((obj, columnId) => {
    if (columnId.startsWith('subclass_')) {
      return (obj.subclassValues || {})[columnId.replace('subclass_', '')] || '';
    }
    switch (columnId) {
      case 'filename':
        return (obj.status === 'orphaned' ? obj.originalFilename : obj.filename)?.replace('.pdf', '') || '';
      case 'page': return String(obj.page || 1);
      case 'confidence': return obj.confidence ? `${(obj.confidence * 100).toFixed(0)}%` : '';
      case 'ocr_confidence':
        return typeof obj.ocr_confidence === 'number' ? `${(obj.ocr_confidence * 100).toFixed(0)}%` : (obj.ocr_confidence || '');
      default: return obj[columnId] || '';
    }
  }, []);

  // ─── Memoized class data with filtering ──────────────────────────────
  const classData = useMemo(() => {
    if (!selectedClass) return [];
    let data = detectedObjects.filter(obj => (obj.label || obj.className) === selectedClass.name);

    Object.entries(columnFilters).forEach(([columnId, filterValue]) => {
      if (!filterValue || !filterValue.toString().trim()) return;

      if (filterValue === ' ' || filterValue.toLowerCase() === '(empty)' || filterValue.toLowerCase() === 'empty') {
        data = data.filter(obj => {
          const v = getRawCellValue(obj, columnId);
          return !v || v === '-';
        });
      } else if ((columnId === 'confidence' || columnId === 'ocr_confidence') && /^[<>]=?\d/.test(filterValue.trim())) {
        const match = filterValue.trim().match(/^([<>]=?)(\d*\.?\d+)/);
        if (match) {
          const [, op, val] = match;
          const threshold = parseFloat(val);
          data = data.filter(obj => {
            let v = obj[columnId];
            v = typeof v === 'string' && v.endsWith('%') ? parseFloat(v) / 100 : (parseFloat(v) || 0);
            return op === '>' ? v > threshold : op === '>=' ? v >= threshold : op === '<' ? v < threshold : v <= threshold;
          });
        }
      } else if (filterValue.trim()) {
        const term = filterValue.toLowerCase().trim();
        data = data.filter(obj => String(getRawCellValue(obj, columnId)).toLowerCase().includes(term));
      }
    });
    return data;
  }, [selectedClass, detectedObjects, columnFilters, getRawCellValue]);

  // ─── Class CRUD ──────────────────────────────────────────────────────
  const handleCreateClass = useCallback(async (name, parentId, pendingSubclasses = []) => {
    const defaultColors = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const defaultColor = defaultColors[Math.abs(hash) % defaultColors.length];

    const newClass = {
      id: `class_${Date.now()}`,
      name,
      color: defaultColor,
      parentId: parentId || null,
      count: 0,
      objects: [],
      created: new Date().toISOString(),
    };

    const classesToAdd = [newClass];
    if (!parentId && pendingSubclasses.length > 0) {
      pendingSubclasses.forEach((subName, idx) => {
        classesToAdd.push({
          id: `class_${Date.now()}_sub_${idx}`,
          name: subName,
          parentId: newClass.id,
          count: 0,
          objects: [],
          created: new Date().toISOString(),
        });
      });
    }

    const updatedProject = { ...project, classes: [...(project.classes || []), ...classesToAdd] };
    setProject(updatedProject);
    setClasses(extractClasses(updatedProject, detectedObjects));
    try { await saveProject(updatedProject); } catch (e) { console.error('Error saving class:', e); }

    setSelectedClass(newClass);
    return newClass;
  }, [project, detectedObjects, extractClasses]);

  const handleDeleteClass = useCallback(async (className) => {
    const count = detectedObjects.filter(obj => (obj.label || obj.className) === className).length;
    const msg = count > 0
      ? `Delete "${className}"?\n\nThis will DELETE all ${count} object(s).`
      : `Delete "${className}"?`;
    if (!confirm(msg)) return;

    const updatedClassColumns = { ...(project.classColumns || {}) };
    delete updatedClassColumns[className];

    const updatedProject = {
      ...project,
      classes: (project.classes || []).filter(c => c.name !== className),
      classColumns: updatedClassColumns,
    };
    const updatedObjects = detectedObjects.filter(obj => (obj.label || obj.className) !== className);

    setProject(updatedProject);
    setDetectedObjects(updatedObjects);
    setSelectedClass(null);
    try {
      await saveProject(updatedProject);
      await saveObjectsToBackend(projectId, updatedObjects);
    } catch (e) { console.error('Error deleting class:', e); }
  }, [project, detectedObjects, projectId]);

  const handleRenameClass = useCallback(async (oldName, newName) => {
    if (!oldName || !newName || oldName === newName) return;
    // Check for name collision
    if ((project.classes || []).some(c => c.name === newName) ||
        detectedObjects.some(obj => (obj.label || obj.className) === newName && (obj.label || obj.className) !== oldName)) {
      alert(`A class named "${newName}" already exists.`);
      return;
    }
    // Update project classes
    const updatedClasses = (project.classes || []).map(c =>
      c.name === oldName ? { ...c, name: newName } : c
    );
    // Update classColumns keys
    const updatedClassColumns = { ...(project.classColumns || {}) };
    if (updatedClassColumns[oldName]) {
      updatedClassColumns[newName] = updatedClassColumns[oldName];
      delete updatedClassColumns[oldName];
    }
    const updatedProject = { ...project, classes: updatedClasses, classColumns: updatedClassColumns };
    // Update detected objects
    const updatedObjects = detectedObjects.map(obj =>
      (obj.label || obj.className) === oldName
        ? { ...obj, label: newName, className: newName }
        : obj
    );
    setProject(updatedProject);
    setDetectedObjects(updatedObjects);
    setClasses(extractClasses(updatedProject, updatedObjects));
    // Update selected class reference
    if (selectedClass?.name === oldName) {
      setSelectedClass({ ...selectedClass, name: newName });
    }
    try {
      await saveProject(updatedProject);
      await saveObjectsToBackend(projectId, updatedObjects);
    } catch (e) { console.error('Error renaming class:', e); }
  }, [project, detectedObjects, projectId, selectedClass, extractClasses]);

  const handleDeleteObject = useCallback(async (objId) => {
    if (!confirm('Delete this object?')) return;
    const updated = detectedObjects.filter(obj => obj.id !== objId);
    setDetectedObjects(updated);
    if (thumbnails[objId]) {
      setThumbnails(prev => { const n = { ...prev }; delete n[objId]; return n; });
    }
    try { await saveObjectsToBackend(projectId, updated); } catch (e) { console.error('Error:', e); }
  }, [detectedObjects, projectId, thumbnails]);

  const handleDeleteFilteredObjects = useCallback(async (filteredObjects) => {
    if (!filteredObjects.length) return;
    const hasFilters = Object.values(columnFilters).some(v => v && v.trim());
    const msg = hasFilters
      ? `Delete ${filteredObjects.length} filtered object(s)?`
      : `Delete all ${filteredObjects.length} object(s) in this class?\n\nThis cannot be undone.`;
    if (!confirm(msg)) return;

    const ids = new Set(filteredObjects.map(o => o.id));
    const updated = detectedObjects.filter(o => !ids.has(o.id));
    setDetectedObjects(updated);
    setThumbnails(prev => {
      const n = { ...prev };
      ids.forEach(id => delete n[id]);
      return n;
    });
    try { await saveObjectsToBackend(projectId, updated); } catch (e) { console.error('Error:', e); }
  }, [detectedObjects, projectId, columnFilters]);

  // ─── Column / Subclass management ────────────────────────────────────
  const handleAddColumn = useCallback(async (columnName) => {
    if (!columnName?.trim() || !selectedClass) return;
    const columnId = `custom_${Date.now()}`;
    const newColumn = { id: columnId, name: columnName.trim(), editable: true, deletable: true, filterable: true, isCustom: true, defaultWidth: 180 };
    const existing = project?.classColumns?.[selectedClass.name] || [];
    const updatedProject = {
      ...project,
      classColumns: { ...(project.classColumns || {}), [selectedClass.name]: [...existing, newColumn] },
    };
    setProject(updatedProject);
    setClassColumnWidths(prev => ({
      ...prev,
      [selectedClass.name]: { ...(prev[selectedClass.name] || {}), [columnId]: 150 },
    }));
    try { await saveProject(updatedProject); } catch (e) { console.error('Error:', e); }
  }, [project, selectedClass]);

  const handleAddSubclass = useCallback(async (subName) => {
    if (!subName?.trim() || !selectedClass) return;
    const existingSubs = getSelectedClassSubclasses();
    if (existingSubs.some(s => s.name.toLowerCase() === subName.trim().toLowerCase())) {
      alert(`Subclass "${subName}" already exists.`);
      return;
    }
    const rootClass = project.classes?.find(c => c.name === selectedClass.name && !c.parentId);
    const parentId = rootClass?.id || selectedClass.id;
    const newSub = { id: `class_${Date.now()}_sub`, name: subName.trim(), parentId, created: new Date().toISOString() };
    const updatedProject = { ...project, classes: [...(project.classes || []), newSub] };
    setProject(updatedProject);
    try { await saveProject(updatedProject); } catch (e) { console.error('Error:', e); }
  }, [project, selectedClass, getSelectedClassSubclasses]);

  const handleDeleteColumn = useCallback(async (columnId) => {
    if (!selectedClass) return;
    const column = columns.find(c => c.id === columnId);
    if (!confirm(`Delete column "${column?.name}"?`)) return;

    const className = selectedClass.name;
    const newWidths = { ...classColumnWidths };
    if (newWidths[className]) delete newWidths[className][columnId];

    if (column?.isSubclass && column?.subclassId) {
      const updatedClasses = (project.classes || []).filter(c => c.id !== column.subclassId);
      const updatedObjects = detectedObjects.map(obj => {
        if ((obj.label || obj.className) === className && obj.subclassValues) {
          const vals = { ...obj.subclassValues };
          delete vals[column.subclassName];
          return { ...obj, subclassValues: vals };
        }
        return obj;
      });
      const updatedProject = { ...project, classes: updatedClasses, classColumnWidths: newWidths };
      setProject(updatedProject);
      setDetectedObjects(updatedObjects);
      setClassColumnWidths(newWidths);
      try { await saveProject(updatedProject); await saveObjectsToBackend(projectId, updatedObjects); } catch (e) { console.error('Error:', e); }
      return;
    }

    const existing = project?.classColumns?.[className] || [];
    const updatedObjects = detectedObjects.map(obj => {
      if ((obj.label || obj.className) === className) {
        const n = { ...obj };
        delete n[columnId];
        return n;
      }
      return obj;
    });
    const updatedProject = {
      ...project,
      classColumns: { ...(project.classColumns || {}), [className]: existing.filter(c => c.id !== columnId) },
      classColumnWidths: newWidths,
    };
    setProject(updatedProject);
    setDetectedObjects(updatedObjects);
    setClassColumnWidths(newWidths);
    try { await saveProject(updatedProject); await saveObjectsToBackend(projectId, updatedObjects); } catch (e) { console.error('Error:', e); }
  }, [selectedClass, columns, project, detectedObjects, classColumnWidths, projectId]);

  // Column resize
  const handleResizeStart = useCallback((e, columnId) => {
    if (!selectedClass) return;
    e.preventDefault();
    const className = selectedClass.name;
    const startX = e.clientX;
    const startWidth = getColumnWidth(columnId);
    let currentWidth = startWidth;

    const onMove = (me) => {
      currentWidth = Math.max(80, startWidth + (me.clientX - startX));
      setClassColumnWidths(prev => ({ ...prev, [className]: { ...(prev[className] || {}), [columnId]: currentWidth } }));
    };
    const onUp = async () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const newWidths = { ...classColumnWidths, [className]: { ...(classColumnWidths[className] || {}), [columnId]: currentWidth } };
      const updatedProject = { ...project, classColumnWidths: newWidths };
      setProject(updatedProject);
      try { await saveProject(updatedProject); } catch (e) { console.error('Error:', e); }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [selectedClass, getColumnWidth, classColumnWidths, project]);

  // ─── Cell editing ────────────────────────────────────────────────────
  const startEditing = useCallback((objId, columnId, currentValue) => {
    setEditingCell({ rowId: objId, column: columnId });
    setEditValue(currentValue || '');
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingCell) return;
    const updated = detectedObjects.map(obj => {
      if (obj.id !== editingCell.rowId) return obj;
      if (editingCell.column.startsWith('subclass_')) {
        const sub = editingCell.column.replace('subclass_', '');
        return { ...obj, subclassValues: { ...(obj.subclassValues || {}), [sub]: editValue } };
      }
      return { ...obj, [editingCell.column]: editValue };
    });
    setDetectedObjects(updated);
    try { await saveObjectsToBackend(projectId, updated); } catch (e) { console.error('Error:', e); }
    setEditingCell(null);
    setEditValue('');
  }, [editingCell, editValue, detectedObjects, projectId]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  // ─── Color/settings update helper ────────────────────────────────────
  const updateClassProperty = useCallback(async (propName, value) => {
    if (!selectedClass || !project) return;
    const existingClasses = project.classes || [];
    const classExists = existingClasses.some(c => c.id === selectedClass.id || c.name === selectedClass.name);
    let updatedClasses;
    if (classExists) {
      updatedClasses = existingClasses.map(c =>
        (c.id === selectedClass.id || c.name === selectedClass.name) ? { ...c, [propName]: value } : c
      );
    } else {
      updatedClasses = [...existingClasses, {
        id: selectedClass.id || `class_${Date.now()}`,
        name: selectedClass.name,
        [propName]: value,
        shapeType: selectedClass.shapeType || 'rectangle',
        created: new Date().toISOString(),
      }];
    }
    const updatedProject = { ...project, classes: updatedClasses };
    setProject(updatedProject);
    setSelectedClass({ ...selectedClass, [propName]: value });
    setClasses(extractClasses(updatedProject, detectedObjects));
    try { await saveProject(updatedProject); } catch (e) { console.error('Error:', e); }
  }, [selectedClass, project, extractClasses, detectedObjects]);

  // ─── Orphaned objects ────────────────────────────────────────────────
  const orphanedObjectsInfo = useMemo(() => {
    const orphaned = detectedObjects.filter(obj => obj.status === 'orphaned');
    const byFile = {};
    orphaned.forEach(obj => {
      const key = obj.originalFilename || 'Unknown';
      (byFile[key] = byFile[key] || []).push(obj);
    });
    return { total: orphaned.length, byFile, fileNames: Object.keys(byFile) };
  }, [detectedObjects]);

  const handleReassignKeepBoxes = useCallback(async () => {
    if (!reassignSourceFile || !reassignTargetFile) return;
    setIsReassigning(true);
    try {
      const updated = detectedObjects.map(obj =>
        obj.status === 'orphaned' && obj.originalFilename === reassignSourceFile
          ? { ...obj, status: 'active', filename: reassignTargetFile.backendFilename, originalFilename: undefined }
          : obj
      );
      setDetectedObjects(updated);
      await saveObjectsToBackend(projectId, updated);
      setShowReassignDialog(false);
      setReassignSourceFile(null);
      setReassignTargetFile(null);
    } catch (e) {
      console.error('Error reassigning:', e);
      alert('Failed to reassign: ' + e.message);
    } finally {
      setIsReassigning(false);
    }
  }, [reassignSourceFile, reassignTargetFile, detectedObjects, projectId]);

  const confirmDeleteAllOrphaned = useCallback(async () => {
    const updated = detectedObjects.filter(obj => obj.status !== 'orphaned');
    setDetectedObjects(updated);
    setShowDeleteOrphanedDialog(false);
    try { await saveObjectsToBackend(projectId, updated); } catch (e) { console.error('Error:', e); }
  }, [detectedObjects, projectId]);

  const deleteOrphanedAndRedetect = useCallback(async () => {
    const updated = detectedObjects.filter(obj => obj.status !== 'orphaned');
    setDetectedObjects(updated);
    setShowDeleteOrphanedDialog(false);
    try { await saveObjectsToBackend(projectId, updated); } catch (e) { console.error('Error:', e); }
    navigate(`/project/${projectId}`, { state: { openObjectFinder: true } });
  }, [detectedObjects, projectId, navigate]);

  // ─── Thumbnails ──────────────────────────────────────────────────────
  const loadThumbnail = useCallback(async (obj) => {
    if (!obj?.id || !obj?.filename || !obj?.bbox) return;
    if (thumbnails[obj.id] || loadingThumbnails[obj.id]) return;
    setLoadingThumbnails(prev => ({ ...prev, [obj.id]: true }));
    try {
      const thumb = await getThumbnail(obj.filename, obj.page || 0, obj.bbox, obj.detected_rotation || 0, obj.detected_inverted || false);
      setThumbnails(prev => ({ ...prev, [obj.id]: thumb }));
    } catch (e) {
      console.error('Failed to load thumbnail:', e);
      setThumbnails(prev => ({ ...prev, [obj.id]: null }));
    } finally {
      setLoadingThumbnails(prev => ({ ...prev, [obj.id]: false }));
    }
  }, [thumbnails, loadingThumbnails]);

  // ─── Filtered classes for sidebar search ─────────────────────────────
  const getFilteredClasses = useCallback((query) => {
    return classes.filter(cls => cls.name.toLowerCase().includes((query || '').toLowerCase()));
  }, [classes]);

  // ─── Class path helper ───────────────────────────────────────────────
  const getClassPath = useCallback((cls) => {
    if (!cls) return '';
    const path = [cls.name];
    let current = cls;
    while (current.parentId) {
      const parent = allProjectClasses.find(c => c.id === current.parentId);
      if (parent) { path.unshift(parent.name); current = parent; } else break;
    }
    return path.join(' > ');
  }, [allProjectClasses]);

  // ─── Undo/Redo ───────────────────────────────────────────────────────
  const pushUndo = useCallback((snapshot) => {
    setUndoStack(prev => [...prev.slice(-29), snapshot]);
    setRedoStack([]);
  }, []);

  const undo = useCallback(async () => {
    if (undoStack.length === 0) return;
    const snapshot = undoStack[undoStack.length - 1];
    setRedoStack(prev => [...prev, { objects: detectedObjects, project }]);
    setUndoStack(prev => prev.slice(0, -1));
    setDetectedObjects(snapshot.objects);
    setProject(snapshot.project);
    setClasses(extractClasses(snapshot.project, snapshot.objects));
    try {
      await saveProject(snapshot.project);
      await saveObjectsToBackend(projectId, snapshot.objects);
    } catch (e) { console.error('Undo save error:', e); }
  }, [undoStack, detectedObjects, project, projectId, extractClasses]);

  const redo = useCallback(async () => {
    if (redoStack.length === 0) return;
    const snapshot = redoStack[redoStack.length - 1];
    setUndoStack(prev => [...prev, { objects: detectedObjects, project }]);
    setRedoStack(prev => prev.slice(0, -1));
    setDetectedObjects(snapshot.objects);
    setProject(snapshot.project);
    setClasses(extractClasses(snapshot.project, snapshot.objects));
    try {
      await saveProject(snapshot.project);
      await saveObjectsToBackend(projectId, snapshot.objects);
    } catch (e) { console.error('Redo save error:', e); }
  }, [redoStack, detectedObjects, project, projectId, extractClasses]);

  // ─── Duplicate class ────────────────────────────────────────────────
  const handleDuplicateClass = useCallback(async () => {
    if (!selectedClass || !project) return;
    const baseName = selectedClass.name;
    let newName = baseName + ' (copy)';
    let i = 2;
    while ((project.classes || []).some(c => c.name === newName)) {
      newName = `${baseName} (copy ${i++})`;
    }
    const originalConfig = (project.classes || []).find(c => c.name === baseName);
    const newClassConfig = {
      ...(originalConfig || {}),
      id: `class_${Date.now()}`,
      name: newName,
      created: new Date().toISOString(),
    };
    const updatedClassColumns = { ...(project.classColumns || {}) };
    if (updatedClassColumns[baseName]) {
      updatedClassColumns[newName] = JSON.parse(JSON.stringify(updatedClassColumns[baseName]));
    }
    const updatedProject = {
      ...project,
      classes: [...(project.classes || []), newClassConfig],
      classColumns: updatedClassColumns,
    };
    pushUndo({ objects: detectedObjects, project });
    setProject(updatedProject);
    setClasses(extractClasses(updatedProject, detectedObjects));
    try { await saveProject(updatedProject); } catch (e) { console.error('Error duplicating class:', e); }
  }, [selectedClass, project, detectedObjects, extractClasses, pushUndo]);

  // ─── Batch edit field ───────────────────────────────────────────────
  const handleBatchEditField = useCallback(async (objectIds, fieldId, value) => {
    if (!objectIds?.length || !fieldId) return;
    pushUndo({ objects: detectedObjects, project });
    const idSet = new Set(objectIds);
    const updated = detectedObjects.map(obj => {
      if (!idSet.has(obj.id)) return obj;
      const col = (columns || []).find(c => c.id === fieldId);
      if (col?.isSubclass) {
        return { ...obj, subclassValues: { ...(obj.subclassValues || {}), [col.subclassName]: value } };
      }
      return { ...obj, [fieldId]: value };
    });
    setDetectedObjects(updated);
    try { await saveObjectsToBackend(projectId, updated); } catch (e) { console.error('Error batch editing:', e); }
  }, [detectedObjects, project, columns, projectId, pushUndo]);

  return {
    // Core state
    project, setProject, detectedObjects, setDetectedObjects, isLoading,
    classes, setClasses, selectedClass, setSelectedClass,
    // Column state
    columns, classColumnWidths, columnAlignments, columnFilters,
    getColumnWidth, getColumnAlignment, toggleColumnAlignment,
    handleFilterChange: (id, val) => setColumnFilters(prev => ({ ...prev, [id]: val })),
    handleResizeStart,
    // Cell editing
    editingCell, editValue, setEditValue, startEditing, saveEdit, cancelEdit,
    // Cell value helpers
    getCellValue, getRawCellValue, classData,
    // Class CRUD
    handleCreateClass, handleDeleteClass, handleRenameClass, handleDeleteObject, handleDeleteFilteredObjects,
    handleAddColumn, handleAddSubclass, handleDeleteColumn,
    updateClassProperty, extractClasses, refreshData,
    // Subclass/column helpers
    getSelectedClassSubclasses, getClassCustomColumns,
    // Project data
    allProjectClasses, allProjectFiles, getFilteredClasses, getClassPath,
    // Orphaned
    orphanedObjectsInfo,
    showReassignDialog, setShowReassignDialog,
    reassignSourceFile, setReassignSourceFile,
    reassignTargetFile, setReassignTargetFile,
    isReassigning, handleReassignKeepBoxes,
    showDeleteOrphanedDialog, setShowDeleteOrphanedDialog,
    confirmDeleteAllOrphaned, deleteOrphanedAndRedetect,
    // Thumbnails
    thumbnails, loadingThumbnails, loadThumbnail,
    // Undo/Redo
    undo, redo, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0,
    // Batch/Duplicate
    handleBatchEditField, handleDuplicateClass,
  };
}
