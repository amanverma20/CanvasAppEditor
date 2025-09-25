// src/App.jsx
import { nanoid } from "nanoid";
import React from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import CanvasPage from "./pages/CanvasPage";

function HomeRedirect() {
  const nav = useNavigate();
  React.useEffect(() => {
    const id = nanoid(10);
    nav(`/canvas/${id}`, { replace: true });
  }, [nav]);
  return <div style={{ padding: 20 }}>Creating your canvas…</div>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/canvas/:id" element={<CanvasPage />} />
    </Routes>
  );
}
