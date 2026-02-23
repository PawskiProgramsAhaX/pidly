/**
 * MarkupContextMenu.jsx
 *
 * Right-click context menu for markup annotations.
 * Provides options to convert markup to region or delete it.
 */

const SHAPE_TYPES = new Set([
  'rectangle', 'circle', 'ellipse', 'arrow', 'line',
  'polyline', 'polylineArrow', 'polygon', 'cloud', 'cloudPolyline',
  'pen', 'highlighter', 'arc', 'callout', 'text',
]);

const STAMP_TYPES = new Set([
  'stamp', 'image', 'symbol',
]);

const menuButtonStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  width: '100%',
  padding: '10px 14px',
  border: 'none',
  background: 'white',
  textAlign: 'left',
  cursor: 'pointer',
  fontSize: '13px',
  color: '#333',
  transition: 'background 0.15s',
};

export default function MarkupContextMenu({
  isOpen,
  position,
  markup,
  onClose,
  onAddToStamps,
  onConvertToRegion,
  onEdit,
  onFlatten,
  onDelete
}) {
  if (!isOpen || !markup) return null;

  const isStampOrImage = STAMP_TYPES.has(markup.type) || markup.type === 'note';
  const isShape = SHAPE_TYPES.has(markup.type);

  return (
    <div
      className="markup-context-menu"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 10000,
        background: 'white',
        border: '1px solid #ddd',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        overflow: 'hidden',
        minWidth: '180px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Edit — only for stamps/images/symbols */}
      {isStampOrImage && onEdit && (
        <>
          <button
            style={menuButtonStyle}
            onMouseEnter={(e) => e.target.style.background = '#f5f5f5'}
            onMouseLeave={(e) => e.target.style.background = 'white'}
            onClick={() => {
              onEdit();
              onClose();
            }}
          >
            <span style={{ fontSize: '16px' }}>✏️</span>
            Edit
          </button>
          <div style={{ height: '1px', background: '#eee' }} />
        </>
      )}
      <button
        style={menuButtonStyle}
        onMouseEnter={(e) => e.target.style.background = '#f5f5f5'}
        onMouseLeave={(e) => e.target.style.background = 'white'}
        onClick={() => {
          onAddToStamps();
        }}
      >
        <span style={{ fontSize: '16px' }}>📌</span>
        Add to Stamps
      </button>
      {/* Convert to Region — only for shapes, not stamps/images */}
      {isShape && (
        <>
          <div style={{ height: '1px', background: '#eee' }} />
          <button
            style={menuButtonStyle}
            onMouseEnter={(e) => e.target.style.background = '#f5f5f5'}
            onMouseLeave={(e) => e.target.style.background = 'white'}
            onClick={() => {
              onConvertToRegion();
              onClose();
            }}
          >
            <span style={{ fontSize: '16px' }}>🗺️</span>
            Convert to Region
          </button>
        </>
      )}
      {onFlatten && (
        <>
          <div style={{ height: '1px', background: '#eee' }} />
          <button
            style={menuButtonStyle}
            onMouseEnter={(e) => e.target.style.background = '#f5f5f5'}
            onMouseLeave={(e) => e.target.style.background = 'white'}
            onClick={() => {
              onFlatten();
              onClose();
            }}
          >
            <span style={{ fontSize: '16px' }}>📎</span>
            Flatten to Page
          </button>
        </>
      )}
      <div style={{ height: '1px', background: '#eee' }} />
      <button
        style={{
          ...menuButtonStyle,
          color: '#e74c3c',
        }}
        onMouseEnter={(e) => e.target.style.background = '#fef0ef'}
        onMouseLeave={(e) => e.target.style.background = 'white'}
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        <span style={{ fontSize: '16px' }}>🗑️</span>
        Delete Markup
      </button>
    </div>
  );
}
