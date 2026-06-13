/*
 * Bug-report / suggestion intake. Users submit via the site-wide FeedbackWidget
 * (floating button + footer link). Each submission is emailed to the team so we can
 * triage fixes and ideas — there is no DB table; this is fire-and-forget.
 *
 * Recipients: info@useproximity.org + o.wyatt@wustl.edu.
 *
 * Rate limiting is in-memory (per server instance). On Vercel each serverless
 * instance keeps its own counter and they reset on cold starts, so this is a soft
 * abuse guard, not a hard guarantee — enough to stop a single client spamming.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import nodemailer from "nodemailer";

export const dynamic = "force-dynamic";

const TEAM_EMAILS = ["info@useproximity.org", "o.wyatt@wustl.edu"];
const TYPES = new Set(["bug", "suggestion", "other"]);
const MAX_MESSAGE = 4000;

// In-memory sliding-window rate limit: max N submissions per window per key (IP).
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const _hits = new Map(); // key -> number[] (timestamps)

function rateLimited(key) {
  const now = Date.now();
  const recent = (_hits.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    _hits.set(key, recent);
    return true;
  }
  recent.push(now);
  _hits.set(key, recent);
  return false;
}

const _mailer = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

function emailConfigured() {
  return !!(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const TYPE_LABEL = { bug: "🐞 Bug report", suggestion: "💡 Suggestion", other: "💬 Feedback" };

export async function POST(req) {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    if (rateLimited(ip)) {
      return NextResponse.json(
        { error: "You've sent a few reports already — please try again in a little while." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const type = TYPES.has(body.type) ? body.type : "other";
    const message = String(body.message || "").trim();
    const pageUrl = String(body.pageUrl || "").trim().slice(0, 500);
    const providedEmail = String(body.email || "").trim().slice(0, 200);

    if (message.length < 5) {
      return NextResponse.json(
        { error: "Please add a little more detail (at least 5 characters)." },
        { status: 400 }
      );
    }
    const trimmed = message.slice(0, MAX_MESSAGE);

    // Attach signed-in identity for context (best-effort; anonymous submits are fine).
    let submitter = providedEmail || "Anonymous";
    try {
      const session = await auth();
      if (session?.user) {
        const u = session.user;
        submitter = `${u.name || "—"} <${u.email || providedEmail || "no email"}>${
          u.role ? ` · ${u.role}` : ""
        }`;
      }
    } catch {
      /* ignore — feedback should never require auth */
    }

    if (!emailConfigured()) {
      console.warn("[feedback] Email env not set — submission dropped:", { type, trimmed });
      return NextResponse.json(
        { error: "Feedback isn't configured right now. Please email info@useproximity.org." },
        { status: 503 }
      );
    }

    await _mailer.sendMail({
      from: `"Proximity Feedback" <${process.env.EMAIL_USER}>`,
      to: TEAM_EMAILS.join(", "),
      replyTo: providedEmail || undefined,
      subject: `[${type}] Proximity feedback`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111827;">
          <h2 style="margin:0 0 12px;">${TYPE_LABEL[type]}</h2>
          <p style="white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px;">${escapeHtml(
            trimmed
          )}</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0;" />
          <p style="color:#6b7280;font-size:13px;margin:4px 0;"><strong>From:</strong> ${escapeHtml(
            submitter
          )}</p>
          ${pageUrl ? `<p style="color:#6b7280;font-size:13px;margin:4px 0;"><strong>Page:</strong> ${escapeHtml(pageUrl)}</p>` : ""}
        </div>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("POST /api/feedback failed:", e?.message);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
