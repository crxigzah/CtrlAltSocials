-- Images and videos attached to posts. Files live in a private Storage bucket under
-- "<workspace id>/<random>.<ext>"; platforms are handed short-lived signed URLs or the
-- bytes themselves at publish time.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media', 'media', false, 52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime']
)
on conflict (id) do nothing;

-- True when an object path's first folder is a workspace the caller owns.
create function public.owns_media_path(path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select split_part(path, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and public.owns_workspace(split_part(path, '/', 1)::uuid);
$$;
revoke execute on function public.owns_media_path(text) from public, anon;
grant execute on function public.owns_media_path(text) to authenticated;

create policy media_read on storage.objects for select to authenticated
  using (bucket_id = 'media' and public.owns_media_path(name));
create policy media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.owns_media_path(name));
create policy media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.owns_media_path(name));

create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  path text not null,
  mime text not null,
  size bigint not null check (size > 0),
  alt text check (length(alt) <= 1000),
  position smallint not null default 0,
  unique (post_id, position)
);
create index post_media_post_idx on public.post_media (post_id);

alter table public.post_media enable row level security;
create policy media_owner on public.post_media for all to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and public.owns_workspace(p.workspace_id)))
  with check (exists (
    select 1 from public.posts p
    where p.id = post_id and public.owns_workspace(p.workspace_id) and split_part(path, '/', 1) = p.workspace_id::text
  ));

-- A post can now be media only, with no text.
alter table public.posts drop constraint posts_body_check;
alter table public.posts add constraint posts_body_check check (length(body) <= 5000);
