import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

const ROW_HEIGHT = 60;
const BUFFER_ROWS = 5;

/**
 * Class detail panel — data table with sorting, selection, gallery view.
 */
export default function ClassDetailPanel({
  // Class data
  selectedClass, classData, columns,
  // Column helpers
  getColumnWidth, getColumnAlignment, toggleColumnAlignment,
  columnFilters, handleFilterChange, handleResizeStart,
  // Cell editing
  editingCell, editValue, setEditValue, startEditing, saveEdit, cancelEdit,
  getCellValue,
  // Thumbnails
  thumbnails, loadingThumbnails, loadThumbnail,
  // Actions
  refreshData, handleDeleteObject, handleDeleteFilteredObjects,
  handleDeleteClass, handleDeleteColumn,
  extractClasses, getSelectedClassSubclasses,
  // Batch edit
  handleBatchEditField,
  // Find/Replace
  showFindReplace, setShowFindReplace,
  findText, setFindText, replaceText, setReplaceText,
  findField, setFindField, matchCase, setMatchCase,
  findMatches, handleReplaceAll, getSearchableFields,
  // Toolbar actions
  onAddSubclass, onAddColumn, onExport,
  // Navigation
  handleFindObject,
  // Project
  project,
  // Undo
  undo, redo, canUndo, canRedo,
  // Gallery config
  galleryConfig,
  // Table config
  tableConfig,
  // Settings panel toggle
  settingsCollapsed, onToggleSettings,
}) {
  const tableRef = useRef(null);
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableHeight, setTableHeight] = useState(600);

  const subclasses = getSelectedClassSubclasses();

  // ─── View mode: table or gallery ──────────────────────────────────
  const [detailViewMode, setDetailViewMode] = useState('table');

  // ─── Sorting ──────────────────────────────────────────────────────
  const [sortConfig, setSortConfig] = useState([]);

  const handleHeaderClick = useCallback((colId, e) => {
    setSortConfig(prev => {
      const isMulti = e.shiftKey;
      const existing = prev.findIndex(s => s.colId === colId);
      if (existing >= 0) {
        const cur = prev[existing];
        if (cur.direction === 'asc') {
          const next = [...prev];
          next[existing] = { colId, direction: 'desc' };
          return next;
        } else {
          return prev.filter((_, i) => i !== existing);
        }
      }
      if (isMulti) return [...prev, { colId, direction: 'asc' }];
      return [{ colId, direction: 'asc' }];
    });
  }, []);

  const sortedData = useMemo(() => {
    if (sortConfig.length === 0) return classData;
    const sorted = [...classData];
    sorted.sort((a, b) => {
      for (const { colId, direction } of sortConfig) {
        const col = columns.find(c => c.id === colId);
        let aVal, bVal;
        if (col?.isSubclass) {
          aVal = (a.subclassValues || {})[col.subclassName] || '';
          bVal = (b.subclassValues || {})[col.subclassName] || '';
        } else {
          aVal = a[colId] ?? '';
          bVal = b[colId] ?? '';
        }
        const aNum = parseFloat(aVal);
        const bNum = parseFloat(bVal);
        if (!isNaN(aNum) && !isNaN(bNum)) {
          if (aNum !== bNum) return direction === 'asc' ? aNum - bNum : bNum - aNum;
        } else {
          const cmp = String(aVal).localeCompare(String(bVal));
          if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
        }
      }
      return 0;
    });
    return sorted;
  }, [classData, sortConfig, columns]);

  // ─── Row selection ────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState(null);

  useEffect(() => { setSelectedIds(new Set()); setLastClickedIndex(null); }, [selectedClass?.name]);

  const toggleSelect = useCallback((id, index, e) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (e.shiftKey && lastClickedIndex !== null) {
        const start = Math.min(lastClickedIndex, index);
        const end = Math.max(lastClickedIndex, index);
        for (let i = start; i <= end; i++) {
          if (sortedData[i]) next.add(sortedData[i].id);
        }
      } else if (e.ctrlKey || e.metaKey) {
        if (next.has(id)) next.delete(id); else next.add(id);
      } else {
        if (next.size === 1 && next.has(id)) return new Set();
        return new Set([id]);
      }
      return next;
    });
    setLastClickedIndex(index);
  }, [lastClickedIndex, sortedData]);

  const selectAll = useCallback(() => {
    if (selectedIds.size === sortedData.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedData.map(o => o.id)));
    }
  }, [sortedData, selectedIds.size]);

  // ─── Batch operations ─────────────────────────────────────────────
  const handleBatchDelete = useCallback(() => {
    if (!selectedIds.size) return;
    if (!confirm(`Delete ${selectedIds.size} selected object(s)?`)) return;
    selectedIds.forEach(id => handleDeleteObject(id, true));
    setSelectedIds(new Set());
  }, [selectedIds, handleDeleteObject]);

  // ─── Gallery ──────────────────────────────────────────────────────
  const [galleryCols, setGalleryCols] = useState(4);
  const [gallerySearch, setGallerySearch] = useState('');
  const [galleryFilters, setGalleryFilters] = useState({}); // { colId: value }

  // Unique values per column for filter dropdowns
  const galleryFilterOptions = useMemo(() => {
    const opts = {};
    (columns || []).forEach(col => {
      const vals = new Set();
      sortedData.forEach(obj => {
        const v = col.isSubclass ? (obj.subclassValues || {})[col.subclassName] : obj[col.id];
        if (v != null && String(v).trim()) vals.add(String(v).trim());
      });
      if (vals.size > 0 && vals.size <= 50) opts[col.id] = [...vals].sort();
    });
    return opts;
  }, [columns, sortedData]);

  // Active filter columns (only show filters for columns that have options)
  const galleryFilterableCols = useMemo(() =>
    (columns || []).filter(c => galleryFilterOptions[c.id]?.length > 0),
    [columns, galleryFilterOptions]
  );

  const galleryData = useMemo(() => {
    let data = sortedData;
    // Text search across all fields
    if (gallerySearch.trim()) {
      const q = gallerySearch.trim().toLowerCase();
      data = data.filter(obj => {
        const filename = (obj.filename || obj.originalFilename || '').toLowerCase();
        if (filename.includes(q)) return true;
        for (const col of (columns || [])) {
          const v = col.isSubclass ? (obj.subclassValues || {})[col.subclassName] : obj[col.id];
          if (v != null && String(v).toLowerCase().includes(q)) return true;
        }
        return false;
      });
    }
    // Column filters
    for (const [colId, filterVal] of Object.entries(galleryFilters)) {
      if (!filterVal) continue;
      const col = (columns || []).find(c => c.id === colId);
      if (!col) continue;
      data = data.filter(obj => {
        const v = col.isSubclass ? (obj.subclassValues || {})[col.subclassName] : obj[col.id];
        return String(v || '') === filterVal;
      });
    }
    return data;
  }, [sortedData, gallerySearch, galleryFilters, columns]);

  const activeGalleryFilterCount = Object.values(galleryFilters).filter(Boolean).length + (gallerySearch.trim() ? 1 : 0);

  // ─── Virtualization ───────────────────────────────────────────────
  useEffect(() => {
    const updateHeight = () => { if (tableRef.current) setTableHeight(tableRef.current.clientHeight); };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    const ro = new ResizeObserver(updateHeight);
    if (tableRef.current) ro.observe(tableRef.current);
    return () => { window.removeEventListener('resize', updateHeight); ro.disconnect(); };
  }, [selectedClass]);

  const { visibleStartIndex, visibleEndIndex } = useMemo(() => {
    const total = sortedData.length;
    const start = Math.max(0, Math.floor(tableScrollTop / ROW_HEIGHT) - BUFFER_ROWS);
    const count = Math.ceil(tableHeight / ROW_HEIGHT) + (BUFFER_ROWS * 2);
    return { visibleStartIndex: start, visibleEndIndex: Math.min(total, start + count) };
  }, [sortedData.length, tableScrollTop, tableHeight]);

  const visibleRows = useMemo(() => sortedData.slice(visibleStartIndex, visibleEndIndex), [sortedData, visibleStartIndex, visibleEndIndex]);

  const handleEditKeyPress = (e) => {
    if (e.key === 'Enter') saveEdit();
    else if (e.key === 'Escape') cancelEdit();
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo?.(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo?.(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && detailViewMode === 'table') {
        const el = document.activeElement;
        if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) { e.preventDefault(); selectAll(); }
      }
      if (e.key === 'Delete' && selectedIds.size > 0) {
        const el = document.activeElement;
        if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) {
          e.preventDefault();
          handleBatchDelete();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [undo, redo, selectAll, detailViewMode, selectedIds, handleBatchDelete]);

  const hFs = tableConfig?.headerFontSize;
  const hC = tableConfig?.headerColor;
  const hB = tableConfig?.headerBold;
  const hI = tableConfig?.headerItalic;

  return (
    <>
      {/* Header Toolbar */}
      <div style={{ background: '#1a1a1a', borderBottom: '1px solid #333', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '60px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={onToggleSettings}
            title={settingsCollapsed ? 'Show settings panel' : 'Hide settings panel'}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: settingsCollapsed ? '#888' : '#3498db', padding: '4px',
              borderRadius: '4px', outline: 'none', display: 'flex', alignItems: 'center',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {settingsCollapsed ? (
                <><polyline points="9 18 15 12 9 6" /></>
              ) : (
                <><polyline points="15 18 9 12 15 6" /></>
              )}
            </svg>
          </button>
          {sortConfig.length > 0 && (
            <button onClick={() => setSortConfig([])} title="Clear sorting" style={pillBtnStyle('#2a2a2a')}>
              Sort ×
            </button>
          )}
          {selectedIds.size > 0 && (
            <span style={{ fontSize: '11px', color: '#3498db', fontWeight: 700 }}>
              {selectedIds.size} selected
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ToolbarBtn onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↩</ToolbarBtn>
          <ToolbarBtn onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">↪</ToolbarBtn>
          <Sep />
          <ViewToggle mode={detailViewMode} onChange={setDetailViewMode} />
          <Sep />
          <ToolbarBtn onClick={refreshData} title="Refresh">Refresh</ToolbarBtn>
          <ToolbarBtn onClick={onAddColumn}>+ Column</ToolbarBtn>
          <ToolbarBtn onClick={onExport}>Export</ToolbarBtn>
          <ToolbarBtn
            onClick={() => {
              if (selectedIds.size > 0) {
                handleBatchDelete();
              } else {
                handleDeleteClass(selectedClass.name);
              }
            }}
            title={selectedIds.size > 0 ? `Delete ${selectedIds.size} selected object(s)` : 'Delete class'}
          >
            {selectedIds.size > 0 ? `Delete (${selectedIds.size})` : 'Delete Class'}
          </ToolbarBtn>
        </div>
      </div>

      {/* Find and Replace */}
      {showFindReplace && (
        <div className="find-replace-panel">
          <div className="find-replace-row">
            <label>Find</label>
            <input type="text" value={findText} onChange={(e) => setFindText(e.target.value)} placeholder="Search text..." autoFocus />
            <span className="field-label">in</span>
            <select value={findField} onChange={(e) => setFindField(e.target.value)}>
              {getSearchableFields().map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <label className="match-case-label">
              <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
              Match case
            </label>
          </div>
          <div className="find-replace-row">
            <label>Replace</label>
            <input type="text" value={replaceText} onChange={(e) => setReplaceText(e.target.value)} placeholder="Replace with..." />
            <span className="match-count">{findText ? `${findMatches.length} match${findMatches.length !== 1 ? 'es' : ''}` : ''}</span>
            <button className="replace-all-btn" onClick={handleReplaceAll} disabled={!findText || !findMatches.length || findField === 'filename'}>Replace All</button>
            <button className="close-find-btn" onClick={() => { setShowFindReplace(false); setFindText(''); setReplaceText(''); }}>×</button>
          </div>
        </div>
      )}

      {/* ─── GALLERY VIEW ───────────────────────────────────────── */}
      {detailViewMode === 'gallery' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#1a1a1a' }}>
          {/* Gallery toolbar */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #333', display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
            {/* Row 1: Search + grid size + load all */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ position: 'relative', flex: 1, maxWidth: '300px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"
                  style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }}>
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  placeholder="Search objects..."
                  value={gallerySearch}
                  onChange={(e) => setGallerySearch(e.target.value)}
                  style={{
                    width: '100%', padding: '7px 10px 7px 32px', background: '#222',
                    border: '1px solid #333', borderRadius: '6px', color: '#fff',
                    fontSize: '12px', outline: 'none', boxSizing: 'border-box',
                  }}
                />
                {gallerySearch && (
                  <button
                    onClick={() => setGallerySearch('')}
                    style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px' }}
                  >×</button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '11px', color: '#666' }}>Grid:</span>
                {[3, 4, 5, 6, 8].map(n => (
                  <button key={n} onClick={() => setGalleryCols(n)} style={{
                    ...pillBtnStyle(galleryCols === n ? '#3498db' : '#2a2a2a'),
                    color: galleryCols === n ? '#fff' : '#888',
                  }}>{n}</button>
                ))}
              </div>
              <button
                onClick={() => galleryData.forEach(obj => { if (!thumbnails[obj.id] && !loadingThumbnails[obj.id]) loadThumbnail(obj); })}
                style={pillBtnStyle('#2a2a2a')}
              >Load All</button>
              <span style={{ fontSize: '11px', color: '#666', marginLeft: 'auto' }}>
                {galleryData.length}{galleryData.length !== sortedData.length ? ` / ${sortedData.length}` : ''} objects
              </span>
            </div>

            {/* Row 2: Column filters */}
            {galleryFilterableCols.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '10px', color: '#666', fontWeight: 600 }}>Filter:</span>
                {galleryFilterableCols.map(col => (
                  <select
                    key={col.id}
                    value={galleryFilters[col.id] || ''}
                    onChange={(e) => setGalleryFilters(prev => ({ ...prev, [col.id]: e.target.value }))}
                    style={{
                      padding: '4px 8px', background: galleryFilters[col.id] ? '#1a2535' : '#222',
                      border: galleryFilters[col.id] ? '1px solid #3498db' : '1px solid #333',
                      borderRadius: '4px', color: '#ccc', fontSize: '11px', outline: 'none',
                      maxWidth: '160px',
                    }}
                  >
                    <option value="">{col.name}</option>
                    {(galleryFilterOptions[col.id] || []).map(v => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                ))}
                {activeGalleryFilterCount > 0 && (
                  <button
                    onClick={() => { setGalleryFilters({}); setGallerySearch(''); }}
                    style={{ ...pillBtnStyle('#2a2a2a'), color: '#e74c3c' }}
                  >
                    Clear {activeGalleryFilterCount} filter{activeGalleryFilterCount > 1 ? 's' : ''}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Gallery grid */}
          <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px', scrollbarWidth: 'thin', scrollbarColor: '#444 #1a1a1a' }}>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${galleryCols}, 1fr)`, gap: '8px' }}>
              {galleryData.map((obj, idx) => (
                <GalleryCard
                  key={obj.id}
                  obj={obj} idx={idx}
                  isSelected={selectedIds.has(obj.id)}
                  isOrphaned={obj.status === 'orphaned'}
                  thumbnail={thumbnails[obj.id]}
                  isLoading={loadingThumbnails[obj.id]}
                  onLoadThumbnail={() => loadThumbnail(obj)}
                  onSelect={(e) => toggleSelect(obj.id, idx, e)}
                  onGo={() => obj.status !== 'orphaned' && handleFindObject(obj)}
                  onDelete={() => handleDeleteObject(obj.id)}
                  isMatch={findText && findMatches.some(m => m.id === obj.id)}
                  columns={columns}
                  getCellValue={getCellValue}
                  galleryConfig={galleryConfig}
                  onEditField={(fieldId, value) => handleBatchEditField?.([obj.id], fieldId, value)}
                />
              ))}
            </div>
            {galleryData.length === 0 && (
              <div style={{ textAlign: 'center', color: '#555', fontSize: '14px', padding: '40px', fontWeight: 600 }}>
                {activeGalleryFilterCount > 0 ? 'No objects match filters' : 'No objects in this class'}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ─── TABLE VIEW ────────────────────────────────────────── */
        <div
          ref={tableRef}
          style={{ flex: 1, overflow: 'auto', background: '#1a1a1a', scrollbarWidth: 'thin', scrollbarColor: '#444 #1a1a1a' }}
          onScroll={(e) => {
            setTableScrollTop(e.target.scrollTop);
            if (e.target.clientHeight !== tableHeight) setTableHeight(e.target.clientHeight);
          }}
        >
          <table className="csv-table" style={{ borderCollapse: 'separate', borderSpacing: 0, background: '#1a1a1a', width: 'max-content' }}>
            <colgroup>
              <col style={{ width: '36px', minWidth: '36px' }} />
              {columns.map(col => <col key={col.id} style={{ width: getColumnWidth(col.id), minWidth: getColumnWidth(col.id) }} />)}
            </colgroup>
            <thead style={{ background: '#1a1a1a' }}>
              <tr>
                <th style={{ ...stickyHeaderStyle(36, hFs, hC, hB, hI), cursor: 'pointer' }} onClick={selectAll}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size > 0 && selectedIds.size === sortedData.length}
                    ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < sortedData.length; }}
                    onChange={selectAll}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </th>
                {columns.map(col => {
                  const sortEntry = sortConfig.find(s => s.colId === col.id);
                  const sortIndex = sortConfig.findIndex(s => s.colId === col.id);
                  return (
                    <SortableColumnHeader
                      key={col.id} col={col}
                      width={getColumnWidth(col.id)}
                      alignment={getColumnAlignment(col.id)}
                      filterValue={columnFilters[col.id] || ''}
                      onFilterChange={(val) => handleFilterChange(col.id, val)}
                      onToggleAlignment={() => toggleColumnAlignment(col.id)}
                      onDelete={() => handleDeleteColumn(col.id)}
                      onResizeStart={(e) => handleResizeStart(e, col.id)}
                      onSort={(e) => handleHeaderClick(col.id, e)}
                      sortDirection={sortEntry?.direction || null}
                      sortIndex={sortConfig.length > 1 ? sortIndex + 1 : null}
                      headerFontSize={tableConfig?.headerFontSize}
                      headerColor={tableConfig?.headerColor}
                      headerBold={tableConfig?.headerBold}
                      headerItalic={tableConfig?.headerItalic}
                    />
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedData.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 1} style={{ background: '#1a1a1a', color: '#666', fontWeight: 600, textAlign: 'center', padding: '20px' }}>
                    No objects in this class
                  </td>
                </tr>
              ) : (
                <>
                  {visibleStartIndex > 0 && (
                    <tr style={{ height: visibleStartIndex * ROW_HEIGHT }}><td colSpan={columns.length + 1} style={{ padding: 0, border: 'none', background: '#1a1a1a' }} /></tr>
                  )}
                  {visibleRows.map((obj, localIndex) => {
                    const globalIndex = visibleStartIndex + localIndex;
                    const isOrphaned = obj.status === 'orphaned';
                    const isSel = selectedIds.has(obj.id);
                    const bg = isSel ? '#1a2535' : '#1a1a1a';
                    return (
                      <tr
                        key={obj.id || globalIndex}
                        onClick={(e) => {
                          // Don't trigger if clicking buttons/inputs/links
                          if (e.target.closest('button, input, a')) return;
                          toggleSelect(obj.id, globalIndex, e);
                        }}
                        style={{ height: ROW_HEIGHT, background: bg, cursor: 'default' }}
                        className={`${findText && findMatches.some(m => m.id === obj.id) ? 'highlight-match' : ''} ${isOrphaned ? 'orphaned-row' : ''}`}
                      >
                        <td style={{ ...cellStyle(36), background: bg }}>
                          <input type="checkbox" checked={isSel}
                            onClick={(e) => { e.stopPropagation(); toggleSelect(obj.id, globalIndex, e); }}
                            readOnly
                            style={{ cursor: 'pointer' }} />
                        </td>
                        {columns.map(col => {
                          const val = () => col.isSubclass ? ((obj.subclassValues || {})[col.subclassName] || '') : (obj[col.id] || '');
                          return (
                            <td
                              key={col.id}
                              onClick={() => col.editable && startEditing(obj.id, col.id, val())}
                              style={{
                                width: getColumnWidth(col.id), minWidth: getColumnWidth(col.id),
                                textAlign: getColumnAlignment(col.id),
                                background: bg, color: tableConfig?.fontColor || '#ccc',
                                fontWeight: tableConfig?.fontBold ? 700 : 400,
                                fontStyle: tableConfig?.fontItalic ? 'italic' : 'normal',
                                borderBottom: '1px solid #222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                padding: '0 12px', fontSize: `${tableConfig?.fontSize || 13}px`,
                                cursor: col.editable ? 'text' : 'default',
                              }}
                            >
                              {editingCell?.rowId === obj.id && editingCell?.column === col.id ? (
                                <input type="text" style={{ background: '#222', color: '#fff', border: '1px solid #3498db', padding: '4px 8px', width: '100%', fontWeight: 500 }}
                                  value={editValue} onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={handleEditKeyPress} onBlur={saveEdit} autoFocus />
                              ) : col.id === 'filename' && isOrphaned ? (
                                <span style={{ color: '#e74c3c' }}><del>{obj.originalFilename?.replace('.pdf', '') || 'Deleted'}</del></span>
                              ) : (
                                <span className={col.editable ? 'editable-text' : ''} style={{ color: tableConfig?.fontColor || '#ccc' }}>{getCellValue(obj, col)}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {visibleEndIndex < sortedData.length && (
                    <tr style={{ height: (sortedData.length - visibleEndIndex) * ROW_HEIGHT }}><td colSpan={columns.length + 1} style={{ padding: 0, border: 'none', background: '#1a1a1a' }} /></tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════ */

function GalleryCard({ obj, idx, isSelected, isOrphaned, thumbnail, isLoading, onLoadThumbnail, onSelect, onGo, onDelete, isMatch, columns, getCellValue, galleryConfig, onEditField }) {
  const [h, setH] = useState(false);
  const [editingTag, setEditingTag] = useState(null); // { colId, colName }
  const [editTagValue, setEditTagValue] = useState('');
  const editRef = useRef(null);

  const cfg = galleryConfig || {};
  const textSize = cfg.textSize || 'small';
  const cardHeight = cfg.cardHeight || 100;
  const showLabels = cfg.showLabels !== false;
  const showFilename = cfg.showFilename !== false;
  const showPage = cfg.showPage !== false;
  const showConfidence = cfg.showConfidence === true;
  const visibleCols = cfg.visibleColumns || {};

  const fontSize = textSize === 'large' ? '22px' : textSize === 'medium' ? '16px' : '12px';
  const tagFontSize = textSize === 'large' ? '20px' : textSize === 'medium' ? '14px' : '10px';

  const filename = obj.filename?.replace('.pdf', '') || obj.originalFilename?.replace('.pdf', '') || 'Unknown';
  const confidence = obj.confidence != null ? `${(obj.confidence * 100).toFixed(1)}%` : null;

  // Collect visible tag/subclass values
  const tags = (columns || [])
    .filter(c => c.id !== 'filename' && c.id !== 'confidence' && c.id !== 'ocr_confidence' && c.id !== 'page_num')
    .filter(c => visibleCols[c.id] !== false)
    .map(col => {
      const val = getCellValue ? getCellValue(obj, col) : (col.isSubclass ? (obj.subclassValues || {})[col.subclassName] : obj[col.id]);
      return { id: col.id, name: col.name, value: val ? String(val) : '', editable: col.editable };
    });

  const startTagEdit = (tag, e) => {
    e.stopPropagation();
    setEditingTag({ colId: tag.id, colName: tag.name });
    setEditTagValue(tag.value);
    setTimeout(() => editRef.current?.focus(), 0);
  };

  const commitTagEdit = () => {
    if (editingTag && editTagValue !== undefined) {
      const original = tags.find(t => t.id === editingTag.colId);
      if (original && editTagValue !== original.value) {
        onEditField?.(editingTag.colId, editTagValue);
      }
    }
    setEditingTag(null);
  };

  return (
    <div
      onClick={(e) => { if (!editingTag) onSelect(e); }}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        background: isSelected ? '#1a2535' : (h ? '#222' : '#1a1a1a'),
        border: isMatch ? '1px solid #e67e22' : '1px solid transparent',
        borderRadius: '8px', cursor: 'pointer', overflow: 'hidden',
        transition: 'all 0.12s', position: 'relative',
      }}
    >
      {/* Thumbnail */}
      <div style={{ height: `${cardHeight}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#161616' }}>
        {isOrphaned ? <span style={{ fontSize: '24px' }}>⚠️</span>
          : thumbnail ? <img src={thumbnail} alt="" style={{ maxWidth: '100%', maxHeight: `${cardHeight - 4}px`, objectFit: 'contain' }} />
          : isLoading ? <span style={{ color: '#888', fontSize: '12px' }}>Loading...</span>
          : <button onClick={(e) => { e.stopPropagation(); onLoadThumbnail(); }} title="Load preview" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px', opacity: 0.25, transition: 'opacity 0.15s' }} onMouseEnter={(e) => e.currentTarget.style.opacity = '0.6'} onMouseLeave={(e) => e.currentTarget.style.opacity = '0.25'}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            </button>}
      </div>

      {/* Tags / field values */}
      <div style={{ padding: '6px 8px 2px' }}>
        {tags.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '3px' }}>
            {tags.map(t => (
              editingTag?.colId === t.id ? (
                <input
                  key={t.id}
                  ref={editRef}
                  type="text"
                  value={editTagValue}
                  onChange={(e) => setEditTagValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitTagEdit(); if (e.key === 'Escape') setEditingTag(null); }}
                  onBlur={commitTagEdit}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    padding: '2px 6px', background: '#2a2a2a', border: '1px solid #3498db',
                    borderRadius: '4px', fontSize: tagFontSize, fontWeight: 600, color: '#fff',
                    outline: 'none', minWidth: '40px', maxWidth: '100%',
                  }}
                />
              ) : (
                <span
                  key={t.id}
                  title={`${t.name}: ${t.value || '(empty)'} — click to edit`}
                  onClick={(e) => t.editable && startTagEdit(t, e)}
                  style={{
                    padding: '2px 6px', background: '#2a2a2a', border: '1px solid #333',
                    borderRadius: '4px', fontSize: tagFontSize, fontWeight: 600,
                    color: t.value ? '#ccc' : '#555',
                    maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    cursor: t.editable ? 'text' : 'default',
                    fontStyle: t.value ? 'normal' : 'italic',
                  }}
                >
                  {showLabels && <span style={{ color: '#666', marginRight: '3px' }}>{t.name}:</span>}
                  {t.value || '—'}
                </span>
              )
            ))}
          </div>
        ) : null}

        {/* Document + metadata line */}
        <div style={{ fontSize: fontSize, color: '#666', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingBottom: '4px' }}>
          {showFilename && <span>{filename}</span>}
          {showPage && obj.page_num != null && <span style={{ color: '#555' }}>{showFilename ? ' · ' : ''}P{obj.page_num}</span>}
          {showConfidence && confidence && <span style={{ color: '#555' }}>{(showFilename || showPage) ? ' · ' : ''}{confidence}</span>}
        </div>
      </div>

      {/* Hover actions */}
      {h && !editingTag && (
        <div style={{ position: 'absolute', top: '4px', right: '4px', display: 'flex', gap: '2px' }}>
          {!isOrphaned && <GoButton isOrphaned={false} onGo={() => { onGo(); }} compact />}
          <GalleryBtn onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
          </GalleryBtn>
        </div>
      )}
      {isSelected && (
        <div style={{ position: 'absolute', top: '4px', left: '4px', width: '18px', height: '18px', borderRadius: '4px', background: '#3498db', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
        </div>
      )}
    </div>
  );
}

function GoButton({ isOrphaned, onGo, compact }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!showConfirm) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setShowConfirm(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showConfirm]);

  if (isOrphaned) {
    return compact ? null : (
      <button disabled title="Cannot find - file deleted"
        style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
      </button>
    );
  }

  const iconSize = compact ? 12 : 14;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={(e) => { e.stopPropagation(); setShowConfirm(!showConfirm); }}
        title="Go to object"
        style={compact ? {
          background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '4px',
          padding: '4px', cursor: 'pointer', color: '#ccc',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        } : {
          background: 'transparent', border: 'none', color: '#3498db',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
      </button>
      {showConfirm && (
        <div style={{
          position: 'absolute', left: compact ? 'auto' : '100%', right: compact ? '100%' : 'auto',
          top: '50%', transform: 'translateY(-50%)',
          marginLeft: compact ? 0 : '6px', marginRight: compact ? '6px' : 0,
          background: '#2a2a2a', border: '1px solid #444', borderRadius: '8px',
          padding: '10px 14px', zIndex: 100, whiteSpace: 'nowrap',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', gap: '10px',
        }}
        onClick={(e) => e.stopPropagation()}
        >
          <span style={{ fontSize: '12px', color: '#ccc', fontWeight: 600 }}>Go to object?</span>
          <button
            onClick={(e) => { e.stopPropagation(); setShowConfirm(false); onGo(); }}
            style={{
              padding: '5px 14px', background: '#3498db', border: 'none', borderRadius: '5px',
              color: '#fff', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
            }}
          >Go</button>
          <button
            onClick={(e) => { e.stopPropagation(); setShowConfirm(false); }}
            style={{
              padding: '5px 10px', background: '#333', border: '1px solid #444', borderRadius: '5px',
              color: '#888', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
            }}
          >Cancel</button>
        </div>
      )}
    </div>
  );
}

function GalleryBtn({ children, onClick, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '4px',
      padding: '4px', cursor: 'pointer', color: '#ccc',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>{children}</button>
  );
}

function ViewToggle({ mode, onChange }) {
  return (
    <div style={{ display: 'inline-flex', background: '#1a1a1a', borderRadius: '6px', padding: '2px', border: '1px solid #333' }}>
      <VTBtn active={mode === 'table'} onClick={() => onChange('table')} title="Table">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /></svg>
      </VTBtn>
      <VTBtn active={mode === 'gallery'} onClick={() => onChange('gallery')} title="Gallery">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
      </VTBtn>
    </div>
  );
}

function VTBtn({ active, onClick, title, children }) {
  return (
    <button onClick={onClick} title={title} style={{
      padding: '4px 8px', border: 'none', borderRadius: '4px', cursor: 'pointer',
      background: active ? '#3498db' : 'transparent', color: active ? '#fff' : '#777',
      display: 'flex', alignItems: 'center',
    }}>{children}</button>
  );
}

function SortableColumnHeader({ col, width, alignment, filterValue, onFilterChange, onToggleAlignment, onDelete, onResizeStart, onSort, sortDirection, sortIndex, headerFontSize, headerColor, headerBold, headerItalic }) {
  const [hovered, setHovered] = useState(false);
  return (
    <th
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width, minWidth: width, background: '#1a1a1a', color: headerColor || '#999',
        fontWeight: headerBold !== false ? 700 : 400,
        fontStyle: headerItalic ? 'italic' : 'normal',
        borderBottom: '1px solid #333', fontSize: `${headerFontSize || 12}px`, textTransform: 'none',
        letterSpacing: '0', position: 'sticky', top: 0, textAlign: 'center',
        padding: '6px 8px', zIndex: 10, cursor: 'pointer', userSelect: 'none',
      }}
      onClick={onSort}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px' }}>
          <span style={{ color: headerColor || '#999', fontWeight: headerBold !== false ? 700 : 400 }}>{col.name}</span>
          {sortDirection && (
            <span style={{ fontSize: '9px', color: '#3498db', fontWeight: 700 }}>
              {sortDirection === 'asc' ? '▲' : '▼'}
              {sortIndex != null && sortIndex > 0 && <sup style={{ fontSize: '7px', marginLeft: '1px' }}>{sortIndex}</sup>}
            </span>
          )}
          {col.deletable && hovered && (
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete column"
              style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', fontSize: '12px', padding: '0 2px', lineHeight: 1 }}>×</button>
          )}
        </div>
        {col.filterable && (
          <input type="text" placeholder="Filter..."
            title={(col.id === 'confidence' || col.id === 'ocr_confidence') ? 'Use >0.5, >=0.8, <0.9' : 'Type to filter'}
            value={filterValue} onChange={(e) => onFilterChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'transparent', border: 'none', padding: '3px 4px', color: filterValue ? '#fff' : '#555', fontSize: '10px', width: '100%', textAlign: 'center', outline: 'none', boxSizing: 'border-box' }} />
        )}
      </div>
      <div onMouseDown={onResizeStart} onClick={(e) => e.stopPropagation()}
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '4px', cursor: 'col-resize', background: 'transparent', zIndex: 10 }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#3498db'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'} />
    </th>
  );
}

function Sep() { return <div style={{ width: '1px', height: '20px', background: '#444', margin: '0 2px' }} />; }

function ToolbarBtn({ children, onClick, title, active, disabled }) {
  return (
    <button
      style={{
        padding: '5px 12px', background: active ? '#3498db' : '#2a2a2a',
        border: '1px solid #444', borderRadius: '6px',
        color: disabled ? '#555' : '#fff', fontSize: '11px', fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
      }}
      onClick={disabled ? undefined : onClick} title={title}
    >{children}</button>
  );
}

function AlignIcon({ alignment }) {
  if (alignment === 'left') return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="18" y2="18" /></svg>;
  if (alignment === 'right') return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="9" y1="12" x2="21" y2="12" /><line x1="6" y1="18" x2="21" y2="18" /></svg>;
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="6" y1="12" x2="18" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></svg>;
}

const stickyHeaderStyle = (w, fs, color, bold, italic) => ({ width: w, minWidth: w, background: '#1a1a1a', color: color || '#999', fontWeight: bold !== false ? 700 : 400, fontStyle: italic ? 'italic' : 'normal', fontSize: `${fs || 12}px`, borderBottom: '1px solid #333', textAlign: 'center', padding: '8px 6px', position: 'sticky', top: 0, zIndex: 10 });
const headerLabelStyle = { textTransform: 'none', letterSpacing: '0' };
const cellStyle = (w) => ({ width: w, minWidth: w, borderBottom: '1px solid #222', textAlign: 'center', padding: '4px 6px' });
const pillBtnStyle = (bg) => ({ padding: '3px 10px', background: bg, border: '1px solid #444', borderRadius: '12px', color: '#ccc', fontSize: '10px', fontWeight: 600, cursor: 'pointer' });
