import { useState, useEffect } from 'react';
import { getModels, saveModel } from '../../../utils/storage';
import { BACKEND_URL, DETECTOR_URL } from '../../../utils/config';
import './TestPanel.css';

export default function TestPanel({
  models,
  objectModels,
  activeTestModel,
  projectId,
  setModels,
  testModelId,
  setTestModelId,
  testConfidence,
  setTestConfidence,
  testOcrFormat,
  setTestOcrFormat,
  testSubclassOcrFormats,
  setTestSubclassOcrFormats,
  testResults,
  setTestResults,
  isTesting,
  getSubclasses,
  onTestModel,
  onSaveSettings,
  onClose,
}) {
  const [showExamplesModal, setShowExamplesModal] = useState(false);
  const [templateImages, setTemplateImages] = useState([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [selectedThumb, setSelectedThumb] = useState(null);

  const model = activeTestModel || models.find(m => m.id === testModelId);
  const subclasses = model ? getSubclasses(model.className) : [];

  useEffect(() => {
    setShowExamplesModal(false);
    setTemplateImages([]);
    setSelectedThumb(null);
  }, [activeTestModel?.id, testModelId]);

  const loadTemplates = async () => {
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

  const handleRemoveExample = async (exampleId) => {
    if (!model) return;
    if (!confirm(`Remove this example from "${model.className}"?`)) return;
    try {
      const res = await fetch(`${DETECTOR_URL}/models/${model.id}/examples/${encodeURIComponent(exampleId)}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.modelDeleted) {
        alert('Model deleted (no examples remaining).');
        setShowExamplesModal(false);
        setModels(await getModels(projectId) || []);
      } else if (result.success) {
        alert(`Example removed. ${result.remainingExamples} remaining.`);
        loadTemplates();
        setModels(await getModels(projectId) || []);
      }
    } catch (error) { alert('Failed: ' + error.message); }
  };

  const openExamplesModal = () => {
    loadTemplates();
    setSelectedThumb(null);
    setShowExamplesModal(true);
  };

  return (
    <>
      <div className="test-panel-sidebar">
        {/* Header */}
        <div className="panel-header">
          <h3>{activeTestModel ? activeTestModel.className : 'Test Model'}</h3>
          {onClose && <button className="close-panel" onClick={onClose}>×</button>}
        </div>

        <div className="panel-content">

          {/* ── Model selector (from training toolbar) ── */}
          {!activeTestModel && (
            <div className="panel-section">
              <h4>Select Model</h4>
              <select
                value={testModelId || ''}
                onChange={(e) => {
                  setTestModelId(e.target.value);
                  setTestResults([]);
                  const m = models.find(x => x.id === e.target.value);
                  if (m) { setTestConfidence(m.recommendedConfidence || 0.7); setTestOcrFormat(m.recommendedOcrFormat || ''); setTestSubclassOcrFormats(m.subclassOcrFormats || {}); }
                  else { setTestConfidence(0.7); setTestOcrFormat(''); setTestSubclassOcrFormats({}); }
                }}
                className="panel-select"
              >
                <option value="">-- Select model --</option>
                {objectModels.map(m => <option key={m.id} value={m.id}>{m.className}</option>)}
              </select>
            </div>
          )}

          {/* ── Model Details ── */}
          {model && (
            <div className="panel-section">
              <h4>Model Details</h4>
              <div className="tp-info-grid">
                <div className="tp-info-cell">
                  <div className="tp-info-val">{model.numTemplates || 0}</div>
                  <div className="tp-info-lbl">Templates</div>
                </div>
                <div className="tp-info-cell">
                  <div className="tp-info-val">{model.numExamples || '—'}</div>
                  <div className="tp-info-lbl">Examples</div>
                </div>
                <div className="tp-info-cell">
                  <div className="tp-info-val">{model.isMultiClass ? 'Yes' : 'No'}</div>
                  <div className="tp-info-lbl">Multi-class</div>
                </div>
                <div className="tp-info-cell">
                  <div className="tp-info-val">{model.created ? new Date(model.created).toLocaleDateString() : '—'}</div>
                  <div className="tp-info-lbl">Created</div>
                </div>
              </div>

              {model.classes?.length > 0 && (
                <div className="tp-class-tags">
                  {model.classes.map((cls, i) => <span key={i} className="tp-class-tag">{cls}</span>)}
                </div>
              )}

              <button className="tp-examples-btn" onClick={openExamplesModal}>
                View Examples
                <span className="tp-examples-count">{model.numExamples || model.numTemplates || 0}</span>
              </button>
            </div>
          )}

          {/* ── Run Detection ── */}
          <div className="panel-section">
            <button
              className="panel-action-btn"
              onClick={() => onTestModel(testModelId)}
              disabled={!testModelId || isTesting}
            >
              {isTesting ? 'Running...' : 'Run Detection'}
            </button>

            {testResults.length > 0 && (
              <div className="panel-results-badge">{testResults.length} found</div>
            )}
          </div>

          {/* ── Settings ── */}
          {testModelId && (
            <div className="panel-section">
              <h4>Settings</h4>

              <div className="panel-setting-row">
                <label>Confidence</label>
                <div className="panel-slider-control">
                  <input type="range" min="0.1" max="1" step="0.025"
                    value={testConfidence} onChange={(e) => setTestConfidence(parseFloat(e.target.value))} />
                  <span className="panel-value">{Math.round(testConfidence * 100)}%</span>
                </div>
              </div>

              <div className="panel-setting-row">
                <label>Format</label>
                <input type="text" className="panel-input" placeholder="e.g. FI-12345"
                  value={testOcrFormat} onChange={(e) => setTestOcrFormat(e.target.value.toUpperCase())} />
                {testOcrFormat && (
                  <span className="panel-pattern">Pattern: {testOcrFormat.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N')}</span>
                )}
              </div>

              {subclasses.length > 0 && (
                <div className="panel-setting-row subclass-ocr-panel">
                  <label>Subclass Formats</label>
                  {subclasses.map(subName => (
                    <div key={subName} className="panel-subclass-row">
                      <span className="panel-subclass-label">{subName}</span>
                      <input type="text" className="panel-input panel-input-small" placeholder="e.g. FI-12345"
                        value={testSubclassOcrFormats[subName] || ''}
                        onChange={(e) => setTestSubclassOcrFormats(prev => ({ ...prev, [subName]: e.target.value.toUpperCase() }))} />
                      {testSubclassOcrFormats[subName] && (
                        <span className="panel-pattern">{testSubclassOcrFormats[subName].replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N')}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <button className="panel-save-btn" onClick={onSaveSettings}>Save Settings</button>
            </div>
          )}

          {/* ── Results ── */}
          {testResults.length > 0 && (
            <div className="panel-section">
              <h4>Results</h4>
              <div className="panel-guidance">
                <span>Missed similar? Lower confidence</span>
                <span>False positives? Raise confidence</span>
              </div>
              <button className="panel-clear-btn" onClick={() => setTestResults([])}>Clear Results</button>
            </div>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════ */}
      {/* Examples Modal                            */}
      {/* ══════════════════════════════════════════ */}
      {showExamplesModal && (
        <div className="tp-modal-overlay" onClick={() => { setShowExamplesModal(false); setSelectedThumb(null); }}>
          <div className="tp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tp-modal-header">
              <h3>Examples — {model?.className}</h3>
              <span className="tp-modal-count">{templateImages.length} examples</span>
              <button className="tp-modal-close" onClick={() => { setShowExamplesModal(false); setSelectedThumb(null); }}>×</button>
            </div>

            <div className="tp-modal-body">
              {isLoadingTemplates ? (
                <div className="tp-modal-msg">Loading examples...</div>
              ) : templateImages.length === 0 ? (
                <div className="tp-modal-msg">No examples available</div>
              ) : (
                <div className="tp-modal-layout">
                  {/* Grid */}
                  <div className="tp-modal-grid">
                    {templateImages.map((t, idx) => (
                      <div
                        key={t.id || t.example_id || idx}
                        className={`tp-modal-thumb ${selectedThumb === idx ? 'selected' : ''}`}
                        onClick={() => setSelectedThumb(idx)}
                      >
                        <img src={t.image || t} alt={`Example ${idx + 1}`} />
                        {t.label && <span className="tp-modal-thumb-label">{t.label}</span>}
                      </div>
                    ))}
                  </div>

                  {/* Preview pane */}
                  {selectedThumb !== null && templateImages[selectedThumb] && (
                    <div className="tp-modal-preview">
                      <img
                        src={templateImages[selectedThumb].image || templateImages[selectedThumb]}
                        alt={`Example ${selectedThumb + 1}`}
                      />
                      <div className="tp-modal-preview-info">
                        {templateImages[selectedThumb].label && (
                          <span className="tp-preview-label">{templateImages[selectedThumb].label}</span>
                        )}
                        <span className="tp-preview-idx">Example {selectedThumb + 1} of {templateImages.length}</span>
                        {(templateImages[selectedThumb].id || templateImages[selectedThumb].example_id) && (
                          <button
                            className="tp-preview-rm"
                            onClick={() => handleRemoveExample(templateImages[selectedThumb].id || templateImages[selectedThumb].example_id)}
                          >
                            Remove Example
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
