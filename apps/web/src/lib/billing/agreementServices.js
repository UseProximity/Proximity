/*
 * The real Documenso client, signed-PDF storage and team email, wired together for
 * the routes that sign, sync and receive webhooks. The library code takes these as
 * arguments so it can be tested with stand-ins.
 */
import { createDocumensoClient, documensoConfigured } from "./documenso.js";
import { storeSignedAgreement } from "./agreementFiles.js";
import { sendAgreementDeclinedTeamEmail } from "./billingEmails.js";

export function agreementServices() {
  return {
    documenso: createDocumensoClient(),
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
