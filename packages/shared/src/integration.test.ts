// Runs against a local Supabase (`supabase start`). Skipped unless MIXNOTES_IT_URL / MIXNOTES_IT_ANON_KEY are set.
import { describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { addNote, deleteNote, getSignedAudioUrl, listNotes, listProjects, listVersions, moveVersion, updateNote, uploadVersion } from "./api";
import { deriveProjectName } from "./projectName";

const url = process.env.MIXNOTES_IT_URL;
const anonKey = process.env.MIXNOTES_IT_ANON_KEY;

async function newUser(): Promise<SupabaseClient> {
  const sb = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const email = `it-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const { error } = await sb.auth.signUp({ email, password: "password123" });
  if (error) throw error;
  return sb;
}

function fakeMp3(content: string): Blob {
  return new Blob([new TextEncoder().encode(content)], { type: "audio/mpeg" });
}

describe.skipIf(!url || !anonKey)("supabase integration", () => {
  it("uploads, dedupes, groups versions, notes, and isolates users", async () => {
    const alice = await newUser();
    const bob = await newUser();

    const upload = (sb: SupabaseClient, filename: string, content: string) =>
      uploadVersion(sb, {
        filename,
        fileHash: `hash-${content}`,
        bytes: fakeMp3(content),
        contentType: "audio/mpeg",
        projectName: deriveProjectName(filename),
        durationSeconds: 200,
      });

    const tag = Date.now().toString(36);
    const v1 = await upload(alice, "Summer Anthem.mp3", `a1-${tag}`);
    expect(v1.status).toBe("uploaded");
    const v2 = await upload(alice, "Summer Anthem v2.mp3", `a2-${tag}`);
    expect(v2.status).toBe("uploaded");
    expect(await upload(alice, "Summer Anthem.mp3", `a1-${tag}`)).toEqual({ status: "duplicate" });

    const projects = await listProjects(alice);
    expect(projects.map((p) => p.name)).toEqual(["Summer Anthem"]);
    const versions = await listVersions(alice, projects[0].id);
    expect(versions).toHaveLength(2);
    expect(versions[0].filename).toBe("Summer Anthem v2.mp3");

    const signed = await getSignedAudioUrl(alice, versions[0].storage_path);
    const res = await fetch(signed);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(`a2-${tag}`);

    const n2 = await addNote(alice, versions[0].id, 182, "Transition feels weak");
    await addNote(alice, versions[0].id, 134, "Kick too loud in chorus");
    const notes = await listNotes(alice, [versions[0].id]);
    expect(notes.map((n) => n.timestamp_seconds)).toEqual([134, 182]);
    const updated = await updateNote(alice, n2.id, { done: true });
    expect(updated.done).toBe(true);
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(n2.updated_at).getTime());
    await deleteNote(alice, n2.id);
    expect(await listNotes(alice, [versions[0].id])).toHaveLength(1);

    // Bob sees nothing of Alice's and can't write into her versions or storage.
    expect(await listProjects(bob)).toEqual([]);
    expect(await listNotes(bob, [versions[0].id])).toEqual([]);
    await expect(addNote(bob, versions[0].id, 1, "sneaky")).rejects.toThrow();
    await expect(getSignedAudioUrl(bob, versions[0].storage_path)).rejects.toThrow();
    const bobUpload = await upload(bob, "Summer Anthem.mp3", `a1-${tag}`);
    expect(bobUpload.status).toBe("uploaded");

    // Moving a version into another of Alice's projects works; into Bob's doesn't.
    const other = await upload(alice, "Remix Draft.mp3", `a3-${tag}`);
    if (other.status !== "uploaded" || bobUpload.status !== "uploaded") throw new Error("unreachable");
    await moveVersion(alice, versions[1].id, other.project.id);
    expect(await listVersions(alice, other.project.id)).toHaveLength(2);
    await expect(moveVersion(alice, versions[0].id, bobUpload.project.id)).rejects.toThrow();
  });
});
