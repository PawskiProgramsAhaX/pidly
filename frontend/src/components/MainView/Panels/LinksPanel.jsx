/**
 * LinksPanel.jsx
 * 
 * Panel for Smart Links - managing link models, detection settings, and finding links.
 */

export default function LinksPanel({
  isOpen,
  onClose,
  // Navigation
  onNavigateToLinkProperties,
  // Link mode
  linkMode,
  onLinkModeChange,
  onSetPanMode,
  onSetZoomMode,
  // Display
  // Models section
  savedModels,
  linksModelSearch,
  onLinksModelSearchChange,
  selectedModels,
  onToggleModelSelection,
  linksPanelModelsHeight,
  onStartResize,
  // Detection settings
  detectionScope,
  onDetectionScopeChange,
  detectionPageScope,
  onDetectionPageScopeChange,
  // Context
  currentFile,
  currentFolderInfo,
  numPages,
  currentPage,
  // Detection state
  isDetecting,
  smartLinksProgress,
  smartLinksDisplayPercent,
  // Settings dialog
  smartLinksClassSettings,
  confidence,
  enableOCR,
  onOpenSettingsDialog
}) {
  if (!isOpen) return null;

  const handleFindLinks = () => {
    // Initialize per-class settings for selected models
    const initialSettings = {};
    selectedModels.forEach(modelId => {
      const model = savedModels.find(m => m.id === modelId);
      if (model) {
        // Get subclassRegions for this model
        const classSubclassRegions = model.subclassRegions?.[model.className] || null;
        
        // Build subclass formats if model has subclassRegions
        const subclassFormats = {};
        if (classSubclassRegions) {
          Object.keys(classSubclassRegions).forEach(subclassName => {
            subclassFormats[subclassName] = smartLinksClassSettings[modelId]?.subclassFormats?.[subclassName] || '';
          });
        }
        
        // Use model's recommended confidence if available
        const defaultConfidence = model.recommendedConfidence || smartLinksClassSettings[modelId]?.confidence || confidence;
        // Use model's recommended OCR format if available
        const defaultOcrFormat = model.recommendedOcrFormat || smartLinksClassSettings[modelId]?.ocrFormat || '';
        
        initialSettings[modelId] = {
          confidence: defaultConfidence,
          enableOCR: smartLinksClassSettings[modelId]?.enableOCR ?? enableOCR,
          ocrFormat: defaultOcrFormat,
          subclassFormats: subclassFormats,
          subclassRegions: classSubclassRegions,
          className: model.className,
          recommendedConfidence: model.recommendedConfidence || null,
          recommendedOcrFormat: model.recommendedOcrFormat || null,
          recommendedOcrPattern: model.recommendedOcrPattern || null
        };
      }
    });
    onOpenSettingsDialog(initialSettings);
  };

  const filteredModels = savedModels.filter(model => 
    model.className.toLowerCase().includes(linksModelSearch.toLowerCase())
  );

  return (
    <div className="smart-links-panel">
      <div className="panel-header">
        <h3>Links</h3>
        <button className="close-panel" onClick={onClose}>×</button>
      </div>

      <div className="panel-content">
        {/* Navigation Link */}
        <div className="panel-nav-links">
          <button 
            className="nav-link-btn"
            onClick={onNavigateToLinkProperties}
          >
            Document Link Properties
          </button>
        </div>

        <div className="panel-section">
          <div className="mode-buttons">
            <button
              className={linkMode === 'create' ? 'active' : ''}
              onClick={() => {
                onLinkModeChange(linkMode === 'create' ? null : 'create');
                onSetPanMode(false);
                onSetZoomMode(false);
              }}
            >
              Assign Document Link
            </button>
          </div>
          {linkMode && (
            <p className="mode-hint">
              {linkMode === 'create' && 'Draw a rectangle to create a link'}
            </p>
          )}
        </div>

        <div className="panel-section panel-section-resizable" style={{ height: linksPanelModelsHeight, minHeight: 100, maxHeight: 500 }}>
          <h4>Models ({savedModels.length})</h4>
          {savedModels.length === 0 ? (
            <p className="no-models">No models trained yet</p>
          ) : (
            <>
              <input
                type="text"
                className="model-search-input"
                placeholder="Search models..."
                value={linksModelSearch}
                onChange={(e) => onLinksModelSearchChange(e.target.value)}
              />
              <div className="models-list scrollable" style={{ height: 'calc(100% - 60px)' }}>
                {filteredModels.map(model => (
                  <div key={model.id} className="model-item">
                    <label className="model-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedModels.includes(model.id)}
                        onChange={() => onToggleModelSelection(model.id)}
                      />
                      <span>{model.className}</span>
                    </label>
                    <span className="model-info">{model.numTemplates} templates</span>
                  </div>
                ))}
                {filteredModels.length === 0 && (
                  <p className="no-results">No models match "{linksModelSearch}"</p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Resizer handle */}
        <div 
          className="panel-section-resizer"
          onMouseDown={onStartResize}
          title="Drag to resize"
        />

        <div className="panel-section">
          <h4>Find Links</h4>
          
          <div className="option-group">
            <label>Scope:</label>
            <select value={detectionScope} onChange={(e) => onDetectionScopeChange(e.target.value)}>
              <option value="current">{currentFile?.name || 'Current Document'}</option>
              <option value="folder">
                {currentFolderInfo.folder?.name || 'Current Folder'} ({currentFolderInfo.folderFileCount} files)
              </option>
              {currentFolderInfo.parent && (
                <option value="parent">
                  {currentFolderInfo.parent.name} + subfolders ({currentFolderInfo.parentFileCount} files)
                </option>
              )}
              <option value="all">All Documents in Project ({currentFolderInfo.totalFileCount} files)</option>
            </select>
          </div>
          
          {/* Page scope selector - only show for multi-page documents when scope is current PDF */}
          {detectionScope === 'current' && numPages > 1 && (
            <div className="option-group">
              <label>Pages:</label>
              <select 
                value={detectionPageScope} 
                onChange={(e) => onDetectionPageScopeChange(e.target.value)}
              >
                <option value="current">Current Page ({currentPage})</option>
                <option value="all">All Pages (1-{numPages})</option>
              </select>
            </div>
          )}

          <button
            className="primary-btn find-links-btn"
            onClick={handleFindLinks}
            disabled={selectedModels.length === 0 || isDetecting}
          >
            {isDetecting ? 'Detecting...' : '🔍 Find Links'}
          </button>
          
          {/* Smart Links Detection Progress Bar */}
          {(isDetecting || smartLinksProgress.phase) && (
            <div className="detection-progress" style={{ marginTop: 12 }}>
              <div className="progress-bar-container" style={{
                background: '#e0e0e0',
                borderRadius: 4,
                height: 8,
                overflow: 'hidden',
                marginBottom: 6
              }}>
                <div className="progress-bar-fill" style={{
                  background: smartLinksProgress.phase === 'complete' ? '#27ae60' : '#3498db',
                  height: '100%',
                  width: `${smartLinksDisplayPercent}%`,
                  transition: 'background 0.3s ease'
                }} />
              </div>
              <div className="progress-status" style={{ fontSize: 11, color: '#666' }}>
                {smartLinksProgress.phase === 'detecting' && (
                  <>
                    <div style={{ fontWeight: 500 }}>Detecting Objects...</div>
                    {smartLinksProgress.totalFiles > 1 && (
                      <div style={{ marginTop: 2 }}>
                        File {smartLinksProgress.currentFileIndex} of {smartLinksProgress.totalFiles}: {smartLinksProgress.currentFile}
                      </div>
                    )}
                  </>
                )}
                {smartLinksProgress.phase === 'saving' && (
                  <div style={{ fontWeight: 500 }}>Saving...</div>
                )}
                {smartLinksProgress.phase === 'complete' && (
                  <div style={{ fontWeight: 500, color: '#27ae60' }}>Complete!</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
