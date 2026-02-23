/**
 * ObjectSearchPanel.jsx
 * 
 * Right-side panel for searching and filtering detected objects AND drawn regions
 * on the infinite canvas. Matches PDFViewer SearchPanel styling.
 */
import React, { useMemo, useState } from 'react';

export default function ObjectSearchPanel({
  objectSearchQuery,
  setObjectSearchQuery,
  debouncedSearchQuery,
  hiddenClasses,
  setHiddenClasses,
  allDetectedObjects,
  filteredObjects,
  navigateToObject,
  drawnRegions,
  filteredRegions,
  navigateToRegion,
  onClose,
  viewLocked,
  slots = [],
}) {
  const isSearching = objectSearchQuery.trim() && objectSearchQuery !== debouncedSearchQuery;
  const hasQuery = debouncedSearchQuery.trim().length > 0;
  const [lockedFlashId, setLockedFlashId] = useState(null); // briefly flash locked message

  // Build a set of "filename:page" keys for pages currently on canvas
  const onCanvasPages = useMemo(() => {
    const keys = new Set();
    slots.forEach(s => {
      if (s.backendFilename) keys.add(`${s.backendFilename}:${s.page}`);
    });
    return keys;
  }, [slots]);

  // Check if an object/region is on a page currently loaded on canvas
  const isObjectOnCanvas = (obj) => {
    const page = (obj.page || 0) + 1; // obj.page is 0-indexed, slot.page is 1-indexed
    return onCanvasPages.has(`${obj.filename}:${page}`);
  };

  const isRegionOnCanvas = (region) => {
    const page = (region.page || 0) + 1;
    return onCanvasPages.has(`${region.filename}:${page}`);
  };

  const handleObjectClick = (obj) => {
    if (viewLocked && !isObjectOnCanvas(obj)) {
      // Flash a locked message
      setLockedFlashId(obj.id || 'obj');
      setTimeout(() => setLockedFlashId(null), 2000);
      return;
    }
    navigateToObject(obj);
  };

  const handleRegionClick = (region) => {
    if (viewLocked && !isRegionOnCanvas(region)) {
      setLockedFlashId(region.id || 'reg');
      setTimeout(() => setLockedFlashId(null), 2000);
      return;
    }
    navigateToRegion(region);
  };

  // Unique classes from objects + region types for filters
  const allClassNames = useMemo(() => {
    const names = new Set();
    allDetectedObjects.forEach(o => {
      if (o.label || o.className) names.add(o.label || o.className);
    });
    drawnRegions.forEach(r => {
      if (r.regionType) names.add(r.regionType);
    });
    return [...names].filter(Boolean).sort();
  }, [allDetectedObjects, drawnRegions]);

  // Apply hidden class filter to results
  const visibleObjects = useMemo(() => 
    filteredObjects.filter(obj => {
      const cn = obj.label || obj.className;
      return !hiddenClasses.has(cn);
    }),
    [filteredObjects, hiddenClasses]
  );

  const visibleRegions = useMemo(() =>
    filteredRegions.filter(r => !hiddenClasses.has(r.regionType)),
    [filteredRegions, hiddenClasses]
  );

  const totalResults = visibleObjects.length + visibleRegions.length;

  return (
    <div className="smart-links-panel right-panel">
      <div className="panel-header">
        <h3>Search</h3>
        <button className="close-panel" onClick={onClose}>×</button>
      </div>
      <div className="panel-content">
        {/* Search input */}
        <div className="panel-section">
          <input
            type="text"
            className="search-input"
            placeholder="Search objects, regions, tags..."
            value={objectSearchQuery}
            onChange={(e) => setObjectSearchQuery(e.target.value)}
            autoFocus
          />
        </div>

        {/* View locked notice */}
        {viewLocked && (
          <div style={{
            margin: '0 0 8px 0', padding: '6px 10px', borderRadius: 5,
            background: '#e67e2212', border: '1px solid #e67e2233',
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 10, color: '#e67e22', lineHeight: 1.4,
          }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
              <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <circle cx="8" cy="10.5" r="1" fill="currentColor"/>
            </svg>
            View locked — only objects on current canvas pages are navigable
          </div>
        )}

        
        {/* Search results */}
        <div className="panel-section search-results-section">
          {!objectSearchQuery.trim() ? (
            <p className="no-results">Enter a search term</p>
          ) : isSearching ? (
            <p className="no-results">Searching...</p>
          ) : (
            <div className="search-results">
              {totalResults === 0 ? (
                <p className="no-results">No results found</p>
              ) : (
                <>
                  {/* Objects section */}
                  {visibleObjects.length > 0 && (
                    <>
                      {visibleRegions.length > 0 && (
                        <div style={{ fontSize: 10, color: '#888', padding: '4px 0', borderBottom: '1px solid #333', marginBottom: 4 }}>
                          Objects ({visibleObjects.length})
                        </div>
                      )}
                      {visibleObjects.map((obj, idx) => {
                        const onCanvas = isObjectOnCanvas(obj);
                        const isBlocked = viewLocked && !onCanvas;
                        const isFlashing = lockedFlashId === (obj.id || `obj-${idx}`);
                        return (
                        <div 
                          key={obj.id || `obj-${idx}`}
                          className="search-result-item"
                          onClick={() => handleObjectClick(obj)}
                          style={{
                            opacity: isBlocked ? 0.55 : 1,
                            cursor: isBlocked ? 'not-allowed' : 'pointer',
                            position: 'relative',
                          }}
                        >
                          <div className="result-line" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ flex: 1 }}>{obj.ocr_text || obj.subclassValues?.Tag || 'No tag'}</span>
                            {isBlocked && (
                              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: '#e67e22' }}>
                                <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                                <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                              </svg>
                            )}
                            {!isBlocked && onCanvas && viewLocked && (
                              <span style={{ fontSize: 9, color: '#2ecc71', flexShrink: 0 }}>on canvas</span>
                            )}
                          </div>
                          <div className="result-line">{obj.label || obj.className || 'Unknown'}</div>
                          <div className="result-line result-document">{obj.filename?.replace('.pdf', '')} - Page {(obj.page || 0) + 1}</div>
                          {isFlashing && (
                            <div style={{
                              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: 'rgba(230, 126, 34, 0.12)', borderRadius: 4, pointerEvents: 'none',
                              fontSize: 10, fontWeight: 600, color: '#e67e22', gap: 5,
                              animation: 'fadeIn 0.15s ease-out',
                            }}>
                              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                                <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                                <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                                <circle cx="8" cy="10.5" r="1" fill="currentColor"/>
                              </svg>
                              View locked — page not on canvas
                            </div>
                          )}
                        </div>
                        );
                      })}
                    </>
                  )}
                  
                  {/* Regions section */}
                  {visibleRegions.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, color: '#888', padding: '4px 0', borderBottom: '1px solid #333', marginBottom: 4, marginTop: visibleObjects.length > 0 ? 8 : 0 }}>
                        Regions ({visibleRegions.length})
                      </div>
                      {visibleRegions.map((region, idx) => {
                        const onCanvas = isRegionOnCanvas(region);
                        const isBlocked = viewLocked && !onCanvas;
                        const isFlashing = lockedFlashId === (region.id || `reg-${idx}`);
                        return (
                        <div 
                          key={region.id || `reg-${idx}`}
                          className="search-result-item"
                          onClick={() => handleRegionClick(region)}
                          style={{
                            borderLeft: '3px solid ' + (region.fillColor || region.borderColor || '#3498db'),
                            paddingLeft: 10,
                            opacity: isBlocked ? 0.55 : 1,
                            cursor: isBlocked ? 'not-allowed' : 'pointer',
                            position: 'relative',
                          }}
                        >
                          <div className="result-line" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ flex: 1 }}>{region.subRegionName || region.regionType || 'Unnamed region'}</span>
                            {isBlocked && (
                              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: '#e67e22' }}>
                                <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                                <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                              </svg>
                            )}
                            {!isBlocked && onCanvas && viewLocked && (
                              <span style={{ fontSize: 9, color: '#2ecc71', flexShrink: 0 }}>on canvas</span>
                            )}
                          </div>
                          <div className="result-line" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span
                              style={{ 
                                width: '10px',
                                height: '10px',
                                borderRadius: '2px',
                                flexShrink: 0,
                                background: region.fillColor || region.borderColor || '#3498db',
                                border: `1px solid ${region.borderColor || '#3498db'}`
                              }}
                            />
                            <span>{region.regionType || 'Region'}</span>
                          </div>
                          <div className="result-line result-document">
                            {region.filename?.replace('.pdf', '')} - Page {(region.page || 0) + 1}
                          </div>
                          {isFlashing && (
                            <div style={{
                              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: 'rgba(230, 126, 34, 0.12)', borderRadius: 4, pointerEvents: 'none',
                              fontSize: 10, fontWeight: 600, color: '#e67e22', gap: 5,
                              animation: 'fadeIn 0.15s ease-out',
                            }}>
                              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                                <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                                <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                                <circle cx="8" cy="10.5" r="1" fill="currentColor"/>
                              </svg>
                              View locked — page not on canvas
                            </div>
                          )}
                        </div>
                        );
                      })}
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
