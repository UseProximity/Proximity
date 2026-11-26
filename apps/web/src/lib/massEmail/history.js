/*
 * What a mass email template has sent so far (Wyatt, 2026-11-07): each batch,
 * newest first, with every recipient and how their email went. The delivery
 * status comes from sent_emails, which Amazon SES's reports keep up to date
 * (/api/ses/events), matched on the SES message id.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * Pure: the one status to show for a recipient. A delivery report beats what we
 * knew at send time; a send that never left keeps its own status.
 */
export function deliveryStatus(recipient, report) {
  if (recipient.status !== "sent") return recipient.status;
  if (!report) return "sent";
  if (["delivered", "bounced", "complained", "rejected", "delayed", "failed"].includes(report.status)) return report.status;
  return "sent";
}

export async function templateHistory(db, templateId) {
  if (!UUID.test(String(templateId))) return [];
  const { data: recipients, error } = await db
    .from("mass_email_recipients")
    .select("id, batch_id, user_id, email, status, status_detail, provider_message_id, setup_link, proxy_listings, created_at, mass_email_versions!version_id(version), users!user_id(name)")
    .eq("template_id", templateId)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw error;
  const batchIds = [...new Set((recipients ?? []).map((r) => r.batch_id))];
  if (!batchIds.length) return [];

  const { data: batches, error: bErr } = await db
    .from("mass_email_batches")
    .select("id, created_at, turn_proxy_on, recipient_count, mass_email_versions!version_id(version), creator:users!created_by(name)")
    .in("id", batchIds)
    .order("created_at", { ascending: false });
  if (bErr) throw bErr;

  const messageIds = [...new Set((recipients ?? []).map((r) => r.provider_message_id).filter(Boolean))];
  const reports = new Map();
  for (let i = 0; i < messageIds.length; i += 150) {
    const { data, error: rErr } = await db
      .from("sent_emails")
      .select("provider_message_id, status, status_detail")
      .in("provider_message_id", messageIds.slice(i, i + 150));
    if (rErr) throw rErr;
    for (const r of data ?? []) reports.set(r.provider_message_id, r);
  }

  return (batches ?? []).map((b) => ({
    id: b.id,
    createdAt: b.created_at,
    version: b.mass_email_versions?.version ?? null,
    sentBy: b.creator?.name ?? null,
    turnProxyOn: b.turn_proxy_on,
    recipients: (recipients ?? [])
      .filter((r) => r.batch_id === b.id)
      .map((r) => {
        const report = r.provider_message_id ? reports.get(r.provider_message_id) : null;
        return {
          id: r.id,
          userId: r.user_id,
          name: r.users?.name ?? null,
          email: r.email,
          status: deliveryStatus(r, report),
          detail: report?.status_detail ?? r.status_detail ?? null,
          setupLink: r.setup_link,
          proxyListings: r.proxy_listings,
          at: r.created_at,
        };
      }),
  }));
}
