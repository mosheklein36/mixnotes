import { Navigate, Route, Routes } from "react-router-dom";
import { Login, useSession } from "@mixnotes/shared";
import { sb } from "./supabase";
import { Projects } from "./screens/Projects";
import { Player } from "./screens/Player";
import { Versions } from "./screens/Versions";

export function App() {
  const { session, loading } = useSession(sb);
  if (loading) return <div className="center muted">Loading…</div>;
  if (!session) return <Login sb={sb} />;
  return (
    <Routes>
      <Route path="/" element={<Projects />} />
      <Route path="/projects/:projectId" element={<Player />} />
      <Route path="/projects/:projectId/versions" element={<Versions />} />
      <Route path="/projects/:projectId/versions/:versionId" element={<Player />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
