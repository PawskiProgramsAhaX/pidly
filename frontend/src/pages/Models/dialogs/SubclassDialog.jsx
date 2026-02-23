import { useState, useEffect } from 'react';
import './SubclassDialog.css';

export default function SubclassDialog({
  pendingShape,
  selectedClass,
  subclasses,
  subclassRegions,
  setSubclassRegions,
  subclassImageData,
  isCapturingRegion,
  subclassImageZoom,
  setSubclassImageZoom,
  onClose,
  dialogSize: initialSize = { width: 600, height: 650 },
}) {
  const [currentSubclassIndex, setCurrentSubclassIndex] = useState(0);
  const [subclassDrawStart, setSubclassDrawStart] = useState(null);
  const [subclassCurrentRect, setSubclassCurrentRect] = useState(null);
  const [dialogSize, setDialogSize] = useState(initialSize);
  const [isResizingDialog, setIsResizingDialog] = useState(false);
  const [dialogResizeStart, setDialogResizeStart] = useState(null);

  const currentSubclass = subclasses[currentSubclassIndex];

  // Dialog resize handler
  useEffect(() => {
    if (!isResizingDialog || !dialogResizeStart) return;
    
    const handleMouseMove = (e) => {
      const dx = e.clientX - dialogResizeStart.x;
      const dy = e.clientY - dialogResizeStart.y;
      
      let newWidth = dialogResizeStart.width;
      let newHeight = dialogResizeStart.height;
      
      if (dialogResizeStart.direction === 'e' || dialogResizeStart.direction === 'se') {
        newWidth = Math.max(400, Math.min(window.innerWidth * 0.95, dialogResizeStart.width + dx));
      }
      if (dialogResizeStart.direction === 's' || dialogResizeStart.direction === 'se') {
        newHeight = Math.max(400, Math.min(window.innerHeight * 0.95, dialogResizeStart.height + dy));
      }
      
      setDialogSize({ width: newWidth, height: newHeight });
    };
    
    const handleMouseUp = () => {
      setIsResizingDialog(false);
      setDialogResizeStart(null);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingDialog, dialogResizeStart]);

  const startResize = (e, direction) => {
    e.preventDefault();
    setIsResizingDialog(true);
    setDialogResizeStart({ 
      x: e.clientX, 
      y: e.clientY, 
      width: dialogSize.width, 
      height: dialogSize.height, 
      direction 
    });
  };

  return (
    <div className="modal-overlay">
      <div 
        className="subclass-region-dialog" 
        onClick={(e) => e.stopPropagation()}
        style={{ width: dialogSize.width, height: dialogSize.height }}
      >
        {/* Resize handles */}
        <div className="dialog-resize-handle resize-e" onMouseDown={(e) => startResize(e, 'e')} />
        <div className="dialog-resize-handle resize-s" onMouseDown={(e) => startResize(e, 's')} />
        <div className="dialog-resize-handle resize-se" onMouseDown={(e) => startResize(e, 'se')} />
        
        <div className="dialog-header">
          <h3>Define OCR Regions</h3>
          <button className="close-dialog-btn" onClick={onClose}>✕</button>
        </div>
        
        <div className="subclass-tabs">
          {subclasses.map((sub, idx) => (
            <button
              key={sub}
              className={`subclass-tab ${idx === currentSubclassIndex ? 'active' : ''} ${subclassRegions[sub] ? 'completed' : ''}`}
              onClick={() => {
                setCurrentSubclassIndex(idx);
                setSubclassCurrentRect(null);
              }}
            >
              {subclassRegions[sub] && <span className="tab-check">✓</span>}
              {sub}
            </button>
          ))}
        </div>
        
        <p className="region-instruction">
          Draw a box on the image where <strong>{currentSubclass}</strong> value appears.
        </p>
        
        {/* Zoom controls */}
        <div className="subclass-zoom-controls">
          <button onClick={() => setSubclassImageZoom(z => Math.max(0.5, z - 0.25))}>−</button>
          <span>{Math.round(subclassImageZoom * 100)}%</span>
          <button onClick={() => setSubclassImageZoom(z => Math.min(4, z + 0.25))}>+</button>
          <button onClick={() => setSubclassImageZoom(1)}>Reset</button>
        </div>
        
        <div className="region-image-container">
          {isCapturingRegion && !subclassImageData?.image && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: '#888', fontSize: '13px' }}>
              Loading image...
            </div>
          )}
          {subclassImageData?.image && (
            <div 
              className="subclass-image-wrapper"
              style={{ 
                transform: `scale(${subclassImageZoom})`, 
                transformOrigin: 'top left',
                cursor: 'crosshair'
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const wrapper = e.currentTarget;
                const img = wrapper.querySelector('img');
                if (!img) return;
                const imgRect = img.getBoundingClientRect();
                const x = Math.max(0, Math.min(1, (e.clientX - imgRect.left) / imgRect.width));
                const y = Math.max(0, Math.min(1, (e.clientY - imgRect.top) / imgRect.height));
                setSubclassDrawStart({ x, y });
                setSubclassCurrentRect({ x, y, width: 0, height: 0 });
              }}
              onMouseMove={(e) => {
                if (!subclassDrawStart) return;
                e.preventDefault();
                const wrapper = e.currentTarget;
                const img = wrapper.querySelector('img');
                if (!img) return;
                const imgRect = img.getBoundingClientRect();
                const x = Math.max(0, Math.min(1, (e.clientX - imgRect.left) / imgRect.width));
                const y = Math.max(0, Math.min(1, (e.clientY - imgRect.top) / imgRect.height));
                const width = x - subclassDrawStart.x;
                const height = y - subclassDrawStart.y;
                setSubclassCurrentRect({
                  x: width < 0 ? x : subclassDrawStart.x,
                  y: height < 0 ? y : subclassDrawStart.y,
                  width: Math.abs(width),
                  height: Math.abs(height)
                });
              }}
              onMouseUp={(e) => {
                e.preventDefault();
                if (subclassCurrentRect && subclassCurrentRect.width > 0.01 && subclassCurrentRect.height > 0.01) {
                  setSubclassRegions(prev => ({ ...prev, [currentSubclass]: subclassCurrentRect }));
                }
                setSubclassDrawStart(null);
                setSubclassCurrentRect(null);
              }}
              onMouseLeave={() => {
                if (subclassDrawStart) {
                  if (subclassCurrentRect && subclassCurrentRect.width > 0.01 && subclassCurrentRect.height > 0.01) {
                    setSubclassRegions(prev => ({ ...prev, [currentSubclass]: subclassCurrentRect }));
                  }
                  setSubclassDrawStart(null);
                  setSubclassCurrentRect(null);
                }
              }}
            >
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img 
                  src={subclassImageData.image} 
                  alt="Region preview"
                  draggable={false}
                  onDragStart={(e) => e.preventDefault()}
                />
                
                {/* Show all marked regions */}
                {Object.entries(subclassRegions)
                  .filter(([subName]) => !(subName === currentSubclass && subclassDrawStart))
                  .map(([subName, region]) => (
                  <div 
                    key={subName}
                    className={`subclass-draw-rect ${subName === currentSubclass ? 'current' : 'other'}`}
                    style={{
                      left: `${region.x * 100}%`,
                      top: `${region.y * 100}%`,
                      width: `${region.width * 100}%`,
                      height: `${region.height * 100}%`,
                    }}
                  >
                    <span className="region-label">{subName}</span>
                  </div>
                ))}
                
                {/* Current drawing rect */}
                {subclassCurrentRect && (
                  <div 
                    className="subclass-draw-rect current drawing"
                    style={{
                      left: `${subclassCurrentRect.x * 100}%`,
                      top: `${subclassCurrentRect.y * 100}%`,
                      width: `${subclassCurrentRect.width * 100}%`,
                      height: `${subclassCurrentRect.height * 100}%`,
                    }}
                  >
                    <span className="region-label">{currentSubclass}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        
        {/* Status */}
        <div className="subclass-status">
          {subclassRegions[currentSubclass] ? (
            <span className="status-done">Region marked for {currentSubclass}</span>
          ) : (
            <span className="status-pending">Draw a box to mark the region</span>
          )}
        </div>
        
        <div className="dialog-actions">
          {currentSubclassIndex > 0 && (
            <button className="prev-btn" onClick={() => setCurrentSubclassIndex(prev => prev - 1)}>
              ← Previous
            </button>
          )}
          
          {subclassRegions[currentSubclass] && (
            <button 
              className="clear-region-btn"
              onClick={() => setSubclassRegions(prev => {
                const newRegions = { ...prev };
                delete newRegions[currentSubclass];
                return newRegions;
              })}
            >
              Clear
            </button>
          )}
          
          <div className="dialog-spacer" />
          
          {currentSubclassIndex < subclasses.length - 1 ? (
            <button className="next-btn" onClick={() => setCurrentSubclassIndex(prev => prev + 1)}>
              Next →
            </button>
          ) : (
            <button className="done-btn" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
