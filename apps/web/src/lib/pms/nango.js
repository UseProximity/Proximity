/*
 * Nango hosted-auth helper.
 *
 * The landlord authorizes in Nango's hosted Connect UI (they generate an API
 * key inside their PMS and paste it into NANGO's window — never ours). Nango
 * stores the secret; we keep only a connection_id reference and call the PMS
 * through Nango's Proxy. No raw PMS credential ever touches our code or DB.
 *
 * Env: NANGO_SECRET_KEY (server-only). Optional NANGO_HOST for self-hosting
 * (defaults to Nango Cloud).
 *
 * Provider config keys must match the integrations configured in the Nango
 * dashboard: "buildium" (pre-built), "appfolio" + "doorloop" (custom API
 * configs — see the README in this directory).
 */
import { fetchWithRetry } from "./httpRetry.js";

const NANGO_HOST = process.env.NANGO_HOST || "https://api.nango.dev";

function secretKey() {
  const key = process.env.NANGO_SECRET_KEY;
  if (!key) throw new Error("NANGO_SECRET_KEY is not set");
  return key;
}

// Create a Connect UI session for one provider. The returned token goes to the
// browser widget; it is short-lived and scoped to this end user + integration.
export async function createConnectSession({ userId, email, displayName, providerConfigKey }) {
  const res = await fetchWithRetry(`${NANGO_HOST}/connect/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      end_user: { id: userId, email: email || undefined, display_name: displayName || undefined },
      allowed_integrations: [providerConfigKey],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Nango connect session failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return { token: json?.data?.token, expiresAt: json?.data?.expires_at };
}

// Call the PMS through Nango's Proxy. `path` is the PMS-relative path
// (e.g. "/v1/rentals"); Nango injects the stored credential.
export async function nangoProxyFetch({ connectionId, providerConfigKey, path, method = "GET", query, body, baseUrlOverride }) {
  const qs = query ? `?${new URLSearchParams(query)}` : "";
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const headers = {
    Authorization: `Bearer ${secretKey()}`,
    "Connection-Id": connectionId,
    "Provider-Config-Key": providerConfigKey,
  };
  if (baseUrlOverride) headers["Base-Url-Override"] = baseUrlOverride;
  if (body) headers["Content-Type"] = "application/json";

  return fetchWithRetry(`${NANGO_HOST}/proxy/${cleanPath}${qs}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Fetch connection metadata (includes connection_config values collected by the
// Connect UI, e.g. the AppFolio subdomain). Returns null when missing.
export async function getConnection({ connectionId, providerConfigKey }) {
  const res = await fetchWithRetry(
    `${NANGO_HOST}/connection/${encodeURIComponent(connectionId)}?provider_config_key=${encodeURIComponent(providerConfigKey)}`,
    { headers: { Authorization: `Bearer ${secretKey()}` } }
  );
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

// Delete the connection in Nango (called when a landlord disconnects, so the
// credential is destroyed at the source). Best-effort — returns false on failure.
export async function deleteNangoConnection({ connectionId, providerConfigKey }) {
  try {
    const res = await fetchWithRetry(
      `${NANGO_HOST}/connection/${encodeURIComponent(connectionId)}?provider_config_key=${encodeURIComponent(providerConfigKey)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${secretKey()}` } }
    );
    return res.ok;
  } catch {
    return false;
  }
}
