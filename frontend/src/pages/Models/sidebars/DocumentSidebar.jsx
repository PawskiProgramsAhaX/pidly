import { useState, useEffect, useRef, useMemo } from 'react';
import './DocumentSidebar.css';

// ── Build nested tree from flat file list ────────
function buildFolderTree(projectFiles) {
  const root = { name: null, children: {}, files: [] };

  projectFiles.forEach(file => {
    const folderName = file.folderName || '(Root)';

    if (folderName === '(Root)') {
      root.files.push(file);
      return;
    }

    // Split "KCGM / PFD / Sub" → ["KCGM", "PFD", "Sub"]
    const parts = folderName.split(' / ');
    let node = root;

    parts.forEach(part => {
      if (!node.children[part]) {
        node.children[part] = { name: part, children: {}, files: [] };
      }
      node = node.children[part];
    });

    node.files.push(file);
  });

  return root;
}

// ── Count all files under a node recursively ─────
function countFiles(node) {
  let count = node.files.length;
  for (const child of Object.values(node.children)) {
    count += countFiles(child);
  }
  return count;
}

// ── Recursive folder renderer ────────────────────
function FolderNode({ node, name, depth, selectedPdf, onSelectPdf, expandedFolders, toggleFolder, path }) {
  const isExpanded = expandedFolders.has(path);
  const totalFiles = countFiles(node);
  const childNames = Object.keys(node.children).sort((a, b) => a.localeCompare(b));
  const hasContent = childNames.length > 0 || node.files.length > 0;

  return (
    <div className="doc-folder-group">
      <div
        className="doc-folder-header"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => toggleFolder(path)}
      >
        <svg
          className={`folder-chevron ${isExpanded ? 'expanded' : ''}`}
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        <svg className="folder-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span className="folder-name">{name}</span>
        <span className="folder-count">{totalFiles}</span>
      </div>

      {isExpanded && hasContent && (
        <div className="doc-folder-children">
          {/* Sub-folders first */}
          {childNames.map(childName => {
            const childPath = `${path}/${childName}`;
            return (
              <FolderNode
                key={childPath}
                node={node.children[childName]}
                name={childName}
                depth={depth + 1}
                selectedPdf={selectedPdf}
                onSelectPdf={onSelectPdf}
                expandedFolders={expandedFolders}
                toggleFolder={toggleFolder}
                path={childPath}
              />
            );
          })}

          {/* Files in this folder */}
          {node.files.map(file => (
            <div
              key={file.id}
              className={`doc-sidebar-item ${selectedPdf?.id === file.id ? 'selected' : ''}`}
              style={{ paddingLeft: `${12 + (depth + 1) * 16}px` }}
              onClick={() => onSelectPdf(file)}
              title={file.name}
            >
              <svg className="doc-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <span className="doc-item-name">{file.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Main component ───────────────────────────────
export default function DocumentSidebar({
  projectFiles,
  selectedPdf,
  onSelectPdf,
  onClose,
  width: initialWidth = 260
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem('doc_sidebar_width');
    return saved ? parseInt(saved, 10) : initialWidth;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const searchRef = useRef(null);

  const tree = useMemo(() => buildFolderTree(projectFiles), [projectFiles]);

  useEffect(() => {
    if (searchRef.current) searchRef.current.focus();
  }, []);

  // Resize
  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e) => {
      const el = document.querySelector('.document-sidebar');
      if (el) {
        const rect = el.getBoundingClientRect();
        setWidth(Math.max(200, Math.min(450, e.clientX - rect.left)));
      }
    };
    const onUp = () => { setIsResizing(false); document.body.style.userSelect = ''; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [isResizing]);

  useEffect(() => {
    if (!isResizing) localStorage.setItem('doc_sidebar_width', width.toString());
  }, [isResizing, width]);

  // Auto-expand to selected file
  useEffect(() => {
    if (!selectedPdf?.folderName || selectedPdf.folderName === '(Root)') return;
    const parts = selectedPdf.folderName.split(' / ');
    setExpandedFolders(prev => {
      const next = new Set(prev);
      let path = '';
      for (const part of parts) {
        path = path ? `${path}/${part}` : part;
        next.add(path);
      }
      return next;
    });
  }, [selectedPdf]);

  const toggleFolder = (path) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Search
  const isSearching = searchQuery.length > 0;
  const filteredFiles = isSearching
    ? projectFiles.filter(f => {
        const q = searchQuery.toLowerCase();
        return f.name?.toLowerCase().includes(q) || f.folderName?.toLowerCase().includes(q);
      })
    : projectFiles;

  const topFolderNames = Object.keys(tree.children).sort((a, b) => a.localeCompare(b));

  return (
    <div className="document-sidebar" style={{ width, minWidth: 200, maxWidth: 450 }}>
      <div className="doc-sidebar-header">
        <h3>Documents</h3>
        <button className="doc-sidebar-close" onClick={onClose} title="Close">×</button>
      </div>

      <div className="doc-sidebar-search">
        <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="M21 21l-4.35-4.35"/>
        </svg>
        <input
          ref={searchRef}
          type="text"
          placeholder="Search documents..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button className="search-clear" onClick={() => setSearchQuery('')}>×</button>
        )}
      </div>

      <div className="doc-sidebar-count">
        {filteredFiles.length} of {projectFiles.length} document{projectFiles.length !== 1 ? 's' : ''}
      </div>

      <div className="doc-sidebar-list">
        {isSearching ? (
          filteredFiles.length === 0 ? (
            <div className="doc-sidebar-empty">No matching documents</div>
          ) : (
            filteredFiles.map(file => (
              <div
                key={file.id}
                className={`doc-sidebar-item ${selectedPdf?.id === file.id ? 'selected' : ''}`}
                onClick={() => onSelectPdf(file)}
                title={file.name}
              >
                <svg className="doc-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <div className="doc-item-info">
                  <span className="doc-item-name">{file.name}</span>
                  {file.folderName && file.folderName !== '(Root)' && (
                    <span className="doc-item-folder">{file.folderName}</span>
                  )}
                </div>
              </div>
            ))
          )
        ) : (
          topFolderNames.length === 0 && tree.files.length === 0 ? (
            <div className="doc-sidebar-empty">No documents in project</div>
          ) : (
            <>
              {topFolderNames.map(name => (
                <FolderNode
                  key={name}
                  node={tree.children[name]}
                  name={name}
                  depth={0}
                  selectedPdf={selectedPdf}
                  onSelectPdf={onSelectPdf}
                  expandedFolders={expandedFolders}
                  toggleFolder={toggleFolder}
                  path={name}
                />
              ))}

              {tree.files.length > 0 && (
                <div className="doc-root-files">
                  {topFolderNames.length > 0 && (
                    <div className="doc-root-divider"><span>Root files</span></div>
                  )}
                  {tree.files.map(file => (
                    <div
                      key={file.id}
                      className={`doc-sidebar-item ${selectedPdf?.id === file.id ? 'selected' : ''}`}
                      onClick={() => onSelectPdf(file)}
                      title={file.name}
                    >
                      <svg className="doc-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                      <span className="doc-item-name">{file.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )
        )}
      </div>

      <div
        className="doc-sidebar-resize-handle"
        style={{ background: isResizing ? '#3498db' : 'transparent' }}
        onMouseDown={(e) => {
          e.preventDefault();
          setIsResizing(true);
          document.body.style.userSelect = 'none';
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#3498db'}
        onMouseLeave={(e) => !isResizing && (e.currentTarget.style.background = 'transparent')}
      />
    </div>
  );
}
