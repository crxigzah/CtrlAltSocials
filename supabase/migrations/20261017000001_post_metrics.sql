-- Engagement numbers fetched back from each platform after a post goes out.
alter table public.post_targets add column remote_id text;
-- { views?, likes?, comments?, shares? } as last reported by the platform.
alter table public.post_targets add column metrics jsonb;
alter table public.post_targets add column metrics_at timestamptz;
create index post_targets_metrics_idx on public.post_targets (metrics_at nulls first) where status = 'sent' and remote_id is not null;
