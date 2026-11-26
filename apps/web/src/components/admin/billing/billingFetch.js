"use client";

/*
 * fetch for the admin billing panels, sending the dashboard's dev/prod switch as
 * x-db-target (lib/billing/adminDb.js), like the other admin views' adminFetch.
 * BillingView sets the target when it mounts; the page remounts it on a switch.
 */
let target = null;

export function setBillingTarget(next) {
  target = next === "prod" || next === "dev" ? next : null;
}

export function billingFetch(url, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (target) headers.set("x-db-target", target);
  return fetch(url, { ...options, headers });
}
