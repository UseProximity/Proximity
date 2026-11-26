/*
 * Server error capture for the site error alerts (lib/errors/record.js,
 * Wyatt, 2026-11-03).
 *
 * Two ways a server failure reaches us:
 *   onRequestError  anything Next.js itself sees go uncaught: a page, a route
 *                   handler or a server action that throws.
 *   console.error   our routes mostly catch their own errors, log
 *                   "GET /api/x failed:" with the error, and answer 500. A
 *                   log line that carries a real Error is counted too, with
 *                   the text before the error as where it happened.
 *
 * Node runtime only (middleware runs on the edge and is left alone), and
 * never during a build.
 */
const building = () => process.env.NEXT_PHASE === "phase-production-build";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && !building()) {
    const { captureConsoleErrors } = await import("@/lib/errors/serverHooks");
    captureConsoleErrors();
  }
}

export async function onRequestError(err, request, context) {
  if (process.env.NEXT_RUNTIME === "nodejs" && !building()) {
    const { reportRequestError } = await import("@/lib/errors/serverHooks");
    await reportRequestError(err, request, context);
  }
}
