// src/pages/CanvasPage.jsx
import { Circle, IText, PencilBrush, Rect } from "fabric";
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

  // Responsive canvas dimensions
  const getCanvasSize = () => {
    const width = window.innerWidth;
    if (width < 480) return { width: 320, height: 240 };
    if (width < 768) return { width: 600, height: 450 };
    if (width < 1024) return { width: 800, height: 500 };
    return { width: 1000, height: 600 };
  };

  const [canvasSize, setCanvasSize] = useState(getCanvasSize());

  const htmlCanvasRef = useRef(null);
  const fabricOptions = useMemo(() => canvasSize, [canvasSize]);
  const fabricRef = useFabric(htmlCanvasRef, fabricOptions);

  const [status, setStatus] = useState("Loading...");
  const [copied, setCopied] = useState(false);
  const [selectedObjectColor, setSelectedObjectColor] = useState("#ff6b6b");
  const [isInitialized, setIsInitialized] = useState(false);
  const [isDrawingMode, setIsDrawingMode] = useState(false);

  // Ensure every object (rect, circle, i-text, paths) is fully resizable from all sides/corners
  const prepareObjectForEditing = useCallback((obj) => {
    if (!obj) return;
    try {
      obj.set({
        selectable: true,
        hasControls: true,
        hasBorders: true,
        hasRotatingPoint: true,
        transparentCorners: false,
        cornerColor: '#2563eb',
        cornerStyle: 'rect',
        cornerStrokeColor: '#1d4ed8',
        cornerSize: 12,
        borderColor: '#2563eb',
        borderScaleFactor: 2,
        lockUniScaling: false,
        lockScalingX: false,
        lockScalingY: false,
        lockScalingFlip: false,
        lockSkewingX: false,
        lockSkewingY: false,
        lockRotation: false,
        lockMovementX: false,
        lockMovementY: false,
      });
      if (typeof obj.setControlsVisibility === 'function') {
        obj.setControlsVisibility({ tl: true, tr: true, bl: true, br: true, ml: true, mr: true, mt: true, mb: true, mtr: true });
      }
      if (obj.type === 'i-text') {
        obj.editable = true;
      }
    } catch {}
  }, []);

  // Reset copied state on component mount to prevent reload issues
  useEffect(() => {
    setCopied(false);
    // Add a small delay to ensure component is fully initialized
    const timer = setTimeout(() => setIsInitialized(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Handle responsive canvas sizing
  useEffect(() => {
    const handleResize = () => {
      setCanvasSize(getCanvasSize());
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Configure canvas for easy editing
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc || viewOnly) return;

    // Enable selection and interaction
    fc.selection = true;
    fc.interactive = true;
    fc.allowTouchScrolling = false;
    fc.preserveObjectStacking = true;
    
    // Configure selection appearance
    fc.selectionColor = 'rgba(37, 99, 235, 0.1)';
    fc.selectionBorderColor = '#2563eb';
    fc.selectionLineWidth = 2;
    
    // Configure default object controls for ALL objects on canvas
    fc.uniformScaling = false; // Allow non-uniform scaling
    fc.uniScaleTransform = false;
    fc.centeredScaling = false;
    
    // Make sure all existing objects have proper controls
    fc.forEachObject((obj) => {
      prepareObjectForEditing(obj);
    });
    
    fc.renderAll();
    
    console.log('Canvas configured for editing:', {
      selection: fc.selection,
      interactive: fc.interactive,
      uniformScaling: fc.uniformScaling
    });
  }, [fabricRef, viewOnly]);  // Memoize the Firestore doc ref so effects don't resubscribe repeatedly
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
                // Configure all loaded objects for editing
                if (!viewOnly) {
                  fc.forEachObject((obj) => {
                    prepareObjectForEditing(obj);
                  });
                }
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
                // Configure all loaded objects for editing
                if (!viewOnly) {
                  fc.forEachObject((obj) => {
                    prepareObjectForEditing(obj);
                  });
                }
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
          // Configure all loaded objects for editing
          if (!viewOnly) {
            fc.forEachObject((obj) => {
              prepareObjectForEditing(obj);
            });
          }
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

    fc.on("object:added", (e) => {
      if (!viewOnly && e?.target) {
        prepareObjectForEditing(e.target);
      }
      onChange();
    });
    fc.on("object:modified", onChange);
    fc.on("object:removed", onObjectRemoved);
    fc.on("path:created", (e) => {
      if (!viewOnly && e?.path) {
        prepareObjectForEditing(e.path);
      }
      onChange();
    });

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

  // Update brush color when currentColor changes
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    
    if (fc.isDrawingMode && fc.freeDrawingBrush) {
      fc.freeDrawingBrush.color = currentColor;
    }
  }, [fabricRef, currentColor]);

  const addShape = (type) => {
    const fc = fabricRef.current;
    if (!fc || viewOnly) return;
    
    console.log(`Adding ${type} shape`);
    
    // Mark a local mutation; we no longer detach listeners
    isAddingObject.current = true;
    isApplyingRemote.current = false;
    
    // Common properties for all shapes to enable full resize functionality
    const commonProps = {
      selectable: true,
      hasControls: true,
      hasBorders: true,
      hasRotatingPoint: true,
      transparentCorners: false,
      cornerColor: '#2563eb',
      cornerStyle: 'rect',
      cornerStrokeColor: '#1d4ed8',
      cornerSize: 12,           // Larger corners for easier interaction
      borderColor: '#2563eb',
      borderScaleFactor: 2,
      // Enable all scaling options - using correct property names
      lockUniScaling: false,     // Allow non-uniform scaling
      lockScalingX: false,       // Allow horizontal scaling
      lockScalingY: false,       // Allow vertical scaling
      lockRotation: false,       // Allow rotation
      lockMovementX: false,      // Allow horizontal movement
      lockMovementY: false,      // Allow vertical movement
    };
    
    let obj;
    if (type === "rect") {
      obj = new Rect({
        width: 120,
        height: 80,
        left: 100,
        top: 100,
        fill: currentColor,
        ...commonProps
      });
    } else if (type === "circle") {
      obj = new Circle({
        radius: 50,
        left: 150,
        top: 150,
        fill: currentColor,
        ...commonProps
      });
    } else if (type === "text") {
      obj = new IText("Edit text", {
        left: 120,
        top: 120,
        fontSize: 20,
        fill: currentColor,
        // Text-specific properties
        editable: true,
        splitByGrapheme: false,
        ...commonProps
      });
    }
    
    if (obj) {
      fc.add(obj);
      fc.setActiveObject(obj);
      prepareObjectForEditing(obj);
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
    
    const newDrawingMode = !fc.isDrawingMode;
    fc.isDrawingMode = newDrawingMode;
    setIsDrawingMode(newDrawingMode);
    
    // Configure drawing brush when entering drawing mode
    if (newDrawingMode) {
      // Initialize the brush if it doesn't exist
      if (!fc.freeDrawingBrush) {
        fc.freeDrawingBrush = new PencilBrush(fc);
      }
      fc.freeDrawingBrush.width = 5;
      fc.freeDrawingBrush.color = currentColor;
    }
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
      {/* Toast Notification - only show when initialized and copied */}
      {copied && isInitialized && (
        <div className="toast-notification">
          <span className="toast-icon">✓</span>
          Link copied to clipboard!
        </div>
      )}
      
      {/* Toolbar */}
      <div className="canvas-toolbar">
        <div className="toolbar-section-left">
          <h2 className="canvas-title">
            Canvas <span className="canvas-id">{id.substring(0, 8)}...</span>
            {viewOnly && <span className="view-only-badge">View Only</span>}
          </h2>
          <div className="status-indicator">
            <span className={`status-dot ${getStatusClass(status)}`}></span>
            <span className="status-text">{status}</span>
          </div>
        </div>

        <div className="toolbar-section-right">
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
              className={`tool-btn ${isDrawingMode ? 'btn-primary' : 'btn-secondary'}`}
              onClick={togglePen}
              disabled={viewOnly}
              title="Toggle Drawing Mode"
            >
              <span className="tool-icon">✏️</span>
              {isDrawingMode ? 'Drawing' : 'Draw'}
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
                Apply
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
      <div className={`canvas-container ${isDrawingMode ? 'drawing-mode' : ''}`}>
        <div className="canvas-wrapper">
          <canvas 
            ref={htmlCanvasRef} 
            width={canvasSize.width} 
            height={canvasSize.height}
          ></canvas>
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
          <h4>How to edit shapes:</h4>
          <div className="shortcuts">
            <span className="shortcut">Click to select shapes</span>
            <span className="shortcut">Drag corners to resize</span>
            <span className="shortcut">Drag rotation handle to rotate</span>
            <span className="shortcut">Double-click text to edit</span>
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
