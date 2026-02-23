/**
 * OCRPanel.jsx
 * 
 * Panel for OCR - extracting text from PDF pages including pipe tags.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';

// Simple text matching function
// matchType: 'contains' | 'starts' | 'ends' | 'exact' | 'pattern'
function matchText(text, searchText, matchType) {
  if (!text || !searchText) return false;
  
  if (matchType === 'pattern') {
    return matchPattern(text, searchText);
  }
  
  const normalizedText = text.toLowerCase();
  const normalizedSearch = searchText.toLowerCase();
  
  switch (matchType) {
    case 'starts':
      return normalizedText.startsWith(normalizedSearch);
    case 'ends':
      return normalizedText.endsWith(normalizedSearch);
    case 'exact':
      return normalizedText === normalizedSearch;
    case 'contains':
    default:
      return normalizedText.includes(normalizedSearch);
  }
}

// Pattern matching: searches WITHIN text for the pattern.
// "2000-F28-PID-PR-10201" pattern will find that substring inside longer OCR text.
function matchPattern(text, formatExample) {
  if (!text || !formatExample) return false;
  const pattern = formatExampleToRegex(formatExample);
  if (!pattern) return false;
  try {
    return new RegExp(pattern, 'i').test(text);
  } catch { return false; }
}

// Extract the portion of text that matches the pattern, with position info
function extractPatternMatch(text, formatExample) {
  if (!text || !formatExample) return { text, start: 0, length: text?.length || 0 };
  const pattern = formatExampleToRegex(formatExample);
  if (!pattern) return { text, start: 0, length: text.length };
  try {
    const match = text.match(new RegExp(pattern, 'i'));
    if (match) return { text: match[0], start: match.index, length: match[0].length };
    return { text, start: 0, length: text.length };
  } catch { return { text, start: 0, length: text.length }; }
}

// Split text into [before, match, after] for highlighting
// Returns { before, match, after } or null if no match
function getMatchParts(text, searchText, matchType) {
  if (!text || !searchText) return null;
  
  if (matchType === 'pattern') {
    const pattern = formatExampleToRegex(searchText);
    if (!pattern) return null;
    try {
      const regex = new RegExp(pattern, 'i');
      const m = text.match(regex);
      if (!m) return null;
      const idx = m.index;
      return {
        before: text.slice(0, idx),
        match: m[0],
        after: text.slice(idx + m[0].length),
      };
    } catch { return null; }
  }
  
  const lt = text.toLowerCase();
  const ls = searchText.toLowerCase();
  let idx = -1;
  let len = searchText.length;
  
  switch (matchType) {
    case 'exact': idx = lt === ls ? 0 : -1; len = text.length; break;
    case 'starts': idx = lt.startsWith(ls) ? 0 : -1; break;
    case 'ends': idx = lt.endsWith(ls) ? text.length - len : -1; break;
    case 'contains': default: idx = lt.indexOf(ls); break;
  }
  
  if (idx === -1) return null;
  return {
    before: text.slice(0, idx),
    match: text.slice(idx, idx + len),
    after: text.slice(idx + len),
  };
}

// Convert format example to regex (no anchors - searches within text)
// "FI-12345" -> "[A-Za-z][A-Za-z]\\-[0-9][0-9][0-9][0-9][0-9]"
function formatExampleToRegex(fmt) {
  if (!fmt) return null;
  let p = '';
  for (const ch of fmt) {
    if (/[A-Za-z]/.test(ch)) p += '[A-Za-z]';
    else if (/[0-9]/.test(ch)) p += '[0-9]';
    else p += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return p;
}

// Display pattern: "FI-12345" -> "LL-NNNNN"
function formatToDisplay(fmt) {
  if (!fmt) return '';
  return fmt.replace(/[A-Za-z]/g, 'L').replace(/[0-9]/g, 'N');
}

export default function OCRPanel({
  isOpen,
  onClose,
  showOcrOnPdf,
  onShowOcrOnPdfChange,
  ocrScope,
  onOcrScopeChange,
  currentFile,
  numPages,
  currentPage,
  currentFolderInfo,
  projectFileCount,
  isRunningOcr,
  ocrProgress,
  ocrResults,
  ocrResultsCount,
  ocrFilter,
  onOcrFilterChange,
  ocrFilterType,
  onOcrFilterTypeChange,
  onRunOcr,
  onCancelOcr,
  onExportOcr,
  onExportToObjects,
  onExportToLinks,
  includeOcrInSearch,
  onIncludeOcrInSearchChange,
  existingClasses = [],
  allFiles = [],
  ocrResultsByFile = {},
}) {
  // Export to Objects dialog state
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [matchType, setMatchType] = useState('contains');
  const [exportClassName, setExportClassName] = useState('');
  const [useExistingClass, setUseExistingClass] = useState(false);
  const [selectedExistingClass, setSelectedExistingClass] = useState('');
  
  // Export to Links dialog state
  const [showLinksDialog, setShowLinksDialog] = useState(false);
  const [linksSearchText, setLinksSearchText] = useState('');
  const [linksMatchType, setLinksMatchType] = useState('pattern');
  const [linksAssignMode, setLinksAssignMode] = useState('name');
  const [linksPropertyName, setLinksPropertyName] = useState('');
  
  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [debouncedLinksSearch, setDebouncedLinksSearch] = useState('');
  const searchTimeoutRef = useRef(null);
  const linksSearchTimeoutRef = useRef(null);
  
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setDebouncedSearch(searchText), 300);
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); };
  }, [searchText]);

  useEffect(() => {
    if (linksSearchTimeoutRef.current) clearTimeout(linksSearchTimeoutRef.current);
    linksSearchTimeoutRef.current = setTimeout(() => setDebouncedLinksSearch(linksSearchText), 300);
    return () => { if (linksSearchTimeoutRef.current) clearTimeout(linksSearchTimeoutRef.current); };
  }, [linksSearchText]);

  // Available property names
  const availableProperties = useMemo(() => {
    const propSet = new Set();
    allFiles.forEach(f => {
      if (f.extractedProperties) Object.keys(f.extractedProperties).forEach(k => propSet.add(k));
    });
    return Array.from(propSet).sort();
  }, [allFiles]);

  // Helper: get match position info for an already-matched item
  const getMatchPosition = useCallback((text, search, type) => {
    if (!text || !search) return { extractedText: text, matchStart: 0, matchLength: text?.length || 0 };
    if (type === 'pattern') {
      const pattern = formatExampleToRegex(search);
      if (pattern) {
        try {
          const m = text.match(new RegExp(pattern, 'i'));
          if (m) return { extractedText: m[0], matchStart: m.index, matchLength: m[0].length };
        } catch {}
      }
      return { extractedText: text, matchStart: 0, matchLength: text.length };
    }
    const lt = text.toLowerCase();
    const ls = search.toLowerCase();
    let idx = -1;
    switch (type) {
      case 'starts': idx = lt.startsWith(ls) ? 0 : -1; break;
      case 'ends': idx = lt.endsWith(ls) ? text.length - search.length : -1; break;
      case 'exact': return { extractedText: text, matchStart: 0, matchLength: text.length };
      case 'contains': default: idx = lt.indexOf(ls); break;
    }
    if (idx === -1) return { extractedText: text, matchStart: 0, matchLength: text.length };
    return { extractedText: text.slice(idx, idx + search.length), matchStart: idx, matchLength: search.length };
  }, []);

  // Matching items for objects export (current file only)
  const matchingItems = useMemo(() => {
    if (!showExportDialog || !debouncedSearch.trim()) return [];
    const items = [];
    for (const item of ocrResults.slice(0, 5000)) {
      if (items.length >= 1000) break;
      if (matchText(item.text, debouncedSearch, matchType)) {
        items.push({ ...item, ...getMatchPosition(item.text, debouncedSearch, matchType) });
      }
    }
    return items;
  }, [showExportDialog, ocrResults, debouncedSearch, matchType, getMatchPosition]);

  // Matching items for links export (ALL files)
  const linksMatchingItems = useMemo(() => {
    if (!showLinksDialog || !debouncedLinksSearch.trim()) return [];
    const items = [];
    for (const [filename, fileResults] of Object.entries(ocrResultsByFile)) {
      if (items.length >= 5000) break;
      for (const item of fileResults) {
        if (items.length >= 5000) break;
        if (matchText(item.text, debouncedLinksSearch, linksMatchType)) {
          items.push({ ...item, ...getMatchPosition(item.text, debouncedLinksSearch, linksMatchType), sourceFilename: filename });
        }
      }
    }
    return items;
  }, [showLinksDialog, ocrResultsByFile, debouncedLinksSearch, linksMatchType, getMatchPosition]);

  // Preview link targets (first 20)
  const linksWithTargets = useMemo(() => {
    if (!showLinksDialog || linksMatchingItems.length === 0) return [];
    return linksMatchingItems.slice(0, 20).map(item => {
      const ocrText = item.extractedText || item.text;
      let targetFile = null;
      if (linksAssignMode === 'name') {
        targetFile = allFiles.find(f =>
          f.name?.toLowerCase().includes(ocrText.toLowerCase()) ||
          f.backendFilename?.toLowerCase().includes(ocrText.toLowerCase())
        );
      } else if (linksAssignMode === 'property' && linksPropertyName) {
        targetFile = allFiles.find(f => {
          const pv = f.extractedProperties?.[linksPropertyName];
          if (!pv) return false;
          return pv.toLowerCase().includes(ocrText.toLowerCase()) || ocrText.toLowerCase().includes(pv.toLowerCase());
        });
      }
      return { ...item, targetFileId: targetFile?.id || null, targetFilename: targetFile?.name || null };
    });
  }, [showLinksDialog, linksMatchingItems, linksAssignMode, linksPropertyName, allFiles]);

  const matchingCount = matchingItems.length;
  const linksMatchingCount = linksMatchingItems.length;
  const linksAssignedCount = linksWithTargets.filter(l => l.targetFileId).length;
  const previewItems = useMemo(() => matchingItems.slice(0, 10), [matchingItems]);

  const resetDialog = useCallback(() => {
    setSearchText(''); setDebouncedSearch(''); setMatchType('contains');
    setExportClassName(''); setUseExistingClass(false); setSelectedExistingClass('');
  }, []);

  const resetLinksDialog = useCallback(() => {
    setLinksSearchText(''); setDebouncedLinksSearch(''); setLinksMatchType('pattern');
    setLinksAssignMode('name'); setLinksPropertyName('');
  }, []);

  const handleExportToObjects = useCallback(() => {
    const className = useExistingClass ? selectedExistingClass : exportClassName.trim();
    if (!className || matchingItems.length === 0) return;
    if (onExportToObjects) onExportToObjects({ className, isNewClass: !useExistingClass, items: matchingItems });
    setShowExportDialog(false);
    resetDialog();
  }, [useExistingClass, selectedExistingClass, exportClassName, matchingItems, onExportToObjects, resetDialog]);

  const handleExportToLinks = useCallback(() => {
    if (linksMatchingItems.length === 0 || !onExportToLinks) return;
    onExportToLinks({
      items: linksMatchingItems,
      assignMode: linksAssignMode,
      propertyName: linksAssignMode === 'property' ? linksPropertyName : null,
    });
    setShowLinksDialog(false);
    resetLinksDialog();
  }, [linksMatchingItems, linksAssignMode, linksPropertyName, onExportToLinks, resetLinksDialog]);

  if (!isOpen) return null;

  // Shared search UI
  const renderSearchSection = (search, setSearch, type, setType, debounced, label) => (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold', color: '#ccc' }}>{label}</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(type === 'pattern' ? e.target.value.toUpperCase() : e.target.value)}
          placeholder={type === 'pattern' ? "Format example e.g. FI-12345" : "Enter text to search..."}
          autoFocus
          style={{ flex: 1, padding: '8px 12px', background: '#1a1a1a', border: '1px solid #444', borderRadius: 4, color: 'white', fontFamily: type === 'pattern' ? 'monospace' : 'inherit' }}
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          style={{ padding: '8px 12px', background: '#1a1a1a', border: '1px solid #444', borderRadius: 4, color: 'white', minWidth: 120 }}
        >
          <option value="pattern">Pattern</option>
          <option value="contains">Contains</option>
          <option value="starts">Starts with</option>
          <option value="ends">Ends with</option>
          <option value="exact">Exact match</option>
        </select>
      </div>
      {type === 'pattern' && search && (
        <div style={{ padding: '4px 8px', background: 'rgba(52,152,219,0.15)', border: '1px solid rgba(52,152,219,0.3)', borderRadius: 4, fontSize: 11, color: '#3498db', fontFamily: 'monospace' }}>
          Pattern: {formatToDisplay(search)} &nbsp;(L=letter, N=number, others literal)
        </div>
      )}
    </div>
  );

  return (
    <div className="smart-links-panel ocr-panel">
      <div className="panel-header">
        <h3>OCR</h3>
        <button className="close-panel" onClick={onClose}>×</button>
      </div>

      <div className="panel-content">
        {/* Display Options */}
        <div className="panel-section">
          <h4>Display Options</h4>
          <label className="toggle-option" style={{ marginBottom: 8 }}>
            <input type="checkbox" checked={showOcrOnPdf} onChange={(e) => onShowOcrOnPdfChange(e.target.checked)} />
            <span>Show OCR Boxes on Document</span>
          </label>
          <label className="toggle-option">
            <input type="checkbox" checked={includeOcrInSearch} onChange={(e) => onIncludeOcrInSearchChange(e.target.checked)} />
            <span>Include OCR in Search Results</span>
          </label>
        </div>

        {/* Run OCR Section */}
        <div className="panel-section">
          <h4>Run OCR</h4>
          <div className="option-group" style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: '#888' }}>Scope:</label>
            <select value={ocrScope} onChange={(e) => onOcrScopeChange(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 4, border: '1px solid #444', background: '#2a2a2a', color: 'white' }} disabled={isRunningOcr}>
              {numPages > 1 && <option value="current">Current Page ({currentPage})</option>}
              <option value="document">{numPages > 1 ? `All Pages (1-${numPages})` : 'Current Document'}</option>
              {currentFolderInfo?.folder && currentFolderInfo.folderFileCount > 1 && (
                <option value="folder">{currentFolderInfo.folder.name || 'Current Folder'} ({currentFolderInfo.folderFileCount} files)</option>
              )}
              {projectFileCount > 1 && <option value="project">Whole Project ({projectFileCount} files)</option>}
            </select>
          </div>
          {(ocrScope === 'folder' || ocrScope === 'project') && !isRunningOcr && (
            <div style={{ background: 'rgba(255,193,7,0.15)', border: '1px solid rgba(255,193,7,0.4)', borderRadius: 4, padding: '8px 10px', marginBottom: 12, fontSize: 11, color: '#ffc107' }}>
              ⚠️ This may take a while. You can continue working while OCR runs in the background.
            </div>
          )}
          {!isRunningOcr ? (
            <button className="primary-btn run-ocr-btn" onClick={onRunOcr} disabled={!currentFile}
              style={{ width: '100%', padding: '10px 16px', background: '#3498db', border: 'none', borderRadius: 4, color: 'white', cursor: currentFile ? 'pointer' : 'not-allowed', opacity: currentFile ? 1 : 0.6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="white" strokeWidth="1.5"/><path d="M11 11L14 14" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
              Run OCR
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, padding: '10px 16px', background: '#2a2a2a', border: '1px solid #444', borderRadius: 4, color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{ display: 'inline-block', width: 16, height: 16 }}>⏳</span> Running...
              </div>
              <button onClick={onCancelOcr} style={{ padding: '10px 16px', background: '#3a3a3a', border: '1px solid #555', borderRadius: 4, color: '#ccc', cursor: 'pointer' }}>Cancel</button>
            </div>
          )}
          {isRunningOcr && ocrProgress && (
            <div className="detection-progress" style={{ marginTop: 12 }}>
              <div className="progress-bar-container" style={{ background: '#444', borderRadius: 4, height: 8, overflow: 'hidden', marginBottom: 6 }}>
                <div className="progress-bar-fill" style={{ background: '#3498db', height: '100%', width: `${ocrProgress.percent || 0}%`, transition: 'width 0.3s ease' }} />
              </div>
              <div className="progress-status" style={{ fontSize: 11, color: '#888' }}>{ocrProgress.status || 'Processing...'}</div>
            </div>
          )}
          {ocrResultsCount > 0 && !isRunningOcr && (
            <div style={{ marginTop: 10, padding: '6px 10px', background: 'rgba(39,174,96,0.15)', border: '1px solid rgba(39,174,96,0.4)', borderRadius: 4, fontSize: 11, color: '#27ae60' }}>
              ✓ {ocrResultsCount} text items found across all processed pages
            </div>
          )}
        </div>

        {/* Export Section */}
        <div className="panel-section">
          <button onClick={() => setShowExportDialog(true)} disabled={ocrResults.length === 0}
            style={{ width: '100%', padding: '10px 16px', background: ocrResults.length === 0 ? '#2a2a2a' : '#3a3a3a', border: '1px solid #555', borderRadius: 4, color: ocrResults.length === 0 ? '#666' : '#fff', cursor: ocrResults.length === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none"/><path d="M8 8V15" stroke="currentColor" strokeWidth="1.5"/><path d="M8 8L14 4.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8 8L2 4.5" stroke="currentColor" strokeWidth="1.5"/></svg>
            Export to Objects
          </button>
          <button onClick={() => setShowLinksDialog(true)} disabled={ocrResultsCount === 0}
            style={{ width: '100%', padding: '10px 16px', background: ocrResultsCount === 0 ? '#2a2a2a' : '#3a3a3a', border: '1px solid #555', borderRadius: 4, color: ocrResultsCount === 0 ? '#666' : '#fff', cursor: ocrResultsCount === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6.5 9.5L9.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M10 7L12.5 4.5C13.3 3.7 13.3 2.3 12.5 1.5C11.7 0.7 10.3 0.7 9.5 1.5L7 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M6 9L3.5 11.5C2.7 12.3 2.7 13.7 3.5 14.5C4.3 15.3 5.7 15.3 6.5 14.5L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            Export to Links
          </button>
        </div>
      </div>

      {/* Export to Objects Dialog */}
      {showExportDialog && (
        <div className="modal-overlay" onClick={() => { setShowExportDialog(false); resetDialog(); }}>
          <div className="modal export-ocr-modal" onClick={(e) => e.stopPropagation()} style={{ background: '#2a2a2a', borderRadius: 8, padding: 20, minWidth: 400, maxWidth: 500, color: 'white' }}>
            <h2 style={{ marginTop: 0, marginBottom: 16, color: '#fff', fontWeight: 'bold' }}>Export to Objects</h2>
            {renderSearchSection(searchText, setSearchText, matchType, setMatchType, debouncedSearch, 'Find Text:')}
            <div style={{ background: '#1a1a1a', borderRadius: 4, padding: 12, marginBottom: 16, maxHeight: 150, overflowY: 'auto' }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                Matching: <strong style={{ color: matchingCount > 0 ? '#27ae60' : '#e74c3c' }}>{matchingCount}{matchingCount >= 1000 ? '+' : ''}</strong> items
                {debouncedSearch !== searchText && <span style={{ marginLeft: 8, fontSize: 10, color: '#666' }}>searching...</span>}
              </div>
              {matchingCount > 0 && (
                <div style={{ fontSize: 11, color: '#aaa' }}>
                  {previewItems.map((item, i) => (
                    <div key={i} style={{ padding: '2px 0', fontSize: 11 }}>
                      • {(() => {
                        const parts = getMatchParts(item.text, debouncedSearch, matchType);
                        if (parts) return (<>
                          <span style={{ color: '#888' }}>{parts.before}</span>
                          <span style={{ color: '#27ae60', fontWeight: 'bold' }}>{parts.match}</span>
                          <span style={{ color: '#888' }}>{parts.after}</span>
                        </>);
                        return <span style={{ color: '#27ae60' }}>{item.text}</span>;
                      })()}
                      <span style={{ color: '#555', marginLeft: 4 }}>P{item.page}</span>
                    </div>
                  ))}
                  {matchingCount > 10 && <div style={{ color: '#666', fontStyle: 'italic' }}>...and {matchingCount - 10} more</div>}
                </div>
              )}
              {searchText && matchingCount === 0 && debouncedSearch === searchText && <div style={{ fontSize: 11, color: '#888' }}>No matches found</div>}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold', color: '#ccc' }}>Assign to Class:</label>
              {existingClasses.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
                    <input type="radio" checked={!useExistingClass} onChange={() => setUseExistingClass(false)} /><span>Create new class</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="radio" checked={useExistingClass} onChange={() => setUseExistingClass(true)} /><span>Use existing class</span>
                  </label>
                </div>
              )}
              {!useExistingClass ? (
                <input type="text" value={exportClassName} onChange={(e) => setExportClassName(e.target.value)} placeholder="Enter new class name (e.g., Pipe Tags)"
                  style={{ width: '100%', padding: '8px 12px', background: '#1a1a1a', border: '1px solid #444', borderRadius: 4, color: 'white', boxSizing: 'border-box' }} />
              ) : (
                <select value={selectedExistingClass} onChange={(e) => setSelectedExistingClass(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', background: '#1a1a1a', border: '1px solid #444', borderRadius: 4, color: 'white' }}>
                  <option value="">-- Select class --</option>
                  {existingClasses.map(cls => <option key={cls.id || cls.name} value={cls.name}>{cls.name}</option>)}
                </select>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowExportDialog(false); resetDialog(); }}
                style={{ background: '#444', border: 'none', borderRadius: 4, color: 'white', padding: '10px 20px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleExportToObjects}
                disabled={matchingCount === 0 || (!useExistingClass && !exportClassName.trim()) || (useExistingClass && !selectedExistingClass)}
                style={{ background: matchingCount > 0 && ((!useExistingClass && exportClassName.trim()) || (useExistingClass && selectedExistingClass)) ? '#27ae60' : '#555', border: 'none', borderRadius: 4, color: 'white', padding: '10px 20px', cursor: matchingCount > 0 ? 'pointer' : 'not-allowed', opacity: matchingCount > 0 && ((!useExistingClass && exportClassName.trim()) || (useExistingClass && selectedExistingClass)) ? 1 : 0.6 }}>
                Export {matchingCount} Objects
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export to Links Dialog */}
      {showLinksDialog && (
        <div className="modal-overlay" onClick={() => { setShowLinksDialog(false); resetLinksDialog(); }}>
          <div className="modal export-ocr-modal" onClick={(e) => e.stopPropagation()} style={{ background: '#2a2a2a', borderRadius: 8, padding: 20, minWidth: 440, maxWidth: 540, color: 'white' }}>
            <h2 style={{ marginTop: 0, marginBottom: 4, color: '#fff', fontWeight: 'bold' }}>Export to Links</h2>
            <p style={{ marginTop: 0, marginBottom: 16, fontSize: 12, color: '#888' }}>
              Find OCR text matching a pattern and create document links. Searches all files with OCR results.
            </p>
            {renderSearchSection(linksSearchText, setLinksSearchText, linksMatchType, setLinksMatchType, debouncedLinksSearch, 'Find Text:')}
            <div style={{ background: '#1a1a1a', borderRadius: 4, padding: 12, marginBottom: 16, maxHeight: 160, overflowY: 'auto' }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                Matching: <strong style={{ color: linksMatchingCount > 0 ? '#27ae60' : '#e74c3c' }}>{linksMatchingCount}{linksMatchingCount >= 5000 ? '+' : ''}</strong> items
                {Object.keys(ocrResultsByFile).length > 1 && <span style={{ color: '#666' }}> across {Object.keys(ocrResultsByFile).length} files</span>}
                {debouncedLinksSearch !== linksSearchText && <span style={{ marginLeft: 8, fontSize: 10, color: '#666' }}>searching...</span>}
              </div>
              {linksWithTargets.length > 0 && (
                <div style={{ fontSize: 11, color: '#aaa' }}>
                  {linksWithTargets.map((item, i) => (
                    <div key={i} style={{ padding: '3px 0', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'monospace' }}>{(() => {
                        const parts = getMatchParts(item.text, debouncedLinksSearch, linksMatchType);
                        if (parts) return (<>
                          <span style={{ color: '#888' }}>{parts.before}</span>
                          <span style={{ color: '#27ae60', fontWeight: 'bold' }}>{parts.match}</span>
                          <span style={{ color: '#888' }}>{parts.after}</span>
                        </>);
                        return <span style={{ color: '#27ae60' }}>{item.text}</span>;
                      })()}</span>
                      <span style={{ color: '#555' }}>→</span>
                      {item.targetFilename
                        ? <span style={{ color: '#3498db', fontSize: 10 }}>{item.targetFilename}</span>
                        : <span style={{ color: '#666', fontSize: 10, fontStyle: 'italic' }}>no match</span>}
                      <span style={{ color: '#555', fontSize: 10, marginLeft: 'auto' }}>P{item.page}</span>
                    </div>
                  ))}
                  {linksMatchingCount > 20 && <div style={{ color: '#666', fontStyle: 'italic', marginTop: 4 }}>...and {linksMatchingCount - 20} more</div>}
                </div>
              )}
              {linksSearchText && linksMatchingCount === 0 && debouncedLinksSearch === linksSearchText && <div style={{ fontSize: 11, color: '#888' }}>No matches found</div>}
            </div>

            {/* Assignment Mode */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold', color: '#ccc' }}>How to assign link targets?</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '8px 12px',
                  background: linksAssignMode === 'name' ? 'rgba(52,152,219,0.15)' : '#1a1a1a',
                  border: `1px solid ${linksAssignMode === 'name' ? 'rgba(52,152,219,0.5)' : '#333'}`, borderRadius: 4 }}>
                  <input type="radio" checked={linksAssignMode === 'name'} onChange={() => setLinksAssignMode('name')} />
                  <div>
                    <div style={{ fontSize: 13, color: '#ddd' }}>Document Name</div>
                    <div style={{ fontSize: 11, color: '#888' }}>Match OCR text against file names in the project</div>
                  </div>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '8px 12px',
                  background: linksAssignMode === 'property' ? 'rgba(52,152,219,0.15)' : '#1a1a1a',
                  border: `1px solid ${linksAssignMode === 'property' ? 'rgba(52,152,219,0.5)' : '#333'}`, borderRadius: 4 }}>
                  <input type="radio" checked={linksAssignMode === 'property'} onChange={() => setLinksAssignMode('property')} />
                  <div>
                    <div style={{ fontSize: 13, color: '#ddd' }}>Document Property</div>
                    <div style={{ fontSize: 11, color: '#888' }}>Match OCR text against extracted document properties</div>
                  </div>
                </label>
              </div>
              {linksAssignMode === 'property' && (
                <div style={{ marginTop: 10 }}>
                  <select value={linksPropertyName} onChange={(e) => setLinksPropertyName(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', background: '#1a1a1a', border: '1px solid #444', borderRadius: 4, color: 'white' }}>
                    <option value="">-- Select property --</option>
                    {availableProperties.map(prop => <option key={prop} value={prop}>{prop}</option>)}
                  </select>
                  {availableProperties.length === 0 && (
                    <div style={{ fontSize: 11, color: '#e74c3c', marginTop: 4 }}>No extracted properties found. Run property extraction on your documents first.</div>
                  )}
                </div>
              )}
            </div>

            {linksMatchingCount > 0 && (
              <div style={{ padding: '8px 12px', background: 'rgba(52,152,219,0.1)', border: '1px solid rgba(52,152,219,0.3)', borderRadius: 4, marginBottom: 16, fontSize: 12, color: '#3498db' }}>
                {linksAssignedCount} of {Math.min(linksWithTargets.length, linksMatchingCount)} previewed items matched to target files.
                Links without a match will be created as unassigned (assignable later).
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowLinksDialog(false); resetLinksDialog(); }}
                style={{ background: '#444', border: 'none', borderRadius: 4, color: 'white', padding: '10px 20px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleExportToLinks}
                disabled={linksMatchingCount === 0 || (linksAssignMode === 'property' && !linksPropertyName)}
                style={{ background: linksMatchingCount > 0 && (linksAssignMode !== 'property' || linksPropertyName) ? '#3498db' : '#555', border: 'none', borderRadius: 4, color: 'white', padding: '10px 20px', cursor: linksMatchingCount > 0 ? 'pointer' : 'not-allowed', opacity: linksMatchingCount > 0 && (linksAssignMode !== 'property' || linksPropertyName) ? 1 : 0.6 }}>
                Export {linksMatchingCount} Links
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
