/**
 * MultiDeleteDialog.jsx
 * 
 * Confirmation dialog for removing multiple PDFs from the canvas.
 * Extracted from InfiniteView for maintainability.
 */
import React from 'react';

export default function MultiDeleteDialog({
  selectedSlotIds,
  slots,
  slotAnnotations,
  ownedAnnotationIds,
  onConfirmDelete,
  onClose,
}) {
  // Check which selected slots have unsaved changes
  const slotsWithChanges = [...selectedSlotIds].filter(id => {
    const annotations = slotAnnotations[id] || [];
    const ownedIds = ownedAnnotationIds[id] || new Set();
    return annotations.some(a => !a.fromPdf) || ownedIds.size > 0;
  });

  return (
    <div className="object-dialog-overlay" onClick={onClose}>
      <div className="multi-delete-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="object-dialog-header">
          <h3>Remove {selectedSlotIds.size} PDF{selectedSlotIds.size > 1 ? 's' : ''} from Canvas?</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="multi-delete-content">
          <p>The following PDFs will be removed from the canvas:</p>
          <ul className="delete-list">
            {[...selectedSlotIds].map(id => {
              const slot = slots.find(s => s.id === id);
              const hasChanges = slotsWithChanges.includes(id);
              return slot ? (
                <li key={id}>
                  {hasChanges && <span style={{ color: '#e74c3c', fontWeight: 'bold', marginRight: '4px' }}>*</span>}
                  {slot.fileName}
                  {hasChanges && <span style={{ color: '#e74c3c', fontSize: '11px', marginLeft: '8px' }}>(unsaved changes)</span>}
                </li>
              ) : null;
            })}
          </ul>
          {slotsWithChanges.length > 0 && (
            <p style={{ color: '#e74c3c', marginTop: '12px', fontSize: '13px' }}>
              ⚠️ {slotsWithChanges.length} document{slotsWithChanges.length > 1 ? 's have' : ' has'} unsaved changes that will be lost.
            </p>
          )}
        </div>
        <div className="multi-delete-actions">
          <button className="cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="delete-btn" onClick={onConfirmDelete}>
            Remove {selectedSlotIds.size} PDF{selectedSlotIds.size > 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
