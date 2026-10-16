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

export type PostStatus = "scheduled" | "publishing" | "done" | "partial" | "failed";

export type Post = {
  id: string;
  workspace_id: string;
  body: string;
  scheduled_at: string;
  status: PostStatus;
  created_at: string;
};

export type PostTarget = {
  id: string;
  post_id: string;
  account_id: string;
  status: "pending" | "sent" | "failed";
  remote_url: string | null;
  error: string | null;
  sent_at: string | null;
};
