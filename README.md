# MixNotes

Export a track from FL Studio → listen on your phone → leave timestamped notes → review them on desktop.

Spec: [docs/MixNotes.txt](docs/MixNotes.txt)

| Path | What |
| --- | --- |
| `supabase/` | Schema, RLS policies, private `audio` bucket (one migration) |
| `packages/shared` | Supabase client + API, types, project naming, login screen |
| `apps/mobile` | PWA player + timestamp notes (React + Vite) |
| `apps/desktop` | Tauri app: folder watcher/uploader (Rust) + note review (React) |

## Prerequisites

- Node 22 + pnpm 9 (`corepack enable`)
- Rust (stable) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS
- Docker + [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) for local development

## Local development

```bash
pnpm install
supabase start                       # applies supabase/migrations
supabase status -o env               # copy API_URL and ANON_KEY
cp apps/mobile/.env.example apps/mobile/.env     # fill in
cp apps/desktop/.env.example apps/desktop/.env   # fill in

pnpm dev:mobile                      # http://localhost:5173 (also on your LAN for phone testing)
pnpm dev:desktop                     # Tauri window
```

## Hosted Supabase

1. Create a project at supabase.com.
2. `supabase link --project-ref <ref>` then `supabase db push` (creates tables, policies, bucket).
3. Put the project URL and anon key (Project Settings → API) in both `.env` files.
4. Auth → Providers → Email: either disable "Confirm email" or set the Site URL to your mobile app URL so confirmation links work.

The mobile app must be served over HTTPS for "Add to Home Screen" and lock-screen playback (e.g. deploy `apps/mobile/dist` to Vercel/Netlify/Cloudflare Pages).

## Tests

```bash
pnpm test                                        # unit tests
cd apps/desktop/src-tauri && cargo test          # watcher tests (stability check, overwrite, ignore rules)

# Integration test against local Supabase (RLS, storage, dedupe, notes):
eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY)=')"
MIXNOTES_IT_URL=$API_URL MIXNOTES_IT_ANON_KEY=$ANON_KEY pnpm --filter @mixnotes/shared test
```

## How the desktop watcher works

- Watches the selected folder (non-recursive) for new or overwritten `.mp3` / `.wav` files; ignores `.`/`~` temp files.
- A file is uploaded once its size and modified time haven't changed for 2 seconds and it can be read.
- Files already in a folder when you select it are ignored. Files exported while the app was closed are picked up on next launch.
- Each file is SHA-256 hashed; identical content is never uploaded twice.
- Project name = filename minus extension and common suffixes (`v2`, `_master`, `final`, `mix`, `mixdown`, `(1)`). Wrong grouping can be fixed with "Move to…" on the Notes tab.
- Failed uploads retry every 30 s and when the connection returns; the queue survives restarts.
- Closing the window keeps it running in the system tray. "Launch on startup" is in Settings.

## Phase 0 checklist (manual, real devices)

- [ ] iPhone: add the mobile app to the home screen, play a track, lock the screen — playback continues and lock-screen controls work.
- [ ] Windows: export from FL Studio into the watched folder, then re-export with the same name — both uploads appear as separate versions.
