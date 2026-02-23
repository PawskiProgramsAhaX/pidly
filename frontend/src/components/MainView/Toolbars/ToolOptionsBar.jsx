/**
 * ToolOptionsBar.jsx
 * 
 * Tool options bar showing context-sensitive options for the selected markup
 * or currently active drawing tool. Also includes the document lock/unlock button.
 * 
 * This is a large component (~4600 lines) containing options for all markup types:
 * - Pen, Highlighter
 * - Arrow, Line, Arc
 * - Rectangle, Circle, Cloud
 * - Polyline, PolylineArrow, CloudPolyline
 * - Text, Callout, Note
 */

export default function ToolOptionsBar({
  // Markup mode and edit state
  markupMode,
  onSetMarkupMode,
  markupEditMode,
  onSetMarkupEditMode,
  selectedMarkup,
  selectedMarkups,
  onSetSelectedMarkup,
  // Update function for selected markup properties
  updateMarkupProperties,
  // Pen/Highlighter UI mode
  penHighlighterUIMode,
  onSetPenHighlighterUIMode,
  // Color settings
  markupColor,
  onSetMarkupColor,
  markupFillColor,
  onSetMarkupFillColor,
  markupBorderColor,
  onSetMarkupBorderColor,
  // Stroke settings
  markupStrokeWidth,
  onSetMarkupStrokeWidth,
  markupOpacity,
  onSetMarkupOpacity,
  markupStrokeOpacity,
  onSetMarkupStrokeOpacity,
  markupFillOpacity,
  onSetMarkupFillOpacity,
  markupBorderOpacity,
  onSetMarkupBorderOpacity,
  markupBorderWidth,
  onSetMarkupBorderWidth,
  // Line style
  markupLineStyle,
  onSetMarkupLineStyle,
  // Named/custom line style for drawing tools
  markupLineStyleName,
  onSetMarkupLineStyleName,
  markupLineStylePattern,
  onSetMarkupLineStylePattern,
  markupLineStyleRaw,
  onSetMarkupLineStyleRaw,
  // Project-scoped saved line styles
  projectLineStyles,
  onSaveLineStyle,
  onRemoveLineStyle,
  markupBorderStyle,
  onSetMarkupBorderStyle,
  // Arrow settings
  markupArrowHeadSize,
  onSetMarkupArrowHeadSize,
  // Cloud settings
  markupCloudArcSize,
  onSetMarkupCloudArcSize,
  markupCloudInverted,
  onSetMarkupCloudInverted,
  // Text settings
  markupFontSize,
  onSetMarkupFontSize,
  markupFontFamily,
  onSetMarkupFontFamily,
  markupTextAlign,
  onSetMarkupTextAlign,
  markupVerticalAlign,
  onSetMarkupVerticalAlign,
  markupTextPadding,
  onSetMarkupTextPadding,
  // PDF state
  pdfDoc,
  hasLoadedAnnotations,
  onLoadAnnotationsFromPdf,
  onSetHasLoadedAnnotations,
  // Markups management
  markups,
  onSetMarkups,
  ownedPdfAnnotationIds,
  onSetOwnedPdfAnnotationIds,
  unsavedMarkupFiles,
  onSetUnsavedMarkupFiles,
  deletedPdfAnnotations,
  onSetDeletedPdfAnnotations,
  // Symbols panel
  showMarkupsPanel,
  onSetShowMarkupsPanel,
  onSetShowMarkupHistoryPanel,
  // File info
  currentFile,
  currentFileIdentifier,
  // Save function
  onSaveMarkupsToPdf,
  // Placement mode (symbols/signatures)
  pendingPlacement
}) {
  
  // ── Custom Named Line Styles (project-scoped via IndexedDB) ──────────────
  
  const savedStyles = projectLineStyles || [];
  
  const isStyleSaved = (name) => {
    return name && savedStyles.some(s => s.name === name);
  };

  /**
   * Enhanced line style selector — includes saved custom named styles.
   * Two modes:
   *   mode='selected' → editing an existing selected markup
   *   mode='tool'     → configuring the drawing tool for new markups
   */
  const renderLineStyleSelect = (currentValue, onChange, disabled, markup, mode = 'selected') => {
    const hasNamedStyle = markup?.lineStyleName;
    const alreadySaved = hasNamedStyle && isStyleSaved(markup.lineStyleName);
    
    // For tool mode, check if a custom style is currently active
    const toolHasCustom = mode === 'tool' && markupLineStyleName;
    
    // Determine select value
    let selectValue;
    if (mode === 'selected' && hasNamedStyle) {
      selectValue = `named:${markup.lineStyleName}`;
    } else if (mode === 'tool' && markupLineStyleName) {
      selectValue = `named:${markupLineStyleName}`;
    } else {
      selectValue = currentValue || 'solid';
    }
    
    const handleChange = (e) => {
      const val = e.target.value;
      if (val.startsWith('named:')) {
        const styleName = val.replace('named:', '');
        // Find from saved styles or from current markup
        let styleData;
        if (markup?.lineStyleName === styleName) {
          styleData = { name: styleName, lineStylePattern: markup.lineStylePattern, lineStyleRaw: markup.lineStyleRaw };
        } else {
          styleData = savedStyles.find(s => s.name === styleName);
        }
        if (styleData) {
          if (mode === 'selected' && markup) {
            updateMarkupProperties(markup.id, {
              lineStyle: 'solid',
              lineStyleName: styleData.name,
              lineStylePattern: styleData.lineStylePattern,
              lineStyleRaw: styleData.lineStyleRaw,
            });
          } else if (mode === 'tool') {
            onSetMarkupLineStyle('solid');
            onSetMarkupLineStyleName(styleData.name);
            onSetMarkupLineStylePattern(styleData.lineStylePattern);
            onSetMarkupLineStyleRaw(styleData.lineStyleRaw);
          }
        }
      } else {
        // Standard style — clear any named style
        if (mode === 'selected' && markup?.lineStyleName) {
          updateMarkupProperties(markup.id, {
            lineStyle: val,
            lineStyleName: undefined,
            lineStylePattern: undefined,
            lineStyleRaw: undefined,
          });
        } else if (mode === 'tool') {
          onSetMarkupLineStyle(val);
          onSetMarkupLineStyleName(null);
          onSetMarkupLineStylePattern(null);
          onSetMarkupLineStyleRaw(null);
        } else {
          onChange(e);
        }
      }
    };
    
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        <select 
          value={selectValue}
          onChange={handleChange}
          disabled={disabled}
          style={{ padding: '2px 4px', fontSize: '12px' }}
        >
          <option value="solid">━━━ Solid</option>
          <option value="dashed">┅┅┅ Dashed</option>
          <option value="dotted">┈┈┈ Dotted</option>
          <option value="dashdot">━┅━ Dash-Dot</option>
          <option value="longdash">━ ━ Long Dash</option>
          {(savedStyles.length > 0 || hasNamedStyle) && (
            <option disabled>── Custom ──</option>
          )}
          {/* Unsaved named style from current markup */}
          {hasNamedStyle && !alreadySaved && (
            <option value={`named:${markup.lineStyleName}`}>⟡ {markup.lineStyleName}</option>
          )}
          {/* All saved custom styles */}
          {savedStyles.map(s => (
            <option key={s.name} value={`named:${s.name}`}>★ {s.name}</option>
          ))}
        </select>
        {/* Save button — prompt for name, async save to project */}
        {mode === 'selected' && hasNamedStyle && !alreadySaved && onSaveLineStyle && (
          <button
            onClick={async (e) => {
              e.preventDefault();
              const defaultName = markup.lineStyleName || '';
              const name = window.prompt('Save line style as:', defaultName);
              if (!name || !name.trim()) return;
              const result = await onSaveLineStyle({
                name: name.trim(),
                lineStylePattern: markup.lineStylePattern,
                lineStyleRaw: markup.lineStyleRaw,
              });
              if (result === 'duplicate') {
                alert(`A style named "${name.trim()}" already exists in this project.`);
              } else if (result === 'saved') {
                // Update the markup's lineStyleName to match what user typed
                updateMarkupProperties(markup.id, { lineStyleName: name.trim() });
                const btn = e.currentTarget;
                btn.textContent = '✓ Saved';
                btn.style.background = '#27ae60';
                btn.style.color = '#fff';
                setTimeout(() => { btn.textContent = '★ Saved'; }, 1500);
              }
            }}
            title={`Save line style to project for reuse`}
            style={{
              padding: '2px 6px', fontSize: '10px', background: '#2c5282', color: '#90cdf4',
              border: '1px solid #4299e1', borderRadius: '3px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            ★ Save Style
          </button>
        )}
        {/* Badge showing saved */}
        {mode === 'selected' && hasNamedStyle && alreadySaved && (
          <span title={`"${markup.lineStyleName}" (saved to project)`} style={{ fontSize: '10px', color: '#68d391', whiteSpace: 'nowrap' }}>
            ★ {markup.lineStyleName}
          </span>
        )}
        {/* Tool mode: show active custom style name */}
        {mode === 'tool' && toolHasCustom && (
          <span style={{ fontSize: '10px', color: '#90cdf4', whiteSpace: 'nowrap' }}>
            ★ {markupLineStyleName}
          </span>
        )}
      </span>
    );
  };
  
  return (
      <div className="pdf-toolbar pdf-toolbar-options">
        {/* Pending placement mode — symbol/signature being placed */}
        {pendingPlacement ? (
          <div className="tool-options-row">
            <span style={{ color: '#3498db', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                <path d="M2 14L2 2L14 8L2 14Z" fill="#3498db" opacity="0.8"/>
              </svg>
              Drawing — {pendingPlacement.symbol?.name || (pendingPlacement.isSignature ? 'Signature' : 'Symbol')}
            </span>
            <span style={{ color: '#666', fontSize: '10px', marginLeft: '12px' }}>
              Click and drag to place • Esc to cancel
            </span>
          </div>
        ) : null}
        
        {/* Default state - no tool selected */}
        {(!markupMode && !selectedMarkup && !pendingPlacement) ? (
          <div className="tool-options-row">
            <span className="tool-hint" style={{ color: '#888', fontSize: '11px' }}>
              Select a tool or click a markup
            </span>
          </div>
        ) : null}
        
        {/* Selected Markup Options - when a markup is selected for editing */}
        {!pendingPlacement && selectedMarkup && !markupMode && markupEditMode && (
          <div className="tool-options-row">
            
            {/* Pen selected options */}
            {selectedMarkup.type === 'pen' && (
              <>
                <div className="tool-option">
                  <label>Color:</label>
                  <input 
                    type="color" 
                    value={selectedMarkup.color || '#ff0000'}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { color: e.target.value })}
                  />
                </div>
                <div className="tool-option">
                  <label>Size:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="1" 
                        max="72" 
                        value={selectedMarkup.strokeWidth || 3}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                        style={{ width: '120px' }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={selectedMarkup.strokeWidth || 3}
                        key={`sel-pen-size-${selectedMarkup.id}-${selectedMarkup.strokeWidth}`}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 1) updateMarkupProperties(selectedMarkup.id, { strokeWidth: 1 });
                          else if (num > 72) updateMarkupProperties(selectedMarkup.id, { strokeWidth: 72 });
                          else updateMarkupProperties(selectedMarkup.id, { strokeWidth: num });
                        }}
                      />
                      <span>px</span>
                    </>
                  ) : (
                    <select
                      value={selectedMarkup.strokeWidth || 3}
                      onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                      style={{ padding: '2px 4px', fontSize: '12px', minWidth: '70px' }}
                    >
                      {[1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72].map(size => (
                        <option key={size} value={size}>{size}px</option>
                      ))}
                    </select>
                  )}
                  <button 
                    className="ui-mode-toggle"
                    onClick={() => {
                      const newMode = penHighlighterUIMode === 'slider' ? 'compact' : 'slider';
                      onSetPenHighlighterUIMode(newMode);
                      localStorage.setItem('penHighlighterUIMode', newMode);
                    }}
                    title={penHighlighterUIMode === 'slider' ? 'Switch to compact dropdown' : 'Switch to slider'}
                    style={{ padding: '2px 5px', fontSize: '10px', background: '#444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', marginLeft: '2px' }}
                  >
                    {penHighlighterUIMode === 'slider' ? '▼' : '≡'}
                  </button>
                </div>
                <button 
                  className="set-default-btn"
                  onClick={(e) => {
                    const btn = e.target;
                    const defaults = { color: selectedMarkup.color, strokeWidth: selectedMarkup.strokeWidth };
                    localStorage.setItem('markup_pen_defaults', JSON.stringify(defaults));
                    btn.textContent = '✓';
                    btn.style.background = '#27ae60';
                    setTimeout(() => { btn.textContent = '☆ Default'; btn.style.background = ''; }, 1500);
                  }}
                  title="Save current settings as default"
                >
                  ☆ Default
                </button>
              </>
            )}
            
            {/* Highlighter selected options */}
            {selectedMarkup.type === 'highlighter' && (
              <>
                <div className="tool-option">
                  <label>Color:</label>
                  <input 
                    type="color" 
                    value={selectedMarkup.color || '#ffff00'}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { color: e.target.value })}
                  />
                </div>
                <div className="tool-option">
                  <label>Size:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="5" 
                        max="72" 
                        value={selectedMarkup.strokeWidth || 12}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                        style={{ width: '120px' }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={selectedMarkup.strokeWidth || 12}
                        key={`sel-hl-size-${selectedMarkup.id}-${selectedMarkup.strokeWidth}`}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 5) updateMarkupProperties(selectedMarkup.id, { strokeWidth: 5 });
                          else if (num > 72) updateMarkupProperties(selectedMarkup.id, { strokeWidth: 72 });
                          else updateMarkupProperties(selectedMarkup.id, { strokeWidth: num });
                        }}
                      />
                      <span>px</span>
                    </>
                  ) : (
                    <select
                      value={selectedMarkup.strokeWidth || 12}
                      onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                      style={{ padding: '2px 4px', fontSize: '12px', minWidth: '70px' }}
                    >
                      {[6, 9, 12, 15, 18, 21, 24, 30, 36, 42, 48, 54, 60, 66, 72].map(size => (
                        <option key={size} value={size}>{size}px</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="tool-option">
                  <label>Opacity:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="0.1" 
                        max="0.8" 
                        step="0.1"
                        value={selectedMarkup.opacity || 0.4}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { opacity: parseFloat(e.target.value) })}
                        style={{ width: '80px' }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={Math.round((selectedMarkup.opacity || 0.4) * 100)}
                        key={`sel-hl-opacity-${selectedMarkup.id}-${selectedMarkup.opacity}`}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 10) updateMarkupProperties(selectedMarkup.id, { opacity: 0.1 });
                          else if (num > 80) updateMarkupProperties(selectedMarkup.id, { opacity: 0.8 });
                          else updateMarkupProperties(selectedMarkup.id, { opacity: num / 100 });
                        }}
                      />
                      <span>%</span>
                    </>
                  ) : (
                    <>
                      <input 
                        type="number"
                        min="10"
                        max="80"
                        step="10"
                        value={Math.round((selectedMarkup.opacity || 0.4) * 100)}
                        onChange={(e) => {
                          const num = parseInt(e.target.value);
                          if (!isNaN(num)) {
                            if (num < 10) updateMarkupProperties(selectedMarkup.id, { opacity: 0.1 });
                            else if (num > 80) updateMarkupProperties(selectedMarkup.id, { opacity: 0.8 });
                            else updateMarkupProperties(selectedMarkup.id, { opacity: num / 100 });
                          }
                        }}
                        style={{ width: '55px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px' }}
                      />
                      <span>%</span>
                    </>
                  )}
                  <button 
                    className="ui-mode-toggle"
                    onClick={() => {
                      const newMode = penHighlighterUIMode === 'slider' ? 'compact' : 'slider';
                      onSetPenHighlighterUIMode(newMode);
                      localStorage.setItem('penHighlighterUIMode', newMode);
                    }}
                    title={penHighlighterUIMode === 'slider' ? 'Switch to compact dropdown' : 'Switch to slider'}
                    style={{ padding: '2px 5px', fontSize: '10px', background: '#444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', marginLeft: '2px' }}
                  >
                    {penHighlighterUIMode === 'slider' ? '▼' : '≡'}
                  </button>
                </div>
                <button 
                  className="set-default-btn"
                  onClick={(e) => {
                    const btn = e.target;
                    const defaults = { color: selectedMarkup.color, strokeWidth: selectedMarkup.strokeWidth, opacity: selectedMarkup.opacity };
                    localStorage.setItem('markup_highlighter_defaults', JSON.stringify(defaults));
                    btn.textContent = '✓';
                    btn.style.background = '#27ae60';
                    setTimeout(() => { btn.textContent = '☆ Default'; btn.style.background = ''; }, 1500);
                  }}
                  title="Save current settings as default"
                >
                  ☆ Default
                </button>
              </>
            )}
            
            {/* Arrow selected options */}
            {selectedMarkup.type === 'arrow' && (
              <>
                <div className="tool-option">
                  <label>Color:</label>
                  <input 
                    type="color" 
                    value={selectedMarkup.color || '#ff0000'}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { color: e.target.value })}
                  />
                </div>
                <div className="tool-option">
                  <label>Size:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="1" 
                        max="8" 
                        value={selectedMarkup.strokeWidth || 2}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                        style={{ width: '80px' }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={selectedMarkup.strokeWidth || 2}
                        key={`sel-arrow-size-${selectedMarkup.id}-${selectedMarkup.strokeWidth}`}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 1) updateMarkupProperties(selectedMarkup.id, { strokeWidth: 1 });
                          else if (num > 8) updateMarkupProperties(selectedMarkup.id, { strokeWidth: 8 });
                          else updateMarkupProperties(selectedMarkup.id, { strokeWidth: num });
                        }}
                      />
                      <span>px</span>
                    </>
                  ) : (
                    <select
                      value={selectedMarkup.strokeWidth || 2}
                      onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                      style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                        <option key={size} value={size}>{size}px</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="tool-option">
                  <label>Style:</label>
                  {renderLineStyleSelect(
                    selectedMarkup.lineStyle || 'solid',
                    (e) => updateMarkupProperties(selectedMarkup.id, { lineStyle: e.target.value }),
                    false,
                    selectedMarkup,
                    'selected'
                  )}
                </div>
                <div className="tool-option">
                  <label>Head:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="6" 
                        max="30"
                        value={selectedMarkup.arrowHeadSize || 12}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { arrowHeadSize: parseInt(e.target.value) })}
                        style={{ width: '80px' }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={selectedMarkup.arrowHeadSize || 12}
                        key={`sel-arrow-head-${selectedMarkup.id}-${selectedMarkup.arrowHeadSize}`}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 6) updateMarkupProperties(selectedMarkup.id, { arrowHeadSize: 6 });
                          else if (num > 30) updateMarkupProperties(selectedMarkup.id, { arrowHeadSize: 30 });
                          else updateMarkupProperties(selectedMarkup.id, { arrowHeadSize: num });
                        }}
                      />
                      <span>px</span>
                    </>
                  ) : (
                    <select
                      value={selectedMarkup.arrowHeadSize || 12}
                      onChange={(e) => updateMarkupProperties(selectedMarkup.id, { arrowHeadSize: parseInt(e.target.value) })}
                      style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                    >
                      {[6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 30].map(size => (
                        <option key={size} value={size}>{size}px</option>
                      ))}
                    </select>
                  )}
                  <button 
                    className="ui-mode-toggle"
                    onClick={() => {
                      const newMode = penHighlighterUIMode === 'slider' ? 'compact' : 'slider';
                      onSetPenHighlighterUIMode(newMode);
                      localStorage.setItem('penHighlighterUIMode', newMode);
                    }}
                    title={penHighlighterUIMode === 'slider' ? 'Switch to compact dropdown' : 'Switch to slider'}
                    style={{ padding: '2px 5px', fontSize: '10px', background: '#444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', marginLeft: '2px' }}
                  >
                    {penHighlighterUIMode === 'slider' ? '▼' : '≡'}
                  </button>
                </div>
                <button 
                  className="set-default-btn"
                  onClick={(e) => {
                    const btn = e.target;
                    const defaults = { color: selectedMarkup.color, strokeWidth: selectedMarkup.strokeWidth, arrowHeadSize: selectedMarkup.arrowHeadSize, lineStyle: selectedMarkup.lineStyle };
                    localStorage.setItem('markup_arrow_defaults', JSON.stringify(defaults));
                    btn.textContent = '✓';
                    btn.style.background = '#27ae60';
                    setTimeout(() => { btn.textContent = '☆ Default'; btn.style.background = ''; }, 1500);
                  }}
                  title="Save current settings as default"
                >
                  ☆ Default
                </button>
              </>
            )}
            
            {/* Line selected options */}
            {selectedMarkup.type === 'line' && (
              <>
                <div className="tool-option">
                  <label>Color:</label>
                  <input 
                    type="color" 
                    value={selectedMarkup.color || '#ff0000'}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { color: e.target.value })}
                  />
                </div>
                <div className="tool-option">
                  <label>Size:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="1" 
                        max="8" 
                        value={selectedMarkup.strokeWidth || 2}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                        style={{ width: '80px' }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={selectedMarkup.strokeWidth || 2}
                        key={`sel-line-size-${selectedMarkup.id}-${selectedMarkup.strokeWidth}`}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 1) updateMarkupProperties(selectedMarkup.id, { strokeWidth: 1 });
                          else if (num > 8) updateMarkupProperties(selectedMarkup.id, { strokeWidth: 8 });
                          else updateMarkupProperties(selectedMarkup.id, { strokeWidth: num });
                        }}
                      />
                      <span>px</span>
                    </>
                  ) : (
                    <select
                      value={selectedMarkup.strokeWidth || 2}
                      onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                      style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                        <option key={size} value={size}>{size}px</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="tool-option">
                  <label>Style:</label>
                  {renderLineStyleSelect(
                    selectedMarkup.lineStyle || 'solid',
                    (e) => updateMarkupProperties(selectedMarkup.id, { lineStyle: e.target.value }),
                    false,
                    selectedMarkup,
                    'selected'
                  )}
                  <button 
                    className="ui-mode-toggle"
                    onClick={() => {
                      const newMode = penHighlighterUIMode === 'slider' ? 'compact' : 'slider';
                      onSetPenHighlighterUIMode(newMode);
                      localStorage.setItem('penHighlighterUIMode', newMode);
                    }}
                    title={penHighlighterUIMode === 'slider' ? 'Switch to compact dropdown' : 'Switch to slider'}
                    style={{ padding: '2px 5px', fontSize: '10px', background: '#444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', marginLeft: '2px' }}
                  >
                    {penHighlighterUIMode === 'slider' ? '▼' : '≡'}
                  </button>
                </div>
                <button 
                  className="set-default-btn"
                  onClick={(e) => {
                    const btn = e.target;
                    const defaults = { color: selectedMarkup.color, strokeWidth: selectedMarkup.strokeWidth, lineStyle: selectedMarkup.lineStyle };
                    localStorage.setItem('markup_line_defaults', JSON.stringify(defaults));
                    btn.textContent = '✓';
                    btn.style.background = '#27ae60';
                    setTimeout(() => { btn.textContent = '☆ Default'; btn.style.background = ''; }, 1500);
                  }}
                  title="Save current settings as default"
                >
                  ☆ Default
                </button>
              </>
            )}
            
            {/* Color for arc, cloud, cloudPolyline (not pen/highlighter/arrow/line) */}
            {selectedMarkup.type === 'arc' && (
              <div className="tool-option">
                <label>Color:</label>
                <input 
                  type="color" 
                  value={selectedMarkup.color || '#ff0000'}
                  onChange={(e) => updateMarkupProperties(selectedMarkup.id, { color: e.target.value })}
                />
              </div>
            )}
            
            {/* Stroke width for arc only (cloud and cloudPolyline have their own sections) */}
            {selectedMarkup.type === 'arc' && (
              <div className="tool-option">
                <label>Width:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="1" 
                      max={selectedMarkup.type === 'cloud' ? '8' : '10'}
                      value={selectedMarkup.strokeWidth || 3}
                      onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                      style={{ width: '80px' }}
                    />
                    <input 
                      type="text"
                      className="manual-input"
                      defaultValue={selectedMarkup.strokeWidth || 3}
                      key={`sel-size-${selectedMarkup.id}-${selectedMarkup.strokeWidth}`}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                      onBlur={(e) => {
                        const num = parseInt(e.target.value);
                        const max = selectedMarkup.type === 'cloud' ? 8 : 10;
                        if (isNaN(num) || num < 1) updateMarkupProperties(selectedMarkup.id, { strokeWidth: 1 });
                        else if (num > max) updateMarkupProperties(selectedMarkup.id, { strokeWidth: max });
                        else updateMarkupProperties(selectedMarkup.id, { strokeWidth: num });
                      }}
                    />
                    <span>px</span>
                  </>
                ) : (
                  <select
                    value={selectedMarkup.strokeWidth || 3}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                    style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                )}
              </div>
            )}
            
            {/* Line style for arc only (arrow and line have their own sections now) */}
            {selectedMarkup.type === 'arc' && (
              <div className="tool-option">
                <label>Style:</label>
                {renderLineStyleSelect(
                  selectedMarkup.lineStyle || 'solid',
                  (e) => updateMarkupProperties(selectedMarkup.id, { lineStyle: e.target.value }),
                  false,
                  selectedMarkup,
                  'selected'
                )}
              </div>
            )}
            
            {/* Arc controls */}
            {selectedMarkup.type === 'arc' && (
              <>
                <div className="tool-option">
                  <label>Bulge:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="-2" 
                        max="2" 
                        step="0.1"
                        value={selectedMarkup.arcBulge !== undefined ? selectedMarkup.arcBulge : 0.5}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { arcBulge: parseFloat(e.target.value) })}
                        style={{ width: '80px' }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={(selectedMarkup.arcBulge !== undefined ? selectedMarkup.arcBulge : 0.5).toFixed(1)}
                        key={`sel-arc-bulge-${selectedMarkup.id}-${selectedMarkup.arcBulge}`}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          let num = parseFloat(e.target.value);
                          if (isNaN(num)) num = 0.5;
                          if (num < -2) num = -2;
                          if (num > 2) num = 2;
                          updateMarkupProperties(selectedMarkup.id, { arcBulge: num });
                        }}
                      />
                    </>
                  ) : (
                    <select
                      value={Math.round((selectedMarkup.arcBulge !== undefined ? selectedMarkup.arcBulge : 0.5) * 10) / 10}
                      onChange={(e) => updateMarkupProperties(selectedMarkup.id, { arcBulge: parseFloat(e.target.value) })}
                      style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                    >
                      {[-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2].map(v => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="tool-option">
                  <label>Opacity:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="0.1" 
                        max="1" 
                        step="0.1"
                        value={selectedMarkup.strokeOpacity !== undefined ? selectedMarkup.strokeOpacity : 1}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeOpacity: parseFloat(e.target.value) })}
                        style={{ width: '80px' }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={Math.round((selectedMarkup.strokeOpacity !== undefined ? selectedMarkup.strokeOpacity : 1) * 100)}
                        key={`sel-arc-opacity-${selectedMarkup.id}-${selectedMarkup.strokeOpacity}`}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 10) updateMarkupProperties(selectedMarkup.id, { strokeOpacity: 0.1 });
                          else if (num > 100) updateMarkupProperties(selectedMarkup.id, { strokeOpacity: 1 });
                          else updateMarkupProperties(selectedMarkup.id, { strokeOpacity: num / 100 });
                        }}
                      />
                      <span>%</span>
                    </>
                  ) : (
                    <>
                      <input 
                        type="number"
                        min="10"
                        max="100"
                        step="10"
                        value={Math.round((selectedMarkup.strokeOpacity !== undefined ? selectedMarkup.strokeOpacity : 1) * 100)}
                        onChange={(e) => {
                          const num = parseInt(e.target.value);
                          if (!isNaN(num)) {
                            if (num < 10) updateMarkupProperties(selectedMarkup.id, { strokeOpacity: 0.1 });
                            else if (num > 100) updateMarkupProperties(selectedMarkup.id, { strokeOpacity: 1 });
                            else updateMarkupProperties(selectedMarkup.id, { strokeOpacity: num / 100 });
                          }
                        }}
                        style={{ width: '55px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px' }}
                      />
                      <span>%</span>
                    </>
                  )}
                  <button 
                    className="ui-mode-toggle"
                    onClick={() => {
                      const newMode = penHighlighterUIMode === 'slider' ? 'compact' : 'slider';
                      onSetPenHighlighterUIMode(newMode);
                      localStorage.setItem('penHighlighterUIMode', newMode);
                    }}
                    title={penHighlighterUIMode === 'slider' ? 'Switch to compact dropdown' : 'Switch to slider'}
                    style={{ padding: '2px 5px', fontSize: '10px', background: '#444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', marginLeft: '2px' }}
                  >
                    {penHighlighterUIMode === 'slider' ? '▼' : '≡'}
                  </button>
                </div>
              </>
            )}
            
            {/* Cloud polyline options */}
            {selectedMarkup.type === 'cloudPolyline' && (
              <>
                <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
                <div className="tool-option">
                  <label>Color:</label>
                  {selectedMarkup.closed && (
                    <button 
                      title="No line" className={`fill-toggle ${selectedMarkup.color === 'none' ? 'active' : ''}`}
                      onClick={() => updateMarkupProperties(selectedMarkup.id, { color: selectedMarkup.color === 'none' ? '#ff0000' : 'none' })}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg>
                    </button>
                  )}
                  <input 
                    type="color" 
                    value={selectedMarkup.color === 'none' ? '#ff0000' : (selectedMarkup.color || '#ff0000')}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { color: e.target.value })}
                    style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}
                  />
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}>
                  <label>Width:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="1" 
                        max="8"
                        value={selectedMarkup.strokeWidth || 2}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                        disabled={selectedMarkup.color === 'none'}
                        style={{ width: '80px' }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={selectedMarkup.strokeWidth || 2}
                        key={`sel-cloudpoly-width-${selectedMarkup.id}-${selectedMarkup.strokeWidth}`}
                        disabled={selectedMarkup.color === 'none'}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 1) updateMarkupProperties(selectedMarkup.id, { strokeWidth: 1 });
                          else if (num > 8) updateMarkupProperties(selectedMarkup.id, { strokeWidth: 8 });
                          else updateMarkupProperties(selectedMarkup.id, { strokeWidth: num });
                        }}
                      />
                      <span>px</span>
                    </>
                  ) : (
                    <select
                      value={selectedMarkup.strokeWidth || 2}
                      onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                      disabled={selectedMarkup.color === 'none'}
                      style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                        <option key={size} value={size}>{size}px</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}>
                  <label>Opacity:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="0.1" 
                        max="1" 
                        step="0.1"
                        value={selectedMarkup.strokeOpacity !== undefined ? selectedMarkup.strokeOpacity : 1}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeOpacity: parseFloat(e.target.value) })}
                        disabled={selectedMarkup.color === 'none'}
                        style={{ width: '80px' }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={Math.round((selectedMarkup.strokeOpacity !== undefined ? selectedMarkup.strokeOpacity : 1) * 100)}
                        key={`sel-cloudpoly-stroke-opacity-${selectedMarkup.id}-${selectedMarkup.strokeOpacity}`}
                        disabled={selectedMarkup.color === 'none'}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 10) updateMarkupProperties(selectedMarkup.id, { strokeOpacity: 0.1 });
                          else if (num > 100) updateMarkupProperties(selectedMarkup.id, { strokeOpacity: 1 });
                          else updateMarkupProperties(selectedMarkup.id, { strokeOpacity: num / 100 });
                        }}
                      />
                      <span>%</span>
                    </>
                  ) : (
                    <>
                      <input 
                        type="number"
                        min="10"
                        max="100"
                        step="10"
                        value={Math.round((selectedMarkup.strokeOpacity !== undefined ? selectedMarkup.strokeOpacity : 1) * 100)}
                        disabled={selectedMarkup.color === 'none'}
                        onChange={(e) => {
                          const num = parseInt(e.target.value);
                          if (!isNaN(num)) {
                            if (num < 10) updateMarkupProperties(selectedMarkup.id, { strokeOpacity: 0.1 });
                            else if (num > 100) updateMarkupProperties(selectedMarkup.id, { strokeOpacity: 1 });
                            else updateMarkupProperties(selectedMarkup.id, { strokeOpacity: num / 100 });
                          }
                        }}
                        style={{ width: '55px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px' }}
                      />
                      <span>%</span>
                    </>
                  )}
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}>
                  <label>Arc:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="4" 
                        max="40" 
                        step="1"
                        value={selectedMarkup.arcSize !== undefined ? selectedMarkup.arcSize : 15}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { arcSize: parseInt(e.target.value) })}
                        disabled={selectedMarkup.color === 'none'}
                        style={{ width: '80px' }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={selectedMarkup.arcSize !== undefined ? selectedMarkup.arcSize : 15}
                        key={`sel-cloudpoly-arcsize-${selectedMarkup.id}-${selectedMarkup.arcSize}`}
                        disabled={selectedMarkup.color === 'none'}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 4) updateMarkupProperties(selectedMarkup.id, { arcSize: 4 });
                          else if (num > 40) updateMarkupProperties(selectedMarkup.id, { arcSize: 40 });
                          else updateMarkupProperties(selectedMarkup.id, { arcSize: num });
                        }}
                      />
                      <span>px</span>
                    </>
                  ) : (
                    <select
                      value={selectedMarkup.arcSize !== undefined ? selectedMarkup.arcSize : 15}
                      onChange={(e) => updateMarkupProperties(selectedMarkup.id, { arcSize: parseInt(e.target.value) })}
                      disabled={selectedMarkup.color === 'none'}
                      style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                    >
                      {[4, 6, 8, 10, 12, 14, 15, 16, 18, 20, 24, 28, 32, 36, 40].map(size => (
                        <option key={size} value={size}>{size}px</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}>
                  <label>Invert:</label>
                  <button 
                    className={`fill-toggle ${selectedMarkup.inverted ? 'active' : ''}`}
                    onClick={() => updateMarkupProperties(selectedMarkup.id, { inverted: !selectedMarkup.inverted })}
                    disabled={selectedMarkup.color === 'none'}
                    title="Flip bumps direction"
                  >
                    {selectedMarkup.inverted ? '↘↙' : '↗↖'}
                  </button>
                </div>
                <span style={{ color: '#666', margin: '0 4px' }}>|</span>
                <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
                <div className="tool-option">
                  <label>Color:</label>
                  <button 
                    title="No fill" className={`fill-toggle ${selectedMarkup.fillColor === 'none' ? 'active' : ''}`}
                    onClick={() => updateMarkupProperties(selectedMarkup.id, { fillColor: 'none' })}
                  ><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg></button>
                  <input 
                    type="color" 
                    value={selectedMarkup.fillColor === 'none' || selectedMarkup.fillColor === 'white' ? '#ffffff' : (selectedMarkup.fillColor || '#ffffff')}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { fillColor: e.target.value })}
                    style={{ opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}
                  />
                </div>
                <div className="tool-option">
                  <label>Opacity:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="0.1" 
                        max="1" 
                        step="0.1"
                        value={selectedMarkup.fillOpacity !== undefined ? selectedMarkup.fillOpacity : 0.3}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { fillOpacity: parseFloat(e.target.value) })}
                        disabled={selectedMarkup.fillColor === 'none'}
                        style={{ width: '80px', opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={Math.round((selectedMarkup.fillOpacity !== undefined ? selectedMarkup.fillOpacity : 0.3) * 100)}
                        key={`sel-cloudpoly-fill-opacity-${selectedMarkup.id}-${selectedMarkup.fillOpacity}`}
                        disabled={selectedMarkup.fillColor === 'none'}
                        style={{ opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 10) updateMarkupProperties(selectedMarkup.id, { fillOpacity: 0.1 });
                          else if (num > 100) updateMarkupProperties(selectedMarkup.id, { fillOpacity: 1 });
                          else updateMarkupProperties(selectedMarkup.id, { fillOpacity: num / 100 });
                        }}
                      />
                      <span>%</span>
                    </>
                  ) : (
                    <>
                      <input 
                        type="number"
                        min="10"
                        max="100"
                        step="10"
                        value={Math.round((selectedMarkup.fillOpacity !== undefined ? selectedMarkup.fillOpacity : 0.3) * 100)}
                        disabled={selectedMarkup.fillColor === 'none'}
                        onChange={(e) => {
                          const num = parseInt(e.target.value);
                          if (!isNaN(num)) {
                            if (num < 10) updateMarkupProperties(selectedMarkup.id, { fillOpacity: 0.1 });
                            else if (num > 100) updateMarkupProperties(selectedMarkup.id, { fillOpacity: 1 });
                            else updateMarkupProperties(selectedMarkup.id, { fillOpacity: num / 100 });
                          }
                        }}
                        style={{ width: '55px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px', opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}
                      />
                      <span>%</span>
                    </>
                  )}
                  <button 
                    className="ui-mode-toggle"
                    onClick={() => {
                      const newMode = penHighlighterUIMode === 'slider' ? 'compact' : 'slider';
                      onSetPenHighlighterUIMode(newMode);
                      localStorage.setItem('penHighlighterUIMode', newMode);
                    }}
                    title={penHighlighterUIMode === 'slider' ? 'Switch to compact dropdown' : 'Switch to slider'}
                    style={{ padding: '2px 5px', fontSize: '10px', background: '#444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', marginLeft: '2px' }}
                  >
                    {penHighlighterUIMode === 'slider' ? '▼' : '≡'}
                  </button>
                </div>
                <div className="tool-option">
                  <label>Shape:</label>
                  <button 
                    className={`fill-toggle ${selectedMarkup.closed ? 'active' : ''}`}
                    onClick={() => updateMarkupProperties(selectedMarkup.id, { closed: !selectedMarkup.closed })}
                    title={selectedMarkup.closed ? "Open the shape" : "Close the shape"}
                  >
                    {selectedMarkup.closed ? '◯ Closed' : '⌒ Open'}
                  </button>
                </div>
                <button 
                  className="set-default-btn"
                  onClick={(e) => {
                    const btn = e.target;
                    const defaults = { 
                      color: selectedMarkup.color, 
                      strokeWidth: selectedMarkup.strokeWidth,
                      strokeOpacity: selectedMarkup.strokeOpacity,
                      fillColor: selectedMarkup.fillColor,
                      fillOpacity: selectedMarkup.fillOpacity,
                      arcSize: selectedMarkup.arcSize,
                      inverted: selectedMarkup.inverted
                    };
                    localStorage.setItem('markup_cloudPolyline_defaults', JSON.stringify(defaults));
                    btn.textContent = '✓';
                    btn.style.background = '#27ae60';
                    setTimeout(() => {
                      btn.textContent = '☆ Default';
                      btn.style.background = '';
                    }, 1500);
                  }}
                  title="Save current settings as default"
                >
                  ☆ Default
                </button>
              </>
            )}
            
            {/* Polyline options - full toolbar matching drawing mode */}
            {(selectedMarkup.type === 'polyline') && (
              <>
                <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
                <div className="tool-option">
                  <label>Color:</label>
                  {selectedMarkup.closed && (
                    <button 
                      title="No line" className={`fill-toggle ${selectedMarkup.color === 'none' ? 'active' : ''}`}
                      onClick={() => updateMarkupProperties(selectedMarkup.id, { color: selectedMarkup.color === 'none' ? '#ff0000' : 'none' })}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg>
                    </button>
                  )}
                  <input 
                    type="color" 
                    value={selectedMarkup.color === 'none' ? '#ff0000' : (selectedMarkup.color || '#ff0000')}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { color: e.target.value })}
                    style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}
                  />
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}>
                  <label>Width:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="1" 
                        max="8" 
                        value={selectedMarkup.strokeWidth || 2}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                        disabled={selectedMarkup.color === 'none'}
                        style={{ width: '80px' }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={selectedMarkup.strokeWidth || 2}
                        key={`sel-polyline-width-${selectedMarkup.id}-${selectedMarkup.strokeWidth}`}
                        disabled={selectedMarkup.color === 'none'}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 1) updateMarkupProperties(selectedMarkup.id, { strokeWidth: 1 });
                          else if (num > 8) updateMarkupProperties(selectedMarkup.id, { strokeWidth: 8 });
                          else updateMarkupProperties(selectedMarkup.id, { strokeWidth: num });
                        }}
                      />
                      <span>px</span>
                    </>
                  ) : (
                    <select
                      value={selectedMarkup.strokeWidth || 2}
                      onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                      disabled={selectedMarkup.color === 'none'}
                      style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                        <option key={size} value={size}>{size}px</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}>
                  <label>Opacity:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="0.1" 
                        max="1" 
                        step="0.1"
                        value={selectedMarkup.strokeOpacity !== undefined ? selectedMarkup.strokeOpacity : 1}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeOpacity: parseFloat(e.target.value) })}
                        disabled={selectedMarkup.color === 'none'}
                        style={{ width: '80px' }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={Math.round((selectedMarkup.strokeOpacity !== undefined ? selectedMarkup.strokeOpacity : 1) * 100)}
                        key={`sel-polyline-stroke-opacity-${selectedMarkup.id}-${selectedMarkup.strokeOpacity}`}
                        disabled={selectedMarkup.color === 'none'}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 10) updateMarkupProperties(selectedMarkup.id, { strokeOpacity: 0.1 });
                          else if (num > 100) updateMarkupProperties(selectedMarkup.id, { strokeOpacity: 1 });
                          else updateMarkupProperties(selectedMarkup.id, { strokeOpacity: num / 100 });
                        }}
                      />
                      <span>%</span>
                    </>
                  ) : (
                    <>
                      <input 
                        type="number"
                        min="10"
                        max="100"
                        step="10"
                        value={Math.round((selectedMarkup.strokeOpacity !== undefined ? selectedMarkup.strokeOpacity : 1) * 100)}
                        disabled={selectedMarkup.color === 'none'}
                        onChange={(e) => {
                          const num = parseInt(e.target.value);
                          if (!isNaN(num)) {
                            if (num < 10) updateMarkupProperties(selectedMarkup.id, { strokeOpacity: 0.1 });
                            else if (num > 100) updateMarkupProperties(selectedMarkup.id, { strokeOpacity: 1 });
                            else updateMarkupProperties(selectedMarkup.id, { strokeOpacity: num / 100 });
                          }
                        }}
                        style={{ width: '55px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px' }}
                      />
                      <span>%</span>
                    </>
                  )}
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}>
                  <label>Style:</label>
                  {renderLineStyleSelect(
                    selectedMarkup.lineStyle || 'solid',
                    (e) => updateMarkupProperties(selectedMarkup.id, { lineStyle: e.target.value }),
                    selectedMarkup.color === 'none',
                    selectedMarkup,
                    'selected'
                  )}
                </div>
                <span style={{ color: '#666', margin: '0 4px' }}>|</span>
                <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
                <div className="tool-option">
                  <label>Color:</label>
                  <button 
                    title="No fill" className={`fill-toggle ${selectedMarkup.fillColor === 'none' ? 'active' : ''}`}
                    onClick={() => updateMarkupProperties(selectedMarkup.id, { fillColor: 'none' })}
                  ><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg></button>
                  <input 
                    type="color" 
                    value={selectedMarkup.fillColor === 'none' ? '#ffffff' : (selectedMarkup.fillColor === 'white' ? '#ffffff' : (selectedMarkup.fillColor || '#ffffff'))}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { fillColor: e.target.value })}
                    style={{ opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}
                  />
                </div>
                <div className="tool-option">
                  <label>Opacity:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="0.1" 
                        max="1" 
                        step="0.1"
                        value={selectedMarkup.fillOpacity !== undefined ? selectedMarkup.fillOpacity : 0.3}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { fillOpacity: parseFloat(e.target.value) })}
                        disabled={selectedMarkup.fillColor === 'none'}
                        style={{ width: '80px', opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={Math.round((selectedMarkup.fillOpacity !== undefined ? selectedMarkup.fillOpacity : 0.3) * 100)}
                        key={`sel-polyline-fill-opacity-${selectedMarkup.id}-${selectedMarkup.fillOpacity}`}
                        disabled={selectedMarkup.fillColor === 'none'}
                        style={{ opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 10) updateMarkupProperties(selectedMarkup.id, { fillOpacity: 0.1 });
                          else if (num > 100) updateMarkupProperties(selectedMarkup.id, { fillOpacity: 1 });
                          else updateMarkupProperties(selectedMarkup.id, { fillOpacity: num / 100 });
                        }}
                      />
                      <span>%</span>
                    </>
                  ) : (
                    <>
                      <input 
                        type="number"
                        min="10"
                        max="100"
                        step="10"
                        value={Math.round((selectedMarkup.fillOpacity !== undefined ? selectedMarkup.fillOpacity : 0.3) * 100)}
                        disabled={selectedMarkup.fillColor === 'none'}
                        onChange={(e) => {
                          const num = parseInt(e.target.value);
                          if (!isNaN(num)) {
                            if (num < 10) updateMarkupProperties(selectedMarkup.id, { fillOpacity: 0.1 });
                            else if (num > 100) updateMarkupProperties(selectedMarkup.id, { fillOpacity: 1 });
                            else updateMarkupProperties(selectedMarkup.id, { fillOpacity: num / 100 });
                          }
                        }}
                        style={{ width: '55px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px', opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}
                      />
                      <span>%</span>
                    </>
                  )}
                  <button 
                    className="ui-mode-toggle"
                    onClick={() => {
                      const newMode = penHighlighterUIMode === 'slider' ? 'compact' : 'slider';
                      onSetPenHighlighterUIMode(newMode);
                      localStorage.setItem('penHighlighterUIMode', newMode);
                    }}
                    title={penHighlighterUIMode === 'slider' ? 'Switch to compact dropdown' : 'Switch to slider'}
                    style={{ padding: '2px 5px', fontSize: '10px', background: '#444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', marginLeft: '2px' }}
                  >
                    {penHighlighterUIMode === 'slider' ? '▼' : '≡'}
                  </button>
                </div>
                <div className="tool-option">
                  <label>Shape:</label>
                  <button 
                    className={`fill-toggle ${selectedMarkup.closed ? 'active' : ''}`}
                    onClick={() => updateMarkupProperties(selectedMarkup.id, { closed: !selectedMarkup.closed })}
                    title={selectedMarkup.closed ? "Open the shape" : "Close the shape"}
                  >
                    {selectedMarkup.closed ? '◯ Closed' : '⌒ Open'}
                  </button>
                </div>
                <button 
                  className="set-default-btn"
                  onClick={(e) => {
                    const btn = e.target;
                    const defaults = { 
                      color: selectedMarkup.color, 
                      strokeWidth: selectedMarkup.strokeWidth,
                      strokeOpacity: selectedMarkup.strokeOpacity,
                      fillColor: selectedMarkup.fillColor,
                      fillOpacity: selectedMarkup.fillOpacity,
                      lineStyle: selectedMarkup.lineStyle
                    };
                    localStorage.setItem('markup_polyline_defaults', JSON.stringify(defaults));
                    btn.textContent = '✓';
                    btn.style.background = '#27ae60';
                    setTimeout(() => {
                      btn.textContent = '☆ Default';
                      btn.style.background = '';
                    }, 1500);
                  }}
                  title="Save current settings as default"
                >
                  ☆ Default
                </button>
              </>
            )}
            
            {/* Polygon options - closed shape loaded from PDF */}
            {(selectedMarkup.type === 'polygon') && (
              <>
                <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
                <div className="tool-option">
                  <label>Color:</label>
                  <input 
                    type="color" 
                    value={selectedMarkup.color || '#ff0000'}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { color: e.target.value })}
                  />
                </div>
                <div className="tool-option">
                  <label>Width:</label>
                  <select
                    value={selectedMarkup.strokeWidth || 2}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                    style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                </div>
                <div className="tool-option">
                  <label>Opacity:</label>
                  <input 
                    type="number"
                    min="10"
                    max="100"
                    step="10"
                    value={Math.round((selectedMarkup.strokeOpacity !== undefined ? selectedMarkup.strokeOpacity : 1) * 100)}
                    onChange={(e) => {
                      const num = parseInt(e.target.value);
                      if (!isNaN(num)) {
                        if (num < 10) updateMarkupProperties(selectedMarkup.id, { strokeOpacity: 0.1 });
                        else if (num > 100) updateMarkupProperties(selectedMarkup.id, { strokeOpacity: 1 });
                        else updateMarkupProperties(selectedMarkup.id, { strokeOpacity: num / 100 });
                      }
                    }}
                    style={{ width: '55px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px' }}
                  />
                  <span>%</span>
                </div>
                <div className="tool-option">
                  <label>Style:</label>
                  {renderLineStyleSelect(
                    selectedMarkup.lineStyle || 'solid',
                    (e) => updateMarkupProperties(selectedMarkup.id, { lineStyle: e.target.value }),
                    false,
                    selectedMarkup,
                    'selected'
                  )}
                </div>
                <span style={{ color: '#666', margin: '0 4px' }}>|</span>
                <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
                <div className="tool-option">
                  <label>Color:</label>
                  <button 
                    title="No fill" className={`fill-toggle ${selectedMarkup.fillColor === 'none' ? 'active' : ''}`}
                    onClick={() => updateMarkupProperties(selectedMarkup.id, { fillColor: 'none' })}
                  ><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg></button>
                  <input 
                    type="color" 
                    value={selectedMarkup.fillColor === 'none' ? '#ffffff' : (selectedMarkup.fillColor === 'white' ? '#ffffff' : (selectedMarkup.fillColor || '#ffffff'))}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { fillColor: e.target.value })}
                    style={{ opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}
                  />
                </div>
                <div className="tool-option">
                  <label>Opacity:</label>
                  <input 
                    type="number"
                    min="10"
                    max="100"
                    step="10"
                    value={Math.round((selectedMarkup.fillOpacity !== undefined ? selectedMarkup.fillOpacity : 1) * 100)}
                    disabled={selectedMarkup.fillColor === 'none'}
                    onChange={(e) => {
                      const num = parseInt(e.target.value);
                      if (!isNaN(num)) {
                        if (num < 10) updateMarkupProperties(selectedMarkup.id, { fillOpacity: 0.1 });
                        else if (num > 100) updateMarkupProperties(selectedMarkup.id, { fillOpacity: 1 });
                        else updateMarkupProperties(selectedMarkup.id, { fillOpacity: num / 100 });
                      }
                    }}
                    style={{ width: '55px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px', opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}
                  />
                  <span>%</span>
                </div>
              </>
            )}
            
            {/* Polyline Arrow options - full toolbar matching drawing mode */}
            {(selectedMarkup.type === 'polylineArrow') && (
              <>
                <div className="tool-option">
                  <label>Color:</label>
                  <input 
                    type="color" 
                    value={selectedMarkup.color || '#ff0000'}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { color: e.target.value })}
                  />
                </div>
                <div className="tool-option">
                  <label>Width:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="1" 
                        max="8" 
                        value={selectedMarkup.strokeWidth || 2}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                        style={{ width: '80px' }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={selectedMarkup.strokeWidth || 2}
                        key={`sel-polylinearrow-width-${selectedMarkup.id}-${selectedMarkup.strokeWidth}`}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 1) updateMarkupProperties(selectedMarkup.id, { strokeWidth: 1 });
                          else if (num > 8) updateMarkupProperties(selectedMarkup.id, { strokeWidth: 8 });
                          else updateMarkupProperties(selectedMarkup.id, { strokeWidth: num });
                        }}
                      />
                      <span>px</span>
                    </>
                  ) : (
                    <select
                      value={selectedMarkup.strokeWidth || 2}
                      onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                      style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                        <option key={size} value={size}>{size}px</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="tool-option">
                  <label>Head:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="6" 
                        max="30"
                        value={selectedMarkup.arrowHeadSize || 12}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { arrowHeadSize: parseInt(e.target.value) })}
                        style={{ width: '80px' }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={selectedMarkup.arrowHeadSize || 12}
                        key={`sel-polylinearrow-head-${selectedMarkup.id}-${selectedMarkup.arrowHeadSize}`}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 6) updateMarkupProperties(selectedMarkup.id, { arrowHeadSize: 6 });
                          else if (num > 30) updateMarkupProperties(selectedMarkup.id, { arrowHeadSize: 30 });
                          else updateMarkupProperties(selectedMarkup.id, { arrowHeadSize: num });
                        }}
                      />
                      <span>px</span>
                    </>
                  ) : (
                    <select
                      value={selectedMarkup.arrowHeadSize || 12}
                      onChange={(e) => updateMarkupProperties(selectedMarkup.id, { arrowHeadSize: parseInt(e.target.value) })}
                      style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                    >
                      {[6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 30].map(size => (
                        <option key={size} value={size}>{size}px</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="tool-option">
                  <label>Style:</label>
                  {renderLineStyleSelect(
                    selectedMarkup.lineStyle || 'solid',
                    (e) => updateMarkupProperties(selectedMarkup.id, { lineStyle: e.target.value }),
                    false,
                    selectedMarkup,
                    'selected'
                  )}
                  <button 
                    className="ui-mode-toggle"
                    onClick={() => {
                      const newMode = penHighlighterUIMode === 'slider' ? 'compact' : 'slider';
                      onSetPenHighlighterUIMode(newMode);
                      localStorage.setItem('penHighlighterUIMode', newMode);
                    }}
                    title={penHighlighterUIMode === 'slider' ? 'Switch to compact dropdown' : 'Switch to slider'}
                    style={{ padding: '2px 5px', fontSize: '10px', background: '#444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', marginLeft: '2px' }}
                  >
                    {penHighlighterUIMode === 'slider' ? '▼' : '≡'}
                  </button>
                </div>
                <div className="tool-option">
                  <label>Shape:</label>
                  <button 
                    className={`fill-toggle ${selectedMarkup.closed ? 'active' : ''}`}
                    onClick={() => updateMarkupProperties(selectedMarkup.id, { closed: !selectedMarkup.closed })}
                    title={selectedMarkup.closed ? "Open the shape" : "Close the shape (connects last point to first)"}
                  >
                    {selectedMarkup.closed ? '◯ Closed' : '⌒ Open'}
                  </button>
                </div>
                <button 
                  className="set-default-btn"
                  onClick={(e) => {
                    const btn = e.target;
                    const defaults = { 
                      color: selectedMarkup.color, 
                      strokeWidth: selectedMarkup.strokeWidth,
                      strokeOpacity: selectedMarkup.strokeOpacity,
                      arrowHeadSize: selectedMarkup.arrowHeadSize,
                      lineStyle: selectedMarkup.lineStyle
                    };
                    localStorage.setItem('markup_polylineArrow_defaults', JSON.stringify(defaults));
                    btn.textContent = '✓';
                    btn.style.background = '#27ae60';
                    setTimeout(() => {
                      btn.textContent = '☆ Default';
                      btn.style.background = '';
                    }, 1500);
                  }}
                  title="Save current settings as default"
                >
                  ☆ Default
                </button>
              </>
            )}
            
            {/* Rectangle options */}
            {selectedMarkup.type === 'rectangle' && (
              <>
                <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
                <div className="tool-option">
                  <label>Color:</label>
                  <button 
                    title="No line" className={`fill-toggle ${selectedMarkup.color === 'none' ? 'active' : ''}`}
                    onClick={() => updateMarkupProperties(selectedMarkup.id, { color: selectedMarkup.color === 'none' ? '#ff0000' : 'none' })}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg>
                  </button>
                  <input 
                    type="color" 
                    value={selectedMarkup.color === 'none' ? '#ff0000' : (selectedMarkup.color || '#ff0000')}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { color: e.target.value })}
                    style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}
                  />
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}>
                  <label>Width:</label>
                  <select
                    value={selectedMarkup.strokeWidth || 2}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                    disabled={selectedMarkup.color === 'none'}
                    style={{ padding: '2px 4px', fontSize: '11px', minWidth: '52px' }}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}>
                  <label>Opacity:</label>
                  <input 
                    type="number"
                    min="0"
                    max="100"
                    step="10"
                    value={Math.round((selectedMarkup.strokeOpacity !== undefined ? selectedMarkup.strokeOpacity : 1) * 100)}
                    disabled={selectedMarkup.color === 'none'}
                    onChange={(e) => {
                      const num = parseInt(e.target.value);
                      if (!isNaN(num)) {
                        updateMarkupProperties(selectedMarkup.id, { strokeOpacity: Math.min(1, Math.max(0, num / 100)) });
                      }
                    }}
                    style={{ width: '48px', padding: '2px 4px', fontSize: '11px', textAlign: 'center', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '3px' }}
                  />
                  <span>%</span>
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}>
                  <label>Style:</label>
                  {renderLineStyleSelect(
                    selectedMarkup.lineStyle || 'solid',
                    (e) => updateMarkupProperties(selectedMarkup.id, { lineStyle: e.target.value }),
                    selectedMarkup.color === 'none',
                    selectedMarkup,
                    'selected'
                  )}
                </div>
                <span style={{ color: '#666', margin: '0 4px' }}>|</span>
                <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
                <div className="tool-option">
                  <label>Color:</label>
                  <button 
                    title="No fill" className={`fill-toggle ${selectedMarkup.fillColor === 'none' ? 'active' : ''}`}
                    onClick={() => updateMarkupProperties(selectedMarkup.id, { fillColor: 'none' })}
                  ><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg></button>
                  <input 
                    type="color" 
                    value={selectedMarkup.fillColor === 'none' || selectedMarkup.fillColor === 'white' ? '#ffffff' : (selectedMarkup.fillColor || '#ffffff')}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { fillColor: e.target.value })}
                    style={{ opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}
                  />
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}>
                  <label>Opacity:</label>
                  <input 
                    type="number"
                    min="0"
                    max="100"
                    step="10"
                    value={Math.round((selectedMarkup.fillOpacity !== undefined ? selectedMarkup.fillOpacity : 0.3) * 100)}
                    disabled={selectedMarkup.fillColor === 'none'}
                    onChange={(e) => {
                      const num = parseInt(e.target.value);
                      if (!isNaN(num)) {
                        updateMarkupProperties(selectedMarkup.id, { fillOpacity: Math.min(1, Math.max(0, num / 100)) });
                      }
                    }}
                    style={{ width: '48px', padding: '2px 4px', fontSize: '11px', textAlign: 'center', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '3px' }}
                  />
                  <span>%</span>
                </div>
                <span style={{ color: '#666', margin: '0 4px' }}>|</span>
                <div className="tool-option">
                  <label>Rot:</label>
                  <input 
                    type="number"
                    min="-360"
                    max="360"
                    step="15"
                    value={Math.round(selectedMarkup.rotation || 0)}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { rotation: parseInt(e.target.value) || 0 })}
                    style={{ width: '54px', padding: '2px 4px', background: '#333', color: 'white', border: '1px solid #555', borderRadius: '3px', fontSize: '11px' }}
                  />
                  <span>°</span>
                  <button
                    onClick={() => updateMarkupProperties(selectedMarkup.id, { rotation: 0 })}
                    style={{ padding: '2px 6px', marginLeft: '2px', background: '#555', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}
                    title="Reset rotation"
                  >
                    ↺
                  </button>
                </div>
                <button 
                  className="set-default-btn"
                  onClick={(e) => {
                    const btn = e.target;
                    const defaults = { 
                      color: selectedMarkup.color, 
                      strokeWidth: selectedMarkup.strokeWidth,
                      fillColor: selectedMarkup.fillColor,
                      strokeOpacity: selectedMarkup.strokeOpacity,
                      fillOpacity: selectedMarkup.fillOpacity,
                      lineStyle: selectedMarkup.lineStyle,
                      rotation: selectedMarkup.rotation || 0
                    };
                    localStorage.setItem('markup_rectangle_defaults', JSON.stringify(defaults));
                    btn.textContent = '✓';
                    btn.style.background = '#27ae60';
                    setTimeout(() => { btn.textContent = '☆ Default'; btn.style.background = ''; }, 1500);
                  }}
                  title="Save current settings as default"
                >
                  ☆ Default
                </button>
              </>
            )}
            
            {/* Circle options */}
            {selectedMarkup.type === 'circle' && (
              <>
                <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
                <div className="tool-option">
                  <label>Color:</label>
                  <button 
                    title="No line" className={`fill-toggle ${selectedMarkup.color === 'none' ? 'active' : ''}`}
                    onClick={() => updateMarkupProperties(selectedMarkup.id, { color: selectedMarkup.color === 'none' ? '#ff0000' : 'none' })}
                  ><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg></button>
                  <input 
                    type="color" 
                    value={selectedMarkup.color === 'none' ? '#ff0000' : (selectedMarkup.color || '#ff0000')}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { color: e.target.value })}
                    style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}
                  />
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}>
                  <label>Width:</label>
                  <select
                    value={selectedMarkup.strokeWidth || 2}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                    disabled={selectedMarkup.color === 'none'}
                    style={{ padding: '2px 4px', fontSize: '11px', minWidth: '52px' }}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}>
                  <label>Opacity:</label>
                  <input 
                    type="number"
                    min="0"
                    max="100"
                    step="10"
                    value={Math.round((selectedMarkup.strokeOpacity !== undefined ? selectedMarkup.strokeOpacity : 1) * 100)}
                    disabled={selectedMarkup.color === 'none'}
                    onChange={(e) => {
                      const num = parseInt(e.target.value);
                      if (!isNaN(num)) {
                        updateMarkupProperties(selectedMarkup.id, { strokeOpacity: Math.min(1, Math.max(0, num / 100)) });
                      }
                    }}
                    style={{ width: '48px', padding: '2px 4px', fontSize: '11px', textAlign: 'center', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '3px' }}
                  />
                  <span>%</span>
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}>
                  <label>Style:</label>
                  {renderLineStyleSelect(
                    selectedMarkup.lineStyle || 'solid',
                    (e) => updateMarkupProperties(selectedMarkup.id, { lineStyle: e.target.value }),
                    selectedMarkup.color === 'none',
                    selectedMarkup,
                    'selected'
                  )}
                </div>
                <span style={{ color: '#666', margin: '0 4px' }}>|</span>
                <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
                <div className="tool-option">
                  <label>Color:</label>
                  <button 
                    title="No fill" className={`fill-toggle ${selectedMarkup.fillColor === 'none' ? 'active' : ''}`}
                    onClick={() => updateMarkupProperties(selectedMarkup.id, { fillColor: 'none' })}
                  ><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg></button>
                  <input 
                    type="color" 
                    value={selectedMarkup.fillColor === 'none' || selectedMarkup.fillColor === 'white' ? '#ffffff' : (selectedMarkup.fillColor || '#ffffff')}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { fillColor: e.target.value })}
                    style={{ opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}
                  />
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}>
                  <label>Opacity:</label>
                  <input 
                    type="number"
                    min="0"
                    max="100"
                    step="10"
                    value={Math.round((selectedMarkup.fillOpacity !== undefined ? selectedMarkup.fillOpacity : 0.3) * 100)}
                    disabled={selectedMarkup.fillColor === 'none'}
                    onChange={(e) => {
                      const num = parseInt(e.target.value);
                      if (!isNaN(num)) {
                        updateMarkupProperties(selectedMarkup.id, { fillOpacity: Math.min(1, Math.max(0, num / 100)) });
                      }
                    }}
                    style={{ width: '48px', padding: '2px 4px', fontSize: '11px', textAlign: 'center', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '3px' }}
                  />
                  <span>%</span>
                </div>
                <span style={{ color: '#666', margin: '0 4px' }}>|</span>
                <div className="tool-option">
                  <label>Rot:</label>
                  <input 
                    type="number"
                    min="-360"
                    max="360"
                    step="15"
                    value={Math.round(selectedMarkup.rotation || 0)}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { rotation: parseInt(e.target.value) || 0 })}
                    style={{ width: '54px', padding: '2px 4px', background: '#333', color: 'white', border: '1px solid #555', borderRadius: '3px', fontSize: '11px' }}
                  />
                  <span>°</span>
                  <button
                    onClick={() => updateMarkupProperties(selectedMarkup.id, { rotation: 0 })}
                    style={{ padding: '2px 6px', marginLeft: '2px', background: '#555', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}
                    title="Reset rotation"
                  >
                    ↺
                  </button>
                </div>
                <button 
                  className="set-default-btn"
                  onClick={(e) => {
                    const btn = e.target;
                    const defaults = { 
                      color: selectedMarkup.color, 
                      strokeWidth: selectedMarkup.strokeWidth,
                      fillColor: selectedMarkup.fillColor,
                      strokeOpacity: selectedMarkup.strokeOpacity,
                      fillOpacity: selectedMarkup.fillOpacity,
                      lineStyle: selectedMarkup.lineStyle,
                      rotation: selectedMarkup.rotation || 0
                    };
                    localStorage.setItem('markup_circle_defaults', JSON.stringify(defaults));
                    btn.textContent = '✓';
                    btn.style.background = '#27ae60';
                    setTimeout(() => { btn.textContent = '☆ Default'; btn.style.background = ''; }, 1500);
                  }}
                  title="Save current settings as default"
                >
                  ☆ Default
                </button>
              </>
            )}
            
            {/* Cloud options */}
            {selectedMarkup.type === 'cloud' && (
              <>
                <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
                <div className="tool-option">
                  <label>Color:</label>
                  <button 
                    title="No line" className={`fill-toggle ${selectedMarkup.color === 'none' ? 'active' : ''}`}
                    onClick={() => updateMarkupProperties(selectedMarkup.id, { color: selectedMarkup.color === 'none' ? '#ff0000' : 'none' })}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg>
                  </button>
                  <input 
                    type="color" 
                    value={selectedMarkup.color === 'none' ? '#ff0000' : (selectedMarkup.color || '#ff0000')}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { color: e.target.value })}
                    style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}
                  />
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}>
                  <label>Width:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="1" 
                        max="8"
                        value={selectedMarkup.strokeWidth || 2}
                        disabled={selectedMarkup.color === 'none'}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                        style={{ width: '80px' }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={selectedMarkup.strokeWidth || 2}
                        disabled={selectedMarkup.color === 'none'}
                        key={`sel-cloud-width-${selectedMarkup.id}-${selectedMarkup.strokeWidth}`}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 1) updateMarkupProperties(selectedMarkup.id, { strokeWidth: 1 });
                          else if (num > 8) updateMarkupProperties(selectedMarkup.id, { strokeWidth: 8 });
                          else updateMarkupProperties(selectedMarkup.id, { strokeWidth: num });
                        }}
                      />
                      <span>px</span>
                    </>
                  ) : (
                    <select
                      value={selectedMarkup.strokeWidth || 2}
                      disabled={selectedMarkup.color === 'none'}
                      onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeWidth: parseInt(e.target.value) })}
                      style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                        <option key={size} value={size}>{size}px</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}>
                  <label>Opacity:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="0.1" 
                        max="1" 
                        step="0.1"
                        value={selectedMarkup.strokeOpacity !== undefined ? selectedMarkup.strokeOpacity : 1}
                        disabled={selectedMarkup.color === 'none'}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { strokeOpacity: parseFloat(e.target.value) })}
                        style={{ width: '80px' }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={Math.round((selectedMarkup.strokeOpacity !== undefined ? selectedMarkup.strokeOpacity : 1) * 100)}
                        disabled={selectedMarkup.color === 'none'}
                        key={`sel-cloud-stroke-opacity-${selectedMarkup.id}-${selectedMarkup.strokeOpacity}`}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 10) updateMarkupProperties(selectedMarkup.id, { strokeOpacity: 0.1 });
                          else if (num > 100) updateMarkupProperties(selectedMarkup.id, { strokeOpacity: 1 });
                          else updateMarkupProperties(selectedMarkup.id, { strokeOpacity: num / 100 });
                        }}
                      />
                      <span>%</span>
                    </>
                  ) : (
                    <>
                      <input 
                        type="number"
                        min="10"
                        max="100"
                        step="10"
                        value={Math.round((selectedMarkup.strokeOpacity !== undefined ? selectedMarkup.strokeOpacity : 1) * 100)}
                        disabled={selectedMarkup.color === 'none'}
                        onChange={(e) => {
                          const num = parseInt(e.target.value);
                          if (!isNaN(num)) {
                            if (num < 10) updateMarkupProperties(selectedMarkup.id, { strokeOpacity: 0.1 });
                            else if (num > 100) updateMarkupProperties(selectedMarkup.id, { strokeOpacity: 1 });
                            else updateMarkupProperties(selectedMarkup.id, { strokeOpacity: num / 100 });
                          }
                        }}
                        style={{ width: '55px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px', opacity: selectedMarkup.color === 'none' ? 0.5 : 1 }}
                      />
                      <span>%</span>
                    </>
                  )}
                </div>
                <div className="tool-option">
                  <label>Arc:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="4" 
                        max="40" 
                        step="1"
                        value={selectedMarkup.arcSize !== undefined ? selectedMarkup.arcSize : 15}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { arcSize: parseInt(e.target.value) })}
                        style={{ width: '80px' }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={selectedMarkup.arcSize !== undefined ? selectedMarkup.arcSize : 15}
                        key={`sel-cloud-arcsize-${selectedMarkup.id}-${selectedMarkup.arcSize}`}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 4) updateMarkupProperties(selectedMarkup.id, { arcSize: 4 });
                          else if (num > 40) updateMarkupProperties(selectedMarkup.id, { arcSize: 40 });
                          else updateMarkupProperties(selectedMarkup.id, { arcSize: num });
                        }}
                      />
                      <span>px</span>
                    </>
                  ) : (
                    <select
                      value={selectedMarkup.arcSize !== undefined ? selectedMarkup.arcSize : 15}
                      onChange={(e) => updateMarkupProperties(selectedMarkup.id, { arcSize: parseInt(e.target.value) })}
                      style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                    >
                      {[4, 6, 8, 10, 12, 14, 15, 16, 18, 20, 24, 28, 32, 36, 40].map(size => (
                        <option key={size} value={size}>{size}px</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="tool-option">
                  <label>Invert:</label>
                  <button 
                    className={`fill-toggle ${selectedMarkup.inverted ? 'active' : ''}`}
                    onClick={() => updateMarkupProperties(selectedMarkup.id, { inverted: !selectedMarkup.inverted })}
                    title="Flip bumps direction (inward/outward)"
                  >
                    {selectedMarkup.inverted ? '↘↙' : '↗↖'}
                  </button>
                </div>
                <span style={{ color: '#666', margin: '0 4px' }}>|</span>
                <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
                <div className="tool-option">
                  <label>Color:</label>
                  <button 
                    title="No fill" className={`fill-toggle ${selectedMarkup.fillColor === 'none' ? 'active' : ''}`}
                    onClick={() => updateMarkupProperties(selectedMarkup.id, { fillColor: 'none' })}
                  ><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg></button>
                  <input 
                    type="color" 
                    value={selectedMarkup.fillColor === 'none' || selectedMarkup.fillColor === 'white' ? '#ffffff' : (selectedMarkup.fillColor || '#ffffff')}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { fillColor: e.target.value })}
                    style={{ opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}
                  />
                </div>
                <div className="tool-option">
                  <label>Opacity:</label>
                  {penHighlighterUIMode === 'slider' ? (
                    <>
                      <input 
                        type="range" 
                        min="0.1" 
                        max="1" 
                        step="0.1"
                        value={selectedMarkup.fillOpacity !== undefined ? selectedMarkup.fillOpacity : 0.3}
                        onChange={(e) => updateMarkupProperties(selectedMarkup.id, { fillOpacity: parseFloat(e.target.value) })}
                        disabled={selectedMarkup.fillColor === 'none'}
                        style={{ width: '80px', opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}
                      />
                      <input 
                        type="text"
                        className="manual-input"
                        defaultValue={Math.round((selectedMarkup.fillOpacity !== undefined ? selectedMarkup.fillOpacity : 0.3) * 100)}
                        key={`sel-cloud-fill-opacity-${selectedMarkup.id}-${selectedMarkup.fillOpacity}`}
                        disabled={selectedMarkup.fillColor === 'none'}
                        style={{ opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value);
                          if (isNaN(num) || num < 10) updateMarkupProperties(selectedMarkup.id, { fillOpacity: 0.1 });
                          else if (num > 100) updateMarkupProperties(selectedMarkup.id, { fillOpacity: 1 });
                          else updateMarkupProperties(selectedMarkup.id, { fillOpacity: num / 100 });
                        }}
                      />
                      <span>%</span>
                    </>
                  ) : (
                    <>
                      <input 
                        type="number"
                        min="10"
                        max="100"
                        step="10"
                        value={Math.round((selectedMarkup.fillOpacity !== undefined ? selectedMarkup.fillOpacity : 0.3) * 100)}
                        disabled={selectedMarkup.fillColor === 'none'}
                        onChange={(e) => {
                          const num = parseInt(e.target.value);
                          if (!isNaN(num)) {
                            if (num < 10) updateMarkupProperties(selectedMarkup.id, { fillOpacity: 0.1 });
                            else if (num > 100) updateMarkupProperties(selectedMarkup.id, { fillOpacity: 1 });
                            else updateMarkupProperties(selectedMarkup.id, { fillOpacity: num / 100 });
                          }
                        }}
                        style={{ width: '55px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px', opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}
                      />
                      <span>%</span>
                    </>
                  )}
                  <button 
                    className="ui-mode-toggle"
                    onClick={() => {
                      const newMode = penHighlighterUIMode === 'slider' ? 'compact' : 'slider';
                      onSetPenHighlighterUIMode(newMode);
                      localStorage.setItem('penHighlighterUIMode', newMode);
                    }}
                    title={penHighlighterUIMode === 'slider' ? 'Switch to compact dropdown' : 'Switch to slider'}
                    style={{ padding: '2px 5px', fontSize: '10px', background: '#444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', marginLeft: '2px' }}
                  >
                    {penHighlighterUIMode === 'slider' ? '▼' : '≡'}
                  </button>
                </div>
                <button 
                  className="set-default-btn"
                  onClick={(e) => {
                    const btn = e.target;
                    const defaults = { 
                      color: selectedMarkup.color, 
                      strokeWidth: selectedMarkup.strokeWidth,
                      strokeOpacity: selectedMarkup.strokeOpacity,
                      fillColor: selectedMarkup.fillColor,
                      fillOpacity: selectedMarkup.fillOpacity,
                      arcSize: selectedMarkup.arcSize,
                      inverted: selectedMarkup.inverted
                    };
                    localStorage.setItem('markup_cloud_defaults', JSON.stringify(defaults));
                    console.log('Saved cloud defaults:', defaults);
                    btn.textContent = '✓';
                    btn.style.background = '#27ae60';
                    setTimeout(() => {
                      btn.textContent = '☆ Default';
                      btn.style.background = '';
                    }, 1500);
                  }}
                  title="Save current settings as default"
                >
                  ☆ Default
                </button>
              </>
            )}
            
            {/* Text options */}
            {selectedMarkup.type === 'text' && (
              <>
                <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
                <div className="tool-option">
                  <label>Color:</label>
                  <button 
                    title="No border" className={`fill-toggle ${selectedMarkup.borderColor === 'none' ? 'active' : ''}`}
                    onClick={() => updateMarkupProperties(selectedMarkup.id, { borderColor: selectedMarkup.borderColor === 'none' ? '#000000' : 'none' })}
                  ><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg></button>
                  <input 
                    type="color" 
                    value={selectedMarkup.borderColor === 'none' ? '#000000' : (selectedMarkup.borderColor || '#000000')}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { borderColor: e.target.value })}
                    style={{ opacity: selectedMarkup.borderColor === 'none' ? 0.5 : 1 }}
                  />
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.borderColor === 'none' ? 0.5 : 1 }}>
                  <label>Width:</label>
                  <select
                    value={selectedMarkup.borderWidth || 1}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { borderWidth: parseInt(e.target.value) })}
                    disabled={selectedMarkup.borderColor === 'none'}
                    style={{ padding: '2px 4px', fontSize: '12px', minWidth: '55px' }}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.borderColor === 'none' ? 0.5 : 1 }}>
                  <label>Style:</label>
                  <select 
                    value={selectedMarkup.borderStyle || 'solid'} 
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { borderStyle: e.target.value })}
                    disabled={selectedMarkup.borderColor === 'none'}
                    style={{ padding: '2px 4px', fontSize: '12px' }}
                  >
                    <option value="solid">Solid</option>
                    <option value="dashed">Dashed</option>
                    <option value="dotted">Dotted</option>
                  </select>
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.borderColor === 'none' ? 0.5 : 1 }}>
                  <label>Opacity:</label>
                  <input 
                    type="number"
                    min="10"
                    max="100"
                    step="10"
                    value={Math.round((selectedMarkup.borderOpacity !== undefined ? selectedMarkup.borderOpacity : 1) * 100)}
                    disabled={selectedMarkup.borderColor === 'none'}
                    onChange={(e) => {
                      const num = parseInt(e.target.value);
                      if (!isNaN(num)) {
                        if (num < 10) updateMarkupProperties(selectedMarkup.id, { borderOpacity: 0.1 });
                        else if (num > 100) updateMarkupProperties(selectedMarkup.id, { borderOpacity: 1 });
                        else updateMarkupProperties(selectedMarkup.id, { borderOpacity: num / 100 });
                      }
                    }}
                    style={{ width: '50px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px' }}
                  />
                  <span>%</span>
                </div>
                <span style={{ color: '#666', margin: '0 4px' }}>|</span>
                <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
                <div className="tool-option">
                  <label>Color:</label>
                  <button 
                    title="No fill" className={`fill-toggle ${selectedMarkup.fillColor === 'none' ? 'active' : ''}`}
                    onClick={() => updateMarkupProperties(selectedMarkup.id, { fillColor: selectedMarkup.fillColor === 'none' ? '#ffffff' : 'none' })}
                  ><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg></button>
                  <input 
                    type="color" 
                    value={selectedMarkup.fillColor === 'none' || selectedMarkup.fillColor === 'white' ? '#ffffff' : (selectedMarkup.fillColor || '#ffffff')}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { fillColor: e.target.value })}
                    style={{ opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}
                  />
                </div>
                <div className="tool-option" style={{ opacity: selectedMarkup.fillColor === 'none' ? 0.5 : 1 }}>
                  <label>Opacity:</label>
                  <input 
                    type="number"
                    min="10"
                    max="100"
                    step="10"
                    value={Math.round((selectedMarkup.fillOpacity !== undefined ? selectedMarkup.fillOpacity : 1) * 100)}
                    disabled={selectedMarkup.fillColor === 'none'}
                    onChange={(e) => {
                      const num = parseInt(e.target.value);
                      if (!isNaN(num)) {
                        if (num < 10) updateMarkupProperties(selectedMarkup.id, { fillOpacity: 0.1 });
                        else if (num > 100) updateMarkupProperties(selectedMarkup.id, { fillOpacity: 1 });
                        else updateMarkupProperties(selectedMarkup.id, { fillOpacity: num / 100 });
                      }
                    }}
                    style={{ width: '50px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px' }}
                  />
                  <span>%</span>
                </div>
                <span style={{ color: '#666', margin: '0 4px' }}>|</span>
                <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Text:</span>
                <div className="tool-option">
                  <label>Color:</label>
                  <input 
                    type="color" 
                    value={selectedMarkup.color || '#000000'}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { color: e.target.value })}
                  />
                </div>
                <div className="tool-option">
                  <label>Font:</label>
                  <select 
                    value={selectedMarkup.fontFamily || 'Helvetica'}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { fontFamily: e.target.value })}
                    style={{ padding: '2px 4px', background: '#333', color: 'white', border: '1px solid #555', borderRadius: '3px', maxWidth: '100px', fontSize: '11px' }}
                  >
                    <optgroup label="Sans-Serif">
                      <option value="Helvetica">Helvetica</option>
                      <option value="Arial">Arial</option>
                      <option value="Verdana">Verdana</option>
                      <option value="Roboto">Roboto</option>
                      <option value="Open Sans">Open Sans</option>
                    </optgroup>
                    <optgroup label="Serif">
                      <option value="Times New Roman">Times</option>
                      <option value="Georgia">Georgia</option>
                    </optgroup>
                    <optgroup label="Monospace">
                      <option value="Courier New">Courier</option>
                    </optgroup>
                  </select>
                </div>
                <div className="tool-option">
                  <label>Size:</label>
                  <select 
                    value={selectedMarkup.fontSize || 12}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { fontSize: parseInt(e.target.value) })}
                    style={{ padding: '2px 4px', background: '#333', color: 'white', border: '1px solid #555', borderRadius: '3px', fontSize: '11px' }}
                  >
                    {[8, 9, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72].map(size => (
                      <option key={size} value={size}>{size}pt</option>
                    ))}
                  </select>
                </div>
                {selectedMarkup.startX !== undefined && (
                  <>
                    <div className="tool-option">
                      <label>Align:</label>
                      <div style={{ display: 'flex', gap: '2px' }}>
                        <button 
                          onClick={() => updateMarkupProperties(selectedMarkup.id, { textAlign: 'left' })}
                          title="Align Left"
                          style={{ padding: '2px 5px', background: (selectedMarkup.textAlign || 'left') === 'left' ? '#3498db' : '#444', border: 'none', borderRadius: '3px', color: 'white', cursor: 'pointer', fontSize: '10px' }}
                        >≡</button>
                        <button 
                          onClick={() => updateMarkupProperties(selectedMarkup.id, { textAlign: 'center' })}
                          title="Align Center"
                          style={{ padding: '2px 5px', background: selectedMarkup.textAlign === 'center' ? '#3498db' : '#444', border: 'none', borderRadius: '3px', color: 'white', cursor: 'pointer', fontSize: '10px' }}
                        >☰</button>
                        <button 
                          onClick={() => updateMarkupProperties(selectedMarkup.id, { textAlign: 'right' })}
                          title="Align Right"
                          style={{ padding: '2px 5px', background: selectedMarkup.textAlign === 'right' ? '#3498db' : '#444', border: 'none', borderRadius: '3px', color: 'white', cursor: 'pointer', fontSize: '10px' }}
                        >⫶</button>
                      </div>
                    </div>
                    <div className="tool-option">
                      <label>V:</label>
                      <div style={{ display: 'flex', gap: '2px' }}>
                        <button 
                          onClick={() => updateMarkupProperties(selectedMarkup.id, { verticalAlign: 'top' })}
                          title="Align Top"
                          style={{ padding: '2px 5px', background: (selectedMarkup.verticalAlign || 'top') === 'top' ? '#3498db' : '#444', border: 'none', borderRadius: '3px', color: 'white', cursor: 'pointer', fontSize: '9px' }}
                        >⊤</button>
                        <button 
                          onClick={() => updateMarkupProperties(selectedMarkup.id, { verticalAlign: 'middle' })}
                          title="Align Middle"
                          style={{ padding: '2px 5px', background: selectedMarkup.verticalAlign === 'middle' ? '#3498db' : '#444', border: 'none', borderRadius: '3px', color: 'white', cursor: 'pointer', fontSize: '9px' }}
                        >⊝</button>
                        <button 
                          onClick={() => updateMarkupProperties(selectedMarkup.id, { verticalAlign: 'bottom' })}
                          title="Align Bottom"
                          style={{ padding: '2px 5px', background: selectedMarkup.verticalAlign === 'bottom' ? '#3498db' : '#444', border: 'none', borderRadius: '3px', color: 'white', cursor: 'pointer', fontSize: '9px' }}
                        >⊥</button>
                      </div>
                    </div>
                  </>
                )}
                <div className="tool-option">
                  <label>Pad:</label>
                  <select 
                    value={selectedMarkup.padding !== undefined ? selectedMarkup.padding : 4}
                    onChange={(e) => updateMarkupProperties(selectedMarkup.id, { padding: parseInt(e.target.value) })}
                    style={{ padding: '2px 4px', background: '#333', color: 'white', border: '1px solid #555', borderRadius: '3px', fontSize: '11px' }}
                  >
                    {[0, 2, 4, 6, 8, 10, 12, 16, 20].map(p => (
                      <option key={p} value={p}>{p}px</option>
                    ))}
                  </select>
                </div>
                {selectedMarkup.startX !== undefined && (
                  <div className="tool-option">
                    <label>Rot:</label>
                    <input 
                      type="number"
                      min="-360"
                      max="360"
                      step="15"
                      value={Math.round(selectedMarkup.rotation || 0)}
                      onChange={(e) => updateMarkupProperties(selectedMarkup.id, { rotation: parseInt(e.target.value) || 0 })}
                      style={{ width: '54px', padding: '2px 4px', background: '#333', color: 'white', border: '1px solid #555', borderRadius: '3px', fontSize: '11px' }}
                    />
                    <span>°</span>
                    <button
                      onClick={() => updateMarkupProperties(selectedMarkup.id, { rotation: 0 })}
                      style={{ padding: '2px 6px', marginLeft: '2px', background: '#555', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}
                      title="Reset rotation"
                    >
                      ↺
                    </button>
                  </div>
                )}
                <button 
                  className="set-default-btn"
                  onClick={(e) => {
                    const btn = e.target;
                    localStorage.setItem('markup_text_defaults', JSON.stringify({ 
                      color: selectedMarkup.color, 
                      fillColor: selectedMarkup.fillColor, 
                      fillOpacity: selectedMarkup.fillOpacity,
                      borderColor: selectedMarkup.borderColor, 
                      borderWidth: selectedMarkup.borderWidth,
                      borderStyle: selectedMarkup.borderStyle,
                      borderOpacity: selectedMarkup.borderOpacity,
                      fontSize: selectedMarkup.fontSize,
                      fontFamily: selectedMarkup.fontFamily,
                      textAlign: selectedMarkup.textAlign,
                      verticalAlign: selectedMarkup.verticalAlign,
                      padding: selectedMarkup.padding
                    }));
                    btn.textContent = '✓';
                    btn.style.background = '#27ae60';
                    setTimeout(() => {
                      btn.textContent = '☆ Default';
                      btn.style.background = '';
                    }, 1500);
                  }}
                  title="Save current settings as default"
                >
                  ☆ Default
                </button>
              </>
            )}
            
            {/* Set as Default button for arc (excluding pen, highlighter, arrow, line, polyline, polylineArrow, rectangle, circle which have their own) */}
            {!selectedMarkup.readOnly && selectedMarkup.type === 'arc' && (
              <button 
                className="set-default-btn"
                onClick={(e) => {
                  const btn = e.target;
                  const defaults = { 
                    color: selectedMarkup.color || '#ff0000', 
                    strokeWidth: selectedMarkup.strokeWidth || 2,
                    lineStyle: selectedMarkup.lineStyle || 'solid',
                    arcBulge: selectedMarkup.arcBulge || 0.5
                  };
                  localStorage.setItem('markup_arc_defaults', JSON.stringify(defaults));
                  btn.textContent = '✓';
                  btn.style.background = '#27ae60';
                  setTimeout(() => { btn.textContent = '☆ Default'; btn.style.background = ''; }, 1500);
                }}
                title="Save current settings as default for new markups"
              >
                ☆ Default
              </button>
            )} 
            
            {/* Editing label - appears on right side */}
            <span className="selected-markup-label" style={{ marginLeft: 'auto' }}>
              Editing
            </span>
          </div>
        )}
        
        {/* Multi-selection panel */}
        {selectedMarkups.length > 0 && (
          <div className="selected-markup-panel multi-selection-panel" style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px',
            padding: '4px 12px',
            background: '#2a2a2a',
            borderRadius: '4px',
            marginBottom: '8px'
          }}>
            <span style={{ color: '#888', fontSize: '11px' }}>
              {selectedMarkups.length} items selected (Del to delete)
            </span>
          </div>
        )}
        
        {/* Pen Options */}
        {!pendingPlacement && markupMode === 'pen' && (
            <div className="tool-options-row">
              <div className="tool-option">
                <label>Color:</label>
                <input 
                  type="color" 
                  value={markupColor} 
                  onChange={(e) => onSetMarkupColor(e.target.value)}
                />
              </div>
              <div className="tool-option">
                <label>Size:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="1" 
                      max="72" 
                      value={markupStrokeWidth} 
                      onChange={(e) => onSetMarkupStrokeWidth(parseInt(e.target.value))}
                      style={{ width: '120px' }}
                    />
                    <input 
                      type="text"
                      className="manual-input"
                      defaultValue={markupStrokeWidth}
                      key={`pen-size-${markupStrokeWidth}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.target.blur();
                        }
                      }}
                      onBlur={(e) => {
                        const num = parseInt(e.target.value);
                        if (isNaN(num) || num < 1) onSetMarkupStrokeWidth(1);
                        else if (num > 72) onSetMarkupStrokeWidth(72);
                        else onSetMarkupStrokeWidth(num);
                      }}
                    />
                    <span>px</span>
                  </>
                ) : (
                  <select
                    value={markupStrokeWidth}
                    onChange={(e) => onSetMarkupStrokeWidth(parseInt(e.target.value))}
                    style={{ padding: '2px 4px', fontSize: '12px', minWidth: '70px' }}
                  >
                    {[1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72].map(size => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                )}
                <button 
                  className="ui-mode-toggle"
                  onClick={() => {
                    const newMode = penHighlighterUIMode === 'slider' ? 'compact' : 'slider';
                    onSetPenHighlighterUIMode(newMode);
                    localStorage.setItem('penHighlighterUIMode', newMode);
                  }}
                  title={penHighlighterUIMode === 'slider' ? 'Switch to compact dropdown' : 'Switch to slider'}
                  style={{ 
                    padding: '2px 5px', 
                    fontSize: '10px', 
                    background: '#444', 
                    color: '#fff', 
                    border: 'none', 
                    borderRadius: '3px',
                    cursor: 'pointer',
                    marginLeft: '2px'
                  }}
                >
                  {penHighlighterUIMode === 'slider' ? '▼' : '≡'}
                </button>
              </div>
              <button 
                className="set-default-btn"
                onClick={(e) => {
                  const btn = e.target;
                  const defaults = { color: markupColor, strokeWidth: markupStrokeWidth };
                  localStorage.setItem('markup_pen_defaults', JSON.stringify(defaults));
                  btn.textContent = '✓';
                  btn.style.background = '#27ae60';
                  setTimeout(() => {
                    btn.textContent = '☆ Default';
                    btn.style.background = '';
                  }, 1500);
                }}
                title="Save current settings as default"
              >
                ☆ Default
              </button>
            </div>
          )}
          {!pendingPlacement && markupMode === 'highlighter' && (
            <div className="tool-options-row">
              <div className="tool-option">
                <label>Color:</label>
                <input 
                  type="color" 
                  value={markupColor} 
                  onChange={(e) => onSetMarkupColor(e.target.value)}
                />
              </div>
              <div className="tool-option">
                <label>Size:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="5" 
                      max="72" 
                      value={markupStrokeWidth * 3} 
                      onChange={(e) => onSetMarkupStrokeWidth(Math.round(parseInt(e.target.value) / 3))}
                      style={{ width: '120px' }}
                    />
                    <input 
                      type="text"
                      className="manual-input"
                      defaultValue={markupStrokeWidth * 3}
                      key={`hl-size-${markupStrokeWidth}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.target.blur();
                        }
                      }}
                      onBlur={(e) => {
                        const num = parseInt(e.target.value);
                        if (isNaN(num) || num < 5) onSetMarkupStrokeWidth(Math.round(5 / 3));
                        else if (num > 72) onSetMarkupStrokeWidth(24);
                        else onSetMarkupStrokeWidth(Math.round(num / 3));
                      }}
                    />
                    <span>px</span>
                  </>
                ) : (
                  <select
                    value={markupStrokeWidth * 3}
                    onChange={(e) => onSetMarkupStrokeWidth(Math.round(parseInt(e.target.value) / 3))}
                    style={{ padding: '2px 4px', fontSize: '12px', minWidth: '70px' }}
                  >
                    {[6, 9, 12, 15, 18, 21, 24, 30, 36, 42, 48, 54, 60, 66, 72].map(size => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="tool-option">
                <label>Opacity:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="0.8" 
                      step="0.1"
                      value={markupOpacity} 
                      onChange={(e) => onSetMarkupOpacity(parseFloat(e.target.value))}
                      style={{ width: '80px' }}
                    />
                    <input 
                      type="text"
                      className="manual-input"
                      defaultValue={Math.round(markupOpacity * 100)}
                      key={`hl-opacity-${Math.round(markupOpacity * 100)}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.target.blur();
                        }
                      }}
                      onBlur={(e) => {
                        const num = parseInt(e.target.value);
                        if (isNaN(num) || num < 10) onSetMarkupOpacity(0.1);
                        else if (num > 80) onSetMarkupOpacity(0.8);
                        else onSetMarkupOpacity(num / 100);
                      }}
                    />
                    <span>%</span>
                  </>
                ) : (
                  <>
                    <input 
                      type="number"
                      min="10"
                      max="80"
                      step="10"
                      value={Math.round(markupOpacity * 100)}
                      onChange={(e) => {
                        const num = parseInt(e.target.value);
                        if (!isNaN(num)) {
                          if (num < 10) onSetMarkupOpacity(0.1);
                          else if (num > 80) onSetMarkupOpacity(0.8);
                          else onSetMarkupOpacity(num / 100);
                        }
                      }}
                      style={{ 
                        width: '55px', 
                        padding: '2px 4px', 
                        fontSize: '12px',
                        textAlign: 'center',
                        background: '#222',
                        color: '#fff',
                        border: '1px solid #444',
                        borderRadius: '3px'
                      }}
                    />
                    <span>%</span>
                  </>
                )}
                <button 
                  className="ui-mode-toggle"
                  onClick={() => {
                    const newMode = penHighlighterUIMode === 'slider' ? 'compact' : 'slider';
                    onSetPenHighlighterUIMode(newMode);
                    localStorage.setItem('penHighlighterUIMode', newMode);
                  }}
                  title={penHighlighterUIMode === 'slider' ? 'Switch to compact dropdown' : 'Switch to slider'}
                  style={{ 
                    padding: '2px 5px', 
                    fontSize: '10px', 
                    background: '#444', 
                    color: '#fff', 
                    border: 'none', 
                    borderRadius: '3px',
                    cursor: 'pointer',
                    marginLeft: '2px'
                  }}
                >
                  {penHighlighterUIMode === 'slider' ? '▼' : '≡'}
                </button>
              </div>
              <button 
                className="set-default-btn"
                onClick={(e) => {
                  const btn = e.target;
                  const defaults = { color: markupColor, strokeWidth: markupStrokeWidth, opacity: markupOpacity };
                  localStorage.setItem('markup_highlighter_defaults', JSON.stringify(defaults));
                  btn.textContent = '✓';
                  btn.style.background = '#27ae60';
                  setTimeout(() => {
                    btn.textContent = '☆ Default';
                    btn.style.background = '';
                  }, 1500);
                }}
                title="Save current settings as default"
              >
                ☆ Default
              </button>
            </div>
          )}
          
          {/* Arrow Options */}
          {!pendingPlacement && markupMode === 'arrow' && (
            <div className="tool-options-row">
              <div className="tool-option">
                <label>Color:</label>
                <input 
                  type="color" 
                  value={markupColor} 
                  onChange={(e) => onSetMarkupColor(e.target.value)}
                />
              </div>
              <div className="tool-option">
                <label>Size:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="1" 
                      max="8" 
                      value={markupStrokeWidth} 
                      onChange={(e) => onSetMarkupStrokeWidth(parseInt(e.target.value))}
                      style={{ width: '80px' }}
                    />
                    <input 
                      type="text"
                      className="manual-input"
                      defaultValue={markupStrokeWidth}
                      key={`arrow-size-${markupStrokeWidth}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.target.blur();
                        }
                      }}
                      onBlur={(e) => {
                        const num = parseInt(e.target.value);
                        if (isNaN(num) || num < 1) onSetMarkupStrokeWidth(1);
                        else if (num > 8) onSetMarkupStrokeWidth(8);
                        else onSetMarkupStrokeWidth(num);
                      }}
                    />
                    <span>px</span>
                  </>
                ) : (
                  <select
                    value={markupStrokeWidth}
                    onChange={(e) => onSetMarkupStrokeWidth(parseInt(e.target.value))}
                    style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="tool-option">
                <label>Style:</label>
                {renderLineStyleSelect(
                  markupLineStyle,
                  (e) => onSetMarkupLineStyle(e.target.value),
                  false,
                  null,
                  'tool'
                )}
              </div>
              <div className="tool-option">
                <label>Head:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="6" 
                      max="30" 
                      value={markupArrowHeadSize} 
                      onChange={(e) => onSetMarkupArrowHeadSize(parseInt(e.target.value))}
                      style={{ width: '80px' }}
                    />
                    <input 
                      type="text"
                      className="manual-input"
                      defaultValue={markupArrowHeadSize}
                      key={`arrow-head-${markupArrowHeadSize}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.target.blur();
                        }
                      }}
                      onBlur={(e) => {
                        const num = parseInt(e.target.value);
                        if (isNaN(num) || num < 6) onSetMarkupArrowHeadSize(6);
                        else if (num > 30) onSetMarkupArrowHeadSize(30);
                        else onSetMarkupArrowHeadSize(num);
                      }}
                    />
                    <span>px</span>
                  </>
                ) : (
                  <select
                    value={markupArrowHeadSize}
                    onChange={(e) => onSetMarkupArrowHeadSize(parseInt(e.target.value))}
                    style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                  >
                    {[6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 30].map(size => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                )}
                <button 
                  className="ui-mode-toggle"
                  onClick={() => {
                    const newMode = penHighlighterUIMode === 'slider' ? 'compact' : 'slider';
                    onSetPenHighlighterUIMode(newMode);
                    localStorage.setItem('penHighlighterUIMode', newMode);
                  }}
                  title={penHighlighterUIMode === 'slider' ? 'Switch to compact dropdown' : 'Switch to slider'}
                  style={{ 
                    padding: '2px 5px', 
                    fontSize: '10px', 
                    background: '#444', 
                    color: '#fff', 
                    border: 'none', 
                    borderRadius: '3px',
                    cursor: 'pointer',
                    marginLeft: '2px'
                  }}
                >
                  {penHighlighterUIMode === 'slider' ? '▼' : '≡'}
                </button>
              </div>
              <button 
                className="set-default-btn"
                onClick={(e) => {
                  const btn = e.target;
                  const defaults = { color: markupColor, strokeWidth: markupStrokeWidth, arrowHeadSize: markupArrowHeadSize, lineStyle: markupLineStyle };
                  localStorage.setItem('markup_arrow_defaults', JSON.stringify(defaults));
                  btn.textContent = '✓';
                  btn.style.background = '#27ae60';
                  setTimeout(() => {
                    btn.textContent = '☆ Default';
                    btn.style.background = '';
                  }, 1500);
                }}
                title="Save current settings as default"
              >
                ☆ Default
              </button>
            </div>
          )}
          
          {/* Line Options */}
          {!pendingPlacement && markupMode === 'line' && (
            <div className="tool-options-row">
              <div className="tool-option">
                <label>Color:</label>
                <input 
                  type="color" 
                  value={markupColor} 
                  onChange={(e) => onSetMarkupColor(e.target.value)}
                />
              </div>
              <div className="tool-option">
                <label>Size:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="1" 
                      max="8" 
                      value={markupStrokeWidth} 
                      onChange={(e) => onSetMarkupStrokeWidth(parseInt(e.target.value))}
                      style={{ width: '80px' }}
                    />
                    <input 
                      type="text"
                      className="manual-input"
                      defaultValue={markupStrokeWidth}
                      key={`line-size-${markupStrokeWidth}`}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                      onBlur={(e) => {
                        const num = parseInt(e.target.value);
                        if (isNaN(num) || num < 1) onSetMarkupStrokeWidth(1);
                        else if (num > 8) onSetMarkupStrokeWidth(8);
                        else onSetMarkupStrokeWidth(num);
                      }}
                    />
                    <span>px</span>
                  </>
                ) : (
                  <select
                    value={markupStrokeWidth}
                    onChange={(e) => onSetMarkupStrokeWidth(parseInt(e.target.value))}
                    style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="tool-option">
                <label>Style:</label>
                {renderLineStyleSelect(
                  markupLineStyle,
                  (e) => onSetMarkupLineStyle(e.target.value),
                  false,
                  null,
                  'tool'
                )}
                <button 
                  className="ui-mode-toggle"
                  onClick={() => {
                    const newMode = penHighlighterUIMode === 'slider' ? 'compact' : 'slider';
                    onSetPenHighlighterUIMode(newMode);
                    localStorage.setItem('penHighlighterUIMode', newMode);
                  }}
                  title={penHighlighterUIMode === 'slider' ? 'Switch to compact dropdown' : 'Switch to slider'}
                  style={{ padding: '2px 5px', fontSize: '10px', background: '#444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', marginLeft: '2px' }}
                >
                  {penHighlighterUIMode === 'slider' ? '▼' : '≡'}
                </button>
              </div>
              <button 
                className="set-default-btn"
                onClick={(e) => {
                  const btn = e.target;
                  const defaults = { color: markupColor, strokeWidth: markupStrokeWidth, lineStyle: markupLineStyle };
                  localStorage.setItem('markup_line_defaults', JSON.stringify(defaults));
                  btn.textContent = '✓';
                  btn.style.background = '#27ae60';
                  setTimeout(() => {
                    btn.textContent = '☆ Default';
                    btn.style.background = '';
                  }, 1500);
                }}
                title="Save current settings as default"
              >
                ☆ Default
              </button>
            </div>
          )}
          {!pendingPlacement && markupMode === 'rectangle' && (
            <div className="tool-options-row">
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
              <div className="tool-option">
                <label>Color:</label>
                <button 
                  title="No line" className={`fill-toggle ${markupColor === 'none' ? 'active' : ''}`}
                  onClick={() => onSetMarkupColor(markupColor === 'none' ? '#ff0000' : 'none')}
                ><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg></button>
                <input 
                  type="color" 
                  value={markupColor === 'none' ? '#ff0000' : markupColor} 
                  onChange={(e) => onSetMarkupColor(e.target.value)}
                  style={{ opacity: markupColor === 'none' ? 0.5 : 1 }}
                />
              </div>
              <div className="tool-option" style={{ opacity: markupColor === 'none' ? 0.5 : 1 }}>
                <label>Width:</label>
                <select
                  value={markupStrokeWidth}
                  onChange={(e) => onSetMarkupStrokeWidth(parseInt(e.target.value))}
                  disabled={markupColor === 'none'}
                  style={{ padding: '2px 4px', fontSize: '11px', minWidth: '52px' }}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                    <option key={size} value={size}>{size}px</option>
                  ))}
                </select>
              </div>
              <div className="tool-option" style={{ opacity: markupColor === 'none' ? 0.5 : 1 }}>
                <label>Opacity:</label>
                <input 
                  type="number"
                  min="0"
                  max="100"
                  step="10"
                  value={Math.round(markupStrokeOpacity * 100)}
                  disabled={markupColor === 'none'}
                  onChange={(e) => {
                    const num = parseInt(e.target.value);
                    if (!isNaN(num)) {
                      onSetMarkupStrokeOpacity(Math.min(1, Math.max(0, num / 100)));
                    }
                  }}
                  style={{ width: '48px', padding: '2px 4px', fontSize: '11px', textAlign: 'center', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '3px' }}
                />
                <span>%</span>
              </div>
              <div className="tool-option" style={{ opacity: markupColor === 'none' ? 0.5 : 1 }}>
                <label>Style:</label>
                {renderLineStyleSelect(
                  markupLineStyle,
                  (e) => onSetMarkupLineStyle(e.target.value),
                  markupColor === 'none',
                  null,
                  'tool'
                )}
              </div>
              <span style={{ color: '#666', margin: '0 4px' }}>|</span>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
              <div className="tool-option">
                <label>Color:</label>
                <button 
                  title="No fill" className={`fill-toggle ${markupFillColor === 'none' ? 'active' : ''}`}
                  onClick={() => onSetMarkupFillColor('none')}
                ><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg></button>
                <input 
                  type="color" 
                  value={markupFillColor === 'none' ? '#ffffff' : markupFillColor} 
                  onChange={(e) => onSetMarkupFillColor(e.target.value)}
                  style={{ opacity: markupFillColor === 'none' ? 0.5 : 1 }}
                />
              </div>
              <div className="tool-option" style={{ opacity: markupFillColor === 'none' ? 0.5 : 1 }}>
                <label>Opacity:</label>
                <input 
                  type="number"
                  min="0"
                  max="100"
                  step="10"
                  value={Math.round(markupFillOpacity * 100)}
                  disabled={markupFillColor === 'none'}
                  onChange={(e) => {
                    const num = parseInt(e.target.value);
                    if (!isNaN(num)) {
                      onSetMarkupFillOpacity(Math.min(1, Math.max(0, num / 100)));
                    }
                  }}
                  style={{ width: '48px', padding: '2px 4px', fontSize: '11px', textAlign: 'center', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '3px' }}
                />
                <span>%</span>
              </div>
              <button 
                className="set-default-btn"
                onClick={() => {
                  localStorage.setItem('markup_rectangle_defaults', JSON.stringify({ 
                    color: markupColor, 
                    fillColor: markupFillColor, 
                    strokeWidth: markupStrokeWidth, 
                    strokeOpacity: markupStrokeOpacity,
                    fillOpacity: markupFillOpacity,
                    lineStyle: markupLineStyle
                  }));
                }}
                title="Save current settings as default"
              >
                ☆ Default
              </button>
            </div>
          )}
          
          {/* Circle Options */}
          {!pendingPlacement && markupMode === 'circle' && (
            <div className="tool-options-row">
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
              <div className="tool-option">
                <label>Color:</label>
                <button 
                  title="No line" className={`fill-toggle ${markupColor === 'none' ? 'active' : ''}`}
                  onClick={() => onSetMarkupColor(markupColor === 'none' ? '#ff0000' : 'none')}
                ><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg></button>
                <input 
                  type="color" 
                  value={markupColor === 'none' ? '#ff0000' : markupColor} 
                  onChange={(e) => onSetMarkupColor(e.target.value)}
                  style={{ opacity: markupColor === 'none' ? 0.5 : 1 }}
                />
              </div>
              <div className="tool-option" style={{ opacity: markupColor === 'none' ? 0.5 : 1 }}>
                <label>Width:</label>
                <select
                  value={markupStrokeWidth}
                  onChange={(e) => onSetMarkupStrokeWidth(parseInt(e.target.value))}
                  disabled={markupColor === 'none'}
                  style={{ padding: '2px 4px', fontSize: '11px', minWidth: '52px' }}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                    <option key={size} value={size}>{size}px</option>
                  ))}
                </select>
              </div>
              <div className="tool-option" style={{ opacity: markupColor === 'none' ? 0.5 : 1 }}>
                <label>Opacity:</label>
                <input 
                  type="number"
                  min="0"
                  max="100"
                  step="10"
                  value={Math.round(markupStrokeOpacity * 100)}
                  disabled={markupColor === 'none'}
                  onChange={(e) => {
                    const num = parseInt(e.target.value);
                    if (!isNaN(num)) {
                      onSetMarkupStrokeOpacity(Math.min(1, Math.max(0, num / 100)));
                    }
                  }}
                  style={{ width: '48px', padding: '2px 4px', fontSize: '11px', textAlign: 'center', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '3px' }}
                />
                <span>%</span>
              </div>
              <div className="tool-option" style={{ opacity: markupColor === 'none' ? 0.5 : 1 }}>
                <label>Style:</label>
                {renderLineStyleSelect(
                  markupLineStyle,
                  (e) => onSetMarkupLineStyle(e.target.value),
                  markupColor === 'none',
                  null,
                  'tool'
                )}
              </div>
              <span style={{ color: '#666', margin: '0 4px' }}>|</span>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
              <div className="tool-option">
                <label>Color:</label>
                <button 
                  title="No fill" className={`fill-toggle ${markupFillColor === 'none' ? 'active' : ''}`}
                  onClick={() => onSetMarkupFillColor('none')}
                ><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg></button>
                <input 
                  type="color" 
                  value={markupFillColor === 'none' ? '#ffffff' : markupFillColor} 
                  onChange={(e) => onSetMarkupFillColor(e.target.value)}
                  style={{ opacity: markupFillColor === 'none' ? 0.5 : 1 }}
                />
              </div>
              <div className="tool-option" style={{ opacity: markupFillColor === 'none' ? 0.5 : 1 }}>
                <label>Opacity:</label>
                <input 
                  type="number"
                  min="0"
                  max="100"
                  step="10"
                  value={Math.round(markupFillOpacity * 100)}
                  disabled={markupFillColor === 'none'}
                  onChange={(e) => {
                    const num = parseInt(e.target.value);
                    if (!isNaN(num)) {
                      onSetMarkupFillOpacity(Math.min(1, Math.max(0, num / 100)));
                    }
                  }}
                  style={{ width: '48px', padding: '2px 4px', fontSize: '11px', textAlign: 'center', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '3px' }}
                />
                <span>%</span>
              </div>
              <button 
                className="set-default-btn"
                onClick={() => {
                  localStorage.setItem('markup_circle_defaults', JSON.stringify({ 
                    color: markupColor, 
                    fillColor: markupFillColor, 
                    strokeWidth: markupStrokeWidth, 
                    strokeOpacity: markupStrokeOpacity,
                    fillOpacity: markupFillOpacity,
                    lineStyle: markupLineStyle
                  }));
                }}
                title="Save current settings as default"
              >
                ☆ Default
              </button>
            </div>
          )}
          
          {/* Arc Options */}
          {!pendingPlacement && markupMode === 'arc' && (
            <div className="tool-options-row">
              <div className="tool-option">
                <label>Color:</label>
                <input 
                  type="color" 
                  value={markupColor} 
                  onChange={(e) => onSetMarkupColor(e.target.value)}
                />
              </div>
              <div className="tool-option">
                <label>Width:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="1" 
                      max="8" 
                      value={markupStrokeWidth} 
                      onChange={(e) => onSetMarkupStrokeWidth(parseInt(e.target.value))}
                      style={{ width: '80px' }}
                    />
                    <input 
                      type="text"
                      className="manual-input"
                      defaultValue={markupStrokeWidth}
                      key={`arc-width-${markupStrokeWidth}`}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                      onBlur={(e) => {
                        const num = parseInt(e.target.value);
                        if (isNaN(num) || num < 1) onSetMarkupStrokeWidth(1);
                        else if (num > 8) onSetMarkupStrokeWidth(8);
                        else onSetMarkupStrokeWidth(num);
                      }}
                    />
                    <span>px</span>
                  </>
                ) : (
                  <select
                    value={markupStrokeWidth}
                    onChange={(e) => onSetMarkupStrokeWidth(parseInt(e.target.value))}
                    style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="tool-option">
                <label>Opacity:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="1" 
                      step="0.1"
                      value={markupStrokeOpacity} 
                      onChange={(e) => onSetMarkupStrokeOpacity(parseFloat(e.target.value))}
                      style={{ width: '80px' }}
                    />
                    <input 
                      type="text"
                      className="manual-input"
                      defaultValue={Math.round(markupStrokeOpacity * 100)}
                      key={`arc-opacity-${Math.round(markupStrokeOpacity * 100)}`}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                      onBlur={(e) => {
                        const num = parseInt(e.target.value);
                        if (isNaN(num) || num < 10) onSetMarkupStrokeOpacity(0.1);
                        else if (num > 100) onSetMarkupStrokeOpacity(1);
                        else onSetMarkupStrokeOpacity(num / 100);
                      }}
                    />
                    <span>%</span>
                  </>
                ) : (
                  <>
                    <input 
                      type="number"
                      min="10"
                      max="100"
                      step="10"
                      value={Math.round(markupStrokeOpacity * 100)}
                      onChange={(e) => {
                        const num = parseInt(e.target.value);
                        if (!isNaN(num)) {
                          if (num < 10) onSetMarkupStrokeOpacity(0.1);
                          else if (num > 100) onSetMarkupStrokeOpacity(1);
                          else onSetMarkupStrokeOpacity(num / 100);
                        }
                      }}
                      style={{ width: '55px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px' }}
                    />
                    <span>%</span>
                  </>
                )}
              </div>
              <div className="tool-option">
                <label>Style:</label>
                {renderLineStyleSelect(
                  markupLineStyle,
                  (e) => onSetMarkupLineStyle(e.target.value),
                  false,
                  null,
                  'tool'
                )}
                <button 
                  className="ui-mode-toggle"
                  onClick={() => {
                    const newMode = penHighlighterUIMode === 'slider' ? 'compact' : 'slider';
                    onSetPenHighlighterUIMode(newMode);
                    localStorage.setItem('penHighlighterUIMode', newMode);
                  }}
                  title={penHighlighterUIMode === 'slider' ? 'Switch to compact dropdown' : 'Switch to slider'}
                  style={{ padding: '2px 5px', fontSize: '10px', background: '#444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', marginLeft: '2px' }}
                >
                  {penHighlighterUIMode === 'slider' ? '▼' : '≡'}
                </button>
              </div>
              <button 
                className="set-default-btn"
                onClick={() => {
                  localStorage.setItem('markup_arc_defaults', JSON.stringify({ 
                    color: markupColor, 
                    strokeWidth: markupStrokeWidth, 
                    strokeOpacity: markupStrokeOpacity,
                    lineStyle: markupLineStyle
                  }));
                }}
                title="Save current settings as default"
              >
                ☆ Default
              </button>
              <span className="tool-hint" style={{ marginLeft: '8px', color: '#888', fontSize: '11px' }}>Drag to draw. Adjust curvature with orange handle.</span>
            </div>
          )}
          
          {/* Cloud Options */}
          {!pendingPlacement && markupMode === 'cloud' && (
            <div className="tool-options-row">
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
              <div className="tool-option">
                <label>Color:</label>
                <button 
                  title="No line" className={`fill-toggle ${markupColor === 'none' ? 'active' : ''}`}
                  onClick={() => onSetMarkupColor(markupColor === 'none' ? '#ff0000' : 'none')}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg>
                </button>
                <input 
                  type="color" 
                  value={markupColor === 'none' ? '#ff0000' : markupColor} 
                  onChange={(e) => onSetMarkupColor(e.target.value)}
                  style={{ opacity: markupColor === 'none' ? 0.5 : 1 }}
                />
              </div>
              <div className="tool-option" style={{ opacity: markupColor === 'none' ? 0.5 : 1 }}>
                <label>Width:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="1" 
                      max="8" 
                      value={markupStrokeWidth} 
                      disabled={markupColor === 'none'}
                      onChange={(e) => onSetMarkupStrokeWidth(parseInt(e.target.value))}
                      style={{ width: '80px' }}
                    />
                    <input 
                      type="text"
                      className="manual-input"
                      defaultValue={markupStrokeWidth}
                      disabled={markupColor === 'none'}
                      key={`cloud-width-${markupStrokeWidth}`}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                      onBlur={(e) => {
                        const num = parseInt(e.target.value);
                        if (isNaN(num) || num < 1) onSetMarkupStrokeWidth(1);
                        else if (num > 8) onSetMarkupStrokeWidth(8);
                        else onSetMarkupStrokeWidth(num);
                      }}
                    />
                    <span>px</span>
                  </>
                ) : (
                  <select
                    value={markupStrokeWidth}
                    disabled={markupColor === 'none'}
                    onChange={(e) => onSetMarkupStrokeWidth(parseInt(e.target.value))}
                    style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="tool-option" style={{ opacity: markupColor === 'none' ? 0.5 : 1 }}>
                <label>Opacity:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="1" 
                      step="0.1"
                      value={markupStrokeOpacity} 
                      disabled={markupColor === 'none'}
                      onChange={(e) => onSetMarkupStrokeOpacity(parseFloat(e.target.value))}
                      style={{ width: '80px' }}
                    />
                    <input 
                      type="text"
                      className="manual-input"
                      defaultValue={Math.round(markupStrokeOpacity * 100)}
                      disabled={markupColor === 'none'}
                      key={`cloud-stroke-opacity-${Math.round(markupStrokeOpacity * 100)}`}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                      onBlur={(e) => {
                        const num = parseInt(e.target.value);
                        if (isNaN(num) || num < 10) onSetMarkupStrokeOpacity(0.1);
                        else if (num > 100) onSetMarkupStrokeOpacity(1);
                        else onSetMarkupStrokeOpacity(num / 100);
                      }}
                    />
                    <span>%</span>
                  </>
                ) : (
                  <>
                    <input 
                      type="number"
                      min="10"
                      max="100"
                      step="10"
                      value={Math.round(markupStrokeOpacity * 100)}
                      disabled={markupColor === 'none'}
                      onChange={(e) => {
                        const num = parseInt(e.target.value);
                        if (!isNaN(num)) {
                          if (num < 10) onSetMarkupStrokeOpacity(0.1);
                          else if (num > 100) onSetMarkupStrokeOpacity(1);
                          else onSetMarkupStrokeOpacity(num / 100);
                        }
                      }}
                      style={{ width: '55px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px', opacity: markupColor === 'none' ? 0.5 : 1 }}
                    />
                    <span>%</span>
                  </>
                )}
              </div>
              <div className="tool-option">
                <label>Arc:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="4" 
                      max="40" 
                      step="1"
                      value={markupCloudArcSize} 
                      onChange={(e) => onSetMarkupCloudArcSize(parseInt(e.target.value))}
                      style={{ width: '80px' }}
                    />
                    <input 
                      type="text"
                      className="manual-input"
                      defaultValue={markupCloudArcSize}
                      key={`cloud-arcsize-${markupCloudArcSize}`}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                      onBlur={(e) => {
                        const num = parseInt(e.target.value);
                        if (isNaN(num) || num < 4) onSetMarkupCloudArcSize(4);
                        else if (num > 40) onSetMarkupCloudArcSize(40);
                        else onSetMarkupCloudArcSize(num);
                      }}
                    />
                    <span>px</span>
                  </>
                ) : (
                  <select
                    value={markupCloudArcSize}
                    onChange={(e) => onSetMarkupCloudArcSize(parseInt(e.target.value))}
                    style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                  >
                    {[4, 6, 8, 10, 12, 14, 15, 16, 18, 20, 24, 28, 32, 36, 40].map(size => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="tool-option">
                <label>Invert:</label>
                <button 
                  className={`fill-toggle ${markupCloudInverted ? 'active' : ''}`}
                  onClick={() => onSetMarkupCloudInverted(!markupCloudInverted)}
                  title="Flip bumps direction (inward/outward)"
                >
                  {markupCloudInverted ? '↘↙' : '↗↖'}
                </button>
              </div>
              <span style={{ color: '#666', margin: '0 4px' }}>|</span>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
              <div className="tool-option">
                <label>Color:</label>
                <button 
                  title="No fill" className={`fill-toggle ${markupFillColor === 'none' ? 'active' : ''}`}
                  onClick={() => onSetMarkupFillColor('none')}
                ><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg></button>
                <input 
                  type="color" 
                  value={markupFillColor === 'none' ? '#ffffff' : markupFillColor} 
                  onChange={(e) => onSetMarkupFillColor(e.target.value)}
                  style={{ opacity: markupFillColor === 'none' ? 0.5 : 1 }}
                />
              </div>
              <div className="tool-option">
                <label>Opacity:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="1" 
                      step="0.1"
                      value={markupFillOpacity} 
                      onChange={(e) => onSetMarkupFillOpacity(parseFloat(e.target.value))}
                      disabled={markupFillColor === 'none'}
                      style={{ width: '80px', opacity: markupFillColor === 'none' ? 0.5 : 1 }}
                    />
                    <input 
                      type="text"
                      className="manual-input"
                      defaultValue={Math.round(markupFillOpacity * 100)}
                      key={`cloud-fill-opacity-${Math.round(markupFillOpacity * 100)}`}
                      disabled={markupFillColor === 'none'}
                      style={{ opacity: markupFillColor === 'none' ? 0.5 : 1 }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                      onBlur={(e) => {
                        const num = parseInt(e.target.value);
                        if (isNaN(num) || num < 10) onSetMarkupFillOpacity(0.1);
                        else if (num > 100) onSetMarkupFillOpacity(1);
                        else onSetMarkupFillOpacity(num / 100);
                      }}
                    />
                    <span>%</span>
                  </>
                ) : (
                  <>
                    <input 
                      type="number"
                      min="10"
                      max="100"
                      step="10"
                      value={Math.round(markupFillOpacity * 100)}
                      disabled={markupFillColor === 'none'}
                      onChange={(e) => {
                        const num = parseInt(e.target.value);
                        if (!isNaN(num)) {
                          if (num < 10) onSetMarkupFillOpacity(0.1);
                          else if (num > 100) onSetMarkupFillOpacity(1);
                          else onSetMarkupFillOpacity(num / 100);
                        }
                      }}
                      style={{ width: '55px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px', opacity: markupFillColor === 'none' ? 0.5 : 1 }}
                    />
                    <span>%</span>
                  </>
                )}
                <button 
                  className="ui-mode-toggle"
                  onClick={() => {
                    const newMode = penHighlighterUIMode === 'slider' ? 'compact' : 'slider';
                    onSetPenHighlighterUIMode(newMode);
                    localStorage.setItem('penHighlighterUIMode', newMode);
                  }}
                  title={penHighlighterUIMode === 'slider' ? 'Switch to compact dropdown' : 'Switch to slider'}
                  style={{ padding: '2px 5px', fontSize: '10px', background: '#444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', marginLeft: '2px' }}
                >
                  {penHighlighterUIMode === 'slider' ? '▼' : '≡'}
                </button>
              </div>
              <button 
                className="set-default-btn"
                onClick={() => {
                  localStorage.setItem('markup_cloud_defaults', JSON.stringify({ 
                    color: markupColor, 
                    strokeWidth: markupStrokeWidth,
                    fillColor: markupFillColor,
                    strokeOpacity: markupStrokeOpacity,
                    fillOpacity: markupFillOpacity,
                    inverted: markupCloudInverted,
                    arcSize: markupCloudArcSize
                  }));
                }}
                title="Save current settings as default"
              >
                ☆ Default
              </button>
            </div>
          )}
          
          {/* Polyline Options */}
          {!pendingPlacement && markupMode === 'polyline' && (
            <div className="tool-options-row">
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
              <div className="tool-option">
                <label>Color:</label>
                <input 
                  type="color" 
                  value={markupColor} 
                  onChange={(e) => onSetMarkupColor(e.target.value)}
                />
              </div>
              <div className="tool-option">
                <label>Width:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="1" 
                      max="8" 
                      value={markupStrokeWidth} 
                      onChange={(e) => onSetMarkupStrokeWidth(parseInt(e.target.value))}
                      style={{ width: '80px' }}
                    />
                    <input
                      type="text"
                      className="manual-input"
                      key={`polyline-width-${markupStrokeWidth}`}
                      defaultValue={markupStrokeWidth}
                      onBlur={(e) => {
                        let val = parseInt(e.target.value);
                        if (isNaN(val)) val = 2;
                        val = Math.max(1, Math.min(8, val));
                        onSetMarkupStrokeWidth(val);
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                    />
                    <span>px</span>
                  </>
                ) : (
                  <select
                    value={markupStrokeWidth}
                    onChange={(e) => onSetMarkupStrokeWidth(parseInt(e.target.value))}
                    style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="tool-option">
                <label>Opacity:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="1" 
                      step="0.1"
                      value={markupStrokeOpacity} 
                      onChange={(e) => onSetMarkupStrokeOpacity(parseFloat(e.target.value))}
                      style={{ width: '80px' }}
                    />
                    <input
                      type="text"
                      className="manual-input"
                      key={`polyline-stroke-opacity-${markupStrokeOpacity}`}
                      defaultValue={Math.round(markupStrokeOpacity * 100)}
                      onBlur={(e) => {
                        let val = parseInt(e.target.value);
                        if (isNaN(val)) val = 100;
                        val = Math.max(10, Math.min(100, val));
                        onSetMarkupStrokeOpacity(val / 100);
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                    />
                    <span>%</span>
                  </>
                ) : (
                  <>
                    <input 
                      type="number"
                      min="10"
                      max="100"
                      step="10"
                      value={Math.round(markupStrokeOpacity * 100)}
                      onChange={(e) => {
                        const num = parseInt(e.target.value);
                        if (!isNaN(num)) {
                          if (num < 10) onSetMarkupStrokeOpacity(0.1);
                          else if (num > 100) onSetMarkupStrokeOpacity(1);
                          else onSetMarkupStrokeOpacity(num / 100);
                        }
                      }}
                      style={{ width: '55px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px' }}
                    />
                    <span>%</span>
                  </>
                )}
              </div>
              <div className="tool-option">
                <label>Style:</label>
                {renderLineStyleSelect(
                  markupLineStyle,
                  (e) => onSetMarkupLineStyle(e.target.value),
                  false,
                  null,
                  'tool'
                )}
              </div>
              <span style={{ color: '#666', margin: '0 4px' }}>|</span>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
              <div className="tool-option">
                <label>Color:</label>
                <button 
                  title="No fill" className={`fill-toggle ${markupFillColor === 'none' ? 'active' : ''}`}
                  onClick={() => onSetMarkupFillColor('none')}
                ><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg></button>
                <input 
                  type="color" 
                  value={markupFillColor === 'none' ? '#ffffff' : markupFillColor} 
                  onChange={(e) => onSetMarkupFillColor(e.target.value)}
                  style={{ opacity: markupFillColor === 'none' ? 0.5 : 1 }}
                />
              </div>
              <div className="tool-option">
                <label>Opacity:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="1" 
                      step="0.1"
                      value={markupFillOpacity} 
                      onChange={(e) => onSetMarkupFillOpacity(parseFloat(e.target.value))}
                      disabled={markupFillColor === 'none'}
                      style={{ width: '80px', opacity: markupFillColor === 'none' ? 0.5 : 1 }}
                    />
                    <input
                      type="text"
                      className="manual-input"
                      key={`polyline-fill-opacity-${markupFillOpacity}`}
                      defaultValue={Math.round(markupFillOpacity * 100)}
                      onBlur={(e) => {
                        let val = parseInt(e.target.value);
                        if (isNaN(val)) val = 30;
                        val = Math.max(10, Math.min(100, val));
                        onSetMarkupFillOpacity(val / 100);
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                      disabled={markupFillColor === 'none'}
                      style={{ opacity: markupFillColor === 'none' ? 0.5 : 1 }}
                    />
                    <span>%</span>
                  </>
                ) : (
                  <>
                    <input 
                      type="number"
                      min="10"
                      max="100"
                      step="10"
                      value={Math.round(markupFillOpacity * 100)}
                      disabled={markupFillColor === 'none'}
                      onChange={(e) => {
                        const num = parseInt(e.target.value);
                        if (!isNaN(num)) {
                          if (num < 10) onSetMarkupFillOpacity(0.1);
                          else if (num > 100) onSetMarkupFillOpacity(1);
                          else onSetMarkupFillOpacity(num / 100);
                        }
                      }}
                      style={{ width: '55px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px', opacity: markupFillColor === 'none' ? 0.5 : 1 }}
                    />
                    <span>%</span>
                  </>
                )}
                <button 
                  className="ui-mode-toggle"
                  onClick={() => {
                    const newMode = penHighlighterUIMode === 'slider' ? 'compact' : 'slider';
                    onSetPenHighlighterUIMode(newMode);
                    localStorage.setItem('penHighlighterUIMode', newMode);
                  }}
                  title={penHighlighterUIMode === 'slider' ? 'Switch to compact dropdown' : 'Switch to slider'}
                  style={{ padding: '2px 5px', fontSize: '10px', background: '#444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', marginLeft: '2px' }}
                >
                  {penHighlighterUIMode === 'slider' ? '▼' : '≡'}
                </button>
              </div>
              <button 
                className="set-default-btn"
                onClick={() => {
                  localStorage.setItem('markup_polyline_defaults', JSON.stringify({ 
                    color: markupColor, 
                    strokeWidth: markupStrokeWidth,
                    fillColor: markupFillColor,
                    strokeOpacity: markupStrokeOpacity,
                    fillOpacity: markupFillOpacity,
                    lineStyle: markupLineStyle
                  }));
                }}
                title="Save current settings as default"
              >
                ☆ Default
              </button>
              <span className="tool-hint">Click to add points. Click start to close (with fill). Double-click to finish open. Shift = snap.</span>
            </div>
          )}
          
          {/* Polyline Arrow Options */}
          {!pendingPlacement && markupMode === 'polylineArrow' && (
            <div className="tool-options-row">
              <div className="tool-option">
                <label>Color:</label>
                <input 
                  type="color" 
                  value={markupColor} 
                  onChange={(e) => onSetMarkupColor(e.target.value)}
                />
              </div>
              <div className="tool-option">
                <label>Width:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="1" 
                      max="8" 
                      value={markupStrokeWidth} 
                      onChange={(e) => onSetMarkupStrokeWidth(parseInt(e.target.value))}
                      style={{ width: '80px' }}
                    />
                    <input
                      type="text"
                      className="manual-input"
                      key={`polyarrow-width-${markupStrokeWidth}`}
                      defaultValue={markupStrokeWidth}
                      onBlur={(e) => {
                        let val = parseInt(e.target.value);
                        if (isNaN(val)) val = 2;
                        val = Math.max(1, Math.min(8, val));
                        onSetMarkupStrokeWidth(val);
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                    />
                    <span>px</span>
                  </>
                ) : (
                  <select
                    value={markupStrokeWidth}
                    onChange={(e) => onSetMarkupStrokeWidth(parseInt(e.target.value))}
                    style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="tool-option">
                <label>Head:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="6" 
                      max="30" 
                      value={markupArrowHeadSize} 
                      onChange={(e) => onSetMarkupArrowHeadSize(parseInt(e.target.value))}
                      style={{ width: '80px' }}
                    />
                    <input
                      type="text"
                      className="manual-input"
                      key={`polyarrow-head-${markupArrowHeadSize}`}
                      defaultValue={markupArrowHeadSize}
                      onBlur={(e) => {
                        let val = parseInt(e.target.value);
                        if (isNaN(val)) val = 12;
                        val = Math.max(6, Math.min(30, val));
                        onSetMarkupArrowHeadSize(val);
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                    />
                    <span>px</span>
                  </>
                ) : (
                  <select
                    value={markupArrowHeadSize}
                    onChange={(e) => onSetMarkupArrowHeadSize(parseInt(e.target.value))}
                    style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                  >
                    {[6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 30].map(size => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="tool-option">
                <label>Style:</label>
                {renderLineStyleSelect(
                  markupLineStyle,
                  (e) => onSetMarkupLineStyle(e.target.value),
                  false,
                  null,
                  'tool'
                )}
                <button 
                  className="ui-mode-toggle"
                  onClick={() => {
                    const newMode = penHighlighterUIMode === 'slider' ? 'compact' : 'slider';
                    onSetPenHighlighterUIMode(newMode);
                    localStorage.setItem('penHighlighterUIMode', newMode);
                  }}
                  title={penHighlighterUIMode === 'slider' ? 'Switch to compact dropdown' : 'Switch to slider'}
                  style={{ padding: '2px 5px', fontSize: '10px', background: '#444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', marginLeft: '2px' }}
                >
                  {penHighlighterUIMode === 'slider' ? '▼' : '≡'}
                </button>
              </div>
              <button 
                className="set-default-btn"
                onClick={() => {
                  localStorage.setItem('markup_polylineArrow_defaults', JSON.stringify({ 
                    color: markupColor, 
                    strokeWidth: markupStrokeWidth,
                    arrowHeadSize: markupArrowHeadSize,
                    lineStyle: markupLineStyle
                  }));
                }}
                title="Save current settings as default"
              >
                ☆ Default
              </button>
              <span className="tool-hint">Click to add points. Double-click to finish with arrow. Shift = snap.</span>
            </div>
          )}
          
          {/* Cloud Polyline Options */}
          {!pendingPlacement && markupMode === 'cloudPolyline' && (
            <div className="tool-options-row">
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
              <div className="tool-option">
                <label>Color:</label>
                <input 
                  type="color" 
                  value={markupColor} 
                  onChange={(e) => onSetMarkupColor(e.target.value)}
                />
              </div>
              <div className="tool-option">
                <label>Width:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="1" 
                      max="8" 
                      value={markupStrokeWidth} 
                      onChange={(e) => onSetMarkupStrokeWidth(parseInt(e.target.value))}
                      style={{ width: '80px' }}
                    />
                    <input
                      type="text"
                      className="manual-input"
                      key={`cloudpoly-width-${markupStrokeWidth}`}
                      defaultValue={markupStrokeWidth}
                      onBlur={(e) => {
                        let val = parseInt(e.target.value);
                        if (isNaN(val)) val = 2;
                        val = Math.max(1, Math.min(8, val));
                        onSetMarkupStrokeWidth(val);
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                    />
                    <span>px</span>
                  </>
                ) : (
                  <select
                    value={markupStrokeWidth}
                    onChange={(e) => onSetMarkupStrokeWidth(parseInt(e.target.value))}
                    style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="tool-option">
                <label>Opacity:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="1" 
                      step="0.1"
                      value={markupStrokeOpacity}
                      onChange={(e) => onSetMarkupStrokeOpacity(parseFloat(e.target.value))}
                      style={{ width: '80px' }}
                    />
                    <input 
                      type="text"
                      className="manual-input"
                      defaultValue={Math.round(markupStrokeOpacity * 100)}
                      key={`cloudpoly-stroke-opacity-${markupStrokeOpacity}`}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                      onBlur={(e) => {
                        const num = parseInt(e.target.value);
                        if (isNaN(num) || num < 10) onSetMarkupStrokeOpacity(0.1);
                        else if (num > 100) onSetMarkupStrokeOpacity(1);
                        else onSetMarkupStrokeOpacity(num / 100);
                      }}
                    />
                    <span>%</span>
                  </>
                ) : (
                  <>
                    <input 
                      type="number"
                      min="10"
                      max="100"
                      step="10"
                      value={Math.round(markupStrokeOpacity * 100)}
                      onChange={(e) => {
                        const num = parseInt(e.target.value);
                        if (!isNaN(num)) {
                          if (num < 10) onSetMarkupStrokeOpacity(0.1);
                          else if (num > 100) onSetMarkupStrokeOpacity(1);
                          else onSetMarkupStrokeOpacity(num / 100);
                        }
                      }}
                      style={{ width: '55px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px' }}
                    />
                    <span>%</span>
                  </>
                )}
              </div>
              <div className="tool-option">
                <label>Arc:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="4" 
                      max="40" 
                      step="1"
                      value={markupCloudArcSize} 
                      onChange={(e) => onSetMarkupCloudArcSize(parseInt(e.target.value))}
                      style={{ width: '80px' }}
                    />
                    <input 
                      type="text"
                      className="manual-input"
                      defaultValue={markupCloudArcSize}
                      key={`cloudpoly-arcsize-${markupCloudArcSize}`}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                      onBlur={(e) => {
                        const num = parseInt(e.target.value);
                        if (isNaN(num) || num < 4) onSetMarkupCloudArcSize(4);
                        else if (num > 40) onSetMarkupCloudArcSize(40);
                        else onSetMarkupCloudArcSize(num);
                      }}
                    />
                    <span>px</span>
                  </>
                ) : (
                  <select
                    value={markupCloudArcSize}
                    onChange={(e) => onSetMarkupCloudArcSize(parseInt(e.target.value))}
                    style={{ padding: '2px 4px', fontSize: '12px', minWidth: '60px' }}
                  >
                    {[4, 6, 8, 10, 12, 14, 15, 16, 18, 20, 24, 28, 32, 36, 40].map(size => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="tool-option">
                <label>Invert:</label>
                <button 
                  className={`fill-toggle ${markupCloudInverted ? 'active' : ''}`}
                  onClick={() => onSetMarkupCloudInverted(!markupCloudInverted)}
                  title="Flip bumps direction"
                >
                  {markupCloudInverted ? '↘↙' : '↗↖'}
                </button>
              </div>
              <span style={{ color: '#666', margin: '0 4px' }}>|</span>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
              <div className="tool-option">
                <label>Color:</label>
                <button 
                  title="No fill" className={`fill-toggle ${markupFillColor === 'none' ? 'active' : ''}`}
                  onClick={() => onSetMarkupFillColor('none')}
                ><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg></button>
                <input 
                  type="color" 
                  value={markupFillColor === 'none' || markupFillColor === 'white' ? '#ffffff' : (markupFillColor || '#ffffff')}
                  onChange={(e) => onSetMarkupFillColor(e.target.value)}
                  style={{ opacity: markupFillColor === 'none' ? 0.5 : 1 }}
                />
              </div>
              <div className="tool-option">
                <label>Opacity:</label>
                {penHighlighterUIMode === 'slider' ? (
                  <>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="1" 
                      step="0.1"
                      value={markupFillOpacity}
                      onChange={(e) => onSetMarkupFillOpacity(parseFloat(e.target.value))}
                      disabled={markupFillColor === 'none'}
                      style={{ width: '80px', opacity: markupFillColor === 'none' ? 0.5 : 1 }}
                    />
                    <input 
                      type="text"
                      className="manual-input"
                      defaultValue={Math.round(markupFillOpacity * 100)}
                      key={`cloudpoly-fill-opacity-${markupFillOpacity}`}
                      disabled={markupFillColor === 'none'}
                      style={{ opacity: markupFillColor === 'none' ? 0.5 : 1 }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                      onBlur={(e) => {
                        const num = parseInt(e.target.value);
                        if (isNaN(num) || num < 10) onSetMarkupFillOpacity(0.1);
                        else if (num > 100) onSetMarkupFillOpacity(1);
                        else onSetMarkupFillOpacity(num / 100);
                      }}
                    />
                    <span>%</span>
                  </>
                ) : (
                  <>
                    <input 
                      type="number"
                      min="10"
                      max="100"
                      step="10"
                      value={Math.round(markupFillOpacity * 100)}
                      disabled={markupFillColor === 'none'}
                      onChange={(e) => {
                        const num = parseInt(e.target.value);
                        if (!isNaN(num)) {
                          if (num < 10) onSetMarkupFillOpacity(0.1);
                          else if (num > 100) onSetMarkupFillOpacity(1);
                          else onSetMarkupFillOpacity(num / 100);
                        }
                      }}
                      style={{ width: '55px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px', opacity: markupFillColor === 'none' ? 0.5 : 1 }}
                    />
                    <span>%</span>
                  </>
                )}
                <button 
                  className="ui-mode-toggle"
                  onClick={() => {
                    const newMode = penHighlighterUIMode === 'slider' ? 'compact' : 'slider';
                    onSetPenHighlighterUIMode(newMode);
                    localStorage.setItem('penHighlighterUIMode', newMode);
                  }}
                  title={penHighlighterUIMode === 'slider' ? 'Switch to compact dropdown' : 'Switch to slider'}
                  style={{ padding: '2px 5px', fontSize: '10px', background: '#444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', marginLeft: '2px' }}
                >
                  {penHighlighterUIMode === 'slider' ? '▼' : '≡'}
                </button>
              </div>
              <button 
                className="set-default-btn"
                onClick={() => {
                  localStorage.setItem('markup_cloudPolyline_defaults', JSON.stringify({ 
                    color: markupColor, 
                    strokeWidth: markupStrokeWidth,
                    strokeOpacity: markupStrokeOpacity,
                    fillColor: markupFillColor,
                    fillOpacity: markupFillOpacity,
                    arcSize: markupCloudArcSize,
                    inverted: markupCloudInverted
                  }));
                }}
                title="Save current settings as default"
              >
                ☆ Default
              </button>
              <span className="tool-hint">Click to add points. Double-click to finish. Shift = snap.</span>
            </div>
          )}
          
          {/* Text Options */}
          {!pendingPlacement && markupMode === 'text' && (
            <div className="tool-options-row">
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Line:</span>
              <div className="tool-option">
                <label>Color:</label>
                <button 
                  title="No border" className={`fill-toggle ${markupBorderColor === 'none' ? 'active' : ''}`}
                  onClick={() => onSetMarkupBorderColor(markupBorderColor === 'none' ? '#000000' : 'none')}
                ><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg></button>
                <input 
                  type="color" 
                  value={markupBorderColor === 'none' ? '#000000' : markupBorderColor} 
                  onChange={(e) => onSetMarkupBorderColor(e.target.value)}
                  style={{ opacity: markupBorderColor === 'none' ? 0.5 : 1 }}
                />
              </div>
              <div className="tool-option" style={{ opacity: markupBorderColor === 'none' ? 0.5 : 1 }}>
                <label>Width:</label>
                <select
                  value={markupBorderWidth}
                  onChange={(e) => onSetMarkupBorderWidth(parseInt(e.target.value))}
                  disabled={markupBorderColor === 'none'}
                  style={{ padding: '2px 4px', fontSize: '12px', minWidth: '55px' }}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(size => (
                    <option key={size} value={size}>{size}px</option>
                  ))}
                </select>
              </div>
              <div className="tool-option" style={{ opacity: markupBorderColor === 'none' ? 0.5 : 1 }}>
                <label>Style:</label>
                <select 
                  value={markupBorderStyle} 
                  onChange={(e) => onSetMarkupBorderStyle(e.target.value)}
                  disabled={markupBorderColor === 'none'}
                  style={{ padding: '2px 4px', fontSize: '12px' }}
                >
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                </select>
              </div>
              <div className="tool-option" style={{ opacity: markupBorderColor === 'none' ? 0.5 : 1 }}>
                <label>Opacity:</label>
                <input 
                  type="number"
                  min="10"
                  max="100"
                  step="10"
                  value={Math.round(markupBorderOpacity * 100)}
                  disabled={markupBorderColor === 'none'}
                  onChange={(e) => {
                    const num = parseInt(e.target.value);
                    if (!isNaN(num)) {
                      if (num < 10) onSetMarkupBorderOpacity(0.1);
                      else if (num > 100) onSetMarkupBorderOpacity(1);
                      else onSetMarkupBorderOpacity(num / 100);
                    }
                  }}
                  style={{ width: '50px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px' }}
                />
                <span>%</span>
              </div>
              <span style={{ color: '#666', margin: '0 4px' }}>|</span>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Fill:</span>
              <div className="tool-option">
                <label>Color:</label>
                <button 
                  title="No fill" className={`fill-toggle ${markupFillColor === 'none' ? 'active' : ''}`}
                  onClick={() => onSetMarkupFillColor(markupFillColor === 'none' ? '#ffffff' : 'none')}
                ><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5"/></svg></button>
                <input 
                  type="color" 
                  value={markupFillColor === 'none' ? '#ffffff' : markupFillColor} 
                  onChange={(e) => onSetMarkupFillColor(e.target.value)}
                  style={{ opacity: markupFillColor === 'none' ? 0.5 : 1 }}
                />
              </div>
              <div className="tool-option" style={{ opacity: markupFillColor === 'none' ? 0.5 : 1 }}>
                <label>Opacity:</label>
                <input 
                  type="number"
                  min="10"
                  max="100"
                  step="10"
                  value={Math.round(markupFillOpacity * 100)}
                  disabled={markupFillColor === 'none'}
                  onChange={(e) => {
                    const num = parseInt(e.target.value);
                    if (!isNaN(num)) {
                      if (num < 10) onSetMarkupFillOpacity(0.1);
                      else if (num > 100) onSetMarkupFillOpacity(1);
                      else onSetMarkupFillOpacity(num / 100);
                    }
                  }}
                  style={{ width: '50px', padding: '2px 4px', fontSize: '12px', textAlign: 'center', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '3px' }}
                />
                <span>%</span>
              </div>
              <span style={{ color: '#666', margin: '0 4px' }}>|</span>
              <span style={{ color: '#888', fontSize: '11px', marginRight: '4px' }}>Text:</span>
              <div className="tool-option">
                <label>Color:</label>
                <input 
                  type="color" 
                  value={markupColor} 
                  onChange={(e) => onSetMarkupColor(e.target.value)}
                />
              </div>
              <div className="tool-option">
                <label>Font:</label>
                <select 
                  value={markupFontFamily} 
                  onChange={(e) => onSetMarkupFontFamily(e.target.value)}
                  style={{ padding: '2px 4px', background: '#333', color: 'white', border: '1px solid #555', borderRadius: '3px', maxWidth: '100px', fontSize: '11px' }}
                >
                  <optgroup label="Sans-Serif">
                    <option value="Helvetica">Helvetica</option>
                    <option value="Arial">Arial</option>
                    <option value="Verdana">Verdana</option>
                    <option value="Roboto">Roboto</option>
                    <option value="Open Sans">Open Sans</option>
                  </optgroup>
                  <optgroup label="Serif">
                    <option value="Times New Roman">Times</option>
                    <option value="Georgia">Georgia</option>
                  </optgroup>
                  <optgroup label="Monospace">
                    <option value="Courier New">Courier</option>
                  </optgroup>
                </select>
              </div>
              <div className="tool-option">
                <label>Size:</label>
                <select 
                  value={markupFontSize} 
                  onChange={(e) => onSetMarkupFontSize(parseInt(e.target.value))}
                  style={{ padding: '2px 4px', background: '#333', color: 'white', border: '1px solid #555', borderRadius: '3px', fontSize: '11px' }}
                >
                  {[8, 9, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72].map(size => (
                    <option key={size} value={size}>{size}pt</option>
                  ))}
                </select>
              </div>
              <div className="tool-option">
                <label>Align:</label>
                <div style={{ display: 'flex', gap: '2px' }}>
                  <button 
                    onClick={() => onSetMarkupTextAlign('left')}
                    title="Align Left"
                    style={{ padding: '2px 5px', background: markupTextAlign === 'left' ? '#3498db' : '#444', border: 'none', borderRadius: '3px', color: 'white', cursor: 'pointer', fontSize: '10px' }}
                  >≡</button>
                  <button 
                    onClick={() => onSetMarkupTextAlign('center')}
                    title="Align Center"
                    style={{ padding: '2px 5px', background: markupTextAlign === 'center' ? '#3498db' : '#444', border: 'none', borderRadius: '3px', color: 'white', cursor: 'pointer', fontSize: '10px' }}
                  >☰</button>
                  <button 
                    onClick={() => onSetMarkupTextAlign('right')}
                    title="Align Right"
                    style={{ padding: '2px 5px', background: markupTextAlign === 'right' ? '#3498db' : '#444', border: 'none', borderRadius: '3px', color: 'white', cursor: 'pointer', fontSize: '10px' }}
                  >⫶</button>
                </div>
              </div>
              <div className="tool-option">
                <label>V:</label>
                <div style={{ display: 'flex', gap: '2px' }}>
                  <button 
                    onClick={() => onSetMarkupVerticalAlign('top')}
                    title="Align Top"
                    style={{ padding: '2px 5px', background: markupVerticalAlign === 'top' ? '#3498db' : '#444', border: 'none', borderRadius: '3px', color: 'white', cursor: 'pointer', fontSize: '9px' }}
                  >⊤</button>
                  <button 
                    onClick={() => onSetMarkupVerticalAlign('middle')}
                    title="Align Middle"
                    style={{ padding: '2px 5px', background: markupVerticalAlign === 'middle' ? '#3498db' : '#444', border: 'none', borderRadius: '3px', color: 'white', cursor: 'pointer', fontSize: '9px' }}
                  >⊝</button>
                  <button 
                    onClick={() => onSetMarkupVerticalAlign('bottom')}
                    title="Align Bottom"
                    style={{ padding: '2px 5px', background: markupVerticalAlign === 'bottom' ? '#3498db' : '#444', border: 'none', borderRadius: '3px', color: 'white', cursor: 'pointer', fontSize: '9px' }}
                  >⊥</button>
                </div>
              </div>
              <div className="tool-option">
                <label>Pad:</label>
                <select 
                  value={markupTextPadding} 
                  onChange={(e) => onSetMarkupTextPadding(parseInt(e.target.value))}
                  style={{ padding: '2px 4px', background: '#333', color: 'white', border: '1px solid #555', borderRadius: '3px', fontSize: '11px' }}
                >
                  {[0, 2, 4, 6, 8, 10, 12, 16, 20].map(p => (
                    <option key={p} value={p}>{p}px</option>
                  ))}
                </select>
              </div>
              <button 
                className="set-default-btn"
                onClick={(e) => {
                  localStorage.setItem('markup_text_defaults', JSON.stringify({ 
                    color: markupColor, 
                    fillColor: markupFillColor, 
                    fillOpacity: markupFillOpacity,
                    borderColor: markupBorderColor, 
                    borderWidth: markupBorderWidth,
                    borderStyle: markupBorderStyle,
                    borderOpacity: markupBorderOpacity,
                    fontSize: markupFontSize,
                    fontFamily: markupFontFamily,
                    textAlign: markupTextAlign,
                    verticalAlign: markupVerticalAlign,
                    padding: markupTextPadding
                  }));
                  const btn = e.target;
                  btn.textContent = '✓';
                  btn.style.background = '#27ae60';
                  setTimeout(() => {
                    btn.textContent = '☆ Default';
                    btn.style.background = '';
                  }, 1500);
                }}
                title="Save current settings as default"
              >
                ☆ Default
              </button>
            </div>
          )}
          
          {/* Callout Options */}
          {!pendingPlacement && markupMode === 'callout' && (
            <div className="tool-options-row">
              <div className="tool-option">
                <label>Text:</label>
                <input 
                  type="color" 
                  value={markupColor} 
                  onChange={(e) => onSetMarkupColor(e.target.value)}
                />
              </div>
              <div className="tool-option">
                <label>Fill:</label>
                <input 
                  type="color" 
                  value={markupFillColor === 'none' ? '#ffffcc' : markupFillColor} 
                  onChange={(e) => onSetMarkupFillColor(e.target.value)}
                />
              </div>
              <div className="tool-option">
                <label>Size:</label>
                <select 
                  value={markupFontSize} 
                  onChange={(e) => onSetMarkupFontSize(parseInt(e.target.value))}
                  style={{ padding: '4px', background: '#333', color: 'white', border: '1px solid #555', borderRadius: '4px' }}
                >
                  {[8, 9, 10, 12, 14, 16, 18, 20, 24].map(size => (
                    <option key={size} value={size}>{size}pt</option>
                  ))}
                </select>
              </div>
              <button 
                className="set-default-btn"
                onClick={() => {
                  localStorage.setItem('markup_callout_defaults', JSON.stringify({ color: markupColor, fillColor: markupFillColor, fontSize: markupFontSize }));
                }}
                title="Save current settings as default"
              >
                ☆ Default
              </button>
            </div>
          )}
          
          {/* Note Options */}
          {!pendingPlacement && markupMode === 'note' && (
            <div className="tool-options-row">
              <div className="tool-option">
                <label>Color:</label>
                {['#ffeb3b', '#ff9800', '#4caf50', '#2196f3', '#9c27b0', '#f44336'].map(color => (
                  <button
                    key={color}
                    onClick={() => onSetMarkupColor(color)}
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '4px',
                      background: color,
                      border: markupColor === color ? '2px solid white' : '1px solid #555',
                      cursor: 'pointer',
                      marginRight: '4px'
                    }}
                  />
                ))}
              </div>
              <button 
                className="set-default-btn"
                onClick={() => {
                  localStorage.setItem('markup_note_defaults', JSON.stringify({ color: markupColor }));
                }}
                title="Save current settings as default"
              >
                ☆ Default
              </button>
            </div>
          )}
          
          {/* Eraser - no options */}
          {!pendingPlacement && markupMode === 'eraser' && (
            <div className="tool-options-row">
              <span className="tool-hint">Click on markups to delete them</span>
            </div>
          )}
          
          {/* Unlock/Lock toggle - always on right */}
          <button 
            className={`unlock-btn ${markupEditMode ? 'unlocked' : ''}`}
            onClick={async () => {
              if (markupEditMode) {
                // Locking - check for unsaved changes
                const currentFileMarkups = markups.filter(m => m.filename === currentFileIdentifier);
                const newMarkups = currentFileMarkups.filter(m => !m.fromPdf && !m.savedAt);
                const modifiedMarkups = currentFileMarkups.filter(m => m.fromPdf && m.modified);
                const hasUnsavedChanges = newMarkups.length > 0 || modifiedMarkups.length > 0 ||
                  (deletedPdfAnnotations && deletedPdfAnnotations.get(currentFileIdentifier)?.size > 0);
                
                if (hasUnsavedChanges) {
                  const deletedCount = deletedPdfAnnotations?.get(currentFileIdentifier)?.size || 0;
                  // Show save/discard dialog
                  const saveChanges = window.confirm(
                    `You have unsaved changes (${newMarkups.length} new, ${modifiedMarkups.length} modified${deletedCount > 0 ? `, ${deletedCount} deleted` : ''}).\n\nDo you want to save changes?\n\nClick OK to save, or Cancel to discard changes.`
                  );
                  
                  if (saveChanges) {
                    // Save to the actual file and lock
                    try {
                      await onSaveMarkupsToPdf(false, true); // saveInPlace = true
                      onSetMarkupEditMode(false);
                      onSetShowMarkupsPanel(false);
                      if (onSetShowMarkupHistoryPanel) onSetShowMarkupHistoryPanel(false);
                      onSetMarkupMode(null);
                      onSetSelectedMarkup(null);
                    } catch (err) {
                      console.error('Failed to save:', err);
                      alert('Failed to save changes: ' + err.message);
                      return; // Don't lock if save failed
                    }
                  } else {
                    // Discard changes - ask for confirmation
                    const discardConfirm = window.confirm(
                      'Are you sure you want to discard all unsaved changes?\n\nThis cannot be undone.'
                    );
                    if (discardConfirm) {
                      // Remove new markups (not from PDF)
                      onSetMarkups(prev => prev.filter(m => m.filename !== currentFileIdentifier || m.fromPdf));
                      // Clear unsaved status for this file
                      onSetUnsavedMarkupFiles(prev => {
                        const next = new Set(prev);
                        next.delete(currentFileIdentifier);
                        return next;
                      });
                      // Clear deleted PDF annotations for this file
                      if (onSetDeletedPdfAnnotations) {
                        onSetDeletedPdfAnnotations(prev => {
                          const next = new Map(prev);
                          next.delete(currentFileIdentifier);
                          return next;
                        });
                      }
                      // Reset modified flag on PDF markups and reload
                      onSetHasLoadedAnnotations(false);
                      onSetOwnedPdfAnnotationIds(new Set());
                      onSetMarkupEditMode(false);
                      onSetShowMarkupsPanel(false);
                      if (onSetShowMarkupHistoryPanel) onSetShowMarkupHistoryPanel(false);
                      onSetMarkupMode(null);
                      onSetSelectedMarkup(null);
                      // Reload annotations from PDF to restore original state
                      setTimeout(() => {
                        onLoadAnnotationsFromPdf();
                      }, 100);
                    }
                    // If user cancels discard, stay in edit mode
                  }
                } else {
                  // No unsaved changes - just lock
                  onSetMarkupEditMode(false);
                  onSetShowMarkupsPanel(false);
                  if (onSetShowMarkupHistoryPanel) onSetShowMarkupHistoryPanel(false);
                  onSetMarkupMode(null);
                  onSetSelectedMarkup(null);
                }
              } else {
                // Unlocking
                onSetMarkupEditMode(true);
                if (!hasLoadedAnnotations) {
                  onLoadAnnotationsFromPdf();
                }
              }
            }}
            disabled={!pdfDoc}
            title={markupEditMode ? "Lock PDF (save or discard changes)" : "Unlock PDF for editing"}
          >
            {markupEditMode ? '🔓 Document Unlocked' : '🔒 Document Locked'}
          </button>
        </div>
  );
}
