/*
 * Marketing attribution switches and constants.
 *
 * Nothing is recorded outside production unless MARKETING_ATTRIBUTION_ENABLED
 * is "true", so staging and local can be tested deliberately (PRD edge case
 * 11). On production it is on by default and "false" turns it off as a kill
 * switch.
 */
import { isProdData } from "@/lib/appEnv";

export function attributionEnabled() {
  const flag = String(process.env.MARKETING_ATTRIBUTION_ENABLED ?? "").trim().toLowerCase();
  if (flag === "false") return false;
  if (flag === "true") return true;
  return isProdData();
}

// Session-only identifier (PRD D5): HttpOnly, SameSite=Lax, and it expires
// after 30 minutes without a beacon. No long-lived tracking cookie.
export const SESSION_COOKIE = "prx_msid";
export const SESSION_IDLE_SECONDS = 30 * 60;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_IDLE_SECONDS,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v) {
  return typeof v === "string" && UUID_RE.test(v);
}
