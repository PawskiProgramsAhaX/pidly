import { useState, useRef, useEffect, useMemo } from 'react';

/**
 * Folder tree sidebar — leftmost column.
 * Shows folders AND classes inline (like PDFs in FileSidebar).
 * Two view modes:
 *   - Nested: full expandable tree with classes under each folder
 *   - Current: breadcrumb navigation, direct children + classes
 */
export default function FolderTree({
  folderTree, folders,
  selectedFolderId, setSelectedFolderId,
  getClassesForFolder, getClassesForFolderDeep,
  // Classes
  classes, selectedClass, setSelectedClass,
  onNewClass, onDeleteClass,
  moveClassToFolder,
  // CRUD
  addFolder, renameFolder, deleteFolder,
  toggleExpanded, reorderFolder,
  // Editing
  editingFolderId, setEditingFolderId,
  editingFolderName, setEditingFolderName,
  // Sizing
  width, isResizing, onResizeStart,
  // Navigation
  viewMode, setViewMode,
  onOverviewClick, onSearchClick,
  projectId, returnToFile, navigate,
  // Drag and drop
  draggingClassName, setDraggingClassName, onClassDrop,
  // Folder view mode
  folderViewMode, setFolderViewMode,
}) {
  const [showNewInput, setShowNewInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParent, setNewFolderParent] = useState(null);
  const [contextMenu, setContextMenu] = useState(null); // { className, x, y }
  const newInputRef = useRef(null);

  useEffect(() => {
    if (showNewInput && newInputRef.current) newInputRef.current.focus();
  }, [showNewInput]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextMenu]);

  const handleAddFolder = () => {
    if (!newFolderName.trim()) return;
    const parentId = folderViewMode === 'current' ? selectedFolderId : newFolderParent;
    addFolder(newFolderName.trim(), parentId);
    setNewFolderName('');
    setShowNewInput(false);
    setNewFolderParent(null);
  };

  const startAddSubfolder = (parentId) => {
    setNewFolderParent(parentId);
    setNewFolderName('');
    setShowNewInput(true);
  };

  // ─── Breadcrumb path for "Current" mode ────────────────────────────
  const breadcrumbPath = useMemo(() => {
    if (!selectedFolderId) return [];
    const path = [];
    let current = folders.find(f => f.id === selectedFolderId);
    while (current) {
      path.unshift(current);
      current = current.parentId ? folders.find(f => f.id === current.parentId) : null;
    }
    return path;
  }, [selectedFolderId, folders]);

  // Direct child folders of selected folder (for "Current" mode)
  const currentChildFolders = useMemo(() => {
    return folders
      .filter(f => (f.parentId || null) === selectedFolderId)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [folders, selectedFolderId]);

  // Classes for current folder (direct only, for "Current" mode)
  // At root (null), only show unassigned classes
  const currentClasses = useMemo(() => {
    if (selectedFolderId === null) {
      return classes.filter(c => !c.folderId);
    }
    return getClassesForFolder(selectedFolderId);
  }, [selectedFolderId, getClassesForFolder, classes]);

  // Unassigned classes (root level, no folder) — for nested mode
  const rootClasses = useMemo(() => {
    return classes.filter(c => !c.folderId);
  }, [classes]);

  return (
    <div
      className="folder-tree-sidebar"
      style={{
        width, minWidth: 200, maxWidth: 500, flexShrink: 0,
        display: 'flex', flexDirection: 'column',
        background: '#1a1a1a', borderRight: '1px solid #333',
        position: 'relative', userSelect: 'none',
      }}
    >
      {/* Navigation items */}
      <div style={{ borderBottom: '1px solid #333' }}>
        <NavItem
          label="Overview"
          isActive={viewMode === 'home'}
          onClick={onOverviewClick}
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>}
        />
        <NavItem
          label="Object Search"
          isActive={viewMode === 'registry'}
          onClick={onSearchClick}
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>}
        />
      </div>

      {/* Header: toggle + actions */}
      <div style={{ borderBottom: '1px solid #333', padding: '10px 14px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '0',
        }}>
          {/* View mode toggle — Current / Nested */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
            <button
              onClick={() => setFolderViewMode('current')}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: '13px', fontWeight: 600, padding: '4px 2px',
                color: folderViewMode === 'current' ? '#3498db' : '#555',
                transition: 'color 0.15s',
              }}
            >Current</button>
            <span style={{ color: '#333', fontSize: '13px', padding: '0 4px' }}>/</span>
            <button
              onClick={() => setFolderViewMode('nested')}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: '13px', fontWeight: 600, padding: '4px 2px',
                color: folderViewMode === 'nested' ? '#3498db' : '#555',
                transition: 'color 0.15s',
              }}
            >Nested</button>
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={onNewClass}
              title="New class"
              style={{
                background: 'transparent', border: 'none', color: '#555',
                cursor: 'pointer', padding: '4px 6px', borderRadius: '4px',
                fontSize: '12px', fontWeight: 600, transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#3498db'}
              onMouseLeave={(e) => e.currentTarget.style.color = '#555'}
            >
              New Class
            </button>
            <button
              onClick={() => { setNewFolderParent(folderViewMode === 'current' ? selectedFolderId : null); setNewFolderName(''); setShowNewInput(true); }}
              title="New folder"
              style={{
                background: 'transparent', border: 'none', color: '#555',
                cursor: 'pointer', padding: '4px 6px', borderRadius: '4px',
                fontSize: '12px', fontWeight: 600, transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#3498db'}
              onMouseLeave={(e) => e.currentTarget.style.color = '#555'}
            >
              New Folder
            </button>
          </div>
        </div>
      </div>

      {/* Folder + classes content area */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '6px 0', scrollbarWidth: 'thin', scrollbarColor: '#333 transparent' }}>

        {folderViewMode === 'current' ? (
          /* ─── CURRENT MODE: breadcrumb + flat children + classes ── */
          <>
            {/* Breadcrumb */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap',
              padding: '6px 14px 10px', borderBottom: '1px solid #222', marginBottom: '4px',
            }}>
              <BreadcrumbItem
                label={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>}
                isActive={!selectedFolderId}
                onClick={() => setSelectedFolderId(null)}
                draggingClassName={draggingClassName}
                onClassDrop={(name) => onClassDrop?.(name, null)}
              />
              {breadcrumbPath.map((folder, idx) => (
                <span key={folder.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ color: '#555', fontSize: '14px', fontWeight: 700 }}>›</span>
                  <BreadcrumbItem
                    label={folder.name}
                    isActive={idx === breadcrumbPath.length - 1}
                    onClick={() => setSelectedFolderId(folder.id)}
                    draggingClassName={draggingClassName}
                    onClassDrop={(name) => onClassDrop?.(name, folder.id)}
                  />
                </span>
              ))}
            </div>

            {/* Direct child folders */}
            {currentChildFolders.map(folder => (
              <CurrentFolderItem
                key={folder.id}
                folder={folder}
                classCount={getClassesForFolder(folder.id).length}
                subfolderCount={folders.filter(f => f.parentId === folder.id).length}
                onClick={() => setSelectedFolderId(folder.id)}
                onRename={() => { setEditingFolderId(folder.id); setEditingFolderName(folder.name); }}
                onDelete={() => {
                  const count = getClassesForFolderDeep(folder.id).length;
                  const msg = count > 0
                    ? `Delete folder "${folder.name}"?\n\n${count} class(es) inside will be moved to root.`
                    : `Delete folder "${folder.name}"?`;
                  if (confirm(msg)) deleteFolder(folder.id);
                }}
                onAddSubfolder={() => startAddSubfolder(folder.id)}
                isEditing={editingFolderId === folder.id}
                editValue={editingFolderName}
                onEditChange={setEditingFolderName}
                onEditConfirm={() => {
                  if (editingFolderName.trim() && editingFolderName.trim() !== folder.name) {
                    renameFolder(folder.id, editingFolderName.trim());
                  } else { setEditingFolderId(null); }
                }}
                onEditCancel={() => setEditingFolderId(null)}
                draggingClassName={draggingClassName}
                onClassDrop={(name) => onClassDrop?.(name, folder.id)}
              />
            ))}

            {/* Classes in current folder */}
            {currentClasses.map(cls => (
              <ClassItem
                key={cls.name}
                cls={cls}
                depth={0}
                isSelected={selectedClass?.name === cls.name}
                onClick={() => { setSelectedClass(cls); setViewMode('classes'); }}
                onMenuClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  setContextMenu({ className: cls.name, x: rect.right, y: rect.bottom + 2 });
                }}
                onDragStart={() => setDraggingClassName?.(cls.name)}
                onDragEnd={() => setDraggingClassName?.(null)}
              />
            ))}

            {/* Empty state */}
            {currentChildFolders.length === 0 && currentClasses.length === 0 && !showNewInput && (
              <div style={{ padding: '20px 14px', color: '#666', fontSize: '13px', textAlign: 'center', fontWeight: 600 }}>
                {selectedFolderId ? 'Empty folder' : 'No folders or classes yet'}
              </div>
            )}
          </>
        ) : (
          /* ─── NESTED MODE: full expandable tree with classes ──── */
          <>
            {folderTree.map(node => (
              <FolderNode
                key={node.id}
                node={node}
                depth={0}
                selectedFolderId={selectedFolderId}
                setSelectedFolderId={setSelectedFolderId}
                getClassesForFolder={getClassesForFolder}
                getClassesForFolderDeep={getClassesForFolderDeep}
                toggleExpanded={toggleExpanded}
                renameFolder={renameFolder}
                deleteFolder={deleteFolder}
                reorderFolder={reorderFolder}
                startAddSubfolder={startAddSubfolder}
                editingFolderId={editingFolderId}
                setEditingFolderId={setEditingFolderId}
                editingFolderName={editingFolderName}
                setEditingFolderName={setEditingFolderName}
                draggingClassName={draggingClassName}
                onClassDrop={onClassDrop}
                // Class props
                selectedClass={selectedClass}
                setSelectedClass={setSelectedClass}
                setViewMode={setViewMode}
                setContextMenu={setContextMenu}
                setDraggingClassName={setDraggingClassName}
              />
            ))}

            {/* Root-level (unassigned) classes */}
            {rootClasses.length > 0 && (
              <>
                {folders.length > 0 && (
                  <div style={{ padding: '8px 14px 4px', color: '#666', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Unassigned
                  </div>
                )}
                {rootClasses.map(cls => (
                  <ClassItem
                    key={cls.name}
                    cls={cls}
                    depth={0}
                    isSelected={selectedClass?.name === cls.name}
                    onClick={() => { setSelectedClass(cls); setViewMode('classes'); }}
                    onMenuClick={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setContextMenu({ className: cls.name, x: rect.right, y: rect.bottom + 2 });
                    }}
                    onDragStart={() => setDraggingClassName?.(cls.name)}
                    onDragEnd={() => setDraggingClassName?.(null)}
                  />
                ))}
              </>
            )}

            {folderTree.length === 0 && rootClasses.length === 0 && !showNewInput && (
              <div style={{ padding: '20px 14px', color: '#666', fontSize: '13px', textAlign: 'center', fontWeight: 600 }}>
                No folders or classes yet
              </div>
            )}
          </>
        )}

        {/* New folder input */}
        {showNewInput && (
          <div style={{ padding: '4px 14px' }}>
            <input
              ref={newInputRef}
              type="text"
              placeholder="Folder name..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddFolder();
                if (e.key === 'Escape') { setShowNewInput(false); setNewFolderName(''); }
              }}
              onBlur={() => { if (!newFolderName.trim()) { setShowNewInput(false); } else { handleAddFolder(); } }}
              style={{
                width: '100%', padding: '6px 10px', background: '#1e1e1e',
                border: '1px solid #3498db', borderRadius: '4px',
                color: '#fff', fontSize: '15px', fontWeight: 700, outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        )}
      </div>

      {/* Context menu for classes */}
      {contextMenu && (
        <ClassContextMenu
          className={contextMenu.className}
          x={contextMenu.x}
          y={contextMenu.y}
          folders={folders}
          classes={classes}
          moveClassToFolder={moveClassToFolder}
          onDelete={() => { onDeleteClass(contextMenu.className); setContextMenu(null); }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Models footer */}
      <div style={{ marginTop: 'auto', padding: '12px', borderTop: '1px solid #333', background: '#1a1a1a' }}>
        <div style={{ fontSize: '11px', color: '#666', marginBottom: '6px', paddingLeft: '2px' }}>Need to train models?</div>
        <button
          onClick={() => navigate(`/project/${projectId}/models`, { state: { returnToFile } })}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
            padding: '9px 12px', background: '#1e1e1e', border: '1px solid #333',
            borderRadius: '6px', color: '#aaa', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3498db'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#aaa'; }}
        >
          Models
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 'auto', opacity: 0.5 }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Resize handle */}
      <div
        style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: 4,
          cursor: 'col-resize',
          background: isResizing ? '#3498db' : 'transparent',
          transition: 'background 0.15s',
        }}
        onMouseDown={onResizeStart}
        onMouseEnter={(e) => e.currentTarget.style.background = '#3498db'}
        onMouseLeave={(e) => !isResizing && (e.currentTarget.style.background = 'transparent')}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CLASS ITEM — shown inline in both views
   ═══════════════════════════════════════════════════════════════════════ */

function ClassItem({ cls, depth, isSelected, onClick, onMenuClick, onDragStart, onDragEnd }) {
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const indent = 14 + (depth * 16);

  const handleDragStart = (e) => {
    setDragging(true);
    e.dataTransfer.setData('text/plain', cls.name);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart?.();
  };

  return (
    <div
      onClick={onClick}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={() => { setDragging(false); onDragEnd?.(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: `7px 10px 7px ${indent}px`,
        cursor: 'grab', transition: 'all 0.12s',
        background: hovered ? '#1c1c1c' : 'transparent',
        borderLeft: '3px solid transparent',
        opacity: dragging ? 0.4 : 1,
        minHeight: '34px',
      }}
    >
      {/* Class icon */}
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
        stroke={isSelected ? '#3498db' : '#888'} strokeWidth="2" style={{ flexShrink: 0 }}>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '14px', fontWeight: 600,
          color: isSelected ? '#3498db' : '#ccc',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {cls.name}
        </div>
        <div style={{ fontSize: '11px', color: isSelected ? '#2980b9' : '#666' }}>{cls.count} objects</div>
      </div>

      {/* Three-dot menu */}
      <button
        onClick={onMenuClick}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: '4px 4px', borderRadius: '4px', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: hovered ? 1 : 0, transition: 'opacity 0.15s',
          color: '#888',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#333'; e.currentTarget.style.color = '#fff'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#888'; }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CLASS CONTEXT MENU — move to folder, delete
   ═══════════════════════════════════════════════════════════════════════ */

function ClassContextMenu({ className, x, y, folders, classes, moveClassToFolder, onDelete, onClose }) {
  const [showMoveSubmenu, setShowMoveSubmenu] = useState(false);
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      setPos({
        x: Math.min(x, window.innerWidth - rect.width - 8),
        y: Math.min(y, window.innerHeight - rect.height - 8),
      });
    }
  }, [x, y]);

  const cls = classes.find(c => c.name === className);
  const currentFolderId = cls?.folderId || null;

  const buildFolderOptions = (parentId = null, depth = 0) => {
    const items = folders.filter(f => (f.parentId || null) === parentId)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const result = [];
    items.forEach(f => {
      result.push({ ...f, depth });
      result.push(...buildFolderOptions(f.id, depth + 1));
    });
    return result;
  };

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 1000,
        background: '#242424', border: '1px solid #3a3a3a', borderRadius: '8px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        minWidth: '170px', padding: '4px 0', fontSize: '13px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Move to folder */}
      <div
        onMouseEnter={() => setShowMoveSubmenu(true)}
        onMouseLeave={() => setShowMoveSubmenu(false)}
        style={{ position: 'relative' }}
      >
        <MenuItem
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>}
          label="Move to folder"
          hasSubmenu
        />
        {showMoveSubmenu && (
          <div style={{
            position: 'absolute', left: '100%', top: '-4px', zIndex: 1001,
            background: '#242424', border: '1px solid #3a3a3a', borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            minWidth: '190px', padding: '4px 0',
            maxHeight: '300px', overflowY: 'auto',
          }}>
            <FolderMenuItem
              name="Root (no folder)"
              depth={0}
              isCurrent={currentFolderId === null}
              onClick={() => { moveClassToFolder(className, null); onClose(); }}
            />
            <div style={{ height: '1px', background: '#333', margin: '4px 8px' }} />
            {buildFolderOptions().map(f => (
              <FolderMenuItem
                key={f.id}
                name={f.name}
                depth={f.depth}
                isCurrent={f.id === currentFolderId}
                onClick={() => { moveClassToFolder(className, f.id); onClose(); }}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ height: '1px', background: '#333', margin: '4px 8px' }} />

      <MenuItem
        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>}
        label="Delete class"
        danger
        onClick={onDelete}
      />
    </div>
  );
}

function MenuItem({ icon, label, onClick, hasSubmenu, danger }) {
  const [h, setH] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 12px', cursor: 'pointer',
        color: danger ? (h ? '#e74c3c' : '#c0392b') : (h ? '#fff' : '#ccc'),
        background: h ? '#2a2a2a' : 'transparent',
        transition: 'all 0.1s', fontSize: '13px',
      }}
    >
      <span style={{ flexShrink: 0, opacity: 0.7 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {hasSubmenu && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.5 }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}
    </div>
  );
}

function FolderMenuItem({ name, depth, isCurrent, onClick }) {
  const [h, setH] = useState(false);
  return (
    <div
      onClick={isCurrent ? undefined : onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        padding: `6px 12px 6px ${12 + depth * 14}px`,
        fontSize: '13px', cursor: isCurrent ? 'default' : 'pointer',
        color: isCurrent ? '#555' : (h ? '#fff' : '#ccc'),
        background: h && !isCurrent ? '#2a2a2a' : 'transparent',
        display: 'flex', alignItems: 'center', gap: '6px',
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, opacity: 0.6 }}>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
      <span style={{ flex: 1 }}>{name}</span>
      {isCurrent && <span style={{ fontSize: '10px', color: '#444' }}>current</span>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CURRENT MODE — folder row
   ═══════════════════════════════════════════════════════════════════════ */

function BreadcrumbItem({ label, isActive, onClick, draggingClassName, onClassDrop }) {
  const [hovered, setHovered] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  return (
    <span
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setDragOver(false); }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const n = e.dataTransfer.getData('text/plain'); if (n) onClassDrop?.(n); }}
      style={{
        fontSize: '14px', fontWeight: isActive ? 700 : 600, cursor: 'pointer',
        color: dragOver ? '#3498db' : (isActive ? '#fff' : (hovered ? '#e0e0e0' : '#aaa')),
        padding: '3px 5px', borderRadius: '4px',
        background: dragOver ? '#1a2a3a' : (isActive ? '#252525' : 'transparent'),
        transition: 'all 0.12s',
        display: 'flex', alignItems: 'center',
      }}
    >
      {label}
    </span>
  );
}

function CurrentFolderItem({
  folder, classCount, subfolderCount,
  onClick, onRename, onDelete, onAddSubfolder,
  isEditing, editValue, onEditChange, onEditConfirm, onEditCancel,
  draggingClassName, onClassDrop,
}) {
  const [hovered, setHovered] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const editRef = useRef(null);

  useEffect(() => {
    if (isEditing && editRef.current) editRef.current.focus();
  }, [isEditing]);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setDragOver(false); }}
      onDoubleClick={(e) => { e.stopPropagation(); onRename(); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const n = e.dataTransfer.getData('text/plain'); if (n) onClassDrop?.(n); }}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '10px 14px', cursor: 'pointer',
        transition: 'all 0.12s',
        background: dragOver ? '#1a2a3a' : (hovered ? '#1c1c1c' : 'transparent'),
        borderLeft: dragOver ? '3px solid #3498db' : '3px solid transparent',
        outline: dragOver ? '1px dashed #3498db' : 'none',
        outlineOffset: '-1px',
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="2" style={{ flexShrink: 0 }}>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>

      {isEditing ? (
        <input
          ref={editRef} type="text" value={editValue}
          onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onEditConfirm(); if (e.key === 'Escape') onEditCancel(); }}
          onBlur={onEditConfirm} onClick={(e) => e.stopPropagation()}
          style={{ flex: 1, padding: '2px 6px', background: '#1e1e1e', border: '1px solid #3498db', borderRadius: '3px', color: '#fff', fontSize: '15px', fontWeight: 700, outline: 'none', minWidth: 0 }}
        />
      ) : (
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {folder.name}
          </div>
          <div style={{ fontSize: '12px', color: '#888' }}>
            {classCount} class{classCount !== 1 ? 'es' : ''}
            {subfolderCount > 0 && ` · ${subfolderCount} subfolder${subfolderCount !== 1 ? 's' : ''}`}
          </div>
        </div>
      )}

      {!isEditing && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2.5" style={{ flexShrink: 0, opacity: hovered ? 1 : 0.4 }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}

      {hovered && !isEditing && (
        <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          <ActionBtn title="Add subfolder" onClick={(e) => { e.stopPropagation(); onAddSubfolder(); }}>+</ActionBtn>
          <ActionBtn title="Rename" onClick={(e) => { e.stopPropagation(); onRename(); }}>✎</ActionBtn>
          <ActionBtn title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(); }} danger>×</ActionBtn>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   NESTED MODE — recursive folder node with inline classes
   ═══════════════════════════════════════════════════════════════════════ */

function FolderNode({
  node, depth,
  selectedFolderId, setSelectedFolderId,
  getClassesForFolder, getClassesForFolderDeep,
  toggleExpanded, renameFolder, deleteFolder, reorderFolder,
  startAddSubfolder,
  editingFolderId, setEditingFolderId,
  editingFolderName, setEditingFolderName,
  draggingClassName, onClassDrop,
  // Class props
  selectedClass, setSelectedClass, setViewMode, setContextMenu, setDraggingClassName,
}) {
  const isEditing = editingFolderId === node.id;
  const isSelected = selectedFolderId === node.id;
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = node.expanded !== false;
  const editRef = useRef(null);
  const folderClasses = getClassesForFolder(node.id);

  useEffect(() => {
    if (isEditing && editRef.current) editRef.current.focus();
  }, [isEditing]);

  const handleConfirmRename = () => {
    if (editingFolderName.trim() && editingFolderName.trim() !== node.name) {
      renameFolder(node.id, editingFolderName.trim());
    } else { setEditingFolderId(null); }
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    const count = getClassesForFolderDeep(node.id).length;
    const msg = count > 0
      ? `Delete folder "${node.name}"?\n\n${count} class(es) inside will be moved to root.`
      : `Delete folder "${node.name}"?`;
    if (confirm(msg)) deleteFolder(node.id);
  };

  return (
    <>
      <TreeFolderItem
        name={node.name}
        folderId={node.id}
        isSelected={isSelected}
        isEditing={isEditing}
        editValue={editingFolderName}
        editRef={editRef}
        onEditChange={setEditingFolderName}
        onEditConfirm={handleConfirmRename}
        onEditCancel={() => setEditingFolderId(null)}
        onClick={() => setSelectedFolderId(node.id)}
        onToggle={() => toggleExpanded(node.id)}
        isExpanded={isExpanded}
        hasChildren={hasChildren || folderClasses.length > 0}
        depth={depth}
        count={getClassesForFolderDeep(node.id).length}
        onRename={(e) => { e.stopPropagation(); setEditingFolderId(node.id); setEditingFolderName(node.name); }}
        onDelete={handleDelete}
        onAddSubfolder={(e) => { e.stopPropagation(); startAddSubfolder(node.id); }}
        draggingClassName={draggingClassName}
        onClassDrop={(name) => onClassDrop?.(name, node.id)}
      />

      {/* Expanded children: subfolders + classes */}
      {isExpanded && (
        <>
          {node.children?.map(child => (
            <FolderNode
              key={child.id} node={child} depth={depth + 1}
              selectedFolderId={selectedFolderId} setSelectedFolderId={setSelectedFolderId}
              getClassesForFolder={getClassesForFolder} getClassesForFolderDeep={getClassesForFolderDeep}
              toggleExpanded={toggleExpanded} renameFolder={renameFolder}
              deleteFolder={deleteFolder} reorderFolder={reorderFolder}
              startAddSubfolder={startAddSubfolder}
              editingFolderId={editingFolderId} setEditingFolderId={setEditingFolderId}
              editingFolderName={editingFolderName} setEditingFolderName={setEditingFolderName}
              draggingClassName={draggingClassName} onClassDrop={onClassDrop}
              selectedClass={selectedClass} setSelectedClass={setSelectedClass}
              setViewMode={setViewMode} setContextMenu={setContextMenu}
              setDraggingClassName={setDraggingClassName}
            />
          ))}
          {folderClasses.map(cls => (
            <ClassItem
              key={cls.name}
              cls={cls}
              depth={depth + 1}
              isSelected={selectedClass?.name === cls.name}
              onClick={() => { setSelectedClass(cls); setViewMode('classes'); }}
              onMenuClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setContextMenu({ className: cls.name, x: rect.right, y: rect.bottom + 2 });
              }}
              onDragStart={() => setDraggingClassName?.(cls.name)}
              onDragEnd={() => setDraggingClassName?.(null)}
            />
          ))}
        </>
      )}
    </>
  );
}

function TreeFolderItem({
  name, folderId, isSelected, depth = 0, count,
  onClick, onToggle, isExpanded, hasChildren,
  isEditing, editValue, editRef, onEditChange, onEditConfirm, onEditCancel,
  onRename, onDelete, onAddSubfolder,
  draggingClassName, onClassDrop,
}) {
  const [hovered, setHovered] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const indent = 12 + depth * 16;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setDragOver(false); }}
      onDoubleClick={onRename}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const n = e.dataTransfer.getData('text/plain'); if (n) onClassDrop?.(n); }}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: `7px 10px 7px ${indent}px`,
        cursor: 'pointer', transition: 'all 0.12s',
        background: dragOver ? '#1a2a3a' : (hovered ? '#1c1c1c' : 'transparent'),
        borderLeft: dragOver ? '3px solid #3498db' : '3px solid transparent',
        outline: dragOver ? '1px dashed #3498db' : 'none',
        outlineOffset: '-1px', borderRadius: dragOver ? '4px' : '0',
        minHeight: '36px',
      }}
    >
      <span
        onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
        style={{
          width: '16px', textAlign: 'center', fontSize: '11px', color: isSelected ? '#3498db' : '#aaa',
          cursor: 'pointer', flexShrink: 0,
          transition: 'transform 0.15s',
          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
          opacity: hasChildren ? 1 : 0.3,
        }}
      >
        ▶
      </span>

      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke={isSelected ? '#3498db' : '#ccc'} strokeWidth="2" style={{ flexShrink: 0 }}>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>

      {isEditing ? (
        <input
          ref={editRef} type="text" value={editValue}
          onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onEditConfirm(); if (e.key === 'Escape') onEditCancel(); }}
          onBlur={onEditConfirm} onClick={(e) => e.stopPropagation()}
          style={{ flex: 1, padding: '2px 6px', background: '#1e1e1e', border: '1px solid #3498db', borderRadius: '3px', color: '#fff', fontSize: '15px', fontWeight: 700, outline: 'none', minWidth: 0 }}
        />
      ) : (
        <span style={{ flex: 1, fontSize: '15px', fontWeight: 700, color: isSelected ? '#3498db' : '#f0f0f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
          {name}
        </span>
      )}

      {count > 0 && !isEditing && (
        <span style={{ fontSize: '12px', color: isSelected ? '#2980b9' : '#bbb', background: isSelected ? 'transparent' : '#2a2a2a', padding: '2px 8px', borderRadius: '10px', flexShrink: 0, fontWeight: 700 }}>
          {count}
        </span>
      )}

      {hovered && !isEditing && (
        <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          <ActionBtn title="Add subfolder" onClick={onAddSubfolder}>+</ActionBtn>
          <ActionBtn title="Rename" onClick={onRename}>✎</ActionBtn>
          <ActionBtn title="Delete" onClick={onDelete} danger>×</ActionBtn>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SHARED
   ═══════════════════════════════════════════════════════════════════════ */

function ActionBtn({ children, onClick, title, danger }) {
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick} title={title}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        background: h ? '#333' : 'transparent', border: 'none',
        color: h ? (danger ? '#e74c3c' : '#3498db') : '#888',
        cursor: 'pointer', padding: '4px 6px', fontSize: '16px', lineHeight: 1,
        borderRadius: '4px', transition: 'all 0.12s',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minWidth: '24px', minHeight: '24px',
      }}
    >
      {children}
    </button>
  );
}

function NavItem({ label, isActive, onClick, icon }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '12px 14px', cursor: 'pointer',
        transition: 'background 0.12s',
        background: isActive ? '#252525' : (hovered ? '#1c1c1c' : 'transparent'),
        borderLeft: isActive ? '3px solid #3498db' : '3px solid transparent',
        color: isActive ? '#fff' : (hovered ? '#f0f0f0' : '#ccc'),
      }}
    >
      <span style={{ opacity: isActive ? 1 : 0.7, flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: '15px', fontWeight: 700 }}>{label}</span>
    </div>
  );
}
