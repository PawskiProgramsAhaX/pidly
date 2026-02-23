import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllProjects, saveProject, deleteProject, migrateFromLocalStorage, initDB, deleteObjectsFromBackend } from '../../utils/storage';
import './ProjectListPage.css';

export default function ProjectListPage() {
  const [projects, setProjects] = useState([]);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [newProjectClient, setNewProjectClient] = useState('');
  const [newProjectTags, setNewProjectTags] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('projectListViewMode') || 'grid';
  });
  const [editingProject, setEditingProject] = useState(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editClient, setEditClient] = useState('');
  const [editTags, setEditTags] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('updated'); // 'updated', 'created', 'name'
  const [filterClient, setFilterClient] = useState('');
  const navigate = useNavigate();

  // Get unique clients for filter dropdown
  const uniqueClients = useMemo(() => {
    const clients = projects.map(p => p.client).filter(Boolean);
    return [...new Set(clients)].sort();
  }, [projects]);

  // Filter and sort projects
  const filteredProjects = useMemo(() => {
    let result = [...projects];
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(p => 
        p.name.toLowerCase().includes(query) ||
        p.description?.toLowerCase().includes(query) ||
        p.client?.toLowerCase().includes(query) ||
        p.tags?.some(t => t.toLowerCase().includes(query))
      );
    }
    
    // Client filter
    if (filterClient) {
      result = result.filter(p => p.client === filterClient);
    }
    
    // Sort
    result.sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      } else if (sortBy === 'created') {
        return new Date(b.createdAt) - new Date(a.createdAt);
      } else {
        return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
      }
    });
    
    return result;
  }, [projects, searchQuery, sortBy, filterClient]);

  // Load projects from IndexedDB on mount
  useEffect(() => {
    const loadProjects = async () => {
      try {
        await initDB();
        
        // Migrate from localStorage if needed (one-time)
        await migrateFromLocalStorage();
        
        const loadedProjects = await getAllProjects();
        setProjects(loadedProjects);
      } catch (error) {
        console.error('Error loading projects:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadProjects();
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('authenticated');
    navigate('/login');
  };

  const createProject = async () => {
    if (!newProjectName.trim()) return;

    const newProject = {
      id: `project_${Date.now()}`,
      name: newProjectName.trim(),
      description: newProjectDescription.trim(),
      client: newProjectClient.trim(),
      tags: newProjectTags.trim().split(',').map(t => t.trim()).filter(Boolean),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      folders: []
    };

    try {
      await saveProject(newProject);
      setProjects([...projects, newProject]);
      resetNewProjectForm();
      setShowNewProjectModal(false);
    } catch (error) {
      console.error('Error creating project:', error);
      alert('Failed to create project');
    }
  };

  const resetNewProjectForm = () => {
    setNewProjectName('');
    setNewProjectDescription('');
    setNewProjectClient('');
    setNewProjectTags('');
  };

  const handleDeleteProject = async (projectId, e) => {
    e.stopPropagation();
    
    if (confirm('Are you sure you want to delete this project? This cannot be undone.')) {
      try {
        await deleteProject(projectId);
        // Also delete the objects file from backend
        try {
          await deleteObjectsFromBackend(projectId);
        } catch (objError) {
          console.warn('Could not delete objects file:', objError);
        }
        setProjects(projects.filter(p => p.id !== projectId));
      } catch (error) {
        console.error('Error deleting project:', error);
        alert('Failed to delete project');
      }
    }
  };

  const openProject = (projectId) => {
    navigate(`/project/${projectId}`);
  };

  const openEditModal = (project, e) => {
    e.stopPropagation();
    setEditingProject(project);
    setEditName(project.name || '');
    setEditDescription(project.description || '');
    setEditClient(project.client || '');
    setEditTags(project.tags?.join(', ') || '');
  };

  const saveProjectEdits = async () => {
    if (!editingProject || !editName.trim()) return;

    const updatedProject = {
      ...editingProject,
      name: editName.trim(),
      description: editDescription.trim(),
      client: editClient.trim(),
      tags: editTags.trim().split(',').map(t => t.trim()).filter(Boolean),
      updatedAt: new Date().toISOString(),
    };

    try {
      await saveProject(updatedProject);
      setProjects(projects.map(p => p.id === updatedProject.id ? updatedProject : p));
      setEditingProject(null);
    } catch (error) {
      console.error('Error updating project:', error);
      alert('Failed to update project');
    }
  };

  if (isLoading) {
    return (
      <div className="project-list-page">
        <div className="loading-state">Loading projects...</div>
      </div>
    );
  }

  return (
    <div className="project-list-page">
      {/* Sidebar */}
      <aside className="nav-sidebar">
        <div className="nav-sidebar-header">
          <div className="nav-user-avatar">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <div className="nav-user-info">
            <span className="nav-user-name">adam pawski</span>
          </div>
        </div>
        <nav className="nav-sidebar-nav">
          <div className="nav-section">
            <a href="#" className="nav-item active" onClick={(e) => { e.preventDefault(); }}>
              <svg className="nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              <span className="nav-label">Projects</span>
            </a>
            {Array.from({ length: 15 }, (_, i) => (
              <a key={i} href="#" className="nav-item nav-tba" onClick={(e) => { e.preventDefault(); }}>
                <span className="nav-label">tba...</span>
              </a>
            ))}
          </div>
        </nav>
        
        <div className="nav-sidebar-footer">
          <a href="#" className="nav-item" onClick={(e) => { e.preventDefault(); }}>
            <svg className="nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <span className="nav-label">Settings</span>
          </a>
          <a href="#" className="nav-item" onClick={(e) => { e.preventDefault(); handleLogout(); }}>
            <svg className="nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            <span className="nav-label">Account</span>
          </a>
          <a href="#" className="nav-item" onClick={(e) => { e.preventDefault(); }}>
            <svg className="nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span className="nav-label">Help</span>
          </a>
        </div>
      </aside>

      {/* Main area */}
      <div className="main-area">
        {/* Top bar - black with pidly branding */}
        <header className="top-bar">
          <h1 className="brand-title">pidly</h1>
        </header>

        {/* Content header - Projects title and actions */}
        <div className="content-header">
          <div className="content-header-left">
            <h2 className="page-title">Projects</h2>
            <span className="project-count">{filteredProjects.length} {filteredProjects.length === 1 ? 'project' : 'projects'}</span>
          </div>
          <div className="header-actions">
            {/* Search */}
            <div className="search-box">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                type="text"
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            {/* Client filter */}
            {uniqueClients.length > 0 && (
              <select 
                className="filter-select"
                value={filterClient}
                onChange={(e) => setFilterClient(e.target.value)}
              >
                <option value="">All Clients</option>
                {uniqueClients.map(client => (
                  <option key={client} value={client}>{client}</option>
                ))}
              </select>
            )}
            
            {/* Sort */}
            <select 
              className="filter-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="updated">Recently Updated</option>
              <option value="created">Recently Created</option>
              <option value="name">Name A-Z</option>
            </select>
            
            {/* View toggle */}
            <div className="view-toggle">
              <button 
                className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                onClick={() => {
                  setViewMode('grid');
                  localStorage.setItem('projectListViewMode', 'grid');
                }}
                title="Grid view"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7"/>
                  <rect x="14" y="3" width="7" height="7"/>
                  <rect x="14" y="14" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/>
                </svg>
              </button>
              <button 
                className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
                onClick={() => {
                  setViewMode('list');
                  localStorage.setItem('projectListViewMode', 'list');
                }}
                title="List view"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="8" y1="6" x2="21" y2="6"/>
                  <line x1="8" y1="12" x2="21" y2="12"/>
                  <line x1="8" y1="18" x2="21" y2="18"/>
                  <line x1="3" y1="6" x2="3.01" y2="6"/>
                  <line x1="3" y1="12" x2="3.01" y2="12"/>
                  <line x1="3" y1="18" x2="3.01" y2="18"/>
                </svg>
              </button>
            </div>
            
            <button 
              className="new-project-btn"
              onClick={() => setShowNewProjectModal(true)}
            >
              + New Project
            </button>
          </div>
        </div>

        {/* Main content */}
        <div className="main-content">
          <div className={`projects-container ${viewMode}`}>
            {projects.length === 0 ? (
              <div className="empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <p>No projects yet</p>
                <button onClick={() => setShowNewProjectModal(true)}>
                  Create your first project
                </button>
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.35-4.35"/>
                </svg>
                <p>No projects match your search</p>
                <button onClick={() => { setSearchQuery(''); setFilterClient(''); }}>
                  Clear filters
                </button>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="projects-grid">
                {filteredProjects.map(project => (
                  <div 
                    key={project.id} 
                    className="project-card"
                    onClick={() => openProject(project.id)}
                  >
                    <div className="project-card-header">
                      <h3>{project.name}</h3>
                      <div className="card-actions">
                        <button 
                          className="edit-btn"
                          onClick={(e) => openEditModal(project, e)}
                          title="Edit project"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                          </svg>
                        </button>
                        <button 
                          className="delete-btn"
                          onClick={(e) => handleDeleteProject(project.id, e)}
                          title="Delete project"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                          </svg>
                        </button>
                      </div>
                    </div>
                    {project.description && (
                      <p className="project-description">{project.description}</p>
                    )}
                    <div className="project-card-info">
                      {project.client && (
                        <p className="project-client">
                          <span className="info-label">Client:</span> {project.client}
                        </p>
                      )}
                      <p className="project-date">
                        Created {new Date(project.createdAt).toLocaleDateString()}
                      </p>
                      <p className="project-stats">
                        {project.folders?.length || 0} folders
                      </p>
                      {project.tags?.length > 0 && (
                        <div className="project-tags">
                          {project.tags.map((tag, i) => (
                            <span key={i} className="tag">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="projects-list">
                {filteredProjects.map(project => (
                  <div 
                    key={project.id} 
                    className="project-row"
                    onClick={() => openProject(project.id)}
                  >
                    <div className="project-row-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                      </svg>
                    </div>
                    <div className="project-row-main">
                      <div className="project-row-name">{project.name}</div>
                      {project.description && (
                        <div className="project-row-description">{project.description}</div>
                      )}
                    </div>
                    <div className="project-row-meta">
                      {project.client && (
                        <span className="meta-item">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                            <circle cx="12" cy="7" r="4"/>
                          </svg>
                          {project.client}
                        </span>
                      )}
                      <span className="meta-item">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                          <line x1="16" y1="2" x2="16" y2="6"/>
                          <line x1="8" y1="2" x2="8" y2="6"/>
                          <line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                        {new Date(project.updatedAt || project.createdAt).toLocaleDateString()}
                      </span>
                      <span className="meta-item">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                        {project.folders?.length || 0}
                      </span>
                    </div>
                    {project.tags?.length > 0 && (
                      <div className="project-row-tags">
                        {project.tags.slice(0, 3).map((tag, i) => (
                          <span key={i} className="tag">{tag}</span>
                        ))}
                        {project.tags.length > 3 && (
                          <span className="tag more">+{project.tags.length - 3}</span>
                        )}
                      </div>
                    )}
                    <div className="project-row-actions">
                      <button 
                        className="edit-btn"
                        onClick={(e) => openEditModal(project, e)}
                        title="Edit project"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button 
                        className="delete-btn"
                        onClick={(e) => handleDeleteProject(project.id, e)}
                        title="Delete project"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* New Project Modal */}
      {showNewProjectModal && (
        <div className="modal-overlay" onClick={() => { setShowNewProjectModal(false); resetNewProjectForm(); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Project</h2>
            
            <div className="form-group">
              <label>Project Name *</label>
              <input
                type="text"
                placeholder="Enter project name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && createProject()}
                autoFocus
              />
            </div>
            
            <div className="form-group">
              <label>Description</label>
              <textarea
                placeholder="Brief description of the project"
                value={newProjectDescription}
                onChange={(e) => setNewProjectDescription(e.target.value)}
                rows={3}
              />
            </div>
            
            <div className="form-group">
              <label>Client</label>
              <input
                type="text"
                placeholder="Client name"
                value={newProjectClient}
                onChange={(e) => setNewProjectClient(e.target.value)}
              />
            </div>
            
            <div className="form-group">
              <label>Tags</label>
              <input
                type="text"
                placeholder="Comma separated tags (e.g., mining, oil, gas)"
                value={newProjectTags}
                onChange={(e) => setNewProjectTags(e.target.value)}
              />
            </div>
            
            <div className="modal-actions">
              <button onClick={() => { setShowNewProjectModal(false); resetNewProjectForm(); }}>
                Cancel
              </button>
              <button 
                onClick={createProject}
                disabled={!newProjectName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Project Modal */}
      {editingProject && (
        <div className="modal-overlay" onClick={() => setEditingProject(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Project</h2>
            
            <div className="form-group">
              <label>Project Name *</label>
              <input
                type="text"
                placeholder="Enter project name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
              />
            </div>
            
            <div className="form-group">
              <label>Description</label>
              <textarea
                placeholder="Brief description of the project"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
              />
            </div>
            
            <div className="form-group">
              <label>Client</label>
              <input
                type="text"
                placeholder="Client name"
                value={editClient}
                onChange={(e) => setEditClient(e.target.value)}
              />
            </div>
            
            <div className="form-group">
              <label>Tags</label>
              <input
                type="text"
                placeholder="Comma separated tags (e.g., mining, oil, gas)"
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
              />
            </div>
            
            <div className="modal-actions">
              <button onClick={() => setEditingProject(null)}>
                Cancel
              </button>
              <button 
                onClick={saveProjectEdits}
                disabled={!editName.trim()}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
