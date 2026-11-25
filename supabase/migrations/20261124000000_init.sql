-- MixNotes V1 schema. Users come from auth.users.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  latest_upload_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  storage_path text not null,
  filename text not null,
  file_hash text not null,
  duration_seconds double precision,
  created_at timestamptz not null default now(),
  unique (user_id, file_hash)
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version_id uuid not null references public.versions (id) on delete cascade,
  timestamp_seconds double precision not null check (timestamp_seconds >= 0),
  text text not null check (length(trim(text)) > 0),
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index versions_project_id_idx on public.versions (project_id, created_at desc);
create index notes_version_id_idx on public.notes (version_id, timestamp_seconds);
create index notes_user_id_idx on public.notes (user_id);

create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger notes_set_updated_at
before update on public.notes
for each row execute function public.set_updated_at();

create function public.touch_project_latest_upload() returns trigger
language plpgsql as $$
begin
  update public.projects
     set latest_upload_at = greatest(coalesce(latest_upload_at, new.created_at), new.created_at)
   where id = new.project_id;
  return new;
end;
$$;

create trigger versions_touch_project
after insert or update of project_id on public.versions
for each row execute function public.touch_project_latest_upload();

-- Row Level Security: every row is private to its owner.
alter table public.projects enable row level security;
alter table public.versions enable row level security;
alter table public.notes enable row level security;

create policy "own projects" on public.projects
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "own versions" on public.versions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

create policy "own notes" on public.notes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.versions v
      where v.id = version_id and v.user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on public.projects, public.versions, public.notes to authenticated;
revoke all on public.projects, public.versions, public.notes from anon;

-- Realtime for live updates on desktop (full identity so filtered deletes are delivered).
alter table public.notes replica identity full;
alter table public.versions replica identity full;
alter publication supabase_realtime add table public.notes, public.versions;

-- Private audio bucket. Objects live under {user_id}/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audio', 'audio', false, 52428800,
  array['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave']
)
on conflict (id) do nothing;

create policy "own audio read" on storage.objects
  for select to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "own audio insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "own audio update" on storage.objects
  for update to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "own audio delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
