import { useCallback, useEffect, useState } from "react";
import {
  errorMessage,
  formatTime,
  formatUploadDate,
  listNotes,
  listProjects,
  listVersions,
  moveVersion,
  subscribeToNotes,
  subscribeToVersions,
  updateNote,
  type Note,
  type Project,
  type Version,
} from "@mixnotes/shared";
import { sb } from "../supabase";

export function ReviewScreen({ userId }: { userId: string }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [versionsTick, setVersionsTick] = useState(0);

  const loadProjects = useCallback(async () => {
    try {
      const list = await listProjects(sb);
      setProjects(list);
      setSelectedId((id) => (id && list.some((p) => p.id === id) ? id : (list[0]?.id ?? null)));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    loadProjects();
    const channel = subscribeToVersions(sb, userId, () => {
      loadProjects();
      setVersionsTick((t) => t + 1);
    });
    return () => {
      sb.removeChannel(channel);
    };
  }, [userId, loadProjects]);

  const selected = projects?.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="review">
      <aside className="project-list">
        <h2>Projects</h2>
        {error && <div className="error small">{error}</div>}
        {!projects && !error && <div className="muted">Loading…</div>}
        {projects?.length === 0 && <div className="muted small">No projects yet. Export a track to your watched folder.</div>}
        <ul>
          {projects?.map((p) => (
            <li key={p.id}>
              <button className={p.id === selectedId ? "active" : ""} onClick={() => setSelectedId(p.id)}>
                <span>{p.name}</span>
                {p.latest_upload_at && <span className="muted small">{formatUploadDate(p.latest_upload_at)}</span>}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="project-view">
        {selected ? (
          <ProjectView key={selected.id} project={selected} projects={projects ?? []} userId={userId} versionsTick={versionsTick} onMoved={loadProjects} />
        ) : (
          <div className="muted center-pad">Select a project</div>
        )}
      </section>
    </div>
  );
}

function ProjectView({
  project,
  projects,
  userId,
  versionsTick,
  onMoved,
}: {
  project: Project;
  projects: Project[];
  userId: string;
  versionsTick: number;
  onMoved: () => void;
}) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const v = await listVersions(sb, project.id);
      const n = await listNotes(
        sb,
        v.map((x) => x.id),
      );
      setVersions(v);
      setNotes(n);
      setExpanded((prev) => (prev.size === 0 && v[0] ? new Set([v[0].id]) : prev));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load, versionsTick]);

  useEffect(() => {
    const channel = subscribeToNotes(sb, userId, load);
    return () => {
      sb.removeChannel(channel);
    };
  }, [userId, load]);

  async function toggleDone(note: Note) {
    setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, done: !n.done } : n)));
    try {
      await updateNote(sb, note.id, { done: !note.done });
    } catch (err) {
      setError(errorMessage(err));
      load();
    }
  }

  async function move(version: Version, targetProjectId: string) {
    try {
      await moveVersion(sb, version.id, targetProjectId);
      onMoved();
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="page">
      <div className="project-head">
        <h1>{project.name}</h1>
        <label className="toggle-row small">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide done
        </label>
      </div>
      {error && <div className="error">{error}</div>}
      {!versions && !error && <div className="muted">Loading…</div>}
      {versions?.map((v, idx) => {
        const vNotes = notes.filter((n) => n.version_id === v.id && !(hideDone && n.done));
        const total = notes.filter((n) => n.version_id === v.id).length;
        const doneCount = notes.filter((n) => n.version_id === v.id && n.done).length;
        const isOpen = expanded.has(v.id);
        return (
          <div key={v.id} className="version">
            <div className="version-head">
              <button className="version-toggle" onClick={() => toggleExpanded(v.id)}>
                <span className="chev">{isOpen ? "▾" : "▸"}</span>
                {idx === 0 ? "Latest version" : "Version"} · {formatUploadDate(v.created_at)}
                <span className="muted small">
                  {" "}
                  {v.filename}
                  {v.duration_seconds ? ` · ${formatTime(v.duration_seconds)}` : ""} · {doneCount}/{total} done
                </span>
              </button>
              <select
                className="move"
                value=""
                onChange={(e) => e.target.value && move(v, e.target.value)}
                title="Move this version to another project"
              >
                <option value="">Move to…</option>
                {projects
                  .filter((p) => p.id !== project.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>
            {isOpen && (
              <ul className="note-list">
                {vNotes.length === 0 && <li className="muted small">{total === 0 ? "No notes on this version yet." : "All notes done."}</li>}
                {vNotes.map((n) => (
                  <li key={n.id} className={n.done ? "done" : ""}>
                    <label>
                      <input type="checkbox" checked={n.done} onChange={() => toggleDone(n)} />
                      <span className="ts">[{formatTime(n.timestamp_seconds)}]</span>
                      <span className="text">{n.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
