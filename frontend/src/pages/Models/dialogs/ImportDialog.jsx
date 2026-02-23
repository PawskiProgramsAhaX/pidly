import './ImportDialog.css';

export default function ImportDialog({
  importData,
  importError,
  importMode,
  setImportMode,
  onImport,
  onClose,
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Import Models</h2>
        
        {importError ? (
          <div className="import-error">
            <span className="error-icon">⚠️</span>
            <p>{importError}</p>
          </div>
        ) : importData ? (
          <>
            <div className="import-summary">
              <p><strong>File:</strong> {importData.fileName}</p>
              
              {importData.isZip ? (
                <div className="import-info">
                  <span>📦</span>
                  <p>This zip file contains trained model files (.pkl) that will be fully functional after import.</p>
                </div>
              ) : (
                <>
                  <p><strong>Models found:</strong> {importData.models?.length || 0}</p>
                  <div className="import-warning">
                    <span>⚠️</span>
                    <p>This is a legacy JSON file. Only model metadata will be imported - models will need to be retrained to function.</p>
                  </div>
                  
                  <div className="import-preview">
                    <p className="preview-label">Preview (first 3 models):</p>
                    <div className="preview-list">
                      {importData.models?.slice(0, 3).map((model, i) => (
                        <div key={i} className="preview-item">
                          <span className="preview-class">{model.className || 'Unknown'}</span>
                          <span className="preview-type">{model.modelType || 'object'}</span>
                        </div>
                      ))}
                      {importData.models?.length > 3 && (
                        <div className="preview-more">...and {importData.models.length - 3} more</div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            
            <div className="import-mode">
              <p className="mode-label">Import Mode:</p>
              <div className="mode-toggle">
                <button 
                  className={`mode-btn ${importMode === 'merge' ? 'active' : ''}`}
                  onClick={() => setImportMode('merge')}
                >
                  <span className="mode-title">Merge</span>
                  <span className="mode-desc">{importData.isZip ? 'Skip existing models' : 'Add new, update existing'}</span>
                </button>
                <button 
                  className={`mode-btn ${importMode === 'replace' ? 'active' : ''}`}
                  onClick={() => setImportMode('replace')}
                >
                  <span className="mode-title">{importData.isZip ? 'Overwrite' : 'Replace All'}</span>
                  <span className="mode-desc">{importData.isZip ? 'Overwrite existing models' : 'Clear & import fresh'}</span>
                </button>
              </div>
            </div>
          </>
        ) : (
          <p>Processing file...</p>
        )}
        
        <div className="modal-buttons">
          <button onClick={onClose}>Cancel</button>
          {importData && !importError && (
            <button className="primary-btn" onClick={onImport}>
              {importData.isZip ? 'Import Models' : `Import ${importData.models?.length || 0} Models`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
