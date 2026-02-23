export default function DeleteOrphanedDialog({ show, onClose, orphanedTotal, onDeleteOnly, onDeleteAndRedetect }) {
  if (!show) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal delete-orphaned-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Delete Orphaned Objects</h2>
        <p className="modal-description">
          You are about to delete {orphanedTotal} orphaned object{orphanedTotal !== 1 ? 's' : ''}. What would you like to do?
        </p>

        <div className="delete-orphaned-options">
          <button className="delete-option-btn redetect-option" onClick={onDeleteAndRedetect}>
            <span className="option-icon">🔄</span>
            <span className="option-content">
              <strong>Delete & Re-detect</strong>
              <small>Delete all orphaned objects and open the Object Finder to run detection on your files.</small>
            </span>
          </button>

          <button className="delete-option-btn delete-only-option" onClick={onDeleteOnly}>
            <span className="option-icon">🗑️</span>
            <span className="option-content">
              <strong>Delete Only</strong>
              <small>Permanently delete all orphaned objects without re-detecting.</small>
            </span>
          </button>
        </div>

        <div className="modal-buttons">
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
