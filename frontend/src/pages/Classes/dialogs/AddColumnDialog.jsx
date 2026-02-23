import { useState } from 'react';

export default function AddColumnDialog({ show, onClose, onSubmit, selectedClassName }) {
  const [name, setName] = useState('');
  if (!show) return null;

  const handleClose = () => { setName(''); onClose(); };
  const handleSubmit = () => { if (name.trim()) { onSubmit(name.trim()); handleClose(); } };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#fff' }}>Add New Column</h2>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', color: '#666', fontSize: '20px', cursor: 'pointer', padding: '4px', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', color: '#fff', fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>Column Name</label>
          <input
            type="text"
            placeholder="e.g., Status, Notes, Priority"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && name.trim() && handleSubmit()}
            autoFocus
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #444', borderRadius: '6px', background: '#1e1e1e', color: '#fff', fontSize: '14px', boxSizing: 'border-box' }}
          />
        </div>
        <div className="modal-buttons" style={{ borderTop: '1px solid #333', paddingTop: '16px', marginTop: '0' }}>
          <button onClick={handleClose} style={{ background: 'transparent', border: '1px solid #444', color: '#aaa', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}>Cancel</button>
          <button
            className="primary-btn" onClick={handleSubmit} disabled={!name.trim()}
            style={{ background: name.trim() ? '#3498db' : '#444', border: 'none', color: name.trim() ? '#fff' : '#666', fontWeight: 600, padding: '8px 16px', borderRadius: '6px', cursor: name.trim() ? 'pointer' : 'not-allowed' }}
          >
            Add Column
          </button>
        </div>
      </div>
    </div>
  );
}
