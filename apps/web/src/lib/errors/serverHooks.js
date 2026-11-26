/*
 * The Node half of instrumentation.js (site error alerts, Wyatt,
 * 2026-11-03). Kept in its own file so the edge build never sees it.
 */
import { after } from "next/server";
import { recordError, isReporting } from "@/lib/errors/record";

// Inside a request, after() keeps the function alive until the report is
// written; outside one it throws, and the report just runs.
const later = (fn) => {
  try { after(fn); } catch { fn().catch(() => {}); }
};

export function captureConsoleErrors() {
  const original = console.error.bind(console);
  console.error = (...args) => {
    original(...args);
    try {
      if (isReporting()) return;
      // Our own "<where> failed:" lines (Next.js's report of an uncaught error
      // comes through onRequestError instead). Routes log either the Error, a
      // database error object, or just its message, so take whichever is there.
      const label = args[0];
      if (typeof label !== "string" || label.startsWith("⨯")) return;
      if (!/failed|threw|error|exception|crash/i.test(label)) return;
      const detail = args.slice(1).find((a) => a instanceof Error)
        ?? args.slice(1).find((a) => a && typeof a === "object" && typeof a.message === "string")
        ?? args.slice(1).find((a) => typeof a === "string" && a.trim());
      if (!detail) return;
      const where = label.replace(/\s*(failed|threw|error)?\s*:?\s*$/i, "").trim().slice(0, 200) || null;
      const input = detail instanceof Error
        ? { error: detail }
        : typeof detail === "string"
          ? { message: detail }
          : { message: [detail.message, detail.code ? `(code ${detail.code})` : null].filter(Boolean).join(" "), error: detail };
      later(() => recordError({ source: "server", where, ...input }).catch(() => {}));
    } catch {
      // reporting must never break logging
    }
  };
}

export async function reportRequestError(err, request, context) {
  try {
    const path = String(request?.path ?? "").split("?")[0];
    await recordError({
      source: "server",
      where: `${request?.method ?? ""} ${path}`.trim(),
      error: err,
      sample: { routeType: context?.routeType ?? null, route: context?.routePath ?? null },
    });
  } catch {
    // never let reporting fail the request further
  }
}
