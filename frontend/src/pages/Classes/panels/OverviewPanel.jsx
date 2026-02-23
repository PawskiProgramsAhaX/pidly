/**
 * Overview/Home panel for the Classes page.
 * Shows stats, class distribution chart, quick actions, and orphaned objects banner.
 */
export default function OverviewPanel({
  classes, project, filteredClasses,
  onNewClass, onExportJSON, onExportExcel, onImport, fileInputRef, handleFileSelect,
  orphanedObjectsInfo, onReassign, onDeleteAllOrphaned,
  setSelectedClass, setViewMode,
}) {
  return (
    <div className="home-content-wrapper" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
      <div className="home-content" style={{ overflowY: 'visible', padding: '16px 20px' }}>
        {/* Header */}
        <div className="home-header-section">
          <div className="home-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </div>
          <h2>Classes Overview</h2>
          <p className="home-subtitle">Manage detected objects and their classifications</p>
        </div>

        {/* Stats */}
        <div className="home-stats-row">
          <div className="stat-card" style={{ background: 'transparent', border: '1px solid #333' }}>
            <div className="stat-number" style={{ color: '#fff', fontWeight: 700 }}>{filteredClasses.length}</div>
            <div className="stat-label" style={{ color: '#888', fontWeight: 600 }}>Classes</div>
          </div>
          <div className="stat-card" style={{ background: 'transparent', border: '1px solid #333' }}>
            <div className="stat-number" style={{ color: '#fff', fontWeight: 700 }}>
              {filteredClasses.reduce((sum, cls) => sum + cls.count, 0)}
            </div>
            <div className="stat-label" style={{ color: '#888', fontWeight: 600 }}>Objects</div>
          </div>
          <div className="stat-card" style={{ background: 'transparent', border: '1px solid #333' }}>
            <div className="stat-number" style={{ color: '#fff', fontWeight: 700 }}>
              {project?.classes?.filter(c => c.parentId)?.length || 0}
            </div>
            <div className="stat-label" style={{ color: '#888', fontWeight: 600 }}>Subclasses</div>
          </div>
        </div>

        {/* Class Distribution Bar Chart */}
        {filteredClasses.length > 0 && filteredClasses.some(cls => cls.count > 0) && (
          <div className="class-distribution-section" style={{ background: 'transparent', border: 'none' }}>
            <h3 style={{ textAlign: 'center' }}>Class Distribution</h3>
            <div className="bar-chart">
              {filteredClasses
                .filter(cls => cls.count > 0)
                .sort((a, b) => b.count - a.count)
                .slice(0, 10)
                .map((cls, index) => {
                  const maxCount = Math.max(...filteredClasses.map(c => c.count));
                  const percentage = maxCount > 0 ? (cls.count / maxCount) * 100 : 0;
                  return (
                    <div
                      key={cls.name}
                      className="bar-column"
                      onClick={() => { setSelectedClass(cls); setViewMode('class'); }}
                      title={`${cls.name}: ${cls.count} objects`}
                    >
                      <div className="bar-fill-wrapper">
                        <div className="bar-count-vertical">{cls.count}</div>
                        <div
                          className="bar-fill-vertical"
                          style={{ height: `${percentage}%`, backgroundColor: `hsl(${200 + (index * 15) % 60}, 70%, 55%)` }}
                        />
                      </div>
                      <div className="bar-label-vertical">{cls.name}</div>
                    </div>
                  );
                })}
            </div>
            {filteredClasses.filter(cls => cls.count > 0).length > 10 && (
              <div className="bar-more">+{filteredClasses.filter(cls => cls.count > 0).length - 10} more classes</div>
            )}
          </div>
        )}

        {/* Quick Actions */}
        <div className="home-actions-section" style={{ background: 'transparent', border: 'none', padding: 0 }}>
          <h3 style={{ color: '#fff', fontWeight: 700 }}>Quick Actions</h3>
          <div className="home-actions-grid" style={{ display: 'flex', gap: '12px' }}>
            <div className="action-card" onClick={onNewClass}>
              <div className="action-row">
                <div className="action-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </div>
                <div className="action-title">New Class</div>
              </div>
              <div className="action-desc">Create a new object class</div>
            </div>
            <div className="action-card" onClick={onExportJSON}>
              <div className="action-row">
                <div className="action-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                  </svg>
                </div>
                <div className="action-title">Export JSON</div>
              </div>
              <div className="action-desc">Full backup of all objects</div>
            </div>
            <div className="action-card" onClick={onExportExcel}>
              <div className="action-row">
                <div className="action-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6M8 13h8M8 17h8" />
                  </svg>
                </div>
                <div className="action-title">Export Excel</div>
              </div>
              <div className="action-desc">Download as .xlsx spreadsheet</div>
            </div>
            <div className="action-card" onClick={() => fileInputRef.current?.click()}>
              <div className="action-row">
                <div className="action-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                </div>
                <div className="action-title">Import</div>
              </div>
              <div className="action-desc">Load JSON, CSV, or Excel file</div>
            </div>
          </div>
          <input type="file" ref={fileInputRef} accept=".json,.csv,.xlsx" onChange={handleFileSelect} style={{ display: 'none' }} />
        </div>

        {/* Orphaned Objects Banner */}
        {orphanedObjectsInfo.total > 0 && (
          <div className="orphaned-banner">
            <div className="orphaned-banner-content">
              <div className="orphaned-banner-title">
                {orphanedObjectsInfo.total} Orphaned Object{orphanedObjectsInfo.total !== 1 ? 's' : ''}
              </div>
              <div className="orphaned-banner-desc">
                Objects from {orphanedObjectsInfo.fileNames.length} deleted file{orphanedObjectsInfo.fileNames.length !== 1 ? 's' : ''} that can be reassigned.
              </div>
              <div className="orphaned-actions">
                <button className="orphaned-reassign-btn" onClick={onReassign}>Reassign</button>
                <button className="orphaned-delete-all-btn" onClick={onDeleteAllOrphaned}>Delete All</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
