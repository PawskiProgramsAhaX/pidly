/**
 * NoteDialog.jsx
 * 
 * Modal dialog for creating or editing sticky note annotations.
 * Includes color picker, author input, and note text.
 */

const NOTE_COLORS = ['#ffeb3b', '#ff9800', '#4caf50', '#2196f3', '#9c27b0', '#f44336'];

export default function NoteDialog({
  isOpen,
  onClose,
  editingNoteId,
  noteText,
  onNoteTextChange,
  markupColor,
  onColorChange,
  markupAuthor,
  onAuthorChange,
  onSave
}) {
  if (!isOpen) return null;

  const handleClose = () => {
    onClose();
  };

  return (
    <div 
      className="modal-overlay" 
      onClick={handleClose}
      style={{ background: 'rgba(0,0,0,0.3)' }}
    >
      <div 
        className="modal note-modal" 
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          borderRadius: '8px',
          padding: '20px',
          width: '350px',
          maxWidth: '90vw',
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
        }}
      >
        <h2 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>
          {editingNoteId ? '✏️ Edit Note' : '📝 New Sticky Note'}
        </h2>
        
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: '#666' }}>
            Note Color:
          </label>
          <div style={{ display: 'flex', gap: '6px' }}>
            {NOTE_COLORS.map(color => (
              <button
                key={color}
                onClick={() => onColorChange(color)}
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '4px',
                  background: color,
                  border: markupColor === color ? '2px solid #333' : '1px solid #ddd',
                  cursor: 'pointer'
                }}
              />
            ))}
          </div>
        </div>
        
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: '#666' }}>
            Author:
          </label>
          <input
            type="text"
            value={markupAuthor}
            onChange={(e) => onAuthorChange(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px'
            }}
            placeholder="Your name"
          />
        </div>
        
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: '#666' }}>
            Note Text:
          </label>
          <textarea
            value={noteText}
            onChange={(e) => onNoteTextChange(e.target.value)}
            autoFocus
            style={{
              width: '100%',
              minHeight: '100px',
              padding: '10px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px',
              resize: 'vertical'
            }}
            placeholder="Enter your note..."
          />
        </div>
        
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            onClick={handleClose}
            style={{
              padding: '8px 16px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              background: 'white',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderRadius: '4px',
              background: '#3498db',
              color: 'white',
              cursor: 'pointer'
            }}
          >
            {editingNoteId ? 'Save Changes' : 'Add Note'}
          </button>
        </div>
      </div>
    </div>
  );
}
