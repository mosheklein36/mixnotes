import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatTime } from "@mixnotes/shared";

interface Props {
  title: string;
  timestampSeconds: number;
  initialText?: string;
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
}

export function NoteModal({ title, timestampSeconds, initialText = "", onSave, onCancel }: Props) {
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>
          {title} <span className="ts">@ {formatTime(timestampSeconds)}</span>
        </h2>
        <textarea
          ref={inputRef}
          rows={3}
          placeholder="Kick too loud in chorus"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !text.trim()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
