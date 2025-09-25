// src/App.jsx
import { nanoid } from "nanoid";
import { Link, Route, Routes, useNavigate } from "react-router-dom";
import "./App.css";
import CanvasPage from "./pages/CanvasPage";

function HomePage() {
  const navigate = useNavigate();

  const createNewCanvas = () => {
    const id = nanoid(10);
    navigate(`/canvas/${id}`);
  };

  return (
    <div className="app">
      <header className="app-header">
        <nav className="app-nav">
          <Link to="/" className="app-logo">
            <div className="logo-icon">C</div>
            Canvas Editor
          </Link>
          <div className="nav-links">
            <a href="https://task-manager-32b4c.web.app" className="nav-link">Live Demo</a>
            <button onClick={createNewCanvas} className="btn-primary btn-small">
              New Canvas
            </button>
          </div>
        </nav>
      </header>

      <main className="app-main">
        <div className="welcome-container">
          <div className="welcome-content">
            <h1 className="welcome-title">Collaborative Canvas Editor</h1>
            <p className="welcome-subtitle">
              Create, share, and collaborate on interactive 2D canvases in real-time. 
              Perfect for brainstorming, design, and creative collaboration.
            </p>

            <div className="welcome-features">
              <div className="feature-card">
                <div className="feature-icon">🎨</div>
                <h3 className="feature-title">Rich Drawing Tools</h3>
                <p className="feature-description">
                  Create shapes, add text, draw freehand, and manipulate objects with powerful tools
                </p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">👥</div>
                <h3 className="feature-title">Real-time Collaboration</h3>
                <p className="feature-description">
                  Work together with team members simultaneously and see changes instantly
                </p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">💾</div>
                <h3 className="feature-title">Auto-save & Share</h3>
                <p className="feature-description">
                  Your work is automatically saved and can be shared with unique, shareable links
                </p>
              </div>
            </div>

            <div className="cta-buttons">
              <button onClick={createNewCanvas} className="cta-primary">
                Create New Canvas
              </button>
              <a href="https://github.com/amanverma20/CanvasAppEditor" className="cta-secondary" target="_blank" rel="noopener noreferrer">
                View on GitHub
              </a>
            </div>
          </div>
        </div>
      </main>

      <footer className="app-footer">
        <div className="container">
          <p>&copy; 2025 Canvas Editor. Built with React, Fabric.js, and Firebase.</p>
        </div>
      </footer>
    </div>
  );
}

function CanvasWrapper() {
  return (
    <div className="app">
      <header className="app-header">
        <nav className="app-nav">
          <Link to="/" className="app-logo">
            <div className="logo-icon">C</div>
            Canvas Editor
          </Link>
          <div className="nav-links">
            <Link to="/" className="nav-link">← Back to Home</Link>
          </div>
        </nav>
      </header>
      <main className="app-main">
        <CanvasPage />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/canvas/:id" element={<CanvasWrapper />} />
    </Routes>
  );
}
