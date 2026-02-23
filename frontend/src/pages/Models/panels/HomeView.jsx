import { useState, useEffect, useRef } from 'react';
import { getModels, saveModel, exportSingleModel } from '../../../utils/storage';
import { BACKEND_URL, DETECTOR_URL } from '../../../utils/config';
import './HomeView.css';

export default function HomeView({
  objectModels,
  models,
  setModels,
  projectId,
  onSelectItem,
  onExportModels,
  onStartTraining,
  onImportFileSelect,
  onDeleteModel,
  onAddExamples,
  onTestModel,
  getSubclasses,
}) {
  const modelFileInputRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('className');
  const [sortDir, setSortDir] = useState('asc');
  const [expandedModelId, setExpandedModelId] = useState(null);

  const [showTemplates, setShowTemplates] = useState(false);
  const [templateImages, setTemplateImages] = useState([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [editConfidence, setEditConfidence] = useState(0.7);
  const [editOcrFormat, setEditOcrFormat] = useState('');
  const [editSubclassOcrFormats, setEditSubclassOcrFormats] = useState({});

  const expandedModel = objectModels.find(m => m.id === expandedModelId);

  useEffect(() => {
    if (expandedModel) {
      setEditConfidence(expandedModel.recommendedConfidence || 0.7);
      setEditOcrFormat(expandedModel.recommendedOcrFormat || '');
      setEditSubclassOcrFormats(expandedModel.subclassOcrFormats || {});
      setShowTemplates(false);
      setTemplateImages([]);
    }
  }, [expandedModelId]);

  const filtered = objectModels.filter(m =>
    m.className?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    let aVal, bVal;
    if (sortField === 'className') { aVal = a.className?.toLowerCase() || ''; bVal = b.className?.toLowerCase() || ''; }
    else if (sortField === 'numTemplates') { aVal = a.numTemplates || 0; bVal = b.numTemplates || 0; }
    else if (sortField === 'confidence') { aVal = a.recommendedConfidence || 0; bVal = b.recommendedConfidence || 0; }
    else if (sortField === 'created') { aVal = a.created || ''; bVal = b.created || ''; }
    else { aVal = ''; bVal = ''; }
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <span className="sort-icon inactive">↕</span>;
    return <span className="sort-icon active">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const loadModelTemplates = async (model) => {
    if (!model) return;
    setIsLoadingTemplates(true);
    setTemplateImages([]);
    try {
      const res = await fetch(`${DETECTOR_URL}/models/${model.id}/examples`);
      if (res.ok) {
        const data = await res.json();
        if (data.examples?.length > 0) {
          const withThumbs = await Promise.all(
            data.examples.map(async (ex) => {
              try {
                const tr = await fetch(`${BACKEND_URL}/api/thumbnail`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ filename: data.pdfFilename, page: ex.page || 0, bbox: ex.bbox })
                });
                if (tr.ok) { const td = await tr.json(); return { ...ex, image: td.thumbnail }; }
              } catch {}
              return ex;
            })
          );
          setTemplateImages(withThumbs);
          setIsLoadingTemplates(false);
          return;
        }
      }
    } catch {}
    try {
      const res = await fetch(`${BACKEND_URL}/api/models/${model.id}/templates`);
      if (res.ok) { const d = await res.json(); if (d.templates?.length > 0) { setTemplateImages(d.templates); setIsLoadingTemplates(false); return; } }
    } catch {}
    setTemplateImages([]);
    setIsLoadingTemplates(false);
  };

  const handleSaveSettings = async () => {
    if (!expandedModel) return;
    const pattern = editOcrFormat ? editOcrFormat.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N') : null;
    const subPatterns = {};
    for (const [s, f] of Object.entries(editSubclassOcrFormats)) { if (f) subPatterns[s] = f.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N'); }
    await saveModel({
      ...expandedModel, recommendedConfidence: editConfidence,
      recommendedOcrFormat: editOcrFormat || null, recommendedOcrPattern: pattern,
      subclassOcrFormats: Object.keys(editSubclassOcrFormats).length > 0 ? editSubclassOcrFormats : null,
      subclassOcrPatterns: Object.keys(subPatterns).length > 0 ? subPatterns : null,
    });
    setModels(await getModels(projectId) || []);
    alert(`Settings saved for "${expandedModel.className}"`);
  };

  const handleRemoveExample = async (exampleId) => {
    if (!expandedModel) return;
    if (!confirm(`Remove this example from "${expandedModel.className}"?`)) return;
    try {
      const res = await fetch(`${DETECTOR_URL}/models/${expandedModel.id}/examples/${encodeURIComponent(exampleId)}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.modelDeleted) {
        alert('Model deleted (no examples remaining).');
        setExpandedModelId(null);
        setModels(await getModels(projectId) || []);
      } else if (result.success) {
        alert(`Example removed. ${result.remainingExamples} remaining.`);
        loadModelTemplates(expandedModel);
        setModels(await getModels(projectId) || []);
      }
    } catch (error) { alert('Failed: ' + error.message); }
  };

  const handleExportSingle = async (e, model) => {
    e.stopPropagation();
    try { await exportSingleModel(model.id, model.className); }
    catch (error) { alert('Export failed: ' + error.message); }
  };

  const subclasses = expandedModel ? getSubclasses(expandedModel.className) : [];

  return (
    <div className="home-content">

      {/* Icon + Title */}
      <div className="home-header">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5">
          <circle cx="12" cy="6" r="3"/>
          <circle cx="6" cy="18" r="3"/>
          <circle cx="18" cy="18" r="3"/>
          <path d="M12 9V12M9 15L12 12L15 15" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <h2>Models</h2>
      </div>

      {/* Search */}
      <div className="home-search">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <input
          type="text" placeholder="Search models..."
          value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button className="search-clear" onClick={() => setSearchQuery('')}>×</button>
        )}
      </div>

      {/* Actions */}
      <div className="home-actions">
        <button className="home-action-btn" onClick={onExportModels}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
          Export All
        </button>
        <button className="home-action-btn" onClick={() => modelFileInputRef.current?.click()}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          Import
        </button>
        <input ref={modelFileInputRef} type="file" accept=".zip,.json" onChange={onImportFileSelect} style={{ display: 'none' }} />
      </div>

      {/* Stats */}
      <div className="home-stats">
        <div className="stat-pill">
          <span className="stat-num">{objectModels.length}</span>
          <span className="stat-lbl">Models</span>
        </div>
        <div className="stat-pill">
          <span className="stat-num">{objectModels.reduce((acc, m) => acc + (m.numTemplates || 0), 0)}</span>
          <span className="stat-lbl">Templates</span>
        </div>
        <div className="stat-pill">
          <span className="stat-num">{[...new Set(objectModels.map(m => m.className))].length}</span>
          <span className="stat-lbl">Classes</span>
        </div>
      </div>

      {/* Table */}
      {objectModels.length === 0 ? (
        <div className="home-empty">
          <p>No models yet</p>
          <button className="home-action-btn primary" onClick={onStartTraining}>Create your first model</button>
        </div>
      ) : (
        <div className="models-table-wrap">
          <table className="models-table">
            <thead>
              <tr>
                <th className="th-name" onClick={() => handleSort('className')}>Name <SortIcon field="className" /></th>
                <th className="th-num" onClick={() => handleSort('numTemplates')}>Templates <SortIcon field="numTemplates" /></th>
                <th className="th-num" onClick={() => handleSort('confidence')}>Confidence <SortIcon field="confidence" /></th>
                <th className="th-date" onClick={() => handleSort('created')}>Created <SortIcon field="created" /></th>
                <th className="th-act">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(model => (
                <>
                  <tr key={model.id}
                    className={`m-row ${expandedModelId === model.id ? 'expanded' : ''}`}
                    onClick={() => setExpandedModelId(expandedModelId === model.id ? null : model.id)}>
                    <td className="td-name">
                      <svg className="chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                        style={{ transform: expandedModelId === model.id ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                      {model.className}
                    </td>
                    <td className="td-dim">{model.numTemplates || 0}</td>
                    <td className="td-dim">{model.recommendedConfidence ? `${Math.round(model.recommendedConfidence * 100)}%` : '—'}</td>
                    <td className="td-dim">{model.created ? new Date(model.created).toLocaleDateString() : '—'}</td>
                    <td className="td-act">
                      <button className="tbl-btn" title="Test" onClick={(e) => { e.stopPropagation(); onTestModel(model); }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                      </button>
                      <button className="tbl-btn" title="Add examples" onClick={(e) => { e.stopPropagation(); onAddExamples(model); }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                      </button>
                      <button className="tbl-btn" title="Export" onClick={(e) => handleExportSingle(e, model)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                      </button>
                      <button className="tbl-btn del" title="Delete" onClick={(e) => { e.stopPropagation(); onDeleteModel(model.id, model.className); }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                      </button>
                    </td>
                  </tr>

                  {expandedModelId === model.id && (
                    <tr key={`${model.id}-d`} className="detail-row">
                      <td colSpan={5}>
                        <div className="detail-panel">
                          <div className="detail-top">
                            <div className="detail-cards">
                              <div className="d-card"><span className="d-lbl">Examples</span><span className="d-val">{model.numExamples || '—'}</span></div>
                              <div className="d-card"><span className="d-lbl">Multi-class</span><span className="d-val">{model.isMultiClass ? 'Yes' : 'No'}</span></div>
                              {model.classes?.length > 0 && <div className="d-card"><span className="d-lbl">Classes</span><span className="d-val">{model.classes.join(', ')}</span></div>}
                            </div>
                            <button className="det-btn" onClick={() => { if (!showTemplates) loadModelTemplates(model); setShowTemplates(!showTemplates); }}>
                              {showTemplates ? 'Hide Examples' : 'View Examples'}
                            </button>
                          </div>

                          <div className="detail-settings">
                            <div className="ds-row">
                              <label>Confidence</label>
                              <input type="range" min="0.1" max="1" step="0.025" value={editConfidence}
                                onChange={(e) => setEditConfidence(parseFloat(e.target.value))} />
                              <span className="conf-val">{(editConfidence * 100) % 1 === 0 ? Math.round(editConfidence * 100) : (editConfidence * 100).toFixed(1)}%</span>
                            </div>
                            {subclasses.length > 0 ? (
                              <div className="ds-group">
                                <label>Subclass OCR Formats</label>
                                {subclasses.map(sub => (
                                  <div key={sub} className="ds-ocr-row">
                                    <span className="ocr-name">{sub}</span>
                                    <input type="text" placeholder="e.g. FI-12345" value={editSubclassOcrFormats[sub] || ''}
                                      onChange={(e) => setEditSubclassOcrFormats(prev => ({ ...prev, [sub]: e.target.value.toUpperCase() }))} />
                                    {editSubclassOcrFormats[sub] && <span className="ocr-pat">{editSubclassOcrFormats[sub].replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N')}</span>}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="ds-row">
                                <label>OCR Format</label>
                                <input type="text" placeholder="e.g. FI-12345" value={editOcrFormat}
                                  onChange={(e) => setEditOcrFormat(e.target.value.toUpperCase())} />
                                {editOcrFormat && <span className="ocr-pat">{editOcrFormat.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N')}</span>}
                              </div>
                            )}
                            <button className="save-btn" onClick={handleSaveSettings}>Save Settings</button>
                          </div>

                          {showTemplates && (
                            <div className="detail-tpl">
                              {isLoadingTemplates ? (
                                <div className="tpl-msg">Loading examples...</div>
                              ) : templateImages.length > 0 ? (
                                <div className="tpl-grid">
                                  {templateImages.map((t, idx) => (
                                    <div key={t.id || t.example_id || idx} className="tpl-item">
                                      <img src={t.image || t} alt={`Example ${idx + 1}`} />
                                      {t.label && <span className="tpl-lbl">{t.label}</span>}
                                      {(t.id || t.example_id) && (
                                        <button className="tpl-rm" onClick={() => handleRemoveExample(t.id || t.example_id)}>✕</button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="tpl-msg">No example images available.</div>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && searchQuery && (
            <div className="home-empty sm">No models matching "{searchQuery}"</div>
          )}
        </div>
      )}
    </div>
  );
}
