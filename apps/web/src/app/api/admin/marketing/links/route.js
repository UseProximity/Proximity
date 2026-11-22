/*
 * Campaign links (PRD 7.9).
 *
 * @auth admin
 *
 * GET  the links with headline numbers for the period (?days=7|30|90),
 *      campaign suggestions and the unregistered src tags seen.
 * POST create a link. The slug is cleaned, must be unique and is locked once
 *      saved; a taken slug answers 409 with a free suggestion.
 *
 * Admin and super can both create, edit and archive (PRD 7.9 Access). Pinned
 * to this site's own database: /go/<slug> reads links from the same place, so
 * it ignores the dashboard's dev/prod switch (x-db-target).
 */
import { NextResponse } from "next/server";
import { requireDbRole } from "@/lib/userRole";
import { validateLinkInput, nextFreeSlug } from "@/lib/marketing/links";
import { campaignSuggestions, insertLink, linkStats, listLinks, sessionCountForLink, slugsLike, unregisteredTags } from "@/lib/marketing/linksServer";

export const dynamic = "force-dynamic";

const PERIODS = [7, 30, 90];
const UNIQUE_VIOLATION = "23505";

export async function GET(req) {
  if (!(await requireDbRole(["admin", "super"]))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const daysParam = Number(new URL(req.url).searchParams.get("days"));
    const days = PERIODS.includes(daysParam) ? daysParam : 30;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const links = await listLinks();
    const [stats, unregistered] = await Promise.all([linkStats(since), unregisteredTags(since, links)]);
    const empty = { sessions: 0, accounts: 0, inquiries: 0, applications: 0 };
    // "used" is all-time (it decides delete vs archive); the period numbers
    // already prove it for any link with sessions in the period.
    const used = await Promise.all(links.map(async (l) => (stats[l.id]?.sessions > 0 ? true : (await sessionCountForLink(l.id)) > 0)));
    return NextResponse.json({
      days,
      links: links.map((l, i) => ({ ...l, stats: stats[l.id] ?? empty, used: used[i] })),
      campaigns: campaignSuggestions(links),
      unregistered,
    });
  } catch (err) {
    console.error("GET /api/admin/marketing/links failed:", err?.message || err);
    return NextResponse.json({ error: "Could not load campaign links." }, { status: 500 });
  }
}

export async function POST(req) {
  const session = await requireDbRole(["admin", "super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { value, errors } = validateLinkInput(body ?? {});
  if (Object.keys(errors).length) return NextResponse.json({ error: "Check the highlighted fields.", fields: errors }, { status: 400 });

  try {
    const { data, error } = await insertLink({ ...value, status: "active" }, session.user.id);
    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        const suggestion = nextFreeSlug(value.slug, await slugsLike(value.slug));
        return NextResponse.json(
          { error: "That slug is taken.", fields: { slug: suggestion ? `That slug is taken. Try ${suggestion}.` : "That slug is taken." }, suggestion },
          { status: 409 },
        );
      }
      throw error;
    }
    return NextResponse.json({ link: data }, { status: 201 });
  } catch (err) {
    console.error("POST /api/admin/marketing/links failed:", err?.message || err);
    return NextResponse.json({ error: "Could not create the link." }, { status: 500 });
  }
}
