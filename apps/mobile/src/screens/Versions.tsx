import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { errorMessage, formatTime, formatUploadDate, getProject, listVersions, type Project, type Version } from "@mixnotes/shared";
import { sb } from "../supabase";

export function Versions() {
  const { projectId = "" } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getProject(sb, projectId), listVersions(sb, projectId)])
      .then(([p, v]) => {
        setProject(p);
        setVersions(v);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [projectId]);

  return (
    <div className="screen">
      <header className="topbar">
        <Link to={`/projects/${projectId}`} className="back">‹ Player</Link>
        <h1>{project?.name ?? "Versions"}</h1>
      </header>
      {error && <div className="error">{error}</div>}
      {!versions && !error && <div className="muted">Loading…</div>}
      <ul className="list">
        {versions?.map((v, i) => (
          <li key={v.id}>
            <Link to={`/projects/${projectId}/versions/${v.id}`} className="row">
              <span className="row-title">
                {formatUploadDate(v.created_at)} {i === 0 && <span className="badge">Latest</span>}
              </span>
              <span className="row-sub">
                {v.filename}
                {v.duration_seconds ? ` · ${formatTime(v.duration_seconds)}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
