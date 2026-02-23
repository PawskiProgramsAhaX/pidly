import './TrainingToolbar.css';

export default function TrainingToolbar({
  trainingBoxes,
  numPages,
  currentPage,
  onClearBoxes,
  models,
  showTrainPanel,
  onToggleTrainPanel,
  showTestPanel,
  onToggleTestPanel,
  isTesting,
}) {
  return (
    <div className="training-toolbar">
      <div className="tb-row">
        <span className="tb-count">
          {numPages > 1 ? (
            <>{trainingBoxes.filter(b => b.page === currentPage - 1).length} on page · {trainingBoxes.length} total</>
          ) : (
            <>{trainingBoxes.length} box{trainingBoxes.length !== 1 ? 'es' : ''}</>
          )}
        </span>

        <button className="tb-btn ghost" onClick={onClearBoxes} disabled={trainingBoxes.length === 0}>Clear</button>

        <div className="tb-spacer" />

        <button className={`tb-btn accent ${showTrainPanel && !showTestPanel ? 'active' : ''}`}
          onClick={onToggleTrainPanel}>
          Train
        </button>

        {models.length > 0 && (
          <button className={`tb-btn accent ${showTestPanel ? 'active' : ''} ${isTesting ? 'testing' : ''}`}
            onClick={onToggleTestPanel} disabled={isTesting}>
            {isTesting ? 'Testing...' : 'Test'}
          </button>
        )}
      </div>
    </div>
  );
}
