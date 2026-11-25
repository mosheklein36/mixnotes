import { useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errorMessage } from "./format";

export function Login({ sb, subtitle }: { sb: SupabaseClient; subtitle?: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) setInfo("Check your email to confirm your account, then sign in.");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen login">
      <h1 className="brand">MixNotes</h1>
      {subtitle && <div className="brand-sub">{subtitle}</div>}
      <form onSubmit={submit} className="stack">
        <input type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input
          type="password"
          placeholder="Password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <div className="error">{error}</div>}
        {info && <div className="info">{info}</div>}
        <button className="primary" disabled={busy}>
          {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
      <button className="link" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
        {mode === "signin" ? "No account? Create one" : "Have an account? Sign in"}
      </button>
    </div>
  );
}
