import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type { Note, Project, Version } from "./types";

export const AUDIO_BUCKET = "audio";
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export function createMixNotesClient(url: string | undefined, anonKey: string | undefined): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.");
  }
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

export async function listProjects(sb: SupabaseClient): Promise<Project[]> {
  return unwrap(
    await sb
      .from("projects")
      .select("*")
      .order("latest_upload_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
  );
}

export async function getProject(sb: SupabaseClient, projectId: string): Promise<Project> {
  return unwrap(await sb.from("projects").select("*").eq("id", projectId).single());
}

export async function listVersions(sb: SupabaseClient, projectId: string): Promise<Version[]> {
  return unwrap(
    await sb.from("versions").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
  );
}

export async function getVersion(sb: SupabaseClient, versionId: string): Promise<Version> {
  return unwrap(await sb.from("versions").select("*").eq("id", versionId).single());
}

export async function listNotes(sb: SupabaseClient, versionIds: string[]): Promise<Note[]> {
  if (versionIds.length === 0) return [];
  return unwrap(
    await sb.from("notes").select("*").in("version_id", versionIds).order("timestamp_seconds", { ascending: true }),
  );
}

export async function addNote(
  sb: SupabaseClient,
  versionId: string,
  timestampSeconds: number,
  text: string,
): Promise<Note> {
  return unwrap(
    await sb
      .from("notes")
      .insert({ version_id: versionId, timestamp_seconds: timestampSeconds, text: text.trim() })
      .select()
      .single(),
  );
}

export async function updateNote(
  sb: SupabaseClient,
  noteId: string,
  patch: Partial<Pick<Note, "text" | "done" | "timestamp_seconds">>,
): Promise<Note> {
  return unwrap(await sb.from("notes").update(patch).eq("id", noteId).select().single());
}

export async function deleteNote(sb: SupabaseClient, noteId: string): Promise<void> {
  unwrap(await sb.from("notes").delete().eq("id", noteId));
}

export async function getSignedAudioUrl(sb: SupabaseClient, storagePath: string, expiresIn = 3600): Promise<string> {
  const data = unwrap(await sb.storage.from(AUDIO_BUCKET).createSignedUrl(storagePath, expiresIn));
  return data.signedUrl;
}

export async function moveVersion(sb: SupabaseClient, versionId: string, projectId: string): Promise<void> {
  unwrap(await sb.from("versions").update({ project_id: projectId }).eq("id", versionId));
}

export async function setVersionDuration(sb: SupabaseClient, versionId: string, durationSeconds: number): Promise<void> {
  unwrap(await sb.from("versions").update({ duration_seconds: durationSeconds }).eq("id", versionId));
}

export async function findOrCreateProject(sb: SupabaseClient, name: string): Promise<Project> {
  const existing = unwrap(await sb.from("projects").select("*").eq("name", name).maybeSingle()) as Project | null;
  if (existing) return existing;
  const { data, error } = await sb.from("projects").insert({ name }).select().single();
  if (!error) return data as Project;
  // Another upload created it concurrently.
  if (error.code === "23505") {
    return unwrap(await sb.from("projects").select("*").eq("name", name).single());
  }
  throw new Error(error.message);
}

export async function versionExistsForHash(sb: SupabaseClient, fileHash: string): Promise<boolean> {
  const rows = unwrap(await sb.from("versions").select("id").eq("file_hash", fileHash).limit(1)) as { id: string }[];
  return rows.length > 0;
}

export interface UploadInput {
  filename: string;
  fileHash: string;
  bytes: Blob;
  contentType: string;
  projectName: string;
  durationSeconds: number | null;
}

export type UploadResult = { status: "uploaded"; version: Version; project: Project } | { status: "duplicate" };

export async function uploadVersion(sb: SupabaseClient, input: UploadInput): Promise<UploadResult> {
  if (input.bytes.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File is ${(input.bytes.size / 1024 / 1024).toFixed(1)} MB; the limit is 50 MB. Export as MP3.`);
  }
  const { data: userData, error: userError } = await sb.auth.getUser();
  if (userError || !userData.user) throw new Error("Not signed in");
  if (await versionExistsForHash(sb, input.fileHash)) return { status: "duplicate" };

  const project = await findOrCreateProject(sb, input.projectName);
  const ext = input.filename.slice(input.filename.lastIndexOf(".")).toLowerCase();
  const storagePath = `${userData.user.id}/${project.id}/${input.fileHash}${ext}`;

  const { error: uploadError } = await sb.storage
    .from(AUDIO_BUCKET)
    .upload(storagePath, input.bytes, { contentType: input.contentType, upsert: true });
  if (uploadError) throw new Error(uploadError.message);

  const { data, error } = await sb
    .from("versions")
    .insert({
      project_id: project.id,
      storage_path: storagePath,
      filename: input.filename,
      file_hash: input.fileHash,
      duration_seconds: input.durationSeconds,
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") return { status: "duplicate" };
    throw new Error(error.message);
  }
  return { status: "uploaded", version: data as Version, project };
}

export function subscribeToNotes(sb: SupabaseClient, userId: string, onChange: () => void): RealtimeChannel {
  return sb
    .channel(`notes-${userId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "notes", filter: `user_id=eq.${userId}` }, onChange)
    .subscribe();
}

export function subscribeToVersions(sb: SupabaseClient, userId: string, onChange: () => void): RealtimeChannel {
  return sb
    .channel(`versions-${userId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "versions", filter: `user_id=eq.${userId}` }, onChange)
    .subscribe();
}
