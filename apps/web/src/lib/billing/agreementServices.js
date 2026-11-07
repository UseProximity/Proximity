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
import { stripeBillingAddress } from "./billingAddress.js";
import { resolveChangeRequestOnSigned } from "./changeRequests.js";
import supabase from "@/lib/supabase";
import { sendAgreementDeclinedTeamEmail } from "./billingEmails.js";

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
      storeSigned: storeSignedAgreement,
      storeExhibit: storeSignedAgreement,
      landlordAddress: (userId) => stripeBillingAddress(supabase, userId),
      // A negotiated version signed: the change request it answered is resolved.
      onSigned: ({ userId, versionId }) => resolveChangeRequestOnSigned(supabase, { userId, versionId }),
      notify: {
        declined: ({ landlord, reason, kind }) =>
          sendAgreementDeclinedTeamEmail({ landlordName: landlord?.name, landlordEmail: landlord?.email, reason, kind }),
      },
    },
  };
}
