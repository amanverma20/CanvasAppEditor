// src/hooks/useFabric.js
import { Canvas as FabricCanvas } from "fabric";
import { useEffect, useRef } from "react";

export default function useFabric(canvasHtmlRef, options = {}) {
  const fabricRef = useRef(null);

  useEffect(() => {
    if (!canvasHtmlRef.current) return;
    const canvas = new FabricCanvas(canvasHtmlRef.current, {
      preserveObjectStacking: true,
      selection: true,
      // default size - can be responsive
      backgroundColor: "#ffffff",
      ...options,
    });

    fabricRef.current = canvas;

    return () => {
      canvas.dispose();
      fabricRef.current = null;
    };
  }, [canvasHtmlRef, options]);

  return fabricRef;
}
