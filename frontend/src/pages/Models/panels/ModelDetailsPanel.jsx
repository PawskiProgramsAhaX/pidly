import { useState, useEffect } from 'react';
import { getModels, saveModel, deleteModel, exportSingleModel } from '../../../utils/storage';
import { BACKEND_URL, DETECTOR_URL } from '../../../utils/config';
import './ModelDetailsPanel.css';

export default function ModelDetailsPanel({
  selectedModel,
  models,
  setModels,
  projectId,
  getSubclasses,
  onDeleteModel,
  onSelectItem,
}) {
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateImages, setTemplateImages] = useState([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [editConfidence, setEditConfidence] = useState(selectedModel?.recommendedConfidence || 0.7);
  const [editOcrFormat, setEditOcrFormat] = useState(selectedModel?.recommendedOcrFormat || '');
  const [editSubclassOcrFormats, setEditSubclassOcrFormats] = useState(selectedModel?.subclassOcrFormats || {});

  // Sync edit state when model changes
  useEffect(() => {
    if (selectedModel) {
      setEditConfidence(selectedModel.recommendedConfidence || 0.7);
      setEditOcrFormat(selectedModel.recommendedOcrFormat || '');
      setEditSubclassOcrFormats(selectedModel.subclassOcrFormats || {});
      setShowTemplates(false);
      setTemplateImages([]);
    }
  }, [selectedModel?.id]);

  const loadModelTemplates = async (model) => {
    if (!model) return;
    setIsLoadingTemplates(true);
    setTemplateImages([]);

    try {
      const flaskResponse = await fetch(`${DETECTOR_URL}/models/${model.id}/examples`);
      if (flaskResponse.ok) {
        const data = await flaskResponse.json();
        if (data.examples && data.examples.length > 0) {
          const examplesWithThumbnails = await Promise.all(
            data.examples.map(async (ex) => {
              try {
                const thumbResponse = await fetch(`${BACKEND_URL}/api/thumbnail`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    filename: data.pdfFilename,
                    page: ex.page || 0,
                    bbox: ex.bbox
                  })
                });
                if (thumbResponse.ok) {
                  const thumbData = await thumbResponse.json();
                  return { ...ex, image: thumbData.thumbnail };
                }
              } catch (e) {
                console.log('Failed to get thumbnail for example:', ex.id, e);
              }
              return ex;
            })
          );
          setTemplateImages(examplesWithThumbnails);
          setIsLoadingTemplates(false);
          return;
        }
      }
    } catch (error) {
      console.log('Flask examples fetch failed:', error.message);
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/models/${model.id}/templates`);
      if (response.ok) {
        const data = await response.json();
        if (data.templates && data.templates.length > 0) {
          setTemplateImages(data.templates);
          setIsLoadingTemplates(false);
          return;
        }
      }
    } catch (error) {
      console.log('Backend template fetch failed:', error.message);
    }

    const templateSources = [
      model.templates, model.templateImages, model.templateData,
      model.trainingData?.templates, model.trainingImages,
    ].filter(Boolean);

    for (const source of templateSources) {
      if (Array.isArray(source) && source.length > 0) {
        const processedTemplates = source.map((t, idx) => {
          if (typeof t === 'string') {
            return {
              image: t.startsWith('data:') || t.startsWith('http') ? t : `data:image/png;base64,${t}`,
              label: `Template ${idx + 1}`
            };
          }
          return t;
        });
        setTemplateImages(processedTemplates);
        setIsLoadingTemplates(false);
        return;
      }
    }

    setTemplateImages([]);
    setIsLoadingTemplates(false);
  };

  const handleToggleTemplates = () => {
    if (!showTemplates && selectedModel) {
      loadModelTemplates(selectedModel);
    }
    setShowTemplates(!showTemplates);
  };

  const handleExportSingleModel = async (modelId, className) => {
    try {
      await exportSingleModel(modelId, className);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed: ' + error.message + '\n\nMake sure detector_server.py is running.');
    }
  };

  const handleSaveSettings = async () => {
    const pattern = editOcrFormat ? editOcrFormat.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N') : null;
    const subclassOcrPatterns = {};
    for (const [subName, fmt] of Object.entries(editSubclassOcrFormats)) {
      if (fmt) {
        subclassOcrPatterns[subName] = fmt.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N');
      }
    }
    const updatedModel = { 
      ...selectedModel, 
      recommendedConfidence: editConfidence,
      recommendedOcrFormat: editOcrFormat || null,
      recommendedOcrPattern: pattern,
      subclassOcrFormats: Object.keys(editSubclassOcrFormats).length > 0 ? editSubclassOcrFormats : null,
      subclassOcrPatterns: Object.keys(subclassOcrPatterns).length > 0 ? subclassOcrPatterns : null,
    };
    await saveModel(updatedModel);
    const loadedModels = await getModels(projectId);
    setModels(loadedModels || []);
    alert(`Settings saved for "${selectedModel.className}"`);
  };

  const handleRemoveExample = async (exampleId) => {
    if (!confirm(`Remove this example from "${selectedModel.className}"?\n\nThis will regenerate the model without this training example.`)) {
      return;
    }
    try {
      const response = await fetch(
        `${DETECTOR_URL}/models/${selectedModel.id}/examples/${encodeURIComponent(exampleId)}`,
        { method: 'DELETE' }
      );
      const result = await response.json();
      
      if (result.modelDeleted) {
        alert('Model deleted (no examples remaining).');
        onSelectItem('home');
        const loadedModels = await getModels(projectId);
        setModels(loadedModels || []);
      } else if (result.success) {
        alert(`Example removed and model retrained. ${result.remainingExamples} examples remaining.`);
        loadModelTemplates(selectedModel);
        const loadedModels = await getModels(projectId);
        setModels(loadedModels || []);
      } else {
        alert('Failed to remove example: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error removing example:', error);
      alert('Failed to remove example: ' + error.message + '\n\nMake sure detector_server.py is running.');
    }
  };

  if (!selectedModel) {
    return <div className="no-selection"><p>Model not found</p></div>;
  }

  const subclasses = getSubclasses(selectedModel.className);

  return (
    <div className="model-details">
      <div className="model-details-header">
        <h2>{selectedModel.className}</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button 
            className={`view-templates-btn ${showTemplates ? 'active' : ''}`}
            onClick={handleToggleTemplates}
          >
            {showTemplates ? 'Hide Examples' : 'View Examples'}
          </button>
          <button 
            className="view-templates-btn"
            onClick={() => handleExportSingleModel(selectedModel.id, selectedModel.className)}
          >
            Export
          </button>
          <button 
            className="delete-model-btn"
            onClick={() => onDeleteModel(selectedModel.id, selectedModel.className)}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="model-details-grid">
        <div className="detail-card">
          <div className="detail-label">Examples</div>
          <div className="detail-value">{selectedModel.numExamples || '-'}</div>
        </div>
        <div className="detail-card">
          <div className="detail-label">Multi-class</div>
          <div className="detail-value">{selectedModel.isMultiClass ? 'Yes' : 'No'}</div>
        </div>
        <div className="detail-card">
          <div className="detail-label">Created</div>
          <div className="detail-value">
            {selectedModel.created ? new Date(selectedModel.created).toLocaleDateString() : '-'}
          </div>
        </div>
      </div>
      
      {/* Recommended Settings */}
      <div className="model-recommended-settings">
        <div className="models-settings-section">
          <label>Confidence Threshold</label>
          <div className="models-confidence-row">
            <input 
              type="range" min="0.1" max="1" step="0.025"
              value={editConfidence}
              onChange={(e) => setEditConfidence(parseFloat(e.target.value))}
            />
            <span className="confidence-display">
              {(editConfidence * 100) % 1 === 0 ? Math.round(editConfidence * 100) : (editConfidence * 100).toFixed(1)}%
            </span>
          </div>
        </div>

        {subclasses.length > 0 ? (
          <div className="models-settings-section">
            <label>Subclass OCR Formats</label>
            <div className="models-subclass-ocr-list">
              {subclasses.map(subName => (
                <div key={subName} className="models-subclass-ocr-row">
                  <span className="models-subclass-name">{subName}</span>
                  <input 
                    type="text"
                    className="format-text-input"
                    placeholder="e.g. FI-12345"
                    value={editSubclassOcrFormats[subName] || ''}
                    onChange={(e) => setEditSubclassOcrFormats(prev => ({
                      ...prev,
                      [subName]: e.target.value.toUpperCase()
                    }))}
                  />
                  {editSubclassOcrFormats[subName] && (
                    <span className="pattern-display">
                      {editSubclassOcrFormats[subName].replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="models-settings-section">
            <label>OCR Format Pattern</label>
            <div className="models-ocr-row">
              <input 
                type="text"
                className="format-text-input"
                placeholder="Enter example text"
                value={editOcrFormat}
                onChange={(e) => setEditOcrFormat(e.target.value.toUpperCase())}
              />
              {editOcrFormat && (
                <span className="pattern-display">
                  {editOcrFormat.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'N')}
                </span>
              )}
            </div>
          </div>
        )}

        <button className="save-settings-btn" onClick={handleSaveSettings}>
          Save Settings
        </button>
      </div>

      {selectedModel.classes && selectedModel.classes.length > 0 && (
        <div className="model-classes-section">
          <h3>Classes in this model</h3>
          <div className="model-classes-list">
            {selectedModel.classes.map((cls, idx) => (
              <span key={idx} className="class-tag">{cls}</span>
            ))}
          </div>
        </div>
      )}

      {/* Templates */}
      {showTemplates && (
        <div className="model-templates-section">
          <h3>
            Training Examples ({templateImages.length || selectedModel.numExamples || 0})
            <span className="templates-help-text">Click ✕ to remove an example from the model</span>
          </h3>
          <div className="templates-container">
            {isLoadingTemplates ? (
              <div className="templates-loading"><span>Loading examples...</span></div>
            ) : templateImages.length > 0 ? (
              <div className="templates-grid">
                {templateImages.map((template, idx) => (
                  <div key={template.id || template.example_id || idx} className="template-item">
                    <img 
                      src={template.image || template} 
                      alt={`Example ${idx + 1}`}
                      title={template.label || `Example ${idx + 1}${template.className ? ` (${template.className})` : ''}`}
                    />
                    {template.label && <span className="template-label">{template.label}</span>}
                    {template.className && template.className !== template.label && (
                      <span className="template-class">{template.className}</span>
                    )}
                    {(template.id || template.example_id) && (
                      <button 
                        className="remove-example-btn"
                        title="Remove this example from the model"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveExample(template.id || template.example_id);
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="templates-empty">
                <p>No example images available.</p>
                <p className="templates-hint">
                  Examples are stored in the model file. Ensure detector_server.py is running for full access.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
