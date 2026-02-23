/**
 * DocumentsPanel.jsx
 * 
 * Left-side panel showing project documents and on-canvas slots.
 * 
 * "All" tab: Full nested folder browsing with breadcrumbs, search, and
 *            per-file page expansion — each page is independently addable.
 * "On Canvas" tab: Slots grouped by file, with lock/unlock and annotation management.
 * 
 * The heavy lock/unlock/save workflows are delegated to parent callbacks
 * so this component stays focused on presentation.
 */
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { sortByName, findFolderById, getFolderPath, getAllNestedFiles, getAllNestedFolders } from '../../../utils/fileUtils';

export default function DocumentsPanel({
  // Tab & search state
  documentPanelTab,
  setDocumentPanelTab,
  addPdfSearchQuery,
  setAddPdfSearchQuery,
  // Data
  project,
  slots,
  unlockedSlots,
  slotAnnotations,
  ownedAnnotationIds,
  selectedAnnotation,
  checkedOutDocuments,
  filePageCounts,
  // Callbacks - navigation
  onSlotNavigate,       // (slot, zoom) => void
  onFileClick,          // (file, loadedSlot) => void — add page 1 or navigate
  onAddPage,            // (file, pageNum) => void — add specific page
  onFetchPageCount,     // (file) => Promise<number> — lightweight page count fetch
  onRemoveSlot,         // (slot) => void — remove single page from canvas
  onRemoveFile,         // (fileId) => void — remove all pages of file from canvas
  onRemoveAll,          // () => void — remove everything from canvas
  // Callbacks - lock/unlock
  onToggleSlotLock,     // (slot) => Promise<void>
  onToggleAllLocks,     // () => Promise<void>
  // Callbacks - annotations
  onSelectAnnotation,   // (annotation, slotId) => void
  onDeleteAnnotation,   // (slotId, annotationId) => void
  // Panel
  onClose,
  // View lock
  viewLocked,
}) {
  const allUnlocked = slots.length > 0 && slots.every(slot => unlockedSlots.has(slot.id));

  const [currentFolderId, setCurrentFolderId] = useState(null);

  // ── Resize logic ──
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = localStorage.getItem('iv-doc-panel-width');
    return saved ? Math.max(320, Math.min(500, Number(saved))) : 320;
  });
  const isResizing = useRef(false);
  const latestWidth = useRef(panelWidth);

  const handleResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = latestWidth.current;

    const onMouseMove = (e) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(320, Math.min(500, startWidth + (e.clientX - startX)));
      latestWidth.current = newWidth;
      setPanelWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      localStorage.setItem('iv-doc-panel-width', String(latestWidth.current));
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const folderPath = useMemo(() => {
    if (!currentFolderId) return [];
    return getFolderPath(project?.folders || [], currentFolderId) || [];
  }, [currentFolderId, project?.folders]);

  const navigateToFolder = (folderId) => {
    setCurrentFolderId(folderId);
    setAddPdfSearchQuery('');
  };

  const navigateToRoot = () => {
    setCurrentFolderId(null);
    setAddPdfSearchQuery('');
  };

  return (
    <div className="smart-links-panel left-panel" style={{ width: panelWidth }}>
      {/* Resize handle */}
      <div className="iv-panel-resize-handle" onMouseDown={handleResizeMouseDown} />
      {/* Header — breadcrumb replaces "Documents" title */}
      <div className="panel-header iv-doc-panel-header">
        <div className="iv-breadcrumb">
          <span 
            className={`iv-breadcrumb-item ${!currentFolderId ? 'active' : ''}`}
            onClick={navigateToRoot}
            title="Root"
          >
            <svg className="iv-breadcrumb-home" viewBox="0 0 16 16" fill="none">
              <path d="M2 8L8 2L14 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4 7V13H12V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
          {folderPath.length > 3 ? (
            <>
              <span className="iv-breadcrumb-item">
                <span className="iv-breadcrumb-arrow">›</span>
                <span className="iv-breadcrumb-ellipsis">…</span>
              </span>
              {folderPath.slice(-2).map((folder, idx) => (
                <span key={folder.id} className="iv-breadcrumb-item">
                  <span className="iv-breadcrumb-arrow">›</span>
                  <span 
                    className={`iv-breadcrumb-folder ${idx === 1 ? 'active' : ''}`}
                    onClick={() => navigateToFolder(folder.id)}
                    title={folder.name}
                  >
                    {folder.name.length > 12 ? folder.name.substring(0, 12) + '…' : folder.name}
                  </span>
                </span>
              ))}
            </>
          ) : (
            folderPath.map((folder, idx) => (
              <span key={folder.id} className="iv-breadcrumb-item">
                <span className="iv-breadcrumb-arrow">›</span>
                <span 
                  className={`iv-breadcrumb-folder ${idx === folderPath.length - 1 ? 'active' : ''}`}
                  onClick={() => navigateToFolder(folder.id)}
                  title={folder.name}
                >
                  {folder.name.length > 12 ? folder.name.substring(0, 12) + '…' : folder.name}
                </span>
              </span>
            ))
          )}
        </div>
        <button className="close-panel" onClick={onClose}>×</button>
      </div>
      <div className="panel-content">
        {/* Tab buttons */}
        <div className="panel-tabs">
          <button 
            className={`panel-tab ${documentPanelTab === 'all' ? 'active' : ''}`}
            onClick={() => setDocumentPanelTab('all')}
          >
            All
          </button>
          <button 
            className={`panel-tab ${documentPanelTab === 'canvas' ? 'active' : ''}`}
            onClick={() => setDocumentPanelTab('canvas')}
          >
            On Canvas ({slots.length})
          </button>
        </div>
        
        {documentPanelTab === 'canvas' && (
          <OnCanvasTab
            slots={slots}
            unlockedSlots={unlockedSlots}
            slotAnnotations={slotAnnotations}
            ownedAnnotationIds={ownedAnnotationIds}
            selectedAnnotation={selectedAnnotation}
            checkedOutDocuments={checkedOutDocuments}
            allUnlocked={allUnlocked}
            onSlotNavigate={onSlotNavigate}
            onToggleSlotLock={onToggleSlotLock}
            onToggleAllLocks={onToggleAllLocks}
            onSelectAnnotation={onSelectAnnotation}
            onDeleteAnnotation={onDeleteAnnotation}
            onRemoveSlot={onRemoveSlot}
            onRemoveFile={onRemoveFile}
            onRemoveAll={onRemoveAll}
            viewLocked={viewLocked}
          />
        )}
        
        {documentPanelTab === 'all' && (
          <AllFilesTab
            project={project}
            searchQuery={addPdfSearchQuery}
            setSearchQuery={setAddPdfSearchQuery}
            currentFolderId={currentFolderId}
            navigateToFolder={navigateToFolder}
            slots={slots}
            unlockedSlots={unlockedSlots}
            slotAnnotations={slotAnnotations}
            ownedAnnotationIds={ownedAnnotationIds}
            filePageCounts={filePageCounts}
            onFileClick={onFileClick}
            onAddPage={onAddPage}
            onFetchPageCount={onFetchPageCount}
            onRemoveSlot={onRemoveSlot}
            onRemoveFile={onRemoveFile}
            viewLocked={viewLocked}
          />
        )}
      </div>
    </div>
  );
}


/* ── On Canvas Tab ────────────────────────────────────────────────────── */

function OnCanvasTab({
  slots,
  unlockedSlots,
  slotAnnotations,
  ownedAnnotationIds,
  selectedAnnotation,
  checkedOutDocuments,
  allUnlocked,
  onSlotNavigate,
  onToggleSlotLock,
  onToggleAllLocks,
  onSelectAnnotation,
  onDeleteAnnotation,
  onRemoveSlot,
  onRemoveFile,
  onRemoveAll,
  viewLocked,
}) {
  const [searchQuery, setSearchQuery] = useState('');

  // Group slots by fileId
  const fileGroups = useMemo(() => {
    const groups = {};
    slots.forEach(slot => {
      if (!groups[slot.fileId]) {
        groups[slot.fileId] = {
          fileId: slot.fileId,
          fileName: slot.fileName,
          numPages: slot.numPages,
          slots: [],
        };
      }
      groups[slot.fileId].slots.push(slot);
    });
    // Sort pages within each group
    Object.values(groups).forEach(g => {
      g.slots.sort((a, b) => a.page - b.page);
    });
    return Object.values(groups);
  }, [slots]);

  // Default all collapsed — track which are EXPANDED instead
  const [expandedFiles, setExpandedFiles] = useState(new Set());

  const toggleFileCollapse = (fileId) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  // Filter by search
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return fileGroups;
    const q = searchQuery.toLowerCase();
    return fileGroups.filter(g => g.fileName.toLowerCase().includes(q));
  }, [fileGroups, searchQuery]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Search + action bar */}
      {slots.length > 0 && (
        <>
          <div className="iv-browse-search">
            <div className="iv-sidebar-search">
              <svg className="iv-search-icon" width="12" height="12" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M10 10L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <input
                type="text"
                placeholder="Search files..."
                value={searchQuery || ''}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="iv-search-clear" onClick={() => setSearchQuery('')}>×</button>
              )}
            </div>
          </div>
          <div style={{ padding: '0 8px 6px' }}>
            <div style={{ display: 'flex', gap: '4px' }}>
            <button
              className="slot-unlock-btn"
              onClick={onToggleAllLocks}
              style={{
                padding: '4px 10px',
                fontSize: '10px',
                background: 'transparent',
                color: allUnlocked ? '#27ae60' : '#777',
                border: `1px solid ${allUnlocked ? '#27ae60' : '#555'}`,
                borderRadius: '3px',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              {allUnlocked ? '🔓 Lock All' : '🔒 Unlock All'}
            </button>
            <div style={{ flex: 1 }} />
            {!viewLocked && (
            <button
              onClick={onRemoveAll}
              style={{
                padding: '4px 10px',
                fontSize: '10px',
                background: 'transparent',
                color: '#888',
                border: '1px solid #444',
                borderRadius: '3px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => { e.target.style.color = '#e74c3c'; e.target.style.borderColor = '#e74c3c'; }}
              onMouseLeave={(e) => { e.target.style.color = '#888'; e.target.style.borderColor = '#444'; }}
            >
              🗑 Remove All
            </button>
            )}
          </div>
        </div>
        </>
      )}
      
      {/* Scrollable file list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {slots.length === 0 ? (
          <div style={{ padding: '20px', color: '#666', fontSize: '13px', textAlign: 'center' }}>
            No PDFs on canvas yet.<br/>
            <span style={{ fontSize: '11px' }}>Use the "All" tab to add documents.</span>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div style={{ padding: '16px', color: '#666', fontSize: '12px', textAlign: 'center' }}>
            No documents matching "{searchQuery}"
          </div>
        ) : (
          filteredGroups.map(group => {
            const isExpanded = expandedFiles.has(group.fileId);
            const totalOnCanvas = group.slots.length;
            const isSinglePage = group.slots.length === 1 && group.numPages <= 1;
            const groupAllUnlocked = group.slots.every(slot => unlockedSlots.has(slot.id));
            const isCheckedOutElsewhere = checkedOutDocuments[group.fileId] && checkedOutDocuments[group.fileId] !== 'infiniteview';

            const handleGroupLockToggle = (e) => {
              e.stopPropagation();
              if (isCheckedOutElsewhere) {
                alert(`This document is currently being edited in ${checkedOutDocuments[group.fileId] === 'pdfviewer' ? 'PDF Viewer' : 'another view'}. Please close it there first.`);
                return;
              }
              // Toggle all slots in the group
              group.slots.forEach(slot => {
                const slotUnlocked = unlockedSlots.has(slot.id);
                // If group is all unlocked, lock all; otherwise unlock all
                if (groupAllUnlocked ? slotUnlocked : !slotUnlocked) {
                  onToggleSlotLock(slot);
                }
              });
            };

            return (
              <div key={group.fileId} className="iv-file-group">
                {/* File group header */}
                <div 
                  className="iv-file-group-header"
                  onClick={() => {
                    if (isSinglePage) {
                      onSlotNavigate(group.slots[0], 0.6);
                    } else {
                      toggleFileCollapse(group.fileId);
                    }
                  }}
                >
                  {/* Only show expand chevron for multi-page docs */}
                  {!isSinglePage && (
                    <svg 
                      className={`iv-expand-chevron ${isExpanded ? 'expanded' : ''}`}
                      viewBox="0 0 16 16" fill="none"
                    >
                      <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                  {/* Lock icon replaces PDF icon */}
                  <button
                    className={`iv-file-lock-btn ${groupAllUnlocked ? 'unlocked' : ''} ${isCheckedOutElsewhere ? 'disabled' : ''}`}
                    onClick={handleGroupLockToggle}
                    disabled={isCheckedOutElsewhere}
                    title={isCheckedOutElsewhere ? 'Document is being edited elsewhere' : (groupAllUnlocked ? 'Lock document' : 'Unlock for editing')}
                  >
                    <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
                      {groupAllUnlocked ? (
                        <>
                          <rect x="3" y="9" width="10" height="6.5" rx="1.5" fill="#f5c842" stroke="#e6b422" strokeWidth="0.8"/>
                          <path d="M4.5 9V5a3 3 0 016 0" stroke="#e0e0e0" strokeWidth="2" strokeLinecap="round"/>
                          <circle cx="8" cy="12" r="1" fill="#1a1a1a"/>
                        </>
                      ) : (
                        <>
                          <rect x="3" y="8" width="10" height="7" rx="1.5" fill="#d4a017" stroke="#b8860b" strokeWidth="0.8"/>
                          <path d="M5.5 8V5.5a2.5 2.5 0 015 0V8" stroke="#a8a8a8" strokeWidth="1.5" strokeLinecap="round"/>
                          <circle cx="8" cy="11.5" r="1" fill="#1a1a1a"/>
                        </>
                      )}
                    </svg>
                  </button>
                  <div className="iv-file-group-info">
                    <span className="iv-file-group-name">{group.fileName}</span>
                    <span className="iv-file-group-meta">
                      {isSinglePage
                        ? (groupAllUnlocked ? 'Unlocked' : 'Locked')
                        : <>
                            {groupAllUnlocked ? 'Unlocked' : 'Locked'}
                            {' · '}{totalOnCanvas} page{totalOnCanvas !== 1 ? 's' : ''}
                            {group.numPages > 1 && ` / ${group.numPages} total`}
                          </>
                      }
                    </span>
                  </div>
                  {!viewLocked && (
                  <button
                    className="iv-remove-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveFile(group.fileId);
                    }}
                    title="Remove all pages from canvas"
                  >
                    ×
                  </button>
                  )}
                </div>

                {/* Page slots (collapsible — only for multi-page docs) */}
                {!isSinglePage && isExpanded && group.slots.map(slot => (
                  <SlotItem
                    key={slot.id}
                    slot={slot}
                    isUnlocked={unlockedSlots.has(slot.id)}
                    annotations={slotAnnotations[slot.id] || []}
                    ownedAnnotationIds={ownedAnnotationIds[slot.id] || new Set()}
                    selectedAnnotation={selectedAnnotation}
                    checkedOutDocuments={checkedOutDocuments}
                    onNavigate={() => onSlotNavigate(slot, 0.6)}
                    onToggleLock={() => onToggleSlotLock(slot)}
                    onSelectAnnotation={onSelectAnnotation}
                    onDeleteAnnotation={onDeleteAnnotation}
                    onRemove={viewLocked ? undefined : () => onRemoveSlot(slot)}
                    showPageOnly
                    hideLock
                  />
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}


/* ── Slot Item ────────────────────────────────────────────────────────── */

function SlotItem({
  slot,
  isUnlocked,
  annotations,
  ownedAnnotationIds,
  selectedAnnotation,
  checkedOutDocuments,
  onNavigate,
  onToggleLock,
  onSelectAnnotation,
  onDeleteAnnotation,
  onRemove,
  showPageOnly = false, // When true, show "Page N" instead of full filename
  hideLock = false, // When true, hide the per-slot lock button (lock is at group level)
}) {
  const hasNewAnnotations = annotations.some(ann => !ann.fromPdf);
  const hasChanges = hasNewAnnotations || ownedAnnotationIds.size > 0;
  const isCheckedOutElsewhere = checkedOutDocuments[slot.fileId] && checkedOutDocuments[slot.fileId] !== 'infiniteview';

  return (
    <div 
      className={`canvas-slot-item ${isUnlocked ? 'unlocked' : ''} ${showPageOnly ? 'iv-page-slot' : ''}`}
    >
      <div className="iv-slot-row">
        <div className="iv-slot-main" onClick={onNavigate} title={showPageOnly ? `Page ${slot.page}` : slot.fileName}>
          {hasChanges && <span className="iv-unsaved-dot" title="Unsaved changes">*</span>}
          <span className="iv-slot-label">
            {showPageOnly ? `Page ${slot.page}` : slot.fileName}
          </span>
          {!showPageOnly && slot.numPages > 1 && (
            <span className="iv-slot-page-info">Page {slot.page}/{slot.numPages}</span>
          )}
        </div>
        {onRemove && (
          <button
            className="iv-remove-btn"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            title="Remove from canvas"
          >
            ×
          </button>
        )}
      </div>
      
      {!hideLock && (
      <button
        className={`slot-unlock-btn ${isUnlocked ? 'unlocked' : ''} ${isCheckedOutElsewhere ? 'disabled' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          if (isCheckedOutElsewhere) {
            alert(`This document is currently being edited in ${checkedOutDocuments[slot.fileId] === 'pdfviewer' ? 'PDF Viewer' : 'another view'}. Please close it there first.`);
            return;
          }
          onToggleLock();
        }}
        disabled={isCheckedOutElsewhere}
        title={isCheckedOutElsewhere ? 'Document is being edited elsewhere' : (isUnlocked ? 'Lock document' : 'Unlock for editing')}
        style={{
          padding: '1px 4px',
          fontSize: '9px',
          background: 'transparent',
          color: isCheckedOutElsewhere ? '#666' : (isUnlocked ? '#27ae60' : '#777'),
          border: `1px solid ${isCheckedOutElsewhere ? '#444' : (isUnlocked ? '#27ae60' : '#555')}`,
          borderRadius: '2px',
          cursor: isCheckedOutElsewhere ? 'not-allowed' : 'pointer',
          whiteSpace: 'nowrap',
          opacity: isCheckedOutElsewhere ? 0.5 : 1,
          alignSelf: 'flex-start',
          letterSpacing: '0.3px',
          marginTop: '2px'
        }}
      >
        {isUnlocked ? '✓ Editing' : 'Unlock'}
      </button>
      )}
    </div>
  );
}


/* ── All Files Tab — Folder Browsing with Page Expansion ──────────────── */

function AllFilesTab({
  project,
  searchQuery,
  setSearchQuery,
  currentFolderId,
  navigateToFolder,
  slots,
  unlockedSlots,
  slotAnnotations,
  ownedAnnotationIds,
  filePageCounts,
  onFileClick,
  onAddPage,
  onFetchPageCount,
  onRemoveSlot,
  onRemoveFile,
  viewLocked,
}) {
  const [expandedFiles, setExpandedFiles] = useState(new Set());
  const [loadingPageCounts, setLoadingPageCounts] = useState(new Set());

  // Current folder contents
  const currentContents = useMemo(() => {
    if (!currentFolderId) {
      return {
        subfolders: project?.folders || [],
        files: project?.files || [],
      };
    }
    const folder = findFolderById(project?.folders || [], currentFolderId);
    if (!folder) {
      return {
        subfolders: project?.folders || [],
        files: project?.files || [],
      };
    }
    return {
      subfolders: folder.subfolders || [],
      files: folder.files || [],
    };
  }, [currentFolderId, project?.folders, project?.files]);

  // Filtered contents (search or direct)
  const { filteredSubfolders, filteredFiles } = useMemo(() => {
    if (searchQuery?.trim()) {
      const q = searchQuery.toLowerCase();
      const allFolders = getAllNestedFolders(currentContents.subfolders);
      const allFiles = [
        ...currentContents.files.map(f => ({ ...f, folderName: null })),
        ...getAllNestedFiles(currentContents.subfolders)
      ];
      return {
        filteredSubfolders: sortByName(allFolders.filter(f => f.name.toLowerCase().includes(q))),
        filteredFiles: sortByName(allFiles.filter(f => f.name.toLowerCase().includes(q)))
      };
    }
    return {
      filteredSubfolders: sortByName(currentContents.subfolders),
      filteredFiles: sortByName(currentContents.files)
    };
  }, [searchQuery, currentContents]);

  // Eagerly fetch page counts for all visible files so we know which are single-page
  const fetchedRef = useRef(new Set());
  useEffect(() => {
    if (!onFetchPageCount) return;
    filteredFiles.forEach(file => {
      if (!filePageCounts[file.id] && !fetchedRef.current.has(file.id)) {
        fetchedRef.current.add(file.id);
        onFetchPageCount(file);
      }
    });
  }, [filteredFiles, filePageCounts, onFetchPageCount]);

  // Toggle page expansion for a file
  const toggleExpand = useCallback(async (file) => {
    const isExpanded = expandedFiles.has(file.id);

    if (isExpanded) {
      setExpandedFiles(prev => { const n = new Set(prev); n.delete(file.id); return n; });
      return;
    }

    // If we already know it's single-page, don't expand
    if (filePageCounts[file.id] === 1) return;

    // If count not known yet, fetch and check
    if (!filePageCounts[file.id] && onFetchPageCount) {
      setLoadingPageCounts(prev => new Set(prev).add(file.id));
      const count = await onFetchPageCount(file);
      setLoadingPageCounts(prev => { const n = new Set(prev); n.delete(file.id); return n; });
      if (count === 1) return;
    }

    setExpandedFiles(prev => { const n = new Set(prev); n.add(file.id); return n; });
  }, [expandedFiles, filePageCounts, onFetchPageCount]);

  // Get slots for a specific file (to check which pages are on canvas)
  const getFileSlots = useCallback((fileId) => {
    return slots.filter(s => s.fileId === fileId);
  }, [slots]);

  // Start a drag operation for a file+page
  const startFileDrag = useCallback((e, file, page = 1) => {
    const payload = JSON.stringify({ fileId: file.id, page });
    e.dataTransfer.setData('application/iv-file', payload);
    e.dataTransfer.effectAllowed = 'copy';
    // Custom drag ghost with PDF icon
    const ghost = document.createElement('div');
    ghost.style.cssText = 'position:absolute;left:-9999px;display:flex;align-items:center;gap:8px;padding:8px 14px;background:#2a2a2a;color:#fff;border:1px solid #444;border-radius:8px;font-size:13px;white-space:nowrap;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
    // PDF icon
    const icon = document.createElement('div');
    icon.style.cssText = 'width:28px;height:34px;background:#e74c3c;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;letter-spacing:0.5px;flex-shrink:0;position:relative;';
    icon.textContent = 'PDF';
    // Page fold corner
    const fold = document.createElement('div');
    fold.style.cssText = 'position:absolute;top:0;right:0;width:8px;height:8px;background:#c0392b;border-bottom-left-radius:3px;';
    icon.appendChild(fold);
    ghost.appendChild(icon);
    // Label
    const label = document.createElement('div');
    label.style.cssText = 'display:flex;flex-direction:column;gap:1px;min-width:0;';
    const name = document.createElement('div');
    name.style.cssText = 'font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;';
    name.textContent = file.name;
    label.appendChild(name);
    if (page > 1) {
      const pg = document.createElement('div');
      pg.style.cssText = 'font-size:11px;color:#888;';
      pg.textContent = `Page ${page}`;
      label.appendChild(pg);
    }
    ghost.appendChild(label);
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 20, 20);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  }, []);

  return (
    <div className="iv-all-files-tab">
      {/* Search */}
      <div className="iv-browse-search">
        <div className="iv-sidebar-search">
          <svg className="iv-search-icon" width="12" height="12" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10 10L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery || ''}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="iv-search-clear" onClick={() => setSearchQuery('')}>×</button>
          )}
        </div>
      </div>

      {/* Folder/File list */}
      <div className="iv-browse-list">
        {filteredSubfolders.length === 0 && filteredFiles.length === 0 ? (
          <div className="iv-browse-empty">
            {searchQuery ? 'No matches found' : (currentFolderId ? 'This folder is empty' : 'No files yet')}
          </div>
        ) : (
          <>
            {/* Folders */}
            {filteredSubfolders.map(folder => {
              const itemCount = (folder.files?.length || 0) + (folder.subfolders?.length || 0);
              return (
                <div
                  key={folder.id}
                  className="iv-folder-row"
                  onClick={() => navigateToFolder(folder.id)}
                >
                  <svg className="iv-folder-icon" viewBox="0 0 16 16" fill={folder.color || '#3498db'}>
                    <path d="M1 3.5A1.5 1.5 0 012.5 2h3.172a1.5 1.5 0 011.06.44l.658.658A1.5 1.5 0 008.45 3.5H13.5A1.5 1.5 0 0115 5v7.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z"/>
                  </svg>
                  <span className="iv-folder-name">{folder.name}</span>
                  {folder.isLinked && <span className="iv-linked-badge">🔗</span>}
                  <span className="iv-folder-count">{itemCount} items</span>
                  <svg className="iv-folder-chevron" viewBox="0 0 16 16" fill="none">
                    <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              );
            })}

            {/* Files with page expansion */}
            {filteredFiles.map(file => {
              const fileSlots = getFileSlots(file.id);
              const isExpanded = expandedFiles.has(file.id);
              const isLoading = loadingPageCounts.has(file.id);
              const pageCount = filePageCounts[file.id];
              const hasAnyOnCanvas = fileSlots.length > 0;
              const pagesOnCanvas = new Set(fileSlots.map(s => s.page));
              
              // Check for unsaved changes across any slot for this file
              let hasChanges = false;
              fileSlots.forEach(slot => {
                const anns = slotAnnotations[slot.id] || [];
                const ownedIds = ownedAnnotationIds[slot.id] || new Set();
                if (anns.some(a => !a.fromPdf) || ownedIds.size > 0) hasChanges = true;
              });

              return (
                <div key={file.id} className="iv-file-expandable">
                  {/* File row */}
                  <div className={`iv-doc-item ${hasAnyOnCanvas ? 'iv-loaded' : ''}`}>
                    {/* Expand chevron — only shown for confirmed multi-page docs */}
                    {pageCount > 1 && (
                    <button
                      className="iv-expand-toggle"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(file);
                      }}
                      title={isExpanded ? 'Collapse pages' : 'Show pages'}
                    >
                      <svg 
                        className={`iv-expand-chevron ${isExpanded ? 'expanded' : ''}`}
                        viewBox="0 0 16 16" fill="none"
                      >
                        <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                    )}

                    {/* File info — click to add page 1 or navigate, draggable */}
                    <div 
                      className="iv-file-info"
                      draggable={!viewLocked || hasAnyOnCanvas}
                      onDragStart={(e) => {
                        if (viewLocked) { e.preventDefault(); return; }
                        startFileDrag(e, file, 1);
                      }}
                      onClick={() => {
                        const firstSlot = fileSlots.find(s => s.page === 1) || fileSlots[0];
                        onFileClick(file, firstSlot || null);
                      }}
                    >
                      <span className="iv-doc-name">
                        {file.name}
                        {hasChanges && <span className="iv-unsaved">*</span>}
                      </span>
                      <span className="iv-file-page-summary">
                        {hasAnyOnCanvas
                          ? (() => {
                              const allFileUnlocked = fileSlots.every(s => unlockedSlots.has(s.id));
                              const someUnlocked = fileSlots.some(s => unlockedSlots.has(s.id));
                              const lockLabel = allFileUnlocked ? 'Unlocked' : (someUnlocked ? 'Partial' : 'Locked');
                              return `On Canvas — ${lockLabel}`;
                            })()
                          : (pageCount ? `${pageCount} page${pageCount !== 1 ? 's' : ''}` : '')
                        }
                      </span>
                    </div>

                    {searchQuery && file.folderName && (
                      <span className="iv-doc-folder-hint">📁 {file.folderName}</span>
                    )}

                    {hasAnyOnCanvas && !viewLocked && (
                      <button
                        className="iv-remove-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveFile(file.id);
                        }}
                        title="Remove from canvas"
                      >
                        ×
                      </button>
                    )}
                  </div>

                  {/* Expanded page list — only for multi-page docs */}
                  {isExpanded && pageCount > 1 && (
                    <div className="iv-page-list">
                      {isLoading ? (
                        <div className="iv-page-loading">Loading pages…</div>
                      ) : pageCount ? (
                        Array.from({ length: pageCount }, (_, i) => i + 1).map(pageNum => {
                          const isOnCanvas = pagesOnCanvas.has(pageNum);
                          const pageSlot = fileSlots.find(s => s.page === pageNum);
                          return (
                            <div
                              key={pageNum}
                              className={`iv-page-row ${isOnCanvas ? 'on-canvas' : ''}`}
                              draggable={!isOnCanvas && !viewLocked}
                              onDragStart={(e) => {
                                if (viewLocked) { e.preventDefault(); return; }
                                if (!isOnCanvas) startFileDrag(e, file, pageNum);
                              }}
                              onClick={() => {
                                if (isOnCanvas && pageSlot) {
                                  onFileClick(file, pageSlot);
                                } else if (!viewLocked) {
                                  onAddPage(file, pageNum);
                                }
                              }}
                              style={!isOnCanvas && viewLocked ? { opacity: 0.5, cursor: 'default' } : undefined}
                            >
                              <span className="iv-page-num">Page {pageNum}</span>
                              {isOnCanvas ? (
                                <>
                                  <span className="iv-on-canvas">On Canvas</span>
                                  {!viewLocked && (
                                  <button
                                    className="iv-remove-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (pageSlot) onRemoveSlot(pageSlot);
                                    }}
                                    title="Remove from canvas"
                                  >
                                    ×
                                  </button>
                                  )}
                                </>
                              ) : (
                                !viewLocked && <span className="iv-page-add" title="Add to canvas">+</span>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        // If no page count yet (shouldn't happen normally since we fetch on expand)
                        <div className="iv-page-loading">Expand to load pages</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
