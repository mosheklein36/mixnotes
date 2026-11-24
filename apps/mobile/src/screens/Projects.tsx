import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { errorMessage, formatUploadDate, listProjects, type Project } from "@mixnotes/shared";
import { sb } from "../supabase";

export function Projects() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setProjects(await listProjects(sb));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  return (
    <div className="screen">
      <header className="topbar">
        <h1>Projects</h1>
        <button className="link" onClick={() => sb.auth.signOut()}>
          Sign out
        </button>
      </header>
      {error && (
        <div className="error">
          {error} <button className="link" onClick={load}>Retry</button>
        </div>
      )}
      {!projects && !error && <div className="muted">Loading…</div>}
      {projects?.length === 0 && (
        <div className="empty">
          No tracks yet. Export an MP3 from FL Studio into your watched folder and it will show up here.
        </div>
      )}
      <ul className="list">
        {projects?.map((p) => (
          <li key={p.id}>
            <Link to={`/projects/${p.id}`} className="row">
              <span className="row-title">{p.name}</span>
              {p.latest_upload_at && <span className="row-sub">{formatUploadDate(p.latest_upload_at)}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
