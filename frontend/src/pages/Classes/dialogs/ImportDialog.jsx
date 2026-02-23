export default function ImportDialog({ show, onClose, importData, importError, importMode, setImportMode, onImport }) {
  if (!show) return null;

  const handleClose = () => onClose();

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Import Objects</h2>

        {importError ? (
          <div className="import-error">
            <span className="error-icon">⚠️</span>
            <p>{importError}</p>
          </div>
        ) : importData ? (
          <>
            <div className="import-summary">
              <p><strong>File:</strong> {importData.fileName}</p>
              <p><strong>Format:</strong> {importData.format.toUpperCase()}</p>
              <p><strong>Objects found:</strong> {importData.objects.length}</p>

              <div className="import-preview">
                <p className="preview-label">Preview (first 3 objects):</p>
                <div className="preview-list">
                  {importData.objects.slice(0, 3).map((obj, i) => (
                    <div key={i} className="preview-item">
                      <span className="preview-class">{obj.label || obj.className || 'Unknown'}</span>
                      <span className="preview-file">{obj.filename || 'No file'}</span>
                    </div>
                  ))}
                  {importData.objects.length > 3 && (
                    <div className="preview-more">...and {importData.objects.length - 3} more</div>
                  )}
                </div>
              </div>
            </div>

            <div className="import-mode">
              <p className="mode-label">Import Mode:</p>
              <div className="mode-toggle">
                <button className={`mode-btn ${importMode === 'merge' ? 'active' : ''}`} onClick={() => setImportMode('merge')}>
                  <span className="mode-title">Merge</span>
                  <span className="mode-desc">Add new, update existing</span>
                </button>
                <button className={`mode-btn ${importMode === 'replace' ? 'active' : ''}`} onClick={() => setImportMode('replace')}>
                  <span className="mode-title">Replace All</span>
                  <span className="mode-desc">Clear & import fresh</span>
                </button>
              </div>
            </div>
          </>
        ) : (
          <p>Processing file...</p>
        )}

        <div className="modal-buttons">
          <button onClick={handleClose}>Cancel</button>
          {importData && !importError && (
            <button className="primary-btn" onClick={onImport}>
              Import {importData.objects.length} Objects
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
