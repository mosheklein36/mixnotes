import { useEffect, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";

export function useSession(sb: SupabaseClient): { session: Session | null; loading: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    sb.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data } = sb.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [sb]);
  return { session, loading };
}
