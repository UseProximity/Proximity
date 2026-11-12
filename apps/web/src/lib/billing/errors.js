/*
 * An expected billing failure the caller can act on. Routes turn it into an
 * HTTP response with its status; anything else is an unexpected 500. The message
 * is safe to show a landlord, so it never carries Stripe or database detail.
 */
export class BillingError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "BillingError";
    this.code = code;
    this.status = status;
  }
}
