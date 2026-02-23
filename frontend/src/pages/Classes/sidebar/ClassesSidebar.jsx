import { useState } from 'react';

/**
 * Sidebar component for the Classes page.
 * Shows: Overview, Object Search, class list, and Models link.
 */
export default function ClassesSidebar({
  viewMode, setViewMode,
  selectedClass, setSelectedClass,
  classes, searchQuery, setSearchQuery,
  onNewClass, onDeleteClass, onSelectedTag,
  sidebarWidth, onSidebarResize,
  isResizingSidebar, onSidebarResizeStart,
  projectId, returnToFile, navigate,
}) {
  const filteredClasses = classes.filter(cls =>
    cls.name.toLowerCase().includes((searchQuery || '').toLowerCase())
  );

  return (
    <div
      className="classes-sidebar"
      style={{
        width: sidebarWidth,
        minWidth: 320,
        maxWidth: 500,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* Overview */}
      <div
        className={`sidebar-item home-item ${viewMode === 'home' ? 'selected' : ''}`}
        onClick={() => { setViewMode('home'); setSelectedClass(null); onSelectedTag?.(null); }}
      >
        <span className="item-name">Overview</span>
      </div>

      {/* Object Search */}
      <div
        className={`sidebar-item home-item ${viewMode === 'registry' ? 'selected' : ''}`}
        onClick={() => { setViewMode('registry'); setSelectedClass(null); onSelectedTag?.(null); }}
      >
        <span className="item-name">Object Search</span>
      </div>

      {/* Classes section */}
      <div className="classes-section" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: '100px', overflow: 'hidden', background: '#1e1e1e' }}>
        <div className="classes-section-header">
          <span className="section-title">Current Classes</span>
        </div>

        {/* Search */}
        <div className="classes-search">
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* New Class Button */}
        <div style={{ padding: '0 12px 12px' }}>
          <button
            onClick={onNewClass}
            style={{
              width: '100%', padding: '8px 12px',
              background: 'linear-gradient(135deg, #252525 0%, #2a2a2a 100%)',
              border: '1px solid #3a3a3a', borderRadius: '6px',
              color: '#bbb', fontSize: '12px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg, #2a2a2a 0%, #333 100%)'; e.currentTarget.style.borderColor = '#3498db'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg, #252525 0%, #2a2a2a 100%)'; e.currentTarget.style.borderColor = '#3a3a3a'; e.currentTarget.style.color = '#bbb'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Class
          </button>
        </div>

        {/* Classes list */}
        <div className="class-list" style={{ flex: '1 1 auto', overflowY: 'auto', overflowX: 'hidden', padding: '4px 8px', minHeight: 0, scrollbarWidth: 'thin', scrollbarColor: '#555 #2a2a2a', background: '#1e1e1e' }}>
          {filteredClasses.length === 0 ? (
            <p className="no-classes" style={{ padding: '20px 12px', color: '#666', fontSize: '13px', textAlign: 'center' }}>
              {searchQuery ? 'No classes found' : 'No classes yet'}
            </p>
          ) : (
            filteredClasses.map(cls => (
              <div
                key={cls.name}
                className={`class-item ${selectedClass?.name === cls.name && viewMode === 'class' ? 'selected' : ''}`}
                onClick={() => { setSelectedClass(cls); setViewMode('class'); onSelectedTag?.(null); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', marginBottom: '2px',
                  transition: 'all 0.15s',
                  background: selectedClass?.name === cls.name && viewMode === 'class' ? '#2a2a2a' : 'transparent',
                  borderLeft: selectedClass?.name === cls.name && viewMode === 'class' ? '3px solid #3498db' : '3px solid transparent',
                }}
                onMouseEnter={(e) => {
                  if (!(selectedClass?.name === cls.name && viewMode === 'class')) e.currentTarget.style.background = '#252525';
                  e.currentTarget.querySelector('.delete-btn').style.opacity = '1';
                }}
                onMouseLeave={(e) => {
                  if (!(selectedClass?.name === cls.name && viewMode === 'class')) e.currentTarget.style.background = 'transparent';
                  e.currentTarget.querySelector('.delete-btn').style.opacity = '0';
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" style={{ flexShrink: 0 }}>
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
                <div className="class-item-info" style={{ flex: 1, minWidth: 0 }}>
                  <div className="class-item-name" style={{ fontSize: '13px', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cls.name}</div>
                  <div className="class-item-meta" style={{ fontSize: '11px', color: '#888' }}>{cls.count} objects</div>
                </div>
                <button
                  className="class-action-btn delete delete-btn"
                  title="Delete class"
                  onClick={(e) => { e.stopPropagation(); onDeleteClass(cls.name); }}
                  style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'all 0.15s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#e74c3c'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#666'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Sidebar Footer - Models link */}
      <div className="sidebar-footer" style={{ marginTop: 'auto', padding: '12px', borderTop: '1px solid #333', background: 'linear-gradient(to top, #1a1a1a, #1e1e1e)' }}>
        <div style={{ fontSize: '11px', color: '#666', marginBottom: '8px', paddingLeft: '2px' }}>Need to train object detection models?</div>
        <button
          onClick={() => navigate(`/project/${projectId}/models`, { state: { returnToFile } })}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
            padding: '10px 12px',
            background: 'linear-gradient(135deg, #252525 0%, #2a2a2a 100%)',
            border: '1px solid #3a3a3a', borderRadius: '6px',
            color: '#bbb', fontSize: '12px', cursor: 'pointer', transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg, #2a2a2a 0%, #333 100%)'; e.currentTarget.style.borderColor = '#3498db'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg, #252525 0%, #2a2a2a 100%)'; e.currentTarget.style.borderColor = '#3a3a3a'; e.currentTarget.style.color = '#bbb'; }}
        >
          Models
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 'auto', opacity: 0.5 }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Resize handle */}
      <div
        style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: 5,
          cursor: 'col-resize',
          background: isResizingSidebar ? '#3498db' : 'transparent',
          transition: 'background 0.2s',
        }}
        onMouseDown={onSidebarResizeStart}
        onMouseEnter={(e) => e.currentTarget.style.background = '#3498db'}
        onMouseLeave={(e) => !isResizingSidebar && (e.currentTarget.style.background = 'transparent')}
      />
    </div>
  );
}
