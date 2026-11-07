/*
 * The emails a change request sends, wired to the real senders and passed to
 * changeRequests.js as `notify`.
 *
 *   newRequest, landlordReplied   to the team (CHANGE_REQUEST_TEAM_EMAILS)
 *   teamReplied                   to the landlord: replied, accepted or declined
 *   reminder                      to the team, from the daily billing cron
 *
 * A review sandbox account (an App Store reviewer) is never emailed, and their
 * requests never reach the team inbox either, the same rule as the rest of the app
 * (lib/reviewSandbox.js). Off production every email goes to the test inbox or is
 * suppressed (lib/outreach.js).
 */
import { getBaseUrl } from "@/lib/email";
import { sandboxIdsAmong } from "@/lib/reviewSandbox";
import { sendChangeRequestReminderEmail, sendChangeRequestTeamEmail, sendChangeRequestUpdateEmail } from "./billingEmails";

const adminUrl = () => `${getBaseUrl()}/dashboard/admin`;
const paymentsUrl = () => `${getBaseUrl()}/dashboard/landlord?tab=billing#marketing-agreement`;
const isSandbox = async (userId) => (await sandboxIdsAmong([userId])).has(userId);

async function teamEmail({ landlord, request, message, isReply }) {
  if (await isSandbox(landlord.id)) return;
  await sendChangeRequestTeamEmail({
    landlordName: landlord.name,
    landlordEmail: landlord.email,
    documentKind: request.document_kind,
    section: request.section,
    body: message.body,
    proposedText: message.proposed_text,
    hasFile: !!message.file_key,
    isReply,
    adminUrl: adminUrl(),
  });
}

export function changeRequestNotify() {
  return {
    newRequest: (input) => teamEmail({ ...input, isReply: false }),
    landlordReplied: (input) => teamEmail({ ...input, isReply: true }),

    async teamReplied({ landlord, message, outcome }) {
      if (!landlord?.email) return;
      await sendChangeRequestUpdateEmail(
        { id: landlord.id, email: landlord.email, name: landlord.name },
        { outcome, message: message?.body ?? null, paymentsUrl: paymentsUrl() },
        { sandbox: await isSandbox(landlord.id) }
      );
    },

    async reminder({ requests }) {
      const sandbox = await sandboxIdsAmong(requests.map((r) => r.landlord?.id));
      const real = requests.filter((r) => !sandbox.has(r.landlord?.id));
      if (real.length) await sendChangeRequestReminderEmail({ requests: real, adminUrl: adminUrl() });
    },
  };
}
