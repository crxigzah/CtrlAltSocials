-- When background jobs last ran, for the status page. Written and read only with the
-- service role (RLS on, no policies), so signed-in users can't touch it directly.
create table public.system_heartbeat (
  name text primary key,
  ran_at timestamptz not null default now(),
  detail jsonb
);
alter table public.system_heartbeat enable row level security;

-- Repeating posts: after one goes out, the next occurrence is scheduled automatically.
alter table public.posts add column repeat text check (repeat in ('weekly', 'fortnightly', 'monthly'));
-- The occurrence created from this one, so a retried post never schedules a second copy.
alter table public.posts add column next_post_id uuid references public.posts (id) on delete set null;
