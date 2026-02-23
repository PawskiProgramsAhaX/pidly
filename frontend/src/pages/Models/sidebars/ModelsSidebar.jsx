import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './ModelsSidebar.css';

export default function ModelsSidebar({
  projectId,
  returnToFile,
  selectedItem,
  onSelectItem,
  onStartTraining,
  objectModels,
  searchQuery,
  setSearchQuery,
  onDeleteModel,
  onExportSingleModel,
  onAddExamples,
  onTestModel,
}) {
  const navigate = useNavigate();

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('models_sidebar_width');
    return saved ? parseInt(saved, 10) : 230;
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e) => setSidebarWidth(Math.max(180, Math.min(360, e.clientX)));
    const onUp = () => { setIsResizing(false); document.body.style.userSelect = ''; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [isResizing]);

  useEffect(() => {
    if (!isResizing) localStorage.setItem('models_sidebar_width', sidebarWidth.toString());
  }, [isResizing, sidebarWidth]);

  const filteredModels = objectModels.filter(m =>
    m.className?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="models-sidebar" style={{ width: sidebarWidth, minWidth: 180, maxWidth: 360, position: 'relative' }}>

      {/* Create Model */}
      <div
        className={`ms-create ${selectedItem === 'train' ? 'selected' : ''}`}
        onClick={onStartTraining}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        Create Model
      </div>

      {/* Models section */}
      <div className="ms-section">
        <div className="ms-label">
          Models
          {objectModels.length > 0 && <span className="ms-badge">{objectModels.length}</span>}
        </div>

        <div className="ms-search">
          <input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>

        <div className="ms-list">
          {filteredModels.length === 0 ? (
            <div className="ms-empty">{searchQuery ? 'No results' : 'No models yet'}</div>
          ) : (
            filteredModels.map(model => (
              <div
                key={model.id}
                className={`ms-item ${selectedItem === model.id ? 'selected' : ''}`}
                onClick={() => onTestModel(model)}
              >
                <div className="ms-item-text">
                  <span className="ms-item-name">{model.className}</span>
                  <span className="ms-item-meta">{model.numTemplates || 0} templates</span>
                </div>
                <div className="ms-item-actions">
                  <button title="Add examples" onClick={(e) => { e.stopPropagation(); onAddExamples(model); }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                  </button>
                  <button title="Export" onClick={(e) => { e.stopPropagation(); onExportSingleModel(model.id, model.className); }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                  </button>
                  <button className="del" title="Delete" onClick={(e) => { e.stopPropagation(); onDeleteModel(model.id, model.className); }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="ms-footer">
        <div className="ms-footer-item disabled" title="Coming soon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01"/>
          </svg>
          Help
        </div>

        <div className="ms-sep" />

        <button
          className="ms-classes-btn"
          onClick={() => navigate(`/project/${projectId}/classes`, { state: { returnToFile } })}
        >
          Classes
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 'auto', opacity: 0.4 }}>
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>

      <div
        className="ms-resize"
        style={{ background: isResizing ? '#3498db' : 'transparent' }}
        onMouseDown={(e) => { e.preventDefault(); setIsResizing(true); document.body.style.userSelect = 'none'; }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#3498db'}
        onMouseLeave={(e) => !isResizing && (e.currentTarget.style.background = 'transparent')}
      />
    </div>
  );
}
