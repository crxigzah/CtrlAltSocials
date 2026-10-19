import type { PlatformId } from "@/lib/platforms/catalog";

export type Workspace = {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  color: string;
  handle: string | null;
  bio: string | null;
  website: string | null;
  signup_email: string | null;
  avatar_url: string | null;
  timezone: string;
  alert_webhook: string | null;
  utm_enabled: boolean;
  require_approval: boolean;
  weekly_summary: boolean;
  utm_campaign: string | null;
  created_at: string;
};

export type Account = {
  id: string;
  workspace_id: string;
  platform: PlatformId;
  label: string;
  status: "connected" | "error" | "disconnected";
  last_error: string | null;
  created_at: string;
};

export type PostStatus = "draft" | "pending_approval" | "scheduled" | "publishing" | "done" | "partial" | "failed";

export type Post = {
  id: string;
  workspace_id: string;
  body: string;
  scheduled_at: string;
  status: PostStatus;
  thread_parts: string[];
  created_by: string | null;
  approved_by: string | null;
  review_note: string | null;
  repeat: "weekly" | "fortnightly" | "monthly" | null;
  next_post_id: string | null;
  claimed_at: string | null;
  created_at: string;
};

export type PostTarget = {
  id: string;
  body: string | null;
  post_id: string;
  account_id: string;
  status: "pending" | "sent" | "failed";
  remote_url: string | null;
  error: string | null;
  sent_at: string | null;
  remote_id: string | null;
  metrics: { views?: number; likes?: number; comments?: number; shares?: number } | null;
  metrics_at: string | null;
};
