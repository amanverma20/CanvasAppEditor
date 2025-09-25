// src/pages/CanvasPage.jsx
import { Circle, IText, Rect } from "fabric";
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import debounce from "lodash.debounce";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { db } from "../firebase";
import useFabric from "../hooks/useFabric";
import "./CanvasPage.css";

export default function CanvasPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const viewOnly = searchParams.get("viewOnly") === "true";

  const htmlCanvasRef = useRef(null);
  const fabricOptions = useMemo(() => ({ width: 1000, height: 600 }), []);
  const fabricRef = useFabric(htmlCanvasRef, fabricOptions);

  const [status, setStatus] = useState("Loading...");
  const [copied, setCopied] = useState(false);
  const [selectedObjectColor, setSelectedObjectColor] = useState("#ff6b6b");

  // Memoize the Firestore doc ref so effects don't resubscribe repeatedly
  const sceneRef = useMemo(() => doc(db, "scenes", id), [id]);

  // to avoid applying our own snapshot after we write
  const lastLocalJson = useRef(null);
  const isAddingObject = useRef(false);
  const isApplyingRemote = useRef(false);
  const pendingRemoteJson = useRef(null);

  // Ensure canvas paints immediately, even in background tabs
  const forceRender = useCallback((fc) => {
    if (!fc) return;
    try {
      fc.calcOffset();
    } catch {}
    fc.requestRenderAll();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        fc.renderAll();
      });
    } else {
      fc.renderAll();
    }
  }, []);

  // 1) Load or create doc and subscribe
  useEffect(() => {
    let unsub;
    (async () => {
      try {
        const snap = await getDoc(sceneRef);
        if (snap.exists()) {
          const data = snap.data();
          if (data?.data) {
            const fc = fabricRef.current;
            if (fc) {
              fc.loadFromJSON(data.data, () => {
                forceRender(fc);
              });
            } else {
              // buffer initial load until canvas is ready
              pendingRemoteJson.current = data.data;
            }
          }
        } else {
          // create a base empty JSON (fabric empty canvas)
          const initial = JSON.stringify({ objects: [], background: "#ffffff" });
          await setDoc(sceneRef, {
            data: initial,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            viewOnly: !!viewOnly,
          });
        }

        // subscribe to remote updates - guarded to avoid clobbering fresh local state
        unsub = onSnapshot(sceneRef, (snap) => {
          if (!snap.exists()) return;
          const remote = snap.data();
          
          // If remote equals the last JSON we saved locally, skip
          
          if (remote?.data) {
            const fc = fabricRef.current;
            if (!fc) {
              // buffer remote update until canvas is ready
              pendingRemoteJson.current = remote.data;
              return;
            }
            const cur = JSON.stringify(fc.toJSON());
            
            // If Firestore has exactly what we just saved, skip
            if (lastLocalJson.current && remote.data === lastLocalJson.current) {
              return;
            }

            // Only update if data is actually different
            if (cur !== remote.data) {
              isApplyingRemote.current = true;
              fc.loadFromJSON(remote.data, () => {
                forceRender(fc);
                setStatus("Updated from remote");
                // small timeout to ensure events from load don't trigger saves
                setTimeout(() => { isApplyingRemote.current = false; }, 0);
              });
            }
          }
        });
        
        setStatus("Ready");
      } catch (err) {
        console.error("load error", err);
        setStatus("Error loading scene");
      }
    })();

    return () => {
      if (unsub) unsub();
    };
  }, [id, sceneRef, fabricRef, viewOnly, isAddingObject]);

  // Apply any pending remote JSON once the canvas becomes ready
  useEffect(() => {
    let timer;
    const tryApply = () => {
      const fc = fabricRef.current;
      if (fc && pendingRemoteJson.current) {
        isApplyingRemote.current = true;
        const json = pendingRemoteJson.current;
        pendingRemoteJson.current = null;
        fc.clear();
        fc.loadFromJSON(json, () => {
          forceRender(fc);
          setStatus("Updated from remote");
          setTimeout(() => { isApplyingRemote.current = false; }, 0);
        });
        return true;
      }
      return false;
    };

    if (!tryApply()) {
      timer = setInterval(() => {
        if (tryApply()) {
          clearInterval(timer);
        }
      }, 50);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [fabricRef]);

  // 2) save function (debounced)
  const doSave = useCallback(
    async (canvas) => {
      if (!canvas) return;
      if (isApplyingRemote.current) return; // don't save while applying remote
      try {
        console.log("Starting save operation...");
        setStatus("Saving...");
        const json = JSON.stringify(canvas.toJSON());
        lastLocalJson.current = json;
        
        await setDoc(sceneRef, {
          data: json,
          updatedAt: serverTimestamp(),
        }, { merge: true });
        console.log("Save operation completed successfully");
        setStatus("Saved");
      } catch (err) {
        console.error("save err", err);
        setStatus("Save error");
      }
    },
    [sceneRef]
  );
  // debounce at 300ms (reduced from 1000ms to minimize race conditions)
  const debouncedSave = useCallback(debounce(doSave, 300), [doSave]);

  // 3) attach listeners to canvas events
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;

    // view-only mode: disable interaction
    if (viewOnly) {
      fc.selection = false;
      fc.forEachObject((o) => (o.selectable = false));
    }

    const onChange = () => {
      if (viewOnly || isAddingObject.current || isApplyingRemote.current) return;
      console.log("onChange triggered - canvas modified");
      debouncedSave(fc);
    };

    const onObjectRemoved = () => {
      if (!viewOnly && !isAddingObject.current && !isApplyingRemote.current) {
        debouncedSave(fc);
      }
    };

    fc.on("object:added", onChange);
    fc.on("object:modified", onChange);
    fc.on("object:removed", onObjectRemoved);
    fc.on("path:created", onChange);

    return () => {
      fc.off("object:added", onChange);
      fc.off("object:modified", onChange);
      fc.off("object:removed", onObjectRemoved);
      fc.off("path:created", onChange);
    };
  }, [fabricRef, debouncedSave, viewOnly]);

  // 4) helpers: add shapes, toggle pen, delete selected
  const [currentColor, setCurrentColor] = useState("#ff6b6b");

  // Function to change color of selected objects
  const changeSelectedObjectColor = (color) => {
    const fc = fabricRef.current;
    if (!fc || viewOnly) return;
    
    const activeObjects = fc.getActiveObjects();
    if (activeObjects.length === 0) return;

    activeObjects.forEach((obj) => {
      obj.set('fill', color);
    });
    
    fc.requestRenderAll();
    debouncedSave(fc);
  };

  // Update selected object color when selection changes
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;

    const updateSelectedColor = () => {
      const activeObject = fc.getActiveObject();
      if (activeObject?.fill) {
        setSelectedObjectColor(activeObject.fill);
      }
    };

    fc.on('selection:created', updateSelectedColor);
    fc.on('selection:updated', updateSelectedColor);
    fc.on('selection:cleared', () => setSelectedObjectColor(currentColor));

    return () => {
      fc.off('selection:created', updateSelectedColor);
      fc.off('selection:updated', updateSelectedColor);
      fc.off('selection:cleared');
    };
  }, [fabricRef, currentColor]);

  const addShape = (type) => {
    const fc = fabricRef.current;
    if (!fc || viewOnly) return;
    
    console.log(`Adding ${type} shape`);
    
    // Mark a local mutation; we no longer detach listeners
    isAddingObject.current = true;
    isApplyingRemote.current = false;
    
    let obj;
    if (type === "rect") {
      obj = new Rect({
        width: 120,
        height: 80,
        left: 100,
        top: 100,
        fill: currentColor,
      });
    } else if (type === "circle") {
      obj = new Circle({
        radius: 50,
        left: 150,
        top: 150,
        fill: currentColor,
      });
    } else if (type === "text") {
      obj = new IText("Edit text", {
        left: 120,
        top: 120,
        fontSize: 20,
        fill: currentColor,
      });
    }
    
    if (obj) {
      fc.add(obj);
      fc.setActiveObject(obj);
      fc.requestRenderAll();
      console.log("Object added, count:", fc.getObjects().length);
      
      // Save immediately; listeners remain intact
      doSave(fc)
        .then(() => {
          console.log("Save completed, re-enabling events and remote updates");
          console.log("Objects after save:", fc.getObjects().length);
        })
        .finally(() => {
          isAddingObject.current = false;
        });
    }
  };

  const togglePen = () => {
    const fc = fabricRef.current;
    if (!fc || viewOnly) return;
    fc.isDrawingMode = !fc.isDrawingMode;
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        const fc = fabricRef.current;
        if (!fc || viewOnly) return;
        const active = fc.getActiveObjects();
        // If editing an IText, let Backspace/Delete modify text, not delete the object
        const single = active.length === 1 ? active[0] : null;
        if (single && single.type === "i-text" && single.isEditing) {
          return;
        }
        if (active.length) {
          active.forEach((o) => fc.remove(o));
          fc.discardActiveObject();
          fc.requestRenderAll();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewOnly]);

  // 5) share button functions
  const shareEditableLink = () => {
    const baseUrl = window.location.href.split('?')[0]; // Remove any existing query params
    navigator.clipboard.writeText(baseUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const shareViewOnlyLink = () => {
    const baseUrl = window.location.href.split('?')[0]; // Remove any existing query params
    const viewOnlyUrl = `${baseUrl}?viewOnly=true`;
    navigator.clipboard.writeText(viewOnlyUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // 6) export PNG
  const exportPNG = () => {
    const fc = fabricRef.current;
    if (!fc) return;
    const dataUrl = fc.toDataURL({ format: "png", multiplier: 2 });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `canvas-${id}.png`;
    a.click();
  };

  return (
    <div className="canvas-page">
      {/* Toast Notification */}
      {copied && (
        <div className="toast-notification">
          <span className="toast-icon">✓</span>
          Link copied to clipboard!
        </div>
      )}
      
      {/* Toolbar */}
      <div className="canvas-toolbar">
        <div className="toolbar-section">
          <h2 className="canvas-title">
            Canvas <span className="canvas-id">{id.substring(0, 8)}...</span>
            {viewOnly && <span className="view-only-badge">View Only</span>}
          </h2>
          <div className="status-indicator">
            <span className={`status-dot ${getStatusClass(status)}`}></span>
            <span className="status-text">{status}</span>
          </div>
        </div>

        <div className="toolbar-section">
          <div className="tool-group">
            <button 
              className="tool-btn btn-primary" 
              onClick={() => addShape("rect")}
              disabled={viewOnly}
              title="Add Rectangle"
            >
              <span className="tool-icon">⬜</span>
              Rectangle
            </button>
            <button 
              className="tool-btn btn-primary" 
              onClick={() => addShape("circle")}
              disabled={viewOnly}
              title="Add Circle"
            >
              <span className="tool-icon">⭕</span>
              Circle
            </button>
            <button 
              className="tool-btn btn-primary" 
              onClick={() => addShape("text")}
              disabled={viewOnly}
              title="Add Text"
            >
              <span className="tool-icon">📝</span>
              Text
            </button>
            <button 
              className="tool-btn btn-secondary" 
              onClick={togglePen}
              disabled={viewOnly}
              title="Toggle Drawing Mode"
            >
              <span className="tool-icon">✏️</span>
              Draw
            </button>
          </div>

          <div className="color-group">
            <label className="color-label">Color:</label>
            <div className="color-controls">
              <input 
                type="color" 
                value={currentColor} 
                onChange={(e) => setCurrentColor(e.target.value)}
                className="color-picker"
                title="Choose color for new shapes"
                disabled={viewOnly}
              />
              <button 
                className="tool-btn btn-small" 
                onClick={() => changeSelectedObjectColor(selectedObjectColor)}
                disabled={viewOnly}
                title="Apply color to selected object"
              >
                Apply to Selected
              </button>
              <input 
                type="color" 
                value={selectedObjectColor} 
                onChange={(e) => {
                  setSelectedObjectColor(e.target.value);
                  changeSelectedObjectColor(e.target.value);
                }}
                className="color-picker"
                title="Change selected object color"
                disabled={viewOnly}
              />
            </div>
          </div>

          <div className="action-group">
            <button 
              className="action-btn btn-success" 
              onClick={shareEditableLink}
              title="Copy Editable Share Link"
            >
              <span className="action-icon">✏️</span>
              Share to Edit
            </button>
            <button 
              className="action-btn btn-secondary" 
              onClick={shareViewOnlyLink}
              title="Copy View-Only Share Link"
            >
              <span className="action-icon">�️</span>
              Share to View
            </button>
            <button 
              className="action-btn btn-secondary" 
              onClick={exportPNG}
              title="Export as PNG"
            >
              <span className="action-icon">💾</span>
              Export
            </button>
          </div>
        </div>
      </div>

      {/* Canvas Container */}
      <div className="canvas-container">
        <div className="canvas-wrapper">
          <canvas ref={htmlCanvasRef} width={1000} height={600}></canvas>
        </div>
      </div>

      {/* Info Panel */}
      <div className="info-panel">
        <div className="info-section">
          <h4>Share this canvas:</h4>
          <div className="share-options">
            <div className="share-option">
              <label>Editable Link:</label>
              <div className="share-url">
                <input 
                  type="text" 
                  value={window.location.href.split('?')[0]} 
                  readOnly 
                  className="share-input"
                  onClick={(e) => e.target.select()}
                />
                <button className="copy-btn btn-small btn-success" onClick={shareEditableLink}>
                  Copy
                </button>
              </div>
            </div>
            
            <div className="share-option">
              <label>View-Only Link:</label>
              <div className="share-url">
                <input 
                  type="text" 
                  value={`${window.location.href.split('?')[0]}?viewOnly=true`} 
                  readOnly 
                  className="share-input"
                  onClick={(e) => e.target.select()}
                />
                <button className="copy-btn btn-small btn-secondary" onClick={shareViewOnlyLink}>
                  Copy
                </button>
              </div>
            </div>
          </div>
        </div>
        
        <div className="info-section">
          <h4>Keyboard shortcuts:</h4>
          <div className="shortcuts">
            <span className="shortcut"><kbd>Delete</kbd> Remove selected</span>
            <span className="shortcut"><kbd>Backspace</kbd> Remove selected</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper function for status styling
function getStatusClass(status) {
  if (status.includes('error') || status.includes('Error')) return 'error';
  if (status.includes('Saving')) return 'saving';
  if (status.includes('Saved') || status.includes('Ready')) return 'success';
  if (status.includes('Loading')) return 'loading';
  return 'default';
}
