import { useState, useRef, useEffect } from 'react';

/**
 * Middle column — classes list for the currently selected folder.
 * Three-dot menu for move/delete. Drag classes to folders in the left panel.
 */
export default function ClassesPanel({
  classes,
  allClasses,
  selectedClass, setSelectedClass,
  onNewClass, onDeleteClass,
  // Folder context
  selectedFolderId, folderName,
  folders, moveClassToFolder,
  // Sizing
  width,
  // Drag state (lifted to parent so FolderTree can see it)
  onDragStart, onDragEnd,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState(null); // { className, x, y }

  const filtered = classes.filter(cls =>
    cls.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextMenu]);

  return (
    <div
      className="classes-panel"
      style={{
        width, minWidth: 220, maxWidth: 400, flexShrink: 0,
        display: 'flex', flexDirection: 'column',
        background: '#1a1a1a', borderRight: '1px solid #333',
        position: 'relative',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid #333',
        display: 'flex', flexDirection: 'column', gap: '8px',
        background: '#1a1a1a', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#fff', fontSize: '15px', fontWeight: 700 }}>
            {folderName || 'All Classes'}
          </span>
          <span style={{ color: '#666', fontSize: '12px' }}>
            {classes.length} class{classes.length !== 1 ? 'es' : ''}
          </span>
        </div>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            placeholder="Search classes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%', padding: '7px 10px 7px 30px', background: '#1a1a1a',
              border: '1px solid #333', borderRadius: '6px', color: '#fff',
              fontSize: '12px', outline: 'none', boxSizing: 'border-box',
            }}
            onFocus={(e) => e.target.style.borderColor = '#3498db'}
            onBlur={(e) => e.target.style.borderColor = '#333'}
          />
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"
            style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }}>
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
        </div>
      </div>

      {/* New Class Button */}
      <div style={{ padding: '8px 14px' }}>
        <button
          onClick={onNewClass}
          style={{
            width: '100%', padding: '7px 10px',
            background: '#1a1a1a', border: '1px solid #333', borderRadius: '6px',
            color: '#bbb', fontSize: '12px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3498db'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#bbb'; }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Class
        </button>
      </div>

      {/* Classes list */}
      <div style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden',
        padding: '0 8px 8px', scrollbarWidth: 'thin', scrollbarColor: '#333 transparent',
      }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '24px 12px', color: '#555', fontSize: '12px', textAlign: 'center' }}>
            {searchQuery ? 'No classes match search' : 'No classes in this folder'}
          </div>
        ) : (
          filtered.map(cls => (
            <ClassCard
              key={cls.name}
              cls={cls}
              isSelected={selectedClass?.name === cls.name}
              onClick={() => setSelectedClass(cls)}
              onMenuClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setContextMenu({ className: cls.name, x: rect.right - 4, y: rect.bottom + 2 });
              }}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          className={contextMenu.className}
          x={contextMenu.x}
          y={contextMenu.y}
          folders={folders}
          selectedFolderId={selectedFolderId}
          moveClassToFolder={(name, folderId) => { moveClassToFolder(name, folderId); setContextMenu(null); }}
          onDelete={() => { onDeleteClass(contextMenu.className); setContextMenu(null); }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

/** Class card row — draggable with three-dot menu */
function ClassCard({ cls, isSelected, onClick, onMenuClick, onDragStart, onDragEnd }) {
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);

  const handleDragStart = (e) => {
    setDragging(true);
    e.dataTransfer.setData('text/plain', cls.name);
    e.dataTransfer.effectAllowed = 'move';
    // Create a subtle drag image
    const ghost = e.currentTarget.cloneNode(true);
    ghost.style.opacity = '0.7';
    ghost.style.position = 'absolute';
    ghost.style.top = '-1000px';
    ghost.style.background = '#252525';
    ghost.style.borderRadius = '6px';
    ghost.style.padding = '8px 10px';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 20, 20);
    setTimeout(() => document.body.removeChild(ghost), 0);
    onDragStart?.(cls.name);
  };

  const handleDragEnd = () => {
    setDragging(false);
    onDragEnd?.();
  };

  return (
    <div
      onClick={onClick}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '8px 10px', borderRadius: '6px', cursor: 'grab',
        marginBottom: '2px', transition: 'all 0.12s',
        background: hovered ? '#1f1f1f' : 'transparent',
        borderLeft: '3px solid transparent',
        opacity: dragging ? 0.4 : 1,
      }}
    >
      {/* Drag grip */}
      <svg width="10" height="14" viewBox="0 0 10 14" fill={isSelected ? '#3498db' : '#444'} style={{ flexShrink: 0, opacity: hovered || isSelected ? 1 : 0.3, transition: 'opacity 0.15s' }}>
        <circle cx="3" cy="2" r="1.2" /><circle cx="7" cy="2" r="1.2" />
        <circle cx="3" cy="7" r="1.2" /><circle cx="7" cy="7" r="1.2" />
        <circle cx="3" cy="12" r="1.2" /><circle cx="7" cy="12" r="1.2" />
      </svg>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: isSelected ? '#3498db' : '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {cls.name}
        </div>
        <div style={{ fontSize: '11px', color: isSelected ? '#2980b9' : '#666' }}>{cls.count} objects</div>
      </div>

      {/* Three-dot menu button */}
      <button
        onClick={onMenuClick}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: '4px 2px', borderRadius: '4px', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: hovered ? 1 : 0, transition: 'opacity 0.15s',
          color: '#888',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#333'; e.currentTarget.style.color = '#fff'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#888'; }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>
    </div>
  );
}

/** Context menu with "Move to" submenu and Delete */
function ContextMenu({ className, x, y, folders, selectedFolderId, moveClassToFolder, onDelete, onClose }) {
  const [showMoveSubmenu, setShowMoveSubmenu] = useState(false);
  const menuRef = useRef(null);

  // Clamp position to viewport
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const nx = Math.min(x, window.innerWidth - rect.width - 8);
      const ny = Math.min(y, window.innerHeight - rect.height - 8);
      setPos({ x: nx, y: ny });
    }
  }, [x, y]);

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
        minWidth: '160px', padding: '4px 0',
        fontSize: '12px',
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
          icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>}
          label="Move to folder"
          hasSubmenu
        />
        {showMoveSubmenu && (
          <div style={{
            position: 'absolute', left: '100%', top: '-4px', zIndex: 1001,
            background: '#242424', border: '1px solid #3a3a3a', borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            minWidth: '180px', padding: '4px 0',
            maxHeight: '280px', overflowY: 'auto',
          }}>
            {/* Root option */}
            <FolderMenuItem
              name="Root (no folder)"
              depth={0}
              isCurrent={selectedFolderId === null}
              onClick={() => moveClassToFolder(className, null)}
            />
            <div style={{ height: '1px', background: '#333', margin: '4px 8px' }} />
            {buildFolderOptions().map(f => (
              <FolderMenuItem
                key={f.id}
                name={f.name}
                depth={f.depth}
                isCurrent={f.id === selectedFolderId}
                onClick={() => moveClassToFolder(className, f.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ height: '1px', background: '#333', margin: '4px 8px' }} />

      {/* Delete */}
      <MenuItem
        icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>}
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
        padding: '7px 12px', cursor: 'pointer',
        color: danger ? (h ? '#e74c3c' : '#c0392b') : (h ? '#fff' : '#ccc'),
        background: h ? '#2a2a2a' : 'transparent',
        transition: 'all 0.1s',
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
        fontSize: '12px', cursor: isCurrent ? 'default' : 'pointer',
        color: isCurrent ? '#555' : (h ? '#fff' : '#ccc'),
        background: h && !isCurrent ? '#2a2a2a' : 'transparent',
        display: 'flex', alignItems: 'center', gap: '6px',
        transition: 'all 0.1s',
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, opacity: 0.6 }}>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
      <span style={{ flex: 1 }}>{name}</span>
      {isCurrent && <span style={{ fontSize: '10px', color: '#444' }}>current</span>}
    </div>
  );
}
