/*
 * Who hears about PMS activity, and how an onboarding attempt gets reported.
 *
 * Recipient resolution was written inline in the sync cron; it lives here now
 * because the onboarding path needs exactly the same rule and the two must not
 * drift — an alert that reaches one audience during the nightly sync and a
 * different one at connect time is worse than either.
 *
 * Off production (the pilot is a preview deployment, so it resolves to staging)
 * outreach is suppressed by default. PMS_ALERT_EMAIL is allowlisted implicitly
 * by outreach.js, so setting it is all that is needed for these reports to
 * arrive. The supers fallback below is NOT allowlisted — off production it
 * suppresses, which is the safe direction: those are real addresses from the
 * prod snapshot.
 */
import supabase from "@/lib/supabase";
import { sendPmsOnboardingReportEmail } from "@/lib/email";
import { summarizeFindings } from "./validate.js";

// Preview mode: the landlord connects and sees their portfolio, but the
// confirm step is refused and nothing is written to `listings`. This is the
// posture for a pilot with a real property manager who has not agreed to
// having their listings created yet.
export function pmsPreviewOnly() {
  return process.env.PMS_PREVIEW_ONLY === "1";
}

/*
 * PMS_ALERT_EMAIL (comma-separated) if set, otherwise every super. The
 * explicit list is preferred during a pilot: the supers fallback would also
 * pull in anyone who happens to be super in the prod snapshot.
 */
export async function pmsAlertRecipients() {
  const explicit = (process.env.PMS_ALERT_EMAIL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (explicit.length) return explicit;

  const { data: supers } = await supabase
    .from("users")
    .select("email, roles!inner(name)")
    .eq("roles.name", "super")
    .not("email", "is", null);
  return (supers ?? []).map((u) => u.email).filter(Boolean);
}

/*
 * Send the report for one onboarding phase. Best-effort by design: a mail
 * failure must never turn a landlord's successful connect into an error.
 */
export async function reportOnboarding({
  ledger,
  phase,
  provider,
  landlord = null,
  accountLabel = null,
  validation = null,
  landlordVisible = [],
  baseUrl = null,
}) {
  try {
    const recipients = await pmsAlertRecipients();
    if (!recipients.length) {
      console.warn("[pms alerts] no PMS_ALERT_EMAIL and no supers — report not sent");
      return;
    }
    await sendPmsOnboardingReportEmail({
      to: recipients.join(", "),
      provider,
      landlord,
      accountLabel,
      phase,
      failed: ledger.failed,
      steps: ledger.steps,
      findings: validation ? summarizeFindings(validation.findings) : [],
      counts: validation?.counts ?? null,
      landlordVisible,
      baseUrl,
      previewOnly: pmsPreviewOnly(),
    });
  } catch (err) {
    console.error("[pms alerts] report email failed:", err?.message);
  }
}
