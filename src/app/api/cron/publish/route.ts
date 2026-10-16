import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendFailureAlert } from "@/lib/alerts";
import { refreshMetrics } from "@/lib/metrics";
import { publishPost } from "@/lib/publisher";
import type { Post } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const TIME_BUDGET_MS = 25_000;

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
  const started = Date.now();
  const results: Record<string, string> = {};

  // One post at a time, and stop claiming with time to spare: anything left over is
  // picked up by the next run rather than claimed and then cut off by the timeout.
  while (Date.now() - started < TIME_BUDGET_MS) {
    const { data, error } = await supabase.rpc("claim_due_posts", { max_posts: 1 });
    if (error) return NextResponse.json({ error: error.message, published: results }, { status: 500 });
    const post = (data as Post[] | null)?.[0];
    if (!post) break;
    try {
      results[post.id] = await publishPost(supabase, post);
    } catch (err) {
      console.error("publish failed", post.id, err);
      await supabase.from("posts").update({ status: "failed" }).eq("id", post.id);
      results[post.id] = "failed";
    }
    // Scheduled posts go out unattended, so problems get pushed to the project's alert channel.
    await sendFailureAlert(supabase, post, results[post.id] as Post["status"]);
  }
  // Spare time goes on updating recent posts' likes, comments and views.
  const remaining = TIME_BUDGET_MS - (Date.now() - started);
  const metricsUpdated = remaining > 3000 ? await refreshMetrics(supabase, remaining) : 0;
  return NextResponse.json({ published: results, metricsUpdated });
}

export const GET = run;
export const POST = run;
