import { useState } from "react";
import { Login, useSession } from "@mixnotes/shared";
import { sb } from "./supabase";
import { useUploader } from "./uploader";
import { UploadsScreen } from "./screens/Uploads";
import { ReviewScreen } from "./screens/Review";
import { SettingsScreen } from "./screens/Settings";

type Tab = "uploads" | "review" | "settings";

export function App() {
  const { session, loading } = useSession(sb);
  const uploader = useUploader(session?.user.id ?? null);
  const [tab, setTab] = useState<Tab>("uploads");

  if (loading) return <div className="center muted">Loading…</div>;
  if (!session) return <Login sb={sb} subtitle="Desktop" />;

  return (
    <div className="app">
      <nav className="tabs">
        <span className="brand-small">MixNotes</span>
        <button className={tab === "uploads" ? "active" : ""} onClick={() => setTab("uploads")}>
          Uploads
        </button>
        <button className={tab === "review" ? "active" : ""} onClick={() => setTab("review")}>
          Notes
        </button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
          Settings
        </button>
      </nav>
      <main>
        {tab === "uploads" && <UploadsScreen uploader={uploader} />}
        {tab === "review" && <ReviewScreen userId={session.user.id} />}
        {tab === "settings" && <SettingsScreen email={session.user.email ?? ""} />}
      </main>
    </div>
  );
}
