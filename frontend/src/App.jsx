import { Component } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import ProjectListPage from './pages/ProjectListPage/ProjectListPage';
import ProjectWorkspace from './pages/ProjectWorkspace';
import ProjectClassesPage from './pages/Classes/ProjectClassesPage';
import ProjectModelsPage from './pages/Models/ProjectModelsPage';
import ProjectSmartLinksPage from './pages/ProjectSmartLinksPage';
import ProjectRegionsPage from './pages/ProjectRegionsPage';
import ProjectDocPropsPage from './pages/ProjectDocPropsPage';
import ProjectSymbolsPage from './pages/ProjectSymbolsPage';
import LoginPage from './pages/LoginPage/LoginPage';
import './App.css';

// Error boundary - catches component crashes and shows recovery UI
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('App crashed:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h1>Something went wrong</h1>
          <p>{this.state.error?.message}</p>
          <button onClick={() => {
            this.setState({ hasError: false, error: null });
            window.location.href = '/';
          }}>
            Back to Home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Protected route wrapper - redirects to login if not authenticated
function ProtectedRoute({ children }) {
  const isAuthenticated = localStorage.getItem('authenticated') === 'true';

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function App() {
  return (
    <ErrorBoundary>
    <Router>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={
          <ProtectedRoute>
            <ProjectListPage />
          </ProtectedRoute>
        } />
        <Route path="/project/:projectId" element={
          <ProtectedRoute>
            <ProjectWorkspace />
          </ProtectedRoute>
        } />
        <Route path="/project/:projectId/classes" element={
          <ProtectedRoute>
            <ProjectClassesPage />
          </ProtectedRoute>
        } />
        <Route path="/project/:projectId/models" element={
          <ProtectedRoute>
            <ProjectModelsPage />
          </ProtectedRoute>
        } />
        <Route path="/project/:projectId/smartlinks" element={
          <ProtectedRoute>
            <ProjectSmartLinksPage />
          </ProtectedRoute>
        } />
        <Route path="/project/:projectId/docprops" element={
          <ProtectedRoute>
            <ProjectDocPropsPage />
          </ProtectedRoute>
        } />
        <Route path="/project/:projectId/regions" element={
          <ProtectedRoute>
            <ProjectRegionsPage />
          </ProtectedRoute>
        } />
        <Route path="/project/:projectId/symbols" element={
          <ProtectedRoute>
            <ProjectSymbolsPage />
          </ProtectedRoute>
        } />
      </Routes>
    </Router>
    </ErrorBoundary>
  );
}

export default App;
