-- Monday-morning recap in the project's alert channel. On by default wherever alerts are on.
alter table public.workspaces add column weekly_summary boolean not null default true;
