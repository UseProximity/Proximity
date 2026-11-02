/*
 * The real Documenso client, signed-PDF storage and team email, wired together for
 * the routes that sign, sync and receive webhooks. The library code takes these as
 * arguments so it can be tested with stand-ins.
 */
import { outreachEnabled } from "@/lib/appEnv";
import { DOCUMENSO_EMAILS_OFF, createDocumensoClient, documensoConfigured } from "./documenso.js";
import { storeSignedAgreement } from "./agreementFiles.js";
import { sendAgreementDeclinedTeamEmail } from "./billingEmails.js";

export function agreementServices() {
  return {
    // Off production Documenso emails nobody (outreach rule). On production it
    // keeps its defaults for now.
    documenso: createDocumensoClient({ emailSettings: outreachEnabled() ? null : DOCUMENSO_EMAILS_OFF }),
    signingAvailable: documensoConfigured(),
    options: {
      storeSigned: storeSignedAgreement,
      notify: {
        declined: ({ landlord, reason }) =>
          sendAgreementDeclinedTeamEmail({ landlordName: landlord?.name, landlordEmail: landlord?.email, reason }),
      },
    },
  };
}
