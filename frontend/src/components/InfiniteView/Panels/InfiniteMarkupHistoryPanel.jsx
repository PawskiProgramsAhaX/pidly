/**
 * InfiniteMarkupHistoryPanel.jsx
 * 
 * Panel showing all markups across slots/documents in InfiniteView.
 * Adapted from PDFViewer's MarkupHistoryPanel - same look/feel but
 * uses slots instead of pages for grouping/filtering.
 * 
 * Collapsed row: Type, Author, Created Date (bold white).
 * Expanded: Software, modified date, text content, IDs, stroke, fill, slot info.
 */

import { useState, useMemo } from 'react';

// Parse PDF date string or ISO string into a Date object
function parsePdfDate(pdfDate) {
  if (!pdfDate || typeof pdfDate !== 'string') return null;
  try {
    if (pdfDate.includes('T') || pdfDate.match(/^\d{4}-\d{2}-\d{2}/)) {
      const d = new Date(pdfDate);
      return isNaN(d.getTime()) ? null : d;
    }
    let str = pdfDate.replace(/^D:/, '');
    const match = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-Z])(\d{2})?'?(\d{2})?/);
    if (!match) return null;
    const [, y, mo, d, h, mi, s, tzSign, tzH, tzM] = match;
    const tz = tzSign === 'Z' ? '+00:00' : `${tzSign}${tzH || '00'}:${tzM || '00'}`;
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${tz}`);
  } catch { return null; }
}

function formatDate(pdfDate) {
  const d = parsePdfDate(pdfDate);
  if (!d || isNaN(d.getTime())) return null;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Friendly display name for markup type
function friendlyType(markup) {
  if (markup.pdfSubject) return markup.pdfSubject;
  if (markup.isStamp) return markup.stampName || 'Stamp';
  const map = {
    pen: 'Pen', highlighter: 'Highlighter', rectangle: 'Rectangle', circle: 'Circle',
    arrow: 'Arrow', line: 'Line', text: 'Text Box', cloudPolyline: 'Cloud Polyline',
    cloud: 'Cloud', polyline: 'Polyline', polylineArrow: 'Polyline Arrow',
    polygon: 'Polygon', symbol: 'Symbol', image: 'Image', stamp: 'Stamp',
    note: 'Note', callout: 'Callout', arc: 'Arc', textHighlight: 'Text Highlight',
    textMarkup: 'Text Markup',
  };
  return map[markup.type] || markup.type;
}

// Truncate filename for display
function shortName(fileName, maxLen = 28) {
  if (!fileName || fileName.length <= maxLen) return fileName || 'Unknown';
  const ext = fileName.lastIndexOf('.');
  if (ext > 0 && fileName.length - ext <= 5) {
    const name = fileName.substring(0, ext);
    return name.substring(0, maxLen - 3 - (fileName.length - ext)) + '...' + fileName.substring(ext);
  }
  return fileName.substring(0, maxLen - 3) + '...';
}

export default function InfiniteMarkupHistoryPanel({
  isOpen,
  onClose,
  slotAnnotations,    // { slotId: [annotations] }
  slots,              // array of slot objects
  unlockedSlots,      // Set of unlocked slot IDs
  selectedSlotId,     // currently focused slot (optional)
  onSelectMarkup,     // callback when clicking a markup row
  onDeleteMarkup,     // callback to delete a markup
  onScrollToMarkup,   // callback to scroll viewport to a markup
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [sortBy, setSortBy] = useState('date');
  const [showAllSlots, setShowAllSlots] = useState(true);

  // Build a flat list of all markups with slot info attached
  const allMarkups = useMemo(() => {
    if (!slotAnnotations) return [];
    const result = [];
    const slotMap = {};
    if (slots) slots.forEach(s => { slotMap[s.id] = s; });

    Object.entries(slotAnnotations).forEach(([slotId, annotations]) => {
      if (!annotations) return;
      const slot = slotMap[slotId];
      annotations.forEach(m => {
        result.push({
          ...m,
          _slotId: slotId,
          _slotFileName: slot?.fileName || 'Unknown',
          _slotPage: slot?.page,
          _slotNumPages: slot?.numPages,
        });
      });
    });
    return result;
  }, [slotAnnotations, slots]);

  // Filter by slot, then by search
  const filtered = useMemo(() => {
    let result = allMarkups;

    // Slot filter
    if (!showAllSlots && selectedSlotId) {
      result = result.filter(m => m._slotId === selectedSlotId);
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(m => {
        const searchable = [
          friendlyType(m), m.author, m.pdfSubject, m.software,
          m.contents, m.text, m.annotationName, m.type, m.pdfSubtype,
          m._slotFileName,
        ].filter(Boolean).join(' ').toLowerCase();
        return searchable.includes(q);
      });
    }

    return result;
  }, [allMarkups, searchQuery, selectedSlotId, showAllSlots]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortBy) {
      case 'type':
        arr.sort((a, b) => friendlyType(a).localeCompare(friendlyType(b)));
        break;
      case 'author':
        arr.sort((a, b) => (a.author || '').localeCompare(b.author || ''));
        break;
      case 'document':
        arr.sort((a, b) => (a._slotFileName || '').localeCompare(b._slotFileName || ''));
        break;
      case 'date':
      default:
        arr.sort((a, b) => {
          const da = parsePdfDate(a.createdDate);
          const db = parsePdfDate(b.createdDate);
          return (db?.getTime() || 0) - (da?.getTime() || 0);
        });
        break;
    }
    return arr;
  }, [filtered, sortBy]);

  if (!isOpen) return null;

  // Summary counts
  const typeCounts = {};
  allMarkups.forEach(m => {
    const t = friendlyType(m);
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });

  // Find selected slot name for the toggle button
  const selectedSlot = slots?.find(s => s.id === selectedSlotId);
  const selectedSlotName = selectedSlot ? shortName(selectedSlot.fileName, 18) : 'Current';

  // Export raw annotation data
  const handleExportData = () => {
    const data = {
      exportDate: new Date().toISOString(),
      totalMarkups: allMarkups.length,
      slots: {},
    };
    Object.entries(slotAnnotations).forEach(([slotId, annotations]) => {
      const slot = slots?.find(s => s.id === slotId);
      data.slots[slotId] = {
        fileName: slot?.fileName || 'Unknown',
        markups: annotations,
      };
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `markup-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="smart-links-panel right-panel" style={{ width: '320px', minWidth: '320px', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ paddingBottom: '8px' }}>
        <h3>Markup History</h3>
        <button className="close-panel" onClick={onClose}>×</button>
      </div>

      {/* Search */}
      <div style={{ padding: '0 12px 8px' }}>
        <input
          type="text"
          placeholder="Search by type, author, text, document..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%', padding: '8px 12px', fontSize: '12px',
            background: '#2a2a2a', border: '1px solid #444', borderRadius: '5px',
            color: '#ddd', outline: 'none', boxSizing: 'border-box',
          }}
          onFocus={(e) => { e.target.style.borderColor = '#3498db'; }}
          onBlur={(e) => { e.target.style.borderColor = '#444'; }}
        />
      </div>

      {/* Slot scope toggle */}
      <div style={{ padding: '0 12px 6px', display: 'flex', gap: '4px' }}>
        <button
          onClick={() => setShowAllSlots(false)}
          style={{
            flex: 1, padding: '4px 8px', fontSize: '10px', borderRadius: '3px', cursor: 'pointer',
            background: !showAllSlots ? '#3498db' : '#2a2a2a',
            color: !showAllSlots ? '#fff' : '#888',
            border: !showAllSlots ? '1px solid #3498db' : '1px solid #3a3a3a',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
          title={selectedSlot?.fileName || 'Current document'}
        >
          {selectedSlotName}
        </button>
        <button
          onClick={() => setShowAllSlots(true)}
          style={{
            flex: 1, padding: '4px 8px', fontSize: '10px', borderRadius: '3px', cursor: 'pointer',
            background: showAllSlots ? '#3498db' : '#2a2a2a',
            color: showAllSlots ? '#fff' : '#888',
            border: showAllSlots ? '1px solid #3498db' : '1px solid #3a3a3a',
          }}
        >
          All Documents
        </button>
      </div>

      {/* Sort + count */}
      <div style={{ padding: '0 12px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '11px', color: '#888' }}>
          {filtered.length}{filtered.length !== allMarkups.length ? ` / ${allMarkups.length}` : ''} markup{allMarkups.length !== 1 ? 's' : ''}
        </span>
        <div style={{ display: 'flex', gap: '3px' }}>
          {['date', 'type', 'author', 'document'].map(s => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              style={{
                padding: '3px 8px', fontSize: '10px', borderRadius: '3px', cursor: 'pointer',
                background: sortBy === s ? '#3498db' : '#2a2a2a',
                color: sortBy === s ? '#fff' : '#888',
                border: sortBy === s ? '1px solid #3498db' : '1px solid #3a3a3a',
              }}
            >
              {s === 'document' ? 'Doc' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Summary badges */}
      {allMarkups.length > 0 && (
        <div style={{ padding: '0 12px 8px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {Object.entries(typeCounts).map(([type, count]) => (
              <span
                key={type}
                onClick={() => setSearchQuery(searchQuery === type ? '' : type)}
                style={{
                  fontSize: '10px', padding: '2px 8px', borderRadius: '3px', cursor: 'pointer',
                  background: searchQuery === type ? '#444' : '#2a2a2a',
                  color: searchQuery === type ? '#fff' : '#999',
                  border: searchQuery === type ? '1px solid #666' : '1px solid #3a3a3a',
                }}
              >
                {type} ×{count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Markup list */}
      <div className="panel-content" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 12px 12px' }}>
        {sorted.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#555', fontSize: '13px', padding: '24px 8px' }}>
            {allMarkups.length === 0 ? 'No markups in any document.' : 'No markups match search.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {sorted.map((m) => {
              const isExpanded = expandedId === m.id;
              const fType = friendlyType(m);
              const created = formatDate(m.createdDate);
              const modified = formatDate(m.modifiedDate);
              const displayText = m.contents || m.text || null;
              const isLocked = !unlockedSlots || !unlockedSlots.has(m._slotId);

              return (
                <div
                  key={m.id}
                  onClick={() => {
                    setExpandedId(isExpanded ? null : m.id);
                    if (!isLocked && onSelectMarkup) onSelectMarkup(m);
                  }}
                  style={{
                    padding: '10px 12px',
                    background: isExpanded ? '#252525' : '#1e1e1e',
                    border: '1px solid #333',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    opacity: isLocked ? 0.6 : 1,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#2a2a2a'; e.currentTarget.style.borderColor = '#555'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = isExpanded ? '#252525' : '#1e1e1e'; e.currentTarget.style.borderColor = '#333'; }}
                >
                  {/* Row 1: Markup Type + Lock */}
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {fType}
                    {isLocked && <span style={{ fontSize: '11px', color: '#666' }} title="Document is locked — unlock to edit">🔒</span>}
                  </div>

                  {/* Row 2: Author */}
                  {m.author && (
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#eee', marginTop: '3px' }}>
                      {m.author}
                    </div>
                  )}

                  {/* Row 3: Created Date */}
                  {created && (
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#ccc', marginTop: '3px' }}>
                      {created}
                    </div>
                  )}

                  {/* Row 4: Document name (subtle) */}
                  {showAllSlots && (
                    <div style={{ fontSize: '11px', color: '#777', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      📄 {shortName(m._slotFileName)}
                    </div>
                  )}

                  {/* ─── Expanded details ─── */}
                  {isExpanded && (
                    <div style={{
                      marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #3a3a3a',
                      fontSize: '11px', color: '#999', lineHeight: 1.7,
                    }}>
                      {/* Modified date */}
                      {modified && (
                        <div>Modified: <span style={{ color: '#bbb' }}>{modified}</span></div>
                      )}

                      {/* Software */}
                      {m.software && (
                        <div>Software: <span style={{ color: '#bbb' }}>{m.software.replace(/:/g, ' ')}</span></div>
                      )}

                      {/* Document */}
                      <div>Document: <span style={{ color: '#bbb' }}>{m._slotFileName}</span></div>

                      {/* Text content */}
                      {displayText && (
                        <div style={{ marginTop: '4px', fontStyle: 'italic', color: '#aaa' }}>
                          "{displayText.length > 200 ? displayText.substring(0, 200) + '...' : displayText}"
                        </div>
                      )}

                      {/* Technical details */}
                      <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #333', fontSize: '10px', color: '#777', lineHeight: 1.6 }}>
                        {m.pdfSubtype && <div>PDF Subtype: <span style={{ color: '#999' }}>{m.pdfSubtype}</span></div>}
                        {m.annotationName && <div>PDF Name: <span style={{ color: '#999' }}>{m.annotationName}</span></div>}
                        {m.pdfAnnotId && <div>Annot ID: <span style={{ color: '#999' }}>{m.pdfAnnotId}</span></div>}
                        <div>Source: <span style={{ color: '#999' }}>{m.fromPdf ? 'PDF annotation' : 'User created'}</span></div>
                        <div>Internal ID: <span style={{ color: '#999' }}>{m.id}</span></div>
                        <div>Slot ID: <span style={{ color: '#999' }}>{m._slotId}</span></div>
                        {m.strokeWidth !== undefined && <div>Stroke: <span style={{ color: '#999' }}>{m.strokeWidth}px, {m.color || 'none'}</span></div>}
                        {m.fillColor && m.fillColor !== 'none' && <div>Fill: <span style={{ color: '#999' }}>{m.fillColor}{m.fillOpacity != null ? ` @ ${Math.round(m.fillOpacity * 100)}%` : ''}</span></div>}
                        {m.rotation ? <div>Rotation: <span style={{ color: '#999' }}>{m.rotation}°</span></div> : null}
                        {m.fontSize && <div>Font: <span style={{ color: '#999' }}>{m.fontSize}pt {m.fontFamily || ''}</span></div>}
                      </div>

                      <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                        {onScrollToMarkup && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onScrollToMarkup(m); }}
                            style={{
                              padding: '4px 10px', fontSize: '10px',
                              background: '#333', border: '1px solid #555', borderRadius: '4px',
                              color: '#ccc', cursor: 'pointer',
                            }}
                          >
                            🔍 Scroll to markup
                          </button>
                        )}
                        {onDeleteMarkup && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isLocked) return;
                              onDeleteMarkup(m);
                              setExpandedId(null);
                            }}
                            disabled={isLocked}
                            style={{
                              padding: '4px 10px', fontSize: '10px',
                              background: isLocked ? '#2a2a2a' : '#3a1a1a',
                              border: isLocked ? '1px solid #333' : '1px solid #662222',
                              borderRadius: '4px',
                              color: isLocked ? '#666' : '#e55',
                              cursor: isLocked ? 'not-allowed' : 'pointer',
                            }}
                            title={isLocked ? 'Unlock document to delete' : 'Delete this markup'}
                          >
                            🗑 Delete
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Export at bottom */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid #333' }}>
        <button
          onClick={handleExportData}
          style={{
            width: '100%', padding: '6px 8px',
            background: '#2a2a2a', border: '1px solid #444', borderRadius: '4px',
            color: '#aaa', fontSize: '11px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
          }}
          title="Download a JSON file with all raw annotation data"
        >
          📋 Export Raw Annotation Data
        </button>
      </div>
    </div>
  );
}
