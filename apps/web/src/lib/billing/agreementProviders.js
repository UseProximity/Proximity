/*
 * Where an e-signature provider (DocuSign, Documenso, ...) plugs in. None is
 * chosen yet, so the only provider is "manual": an admin records the agreement
 * as sent and signed by hand (agreements.js). The listing gate never looks at a
 * provider, only at the agreement's status, so adding one means writing an
 * adapter here and having it set that status.
 *
 * An adapter is an object with this shape:
 *
 *   name                          the value stored in landlord_agreements.provider
 *   sendForSignature(ctx)         start signing for ctx.landlord and ctx.agreement;
 *                                 resolves { envelopeId } (stored as provider_envelope_id)
 *   getStatus(envelopeId)         resolves 'sent' | 'signed' | 'voided'
 *   parseWebhook(request)         verifies a provider webhook and resolves
 *                                 { envelopeId, status, signedFile? } or null
 *
 * Provider code stays behind this interface so nothing else in billing changes.
 */
import { BillingError } from "./errors.js";

const notAvailable = (what) => () => {
  throw new BillingError("no_provider", `No e-signature provider is set up, so ${what} is done by hand.`, 501);
};

export const manualProvider = {
  name: "manual",
  sendForSignature: notAvailable("sending the agreement"),
  getStatus: notAvailable("checking its status"),
  parseWebhook: notAvailable("signature notifications"),
};

const PROVIDERS = { manual: manualProvider };

export function registerAgreementProvider(adapter) {
  for (const method of ["sendForSignature", "getStatus", "parseWebhook"]) {
    if (typeof adapter?.[method] !== "function") throw new Error(`Agreement provider is missing ${method}()`);
  }
  if (!adapter.name || typeof adapter.name !== "string") throw new Error("Agreement provider needs a name");
  PROVIDERS[adapter.name] = adapter;
}

export function getAgreementProvider(name = "manual") {
  const provider = PROVIDERS[name];
  if (!provider) throw new BillingError("no_provider", `Unknown agreement provider "${name}".`, 500);
  return provider;
}
