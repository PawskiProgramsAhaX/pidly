/**
 * InfiniteHeaderToolbar.jsx
 * 
 * Second-row toolbar in the InfiniteView header.
 * Contains: Documents, Batch Add, Search, Views, Options buttons.
 */
import React from 'react';

export default function InfiniteHeaderToolbar({
  showAddPdfSearch,
  setShowAddPdfSearch,
  setShowBatchAdd,
  showObjectSearch,
  setShowObjectSearch,
  showViewsPanel,
  setShowViewsPanel,
  showViewOptions,
  setShowViewOptions,
  showSymbolsPanel,
  setShowSymbolsPanel,
  setShowMarkupHistoryPanel,
}) {
  return (
    <div className="pdf-toolbar pdf-toolbar-top" style={{ background: '#000', borderTop: '1px solid #333', borderBottom: 'none' }}>
      <div className="toolbar-left">
        <button 
          className={showAddPdfSearch ? 'active' : ''}
          onClick={() => setShowAddPdfSearch(!showAddPdfSearch)}
          title="Browse documents"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="1.5"/>
            <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
          Documents
        </button>
        <button
          onClick={() => setShowBatchAdd(true)}
          title="Batch add multiple documents"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
            <rect x="3.5" y="3" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/>
            <rect x="1.5" y="1" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" fill="#1a1a1a"/>
            <line x1="5.5" y1="4.5" x2="5.5" y2="8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <line x1="3.5" y1="6.5" x2="7.5" y2="6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          Batch Add
        </button>
      </div>
      
      <div className="toolbar-right">
        <button 
          className={showObjectSearch ? 'active' : ''}
          onClick={() => {
            setShowObjectSearch(!showObjectSearch);
            setShowViewOptions(false);
            if (setShowViewsPanel) setShowViewsPanel(false);
            setShowSymbolsPanel(false);
            if (setShowMarkupHistoryPanel) setShowMarkupHistoryPanel(false);
          }}
          title="Search for objects"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
            <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10 10L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Search
        </button>
        
        <button 
          className={showViewsPanel ? 'active' : ''}
          onClick={() => {
            if (setShowViewsPanel) setShowViewsPanel(!showViewsPanel);
            setShowObjectSearch(false);
            setShowViewOptions(false);
            setShowSymbolsPanel(false);
            if (setShowMarkupHistoryPanel) setShowMarkupHistoryPanel(false);
          }}
          title="Manage saved views and canvas shapes"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
            <rect x="1.5" y="2.5" width="5" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
            <rect x="9.5" y="2.5" width="5" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
            <rect x="1.5" y="9.5" width="5" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M12 10V14M10 12H14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          Views
        </button>
        
        <button 
          className={showViewOptions ? 'active' : ''}
          onClick={() => {
            setShowViewOptions(!showViewOptions);
            setShowObjectSearch(false);
            if (setShowViewsPanel) setShowViewsPanel(false);
            setShowSymbolsPanel(false);
            if (setShowMarkupHistoryPanel) setShowMarkupHistoryPanel(false);
          }}
          title="View Options"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
            <line x1="2" y1="4" x2="14" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="2" y1="12" x2="14" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="5" cy="4" r="1.5" fill="#1a1a1a" stroke="currentColor" strokeWidth="1"/>
            <circle cx="10" cy="8" r="1.5" fill="#1a1a1a" stroke="currentColor" strokeWidth="1"/>
            <circle cx="7" cy="12" r="1.5" fill="#1a1a1a" stroke="currentColor" strokeWidth="1"/>
          </svg>
          Options
        </button>
      </div>
    </div>
  );
}
