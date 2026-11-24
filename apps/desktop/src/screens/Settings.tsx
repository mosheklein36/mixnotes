import { useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { errorMessage } from "@mixnotes/shared";
import { sb } from "../supabase";

export function SettingsScreen({ email }: { email: string }) {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isEnabled()
      .then(setAutostart)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  async function toggleAutostart(next: boolean) {
    setError(null);
    try {
      if (next) await enable();
      else await disable();
      setAutostart(await isEnabled());
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="page">
      <h1>Settings</h1>
      <section className="card">
        <h2>Account</h2>
        <p>
          Signed in as <strong>{email}</strong>
        </p>
        <button onClick={() => sb.auth.signOut()}>Sign out</button>
      </section>
      <section className="card">
        <h2>Startup</h2>
        <label className="toggle-row">
          <input
            type="checkbox"
            disabled={autostart == null}
            checked={!!autostart}
            onChange={(e) => toggleAutostart(e.target.checked)}
          />
          Launch MixNotes when my computer starts (runs in the system tray)
        </label>
        <p className="hint">Closing the window keeps MixNotes running in the tray so it keeps watching your folder.</p>
        {error && <div className="error">{error}</div>}
      </section>
    </div>
  );
}
