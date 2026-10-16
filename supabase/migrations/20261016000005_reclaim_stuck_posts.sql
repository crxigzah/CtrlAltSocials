-- If a publisher run dies mid-post (serverless timeout, deploy), the post would sit in
-- "publishing" forever. Record when each post was claimed and let a later run pick it
-- back up after 10 minutes; targets already sent are never resent.
alter table public.posts add column claimed_at timestamptz;

create or replace function public.claim_due_posts(max_posts int default 20) returns setof public.posts
language sql security definer set search_path = '' as $$
  update public.posts set status = 'publishing', claimed_at = now()
  where id in (
    select id from public.posts
    where (status = 'scheduled' and scheduled_at <= now())
       or (status = 'publishing' and coalesce(claimed_at, created_at) < now() - interval '10 minutes')
    order by scheduled_at
    limit max_posts
    for update skip locked
  )
  returning *;
$$;
revoke execute on function public.claim_due_posts(int) from public, anon, authenticated;
grant execute on function public.claim_due_posts(int) to service_role;

create index posts_publishing_idx on public.posts (claimed_at) where status = 'publishing';
