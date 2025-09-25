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

export default function CanvasPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const viewOnly = searchParams.get("viewOnly") === "true";

  const htmlCanvasRef = useRef(null);
  const fabricOptions = useMemo(() => ({ width: 1000, height: 600 }), []);
  const fabricRef = useFabric(htmlCanvasRef, fabricOptions);

  const [status, setStatus] = useState("Loading...");
  const [copied, setCopied] = useState(false);

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
        fill: "#f59",
      });
    } else if (type === "circle") {
      obj = new Circle({
        radius: 50,
        left: 150,
        top: 150,
        fill: "#59f",
      });
    } else if (type === "text") {
      obj = new IText("Edit text", {
        left: 120,
        top: 120,
        fontSize: 20,
        fill: "#333",
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

  // 5) share button
  const shareLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
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
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>Canvas — id: {id} {viewOnly ? "(view-only)" : ""}</h3>
        <div>
          <button onClick={shareLink}>Share Canvas</button>
          <button onClick={exportPNG} style={{ marginLeft: 8 }}>Export PNG</button>
        </div>
      </div>

      <div style={{ marginTop: 12, marginBottom: 12 }}>
        <button onClick={() => addShape("rect")}>Rect</button>
        <button onClick={() => addShape("circle")}>Circle</button>
        <button onClick={() => addShape("text")}>Text</button>
        <button onClick={togglePen} style={{ marginLeft: 8 }}>
          Toggle Pen
        </button>
        <span style={{ marginLeft: 12 }}>{status}</span>
        {copied && <span style={{ marginLeft: 12, color: "green" }}>Link copied!</span>}
      </div>

      <div style={{ border: "1px solid #ddd", width: 1000, height: 600 }}>
        <canvas ref={htmlCanvasRef} width={1000} height={600}></canvas>
      </div>

      <p style={{ marginTop: 8 }}>
        Share link: <code>{window.location.href}</code>
      </p>
    </div>
  );
}
