import { useState, useCallback, useMemo } from 'react';
import { saveProject } from '../../../utils/storage';

/**
 * Folder management hook for organizing classes.
 * 
 * Data model (stored on project.classFolders):
 *   { id, name, parentId, order, expanded }
 * 
 * Each class gets a `folderId` property linking it to one folder.
 * Classes without folderId appear at the root level.
 */
export default function useFolders({ project, setProject, classes }) {
  const [selectedFolderId, setSelectedFolderId] = useState(null); // null = root / all
  const [editingFolderId, setEditingFolderId] = useState(null);
  const [editingFolderName, setEditingFolderName] = useState('');

  // ─── Folders from project ────────────────────────────────────────────
  const folders = useMemo(() => {
    return (project?.classFolders || []).sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [project?.classFolders]);

  // ─── Build tree structure ────────────────────────────────────────────
  const folderTree = useMemo(() => {
    const byParent = {};
    folders.forEach(f => {
      const pid = f.parentId || '__root__';
      (byParent[pid] = byParent[pid] || []).push(f);
    });

    const buildNodes = (parentId) => {
      const children = byParent[parentId] || [];
      return children.map(f => ({
        ...f,
        children: buildNodes(f.id),
      }));
    };
    return buildNodes('__root__');
  }, [folders]);

  // ─── Classes for a given folder ──────────────────────────────────────
  const getClassesForFolder = useCallback((folderId) => {
    if (folderId === null) {
      // "All Classes" — show every class
      return classes;
    }
    return classes.filter(cls => cls.folderId === folderId);
  }, [classes]);

  // Unassigned classes (no folder)
  const unassignedClasses = useMemo(() => {
    return classes.filter(cls => !cls.folderId);
  }, [classes]);

  // Selected folder's classes
  const folderClasses = useMemo(() => {
    return getClassesForFolder(selectedFolderId);
  }, [selectedFolderId, getClassesForFolder]);

  // ─── Get all descendant folder IDs (for showing nested classes) ──────
  const getDescendantIds = useCallback((folderId) => {
    const ids = [folderId];
    const children = folders.filter(f => f.parentId === folderId);
    children.forEach(c => ids.push(...getDescendantIds(c.id)));
    return ids;
  }, [folders]);

  // Classes in folder + all descendants (useful for counts)
  const getClassesForFolderDeep = useCallback((folderId) => {
    if (folderId === null) return classes;
    const allIds = getDescendantIds(folderId);
    return classes.filter(cls => allIds.includes(cls.folderId));
  }, [classes, getDescendantIds]);

  // ─── Persist helper ──────────────────────────────────────────────────
  const saveFolders = useCallback(async (newFolders) => {
    const updated = { ...project, classFolders: newFolders };
    setProject(updated);
    try { await saveProject(updated); } catch (e) { console.error('Error saving folders:', e); }
  }, [project, setProject]);

  const saveClasses = useCallback(async (newClasses) => {
    const updated = { ...project, classes: newClasses };
    setProject(updated);
    try { await saveProject(updated); } catch (e) { console.error('Error saving classes:', e); }
  }, [project, setProject]);

  // ─── CRUD ────────────────────────────────────────────────────────────
  const addFolder = useCallback(async (name, parentId = null) => {
    const maxOrder = folders.filter(f => (f.parentId || null) === parentId)
      .reduce((max, f) => Math.max(max, f.order || 0), -1);
    const newFolder = {
      id: `folder_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      parentId: parentId || null,
      order: maxOrder + 1,
      expanded: true,
    };
    await saveFolders([...folders, newFolder]);
    return newFolder;
  }, [folders, saveFolders]);

  const renameFolder = useCallback(async (folderId, newName) => {
    if (!newName?.trim()) return;
    const updated = folders.map(f => f.id === folderId ? { ...f, name: newName.trim() } : f);
    await saveFolders(updated);
    setEditingFolderId(null);
    setEditingFolderName('');
  }, [folders, saveFolders]);

  const deleteFolder = useCallback(async (folderId) => {
    // Get all descendant folder IDs
    const allIds = getDescendantIds(folderId);

    // Move classes from deleted folders to root (unassign folderId)
    const classesInDeleted = (project?.classes || []).some(c => allIds.includes(c.folderId));
    if (classesInDeleted) {
      const updatedClasses = (project?.classes || []).map(c =>
        allIds.includes(c.folderId) ? { ...c, folderId: null } : c
      );
      // Save both folders and classes
      const updated = {
        ...project,
        classFolders: folders.filter(f => !allIds.includes(f.id)),
        classes: updatedClasses,
      };
      setProject(updated);
      try { await saveProject(updated); } catch (e) { console.error('Error:', e); }
    } else {
      await saveFolders(folders.filter(f => !allIds.includes(f.id)));
    }

    // If we deleted the selected folder, go back to root
    if (allIds.includes(selectedFolderId)) {
      setSelectedFolderId(null);
    }
  }, [folders, project, setProject, saveFolders, getDescendantIds, selectedFolderId]);

  const toggleExpanded = useCallback(async (folderId) => {
    const updated = folders.map(f => f.id === folderId ? { ...f, expanded: !f.expanded } : f);
    await saveFolders(updated);
  }, [folders, saveFolders]);

  // ─── Move folder (reparent) ──────────────────────────────────────────
  const moveFolder = useCallback(async (folderId, newParentId) => {
    // Prevent moving into own descendants
    const descendants = getDescendantIds(folderId);
    if (descendants.includes(newParentId)) return;

    const maxOrder = folders.filter(f => (f.parentId || null) === newParentId)
      .reduce((max, f) => Math.max(max, f.order || 0), -1);

    const updated = folders.map(f =>
      f.id === folderId ? { ...f, parentId: newParentId, order: maxOrder + 1 } : f
    );
    await saveFolders(updated);
  }, [folders, saveFolders, getDescendantIds]);

  // ─── Move class to folder ────────────────────────────────────────────
  const moveClassToFolder = useCallback(async (className, folderId) => {
    const updatedClasses = (project?.classes || []).map(c =>
      c.name === className && !c.parentId ? { ...c, folderId: folderId } : c
    );
    await saveClasses(updatedClasses);
  }, [project?.classes, saveClasses]);

  // ─── Reorder folders within same parent ──────────────────────────────
  const reorderFolder = useCallback(async (folderId, direction) => {
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return;
    const siblings = folders.filter(f => (f.parentId || null) === (folder.parentId || null))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const idx = siblings.findIndex(f => f.id === folderId);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;

    const updated = folders.map(f => {
      if (f.id === siblings[idx].id) return { ...f, order: siblings[swapIdx].order || 0 };
      if (f.id === siblings[swapIdx].id) return { ...f, order: siblings[idx].order || 0 };
      return f;
    });
    await saveFolders(updated);
  }, [folders, saveFolders]);

  // ─── Folder path helper ──────────────────────────────────────────────
  const getFolderPath = useCallback((folderId) => {
    const path = [];
    let current = folders.find(f => f.id === folderId);
    while (current) {
      path.unshift(current.name);
      current = current.parentId ? folders.find(f => f.id === current.parentId) : null;
    }
    return path.join(' / ');
  }, [folders]);

  // ─── Get folder by ID ───────────────────────────────────────────────
  const getFolder = useCallback((folderId) => {
    return folders.find(f => f.id === folderId) || null;
  }, [folders]);

  return {
    folders, folderTree,
    selectedFolderId, setSelectedFolderId,
    folderClasses, unassignedClasses, getClassesForFolder, getClassesForFolderDeep,
    // CRUD
    addFolder, renameFolder, deleteFolder,
    toggleExpanded, moveFolder, moveClassToFolder,
    reorderFolder,
    // Editing
    editingFolderId, setEditingFolderId,
    editingFolderName, setEditingFolderName,
    // Helpers
    getFolderPath, getFolder, getDescendantIds,
  };
}
