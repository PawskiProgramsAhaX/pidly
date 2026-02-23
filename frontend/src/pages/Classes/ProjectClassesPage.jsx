import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { saveObjectsToBackend, saveProject } from '../../utils/storage';

// Hooks
import useClassesData from './hooks/useClassesData.js';
import useFolders from './hooks/useFolders.js';
import useImportExport from './hooks/useImportExport.js';
import useFindReplace from './hooks/useFindReplace.js';
import useRegistrySearch from './hooks/useRegistrySearch.js';

// Layout components
import FolderTree from './sidebar/FolderTree.jsx';
import ClassSettingsPanel from './panels/ClassSettingsPanel.jsx';
import OverviewPanel from './panels/OverviewPanel.jsx';
import SearchPanel from './panels/SearchPanel.jsx';
import ClassDetailPanel from './panels/ClassDetailPanel.jsx';

// Dialogs
import NewClassDialog from './dialogs/NewClassDialog.jsx';
import AddColumnDialog from './dialogs/AddColumnDialog.jsx';
import AddSubclassDialog from './dialogs/AddSubclassDialog.jsx';
import ImportDialog from './dialogs/ImportDialog.jsx';
import ReassignDialog from './dialogs/ReassignDialog.jsx';
import DeleteOrphanedDialog from './dialogs/DeleteOrphanedDialog.jsx';

import './ProjectClassesPage.css';

export default function ProjectClassesPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnToFile = location.state?.returnToFile || null;

  // ─── Column sizing ──────────────────────────────────────────────
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);

  // ─── View mode (for Overview / Object Search panels) ───────────────
  const [viewMode, setViewMode] = useState('classes'); // 'classes', 'home', 'registry'

  // ─── Drag state (class being dragged in folder tree) ────────────
  const [draggingClassName, setDraggingClassName] = useState(null);

  // ─── Folder view mode (nested tree vs current breadcrumb) ──────────
  const [folderViewMode, setFolderViewMode] = useState('current');

  // ─── Gallery display config ───────────────────────────────────────
  const [galleryConfig, setGalleryConfig] = useState({
    textSize: 'small',
    cardHeight: 100,
    showLabels: false,
    showFilename: true,
    showPage: true,
    showConfidence: false,
    visibleColumns: {},
  });

  // ─── Table display config ───────────────────────────────────────
  const [tableConfig, setTableConfig] = useState({
    fontSize: 13,
    headerFontSize: 12,
    fontColor: '#ccc',
  });

  // ─── Dialog visibility ─────────────────────────────────────────────
  const [showNewClassDialog, setShowNewClassDialog] = useState(false);
  const [newClassParentId, setNewClassParentId] = useState(null);
  const [showAddColumnDialog, setShowAddColumnDialog] = useState(false);
  const [showAddSubclassDialog, setShowAddSubclassDialog] = useState(false);

  // ─── Core data hook ────────────────────────────────────────────────
  const data = useClassesData(projectId);

  // Hydrate saved widths and view mode from project once loaded
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (hydrated || !data.project) return;
    if (data.project.classesFolderViewMode) setFolderViewMode(data.project.classesFolderViewMode);
    if (data.project.classesTableConfig) setTableConfig(data.project.classesTableConfig);
    setHydrated(true);
  }, [data.project, hydrated]);

  // ─── Folders hook ──────────────────────────────────────────────────
  const folderHook = useFolders({
    project: data.project,
    setProject: data.setProject,
    classes: data.classes,
  });

  // ─── Import/Export hook ────────────────────────────────────────────
  const importExport = useImportExport({
    project: data.project,
    detectedObjects: data.detectedObjects,
    setDetectedObjects: data.setDetectedObjects,
    selectedClass: data.selectedClass,
    projectId,
    getSelectedClassSubclasses: data.getSelectedClassSubclasses,
    saveObjectsToBackend,
  });

  // ─── Find/Replace hook ─────────────────────────────────────────────
  const findReplace = useFindReplace({
    selectedClass: data.selectedClass,
    classData: data.classData,
    detectedObjects: data.detectedObjects,
    setDetectedObjects: data.setDetectedObjects,
    projectId,
    saveObjectsToBackend,
    getSelectedClassSubclasses: data.getSelectedClassSubclasses,
    getClassCustomColumns: data.getClassCustomColumns,
  });

  // ─── Registry/Search hook ──────────────────────────────────────────
  const registry = useRegistrySearch({
    project: data.project,
    detectedObjects: data.detectedObjects,
  });

  // Save folder view mode to project when toggled
  useEffect(() => {
    if (!data.project) return;
    if (data.project.classesFolderViewMode !== folderViewMode) {
      const updated = { ...data.project, classesFolderViewMode: folderViewMode };
      data.setProject(updated);
      saveProject(updated).catch(e => console.error('Error saving view mode:', e));
    }
  }, [folderViewMode]);

  // Save table config to project when changed
  useEffect(() => {
    if (!data.project || !hydrated) return;
    if (JSON.stringify(data.project.classesTableConfig) !== JSON.stringify(tableConfig)) {
      const updated = { ...data.project, classesTableConfig: tableConfig };
      data.setProject(updated);
      saveProject(updated).catch(e => console.error('Error saving table config:', e));
    }
  }, [tableConfig]);

  // ─── Disable browser zoom ─────────────────────────────────────────
  useEffect(() => {
    const preventZoom = (e) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
    const preventKeyZoom = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) e.preventDefault();
    };
    document.addEventListener('wheel', preventZoom, { passive: false });
    document.addEventListener('keydown', preventKeyZoom);
    return () => { document.removeEventListener('wheel', preventZoom); document.removeEventListener('keydown', preventKeyZoom); };
  }, []);

  // ─── Navigate to object in viewer ──────────────────────────────────
  const handleFindObject = useCallback((obj) => {
    navigate(`/project/${projectId}`, { state: { navigateToObject: obj } });
  }, [navigate, projectId]);

  // ─── Auto-assign new class to current folder ──────────────────────
  const handleCreateClassInFolder = useCallback(async (name, parentId, pendingSubs) => {
    const newClass = await data.handleCreateClass(name, parentId, pendingSubs);
    // Assign to current folder if one is selected
    if (folderHook.selectedFolderId && newClass && !parentId) {
      await folderHook.moveClassToFolder(name, folderHook.selectedFolderId);
    }
    return newClass;
  }, [data.handleCreateClass, folderHook.selectedFolderId, folderHook.moveClassToFolder]);

  // ─── Loading / not found ───────────────────────────────────────────
  if (data.isLoading) return <div className="loading">Loading project...</div>;
  if (!data.project) return <div className="loading">Project not found</div>;

  return (
    <div className="project-classes-page" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <header className="classes-header">
        <button className="back-btn" onClick={() => navigate(`/project/${projectId}`, { state: { returnToFile } })}>
          ← Back to Project
        </button>
        <h1>{data.project.name} - Classes</h1>
        <h1 className="brand-title">pidly</h1>
      </header>

      {/* Three-column layout */}
      <div className="classes-content" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Column 1: Folder Tree (with classes inline) */}
        <FolderTree
          folderTree={folderHook.folderTree}
          folders={folderHook.folders}
          selectedFolderId={folderHook.selectedFolderId}
          setSelectedFolderId={(id) => {
            if (id === folderHook.selectedFolderId && folderViewMode !== 'current') {
              folderHook.setSelectedFolderId(null);
            } else {
              folderHook.setSelectedFolderId(id);
            }
            data.setSelectedClass(null);
            setViewMode('classes');
          }}
          getClassesForFolder={folderHook.getClassesForFolder}
          getClassesForFolderDeep={folderHook.getClassesForFolderDeep}
          // Classes
          classes={data.classes}
          selectedClass={data.selectedClass}
          setSelectedClass={data.setSelectedClass}
          onNewClass={() => { setNewClassParentId(null); setShowNewClassDialog(true); }}
          onDeleteClass={data.handleDeleteClass}
          moveClassToFolder={folderHook.moveClassToFolder}
          // Folder CRUD
          addFolder={folderHook.addFolder}
          renameFolder={folderHook.renameFolder}
          deleteFolder={folderHook.deleteFolder}
          toggleExpanded={folderHook.toggleExpanded}
          reorderFolder={folderHook.reorderFolder}
          editingFolderId={folderHook.editingFolderId}
          setEditingFolderId={folderHook.setEditingFolderId}
          editingFolderName={folderHook.editingFolderName}
          setEditingFolderName={folderHook.setEditingFolderName}
          width={500}
          // Navigation
          viewMode={viewMode}
          setViewMode={setViewMode}
          onOverviewClick={() => { setViewMode('home'); data.setSelectedClass(null); }}
          onSearchClick={() => { setViewMode('registry'); data.setSelectedClass(null); }}
          projectId={projectId}
          returnToFile={returnToFile}
          navigate={navigate}
          // Drag and drop
          draggingClassName={draggingClassName}
          setDraggingClassName={setDraggingClassName}
          onClassDrop={(className, folderId) => {
            folderHook.moveClassToFolder(className, folderId);
            setDraggingClassName(null);
          }}
          // Folder view mode
          folderViewMode={folderViewMode}
          setFolderViewMode={setFolderViewMode}
        />

        {/* Column 2: depends on viewMode */}
        {viewMode === 'home' ? (
          <div className="classes-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <OverviewPanel
              classes={data.classes}
              project={data.project}
              filteredClasses={data.classes}
              onNewClass={() => { setNewClassParentId(null); setShowNewClassDialog(true); }}
              onExportJSON={importExport.handleExportAllJSON}
              onExportExcel={importExport.handleExportAllCSV}
              onImport={() => importExport.fileInputRef.current?.click()}
              fileInputRef={importExport.fileInputRef}
              handleFileSelect={importExport.handleFileSelect}
              orphanedObjectsInfo={data.orphanedObjectsInfo}
              onReassign={() => { data.setReassignSourceFile(null); data.setReassignTargetFile(null); data.setShowReassignDialog(true); }}
              onDeleteAllOrphaned={() => data.setShowDeleteOrphanedDialog(true)}
              setSelectedClass={(cls) => { data.setSelectedClass(cls); setViewMode('classes'); }}
              setViewMode={setViewMode}
            />
          </div>
        ) : viewMode === 'registry' ? (
          <div className="classes-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <SearchPanel
              registrySearchQuery={registry.registrySearchQuery}
              setRegistrySearchQuery={registry.setRegistrySearchQuery}
              smartSearchResults={registry.smartSearchResults}
              getColumnsForClass={registry.getColumnsForClass}
              classes={data.classes}
              setSelectedClass={(cls) => { data.setSelectedClass(cls); setViewMode('classes'); }}
              setViewMode={setViewMode}
            />
          </div>
        ) : (
          /* Classes view: settings panel + data table */
          <>
            {/* Column 2: Class Settings */}
            <ClassSettingsPanel
              selectedClass={data.selectedClass}
              // Highlight Style
              updateClassProperty={data.updateClassProperty}
              // Rename
              onRenameClass={data.handleRenameClass}
              // Columns (for gallery config)
              columns={data.columns}
              // Find & Replace
              findText={findReplace.findText}
              setFindText={findReplace.setFindText}
              replaceText={findReplace.replaceText}
              setReplaceText={findReplace.setReplaceText}
              findField={findReplace.findField}
              setFindField={findReplace.setFindField}
              matchCase={findReplace.matchCase}
              setMatchCase={findReplace.setMatchCase}
              findMatches={findReplace.findMatches}
              handleReplaceAll={findReplace.handleReplaceAll}
              getSearchableFields={findReplace.getSearchableFields}
              // Data
              classData={data.classData}
              // Gallery config
              galleryConfig={galleryConfig}
              setGalleryConfig={setGalleryConfig}
              // Table config
              tableConfig={tableConfig}
              setTableConfig={setTableConfig}
              // Sizing
              collapsed={settingsCollapsed}
            />

            {/* Column 3: Data table for selected class */}
            <div className="classes-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {data.selectedClass ? (
                <ClassDetailPanel
                  selectedClass={data.selectedClass}
                  classData={data.classData}
                  columns={data.columns}
                  getColumnWidth={data.getColumnWidth}
                  getColumnAlignment={data.getColumnAlignment}
                  toggleColumnAlignment={data.toggleColumnAlignment}
                  columnFilters={data.columnFilters}
                  handleFilterChange={data.handleFilterChange}
                  handleResizeStart={data.handleResizeStart}
                  editingCell={data.editingCell}
                  editValue={data.editValue}
                  setEditValue={data.setEditValue}
                  startEditing={data.startEditing}
                  saveEdit={data.saveEdit}
                  cancelEdit={data.cancelEdit}
                  getCellValue={data.getCellValue}
                  thumbnails={data.thumbnails}
                  loadingThumbnails={data.loadingThumbnails}
                  loadThumbnail={data.loadThumbnail}
                  refreshData={data.refreshData}
                  handleDeleteObject={data.handleDeleteObject}
                  handleDeleteFilteredObjects={data.handleDeleteFilteredObjects}
                  handleDeleteClass={data.handleDeleteClass}
                  handleDeleteColumn={data.handleDeleteColumn}
                  extractClasses={data.extractClasses}
                  getSelectedClassSubclasses={data.getSelectedClassSubclasses}
                  // Find/Replace
                  showFindReplace={findReplace.showFindReplace}
                  setShowFindReplace={findReplace.setShowFindReplace}
                  findText={findReplace.findText}
                  setFindText={findReplace.setFindText}
                  replaceText={findReplace.replaceText}
                  setReplaceText={findReplace.setReplaceText}
                  findField={findReplace.findField}
                  setFindField={findReplace.setFindField}
                  matchCase={findReplace.matchCase}
                  setMatchCase={findReplace.setMatchCase}
                  findMatches={findReplace.findMatches}
                  handleReplaceAll={findReplace.handleReplaceAll}
                  getSearchableFields={findReplace.getSearchableFields}
                  // Toolbar actions
                  onAddSubclass={() => setShowAddSubclassDialog(true)}
                  onAddColumn={() => setShowAddColumnDialog(true)}
                  onExport={() => importExport.handleExportCSV(data.classData)}
                  handleFindObject={handleFindObject}
                  project={data.project}
                  // Undo/Redo
                  undo={data.undo}
                  redo={data.redo}
                  canUndo={data.canUndo}
                  canRedo={data.canRedo}
                  // Batch
                  handleBatchEditField={data.handleBatchEditField}
                  // Gallery config
                  galleryConfig={galleryConfig}
                  // Table config
                  tableConfig={tableConfig}
                  // Settings toggle
                  settingsCollapsed={settingsCollapsed}
                  onToggleSettings={() => setSettingsCollapsed(prev => !prev)}
                />
              ) : (
                <div style={{
                  flex: 1, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  color: '#555', background: '#1a1a1a',
                }}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: '16px', opacity: 0.4 }}>
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                  <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>Select a class</div>
                  <div style={{ fontSize: '12px', color: '#444' }}>Choose a class from the sidebar to view its objects</div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ─── Dialogs ─────────────────────────────────────────────────── */}
      <NewClassDialog
        show={showNewClassDialog}
        onClose={() => { setShowNewClassDialog(false); setNewClassParentId(null); }}
        onSubmit={handleCreateClassInFolder}
        parentId={newClassParentId}
        allProjectClasses={data.allProjectClasses}
        getClassPath={data.getClassPath}
        existingClasses={data.allProjectClasses}
      />

      <AddColumnDialog
        show={showAddColumnDialog}
        onClose={() => setShowAddColumnDialog(false)}
        onSubmit={(name) => data.handleAddColumn(name)}
        selectedClassName={data.selectedClass?.name}
      />

      <AddSubclassDialog
        show={showAddSubclassDialog}
        onClose={() => setShowAddSubclassDialog(false)}
        onSubmit={(name) => data.handleAddSubclass(name)}
        selectedClassName={data.selectedClass?.name}
      />

      <ImportDialog
        show={importExport.showImportDialog}
        onClose={() => { importExport.setShowImportDialog(false); importExport.setImportData(null); importExport.setImportError(null); }}
        importData={importExport.importData}
        importError={importExport.importError}
        importMode={importExport.importMode}
        setImportMode={importExport.setImportMode}
        onImport={importExport.handleImport}
      />

      <ReassignDialog
        show={data.showReassignDialog}
        onClose={() => data.setShowReassignDialog(false)}
        orphanedObjectsInfo={data.orphanedObjectsInfo}
        allProjectFiles={data.allProjectFiles}
        reassignSourceFile={data.reassignSourceFile}
        setReassignSourceFile={data.setReassignSourceFile}
        reassignTargetFile={data.reassignTargetFile}
        setReassignTargetFile={data.setReassignTargetFile}
        isReassigning={data.isReassigning}
        onReassignKeepBoxes={data.handleReassignKeepBoxes}
      />

      <DeleteOrphanedDialog
        show={data.showDeleteOrphanedDialog}
        onClose={() => data.setShowDeleteOrphanedDialog(false)}
        orphanedTotal={data.orphanedObjectsInfo.total}
        onDeleteOnly={data.confirmDeleteAllOrphaned}
        onDeleteAndRedetect={data.deleteOrphanedAndRedetect}
      />
    </div>
  );
}
