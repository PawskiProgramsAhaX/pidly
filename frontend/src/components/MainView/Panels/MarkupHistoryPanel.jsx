/**
 * MarkupHistoryPanel.jsx
 * 
 * Panel showing all markups in the current document with metadata.
 * Collapsed: Type, Author, Created Date (bold white).
 * Expanded: Software, modified date, text content, IDs, stroke, fill, etc.
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
    arrow: 'Arrow', line: 'Line', text: 'Text Box', cloudPolyline: 'Cloud',
    polyline: 'Polyline', polylineArrow: 'Polyline Arrow', polygon: 'Polygon',
    symbol: 'Symbol', image: 'Image', stamp: 'Stamp', note: 'Note',
    callout: 'Callout', arc: 'Arc', textHighlight: 'Text Highlight',
    textMarkup: 'Text Markup',
  };
  return map[markup.type] || markup.type;
}

export default function MarkupHistoryPanel({
  isOpen,
  onClose,
  markups,
  currentPage,
  numPages,
  onDumpAnnotations,
  onSelectMarkup,
  onDeleteMarkup,
  onScrollToMarkup,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [sortBy, setSortBy] = useState('date');
  const [showAllPages, setShowAllPages] = useState(false);

  // Filter by page first, then by search
  const filtered = useMemo(() => {
    if (!markups) return [];
    let result = markups;
    
    // Page filter (unless showing all pages)
    if (!showAllPages && currentPage != null) {
      result = result.filter(m => (m.page || 0) === currentPage - 1);
    }
    
    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(m => {
        const searchable = [
          friendlyType(m), m.author, m.pdfSubject, m.software,
          m.contents, m.text, m.annotationName, m.type, m.pdfSubtype,
          `page ${(m.page || 0) + 1}`,
        ].filter(Boolean).join(' ').toLowerCase();
        return searchable.includes(q);
      });
    }
    
    return result;
  }, [markups, searchQuery, currentPage, showAllPages]);

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
      case 'page':
        arr.sort((a, b) => (a.page || 0) - (b.page || 0));
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
  markups.forEach(m => {
    const t = friendlyType(m);
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });

  return (
    <div className="smart-links-panel" style={{ width: '320px', minWidth: '320px', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ paddingBottom: '8px' }}>
        <h3>Markup History</h3>
        <button className="close-panel" onClick={onClose}>×</button>
      </div>

      {/* Search */}
      <div style={{ padding: '0 12px 8px' }}>
        <input
          type="text"
          placeholder="Search by type, author, text, page..."
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

      {/* Page scope toggle */}
      <div style={{ padding: '0 12px 6px', display: 'flex', gap: '4px' }}>
        <button
          onClick={() => setShowAllPages(false)}
          style={{
            flex: 1, padding: '4px 8px', fontSize: '10px', borderRadius: '3px', cursor: 'pointer',
            background: !showAllPages ? '#3498db' : '#2a2a2a',
            color: !showAllPages ? '#fff' : '#888',
            border: !showAllPages ? '1px solid #3498db' : '1px solid #3a3a3a',
          }}
        >
          Page {currentPage || 1}
        </button>
        <button
          onClick={() => { if ((numPages || 1) > 1) setShowAllPages(true); }}
          disabled={(numPages || 1) <= 1}
          style={{
            flex: 1, padding: '4px 8px', fontSize: '10px', borderRadius: '3px',
            cursor: (numPages || 1) <= 1 ? 'not-allowed' : 'pointer',
            background: (numPages || 1) <= 1 ? '#1e1e1e' : showAllPages ? '#3498db' : '#2a2a2a',
            color: (numPages || 1) <= 1 ? '#555' : showAllPages ? '#fff' : '#888',
            border: (numPages || 1) <= 1 ? '1px solid #2a2a2a' : showAllPages ? '1px solid #3498db' : '1px solid #3a3a3a',
          }}
        >
          All Pages
        </button>
      </div>

      {/* Sort + count */}
      <div style={{ padding: '0 12px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '11px', color: '#888' }}>
          {filtered.length}{filtered.length !== markups.length ? ` / ${markups.length}` : ''} markup{markups.length !== 1 ? 's' : ''}
        </span>
        <div style={{ display: 'flex', gap: '3px' }}>
          {['date', 'type', 'author', 'page'].map(s => (
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
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Summary badges */}
      {markups.length > 0 && (
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
            {markups.length === 0 ? 'No markups loaded.' : 'No markups match search.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {sorted.map((m) => {
              const isExpanded = expandedId === m.id;
              const fType = friendlyType(m);
              const created = formatDate(m.createdDate);
              const modified = formatDate(m.modifiedDate);
              const displayText = m.contents || m.text || null;

              return (
                <div
                  key={m.id}
                  onClick={() => {
                    setExpandedId(isExpanded ? null : m.id);
                    if (onSelectMarkup) onSelectMarkup(m);
                  }}
                  style={{
                    padding: '10px 12px',
                    background: isExpanded ? '#252525' : '#1e1e1e',
                    border: '1px solid #333',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#2a2a2a'; e.currentTarget.style.borderColor = '#555'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = isExpanded ? '#252525' : '#1e1e1e'; e.currentTarget.style.borderColor = '#333'; }}
                >
                  {/* Row 1: Markup Type */}
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff' }}>
                    {fType}
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

                      {/* Page */}
                      <div>Page: <span style={{ color: '#bbb' }}>{(m.page || 0) + 1}</span></div>

                      {/* Text content */}
                      {displayText && (
                        <div style={{ marginTop: '4px', fontStyle: 'italic', color: '#aaa' }}>
                          "{displayText}"
                        </div>
                      )}

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
                            📍 Scroll to markup
                          </button>
                        )}
                        {onDeleteMarkup && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteMarkup(m);
                              setExpandedId(null);
                            }}
                            style={{
                              padding: '4px 10px', fontSize: '10px',
                              background: '#3a1a1a', border: '1px solid #662222', borderRadius: '4px',
                              color: '#e55', cursor: 'pointer',
                            }}
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
      {onDumpAnnotations && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid #333' }}>
          <button
            onClick={onDumpAnnotations}
            style={{
              width: '100%', padding: '6px 8px',
              background: '#2a2a2a', border: '1px solid #444', borderRadius: '4px',
              color: '#aaa', fontSize: '11px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
            }}
            title="Download a text file with all raw annotation data from this PDF"
          >
            📋 Export Raw Annotation Data
          </button>
        </div>
      )}
    </div>
  );
}
