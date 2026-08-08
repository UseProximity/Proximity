/*
 * Onboarding ledger — a durable record of what happened while a landlord was
 * connecting, so a failed connect is never something we only hear about
 * because the landlord mentioned it.
 *
 * The nightly sync already logs to `pms_sync_events`, but it only ever runs
 * against connections that are already working. Everything before that — the
 * credential check, the first pull, geocoding, the schema-alignment verdict —
 * happened in memory and vanished. If a property manager tried at 9pm and got
 * "we couldn't read from your account", there was nothing to look at.
 *
 * Steps land in the same `pms_sync_events` table the sync uses (one store, one
 * place to look) with `result = 'observed'` for informational steps and
 * `'error'` for failures. `applied` is always false: nothing here writes to a
 * listing.
 *
 * Every method is best-effort and swallows its own errors. Instrumentation
 * that can fail a landlord's connect attempt is worse than no instrumentation.
 */
import supabase from "@/lib/supabase";

export const PHASES = {
  CONNECT: "connect",
  DISCOVER: "discover",
  CONFIRM: "confirm",
};

export function createLedger({ connectionId = null, provider, userId, phase }) {
  const startedAt = Date.now();
  const steps = [];
  let lastAt = startedAt;
  // The connection row may not exist yet when the ledger is created (a
  // credential that fails verification never gets one on a first attempt).
  // Steps recorded before it does are held and written once it appears.
  let boundConnectionId = connectionId;
  const pending = [];

  async function persist(entry) {
    if (!boundConnectionId) {
      pending.push(entry);
      return;
    }
    try {
      await supabase.from("pms_sync_events").insert({
        connection_id: boundConnectionId,
        listing_id: entry.listingId ?? null,
        external_unit_id: null,
        applied: false,
        result: entry.ok === false ? "error" : "observed",
        detail: {
          phase: entry.phase,
          step: entry.step,
          ok: entry.ok,
          message: entry.message ?? null,
          durationMs: entry.durationMs,
          ...(entry.detail ?? {}),
        },
      });
    } catch (err) {
      console.error("[pms ledger] could not record step:", err?.message);
    }
  }

  return {
    get steps() {
      return steps;
    },
    get connectionId() {
      return boundConnectionId;
    },
    get elapsedMs() {
      return Date.now() - startedAt;
    },

    // Called once the connection row exists, flushing anything recorded first.
    async bind(id) {
      if (!id || boundConnectionId === id) return;
      boundConnectionId = id;
      const held = pending.splice(0, pending.length);
      for (const entry of held) await persist(entry);
    },

    /*
     * Record one step. `ok: false` marks it as the thing that went wrong —
     * there is at most one per attempt, because the flow stops there.
     */
    async step(step, { ok = true, message = null, detail = null, listingId = null } = {}) {
      const now = Date.now();
      const entry = { phase, step, ok, message, detail, listingId, durationMs: now - lastAt };
      lastAt = now;
      steps.push(entry);
      await persist(entry);
      return entry;
    },

    // Did anything fail? Drives whether the report email is a failure alert.
    get failed() {
      return steps.some((s) => s.ok === false);
    },
  };
}
