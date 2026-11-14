/*
 * What a request that marks a profile complete has to carry.
 *
 * Only what every client sends: the web popup and the shipped mobile app both
 * send a name and a role, but the mobile app never sends gender, referral source
 * or graduation month, so requiring those here would break installed builds.
 * Returns the message to answer 400 with, or null when the request is fine.
 */
export function profileCompletionError(body) {
  if (typeof body?.name !== "string" || !body.name.trim()) return "Enter your name.";
  if (typeof body?.role !== "string" || !body.role.trim()) return "Select who you are.";
  return null;
}
