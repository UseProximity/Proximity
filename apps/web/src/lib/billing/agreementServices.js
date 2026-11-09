/*
 * The real Documenso client, signed-PDF storage and team email, wired together for
 * the routes. The library code takes these as arguments so it can be tested with
 * stand-ins.
 *
 * Production and the test environments share one Documenso team (Teams plan), so
 * the client is set up per environment: its own folder (DOCUMENSO_FOLDER_ID, or
 * DOCUMENSO_FOLDER_ID_DEV off production), a
 * [TEST] title prefix and environment tag off production data, and, off
 * production, no Documenso emails at all (outreach rule: dev holds real landlords'
 * addresses).
 */
import { appEnv, isProdData, outreachEnabled } from "@/lib/appEnv";
import { DOCUMENSO_EMAILS_OFF, createDocumensoClient, documensoConfigured, documensoSetting } from "./documenso.js";
import { storeSignedAgreement } from "./agreementFiles.js";
import { MAX_DOCUMENSO_PDF_BYTES } from "./agreementPdf.js";

// A signed copy from Documenso may be larger than an upload (agreementPdf.js).
const storeFromDocumenso = (file) => storeSignedAgreement({ ...file, maxBytes: MAX_DOCUMENSO_PDF_BYTES });
import { stripeBillingAddress } from "./billingAddress.js";
import { recordDecline, resolveChangeRequestOnSigned } from "./changeRequests.js";
import supabase from "@/lib/supabase";
import { getBaseUrl } from "@/lib/email";
import { sandboxIdsAmong } from "@/lib/reviewSandbox";
import { sendAgreementDeclinedTeamEmail } from "./billingEmails.js";
import { afterPayerSigned } from "./payerServices.js";

export function documensoClient() {
  return createDocumensoClient({
    emailSettings: outreachEnabled() ? null : DOCUMENSO_EMAILS_OFF,
    folderId: documensoSetting("DOCUMENSO_FOLDER_ID"),
    titlePrefix: isProdData() ? "" : "[TEST] ",
    envTag: appEnv(),
  });
}

export function agreementServices() {
  return {
    documenso: documensoClient(),
    signingAvailable: documensoConfigured(),
    options: {
      storeSigned: storeFromDocumenso,
      storeExhibit: storeFromDocumenso,
      landlordAddress: (userId) => stripeBillingAddress(supabase, userId),
      // A negotiated version signed: the change request it answered is resolved.
      // A payer's signature also publishes what the accounts they pay for were waiting on.
      onSigned: async ({ userId, versionId, signerId, accounts, withdrawn }) => {
        await resolveChangeRequestOnSigned(supabase, { userId: signerId ?? userId, versionId });
        await afterPayerSigned({ signerId: signerId ?? userId, accounts, withdrawn });
      },
      // A rejection: the reason opens a change request (or joins the open one).
      onDeclined: async ({ userId, reason, doc }) => {
        const { opened } = await recordDecline(supabase, { userId, reason, doc });
        return { opened };
      },
      // One team email for the decline and the change request it opened, never two.
      // A review sandbox account never reaches the team inbox (lib/reviewSandbox.js).
      notify: {
        declined: async ({ landlord, reason, kind, changeRequest }) => {
          if (landlord?.id && (await sandboxIdsAmong([landlord.id])).has(landlord.id)) return;
          await sendAgreementDeclinedTeamEmail({
            landlordName: landlord?.name,
            landlordEmail: landlord?.email,
            reason,
            kind,
            changeRequest,
            adminUrl: `${getBaseUrl()}/dashboard/admin`,
          });
        },
      },
    },
  };
}
