/*
 * The admin Home page (Wyatt, 2026-11-12): what needs someone's attention right
 * now, the team's due follow-ups, and a one-week pulse. Every count links to the
 * page where the work is done. Billing counts are for super admins only.
 *
 * Counts are plain row counts against the database the dashboard is switched
 * to. One that cannot be read (a table not on this database yet) comes back
 * null and shows as unknown, so one bad query never blanks the page.
 */
const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

async function count(build) {
  try {
    const { count: n, error } = await build();
    return error ? null : n ?? 0;
  } catch {
    return null;
  }
}
const head = (db, table) => db.from(table).select("*", { count: "exact", head: true });

export async function loadHome(db, { isSuper = false } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const q = (key, label, hint, path, params, build, extra = {}) => ({ key, label, hint, path, params: params ?? null, build, ...extra });

  const queues = [
    q("reviews", "Reviews to verify", "New reviews do not count toward ratings until verified.", "reviews", { filter: "unverified" }, () => head(db, "listing_reviews").eq("legitimacy", false).is("deleted_at", null)),
    q("tours", "Tours waiting over a day", "A student asked for a tour and the landlord has not answered in 24 hours.", "conversations", { tab: "tours" }, () => head(db, "tour_requests").eq("status", "requested").lt("created_at", ago(1))),
    q("held", "Email replies held", "A reply came from an address we do not recognise and waits for approval.", "conversations/held", null, () => head(db, "chat_inbound_emails").eq("status", "held")),
    q("flags", "Flagged messages to review", "Messages the safety filter flagged or blocked.", "conversations/safety", { tab: "chat-flags" }, () => head(db, "chat_moderation_events").is("reviewed_at", null)),
    q("chatReports", "Reported conversations", "Reports filed from a chat.", "conversations/safety", { tab: "chat-reports" }, () => head(db, "chat_reports").is("reviewed_at", null)),
    q("listingReports", "Reported listings", "Reports filed against a listing.", "conversations/safety", { tab: "listing-reports" }, () => head(db, "listing_reports").is("reviewed_at", null)),
    q("reviewReports", "Reviews reported this fortnight", "Reports against a review in the last 14 days.", "conversations/safety", { tab: "review-reports" }, () => head(db, "review_reports").gte("created_at", ago(14))),
    q("agentChanges", "Agent changes waiting for the team", "Knowledge changes held for a fair housing flag, a new owner or launch review.", "agents", null, () => head(db, "listing_fact_events").in("status", ["held", "proposed"]).contains("detail", { adminReview: true })),
    q("unroutable", "Questions with no one to ask", "A student's question could not be sent to any landlord.", "agents/health", { tab: "agent-questions" }, () => head(db, "listing_questions").eq("status", "unroutable")),
    q("imports", "Failed imports this week", "A listing import or website sync failed in the last 7 days.", "agents/health", { tab: "import-jobs" }, () => head(db, "listing_import_jobs").eq("status", "failed").gte("created_at", ago(7))),
    q("monitors", "Websites failing to sync", "A watched page has failed three or more checks in a row.", "agents/health", { tab: "sync-monitors" }, () => head(db, "listing_source_monitors").eq("enabled", true).gte("consecutive_failures", 3)),
    q("emails", "Email problems this week", "Emails that bounced, were refused or were marked as spam in the last 7 days.", "email/sent", null, () => head(db, "sent_emails").in("status", ["bounced", "complained", "rejected", "failed"]).gte("created_at", ago(7))),
    q("errors", "Open site errors", "Errors the site recorded that nobody has marked resolved.", "system/errors", null, () => head(db, "app_errors").is("resolved_at", null)),
    ...(isSuper ? [
      q("confirm", "Charges to confirm", "New charges wait for a team member before the landlord sees them.", "billing", { tab: "confirm" }, () => head(db, "charges").eq("status", "unconfirmed"), { billing: true }),
      q("contested", "Contested charges", "A landlord disputed a charge and waits for a decision.", "billing", { tab: "contest" }, () => head(db, "charges").eq("status", "contested"), { billing: true }),
      q("invoices", "Failed invoices", "An invoice payment failed.", "billing", { tab: "invoices" }, () => head(db, "billing_invoices").eq("status", "failed"), { billing: true }),
      q("changes", "Agreement change requests", "A landlord asked to change the agreement and waits on us.", "billing", { tab: "changes" }, () => head(db, "agreement_change_requests").eq("status", "open"), { billing: true }),
      q("payerRequests", "Listings waiting on a signer", "A listing cannot publish until its authorized signer approves.", "billing/history", { tab: "payer-requests" }, () => head(db, "payer_publish_requests").eq("status", "waiting"), { billing: true }),
      q("stripe", "Stripe events with errors", "A Stripe update failed to process in the last 30 days.", "billing/history", { tab: "stripe-events" }, () => head(db, "stripe_webhook_events").not("error", "is", null).gte("received_at", ago(30)), { billing: true }),
    ] : []),
  ];

  const pulse = [
    ["New accounts", () => head(db, "users").gte("created_at", ago(7))],
    ["Listings published", () => head(db, "listings").gte("published_at", ago(7)).is("deleted_at", null)],
    ["Conversations started", () => head(db, "chat_threads").gte("created_at", ago(7))],
    ["Tours requested", () => head(db, "tour_requests").gte("created_at", ago(7))],
    ["Reviews written", () => head(db, "listing_reviews").gte("created_at", ago(7)).is("deleted_at", null)],
  ];

  const [queueCounts, pulseCounts, followUps] = await Promise.all([
    Promise.all(queues.map((x) => count(x.build))),
    Promise.all(pulse.map(([, build]) => count(build))),
    loadFollowUps(db, today),
  ]);

  return {
    queues: queues.map(({ build, ...x }, i) => ({ ...x, count: queueCounts[i] })),
    pulse: pulse.map(([label], i) => ({ label, count: pulseCounts[i] })),
    followUps,
  };
}

/* Notes whose follow-up date has arrived or is within the next week, soonest first. */
async function loadFollowUps(db, today) {
  const soon = new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10);
  const { data, error } = await db.from("admin_notes").select("id, subject_type, subject_id, body, follow_up_on, author_id")
    .not("follow_up_on", "is", null).is("follow_up_done_at", null).lte("follow_up_on", soon).order("follow_up_on").limit(50);
  if (error) return { unavailable: true, rows: [] };
  const notes = data ?? [];
  const userIds = [...new Set([...notes.filter((n) => n.subject_type === "user").map((n) => n.subject_id), ...notes.map((n) => n.author_id)].filter(Boolean))];
  const listingIds = [...new Set(notes.filter((n) => n.subject_type === "listing").map((n) => n.subject_id))];
  const [users, listings] = await Promise.all([
    userIds.length ? db.from("users").select("id, name, email").in("id", userIds) : { data: [] },
    listingIds.length ? db.from("listings").select("id, title, address").in("id", listingIds) : { data: [] },
  ]);
  const userBy = new Map((users.data ?? []).map((u) => [u.id, u.name || u.email || "Unnamed account"]));
  const listingBy = new Map((listings.data ?? []).map((l) => [l.id, l.title || l.address || "Untitled listing"]));
  return {
    rows: notes.map((n) => ({
      id: n.id, kind: n.subject_type, subjectId: n.subject_id,
      subject: (n.subject_type === "user" ? userBy : listingBy).get(n.subject_id) ?? (n.subject_type === "user" ? "A deleted account" : "A deleted listing"),
      body: n.body, on: n.follow_up_on, due: n.follow_up_on <= today, author: userBy.get(n.author_id) ?? "A team member",
    })),
  };
}
