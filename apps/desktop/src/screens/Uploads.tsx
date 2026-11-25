import { open } from "@tauri-apps/plugin-dialog";
import { formatUploadDate } from "@mixnotes/shared";
import type { Uploader, UploadItem } from "../uploader";

const STATUS_LABEL: Record<UploadItem["status"], string> = {
  pending: "Waiting",
  uploading: "Uploading…",
  done: "Uploaded",
  duplicate: "Already uploaded",
  failed: "Failed",
};

export function UploadsScreen({ uploader }: { uploader: Uploader }) {
  const { items, folder, watch, online, setFolder, retry, clearHistory } = uploader;

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false, title: "Select your FL Studio export folder" });
    if (typeof selected === "string") setFolder(selected);
  }

  const failedCount = items.filter((i) => i.status === "failed").length;

  return (
    <div className="page">
      <h1>MixNotes Desktop</h1>

      <section className="card">
        <h2>Watched Folder</h2>
        <div className="folder-row">
          <code className="folder">{folder ?? "No folder selected"}</code>
          <button className="primary" onClick={pickFolder}>
            {folder ? "Change Folder" : "Select Folder"}
          </button>
        </div>
        <p className="hint">Export MP3 from FL Studio into this folder. Files already in it when you select it are ignored.</p>
      </section>

      <section className="card">
        <h2>Status</h2>
        <div className="status-lines">
          <div>
            <span className={`dot ${online ? "ok" : "bad"}`} /> {online ? "Connected" : "Offline — uploads will retry when back online"}
          </div>
          <div>
            <span className={`dot ${watch.kind === "watching" ? "ok" : watch.kind === "error" ? "bad" : "idle"}`} />{" "}
            {watch.kind === "watching" && "Watching Folder"}
            {watch.kind === "idle" && "Not watching — select a folder"}
            {watch.kind === "error" && `Watcher error: ${watch.message}`}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Recent Uploads</h2>
          <div className="card-actions">
            {failedCount > 0 && <button onClick={() => retry()}>Retry failed ({failedCount})</button>}
            {items.length > 0 && <button onClick={clearHistory}>Clear finished</button>}
          </div>
        </div>
        {items.length === 0 && <div className="muted">Nothing uploaded yet.</div>}
        <table className="uploads">
          <tbody>
            {items.map((i) => (
              <tr key={i.hash} className={`status-${i.status}`}>
                <td>
                  <div className="filename">{i.filename}</div>
                  <div className="muted small">→ {i.projectName}</div>
                  {i.error && <div className="error small">{i.error}</div>}
                </td>
                <td className="muted small nowrap">{formatUploadDate(new Date(i.updatedAt).toISOString())}</td>
                <td className="nowrap">
                  <span className={`pill ${i.status}`}>{STATUS_LABEL[i.status]}</span>
                  {i.status === "failed" && (
                    <button className="link" onClick={() => retry(i.hash)}>
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
