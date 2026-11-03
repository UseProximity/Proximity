/*
 * Review sandbox lookups (App Store review accounts). users.review_sandbox is set
 * by the team, by SQL, and nothing in the app writes it. These helpers only read it,
 * at the point where an action is decided (sending an email or push, filtering an
 * inbox), keyed on user ids the caller already holds. Nothing is cached and nothing
 * rides in the session, so a flag change applies on the next action.
 *
 * Rules used by the callers:
 *   - Email: suppressed (never sent, never redirected) when the sender OR the recipient
 *     is a sandbox user.
 *   - Push and the inbox: acted on when the actor is a sandbox user and the other side
 *     is not.
 *   - Listings: a sandbox listing is invisible to everyone but sandbox accounts, and in
 *     the "is it already listed" checks it never blocks or absorbs a real landlord
 *     (withoutSandboxRows below).
 *
 * A failed lookup is retried (3 attempts in all, 100 ms then 300 ms apart). If it
 * still fails the helpers log loudly and throw SandboxLookupError, and the caller
 * lets that stop the action (no email, no push, a 500 for the inbox) rather than
 * guessing that the user is not a sandbox account.
 *
 * Plain imports only, and the database client is loaded when a query runs, like
 * emailLog.js, so the node test runner can import modules that depend on this.
 */

const RETRY_DELAYS_MS = [100, 300];

/**
 * Thrown when the flag could not be read. The message is generic on purpose, as
 * some callers echo it (same shape as RequestUserLookupError in getRequestUser.js).
 */
export class SandboxLookupError extends Error {
  constructor(cause) {
    super("Could not check the review sandbox flag.");
    this.name = "SandboxLookupError";
    this.cause = cause;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Run a Supabase query, retrying a failure (an error result or a thrown error).
// Resolves to the rows, or throws SandboxLookupError after the last attempt.
async function readRows(query) {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const { data, error } = await query();
      if (!error) return data ?? [];
      lastError = error;
    } catch (err) {
      lastError = err;
    }
    if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
  }
  console.error(
    `[review sandbox] flag lookup failed after ${RETRY_DELAYS_MS.length + 1} attempts, so the action is suppressed:`,
    lastError?.message ?? lastError
  );
  throw new SandboxLookupError(lastError);
}

// `client` is for callers that already hold one (and for checking this file
// without a database); by default the app's service-role client is used.
async function dbClient(client) {
  if (client) return client;
  const { default: supabase } = await import("./supabase.js");
  return supabase;
}

/**
 * The subset of `ids` that are review sandbox users, as a Set. Falsy ids are
 * ignored; with nothing to look up there is no query.
 */
export async function sandboxIdsAmong(ids, { client } = {}) {
  const wanted = [...new Set((ids ?? []).filter(Boolean))];
  if (wanted.length === 0) return new Set();
  const rows = await readRows(async () =>
    (await dbClient(client)).from("users").select("id").in("id", wanted).eq("review_sandbox", true)
  );
  return new Set(rows.map((row) => row.id));
}

/**
 * Every review sandbox user id, as a Set. A handful of rows, read through the
 * partial index on users.review_sandbox; used by the inbox filter.
 */
export async function allSandboxUserIds({ client } = {}) {
  const rows = await readRows(async () =>
    (await dbClient(client)).from("users").select("id").eq("review_sandbox", true)
  );
  return new Set(rows.map((row) => row.id));
}

/**
 * For checks that ask "is there already a listing here, or with this name": sandbox
 * listings are invisible to everyone but sandbox accounts, so a real landlord is never
 * blocked by one or offered one. `rows` carry a `review_sandbox` field. They come back
 * unchanged when none is a sandbox listing (no lookup, so ordinary paths cost nothing)
 * or when the viewer is a sandbox account (which sees everything, as before); otherwise
 * without the sandbox ones. A failed viewer lookup throws SandboxLookupError.
 */
export async function withoutSandboxRows(rows, viewerId, { client } = {}) {
  if (!Array.isArray(rows) || !rows.some((row) => row?.review_sandbox === true)) return rows;
  const viewerIsSandbox = viewerId ? (await sandboxIdsAmong([viewerId], { client })).has(viewerId) : false;
  return viewerIsSandbox ? rows : rows.filter((row) => row?.review_sandbox !== true);
}
