import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { publishPost } from "@/lib/publisher";
import type { Post } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Publishes every scheduled post that is due. Called every few minutes by the scheduler. */
async function run(request: NextRequest) {
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const supabase = createAdminClient();
  const { data: posts, error } = await supabase.rpc("claim_due_posts", { max_posts: 20 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Record<string, string> = {};
  for (const post of (posts ?? []) as Post[]) {
    try {
      results[post.id] = await publishPost(supabase, post);
    } catch (err) {
      console.error("publish failed", post.id, err);
      await supabase.from("posts").update({ status: "failed" }).eq("id", post.id);
      results[post.id] = "failed";
    }
  }
  return NextResponse.json({ published: results });
}

export const GET = run;
export const POST = run;
