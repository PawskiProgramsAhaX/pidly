/**
 * SearchPanel.jsx
 * 
 * Panel for searching objects, tags, links, and OCR results with filtering options.
 * Optimized with memoization for performance.
 */

import { useMemo, useCallback } from 'react';

export default function SearchPanel({
  isOpen,
  onClose,
  // Search state
  searchQuery,
  onSearchQueryChange,
  searchScope,
  onSearchScopeChange,
  searchPageScope,
  onSearchPageScopeChange,
  debouncedSearchQuery,
  // Results
  filteredSearchResults,
  onNavigateToObject,
  // OCR integration
  ocrResultsByFile,
  includeOcrInSearch,
  onIncludeOcrInSearchChange,
  onNavigateToOcrResult,
  // Context info
  currentFile,
  currentFolderInfo,
  currentFolderFiles,
  detectedObjects,
  numPages,
  currentPage
}) {
  // Memoized total OCR results count
  const totalOcrCount = useMemo(() => {
    if (!ocrResultsByFile) return 0;
    return Object.values(ocrResultsByFile).reduce((sum, results) => sum + (results?.length || 0), 0);
  }, [ocrResultsByFile]);

  // Memoized OCR search results
  const filteredOcrResults = useMemo(() => {
    if (!includeOcrInSearch || !ocrResultsByFile || !debouncedSearchQuery) {
      return [];
    }
    
    const query = debouncedSearchQuery.toLowerCase().trim();
    if (!query) return [];
    
    const results = [];
    
    // Search through all OCR results across files
    Object.entries(ocrResultsByFile).forEach(([filename, fileResults]) => {
      if (!fileResults) return;
      
      fileResults.forEach(item => {
        if (item.text && item.text.toLowerCase().includes(query)) {
          results.push({
            ...item,
            filename // Include filename for navigation
          });
        }
      });
    });
    
    // Sort by relevance (exact match first, then by confidence)
    results.sort((a, b) => {
      const aExact = a.text.toLowerCase() === query;
      const bExact = b.text.toLowerCase() === query;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return (b.confidence || 0) - (a.confidence || 0);
    });
    
    return results.slice(0, 100); // Limit to 100 OCR results for performance
  }, [ocrResultsByFile, includeOcrInSearch, debouncedSearchQuery]);

  // Memoized combined results count
  const totalResultsCount = useMemo(() => {
    return filteredSearchResults.length + filteredOcrResults.length;
  }, [filteredSearchResults.length, filteredOcrResults.length]);

  // Callback for navigating to OCR result
  const handleOcrResultClick = useCallback((ocrItem) => {
    if (onNavigateToOcrResult) {
      onNavigateToOcrResult(ocrItem);
    }
  }, [onNavigateToOcrResult]);

  // Callback for navigating to object
  const handleObjectClick = useCallback((obj) => {
    if (onNavigateToObject) {
      onNavigateToObject(obj);
    }
  }, [onNavigateToObject]);

  if (!isOpen) return null;

  return (
    <div className="smart-links-panel">
      <div className="panel-header">
        <h3>Search</h3>
        <button className="close-panel" onClick={onClose}>×</button>
      </div>
      <div className="panel-content">
        <div className="panel-section">
          <input
            type="text"
            className="search-input"
            placeholder="Search objects, tags, links..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            autoFocus
          />
          <div className="search-scope-container">
            <select
              className="scope-select dark-select"
              value={searchScope}
              onChange={(e) => onSearchScopeChange(e.target.value)}
            >
              <option value="current">{currentFile?.name?.replace('.pdf', '') || 'Current Document'}</option>
              <option value="folder">{currentFolderInfo?.folder?.name || 'Root'}</option>
              <option value="all">All Documents</option>
            </select>
            {searchScope === 'current' && numPages > 1 && (
              <select
                className="scope-select dark-select"
                value={searchPageScope}
                onChange={(e) => onSearchPageScopeChange(e.target.value)}
                style={{ marginTop: '6px' }}
              >
                <option value="all">Entire Document ({numPages} pages)</option>
                <option value="current">Page {currentPage} only</option>
              </select>
            )}
          </div>
          {totalOcrCount > 0 && (
            <div className="class-filter-item" style={{ padding: '0 0 4px' }}>
              <label className="class-checkbox-label">
                <input
                  type="checkbox"
                  checked={includeOcrInSearch}
                  onChange={(e) => onIncludeOcrInSearchChange(e.target.checked)}
                />
                <span>Include OCR text ({totalOcrCount} items)</span>
              </label>
            </div>
          )}
        </div>

        <div className="panel-section search-results-section">
          {searchQuery.trim() === '' ? (
            <p className="no-results">Enter a search term</p>
          ) : searchQuery !== debouncedSearchQuery ? (
            <p className="no-results">Searching...</p>
          ) : (
            <div className="search-results">
              {totalResultsCount === 0 ? (
                <p className="no-results">No results found</p>
              ) : (
                <>
                  {/* Object Results */}
                  {filteredSearchResults.length > 0 && (
                    <>
                      {includeOcrInSearch && filteredOcrResults.length > 0 && (
                        <div style={{ fontSize: 10, color: '#888', padding: '4px 0', borderBottom: '1px solid #333', marginBottom: 4 }}>
                          Objects ({filteredSearchResults.length})
                        </div>
                      )}
                      {filteredSearchResults.map((obj, i) => (
                        <div key={obj.id || `obj_${i}`} className="search-result-item" onClick={() => handleObjectClick(obj)}>
                          {/* Subclass values - each on its own line */}
                          {obj.subclassValues && Object.keys(obj.subclassValues).length > 0 ? (
                            Object.entries(obj.subclassValues).map(([k, v]) => (
                              <div key={k} className="result-line">{k}: {v || '-'}</div>
                            ))
                          ) : (
                            obj.ocr_text && <div className="result-line">Tag: {obj.ocr_text}</div>
                          )}
                          <div className="result-line">{obj.label}</div>
                          <div className="result-line result-document">{obj.filename?.replace('.pdf', '') || 'Unknown'}</div>
                        </div>
                      ))}
                    </>
                  )}
                  
                  {/* OCR Results */}
                  {includeOcrInSearch && filteredOcrResults.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, color: '#888', padding: '4px 0', borderBottom: '1px solid #333', marginBottom: 4, marginTop: filteredSearchResults.length > 0 ? 8 : 0 }}>
                        OCR Text ({filteredOcrResults.length}{filteredOcrResults.length >= 100 ? '+' : ''})
                      </div>
                      {filteredOcrResults.map((ocrItem, i) => (
                        <div 
                          key={`ocr_${ocrItem.filename}_${ocrItem.page}_${i}`} 
                          className="search-result-item ocr-result" 
                          onClick={() => handleOcrResultClick(ocrItem)}
                          style={{ borderLeft: '3px solid #3498db', paddingLeft: 10 }}
                        >
                          <div className="result-line" style={{ fontWeight: 500 }}>{ocrItem.text}</div>
                          <div className="result-line result-document">
                            {ocrItem.filename?.replace('.pdf', '') || 'Unknown'} • Page {ocrItem.page}
                            {ocrItem.confidence && ` • ${Math.round(ocrItem.confidence * 100)}%`}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
