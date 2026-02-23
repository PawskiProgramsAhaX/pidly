/**
 * TopToolbar.jsx
 * 
 * Top toolbar with panel toggle buttons - Properties, OCR, Links, Objects, Search, View.
 */

export default function TopToolbar({
  // Panel states
  showPropertiesPanel,
  showOcrPanel,
  showSmartLinks,
  showObjectFinder,
  showSearchPanel,
  showViewPanel,
  // Panel toggles
  onToggleProperties,
  onToggleOcr,
  onToggleLinks,
  onToggleObjects,
  onToggleSearch,
  onToggleView
}) {
  return (
    <div className="pdf-toolbar pdf-toolbar-top">
      {/* Left - empty space */}
      <div className="toolbar-left"></div>
      
      {/* Right - Panel buttons */}
      <div className="toolbar-right">
        <button 
          onClick={onToggleProperties}
          className={showPropertiesPanel ? 'active' : ''}
          title="Properties"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="1.5"/>
            <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="1.5"/>
            <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" strokeWidth="1.5"/>
            <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" strokeWidth="1.5"/>
            <line x1="10" y1="9" x2="8" y2="9" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
          Properties
        </button>
        
        <button 
          onClick={onToggleOcr}
          className={showOcrPanel ? 'active' : ''}
          title="OCR - Extract text from PDF"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
            <rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            <path d="M5 7H11M5 10H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          OCR
        </button>
        
        <button 
          onClick={onToggleLinks}
          className={showSmartLinks ? 'active' : ''}
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle', transform: 'rotate(45deg)'}}>
            <path d="M6.5 10.5L9.5 7.5M7 5H5C3.89543 5 3 5.89543 3 7V9C3 10.1046 3.89543 11 5 11H7M9 5H11C12.1046 5 13 5.89543 13 7V9C13 10.1046 12.1046 11 11 11H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Links
        </button>
        
        <button 
          onClick={onToggleObjects}
          className={showObjectFinder ? 'active' : ''}
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
            <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
            <path d="M8 8V15M8 8L2 4.5M8 8L14 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
          </svg>
          Objects
        </button>
        
        <button 
          onClick={onToggleSearch}
          className={showSearchPanel ? 'active' : ''}
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
            <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10 10L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Search
        </button>
        
        <button 
          onClick={onToggleView}
          className={showViewPanel ? 'active' : ''}
          title="View options"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" style={{marginRight: '6px', verticalAlign: 'middle'}}>
            <ellipse cx="8" cy="8" rx="6" ry="4" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="8" cy="8" r="2" fill="currentColor"/>
          </svg>
          View
        </button>
      </div>
    </div>
  );
}
