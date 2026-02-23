/**
 * InfiniteMarkupToolbar.jsx
 * 
 * Floating markup toolbar for InfiniteView.
 * Tool options match PDFViewerArea's ToolOptionsBar exactly:
 * - Slider/compact toggle (penHighlighterUIMode) for all numeric inputs
 * - Manual text input alongside sliders
 * - "Line:" | "Fill:" section separators for shapes
 * - Animated "☆ Default" button on all tools
 * - Note color swatches, text border/padding/vertical-align controls
 */
import React from 'react';

// Helper to update a single property on the selected annotation in both state stores
function useAnnotationUpdater(selectedAnnotation, setSlotAnnotations, setSelectedAnnotation) {
  return (prop, value) => {
    if (!selectedAnnotation) return;
    setSlotAnnotations(prev => ({
      ...prev,
      [selectedAnnotation.slotId]: (prev[selectedAnnotation.slotId] || []).map(a =>
        a.id === selectedAnnotation.id ? { ...a, [prop]: value } : a
      )
    }));
    setSelectedAnnotation(prev => prev ? { ...prev, [prop]: value } : null);
  };
}

// Animated default button
function DefaultButton({ onClick }) {
  return (
    <button
      className="set-default-btn"
      onClick={(e) => {
        onClick();
        const btn = e.target;
        btn.textContent = '\u2713';
        btn.style.background = '#27ae60';
        setTimeout(() => { btn.textContent = '\u2606 Default'; btn.style.background = ''; }, 1500);
      }}
      title="Save current settings as default"
    >&#9734; Default</button>
  );
}

// UI mode toggle button
function UIModeToggle({ penHighlighterUIMode, setPenHighlighterUIMode }) {
  return (
    <button
      className="ui-mode-toggle"
      onClick={() => {
        const newMode = penHighlighterUIMode === 'slider' ? 'compact' : 'slider';
        setPenHighlighterUIMode(newMode);
        localStorage.setItem('penHighlighterUIMode', newMode);
      }}
      title={penHighlighterUIMode === 'slider' ? 'Switch to compact dropdown' : 'Switch to slider'}
      style={{ padding: '2px 5px', fontSize: '10px', background: '#444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', marginLeft: '2px' }}
    >{penHighlighterUIMode === 'slider' ? '\u25BC' : '\u2261'}</button>
  );
}

// Reusable slider/compact size input
function SizeInput({ value, onChange, min, max, sizes, keyPrefix, uiMode }) {
  if (uiMode === 'slider') {
    return (
      <>
        <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(parseInt(e.target.value))} style={{ width: '80px' }} />
        <input type="text" className="manual-input" defaultValue={value} key={`${keyPrefix}-${value}`} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} onBlur={(e) => { let n = parseInt(e.target.value); if (isNaN(n)) n = min; n = Math.max(min, Math.min(max, n)); onChange(n); }} />
        <span>px</span>
      </>
    );
  }
  // Ensure current value is in the dropdown options
  const allSizes = sizes.includes(value) ? sizes : [...sizes, value].sort((a, b) => a - b);
  return (
    <select value={value} onChange={(e) => onChange(parseInt(e.target.value))} style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}>
      {allSizes.map(s => <option key={s} value={s}>{s}px</option>)}
    </select>
  );
}

// Reusable slider/compact opacity input (value 0-1, display as %)
function OpacityInput({ value, onChange, min, max, keyPrefix, uiMode, disabled, dimmed }) {
  const pct = Math.round(value * 100);
  const minPct = Math.round(min * 100);
  const maxPct = Math.round(max * 100);
  const style = dimmed ? { opacity: 0.5 } : {};
  if (uiMode === 'slider') {
    return (
      <>
        <input type="range" min={min} max={max} step="0.1" value={value} onChange={(e) => onChange(parseFloat(e.target.value))} disabled={disabled} style={{ width: '80px', ...style }} />
        <input type="text" className="manual-input" defaultValue={pct} key={`${keyPrefix}-${pct}`} disabled={disabled} style={style} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} onBlur={(e) => { let n = parseInt(e.target.value); if (isNaN(n)) n = minPct; n = Math.max(minPct, Math.min(maxPct, n)); onChange(n / 100); }} />
        <span>%</span>
      </>
    );
  }
  return (
    <>
      <input type="number" min={minPct} max={maxPct} step="10" value={pct} disabled={disabled} onChange={(e) => { const n = parseInt(e.target.value); if (!isNaN(n)) onChange(Math.max(min, Math.min(max, n / 100))); }} style={{ width: '55px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px', ...style }} />
      <span>%</span>
    </>
  );
}

// Line style dropdown (5 options matching PDFViewer)
function LineStyleSelect({ value, onChange, disabled }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} style={{ padding: '2px 4px', fontSize: '12px' }}>
      <option value="solid">{'\u2501\u2501\u2501'} Solid</option>
      <option value="dashed">{'\u2505\u2505\u2505'} Dashed</option>
      <option value="dotted">{'\u2508\u2508\u2508'} Dotted</option>
      <option value="dashdot">{'\u2501\u2505\u2501'} Dash-Dot</option>
      <option value="longdash">{'\u2501 \u2501'} Long Dash</option>
    </select>
  );
}

export default function InfiniteMarkupToolbar({
  showMarkupsToolbar,
  markupMode, setMarkupMode, unlockedSlots,
  markupColor, setMarkupColor,
  markupStrokeWidth, setMarkupStrokeWidth,
  markupOpacity, setMarkupOpacity,
  markupFillColor, setMarkupFillColor,
  markupFillOpacity, setMarkupFillOpacity,
  markupStrokeOpacity, setMarkupStrokeOpacity,
  markupArrowHeadSize, setMarkupArrowHeadSize,
  markupLineStyle, setMarkupLineStyle,
  markupFontSize, setMarkupFontSize,
  markupFontFamily, setMarkupFontFamily,
  markupTextAlign, setMarkupTextAlign,
  markupVerticalAlign, setMarkupVerticalAlign,
  markupTextPadding, setMarkupTextPadding,
  markupBorderColor, setMarkupBorderColor,
  markupBorderWidth, setMarkupBorderWidth,
  markupBorderStyle, setMarkupBorderStyle,
  markupBorderOpacity, setMarkupBorderOpacity,
  markupCloudArcSize, setMarkupCloudArcSize,
  markupCloudIntensity, setMarkupCloudIntensity,
  markupCloudInverted, setMarkupCloudInverted,
  penHighlighterUIMode, setPenHighlighterUIMode,
  selectedAnnotation, setSelectedAnnotation, setSlotAnnotations,
  annotationHistory, annotationFuture, undoAnnotation, redoAnnotation,
  showSymbolsPanel, setShowSymbolsPanel, setShowObjectSearch, setShowViewOptions,
  showMarkupHistoryPanel, setShowMarkupHistoryPanel, setShowViewsPanel,
  saveToolDefaults,
}) {
  if (!showMarkupsToolbar) return null;

  const updateAnnotation = useAnnotationUpdater(selectedAnnotation, setSlotAnnotations, setSelectedAnnotation);
  const disabled = unlockedSlots.size === 0;
  const toolTitle = (name, shortcut) => disabled ? "Unlock a drawing first" : `${name} (${shortcut})`;
  const ui = penHighlighterUIMode;

  const renderToolBtn = (mode, title, svgContent) => (
    <button key={mode} className={`markup-tb-btn ${markupMode === mode ? 'active' : ''}`}
      onClick={() => { if (!disabled) setMarkupMode(markupMode === mode ? null : mode); }}
      title={title} disabled={disabled}
    >{svgContent}</button>
  );

  return (
    <div className="infinite-markup-toolbar">
      <div className="markup-toolbar-tools" style={{ opacity: disabled ? 0.5 : 1 }}>
        {renderToolBtn('pen', toolTitle('Pen', 'P'),
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.5L14.5 4.5L5 14H2V11L11.5 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M9 4L12 7" stroke="currentColor" strokeWidth="1.5"/></svg>
        )}
        {renderToolBtn('highlighter', toolTitle('Highlighter', 'H'),
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="4" y="2" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.5"/><path d="M6 12V14H10V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><line x1="6" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        )}
        {renderToolBtn('arrow', toolTitle('Arrow', 'A'),
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><line x1="2" y1="14" x2="12" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M12 4L12 9M12 4L7 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        )}
        {renderToolBtn('line', toolTitle('Line', 'L'),
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><line x1="2" y1="14" x2="14" y2="2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        )}
        {renderToolBtn('rectangle', toolTitle('Rectangle', 'R'),
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.5"/></svg>
        )}
        {renderToolBtn('circle', toolTitle('Ellipse', 'E'),
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><ellipse cx="8" cy="8" rx="6" ry="5" stroke="currentColor" strokeWidth="1.5"/></svg>
        )}
        {renderToolBtn('arc', toolTitle('Arc', 'Shift+R'),
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M3 12C3 12 5 4 13 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/></svg>
        )}
        {renderToolBtn('cloud', toolTitle('Cloud', 'C'),
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M4 11C2.5 11 2 9.5 3 8.5C2 7.5 3 6 4.5 6C4.5 4 6 3 8 3C10 3 11.5 4 11.5 6C13 6 14 7.5 13 8.5C14 9.5 13.5 11 12 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 11C5 12 7 12 8 12C9 12 11 12 12 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        )}
        {renderToolBtn('polyline', toolTitle('Polyline', 'Shift+L'),
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><polyline points="2,12 5,5 9,10 14,3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
        )}
        {renderToolBtn('polylineArrow', toolTitle('Polyline Arrow', 'Shift+A'),
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><polyline points="2,12 5,5 9,10 13,4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/><path d="M13 4L13 7.5M13 4L9.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        )}
        {renderToolBtn('cloudPolyline', toolTitle('Cloud Polyline', 'Shift+C'),
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M2 12 Q3.5 10 5 12 Q6.5 14 8 12 Q9.5 10 11 12 Q12.5 14 14 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/><path d="M2 7 Q3.5 5 5 7 Q6.5 9 8 7 Q9.5 5 11 7 Q12.5 9 14 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/></svg>
        )}

        <span className="markup-tb-divider"></span>

        {renderToolBtn('text', toolTitle('Text Box', 'T'),
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><text x="4" y="12" fill="currentColor" fontSize="12" fontWeight="bold" fontFamily="Arial">T</text></svg>
        )}
        {renderToolBtn('callout', disabled ? "Unlock a drawing first" : "Callout",
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M2 3H14V10H6L3 13V10H2V3Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        )}
        {renderToolBtn('note', disabled ? "Unlock a drawing first" : "Sticky Note",
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.5"/><path d="M10 2V6H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><line x1="4" y1="7" x2="8" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><line x1="4" y1="10" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        )}

        <span className="markup-tb-divider"></span>

        {renderToolBtn('eraser', disabled ? "Unlock a drawing first" : "Eraser",
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M6 14H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M2 10L6 14L14 6L10 2L2 10Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 6L10 10" stroke="currentColor" strokeWidth="1.5"/></svg>
        )}

        <span className="markup-tb-divider"></span>

        <button className={`markup-tb-btn ${annotationHistory.length === 0 ? 'disabled' : ''}`}
          onClick={undoAnnotation} title="Undo (Ctrl+Z)" disabled={annotationHistory.length === 0}
          style={{ opacity: annotationHistory.length === 0 ? 0.4 : 1 }}
        ><svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M4 6H11C12.5 6 14 7.5 14 9C14 10.5 12.5 12 11 12H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 3L3 6L6 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
        <button className={`markup-tb-btn ${annotationFuture.length === 0 ? 'disabled' : ''}`}
          onClick={redoAnnotation} title="Redo (Ctrl+Y)" disabled={annotationFuture.length === 0}
          style={{ opacity: annotationFuture.length === 0 ? 0.4 : 1 }}
        ><svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M12 6H5C3.5 6 2 7.5 2 9C2 10.5 3.5 12 5 12H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M10 3L13 6L10 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></button>

        <span className="markup-tb-divider"></span>

        <button className={`markup-tb-btn ${showSymbolsPanel ? 'active' : ''}`}
          onClick={() => { if (disabled) return; const next = !showSymbolsPanel; setShowSymbolsPanel(next); if (next) { setShowObjectSearch(false); setShowViewOptions(false); setShowMarkupHistoryPanel(false); if (setShowViewsPanel) setShowViewsPanel(false); } }}
          title={disabled ? "Unlock a drawing first" : "Symbols Library"} disabled={disabled}
        ><svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3"/><rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3"/><rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3"/><rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3"/></svg></button>

        <button className={`markup-tb-btn ${showMarkupHistoryPanel ? 'active' : ''}`}
          onClick={() => { if (disabled) return; const next = !showMarkupHistoryPanel; setShowMarkupHistoryPanel(next); if (next) { setShowSymbolsPanel(false); setShowObjectSearch(false); setShowViewOptions(false); if (setShowViewsPanel) setShowViewsPanel(false); } }}
          title={disabled ? "Unlock a drawing first" : "Markup History"} disabled={disabled}
        ><svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="9" r="6" stroke="currentColor" strokeWidth="1.5"/><path d="M8 5.5V9L10.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 4V1H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
      </div>

      {/* ═══ Tool Options Row ═══ */}
      {(markupMode || selectedAnnotation) && (
        <div className="tool-options-row">
          {/* ── Selected Annotation Options ── */}
          {!markupMode && selectedAnnotation && (
            <>
              {/* Pen selected */}
              {selectedAnnotation.type === 'pen' && (
                <>
                  <div className="tool-option"><label>Color:</label><input type="color" value={selectedAnnotation.color || '#ff0000'} onChange={(e) => updateAnnotation('color', e.target.value)} /></div>
                  <div className="tool-option"><label>Size:</label>
                    <SizeInput value={selectedAnnotation.strokeWidth || 3} onChange={(v) => updateAnnotation('strokeWidth', v)} min={1} max={150} sizes={[1,2,3,4,5,6,8,10,12,14,16,18,20,24,28,32,36,42,48,56,64,72,84,96,110,128,150]} keyPrefix={`sel-pen-${selectedAnnotation.id}`} uiMode={ui} />
                    <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
                  </div>
                  <DefaultButton onClick={() => localStorage.setItem('markup_pen_defaults', JSON.stringify({ color: selectedAnnotation.color, strokeWidth: selectedAnnotation.strokeWidth }))} />
                </>
              )}
              {/* Highlighter selected */}
              {selectedAnnotation.type === 'highlighter' && (
                <>
                  <div className="tool-option"><label>Color:</label><input type="color" value={selectedAnnotation.color || '#ffff00'} onChange={(e) => updateAnnotation('color', e.target.value)} /></div>
                  <div className="tool-option"><label>Size:</label>
                    {ui === 'slider' ? (
                      <>
                        <input type="range" min="5" max="150" value={selectedAnnotation.strokeWidth || 12} onChange={(e) => updateAnnotation('strokeWidth', parseInt(e.target.value))} style={{ width: '120px' }} />
                        <input type="text" className="manual-input" defaultValue={selectedAnnotation.strokeWidth || 12} key={`sel-hl-size-${selectedAnnotation.id}-${selectedAnnotation.strokeWidth}`} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} onBlur={(e) => { const n = parseInt(e.target.value); if (isNaN(n) || n < 5) updateAnnotation('strokeWidth', 5); else if (n > 150) updateAnnotation('strokeWidth', 150); else updateAnnotation('strokeWidth', n); }} />
                        <span>px</span>
                      </>
                    ) : (
                      <select value={selectedAnnotation.strokeWidth || 12} onChange={(e) => updateAnnotation('strokeWidth', parseInt(e.target.value))} style={{ padding: '2px 4px', fontSize: '12px', minWidth: '70px' }}>
                        {[6,9,12,15,18,21,24,30,36,42,48,54,60,66,72,84,96,110,128,150].map(s => <option key={s} value={s}>{s}px</option>)}
                      </select>
                    )}
                  </div>
                  <div className="tool-option"><label>Opacity:</label>
                    <OpacityInput value={selectedAnnotation.opacity || 0.4} onChange={(v) => updateAnnotation('opacity', v)} min={0.1} max={0.8} keyPrefix={`sel-hl-op-${selectedAnnotation.id}`} uiMode={ui} />
                    <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
                  </div>
                  <DefaultButton onClick={() => localStorage.setItem('markup_highlighter_defaults', JSON.stringify({ color: selectedAnnotation.color, strokeWidth: selectedAnnotation.strokeWidth, opacity: selectedAnnotation.opacity }))} />
                </>
              )}
              {/* Arrow selected */}
              {selectedAnnotation.type === 'arrow' && (
                <>
                  <div className="tool-option"><label>Color:</label><input type="color" value={selectedAnnotation.color || '#ff0000'} onChange={(e) => updateAnnotation('color', e.target.value)} /></div>
                  <div className="tool-option"><label>Size:</label><SizeInput value={selectedAnnotation.strokeWidth || 2} onChange={(v) => updateAnnotation('strokeWidth', v)} min={1} max={8} sizes={[1,2,3,4,5,6,7,8]} keyPrefix={`sel-arr-${selectedAnnotation.id}`} uiMode={ui} /></div>
                  <div className="tool-option"><label>Style:</label><LineStyleSelect value={selectedAnnotation.lineStyle || 'solid'} onChange={(v) => updateAnnotation('lineStyle', v)} /></div>
                  <div className="tool-option"><label>Head:</label><SizeInput value={selectedAnnotation.arrowHeadSize || 12} onChange={(v) => updateAnnotation('arrowHeadSize', v)} min={6} max={30} sizes={[6,8,10,12,14,16,18,20,24,28,30]} keyPrefix={`sel-arrh-${selectedAnnotation.id}`} uiMode={ui} />
                    <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
                  </div>
                </>
              )}
              {/* Line selected */}
              {selectedAnnotation.type === 'line' && (
                <>
                  <div className="tool-option"><label>Color:</label><input type="color" value={selectedAnnotation.color || '#ff0000'} onChange={(e) => updateAnnotation('color', e.target.value)} /></div>
                  <div className="tool-option"><label>Size:</label><SizeInput value={selectedAnnotation.strokeWidth || 2} onChange={(v) => updateAnnotation('strokeWidth', v)} min={1} max={8} sizes={[1,2,3,4,5,6,7,8]} keyPrefix={`sel-line-${selectedAnnotation.id}`} uiMode={ui} /></div>
                  <div className="tool-option"><label>Style:</label><LineStyleSelect value={selectedAnnotation.lineStyle || 'solid'} onChange={(v) => updateAnnotation('lineStyle', v)} />
                    <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
                  </div>
                </>
              )}
              {/* Rectangle/Circle selected */}
              {(selectedAnnotation.type === 'rectangle' || selectedAnnotation.type === 'circle') && (
                <>
                  <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
                  <div className="tool-option"><label>Color:</label>
                    <button title="No line" className={`fill-toggle ${selectedAnnotation.color === 'none' ? 'active' : ''}`} onClick={() => updateAnnotation('color', selectedAnnotation.color === 'none' ? '#ff0000' : 'none')}>{'\u2205'}</button>
                    <input type="color" value={selectedAnnotation.color === 'none' ? '#ff0000' : (selectedAnnotation.color || '#ff0000')} onChange={(e) => updateAnnotation('color', e.target.value)} style={{ opacity: selectedAnnotation.color === 'none' ? 0.5 : 1 }} />
                  </div>
                  <div className="tool-option" style={{ opacity: selectedAnnotation.color === 'none' ? 0.5 : 1 }}><label>Width:</label><SizeInput value={selectedAnnotation.strokeWidth || 2} onChange={(v) => updateAnnotation('strokeWidth', v)} min={1} max={8} sizes={[1,2,3,4,5,6,7,8]} keyPrefix={`sel-shape-${selectedAnnotation.id}`} uiMode={ui} /></div>
                  <div className="tool-option" style={{ opacity: selectedAnnotation.color === 'none' ? 0.5 : 1 }}><label>{'\u03B1'}:</label><OpacityInput value={selectedAnnotation.strokeOpacity || 1} onChange={(v) => updateAnnotation('strokeOpacity', v)} min={0.1} max={1} keyPrefix={`sel-sop-${selectedAnnotation.id}`} uiMode={ui} /></div>
                  <div className="tool-option" style={{ opacity: selectedAnnotation.color === 'none' ? 0.5 : 1 }}><label>Style:</label><LineStyleSelect value={selectedAnnotation.lineStyle || 'solid'} onChange={(v) => updateAnnotation('lineStyle', v)} /></div>
                  <span style={{ color: '#666', margin: '0 4px' }}>|</span>
                  <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
                  <div className="tool-option"><label>Color:</label>
                    <button title="No fill" className={`fill-toggle ${selectedAnnotation.fillColor === 'none' ? 'active' : ''}`} onClick={() => updateAnnotation('fillColor', 'none')}>{'\u2205'}</button>
                    <input type="color" value={selectedAnnotation.fillColor === 'none' ? '#ffffff' : (selectedAnnotation.fillColor || '#ffffff')} onChange={(e) => updateAnnotation('fillColor', e.target.value)} style={{ opacity: selectedAnnotation.fillColor === 'none' ? 0.5 : 1 }} />
                  </div>
                  <div className="tool-option"><label>{'\u03B1'}:</label><OpacityInput value={selectedAnnotation.fillOpacity || 0.3} onChange={(v) => updateAnnotation('fillOpacity', v)} min={0.1} max={1} keyPrefix={`sel-fop-${selectedAnnotation.id}`} uiMode={ui} disabled={selectedAnnotation.fillColor === 'none'} dimmed={selectedAnnotation.fillColor === 'none'} />
                    <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
                  </div>
                </>
              )}
              {/* Cloud selected */}
              {selectedAnnotation.type === 'cloud' && (
                <>
                  <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
                  <div className="tool-option"><label>Color:</label><input type="color" value={selectedAnnotation.color || '#ff0000'} onChange={(e) => updateAnnotation('color', e.target.value)} /></div>
                  <div className="tool-option"><label>Width:</label><SizeInput value={selectedAnnotation.strokeWidth || 2} onChange={(v) => updateAnnotation('strokeWidth', v)} min={1} max={8} sizes={[1,2,3,4,5,6,7,8]} keyPrefix={`sel-cw-${selectedAnnotation.id}`} uiMode={ui} /></div>
                  <div className="tool-option"><label>{'\u03B1'}:</label><OpacityInput value={selectedAnnotation.strokeOpacity || 1} onChange={(v) => updateAnnotation('strokeOpacity', v)} min={0.1} max={1} keyPrefix={`sel-csop-${selectedAnnotation.id}`} uiMode={ui} /></div>
                  <div className="tool-option"><label>Arc:</label><SizeInput value={selectedAnnotation.arcSize || selectedAnnotation.cloudArcSize || 15} onChange={(v) => updateAnnotation('arcSize', v)} min={4} max={40} sizes={[4,6,8,10,12,14,16,18,20,24,28,32,36,40]} keyPrefix={`sel-ca-${selectedAnnotation.id}`} uiMode={ui} /></div>
                  <div className="tool-option"><label>Invert:</label>
                    <button className={`fill-toggle ${(selectedAnnotation.cloudInverted || selectedAnnotation.inverted) ? 'active' : ''}`} onClick={() => { updateAnnotation('cloudInverted', !(selectedAnnotation.cloudInverted || selectedAnnotation.inverted)); updateAnnotation('inverted', !(selectedAnnotation.cloudInverted || selectedAnnotation.inverted)); }} title="Flip bumps direction">{(selectedAnnotation.cloudInverted || selectedAnnotation.inverted) ? '\u2198\u2199' : '\u2197\u2196'}</button>
                  </div>
                  <span style={{ color: '#666', margin: '0 4px' }}>|</span>
                  <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
                  <div className="tool-option"><label>Color:</label>
                    <button title="No fill" className={`fill-toggle ${selectedAnnotation.fillColor === 'none' ? 'active' : ''}`} onClick={() => updateAnnotation('fillColor', 'none')}>{'\u2205'}</button>
                    <input type="color" value={selectedAnnotation.fillColor === 'none' ? '#ffffff' : (selectedAnnotation.fillColor || '#ffffff')} onChange={(e) => updateAnnotation('fillColor', e.target.value)} style={{ opacity: selectedAnnotation.fillColor === 'none' ? 0.5 : 1 }} />
                  </div>
                  <div className="tool-option"><label>{'\u03B1'}:</label><OpacityInput value={selectedAnnotation.fillOpacity || 0.3} onChange={(v) => updateAnnotation('fillOpacity', v)} min={0.1} max={1} keyPrefix={`sel-cfop-${selectedAnnotation.id}`} uiMode={ui} disabled={selectedAnnotation.fillColor === 'none'} dimmed={selectedAnnotation.fillColor === 'none'} />
                    <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
                  </div>
                </>
              )}
              {/* Polyline selected */}
              {selectedAnnotation.type === 'polyline' && (
                <>
                  <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
                  <div className="tool-option"><label>Color:</label><input type="color" value={selectedAnnotation.color || '#ff0000'} onChange={(e) => updateAnnotation('color', e.target.value)} /></div>
                  <div className="tool-option"><label>Width:</label><SizeInput value={selectedAnnotation.strokeWidth || 2} onChange={(v) => updateAnnotation('strokeWidth', v)} min={1} max={8} sizes={[1,2,3,4,5,6,7,8]} keyPrefix={`sel-pl-${selectedAnnotation.id}`} uiMode={ui} /></div>
                  <div className="tool-option"><label>{'\u03B1'}:</label><OpacityInput value={selectedAnnotation.strokeOpacity || 1} onChange={(v) => updateAnnotation('strokeOpacity', v)} min={0.1} max={1} keyPrefix={`sel-plop-${selectedAnnotation.id}`} uiMode={ui} /></div>
                  <div className="tool-option"><label>Style:</label><LineStyleSelect value={selectedAnnotation.lineStyle || 'solid'} onChange={(v) => updateAnnotation('lineStyle', v)} /></div>
                  <span style={{ color: '#666', margin: '0 4px' }}>|</span>
                  <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
                  <div className="tool-option"><label>Color:</label>
                    <button title="No fill" className={`fill-toggle ${!selectedAnnotation.fillColor || selectedAnnotation.fillColor === 'none' ? 'active' : ''}`} onClick={() => updateAnnotation('fillColor', 'none')}>{'\u2205'}</button>
                    <input type="color" value={!selectedAnnotation.fillColor || selectedAnnotation.fillColor === 'none' ? '#ffffff' : selectedAnnotation.fillColor} onChange={(e) => updateAnnotation('fillColor', e.target.value)} style={{ opacity: !selectedAnnotation.fillColor || selectedAnnotation.fillColor === 'none' ? 0.5 : 1 }} />
                  </div>
                  <div className="tool-option"><label>{'\u03B1'}:</label><OpacityInput value={selectedAnnotation.fillOpacity || 0.3} onChange={(v) => updateAnnotation('fillOpacity', v)} min={0.1} max={1} keyPrefix={`sel-plfop-${selectedAnnotation.id}`} uiMode={ui} disabled={!selectedAnnotation.fillColor || selectedAnnotation.fillColor === 'none'} dimmed={!selectedAnnotation.fillColor || selectedAnnotation.fillColor === 'none'} />
                    <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
                  </div>
                </>
              )}
              {/* Polyline Arrow selected */}
              {selectedAnnotation.type === 'polylineArrow' && (
                <>
                  <div className="tool-option"><label>Color:</label><input type="color" value={selectedAnnotation.color || '#ff0000'} onChange={(e) => updateAnnotation('color', e.target.value)} /></div>
                  <div className="tool-option"><label>Width:</label><SizeInput value={selectedAnnotation.strokeWidth || 2} onChange={(v) => updateAnnotation('strokeWidth', v)} min={1} max={8} sizes={[1,2,3,4,5,6,7,8]} keyPrefix={`sel-pa-${selectedAnnotation.id}`} uiMode={ui} /></div>
                  <div className="tool-option"><label>Head:</label><SizeInput value={selectedAnnotation.arrowHeadSize || 12} onChange={(v) => updateAnnotation('arrowHeadSize', v)} min={6} max={30} sizes={[6,8,10,12,14,16,18,20,24,28,30]} keyPrefix={`sel-pah-${selectedAnnotation.id}`} uiMode={ui} /></div>
                  <div className="tool-option"><label>Style:</label><LineStyleSelect value={selectedAnnotation.lineStyle || 'solid'} onChange={(v) => updateAnnotation('lineStyle', v)} />
                    <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
                  </div>
                </>
              )}
              {/* Cloud Polyline selected */}
              {selectedAnnotation.type === 'cloudPolyline' && (
                <>
                  <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
                  <div className="tool-option"><label>Color:</label><input type="color" value={selectedAnnotation.color || '#ff0000'} onChange={(e) => updateAnnotation('color', e.target.value)} /></div>
                  <div className="tool-option"><label>Width:</label><SizeInput value={selectedAnnotation.strokeWidth || 2} onChange={(v) => updateAnnotation('strokeWidth', v)} min={1} max={8} sizes={[1,2,3,4,5,6,7,8]} keyPrefix={`sel-cp-${selectedAnnotation.id}`} uiMode={ui} /></div>
                  <div className="tool-option"><label>{'\u03B1'}:</label><OpacityInput value={selectedAnnotation.strokeOpacity || 1} onChange={(v) => updateAnnotation('strokeOpacity', v)} min={0.1} max={1} keyPrefix={`sel-cpop-${selectedAnnotation.id}`} uiMode={ui} /></div>
                  <div className="tool-option"><label>Arc:</label><SizeInput value={selectedAnnotation.arcSize || selectedAnnotation.cloudArcSize || 15} onChange={(v) => updateAnnotation('arcSize', v)} min={4} max={40} sizes={[4,6,8,10,12,14,16,18,20,24,28,32,36,40]} keyPrefix={`sel-cpa-${selectedAnnotation.id}`} uiMode={ui} /></div>
                  <div className="tool-option"><label>Invert:</label>
                    <button className={`fill-toggle ${(selectedAnnotation.cloudInverted || selectedAnnotation.inverted) ? 'active' : ''}`} onClick={() => { updateAnnotation('cloudInverted', !(selectedAnnotation.cloudInverted || selectedAnnotation.inverted)); updateAnnotation('inverted', !(selectedAnnotation.cloudInverted || selectedAnnotation.inverted)); }} title="Flip bumps direction">{(selectedAnnotation.cloudInverted || selectedAnnotation.inverted) ? '\u2198\u2199' : '\u2197\u2196'}</button>
                  </div>
                  <span style={{ color: '#666', margin: '0 4px' }}>|</span>
                  <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
                  <div className="tool-option"><label>Color:</label>
                    <button title="No fill" className={`fill-toggle ${!selectedAnnotation.fillColor || selectedAnnotation.fillColor === 'none' ? 'active' : ''}`} onClick={() => updateAnnotation('fillColor', 'none')}>{'\u2205'}</button>
                    <input type="color" value={!selectedAnnotation.fillColor || selectedAnnotation.fillColor === 'none' ? '#ffffff' : selectedAnnotation.fillColor} onChange={(e) => updateAnnotation('fillColor', e.target.value)} style={{ opacity: !selectedAnnotation.fillColor || selectedAnnotation.fillColor === 'none' ? 0.5 : 1 }} />
                  </div>
                  <div className="tool-option"><label>{'\u03B1'}:</label><OpacityInput value={selectedAnnotation.fillOpacity || 0.3} onChange={(v) => updateAnnotation('fillOpacity', v)} min={0.1} max={1} keyPrefix={`sel-cpfop-${selectedAnnotation.id}`} uiMode={ui} disabled={!selectedAnnotation.fillColor || selectedAnnotation.fillColor === 'none'} dimmed={!selectedAnnotation.fillColor || selectedAnnotation.fillColor === 'none'} />
                    <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
                  </div>
                </>
              )}
              {/* Arc selected */}
              {selectedAnnotation.type === 'arc' && (
                <>
                  <div className="tool-option"><label>Color:</label><input type="color" value={selectedAnnotation.color || '#ff0000'} onChange={(e) => updateAnnotation('color', e.target.value)} /></div>
                  <div className="tool-option"><label>Width:</label><SizeInput value={selectedAnnotation.strokeWidth || 2} onChange={(v) => updateAnnotation('strokeWidth', v)} min={1} max={8} sizes={[1,2,3,4,5,6,7,8]} keyPrefix={`sel-arc-${selectedAnnotation.id}`} uiMode={ui} /></div>
                  <div className="tool-option"><label>{'\u03B1'}:</label><OpacityInput value={selectedAnnotation.strokeOpacity || 1} onChange={(v) => updateAnnotation('strokeOpacity', v)} min={0.1} max={1} keyPrefix={`sel-arcop-${selectedAnnotation.id}`} uiMode={ui} /></div>
                  <div className="tool-option"><label>Style:</label><LineStyleSelect value={selectedAnnotation.lineStyle || 'solid'} onChange={(v) => updateAnnotation('lineStyle', v)} />
                    <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
                  </div>
                </>
              )}
              {/* Text selected */}
              {selectedAnnotation.type === 'text' && (
                <>
                  <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Text:</span>
                  <div className="tool-option"><label>Color:</label><input type="color" value={selectedAnnotation.color || '#000000'} onChange={(e) => updateAnnotation('color', e.target.value)} /></div>
                  <div className="tool-option"><label>Font:</label>
                    <select value={selectedAnnotation.fontFamily || 'Arial'} onChange={(e) => updateAnnotation('fontFamily', e.target.value)} style={{ padding: '2px 4px', background: '#333', color: 'white', border: '1px solid #555', borderRadius: '3px', maxWidth: '100px', fontSize: '11px' }}>
                      <optgroup label="Sans-Serif"><option value="Helvetica">Helvetica</option><option value="Arial">Arial</option><option value="Verdana">Verdana</option><option value="Roboto">Roboto</option><option value="Open Sans">Open Sans</option></optgroup>
                      <optgroup label="Serif"><option value="Times New Roman">Times</option><option value="Georgia">Georgia</option></optgroup>
                      <optgroup label="Monospace"><option value="Courier New">Courier</option></optgroup>
                    </select>
                  </div>
                  <div className="tool-option"><label>Size:</label>
                    <select value={selectedAnnotation.fontSize || 14} onChange={(e) => updateAnnotation('fontSize', parseInt(e.target.value))} style={{ padding: '2px 4px', background: '#333', color: 'white', border: '1px solid #555', borderRadius: '3px', fontSize: '11px' }}>
                      {[8,9,10,12,14,16,18,20,24,28,32,36,48,64,72].map(s => <option key={s} value={s}>{s}pt</option>)}
                    </select>
                  </div>
                  <div className="tool-option"><label>Align:</label>
                    <div style={{ display: 'flex', gap: '2px' }}>
                      {[['left','\u2261'],['center','\u2630'],['right','\u2AF6']].map(([a,sym]) => (
                        <button key={a} onClick={() => updateAnnotation('textAlign', a)} title={`Align ${a}`} style={{ padding: '2px 5px', background: (selectedAnnotation.textAlign || 'left') === a ? '#3498db' : '#444', border: 'none', borderRadius: '3px', color: 'white', cursor: 'pointer', fontSize: '10px' }}>{sym}</button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {/* Delete button */}
              <button className="delete-selected-btn" onClick={() => { setSlotAnnotations(prev => ({ ...prev, [selectedAnnotation.slotId]: (prev[selectedAnnotation.slotId] || []).filter(a => a.id !== selectedAnnotation.id) })); setSelectedAnnotation(null); }} title="Delete (Del)">Delete</button>
            </>
          )}

          {/* ── Tool-mode Options ── */}

          {/* Pen */}
          {markupMode === 'pen' && (
            <>
              <div className="tool-option"><label>Color:</label><input type="color" value={markupColor} onChange={(e) => setMarkupColor(e.target.value)} /></div>
              <div className="tool-option"><label>Size:</label>
                <SizeInput value={markupStrokeWidth} onChange={setMarkupStrokeWidth} min={1} max={150} sizes={[1,2,3,4,5,6,8,10,12,14,16,18,20,24,28,32,36,42,48,56,64,72,84,96,110,128,150]} keyPrefix="pen-size" uiMode={ui} />
                <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
              </div>
              <DefaultButton onClick={() => saveToolDefaults('pen', { color: markupColor, strokeWidth: markupStrokeWidth, opacity: 1 })} />
            </>
          )}

          {/* Highlighter */}
          {markupMode === 'highlighter' && (
            <>
              <div className="tool-option"><label>Color:</label><input type="color" value={markupColor} onChange={(e) => setMarkupColor(e.target.value)} /></div>
              <div className="tool-option"><label>Size:</label>
                {ui === 'slider' ? (
                  <>
                    <input type="range" min="5" max="150" value={markupStrokeWidth * 3} onChange={(e) => setMarkupStrokeWidth(Math.round(parseInt(e.target.value) / 3))} style={{ width: '120px' }} />
                    <input type="text" className="manual-input" defaultValue={markupStrokeWidth * 3} key={`hl-size-${markupStrokeWidth}`} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} onBlur={(e) => { const n = parseInt(e.target.value); if (isNaN(n) || n < 5) setMarkupStrokeWidth(Math.round(5/3)); else if (n > 150) setMarkupStrokeWidth(50); else setMarkupStrokeWidth(Math.round(n/3)); }} />
                    <span>px</span>
                  </>
                ) : (
                  <select value={markupStrokeWidth * 3} onChange={(e) => setMarkupStrokeWidth(Math.round(parseInt(e.target.value) / 3))} style={{ padding: '2px 4px', fontSize: '12px', minWidth: '70px' }}>
                    {[6,9,12,15,18,21,24,30,36,42,48,54,60,66,72,84,96,110,128,150].map(s => <option key={s} value={s}>{s}px</option>)}
                  </select>
                )}
              </div>
              <div className="tool-option"><label>Opacity:</label>
                <OpacityInput value={markupOpacity} onChange={setMarkupOpacity} min={0.1} max={0.8} keyPrefix="hl-opacity" uiMode={ui} />
                <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
              </div>
              <DefaultButton onClick={() => saveToolDefaults('highlighter', { color: markupColor, strokeWidth: markupStrokeWidth, opacity: markupOpacity })} />
            </>
          )}

          {/* Arrow */}
          {markupMode === 'arrow' && (
            <>
              <div className="tool-option"><label>Color:</label><input type="color" value={markupColor} onChange={(e) => setMarkupColor(e.target.value)} /></div>
              <div className="tool-option"><label>Size:</label><SizeInput value={markupStrokeWidth} onChange={setMarkupStrokeWidth} min={1} max={8} sizes={[1,2,3,4,5,6,7,8]} keyPrefix="arrow-size" uiMode={ui} /></div>
              <div className="tool-option"><label>Style:</label><LineStyleSelect value={markupLineStyle} onChange={setMarkupLineStyle} /></div>
              <div className="tool-option"><label>Head:</label><SizeInput value={markupArrowHeadSize} onChange={setMarkupArrowHeadSize} min={6} max={30} sizes={[6,8,10,12,14,16,18,20,24,28,30]} keyPrefix="arrow-head" uiMode={ui} />
                <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
              </div>
              <DefaultButton onClick={() => saveToolDefaults('arrow', { color: markupColor, strokeWidth: markupStrokeWidth, arrowHeadSize: markupArrowHeadSize, lineStyle: markupLineStyle })} />
            </>
          )}

          {/* Line */}
          {markupMode === 'line' && (
            <>
              <div className="tool-option"><label>Color:</label><input type="color" value={markupColor} onChange={(e) => setMarkupColor(e.target.value)} /></div>
              <div className="tool-option"><label>Size:</label><SizeInput value={markupStrokeWidth} onChange={setMarkupStrokeWidth} min={1} max={8} sizes={[1,2,3,4,5,6,7,8]} keyPrefix="line-size" uiMode={ui} /></div>
              <div className="tool-option"><label>Style:</label><LineStyleSelect value={markupLineStyle} onChange={setMarkupLineStyle} />
                <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
              </div>
              <DefaultButton onClick={() => saveToolDefaults('line', { color: markupColor, strokeWidth: markupStrokeWidth, lineStyle: markupLineStyle })} />
            </>
          )}

          {/* Rectangle */}
          {markupMode === 'rectangle' && (
            <>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
              <div className="tool-option"><label>Color:</label>
                <button title="No line" className={`fill-toggle ${markupColor === 'none' ? 'active' : ''}`} onClick={() => setMarkupColor(markupColor === 'none' ? '#ff0000' : 'none')}>{'\u2205'}</button>
                <input type="color" value={markupColor === 'none' ? '#ff0000' : markupColor} onChange={(e) => setMarkupColor(e.target.value)} style={{ opacity: markupColor === 'none' ? 0.5 : 1 }} />
              </div>
              <div className="tool-option" style={{ opacity: markupColor === 'none' ? 0.5 : 1 }}><label>Width:</label><SizeInput value={markupStrokeWidth} onChange={setMarkupStrokeWidth} min={1} max={8} sizes={[1,2,3,4,5,6,7,8]} keyPrefix="rect-width" uiMode={ui} /></div>
              <div className="tool-option" style={{ opacity: markupColor === 'none' ? 0.5 : 1 }}><label>{'\u03B1'}:</label><OpacityInput value={markupStrokeOpacity} onChange={setMarkupStrokeOpacity} min={0.1} max={1} keyPrefix="rect-sop" uiMode={ui} disabled={markupColor === 'none'} /></div>
              <div className="tool-option" style={{ opacity: markupColor === 'none' ? 0.5 : 1 }}><label>Style:</label><LineStyleSelect value={markupLineStyle} onChange={setMarkupLineStyle} disabled={markupColor === 'none'} /></div>
              <span style={{ color: '#666', margin: '0 4px' }}>|</span>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
              <div className="tool-option"><label>Color:</label>
                <button title="No fill" className={`fill-toggle ${markupFillColor === 'none' ? 'active' : ''}`} onClick={() => setMarkupFillColor('none')}>{'\u2205'}</button>
                <input type="color" value={markupFillColor === 'none' ? '#ffffff' : markupFillColor} onChange={(e) => setMarkupFillColor(e.target.value)} style={{ opacity: markupFillColor === 'none' ? 0.5 : 1 }} />
              </div>
              <div className="tool-option"><label>{'\u03B1'}:</label><OpacityInput value={markupFillOpacity} onChange={setMarkupFillOpacity} min={0.1} max={1} keyPrefix="rect-fop" uiMode={ui} disabled={markupFillColor === 'none'} dimmed={markupFillColor === 'none'} />
                <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
              </div>
              <DefaultButton onClick={() => saveToolDefaults('rectangle', { color: markupColor, fillColor: markupFillColor, strokeWidth: markupStrokeWidth, strokeOpacity: markupStrokeOpacity, fillOpacity: markupFillOpacity, lineStyle: markupLineStyle })} />
            </>
          )}

          {/* Circle */}
          {markupMode === 'circle' && (
            <>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
              <div className="tool-option"><label>Color:</label>
                <button title="No line" className={`fill-toggle ${markupColor === 'none' ? 'active' : ''}`} onClick={() => setMarkupColor(markupColor === 'none' ? '#ff0000' : 'none')}>{'\u2205'}</button>
                <input type="color" value={markupColor === 'none' ? '#ff0000' : markupColor} onChange={(e) => setMarkupColor(e.target.value)} style={{ opacity: markupColor === 'none' ? 0.5 : 1 }} />
              </div>
              <div className="tool-option" style={{ opacity: markupColor === 'none' ? 0.5 : 1 }}><label>Width:</label><SizeInput value={markupStrokeWidth} onChange={setMarkupStrokeWidth} min={1} max={8} sizes={[1,2,3,4,5,6,7,8]} keyPrefix="circle-width" uiMode={ui} /></div>
              <div className="tool-option" style={{ opacity: markupColor === 'none' ? 0.5 : 1 }}><label>{'\u03B1'}:</label><OpacityInput value={markupStrokeOpacity} onChange={setMarkupStrokeOpacity} min={0.1} max={1} keyPrefix="circle-sop" uiMode={ui} disabled={markupColor === 'none'} /></div>
              <div className="tool-option" style={{ opacity: markupColor === 'none' ? 0.5 : 1 }}><label>Style:</label><LineStyleSelect value={markupLineStyle} onChange={setMarkupLineStyle} disabled={markupColor === 'none'} /></div>
              <span style={{ color: '#666', margin: '0 4px' }}>|</span>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
              <div className="tool-option"><label>Color:</label>
                <button title="No fill" className={`fill-toggle ${markupFillColor === 'none' ? 'active' : ''}`} onClick={() => setMarkupFillColor('none')}>{'\u2205'}</button>
                <input type="color" value={markupFillColor === 'none' ? '#ffffff' : markupFillColor} onChange={(e) => setMarkupFillColor(e.target.value)} style={{ opacity: markupFillColor === 'none' ? 0.5 : 1 }} />
              </div>
              <div className="tool-option"><label>{'\u03B1'}:</label><OpacityInput value={markupFillOpacity} onChange={setMarkupFillOpacity} min={0.1} max={1} keyPrefix="circle-fop" uiMode={ui} disabled={markupFillColor === 'none'} dimmed={markupFillColor === 'none'} />
                <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
              </div>
              <DefaultButton onClick={() => saveToolDefaults('circle', { color: markupColor, fillColor: markupFillColor, strokeWidth: markupStrokeWidth, strokeOpacity: markupStrokeOpacity, fillOpacity: markupFillOpacity, lineStyle: markupLineStyle })} />
            </>
          )}

          {/* Arc */}
          {markupMode === 'arc' && (
            <>
              <div className="tool-option"><label>Color:</label><input type="color" value={markupColor} onChange={(e) => setMarkupColor(e.target.value)} /></div>
              <div className="tool-option"><label>Width:</label><SizeInput value={markupStrokeWidth} onChange={setMarkupStrokeWidth} min={1} max={8} sizes={[1,2,3,4,5,6,7,8]} keyPrefix="arc-width" uiMode={ui} /></div>
              <div className="tool-option"><label>{'\u03B1'}:</label><OpacityInput value={markupStrokeOpacity} onChange={setMarkupStrokeOpacity} min={0.1} max={1} keyPrefix="arc-sop" uiMode={ui} /></div>
              <div className="tool-option"><label>Style:</label><LineStyleSelect value={markupLineStyle} onChange={setMarkupLineStyle} />
                <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
              </div>
              <DefaultButton onClick={() => saveToolDefaults('arc', { color: markupColor, strokeWidth: markupStrokeWidth, strokeOpacity: markupStrokeOpacity, lineStyle: markupLineStyle })} />
              <span className="tool-hint" style={{ marginLeft: '8px', color: '#888', fontSize: '11px' }}>Drag to draw. Adjust curvature with orange handle.</span>
            </>
          )}

          {/* Cloud */}
          {markupMode === 'cloud' && (
            <>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
              <div className="tool-option"><label>Color:</label><input type="color" value={markupColor} onChange={(e) => setMarkupColor(e.target.value)} /></div>
              <div className="tool-option"><label>Width:</label><SizeInput value={markupStrokeWidth} onChange={setMarkupStrokeWidth} min={1} max={8} sizes={[1,2,3,4,5,6,7,8]} keyPrefix="cloud-width" uiMode={ui} /></div>
              <div className="tool-option"><label>{'\u03B1'}:</label><OpacityInput value={markupStrokeOpacity} onChange={setMarkupStrokeOpacity} min={0.1} max={1} keyPrefix="cloud-sop" uiMode={ui} /></div>
              <div className="tool-option"><label>Arc:</label><SizeInput value={markupCloudArcSize} onChange={setMarkupCloudArcSize} min={4} max={40} sizes={[4,6,8,10,12,14,16,18,20,24,28,32,36,40]} keyPrefix="cloud-arc" uiMode={ui} /></div>
              <div className="tool-option"><label>Invert:</label>
                <button className={`fill-toggle ${markupCloudInverted ? 'active' : ''}`} onClick={() => setMarkupCloudInverted(!markupCloudInverted)} title="Flip bumps direction">{markupCloudInverted ? '\u2198\u2199' : '\u2197\u2196'}</button>
              </div>
              <span style={{ color: '#666', margin: '0 4px' }}>|</span>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
              <div className="tool-option"><label>Color:</label>
                <button title="No fill" className={`fill-toggle ${markupFillColor === 'none' ? 'active' : ''}`} onClick={() => setMarkupFillColor('none')}>{'\u2205'}</button>
                <input type="color" value={markupFillColor === 'none' ? '#ffffff' : markupFillColor} onChange={(e) => setMarkupFillColor(e.target.value)} style={{ opacity: markupFillColor === 'none' ? 0.5 : 1 }} />
              </div>
              <div className="tool-option"><label>{'\u03B1'}:</label><OpacityInput value={markupFillOpacity} onChange={setMarkupFillOpacity} min={0.1} max={1} keyPrefix="cloud-fop" uiMode={ui} disabled={markupFillColor === 'none'} dimmed={markupFillColor === 'none'} />
                <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
              </div>
              <DefaultButton onClick={() => saveToolDefaults('cloud', { color: markupColor, strokeWidth: markupStrokeWidth, fillColor: markupFillColor, strokeOpacity: markupStrokeOpacity, fillOpacity: markupFillOpacity, inverted: markupCloudInverted, arcSize: markupCloudArcSize })} />
            </>
          )}

          {/* Polyline */}
          {markupMode === 'polyline' && (
            <>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
              <div className="tool-option"><label>Color:</label><input type="color" value={markupColor} onChange={(e) => setMarkupColor(e.target.value)} /></div>
              <div className="tool-option"><label>Width:</label><SizeInput value={markupStrokeWidth} onChange={setMarkupStrokeWidth} min={1} max={8} sizes={[1,2,3,4,5,6,7,8]} keyPrefix="poly-width" uiMode={ui} /></div>
              <div className="tool-option"><label>{'\u03B1'}:</label><OpacityInput value={markupStrokeOpacity} onChange={setMarkupStrokeOpacity} min={0.1} max={1} keyPrefix="poly-sop" uiMode={ui} /></div>
              <div className="tool-option"><label>Style:</label><LineStyleSelect value={markupLineStyle} onChange={setMarkupLineStyle} /></div>
              <span style={{ color: '#666', margin: '0 4px' }}>|</span>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
              <div className="tool-option"><label>Color:</label>
                <button title="No fill" className={`fill-toggle ${markupFillColor === 'none' ? 'active' : ''}`} onClick={() => setMarkupFillColor('none')}>{'\u2205'}</button>
                <input type="color" value={markupFillColor === 'none' ? '#ffffff' : markupFillColor} onChange={(e) => setMarkupFillColor(e.target.value)} style={{ opacity: markupFillColor === 'none' ? 0.5 : 1 }} />
              </div>
              <div className="tool-option"><label>{'\u03B1'}:</label><OpacityInput value={markupFillOpacity} onChange={setMarkupFillOpacity} min={0.1} max={1} keyPrefix="poly-fop" uiMode={ui} disabled={markupFillColor === 'none'} dimmed={markupFillColor === 'none'} />
                <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
              </div>
              <DefaultButton onClick={() => saveToolDefaults('polyline', { color: markupColor, strokeWidth: markupStrokeWidth, strokeOpacity: markupStrokeOpacity, fillColor: markupFillColor, fillOpacity: markupFillOpacity, lineStyle: markupLineStyle })} />
              <span className="tool-hint">Click to add points. Click start to close. Double-click to finish. Shift = snap.</span>
            </>
          )}

          {/* Polyline Arrow */}
          {markupMode === 'polylineArrow' && (
            <>
              <div className="tool-option"><label>Color:</label><input type="color" value={markupColor} onChange={(e) => setMarkupColor(e.target.value)} /></div>
              <div className="tool-option"><label>Width:</label><SizeInput value={markupStrokeWidth} onChange={setMarkupStrokeWidth} min={1} max={8} sizes={[1,2,3,4,5,6,7,8]} keyPrefix="polyarr-width" uiMode={ui} /></div>
              <div className="tool-option"><label>Head:</label><SizeInput value={markupArrowHeadSize} onChange={setMarkupArrowHeadSize} min={6} max={30} sizes={[6,8,10,12,14,16,18,20,24,28,30]} keyPrefix="polyarr-head" uiMode={ui} /></div>
              <div className="tool-option"><label>Style:</label><LineStyleSelect value={markupLineStyle} onChange={setMarkupLineStyle} />
                <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
              </div>
              <DefaultButton onClick={() => saveToolDefaults('polylineArrow', { color: markupColor, strokeWidth: markupStrokeWidth, arrowHeadSize: markupArrowHeadSize, lineStyle: markupLineStyle })} />
              <span className="tool-hint">Click to add points. Double-click to finish with arrow. Shift = snap.</span>
            </>
          )}

          {/* Cloud Polyline */}
          {markupMode === 'cloudPolyline' && (
            <>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
              <div className="tool-option"><label>Color:</label><input type="color" value={markupColor} onChange={(e) => setMarkupColor(e.target.value)} /></div>
              <div className="tool-option"><label>Width:</label><SizeInput value={markupStrokeWidth} onChange={setMarkupStrokeWidth} min={1} max={8} sizes={[1,2,3,4,5,6,7,8]} keyPrefix="cloudpoly-width" uiMode={ui} /></div>
              <div className="tool-option"><label>{'\u03B1'}:</label><OpacityInput value={markupStrokeOpacity} onChange={setMarkupStrokeOpacity} min={0.1} max={1} keyPrefix="cloudpoly-sop" uiMode={ui} /></div>
              <div className="tool-option"><label>Arc:</label><SizeInput value={markupCloudArcSize} onChange={setMarkupCloudArcSize} min={4} max={40} sizes={[4,6,8,10,12,14,16,18,20,24,28,32,36,40]} keyPrefix="cloudpoly-arc" uiMode={ui} /></div>
              <div className="tool-option"><label>Invert:</label>
                <button className={`fill-toggle ${markupCloudInverted ? 'active' : ''}`} onClick={() => setMarkupCloudInverted(!markupCloudInverted)} title="Flip bumps direction">{markupCloudInverted ? '\u2198\u2199' : '\u2197\u2196'}</button>
              </div>
              <span style={{ color: '#666', margin: '0 4px' }}>|</span>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
              <div className="tool-option"><label>Color:</label>
                <button title="No fill" className={`fill-toggle ${markupFillColor === 'none' ? 'active' : ''}`} onClick={() => setMarkupFillColor('none')}>{'\u2205'}</button>
                <input type="color" value={markupFillColor === 'none' ? '#ffffff' : markupFillColor} onChange={(e) => setMarkupFillColor(e.target.value)} style={{ opacity: markupFillColor === 'none' ? 0.5 : 1 }} />
              </div>
              <div className="tool-option"><label>{'\u03B1'}:</label><OpacityInput value={markupFillOpacity} onChange={setMarkupFillOpacity} min={0.1} max={1} keyPrefix="cloudpoly-fop" uiMode={ui} disabled={markupFillColor === 'none'} dimmed={markupFillColor === 'none'} />
                <UIModeToggle penHighlighterUIMode={ui} setPenHighlighterUIMode={setPenHighlighterUIMode} />
              </div>
              <DefaultButton onClick={() => saveToolDefaults('cloudPolyline', { color: markupColor, strokeWidth: markupStrokeWidth, strokeOpacity: markupStrokeOpacity, fillColor: markupFillColor, fillOpacity: markupFillOpacity, arcSize: markupCloudArcSize, inverted: markupCloudInverted })} />
              <span className="tool-hint">Click to add points. Double-click to finish. Shift = snap.</span>
            </>
          )}

          {/* Text */}
          {markupMode === 'text' && (
            <>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
              <div className="tool-option"><label>Color:</label>
                <button title="No border" className={`fill-toggle ${markupBorderColor === 'none' ? 'active' : ''}`} onClick={() => setMarkupBorderColor(markupBorderColor === 'none' ? '#000000' : 'none')}>{'\u2205'}</button>
                <input type="color" value={markupBorderColor === 'none' ? '#000000' : markupBorderColor} onChange={(e) => setMarkupBorderColor(e.target.value)} style={{ opacity: markupBorderColor === 'none' ? 0.5 : 1 }} />
              </div>
              <div className="tool-option" style={{ opacity: markupBorderColor === 'none' ? 0.5 : 1 }}><label>Width:</label>
                <select value={markupBorderWidth} onChange={(e) => setMarkupBorderWidth(parseInt(e.target.value))} disabled={markupBorderColor === 'none'} style={{ padding: '2px 4px', fontSize: '12px', minWidth: '55px' }}>
                  {[1,2,3,4,5,6,7,8].map(s => <option key={s} value={s}>{s}px</option>)}
                </select>
              </div>
              <div className="tool-option" style={{ opacity: markupBorderColor === 'none' ? 0.5 : 1 }}><label>Style:</label>
                <select value={markupBorderStyle} onChange={(e) => setMarkupBorderStyle(e.target.value)} disabled={markupBorderColor === 'none'} style={{ padding: '2px 4px', fontSize: '12px' }}>
                  <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
                </select>
              </div>
              <div className="tool-option" style={{ opacity: markupBorderColor === 'none' ? 0.5 : 1 }}><label>{'\u03B1'}:</label>
                <input type="number" min="10" max="100" step="10" value={Math.round(markupBorderOpacity * 100)} disabled={markupBorderColor === 'none'} onChange={(e) => { const n = parseInt(e.target.value); if (!isNaN(n)) setMarkupBorderOpacity(Math.max(0.1, Math.min(1, n/100))); }} style={{ width: '50px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px' }} /><span>%</span>
              </div>
              <span style={{ color: '#666', margin: '0 4px' }}>|</span>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
              <div className="tool-option"><label>Color:</label>
                <button title="No fill" className={`fill-toggle ${markupFillColor === 'none' ? 'active' : ''}`} onClick={() => setMarkupFillColor(markupFillColor === 'none' ? '#ffffff' : 'none')}>{'\u2205'}</button>
                <input type="color" value={markupFillColor === 'none' ? '#ffffff' : markupFillColor} onChange={(e) => setMarkupFillColor(e.target.value)} style={{ opacity: markupFillColor === 'none' ? 0.5 : 1 }} />
              </div>
              <div className="tool-option" style={{ opacity: markupFillColor === 'none' ? 0.5 : 1 }}><label>{'\u03B1'}:</label>
                <input type="number" min="10" max="100" step="10" value={Math.round(markupFillOpacity * 100)} disabled={markupFillColor === 'none'} onChange={(e) => { const n = parseInt(e.target.value); if (!isNaN(n)) setMarkupFillOpacity(Math.max(0.1, Math.min(1, n/100))); }} style={{ width: '50px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px' }} /><span>%</span>
              </div>
              <span style={{ color: '#666', margin: '0 4px' }}>|</span>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Text:</span>
              <div className="tool-option"><label>Color:</label><input type="color" value={markupColor} onChange={(e) => setMarkupColor(e.target.value)} /></div>
              <div className="tool-option"><label>Font:</label>
                <select value={markupFontFamily} onChange={(e) => setMarkupFontFamily(e.target.value)} style={{ padding: '2px 4px', background: '#333', color: 'white', border: '1px solid #555', borderRadius: '3px', maxWidth: '100px', fontSize: '11px' }}>
                  <optgroup label="Sans-Serif"><option value="Helvetica">Helvetica</option><option value="Arial">Arial</option><option value="Verdana">Verdana</option><option value="Roboto">Roboto</option><option value="Open Sans">Open Sans</option></optgroup>
                  <optgroup label="Serif"><option value="Times New Roman">Times</option><option value="Georgia">Georgia</option></optgroup>
                  <optgroup label="Monospace"><option value="Courier New">Courier</option></optgroup>
                </select>
              </div>
              <div className="tool-option"><label>Size:</label>
                <select value={markupFontSize} onChange={(e) => setMarkupFontSize(parseInt(e.target.value))} style={{ padding: '2px 4px', background: '#333', color: 'white', border: '1px solid #555', borderRadius: '3px', fontSize: '11px' }}>
                  {[8,9,10,12,14,16,18,20,24,28,32,36,48,64,72].map(s => <option key={s} value={s}>{s}pt</option>)}
                </select>
              </div>
              <div className="tool-option"><label>Align:</label>
                <div style={{ display: 'flex', gap: '2px' }}>
                  {[['left','\u2261'],['center','\u2630'],['right','\u2AF6']].map(([a,sym]) => (
                    <button key={a} onClick={() => setMarkupTextAlign(a)} title={`Align ${a}`} style={{ padding: '2px 5px', background: markupTextAlign === a ? '#3498db' : '#444', border: 'none', borderRadius: '3px', color: 'white', cursor: 'pointer', fontSize: '10px' }}>{sym}</button>
                  ))}
                </div>
              </div>
              <div className="tool-option"><label>V:</label>
                <div style={{ display: 'flex', gap: '2px' }}>
                  {[['top','\u22A4'],['middle','\u229D'],['bottom','\u22A5']].map(([a,sym]) => (
                    <button key={a} onClick={() => setMarkupVerticalAlign(a)} title={`Align ${a}`} style={{ padding: '2px 5px', background: markupVerticalAlign === a ? '#3498db' : '#444', border: 'none', borderRadius: '3px', color: 'white', cursor: 'pointer', fontSize: '9px' }}>{sym}</button>
                  ))}
                </div>
              </div>
              <div className="tool-option"><label>Pad:</label>
                <select value={markupTextPadding} onChange={(e) => setMarkupTextPadding(parseInt(e.target.value))} style={{ padding: '2px 4px', background: '#333', color: 'white', border: '1px solid #555', borderRadius: '3px', fontSize: '11px' }}>
                  {[0,2,4,6,8,10,12,16,20].map(p => <option key={p} value={p}>{p}px</option>)}
                </select>
              </div>
              <DefaultButton onClick={() => saveToolDefaults('text', { color: markupColor, fillColor: markupFillColor, fillOpacity: markupFillOpacity, borderColor: markupBorderColor, borderWidth: markupBorderWidth, borderStyle: markupBorderStyle, borderOpacity: markupBorderOpacity, fontSize: markupFontSize, fontFamily: markupFontFamily, textAlign: markupTextAlign, verticalAlign: markupVerticalAlign, padding: markupTextPadding })} />
            </>
          )}

          {/* Callout */}
          {markupMode === 'callout' && (
            <>
              <div className="tool-option"><label>Text:</label><input type="color" value={markupColor} onChange={(e) => setMarkupColor(e.target.value)} /></div>
              <div className="tool-option"><label>Fill:</label><input type="color" value={markupFillColor === 'none' ? '#ffffcc' : markupFillColor} onChange={(e) => setMarkupFillColor(e.target.value)} /></div>
              <div className="tool-option"><label>Size:</label>
                <select value={markupFontSize} onChange={(e) => setMarkupFontSize(parseInt(e.target.value))} style={{ padding: '4px', background: '#333', color: 'white', border: '1px solid #555', borderRadius: '4px' }}>
                  {[8,9,10,12,14,16,18,20,24].map(s => <option key={s} value={s}>{s}pt</option>)}
                </select>
              </div>
              <DefaultButton onClick={() => saveToolDefaults('callout', { color: markupColor, fillColor: markupFillColor, fontSize: markupFontSize })} />
            </>
          )}

          {/* Note */}
          {markupMode === 'note' && (
            <>
              <div className="tool-option"><label>Color:</label>
                {['#ffeb3b', '#ff9800', '#4caf50', '#2196f3', '#9c27b0', '#f44336'].map(color => (
                  <button key={color} onClick={() => setMarkupColor(color)} style={{ width: '24px', height: '24px', borderRadius: '4px', background: color, border: markupColor === color ? '2px solid white' : '1px solid #555', cursor: 'pointer', marginRight: '4px' }} />
                ))}
              </div>
              <DefaultButton onClick={() => saveToolDefaults('note', { color: markupColor })} />
            </>
          )}

          {/* Eraser */}
          {markupMode === 'eraser' && (
            <span className="tool-hint">Click on markups to delete them</span>
          )}
        </div>
      )}
    </div>
  );
}
