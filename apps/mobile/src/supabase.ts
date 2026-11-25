import { createMixNotesClient } from "@mixnotes/shared";

export const sb = createMixNotesClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
