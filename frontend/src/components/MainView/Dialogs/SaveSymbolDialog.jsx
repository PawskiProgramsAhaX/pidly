/**
 * SaveSymbolDialog.jsx
 * 
 * Modal dialog for saving selected markups as a reusable symbol.
 * Includes a preview of the markups and name input.
 */

import { useState } from 'react';

/**
 * Generate SVG preview of markups
 */
function generateMarkupPreview(markups, size = 70) {
  if (!markups || markups.length === 0) {
    return <span style={{ color: '#888' }}>?</span>;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  
  markups.forEach(m => {
    if (m.points) {
      m.points.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
    } else if (m.startX !== undefined) {
      minX = Math.min(minX, m.startX, m.endX);
      minY = Math.min(minY, m.startY, m.endY);
      maxX = Math.max(maxX, m.startX, m.endX);
      maxY = Math.max(maxY, m.startY, m.endY);
    } else if (m.x !== undefined) {
      minX = Math.min(minX, m.x);
      minY = Math.min(minY, m.y);
      maxX = Math.max(maxX, m.x);
      maxY = Math.max(maxY, m.y);
    }
  });

  const w = maxX - minX || 0.01;
  const h = maxY - minY || 0.01;
  const pad = 5;
  const scaleX = (size - pad * 2) / w;
  const scaleY = (size - pad * 2) / h;
  const sc = Math.min(scaleX, scaleY);

  const tx = (x) => pad + (x - minX) * sc;
  const ty = (y) => pad + (y - minY) * sc;

  let svg = '';
  markups.forEach(m => {
    if ((m.type === 'pen' || m.type === 'highlighter') && m.points?.length > 1) {
      const d = m.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${tx(p.x)} ${ty(p.y)}`).join(' ');
      svg += `<path d="${d}" stroke="${m.color || '#000'}" stroke-width="${Math.max(1, (m.strokeWidth || 2) * 0.4)}" fill="none" opacity="${m.opacity || 1}"/>`;
    } else if (m.type === 'rectangle') {
      svg += `<rect x="${tx(Math.min(m.startX, m.endX))}" y="${ty(Math.min(m.startY, m.endY))}" width="${Math.abs(m.endX - m.startX) * sc}" height="${Math.abs(m.endY - m.startY) * sc}" stroke="${m.color || '#000'}" stroke-width="1.5" fill="${m.fillColor && m.fillColor !== 'none' ? m.fillColor : 'none'}" fill-opacity="0.3"/>`;
    } else if (m.type === 'circle') {
      svg += `<ellipse cx="${tx((m.startX + m.endX) / 2)}" cy="${ty((m.startY + m.endY) / 2)}" rx="${Math.abs(m.endX - m.startX) / 2 * sc}" ry="${Math.abs(m.endY - m.startY) / 2 * sc}" stroke="${m.color || '#000'}" stroke-width="1.5" fill="${m.fillColor && m.fillColor !== 'none' ? m.fillColor : 'none'}" fill-opacity="0.3"/>`;
    } else if (m.type === 'line') {
      svg += `<line x1="${tx(m.startX)}" y1="${ty(m.startY)}" x2="${tx(m.endX)}" y2="${ty(m.endY)}" stroke="${m.color || '#000'}" stroke-width="1.5"/>`;
    } else if (m.type === 'arrow') {
      svg += `<line x1="${tx(m.startX)}" y1="${ty(m.startY)}" x2="${tx(m.endX)}" y2="${ty(m.endY)}" stroke="${m.color || '#000'}" stroke-width="1.5" marker-end="url(#ah)"/>`;
    }
  });

  return (
    <div dangerouslySetInnerHTML={{ 
      __html: `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs><marker id="ah" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="none" stroke="#000" stroke-width="1"/></marker></defs>${svg}</svg>` 
    }} />
  );
}

export default function SaveSymbolDialog({
  isOpen,
  onClose,
  selectedMarkups,
  selectedMarkup,
  onSave,
  existingGroups = [],
  category = 'symbol',
}) {
  const [symbolName, setSymbolName] = useState('');
  const [symbolGroup, setSymbolGroup] = useState('');
  const [showGroupSuggestions, setShowGroupSuggestions] = useState(false);

  if (!isOpen) return null;

  const handleClose = () => {
    setSymbolName('');
    setSymbolGroup('');
    onClose();
  };

  const handleSave = () => {
    if (symbolName.trim()) {
      onSave(symbolName.trim(), symbolGroup.trim() || '');
      setSymbolName('');
      setSymbolGroup('');
    }
  };

  const categoryLabel = category === 'stamp' ? 'Stamp' : category === 'signature' ? 'Signature' : 'Symbol';
  const filteredGroups = existingGroups.filter(g =>
    g.toLowerCase().includes(symbolGroup.toLowerCase()) && g.toLowerCase() !== symbolGroup.toLowerCase()
  );

  const markupsToPreview = selectedMarkups?.length > 0 ? selectedMarkups : (selectedMarkup ? [selectedMarkup] : []);
  const markupCount = markupsToPreview.length;

  return (
    <div 
      className="modal-overlay" 
      onClick={handleClose}
      style={{ background: 'rgba(0,0,0,0.5)', zIndex: 10000 }}
    >
      <div 
        className="modal save-symbol-modal" 
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#2a2a2a',
          borderRadius: '8px',
          padding: '20px',
          width: '350px',
          maxWidth: '90vw',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          color: 'white'
        }}
      >
        <h2 style={{ margin: '0 0 15px 0', fontSize: '16px', fontWeight: '700', color: '#fff' }}>
          Save {categoryLabel}
        </h2>
        
        {/* Preview of what will be saved */}
        <div style={{ 
          marginBottom: '15px', 
          padding: '12px', 
          background: '#333', 
          borderRadius: '6px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{
            width: '80px',
            height: '80px',
            background: '#f5f5f5',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            {generateMarkupPreview(markupsToPreview)}
          </div>
          <div>
            <div style={{ fontSize: '13px', color: '#ccc', marginBottom: '4px' }}>
              {markupCount} markup{markupCount !== 1 ? 's' : ''}
            </div>
            <div style={{ fontSize: '11px', color: '#888' }}>
              Preview of your symbol
            </div>
          </div>
        </div>
        
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', color: '#888', fontWeight: '500' }}>
            Name
          </label>
          <input
            type="text"
            value={symbolName}
            onChange={(e) => setSymbolName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && symbolName.trim()) {
                handleSave();
              }
              if (e.key === 'Escape') handleClose();
            }}
            autoFocus
            style={{
              width: '100%',
              padding: '9px 10px',
              border: '1px solid #444',
              borderRadius: '6px',
              fontSize: '13px',
              background: '#333',
              color: 'white',
              boxSizing: 'border-box',
              outline: 'none',
              transition: 'border-color 0.15s',
            }}
            onFocus={(e) => e.target.style.borderColor = '#3498db'}
            onBlur={(e) => e.target.style.borderColor = '#444'}
            placeholder={`My ${categoryLabel.toLowerCase()}...`}
          />
        </div>
        
        {/* Group field */}
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', color: '#888', fontWeight: '500' }}>
            Group <span style={{ color: '#555', fontWeight: '400' }}>(optional)</span>
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={symbolGroup}
              onChange={(e) => { setSymbolGroup(e.target.value); setShowGroupSuggestions(true); }}
              onFocus={() => setShowGroupSuggestions(true)}
              onBlur={() => setTimeout(() => setShowGroupSuggestions(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && symbolName.trim()) handleSave();
                if (e.key === 'Escape') handleClose();
              }}
              placeholder="e.g. Electrical, Plumbing..."
              style={{
                width: '100%',
                padding: '9px 10px',
                border: '1px solid #444',
                borderRadius: '6px',
                fontSize: '13px',
                background: '#333',
                color: 'white',
                boxSizing: 'border-box',
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={(e) => { if (document.activeElement !== e.target) e.target.style.borderColor = '#555'; }}
              onMouseLeave={(e) => { if (document.activeElement !== e.target) e.target.style.borderColor = '#444'; }}
            />
            {/* Group suggestions dropdown */}
            {showGroupSuggestions && filteredGroups.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0,
                background: '#333', border: '1px solid #444', borderRadius: '0 0 6px 6px',
                borderTop: 'none', maxHeight: '120px', overflowY: 'auto', zIndex: 10,
              }}>
                {filteredGroups.map(g => (
                  <div
                    key={g}
                    onMouseDown={(e) => { e.preventDefault(); setSymbolGroup(g); setShowGroupSuggestions(false); }}
                    style={{
                      padding: '7px 10px', fontSize: '12px', color: '#ccc',
                      cursor: 'pointer', transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => e.target.style.background = '#444'}
                    onMouseLeave={(e) => e.target.style.background = 'transparent'}
                  >
                    {g}
                  </div>
                ))}
              </div>
            )}
          </div>
          <p style={{ fontSize: '10px', color: '#555', margin: '4px 0 0', fontStyle: 'italic' }}>
            Ungrouped items appear under "Miscellaneous"
          </p>
        </div>
        
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            onClick={handleClose}
            style={{
              padding: '8px 16px',
              border: '1px solid #555',
              borderRadius: '4px',
              background: 'transparent',
              color: '#ccc',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!symbolName.trim()}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderRadius: '4px',
              background: symbolName.trim() ? '#3498db' : '#555',
              color: 'white',
              cursor: symbolName.trim() ? 'pointer' : 'not-allowed',
              fontSize: '14px'
            }}
          >
            ✓ Save {categoryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
