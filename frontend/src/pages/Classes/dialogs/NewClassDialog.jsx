import { useState } from 'react';

/**
 * Dialog for creating a new class or subclass, with optional pending subclasses.
 */
export default function NewClassDialog({ show, onClose, onSubmit, parentId, allProjectClasses, getClassPath, existingClasses }) {
  const [name, setName] = useState('');
  const [pendingSubclasses, setPendingSubclasses] = useState([]);
  const [subInput, setSubInput] = useState('');

  if (!show) return null;

  const handleClose = () => {
    setName('');
    setPendingSubclasses([]);
    setSubInput('');
    onClose();
  };

  const handleSubmit = () => {
    if (!name.trim()) return;

    // Duplicate check
    if (parentId) {
      const existing = (existingClasses || []).find(c => c.name.toLowerCase() === name.trim().toLowerCase() && c.parentId === parentId);
      if (existing) { alert(`A subclass named "${existing.name}" already exists under this class.`); return; }
    } else {
      const existing = (existingClasses || []).find(c => c.name.toLowerCase() === name.trim().toLowerCase() && !c.parentId);
      if (existing) { alert(`A class named "${existing.name}" already exists.`); return; }
    }

    onSubmit(name.trim(), parentId, pendingSubclasses);
    handleClose();
  };

  const addPendingSub = () => {
    if (!subInput?.trim()) return;
    const sub = subInput.trim();
    if (pendingSubclasses.some(s => s.toLowerCase() === sub.toLowerCase())) {
      alert(`Subclass "${sub}" is already added.`);
      return;
    }
    setPendingSubclasses(prev => [...prev, sub]);
    setSubInput('');
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal new-class-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '450px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#fff' }}>
            {parentId ? 'Create Subclass' : 'Create New Class'}
          </h2>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', color: '#666', fontSize: '20px', cursor: 'pointer', padding: '4px', lineHeight: 1 }}>×</button>
        </div>

        {parentId && (
          <div style={{ background: 'rgba(52, 152, 219, 0.1)', border: '1px solid rgba(52, 152, 219, 0.2)', borderRadius: '6px', padding: '10px 12px', marginBottom: '16px' }}>
            <span style={{ color: '#888', fontSize: '12px' }}>Parent: </span>
            <strong style={{ color: '#3498db', fontSize: '12px' }}>{getClassPath(allProjectClasses.find(c => c.id === parentId))}</strong>
          </div>
        )}

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', color: '#fff', fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>
            {parentId ? 'Subclass Name' : 'Class Name'}
          </label>
          <input
            type="text"
            placeholder={parentId ? 'e.g., FI, FT, PI' : 'e.g., Valve, Pump, Instrument'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && name.trim() && handleSubmit()}
            autoFocus
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #444', borderRadius: '6px', background: '#1e1e1e', color: '#fff', fontSize: '14px', boxSizing: 'border-box' }}
          />
        </div>

        {/* Subclasses section - only for root classes */}
        {!parentId && (
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', color: '#fff', fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>
              Subclasses <span style={{ color: '#666', fontWeight: 400 }}>(optional)</span>
            </label>
            {pendingSubclasses.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                {pendingSubclasses.map((sub, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#2a2a2a', border: '1px solid #444', borderRadius: '4px', padding: '4px 8px', fontSize: '12px', color: '#fff' }}>
                    <span>{sub}</span>
                    <button onClick={() => setPendingSubclasses(prev => prev.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 0, fontSize: '14px', lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="Add subclass name..."
                value={subInput}
                onChange={(e) => setSubInput(e.target.value)}
                onKeyPress={(e) => { if (e.key === 'Enter' && subInput?.trim()) { e.preventDefault(); addPendingSub(); } }}
                style={{ flex: 1, padding: '8px 12px', border: '1px solid #444', borderRadius: '6px', background: '#1e1e1e', color: '#fff', fontSize: '13px' }}
              />
              <button
                onClick={addPendingSub}
                disabled={!subInput?.trim()}
                style={{ padding: '8px 12px', background: subInput?.trim() ? '#3498db' : '#333', border: 'none', borderRadius: '6px', color: subInput?.trim() ? '#fff' : '#666', fontSize: '13px', fontWeight: 600, cursor: subInput?.trim() ? 'pointer' : 'not-allowed' }}
              >
                + Add
              </button>
            </div>
            <small style={{ display: 'block', color: '#666', fontSize: '11px', marginTop: '8px' }}>
              Press Enter or click Add to add each subclass. You can add more later.
            </small>
          </div>
        )}

        <div className="modal-buttons" style={{ borderTop: '1px solid #333', paddingTop: '16px', marginTop: '0' }}>
          <button onClick={handleClose} style={{ background: 'transparent', border: '1px solid #444', color: '#aaa', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}>Cancel</button>
          <button
            className="primary-btn"
            onClick={handleSubmit}
            disabled={!name.trim()}
            style={{ background: name.trim() ? '#3498db' : '#444', border: 'none', color: name.trim() ? '#fff' : '#666', fontWeight: 600, padding: '8px 16px', borderRadius: '6px', cursor: name.trim() ? 'pointer' : 'not-allowed' }}
          >
            {parentId ? 'Create Subclass' : 'Create Class'}
            {!parentId && pendingSubclasses.length > 0 && ` + ${pendingSubclasses.length} subclasses`}
          </button>
        </div>
      </div>
    </div>
  );
}
