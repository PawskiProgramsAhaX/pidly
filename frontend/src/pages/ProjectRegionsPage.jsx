import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getProject, saveProject, getRegionsFromBackend, saveRegionsToBackend, getObjectsFromBackend, getThumbnail } from '../utils/storage';
import './ProjectRegionsPage.css';

export default function ProjectRegionsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnToFile = location.state?.returnToFile || null;
  const [project, setProject] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [drawnRegions, setDrawnRegions] = useState([]); // All drawn regions
  const [selectedRegionType, setSelectedRegionType] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  
  // Search state for subsystems/documents
  const [subRegionSearchQuery, setSubRegionSearchQuery] = useState('');
  
  // Selected sub-region group for detail view (by name, not individual region)
  const [selectedSubRegionName, setSelectedSubRegionName] = useState(null);
  
  // Editing sub-region name
  const [editingSubRegionName, setEditingSubRegionName] = useState(null);
  const [editNameValue, setEditNameValue] = useState('');
  
  // All objects in project (for finding objects in regions)
  const [allObjects, setAllObjects] = useState([]);
  
  // Thumbnails for objects in detail view
  const [thumbnails, setThumbnails] = useState({});
  const [loadingThumbnails, setLoadingThumbnails] = useState({});
  
  // View mode for sub-region detail: 'simple' or 'byClass'
  const [detailViewMode, setDetailViewMode] = useState('simple');
  const [selectedClassTab, setSelectedClassTab] = useState(null);
  
  // Column widths for by-class view
  const [byClassColumnWidths, setByClassColumnWidths] = useState({});
  const [resizingColumn, setResizingColumn] = useState(null);
  
  // New region type dialog
  const [showNewTypeDialog, setShowNewTypeDialog] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');

  // Load project and regions
  useEffect(() => {
    const loadData = async () => {
      try {
        const loadedProject = await getProject(projectId);
        if (loadedProject) {
          setProject(loadedProject);
          
          // Load drawn regions from backend
          try {
            const regions = await getRegionsFromBackend(projectId);
            setDrawnRegions(regions);
          } catch (error) {
            console.error('Error loading regions:', error);
          }
          
          // Load objects from backend
          try {
            const objects = await getObjectsFromBackend(projectId);
            setAllObjects(objects);
          } catch (error) {
            console.error('Error loading objects:', error);
          }
        } else {
          navigate('/');
        }
      } catch (error) {
        console.error('Error loading project:', error);
        navigate('/');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [projectId, navigate]);

  // Get region types from project
  const regionTypes = project?.regionTypes || [];
  
  // Filter region types by search
  const filteredRegionTypes = regionTypes.filter(rt =>
    rt.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Get count of drawn regions per type
  const getRegionCount = (typeName) => {
    return drawnRegions.filter(r => r.regionType === typeName).length;
  };

  // Get sub-regions for a type, grouped by subRegionName
  const getSubRegions = (typeName) => {
    return drawnRegions.filter(r => r.regionType === typeName);
  };
  
  // Get unique sub-region names with their regions grouped
  const getGroupedSubRegions = (typeName) => {
    const regions = drawnRegions.filter(r => r.regionType === typeName);
    const grouped = {};
    
    regions.forEach(region => {
      const name = region.subRegionName || 'Unnamed';
      if (!grouped[name]) {
        grouped[name] = [];
      }
      grouped[name].push(region);
    });
    
    // Convert to array of { name, regions, documents }
    return Object.entries(grouped).map(([name, regions]) => ({
      name,
      regions,
      documents: [...new Set(regions.map(r => r.filename))],
      totalObjects: regions.reduce((sum, r) => sum + getObjectsInRegion(r).length, 0)
    }));
  };
  
  // Filter grouped sub-regions by search query
  const getFilteredGroupedSubRegions = (typeName) => {
    const groups = getGroupedSubRegions(typeName);
    if (!subRegionSearchQuery.trim()) return groups;
    
    const query = subRegionSearchQuery.toLowerCase();
    return groups.filter(group => 
      group.name.toLowerCase().includes(query) ||
      group.documents.some(doc => doc?.toLowerCase().includes(query))
    );
  };
  
  // Filter sub-regions by search query (for backward compatibility)
  const getFilteredSubRegions = (typeName) => {
    const subRegions = getSubRegions(typeName);
    if (!subRegionSearchQuery.trim()) return subRegions;
    
    const query = subRegionSearchQuery.toLowerCase();
    return subRegions.filter(region => 
      region.subRegionName?.toLowerCase().includes(query) ||
      region.filename?.toLowerCase().includes(query) ||
      region.regionType?.toLowerCase().includes(query)
    );
  };

  // Global search results - search across all regions
  const globalSearchResults = useMemo(() => {
    if (!subRegionSearchQuery.trim()) return [];
    
    const query = subRegionSearchQuery.toLowerCase();
    return drawnRegions.filter(region => 
      region.subRegionName?.toLowerCase().includes(query) ||
      region.filename?.toLowerCase().includes(query) ||
      region.regionType?.toLowerCase().includes(query)
    );
  }, [drawnRegions, subRegionSearchQuery]);

  // Point-in-polygon test using ray casting algorithm
  const isPointInPolygon = (px, py, polygon) => {
    if (!polygon || polygon.length < 3) return false;
    
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  };
  
  // Check if point is within a rectangle
  const isPointInRect = (px, py, rect) => {
    return (
      px >= rect.x &&
      px <= rect.x + rect.width &&
      py >= rect.y &&
      py <= rect.y + rect.height
    );
  };
  
  // Check if >50% of object is within a region (works for both rect and polyline regions)
  const isObjectInRegion = (obj, region) => {
    // Must be same file and page
    if (obj.filename !== region.filename) return false;
    if (obj.page !== region.page) return false;
    
    // Get object bounds
    const objBbox = obj.bbox || { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
    if (!objBbox || objBbox.width === undefined) return false;
    
    // Sample a grid of points within the object's bounding box
    // More samples = more accurate but slower
    const sampleCount = 5; // 5x5 grid = 25 sample points
    let pointsInside = 0;
    const totalPoints = sampleCount * sampleCount;
    
    for (let i = 0; i < sampleCount; i++) {
      for (let j = 0; j < sampleCount; j++) {
        // Calculate sample point position (evenly distributed within object bbox)
        const px = objBbox.x + (objBbox.width * (i + 0.5)) / sampleCount;
        const py = objBbox.y + (objBbox.height * (j + 0.5)) / sampleCount;
        
        // Check if point is in region based on region type
        let isInside = false;
        
        if (region.shapeType === 'polyline' && region.polylinePoints && region.polylinePoints.length >= 3) {
          // Use polygon containment test
          isInside = isPointInPolygon(px, py, region.polylinePoints);
        } else if (region.shapeType === 'circle' && region.bbox) {
          // Circle containment test
          const centerX = region.bbox.x + region.bbox.width / 2;
          const centerY = region.bbox.y + region.bbox.height / 2;
          const radiusX = region.bbox.width / 2;
          const radiusY = region.bbox.height / 2;
          // Ellipse equation: ((x-cx)/rx)^2 + ((y-cy)/ry)^2 <= 1
          const dx = (px - centerX) / radiusX;
          const dy = (py - centerY) / radiusY;
          isInside = (dx * dx + dy * dy) <= 1;
        } else if (region.bbox) {
          // Rectangle containment test
          isInside = isPointInRect(px, py, region.bbox);
        }
        
        if (isInside) pointsInside++;
      }
    }
    
    // Return true if more than 50% of sample points are inside the region
    return pointsInside > totalPoints / 2;
  };

  // Get all objects within a specific region
  const getObjectsInRegion = (region) => {
    if (!region) return [];
    return allObjects.filter(obj => isObjectInRegion(obj, region));
  };

  // Get columns for a specific class (subclasses + custom columns)
  const getColumnsForClass = (className) => {
    if (!className || !project?.classes) return [{ id: 'ocr_text', name: 'Tag' }];
    
    // Find the root class
    const rootClass = project.classes.find(c => c.name === className && !c.parentId);
    if (!rootClass) return [{ id: 'ocr_text', name: 'Tag' }];
    
    // Get subclasses
    const subclasses = project.classes.filter(c => c.parentId === rootClass.id);
    
    // Build columns
    const columns = subclasses.length > 0
      ? subclasses.map(sub => ({
          id: `subclass_${sub.name}`,
          name: sub.name,
          subclassName: sub.name,
          isSubclass: true
        }))
      : [{ id: 'ocr_text', name: 'Tag' }];
    
    // Add custom columns
    const customColumns = project.classColumns?.[className] || [];
    return [...columns, ...customColumns];
  };

  // Get cell value for an object and column
  const getCellValue = (obj, column) => {
    if (column.isSubclass) {
      return obj.subclassValues?.[column.subclassName] || '-';
    }
    if (column.id === 'ocr_text') {
      return obj.ocr_text || '-';
    }
    // Custom columns
    return obj.customValues?.[column.id] || obj[column.id] || '-';
  };

  // Get column width for by-class view
  const getByClassColumnWidth = (className, columnId) => {
    return byClassColumnWidths[className]?.[columnId] || 150;
  };

  // Column resize handler for by-class view
  const handleColumnResizeStart = (e, columnId) => {
    if (!selectedClassTab) return;
    e.preventDefault();
    e.stopPropagation();
    setResizingColumn(columnId);
    
    const className = selectedClassTab;
    const startX = e.clientX;
    const startWidth = getByClassColumnWidth(className, columnId);
    
    const handleMouseMove = (moveEvent) => {
      const diff = moveEvent.clientX - startX;
      const newWidth = Math.max(80, startWidth + diff);
      setByClassColumnWidths(prev => ({
        ...prev,
        [className]: {
          ...(prev[className] || {}),
          [columnId]: newWidth
        }
      }));
    };
    
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      setResizingColumn(null);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Handle sidebar resize
  const handleSidebarMouseDown = (e) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizingSidebar) {
        const newWidth = Math.max(320, Math.min(500, e.clientX));
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      document.body.style.userSelect = '';
    };

    if (isResizingSidebar) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

  // Create new region type
  const handleCreateRegionType = async () => {
    if (!newTypeName.trim()) return;
    
    const newType = {
      id: `rt_${Date.now()}`,
      name: newTypeName.trim(),
      fillColor: '#3498db',  // Default purple fill
      borderColor: '#3498db', // Default purple border
      createdAt: new Date().toISOString(),
    };
    
    const updatedTypes = [...regionTypes, newType];
    const updatedProject = { ...project, regionTypes: updatedTypes };
    
    try {
      await saveProject(updatedProject);
      setProject(updatedProject);
      setShowNewTypeDialog(false);
      setNewTypeName('');
    } catch (error) {
      console.error('Error saving region type:', error);
      alert('Failed to save region type');
    }
  };

  // Delete region type
  const handleDeleteRegionType = async (typeId, typeName) => {
    const regionCount = getRegionCount(typeName);
    if (regionCount > 0) {
      if (!confirm(`Delete region type "${typeName}"?\n\nThis will also delete ${regionCount} drawn region(s) of this type.`)) {
        return;
      }
      
      // Delete drawn regions of this type
      const updatedRegions = drawnRegions.filter(r => r.regionType !== typeName);
      try {
        await saveRegionsToBackend(projectId, updatedRegions);
        setDrawnRegions(updatedRegions);
      } catch (error) {
        console.error('Error deleting regions:', error);
      }
    } else {
      if (!confirm(`Delete region type "${typeName}"?`)) {
        return;
      }
    }
    
    const updatedTypes = regionTypes.filter(rt => rt.id !== typeId);
    const updatedProject = { ...project, regionTypes: updatedTypes };
    
    try {
      await saveProject(updatedProject);
      setProject(updatedProject);
      if (selectedRegionType?.id === typeId) {
        setSelectedRegionType(null);
      }
    } catch (error) {
      console.error('Error deleting region type:', error);
      alert('Failed to delete region type');
    }
  };

  // Delete a drawn region
  const handleDeleteRegion = async (regionId) => {
    if (!confirm('Delete this region?')) return;
    
    const updatedRegions = drawnRegions.filter(r => r.id !== regionId);
    try {
      await saveRegionsToBackend(projectId, updatedRegions);
      setDrawnRegions(updatedRegions);
    } catch (error) {
      console.error('Error deleting region:', error);
      alert('Failed to delete region');
    }
  };
  
  // Rename a sub-region (updates all regions with that name)
  const handleRenameSubRegion = async (oldName, newName) => {
    if (!newName.trim() || newName === oldName) {
      setEditingSubRegionName(null);
      return;
    }
    
    const updatedRegions = drawnRegions.map(r => {
      if (r.subRegionName === oldName && r.regionType === selectedRegionType?.name) {
        return { ...r, subRegionName: newName.trim() };
      }
      return r;
    });
    
    try {
      await saveRegionsToBackend(projectId, updatedRegions);
      setDrawnRegions(updatedRegions);
      setEditingSubRegionName(null);
      // Update selected sub-region name if it was the one being renamed
      if (selectedSubRegionName === oldName) {
        setSelectedSubRegionName(newName.trim());
      }
    } catch (error) {
      console.error('Error renaming sub-region:', error);
      alert('Failed to rename sub-region');
    }
  };
  
  // Delete all regions with a specific sub-region name
  const handleDeleteSubRegionGroup = async (subRegionName) => {
    const regionsToDelete = drawnRegions.filter(
      r => r.subRegionName === subRegionName && r.regionType === selectedRegionType?.name
    );
    
    if (!confirm(`Delete sub-region "${subRegionName}"?\n\nThis will delete ${regionsToDelete.length} region(s) across ${[...new Set(regionsToDelete.map(r => r.filename))].length} document(s).`)) {
      return;
    }
    
    const updatedRegions = drawnRegions.filter(
      r => !(r.subRegionName === subRegionName && r.regionType === selectedRegionType?.name)
    );
    
    try {
      await saveRegionsToBackend(projectId, updatedRegions);
      setDrawnRegions(updatedRegions);
      setSelectedSubRegionName(null);
    } catch (error) {
      console.error('Error deleting sub-region group:', error);
      alert('Failed to delete sub-region');
    }
  };
  
  // Update colors for all regions with a specific sub-region name
  const handleUpdateSubRegionColor = async (subRegionName, colorType, colorValue) => {
    const updatedRegions = drawnRegions.map(r => {
      if (r.subRegionName === subRegionName && r.regionType === selectedRegionType?.name) {
        return { ...r, [colorType]: colorValue };
      }
      return r;
    });
    
    try {
      await saveRegionsToBackend(projectId, updatedRegions);
      setDrawnRegions(updatedRegions);
    } catch (error) {
      console.error('Error updating sub-region color:', error);
    }
  };
  
  // Get colors for a sub-region group (from first region or defaults)
  const getSubRegionColors = (subRegionName) => {
    const firstRegion = drawnRegions.find(
      r => r.subRegionName === subRegionName && r.regionType === selectedRegionType?.name
    );
    if (firstRegion && (firstRegion.fillColor !== undefined || firstRegion.borderColor !== undefined)) {
      return {
        fillColor: firstRegion.fillColor !== undefined ? firstRegion.fillColor : '#3498db',
        borderColor: firstRegion.borderColor !== undefined ? firstRegion.borderColor : '#3498db'
      };
    }
    // Fall back to region type colors
    const rt = regionTypes.find(r => r.name === selectedRegionType?.name);
    return {
      fillColor: rt?.fillColor !== undefined ? rt.fillColor : '#3498db',
      borderColor: rt?.borderColor !== undefined ? rt.borderColor : '#3498db'
    };
  };
  
  // Load thumbnail for an object
  const loadThumbnail = async (obj) => {
    if (!obj?.id || !obj?.filename || !obj?.bbox) return;
    if (thumbnails[obj.id] || loadingThumbnails[obj.id]) return;
    
    setLoadingThumbnails(prev => ({ ...prev, [obj.id]: true }));
    
    try {
      const thumbnail = await getThumbnail(
        obj.filename, 
        obj.page || 0, 
        obj.bbox, 
        obj.detected_rotation || 0,
        obj.detected_inverted || false
      );
      setThumbnails(prev => ({ ...prev, [obj.id]: thumbnail }));
    } catch (error) {
      console.error('Failed to load thumbnail:', error);
      setThumbnails(prev => ({ ...prev, [obj.id]: null }));
    } finally {
      setLoadingThumbnails(prev => ({ ...prev, [obj.id]: false }));
    }
  };
  
  // Update region type color
  const handleUpdateRegionTypeColor = async (typeId, colorType, colorValue) => {
    const updatedTypes = regionTypes.map(rt => {
      if (rt.id === typeId) {
        return { ...rt, [colorType]: colorValue };
      }
      return rt;
    });
    
    const updatedProject = { ...project, regionTypes: updatedTypes };
    
    try {
      await saveProject(updatedProject);
      setProject(updatedProject);
      // Update selected region type if it's the one being modified
      if (selectedRegionType?.id === typeId) {
        setSelectedRegionType({ ...selectedRegionType, [colorType]: colorValue });
      }
    } catch (error) {
      console.error('Error updating region type color:', error);
    }
  };
  
  // Get the current region type's colors
  const getRegionTypeColors = (typeName) => {
    const rt = regionTypes.find(r => r.name === typeName);
    return {
      fillColor: rt?.fillColor || '#3498db',
      borderColor: rt?.borderColor || '#3498db'
    };
  };

  if (isLoading) {
    return (
      <div className="project-regions-page">
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading project...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="project-regions-page">
      <header className="regions-header">
        <button 
          className="back-btn"
          onClick={() => navigate(`/project/${projectId}`, { state: { openFile: returnToFile } })}
        >
          ← Back to Project
        </button>
        <h1>{project?.name} - Regions</h1>
        <h1 className="brand-title">pidly</h1>
      </header>

      <div className="regions-body">
        {/* Sidebar */}
        <div 
          className="regions-sidebar" 
          style={{ 
            width: sidebarWidth, 
            minWidth: 320, 
            maxWidth: 500,
            position: 'relative'
          }}
        >
          {/* Overview button */}
          <div 
            className={`sidebar-item home-item ${!selectedRegionType ? 'selected' : ''}`}
            onClick={() => { setSelectedRegionType(null); setSelectedSubRegionName(null); }}
          >
            <span className="item-name">Overview</span>
          </div>

          {/* Create New Region button */}
          <button 
            className="create-region-btn"
            onClick={() => setShowNewTypeDialog(true)}
          >
            Create New Region
          </button>

          {/* Region Types section */}
          <div className="regions-section">
            <div className="regions-section-header">
              <span className="section-title">Region Types</span>
            </div>
            
            {/* Search */}
            <div className="regions-search">
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            {/* Region Types list */}
            <div className="region-list">
              {filteredRegionTypes.length === 0 ? (
                <p className="no-regions">
                  {searchQuery ? 'No region types found' : 'No region types yet'}
                </p>
              ) : (
                filteredRegionTypes.map(rt => (
                  <div
                    key={rt.id}
                    className={`region-list-item ${selectedRegionType?.id === rt.id ? 'selected' : ''}`}
                    onClick={() => { setSelectedRegionType(rt); setSelectedSubRegionName(null); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      marginBottom: '2px',
                      transition: 'all 0.15s',
                      background: selectedRegionType?.id === rt.id ? '#2a2a2a' : 'transparent',
                      borderTop: 'none',
                      borderRight: 'none',
                      borderBottom: 'none',
                      borderLeft: selectedRegionType?.id === rt.id ? '3px solid #3498db' : '3px solid transparent',
                      outline: 'none'
                    }}
                    onMouseEnter={(e) => { 
                      if (selectedRegionType?.id !== rt.id) e.currentTarget.style.background = '#252525'; 
                      e.currentTarget.querySelector('.region-item-actions').style.opacity = '1';
                    }}
                    onMouseLeave={(e) => { 
                      if (selectedRegionType?.id !== rt.id) e.currentTarget.style.background = 'transparent'; 
                      e.currentTarget.querySelector('.region-item-actions').style.opacity = '0';
                    }}
                  >
                    <div className="region-item-info" style={{ flex: 1, minWidth: 0 }}>
                      <div className="region-item-name" style={{ fontSize: '13px', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rt.name}</div>
                      <div className="region-item-meta" style={{ fontSize: '11px', color: '#888' }}>{getRegionCount(rt.name)} region{getRegionCount(rt.name) !== 1 ? 's' : ''}</div>
                    </div>
                    <div className="region-item-actions" style={{ display: 'flex', gap: '4px', opacity: 0, transition: 'opacity 0.15s' }}>
                      <button
                        className="region-action-btn delete"
                        title="Delete type"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteRegionType(rt.id, rt.name);
                        }}
                        style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#e74c3c'; e.currentTarget.style.background = '#3a2525'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = '#666'; e.currentTarget.style.background = 'transparent'; }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          
          {/* Resize handle */}
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: 5,
              cursor: 'col-resize',
              background: isResizingSidebar ? '#3498db' : 'transparent',
              transition: 'background 0.2s',
            }}
            onMouseDown={handleSidebarMouseDown}
            onMouseEnter={(e) => e.currentTarget.style.background = '#3498db'}
            onMouseLeave={(e) => !isResizingSidebar && (e.currentTarget.style.background = 'transparent')}
          />
        </div>

        {/* Main Content - Takes remaining space */}
        <div className="regions-main">
          {!selectedRegionType ? (
            <div className="home-content">
              <div className="home-header-section">
                <div className="home-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <path d="M3 9h18M9 21V9"/>
                  </svg>
                </div>
                <h2>Regions Overview</h2>
                <p className="home-subtitle">Define and manage document regions and areas</p>
              </div>
              
              <div className="home-stats-row">
                <div className="stat-card" style={{ background: 'transparent', border: '1px solid #333' }}>
                  <div className="stat-number" style={{ color: '#fff', fontWeight: 700 }}>{regionTypes.length}</div>
                  <div className="stat-label" style={{ color: '#888', fontWeight: 600 }}>Region Types</div>
                </div>
                <div className="stat-card" style={{ background: 'transparent', border: '1px solid #333' }}>
                  <div className="stat-number" style={{ color: '#fff', fontWeight: 700 }}>{drawnRegions.length}</div>
                  <div className="stat-label" style={{ color: '#888', fontWeight: 600 }}>Drawn Regions</div>
                </div>
                <div className="stat-card" style={{ background: 'transparent', border: '1px solid #333' }}>
                  <div className="stat-number" style={{ color: '#fff', fontWeight: 700 }}>
                    {new Set(drawnRegions.map(r => r.filename)).size}
                  </div>
                  <div className="stat-label" style={{ color: '#888', fontWeight: 600 }}>Documents</div>
                </div>
              </div>

              {/* Region Types with Sub-regions */}
              {regionTypes.length > 0 && (
                <div className="regions-overview-section" style={{ width: '100%', marginBottom: '24px' }}>
                  <h3 style={{ color: '#fff', fontWeight: 700, marginBottom: '16px', fontSize: '14px' }}>Region Types & Sub-regions</h3>
                  <div className="regions-overview-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {regionTypes.map(rt => {
                      const groups = getGroupedSubRegions(rt.name);
                      const totalObjects = groups.reduce((sum, g) => sum + g.totalObjects, 0);
                      return (
                        <div 
                          key={rt.id} 
                          className="region-type-card"
                          style={{
                            background: 'linear-gradient(135deg, #252525 0%, #2a2a2a 100%)',
                            border: '1px solid #3a3a3a',
                            borderRadius: '8px',
                            overflow: 'hidden'
                          }}
                        >
                          <div 
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              padding: '12px 16px',
                              cursor: 'pointer',
                              gap: '12px'
                            }}
                            onClick={() => { setSelectedRegionType(rt); setSelectedSubRegionName(null); }}
                          >
                            <div style={{ 
                              width: '8px', 
                              height: '8px', 
                              borderRadius: '2px', 
                              background: rt.fillColor || '#3498db',
                              flexShrink: 0
                            }} />
                            <div style={{ flex: 1, fontWeight: 600, color: '#fff', fontSize: '13px' }}>{rt.name}</div>
                            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                              <span style={{ color: '#888', fontSize: '12px' }}>{groups.length} sub-region{groups.length !== 1 ? 's' : ''}</span>
                              <span style={{ color: '#3498db', fontSize: '12px', fontWeight: 600 }}>{totalObjects} object{totalObjects !== 1 ? 's' : ''}</span>
                            </div>
                          </div>
                          {groups.length > 0 && (
                            <div style={{ 
                              borderTop: '1px solid #333',
                              padding: '8px 16px 8px 36px',
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '6px'
                            }}>
                              {groups.slice(0, 8).map(g => (
                                <div 
                                  key={g.name}
                                  onClick={() => { setSelectedRegionType(rt); setSelectedSubRegionName(g.name); }}
                                  style={{
                                    padding: '4px 10px',
                                    background: '#333',
                                    borderRadius: '4px',
                                    fontSize: '11px',
                                    color: '#ccc',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    transition: 'all 0.15s'
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = '#444'; e.currentTarget.style.color = '#fff'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = '#333'; e.currentTarget.style.color = '#ccc'; }}
                                >
                                  <span>{g.name}</span>
                                  <span style={{ color: '#888', fontSize: '10px' }}>({g.totalObjects})</span>
                                </div>
                              ))}
                              {groups.length > 8 && (
                                <div style={{ padding: '4px 10px', fontSize: '11px', color: '#666' }}>
                                  +{groups.length - 8} more
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="home-actions-section" style={{ background: 'transparent', border: 'none', padding: 0, width: '100%' }}>
                <h3 style={{ color: '#fff', fontWeight: 700, fontSize: '14px', marginBottom: '12px' }}>Quick Actions</h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    onClick={() => setShowNewTypeDialog(true)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 14px',
                      background: '#333',
                      border: '1px solid #444',
                      borderRadius: '6px',
                      color: '#fff',
                      fontSize: '12px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3498db'; e.currentTarget.style.background = '#3a3a3a'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#444'; e.currentTarget.style.background = '#333'; }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M12 5v14M5 12h14"/>
                    </svg>
                    New Type
                  </button>
                  <button 
                    onClick={() => navigate(`/project/${projectId}`)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 14px',
                      background: '#333',
                      border: '1px solid #444',
                      borderRadius: '6px',
                      color: '#fff',
                      fontSize: '12px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3498db'; e.currentTarget.style.background = '#3a3a3a'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#444'; e.currentTarget.style.background = '#333'; }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <path d="M3 9h18"/>
                    </svg>
                    Draw Regions
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="region-type-detail">
              <div className="region-type-header">
                <h2>{selectedRegionType.name}</h2>
                <span className="region-count-badge">
                  {getRegionCount(selectedRegionType.name)} sub region{getRegionCount(selectedRegionType.name) !== 1 ? 's' : ''}
                </span>
                <div className="header-spacer" />
                <button 
                  className="delete-type-btn"
                  onClick={() => handleDeleteRegionType(selectedRegionType.id, selectedRegionType.name)}
                >
                  Delete Type
                </button>
              </div>
              
              {/* Search Sub-regions */}
              <div className="subregion-search">
                <input
                  type="text"
                  placeholder="Search subsystems, documents..."
                  value={subRegionSearchQuery}
                  onChange={(e) => setSubRegionSearchQuery(e.target.value)}
                />
              </div>
              
              <div className="region-type-content">
                {selectedSubRegionName ? (
                  // Sub-region group detail view - shows all documents with this sub-region name
                  (() => {
                    const group = getGroupedSubRegions(selectedRegionType.name).find(g => g.name === selectedSubRegionName);
                    if (!group) {
                      setSelectedSubRegionName(null);
                      return null;
                    }
                    
                    // Get all objects across all regions in this group
                    const allGroupObjects = group.regions.flatMap(r => getObjectsInRegion(r));
                    
                    return (
                      <div className="sub-region-detail">
                        <div className="sub-region-detail-header">
                          <button 
                            className="back-to-list-btn"
                            onClick={() => {
                              setSelectedSubRegionName(null);
                              setDetailViewMode('simple');
                              setSelectedClassTab(null);
                            }}
                          >
                            ← Back to List
                          </button>
                          {editingSubRegionName === selectedSubRegionName ? (
                            <input
                              type="text"
                              className="edit-name-input"
                              value={editNameValue}
                              onChange={(e) => setEditNameValue(e.target.value)}
                              onBlur={() => handleRenameSubRegion(selectedSubRegionName, editNameValue)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRenameSubRegion(selectedSubRegionName, editNameValue);
                                if (e.key === 'Escape') setEditingSubRegionName(null);
                              }}
                              autoFocus
                            />
                          ) : (
                            <h3 
                              className="editable-name"
                              onClick={() => {
                                setEditingSubRegionName(selectedSubRegionName);
                                setEditNameValue(selectedSubRegionName);
                              }}
                              title="Click to edit name"
                            >
                              {selectedSubRegionName}
                              
                            </h3>
                          )}
                          <span className="sub-region-doc">
                            {group.documents.length} document{group.documents.length !== 1 ? 's' : ''} • {group.regions.length} region{group.regions.length !== 1 ? 's' : ''}
                          </span>
                          
                          {/* Color controls for this sub-region */}
                          {(() => {
                            const subRegionColors = getSubRegionColors(selectedSubRegionName);
                            return (
                              <div className="header-color-controls">
                                <div className="color-setting-inline">
                                  <label>Fill:</label>
                                  <div className="color-controls">
                                    <button
                                      className={`no-color-btn ${subRegionColors.fillColor === 'none' ? 'active' : ''}`}
                                      onClick={() => handleUpdateSubRegionColor(
                                        selectedSubRegionName, 
                                        'fillColor', 
                                        subRegionColors.fillColor === 'none' ? '#3498db' : 'none'
                                      )}
                                      title={subRegionColors.fillColor === 'none' ? 'Enable fill' : 'No fill'}
                                    >
                                      ∅
                                    </button>
                                    <input
                                      type="color"
                                      value={subRegionColors.fillColor === 'none' ? '#3498db' : (subRegionColors.fillColor || '#3498db')}
                                      onChange={(e) => handleUpdateSubRegionColor(selectedSubRegionName, 'fillColor', e.target.value)}
                                      onClick={() => {
                                        if (subRegionColors.fillColor === 'none') {
                                          handleUpdateSubRegionColor(selectedSubRegionName, 'fillColor', '#3498db');
                                        }
                                      }}
                                      style={{ opacity: subRegionColors.fillColor === 'none' ? 0.5 : 1, cursor: 'pointer' }}
                                    />
                                  </div>
                                </div>
                                <div className="color-setting-inline">
                                  <label>Line:</label>
                                  <div className="color-controls">
                                    <button
                                      className={`no-color-btn ${subRegionColors.borderColor === 'none' ? 'active' : ''}`}
                                      onClick={() => handleUpdateSubRegionColor(
                                        selectedSubRegionName, 
                                        'borderColor', 
                                        subRegionColors.borderColor === 'none' ? '#3498db' : 'none'
                                      )}
                                      title={subRegionColors.borderColor === 'none' ? 'Enable line' : 'No line'}
                                    >
                                      ∅
                                    </button>
                                    <input
                                      type="color"
                                      value={subRegionColors.borderColor === 'none' ? '#3498db' : (subRegionColors.borderColor || '#3498db')}
                                      onChange={(e) => handleUpdateSubRegionColor(selectedSubRegionName, 'borderColor', e.target.value)}
                                      onClick={() => {
                                        if (subRegionColors.borderColor === 'none') {
                                          handleUpdateSubRegionColor(selectedSubRegionName, 'borderColor', '#3498db');
                                        }
                                      }}
                                      style={{ opacity: subRegionColors.borderColor === 'none' ? 0.5 : 1, cursor: 'pointer' }}
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                          
                          <div className="header-spacer" />
                          <button 
                            className="delete-group-btn"
                            onClick={() => handleDeleteSubRegionGroup(selectedSubRegionName)}
                            title="Delete all regions with this name"
                          >
                            Delete All
                          </button>
                        </div>
                        
                        {/* Documents containing this sub-region - simple list */}
                        <div className="sub-region-documents">
                          <h4>Documents ({group.documents.length})</h4>
                          <div className="documents-list">
                            {group.documents.map(docName => {
                              const docRegions = group.regions.filter(r => r.filename === docName);
                              const docObjects = docRegions.reduce((sum, r) => sum + getObjectsInRegion(r).length, 0);
                              return (
                                <div key={docName} className="document-item">
                                  <span className="doc-name">{docName?.replace('.pdf', '') || 'Unknown'}</span>
                                  <span className="doc-objects">{docObjects} objects</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        
                        {/* All objects across all documents */}
                        <div className="objects-in-region">
                          <div className="objects-header">
                            <h4>All Objects ({allGroupObjects.length})</h4>
                            <div className="objects-header-actions">
                              <button 
                                className={`view-toggle-btn ${detailViewMode === 'simple' ? 'active' : ''}`}
                                onClick={() => setDetailViewMode('simple')}
                                title="Simple view"
                              >
                                📋 Simple
                              </button>
                              <button 
                                className={`view-toggle-btn ${detailViewMode === 'byClass' ? 'active' : ''}`}
                                onClick={() => {
                                  setDetailViewMode('byClass');
                                  // Set first class as selected tab
                                  const classes = [...new Set(allGroupObjects.map(o => o.className || o.label))];
                                  if (classes.length > 0 && !selectedClassTab) {
                                    setSelectedClassTab(classes[0]);
                                  }
                                }}
                                title="View by class"
                              >
                                📊 By Class
                              </button>
                              {allGroupObjects.length > 0 && (
                                <button 
                                  className="export-csv-btn"
                                  onClick={() => {
                                    // Build CSV content based on current view
                                    let headers, rows;
                                    
                                    if (detailViewMode === 'byClass' && selectedClassTab) {
                                      const classObjects = allGroupObjects.filter(o => (o.className || o.label) === selectedClassTab);
                                      const columns = getColumnsForClass(selectedClassTab);
                                      headers = ['Find', 'Image', ...columns.map(c => c.name), 'Document'];
                                      rows = classObjects.map(obj => {
                                        const values = columns.map(col => getCellValue(obj, col));
                                        return ['', '', ...values, obj.filename?.replace('.pdf', '') || ''].map(val => `"${String(val).replace(/"/g, '""')}"`).join(',');
                                      });
                                    } else {
                                      headers = ['Object Type', 'Tag', 'Document', 'Page'];
                                      rows = allGroupObjects.map(obj => {
                                        const objType = obj.label || obj.className || 'Unknown';
                                        const tag = obj.ocr_text || obj.subclassValues?.['Tag'] || obj.subclassValues?.['tag'] || '';
                                        const doc = obj.filename?.replace('.pdf', '') || '';
                                        const page = (obj.page || 0) + 1;
                                        return [objType, tag, doc, page].map(val => `"${String(val).replace(/"/g, '""')}"`).join(',');
                                      });
                                    }
                                    
                                    const csvContent = [headers.join(','), ...rows].join('\n');
                                    
                                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                                    const url = URL.createObjectURL(blob);
                                    const link = document.createElement('a');
                                    link.href = url;
                                    link.download = `${selectedSubRegionName}${detailViewMode === 'byClass' && selectedClassTab ? '_' + selectedClassTab : ''}_objects.csv`;
                                    document.body.appendChild(link);
                                    link.click();
                                    document.body.removeChild(link);
                                    URL.revokeObjectURL(url);
                                  }}
                                >
                                  📥 Export CSV
                                </button>
                              )}
                            </div>
                          </div>
                          
                          {allGroupObjects.length === 0 ? (
                            <p className="no-objects-message">No objects found in any region with this name.</p>
                          ) : detailViewMode === 'simple' ? (
                            // Simple view - all objects in one table
                            <div className="objects-table">
                              <table>
                                <thead>
                                  <tr>
                                    <th className="find-col"></th>
                                    <th className="image-col">Image</th>
                                    <th>Object Type</th>
                                    <th>Tag</th>
                                    <th>Document</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {allGroupObjects.map(obj => (
                                    <tr key={obj.id}>
                                      <td className="find-cell">
                                        <button 
                                          className="find-btn"
                                          onClick={() => {
                                            navigate(`/project/${projectId}`, { 
                                              state: { 
                                                navigateToObject: obj 
                                              } 
                                            });
                                          }}
                                          title="Find in document"
                                        >
                                          🔍
                                        </button>
                                      </td>
                                      <td className="image-cell">
                                        {thumbnails[obj.id] ? (
                                          <img 
                                            src={thumbnails[obj.id]} 
                                            alt="Object" 
                                            className="object-thumbnail"
                                          />
                                        ) : loadingThumbnails[obj.id] ? (
                                          <span className="loading-thumbnail">...</span>
                                        ) : (
                                          <button 
                                            className="load-thumbnail-btn"
                                            onClick={() => loadThumbnail(obj)}
                                            title="Load image"
                                          >
                                            📷
                                          </button>
                                        )}
                                      </td>
                                      <td>{obj.label || obj.className || 'Unknown'}</td>
                                      <td>{obj.ocr_text || obj.subclassValues?.['Tag'] || obj.subclassValues?.['tag'] || '-'}</td>
                                      <td className="obj-document">{obj.filename?.replace('.pdf', '') || '-'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            // By-class view - tabs for each class
                            <div className="by-class-view">
                              {/* Class tabs */}
                              <div className="class-tabs">
                                {[...new Set(allGroupObjects.map(o => o.className || o.label))].map(className => {
                                  const classCount = allGroupObjects.filter(o => (o.className || o.label) === className).length;
                                  return (
                                    <button
                                      key={className}
                                      className={`class-tab ${selectedClassTab === className ? 'active' : ''}`}
                                      onClick={() => setSelectedClassTab(className)}
                                    >
                                      {className} ({classCount})
                                    </button>
                                  );
                                })}
                              </div>
                              
                              {/* Class content */}
                              {selectedClassTab && (() => {
                                const classObjects = allGroupObjects.filter(o => (o.className || o.label) === selectedClassTab);
                                const columns = getColumnsForClass(selectedClassTab);
                                
                                return (
                                  <div className="class-tab-content">
                                    <div 
                                      className="objects-table-scroll-wrapper"
                                      style={{ maxWidth: '100%', overflowX: 'auto', overflowY: 'auto' }}
                                    >
                                      <div className="objects-table resizable-table">
                                        <table style={{ minWidth: 'max-content' }}>
                                          <thead>
                                            <tr>
                                              <th className="find-col" style={{ width: 40, minWidth: 40 }}></th>
                                              <th className="image-col" style={{ width: 120, minWidth: 120 }}>Image</th>
                                              {columns.map(col => (
                                                <th 
                                                  key={col.id} 
                                                  className="resizable-col"
                                                  style={{ 
                                                    width: getByClassColumnWidth(selectedClassTab, col.id),
                                                    minWidth: getByClassColumnWidth(selectedClassTab, col.id)
                                                  }}
                                                >
                                                  <span className="col-header-text">{col.name}</span>
                                                  <div 
                                                    className="column-resizer"
                                                    onMouseDown={(e) => handleColumnResizeStart(e, col.id)}
                                                  />
                                                </th>
                                              ))}
                                              <th style={{ minWidth: 150 }}>Document</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {classObjects.map(obj => (
                                              <tr key={obj.id}>
                                                <td className="find-cell">
                                                  <button 
                                                    className="find-btn"
                                                    onClick={() => {
                                                      navigate(`/project/${projectId}`, { 
                                                        state: { 
                                                          navigateToObject: obj 
                                                        } 
                                                      });
                                                    }}
                                                    title="Find in document"
                                                  >
                                                    🔍
                                                  </button>
                                                </td>
                                                <td className="image-cell">
                                                  {thumbnails[obj.id] ? (
                                                    <img 
                                                      src={thumbnails[obj.id]} 
                                                      alt="Object" 
                                                      className="object-thumbnail"
                                                    />
                                                  ) : loadingThumbnails[obj.id] ? (
                                                    <span className="loading-thumbnail">...</span>
                                                  ) : (
                                                    <button 
                                                      className="load-thumbnail-btn"
                                                      onClick={() => loadThumbnail(obj)}
                                                      title="Load image"
                                                    >
                                                      📷
                                                    </button>
                                                  )}
                                                </td>
                                                {columns.map(col => (
                                                  <td 
                                                    key={col.id}
                                                    style={{ 
                                                      width: getByClassColumnWidth(selectedClassTab, col.id),
                                                      minWidth: getByClassColumnWidth(selectedClassTab, col.id)
                                                    }}
                                                  >
                                                    {getCellValue(obj, col)}
                                                  </td>
                                                ))}
                                                <td className="obj-document">{obj.filename?.replace('.pdf', '') || '-'}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()
                ) : getFilteredGroupedSubRegions(selectedRegionType.name).length === 0 ? (
                  <div className="no-regions-message">
                    {subRegionSearchQuery.trim() ? (
                      <p>No regions found matching "{subRegionSearchQuery}"</p>
                    ) : (
                      <>
                        <p>No regions drawn for this type yet.</p>
                        <p>Go to a document, click "Objects" → "Draw Object/Region" → select "Region" to draw one.</p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="sub-regions-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Sub-region Name</th>
                          <th>Documents</th>
                          <th>Total Objects</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {getFilteredGroupedSubRegions(selectedRegionType.name).map(group => (
                          <tr 
                            key={group.name} 
                            className="clickable-row"
                            onClick={() => {
                              setSelectedSubRegionName(group.name);
                              setSelectedClassTab(null);
                              setDetailViewMode('simple');
                            }}
                          >
                            <td className="sub-region-name">
                              {editingSubRegionName === group.name ? (
                                <input
                                  type="text"
                                  className="edit-name-input-inline"
                                  value={editNameValue}
                                  onChange={(e) => setEditNameValue(e.target.value)}
                                  onBlur={() => handleRenameSubRegion(group.name, editNameValue)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleRenameSubRegion(group.name, editNameValue);
                                    if (e.key === 'Escape') setEditingSubRegionName(null);
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  autoFocus
                                />
                              ) : (
                                <span 
                                  className="editable-cell"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingSubRegionName(group.name);
                                    setEditNameValue(group.name);
                                  }}
                                  title="Click to edit"
                                >
                                  {group.name}
                                  
                                </span>
                              )}
                            </td>
                            <td className="region-documents">
                              <span className="doc-names">
                                {group.documents.map(d => d?.replace('.pdf', '')).join(', ')}
                              </span>
                              {group.regions.length > 1 && (
                                <span className="regions-count"> ({group.regions.length} sub regions)</span>
                              )}
                            </td>
                            <td className="region-objects-count">{group.totalObjects}</td>
                            <td className="region-actions">
                              <button 
                                className="delete-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteSubRegionGroup(group.name);
                                }}
                                title="Delete all regions with this name"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                                </svg>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New Region Type Dialog */}
      {showNewTypeDialog && (
        <div className="modal-overlay" onClick={() => setShowNewTypeDialog(false)}>
          <div className="modal new-type-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create Region Type</h2>
            <p className="modal-description">
              Region types are categories for organizing areas on your documents. 
              Examples: "Title Block", "Legend", "Hazop Area", "Revision Notes"
            </p>
            
            <div className="form-group">
              <label>Region Type Name:</label>
              <input
                type="text"
                placeholder="e.g., Title Block, Legend, Hazop Area..."
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateRegionType()}
                autoFocus
              />
            </div>
            
            <div className="modal-actions">
              <button onClick={() => { setShowNewTypeDialog(false); setNewTypeName(''); }}>
                Cancel
              </button>
              <button 
                className="primary-btn"
                onClick={handleCreateRegionType}
                disabled={!newTypeName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
