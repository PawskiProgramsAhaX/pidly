import { useState, useRef, useEffect, useMemo } from 'react';

/**
 * Middle column — contextual settings panel for the selected class.
 * Collapsible sections: Appearance, Rename, Find & Replace, Columns, Export, Shortcuts.
 */
export default function ClassSettingsPanel({
  selectedClass,
  // Appearance
  updateClassProperty,
  // Rename
  onRenameClass,
  // Columns (for gallery config)
  columns,
  // Find & Replace
  findText, setFindText,
  replaceText, setReplaceText,
  findField, setFindField,
  matchCase, setMatchCase,
  findMatches, handleReplaceAll,
  getSearchableFields,
  // Data
  classData,
  // Gallery config
  galleryConfig, setGalleryConfig,
  // Table config
  tableConfig, setTableConfig,
  // Sizing
  collapsed,
}) {
  if (collapsed) return null;

  return (
    <div
      style={{
        width: 450, flexShrink: 0,
        display: 'flex', flexDirection: 'column',
        background: '#1a1a1a', borderRight: '1px solid #333',
        overflow: 'hidden',
      }}
    >
      {selectedClass ? (
        <>
          {/* Class header */}
          <div style={{
            padding: '10px 18px',
            display: 'flex', alignItems: 'center', gap: '10px',
            background: '#1a1a1a', flexShrink: 0, height: '60px', boxSizing: 'border-box',
          }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3498db" strokeWidth="2" style={{ flexShrink: 0 }}>
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '24px', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {selectedClass.name}
              </div>
            </div>
          </div>

          {/* Scrollable sections */}
          <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#333 transparent' }}>

          {/* ─── Rename ─────────────────────────────────────── */}
          <Section title="Rename" defaultOpen>
            <RenameSection selectedClass={selectedClass} onRenameClass={onRenameClass} />
          </Section>

          {/* ─── Highlight Style ───────────────────────────────── */}
          <Section title="Highlight Style" defaultOpen>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <ColourRow label="Fill Colour" propName="fillColor" selectedClass={selectedClass} updateClassProperty={updateClassProperty} />
              <ColourRow label="Line Colour" propName="borderColor" selectedClass={selectedClass} updateClassProperty={updateClassProperty} />
            </div>
          </Section>

          {/* ─── Table Display ──────────────────────────────── */}
          <Section title="Table Display" defaultOpen>
            <TableDisplaySection tableConfig={tableConfig} setTableConfig={setTableConfig} />
          </Section>

          {/* ─── Find & Replace ──────────────────────────────── */}
          <Section title="Find & Replace">
            <FindReplaceSection
              findText={findText} setFindText={setFindText}
              replaceText={replaceText} setReplaceText={setReplaceText}
              findField={findField} setFindField={setFindField}
              matchCase={matchCase} setMatchCase={setMatchCase}
              findMatches={findMatches} handleReplaceAll={handleReplaceAll}
              getSearchableFields={getSearchableFields}
            />
          </Section>

          {/* ─── Gallery Display ──────────────────────────────── */}
          <Section title="Gallery Display">
            <GalleryConfigSection
              columns={columns}
              galleryConfig={galleryConfig}
              setGalleryConfig={setGalleryConfig}
            />
          </Section>

          {/* ─── Statistics ────────────────────────────────────── */}
          <Section title="Statistics">
            <StatsSection classData={classData} selectedClass={selectedClass} />
          </Section>

        </div>
        </>
      ) : (
        /* Empty state */
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: '24px',
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="1.5" style={{ marginBottom: '14px' }}>
            <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#555', marginBottom: '4px' }}>Class Settings</div>
          <div style={{ fontSize: '12px', color: '#444', textAlign: 'center' }}>Select a class to configure</div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   COLLAPSIBLE SECTION
   ═══════════════════════════════════════════════════════════════════════ */

function Section({ title, icon, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
          padding: '12px 18px', background: 'transparent', border: 'none',
          cursor: 'pointer', color: '#ccc', textAlign: 'left',
          transition: 'background 0.1s', outline: 'none',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#1e1e1e'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        {icon && <span style={{ fontSize: '13px', width: '18px', textAlign: 'center', flexShrink: 0 }}>{icon}</span>}
        <span style={{ flex: 1, fontSize: '13px', fontWeight: 700, color: '#e0e0e0' }}>{title}</span>
        <span style={{
          fontSize: '10px', color: '#666', transition: 'transform 0.2s',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
        }}>▶</span>
      </button>
      {open && (
        <div style={{ padding: '0 18px 14px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   COLOUR ROW — integrated swatch + hex + none toggle
   ═══════════════════════════════════════════════════════════════════════ */

function ColourRow({ label, propName, selectedClass, updateClassProperty }) {
  const currentValue = (() => {
    if (selectedClass[propName] && selectedClass[propName] !== 'none') return selectedClass[propName];
    if (selectedClass.color && selectedClass.color !== 'none') return selectedClass.color;
    return '#3498db';
  })();
  const isNone = propName === 'fillColor'
    ? (selectedClass.fillColor === 'none' || (selectedClass.color === 'none' && !selectedClass.fillColor))
    : selectedClass[propName] === 'none';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', height: '28px' }}>
      <span style={{ fontSize: '12px', fontWeight: 600, color: '#888', width: '80px', flexShrink: 0 }}>{label}</span>

      <div style={{ position: 'relative', width: '28px', height: '28px', flexShrink: 0 }}>
        <div style={{
          width: '28px', height: '28px', borderRadius: '4px',
          background: isNone ? 'repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50%/8px 8px' : currentValue,
          border: '1px solid #444',
        }} />
        <input
          type="color" value={isNone ? '#ff0000' : currentValue}
          onChange={(e) => updateClassProperty(propName, e.target.value)}
          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
        />
      </div>

      <span style={{ fontSize: '11px', fontFamily: 'monospace', color: isNone ? '#555' : '#888' }}>
        {isNone ? '—' : currentValue}
      </span>

      <button
        onClick={() => updateClassProperty(propName, isNone ? currentValue : 'none')}
        style={{
          padding: '4px 10px', border: '1px solid #333', borderRadius: '4px',
          cursor: 'pointer', fontSize: '11px', fontWeight: 600,
          background: 'transparent', color: '#888',
          transition: 'all 0.12s',
        }}
      >
        {isNone ? 'None' : 'Clear'}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   RENAME SECTION
   ═══════════════════════════════════════════════════════════════════════ */

function RenameSection({ selectedClass, onRenameClass }) {
  const [name, setName] = useState(selectedClass?.name || '');
  const [saved, setSaved] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    setName(selectedClass?.name || '');
    setSaved(false);
  }, [selectedClass?.name]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== selectedClass.name) {
      onRenameClass?.(selectedClass.name, trimmed);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setName(selectedClass.name); }}
        style={{
          flex: 1, padding: '6px 0', background: 'transparent', border: 'none',
          borderBottom: '1px solid #333', color: '#fff', fontSize: '13px', fontWeight: 600,
          outline: 'none', transition: 'border-color 0.15s',
        }}
        onFocus={(e) => e.currentTarget.style.borderBottomColor = '#3498db'}
        onBlur={(e) => e.currentTarget.style.borderBottomColor = '#333'}
      />
      <button
        onClick={handleSave}
        disabled={!name.trim() || name.trim() === selectedClass.name}
        style={{
          padding: '4px 12px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
          cursor: name.trim() && name.trim() !== selectedClass.name ? 'pointer' : 'default',
          border: '1px solid #333', transition: 'all 0.15s',
          background: 'transparent',
          color: saved ? '#27ae60' : (name.trim() && name.trim() !== selectedClass.name ? '#3498db' : '#555'),
        }}
      >
        {saved ? '✓' : 'Save'}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   FIND & REPLACE SECTION
   ═══════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════
   TABLE DISPLAY — font size and color controls
   ═══════════════════════════════════════════════════════════════════════ */
function TableDisplaySection({ tableConfig, setTableConfig }) {
  const cfg = tableConfig || {};
  const fontSize = cfg.fontSize || 13;
  const headerFontSize = cfg.headerFontSize || 12;
  const fontColor = cfg.fontColor || '#ccc';
  const fontBold = cfg.fontBold || false;
  const fontItalic = cfg.fontItalic || false;
  const headerColor = cfg.headerColor || '#999';
  const headerBold = cfg.headerBold !== false;
  const headerItalic = cfg.headerItalic || false;

  const update = (key, val) => setTableConfig?.(prev => ({ ...prev, [key]: val }));

  const sizes = [9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24];
  const labelW = 55;
  const selectStyle = {
    padding: '4px 8px', background: '#1a1a1a', border: '1px solid #333', borderRadius: '4px',
    color: '#ccc', fontSize: '11px', cursor: 'pointer', outline: 'none',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Data row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#888', width: `${labelW}px`, flexShrink: 0 }}>Data</span>
        <select value={fontSize} onChange={(e) => update('fontSize', parseInt(e.target.value))} style={selectStyle}>
          {sizes.map(s => <option key={s} value={s}>{s}px</option>)}
        </select>
        <button onClick={() => update('fontBold', !fontBold)} style={{
          padding: '3px 8px', border: 'none', borderRadius: '3px', cursor: 'pointer',
          fontSize: '11px', fontWeight: 700, background: 'transparent', color: fontBold ? '#3498db' : '#444',
        }}>B</button>
        <button onClick={() => update('fontItalic', !fontItalic)} style={{
          padding: '3px 8px', border: 'none', borderRadius: '3px', cursor: 'pointer',
          fontSize: '11px', fontWeight: 600, fontStyle: 'italic', background: 'transparent', color: fontItalic ? '#3498db' : '#444',
        }}>I</button>
        <div style={{ position: 'relative', width: '22px', height: '22px', flexShrink: 0 }}>
          <div style={{ width: '22px', height: '22px', borderRadius: '3px', background: fontColor, border: '1px solid #444' }} />
          <input type="color" value={fontColor} onChange={(e) => update('fontColor', e.target.value)}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
        </div>
      </div>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#888', width: `${labelW}px`, flexShrink: 0 }}>Headers</span>
        <select value={headerFontSize} onChange={(e) => update('headerFontSize', parseInt(e.target.value))} style={selectStyle}>
          {sizes.map(s => <option key={s} value={s}>{s}px</option>)}
        </select>
        <button onClick={() => update('headerBold', !headerBold)} style={{
          padding: '3px 8px', border: 'none', borderRadius: '3px', cursor: 'pointer',
          fontSize: '11px', fontWeight: 700, background: 'transparent', color: headerBold ? '#3498db' : '#444',
        }}>B</button>
        <button onClick={() => update('headerItalic', !headerItalic)} style={{
          padding: '3px 8px', border: 'none', borderRadius: '3px', cursor: 'pointer',
          fontSize: '11px', fontWeight: 600, fontStyle: 'italic', background: 'transparent', color: headerItalic ? '#3498db' : '#444',
        }}>I</button>
        <div style={{ position: 'relative', width: '22px', height: '22px', flexShrink: 0 }}>
          <div style={{ width: '22px', height: '22px', borderRadius: '3px', background: headerColor, border: '1px solid #444' }} />
          <input type="color" value={headerColor} onChange={(e) => update('headerColor', e.target.value)}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
        </div>
      </div>
    </div>
  );
}

function FindReplaceSection({ findText, setFindText, replaceText, setReplaceText, findField, setFindField, matchCase, setMatchCase, findMatches, handleReplaceAll, getSearchableFields }) {
  const fields = getSearchableFields?.() || [];
  const hasMatches = findText && findMatches?.length > 0;

  const inputStyle = {
    width: '100%', padding: '6px 0', background: 'transparent', border: 'none',
    borderBottom: '1px solid #333', color: '#fff', fontSize: '12px', outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Find row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#888', width: '50px', flexShrink: 0 }}>Find</span>
        <div style={{ flex: 1, position: 'relative' }}>
          <input type="text" value={findText} onChange={(e) => setFindText(e.target.value)}
            placeholder="..." style={inputStyle} />
          {findText && (
            <span style={{
              position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
              fontSize: '10px', fontWeight: 700, color: hasMatches ? '#3498db' : '#555',
            }}>
              {findMatches?.length || 0}
            </span>
          )}
        </div>
      </div>

      {/* In field + match case */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#888', width: '50px', flexShrink: 0 }}>In</span>
        <select value={findField} onChange={(e) => setFindField(e.target.value)}
          style={{ flex: 1, padding: '5px 0', background: '#1a1a1a', border: 'none', borderBottom: '1px solid #333', color: '#ccc', fontSize: '12px', outline: 'none' }}>
          {fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <button
          onClick={() => setMatchCase(!matchCase)}
          title="Match case"
          style={{
            padding: '3px 8px', borderRadius: '3px', fontSize: '11px', fontWeight: 700,
            cursor: 'pointer', border: 'none',
            background: 'transparent', color: matchCase ? '#3498db' : '#555',
          }}
        >Aa</button>
      </div>

      {/* Replace row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#888', width: '50px', flexShrink: 0 }}>Replace</span>
        <input type="text" value={replaceText} onChange={(e) => setReplaceText(e.target.value)}
          placeholder="..." style={{ ...inputStyle, flex: 1 }} />
      </div>

      {/* Replace button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2px' }}>
        <button
          onClick={handleReplaceAll}
          disabled={!findText || !findMatches?.length || findField === 'filename'}
          style={{
            padding: '5px 14px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
            border: '1px solid #333', cursor: hasMatches ? 'pointer' : 'default',
            background: 'transparent',
            color: hasMatches ? '#3498db' : '#555',
            transition: 'all 0.15s',
          }}
        >
          Replace All{hasMatches ? ` (${findMatches.length})` : ''}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   GALLERY CONFIG SECTION
   ═══════════════════════════════════════════════════════════════════════ */

function GalleryConfigSection({ columns, galleryConfig, setGalleryConfig }) {
  const cfg = galleryConfig || {};
  const visibleCols = cfg.visibleColumns || {};
  const textSize = cfg.textSize || 'small';
  const cardHeight = cfg.cardHeight || 100;
  const showLabels = cfg.showLabels !== false;

  const update = (key, val) => setGalleryConfig?.(prev => ({ ...prev, [key]: val }));

  const tagColumns = (columns || []).filter(c => c.id !== 'filename' && c.id !== 'confidence' && c.id !== 'ocr_confidence' && c.id !== 'page_num');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Text size */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#888', width: '80px', flexShrink: 0 }}>Text Size</span>
        <div style={{ display: 'flex', gap: '12px' }}>
          {['small', 'medium', 'large'].map(size => (
            <button
              key={size}
              onClick={() => update('textSize', size)}
              style={{
                padding: 0, border: 'none', cursor: 'pointer',
                background: 'transparent', textTransform: 'capitalize',
                fontSize: '12px', fontWeight: 600,
                color: textSize === size ? '#3498db' : '#555',
                transition: 'color 0.12s',
              }}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      {/* Thumbnail height */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#888', width: '80px', flexShrink: 0 }}>Height</span>
        <input
          type="range" min="60" max="200" step="10"
          value={cardHeight}
          onChange={(e) => update('cardHeight', parseInt(e.target.value))}
          style={{ flex: 1, accentColor: '#3498db' }}
        />
        <span style={{ fontSize: '11px', color: '#555', width: '32px', textAlign: 'right' }}>{cardHeight}</span>
      </div>

      {/* Show labels toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#888', width: '80px', flexShrink: 0 }}>Labels</span>
        <button
          onClick={() => update('showLabels', !showLabels)}
          style={{
            padding: 0, border: 'none', cursor: 'pointer',
            background: 'transparent', fontSize: '12px', fontWeight: 600,
            color: showLabels ? '#3498db' : '#555',
          }}
        >
          {showLabels ? 'On' : 'Off'}
        </button>
      </div>

      {/* Card Fields - compact pill toggles */}
      <div>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '8px' }}>Card Fields</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {tagColumns.map(col => {
            const isVis = visibleCols[col.id] !== false;
            return (
              <button
                key={col.id}
                onClick={() => update('visibleColumns', { ...visibleCols, [col.id]: !isVis })}
                style={{
                  padding: '4px 10px', borderRadius: '12px', cursor: 'pointer',
                  fontSize: '11px', fontWeight: 600, transition: 'all 0.12s',
                  border: 'none',
                  background: isVis ? '#1a2a3a' : 'transparent',
                  color: isVis ? '#3498db' : '#555',
                }}
              >
                {col.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Show on Card - compact toggles */}
      <div>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#888', display: 'block', marginBottom: '8px' }}>Show on Card</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {[
            { key: 'showFilename', label: 'Document', def: true },
            { key: 'showPage', label: 'Page', def: true },
            { key: 'showConfidence', label: 'Confidence', def: false },
          ].map(({ key, label, def }) => {
            const isOn = cfg[key] !== undefined ? cfg[key] : def;
            return (
              <button
                key={key}
                onClick={() => update(key, !isOn)}
                style={{
                  padding: '4px 10px', borderRadius: '12px', cursor: 'pointer',
                  fontSize: '11px', fontWeight: 600, transition: 'all 0.12s',
                  border: 'none',
                  background: isOn ? '#1a2a3a' : 'transparent',
                  color: isOn ? '#3498db' : '#555',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   STATISTICS SECTION
   ═══════════════════════════════════════════════════════════════════════ */

function StatsSection({ classData, selectedClass }) {
  const stats = useMemo(() => {
    if (!classData || classData.length === 0) return null;

    const byFile = {};
    for (let i = 0; i < classData.length; i++) {
      const f = (classData[i].filename || 'Unknown').replace('.pdf', '');
      byFile[f] = (byFile[f] || 0) + 1;
    }
    const fileEntries = Object.entries(byFile).sort((a, b) => b[1] - a[1]);

    const confidences = [];
    for (let i = 0; i < classData.length; i++) {
      if (classData[i].confidence != null) confidences.push(classData[i].confidence);
    }
    const confBuckets = [0, 0, 0, 0, 0];
    for (let i = 0; i < confidences.length; i++) {
      confBuckets[Math.min(4, Math.floor(confidences[i] * 5))]++;
    }
    const confMax = Math.max(...confBuckets, 1);
    const avgConf = confidences.length > 0 ? confidences.reduce((s, c) => s + c, 0) / confidences.length : null;

    return { fileEntries, confBuckets, confMax, avgConf, total: classData.length, fileCount: fileEntries.length };
  }, [classData]);

  if (!stats) return <div style={{ fontSize: '12px', color: '#555' }}>No data</div>;

  const confLabels = ['0–20', '20–40', '40–60', '60–80', '80–100'];
  const confColors = ['#e74c3c', '#e67e22', '#f39c12', '#27ae60', '#2ecc71'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Summary — inline stats */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }}>{stats.total}</span>
        <span style={{ fontSize: '11px', color: '#666', fontWeight: 600 }}>objects across</span>
        <span style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }}>{stats.fileCount}</span>
        <span style={{ fontSize: '11px', color: '#666', fontWeight: 600 }}>files</span>
        {stats.avgConf != null && (
          <>
            <span style={{ fontSize: '11px', color: '#333', margin: '0 2px' }}>·</span>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#888' }}>{(stats.avgConf * 100).toFixed(0)}%</span>
            <span style={{ fontSize: '11px', color: '#666', fontWeight: 600 }}>avg conf</span>
          </>
        )}
      </div>

      {/* Confidence — single-row stacked bar */}
      {stats.confBuckets.some(b => b > 0) && (
        <div>
          <div style={{ display: 'flex', height: '6px', borderRadius: '3px', overflow: 'hidden', gap: '1px' }}>
            {confLabels.map((label, i) => {
              const pct = stats.total > 0 ? (stats.confBuckets[i] / stats.total) * 100 : 0;
              if (pct === 0) return null;
              return (
                <div key={label} title={`${label}%: ${stats.confBuckets[i]}`} style={{
                  width: `${pct}%`, background: confColors[i], minWidth: pct > 0 ? '2px' : 0,
                  transition: 'width 0.3s',
                }} />
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
            {confLabels.map((label, i) => {
              const count = stats.confBuckets[i];
              if (count === 0) return <span key={label} />;
              return (
                <span key={label} style={{ fontSize: '9px', color: '#555', fontWeight: 600 }}>
                  <span style={{ color: confColors[i] }}>●</span> {label}% <span style={{ color: '#777' }}>({count})</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-file — compact list */}
      {stats.fileEntries.length > 0 && (
        <div style={{ maxHeight: '140px', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#333 transparent' }}>
          {stats.fileEntries.map(([file, count]) => (
            <div key={file} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' }}>
              <div style={{ flex: 1, height: '4px', background: '#1e1e1e', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', background: '#3498db', borderRadius: '2px',
                  width: `${(count / stats.fileEntries[0][1]) * 100}%`,
                  minWidth: '3px', opacity: 0.7,
                }} />
              </div>
              <span style={{ fontSize: '10px', color: '#666', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{file}</span>
              <span style={{ fontSize: '10px', color: '#888', fontWeight: 700, minWidth: '18px', textAlign: 'right' }}>{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
