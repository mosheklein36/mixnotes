import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  addNote,
  deleteNote,
  errorMessage,
  formatTime,
  formatUploadDate,
  getProject,
  getSignedAudioUrl,
  listNotes,
  listVersions,
  setVersionDuration,
  updateNote,
  type Note,
  type Project,
  type Version,
} from "@mixnotes/shared";
import { sb } from "../supabase";
import { NoteModal } from "../components/NoteModal";

const PAUSE_ON_NOTE_KEY = "mixnotes.pauseOnNote";

type ModalState = { kind: "add"; at: number; resumeAfter: boolean } | { kind: "edit"; note: Note };

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
}

export function Player() {
  const { projectId = "", versionId } = useParams();
  const audioRef = useRef<HTMLAudioElement>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [version, setVersion] = useState<Version | null>(null);
  const [isLatest, setIsLatest] = useState(true);
  const [notes, setNotes] = useState<Note[]>([]);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  const [modal, setModal] = useState<ModalState | null>(null);
  const [pauseOnNote, setPauseOnNote] = useState(() => localStorage.getItem(PAUSE_ON_NOTE_KEY) !== "false");

  useEffect(() => localStorage.setItem(PAUSE_ON_NOTE_KEY, String(pauseOnNote)), [pauseOnNote]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSrc(null);
    (async () => {
      try {
        const [p, versions] = await Promise.all([getProject(sb, projectId), listVersions(sb, projectId)]);
        const v = versionId ? versions.find((x) => x.id === versionId) : versions[0];
        if (!v) throw new Error(versionId ? "Version not found" : "This project has no uploads yet");
        const [url, n] = await Promise.all([getSignedAudioUrl(sb, v.storage_path), listNotes(sb, [v.id])]);
        if (cancelled) return;
        setProject(p);
        setVersion(v);
        setIsLatest(v.id === versions[0]?.id);
        setNotes(n);
        setSrc(url);
        setDuration(v.duration_seconds ?? 0);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, versionId]);

  const seek = useCallback((t: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(t, a.duration || t));
    setCurrent(a.currentTime);
  }, []);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch((err) => setAudioError(errorMessage(err)));
    else a.pause();
  }, []);

  // Signed URLs expire; re-sign and resume where we were.
  const recoverFromAudioError = useCallback(async () => {
    const a = audioRef.current;
    if (!a || !version) return;
    const at = a.currentTime;
    try {
      const url = await getSignedAudioUrl(sb, version.storage_path);
      setSrc(url);
      a.addEventListener("loadedmetadata", () => (a.currentTime = at), { once: true });
      setAudioError(null);
    } catch (err) {
      setAudioError(`Couldn't load audio: ${errorMessage(err)}`);
    }
  }, [version]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !project || !version) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: project.name,
      artist: `MixNotes · ${formatUploadDate(version.created_at)}`,
      artwork: [{ src: "/icon-512.png", sizes: "512x512", type: "image/png" }],
    });
    const a = audioRef.current;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => a?.play()],
      ["pause", () => a?.pause()],
      ["seekbackward", (d) => a && seek(a.currentTime - (d.seekOffset ?? 10))],
      ["seekforward", (d) => a && seek(a.currentTime + (d.seekOffset ?? 10))],
      ["seekto", (d) => d.seekTime != null && seek(d.seekTime)],
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        /* unsupported action */
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          /* unsupported action */
        }
      }
    };
  }, [project, version, seek]);

  function openAddNote() {
    const a = audioRef.current;
    const at = a?.currentTime ?? 0;
    const wasPlaying = !!a && !a.paused;
    if (wasPlaying && pauseOnNote) a.pause();
    setModal({ kind: "add", at, resumeAfter: wasPlaying && pauseOnNote });
  }

  function closeModal() {
    if (modal?.kind === "add" && modal.resumeAfter) audioRef.current?.play().catch(() => {});
    setModal(null);
  }

  async function saveNew(text: string) {
    if (!version || modal?.kind !== "add") return;
    const note = await addNote(sb, version.id, modal.at, text);
    setNotes((prev) => sortNotes([...prev, note]));
    closeModal();
  }

  async function saveEdit(text: string) {
    if (modal?.kind !== "edit") return;
    const note = await updateNote(sb, modal.note.id, { text: text.trim() });
    setNotes((prev) => sortNotes(prev.map((n) => (n.id === note.id ? note : n))));
    setModal(null);
  }

  async function remove(note: Note) {
    if (!confirm(`Delete note at ${formatTime(note.timestamp_seconds)}?`)) return;
    try {
      await deleteNote(sb, note.id);
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  const shown = scrubbing ?? current;

  return (
    <div className="screen player">
      <header className="topbar">
        <Link to="/" className="back">‹ Projects</Link>
        <Link to={`/projects/${projectId}/versions`} className="link">Versions</Link>
      </header>

      {error && <div className="error">{error}</div>}
      {!error && !version && <div className="muted">Loading…</div>}

      {project && version && (
        <>
          <div className="now-playing">
            <h1>{project.name}</h1>
            <div className="muted">
              {formatUploadDate(version.created_at)} {isLatest ? <span className="badge">Latest</span> : <span className="badge old">Older version</span>}
            </div>
          </div>

          {src && (
            <audio
              ref={audioRef}
              src={src}
              preload="auto"
              playsInline
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onWaiting={() => setBuffering(true)}
              onPlaying={() => setBuffering(false)}
              onCanPlay={() => setBuffering(false)}
              onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration;
                if (!Number.isFinite(d)) return;
                setDuration(d);
                if (version.duration_seconds == null) {
                  setVersionDuration(sb, version.id, d).catch(() => {});
                }
              }}
              onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
              onError={recoverFromAudioError}
            />
          )}

          <div className="transport">
            <button className="play" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} disabled={!src}>
              {buffering && playing ? "…" : playing ? "❚❚" : "▶"}
            </button>
            <input
              className="seek"
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(shown, duration || 0)}
              onChange={(e) => setScrubbing(Number(e.target.value))}
              onPointerUp={() => {
                if (scrubbing != null) seek(scrubbing);
                setScrubbing(null);
              }}
              onKeyUp={() => {
                if (scrubbing != null) seek(scrubbing);
                setScrubbing(null);
              }}
              style={{ ["--pct" as string]: `${duration ? (Math.min(shown, duration) / duration) * 100 : 0}%` }}
            />
            <div className="times">
              <span>{formatTime(shown)}</span>
              <span>{formatTime(duration)}</span>
            </div>
            {audioError && <div className="error">{audioError}</div>}
          </div>

          <button className="add-note" onClick={openAddNote} disabled={!src}>
            ADD NOTE
          </button>
          <label className="toggle">
            <input type="checkbox" checked={pauseOnNote} onChange={(e) => setPauseOnNote(e.target.checked)} />
            Pause while typing
          </label>

          <section className="notes">
            <h2>Notes {notes.length > 0 && <span className="muted">({notes.length})</span>}</h2>
            {notes.length === 0 && <div className="muted">No notes yet. Tap ADD NOTE while listening.</div>}
            <ul>
              {notes.map((n) => (
                <li key={n.id} className={n.done ? "note done" : "note"}>
                  <button className="ts" onClick={() => seek(n.timestamp_seconds)}>
                    {formatTime(n.timestamp_seconds)}
                  </button>
                  <span className="note-text" onClick={() => setModal({ kind: "edit", note: n })}>
                    {n.text}
                  </span>
                  <button className="icon" aria-label="Delete note" onClick={() => remove(n)}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {modal?.kind === "add" && <NoteModal title="Add Note" timestampSeconds={modal.at} onSave={saveNew} onCancel={closeModal} />}
      {modal?.kind === "edit" && (
        <NoteModal
          title="Edit Note"
          timestampSeconds={modal.note.timestamp_seconds}
          initialText={modal.note.text}
          onSave={saveEdit}
          onCancel={closeModal}
        />
      )}
    </div>
  );
}
