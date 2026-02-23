import './TrainPanel.css';

export default function TrainPanel({
  selectedClass,
  setSelectedClass,
  projectClasses,
  drawingShapeType,
  setDrawingShapeType,
  trainingMode,
  setTrainingMode,
  addToExistingModel,
  setAddToExistingModel,
  models,
  trainingBoxes,
  modelName,
  setModelName,
  multiOrientation,
  setMultiOrientation,
  includeInverted,
  setIncludeInverted,
  isTraining,
  onTrain,
}) {
  const uniqueClasses = [...new Set(trainingBoxes.map(b => b.className))];
  const hasMultipleClasses = uniqueClasses.length > 1;

  return (
    <div className="train-panel-sidebar">
      <div className="tp-header">
        <h3>Train</h3>
      </div>

      <div className="tp-content">

        {/* ── Drawing ── */}
        <div className="tp-section">
          <h4>Drawing</h4>

          <div className="tp-field">
            <label className="tp-field-label">Class</label>
            <select className="tp-select" value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)}>
              <option value="">-- Select class --</option>
              {projectClasses.map(cls => (
                <option key={cls.id} value={cls.name}>{cls.name}</option>
              ))}
            </select>
          </div>

          <div className="tp-field">
            <label className="tp-field-label">Shape</label>
            <div className="tp-shape-group">
              <button
                className={`tp-shape-btn ${drawingShapeType === 'rectangle' ? 'active' : ''}`}
                onClick={() => setDrawingShapeType('rectangle')}
              >
                <span className="tp-shape-icon">▢</span>
                Rectangle
              </button>
              <button
                className={`tp-shape-btn ${drawingShapeType === 'circle' ? 'active' : ''}`}
                onClick={() => setDrawingShapeType('circle')}
              >
                <span className="tp-shape-icon">○</span>
                Circle
              </button>
            </div>
          </div>
        </div>

        {/* ── Mode ── */}
        <div className="tp-section">
          <h4>Mode</h4>
          <div className="tp-mode-group">
            <button className={`tp-mode-btn ${trainingMode === 'separate' && !addToExistingModel ? 'active' : ''}`}
              onClick={() => { setTrainingMode('separate'); setAddToExistingModel(null); }}>
              <span className="tp-mode-icon">＋</span>
              <span className="tp-mode-text">
                <span className="tp-mode-title">New Model</span>
                <span className="tp-mode-desc">One model per class</span>
              </span>
            </button>
            <button className={`tp-mode-btn ${trainingMode === 'combined' && !addToExistingModel ? 'active' : ''}`}
              onClick={() => { setTrainingMode('combined'); setAddToExistingModel(null); }}
              disabled={!hasMultipleClasses}>
              <span className="tp-mode-icon">⊕</span>
              <span className="tp-mode-text">
                <span className="tp-mode-title">Combined</span>
                <span className="tp-mode-desc">Multi-class model</span>
              </span>
            </button>
            <button className={`tp-mode-btn ${addToExistingModel ? 'active' : ''}`}
              onClick={() => {
                if (models.length > 0) {
                  const match = models.find(m => uniqueClasses.includes(m.className));
                  setAddToExistingModel(match?.id || models[0]?.id);
                }
              }}
              disabled={models.length === 0}>
              <span className="tp-mode-icon">↳</span>
              <span className="tp-mode-text">
                <span className="tp-mode-title">Add to Existing</span>
                <span className="tp-mode-desc">Extend a model</span>
              </span>
            </button>
          </div>
        </div>

        {/* ── Model name / selector ── */}
        <div className="tp-section">
          <h4>Model</h4>
          {addToExistingModel ? (
            <select className="tp-select" value={addToExistingModel} onChange={(e) => setAddToExistingModel(e.target.value)}>
              {models.map(m => <option key={m.id} value={m.id}>{m.className}</option>)}
            </select>
          ) : trainingMode === 'combined' ? (
            <input type="text" className="tp-input" value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="Combined model name..." />
          ) : (
            <>
              {uniqueClasses.length === 0 ? (
                <span className="tp-muted">Draw boxes to define examples</span>
              ) : uniqueClasses.length === 1 ? (
                <input type="text" className="tp-input" value={modelName || uniqueClasses[0]} onChange={(e) => setModelName(e.target.value)} placeholder={uniqueClasses[0]} />
              ) : (
                <div className="tp-model-list">
                  {uniqueClasses.map(cls => (
                    <span key={cls} className="tp-model-tag">{cls}</span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Options ── */}
        <div className="tp-section">
          <h4>Options</h4>

          <label className="tp-option">
            <input type="checkbox" checked={multiOrientation} onChange={(e) => setMultiOrientation(e.target.checked)} />
            <span className="tp-option-check" />
            <span className="tp-option-text">
              <span className="tp-option-title">All orientations</span>
              <span className="tp-option-desc">Detect at 0°, 90°, 180°, 270°</span>
            </span>
          </label>

          <label className="tp-option">
            <input type="checkbox" checked={includeInverted} onChange={(e) => setIncludeInverted(e.target.checked)} />
            <span className="tp-option-check" />
            <span className="tp-option-text">
              <span className="tp-option-title">Include inverted</span>
              <span className="tp-option-desc">Add mirrored versions</span>
            </span>
          </label>
        </div>

        {/* ── Examples summary ── */}
        <div className="tp-section">
          <h4>Examples</h4>
          <div className="tp-examples-summary">
            <div className="tp-ex-stat">
              <span className="tp-ex-val">{trainingBoxes.length}</span>
              <span className="tp-ex-lbl">Boxes drawn</span>
            </div>
            <div className="tp-ex-stat">
              <span className="tp-ex-val">{uniqueClasses.length}</span>
              <span className="tp-ex-lbl">Classes</span>
            </div>
          </div>
        </div>

        {/* ── Spacer ── */}
        <div style={{ flex: 1 }} />

        {/* ── Train button ── */}
        <button
          className="tp-train-btn"
          onClick={onTrain}
          disabled={isTraining || trainingBoxes.length === 0 || (trainingMode === 'combined' && !modelName.trim())}
        >
          {isTraining ? 'Training...' : (addToExistingModel ? 'Add Templates' : 'Train Model')}
        </button>
      </div>
    </div>
  );
}
