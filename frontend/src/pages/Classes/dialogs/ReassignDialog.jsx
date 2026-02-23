export default function ReassignDialog({
  show, onClose,
  orphanedObjectsInfo, allProjectFiles,
  reassignSourceFile, setReassignSourceFile,
  reassignTargetFile, setReassignTargetFile,
  isReassigning, onReassignKeepBoxes,
}) {
  if (!show) return null;

  const handleClose = () => {
    setReassignSourceFile(null);
    setReassignTargetFile(null);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal reassign-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Reassign Orphaned Objects</h2>

        <div className="form-group">
          <label>Source File (deleted)</label>
          <select
            value={reassignSourceFile || ''}
            onChange={(e) => { setReassignSourceFile(e.target.value || null); setReassignTargetFile(null); }}
          >
            <option value="">-- Select source file --</option>
            {orphanedObjectsInfo.fileNames.map(filename => (
              <option key={filename} value={filename}>
                {filename} ({orphanedObjectsInfo.byFile[filename]?.length} objects)
              </option>
            ))}
          </select>
        </div>

        {reassignSourceFile && (
          <div className="form-group">
            <label>Target File (reassign to)</label>
            <select
              value={reassignTargetFile?.id || ''}
              onChange={(e) => {
                const file = allProjectFiles.find(f => f.id === e.target.value);
                setReassignTargetFile(file || null);
              }}
            >
              <option value="">-- Select target file --</option>
              {allProjectFiles.map(file => (
                <option key={file.id} value={file.id}>{file.name}</option>
              ))}
            </select>
          </div>
        )}

        {reassignSourceFile && reassignTargetFile && (
          <div className="reassign-info-box">
            <div className="reassign-info-icon">📦</div>
            <div className="reassign-info-content">
              <strong>Keep Existing Boxes</strong>
              <p>Reassign all bounding boxes to the new file as-is. Best when the layout hasn't changed.</p>
            </div>
          </div>
        )}

        <div className="modal-buttons">
          <button onClick={handleClose}>Cancel</button>
          {reassignSourceFile && reassignTargetFile && (
            <button className="primary-btn" onClick={onReassignKeepBoxes} disabled={isReassigning}>
              {isReassigning ? 'Reassigning...' : 'Confirm'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
