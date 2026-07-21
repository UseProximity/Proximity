/*
 * PMS connector registry. Every connector implements the contract in types.js:
 *   verifyConnection(connectionId) -> { ok, error?, accountLabel? }
 *   fetchSnapshot(connectionId)    -> { properties, errors }   (never throws)
 *
 * API providers auto-apply sync results; scrape providers are signal-only
 * (review queue). "aggregator" is the future drop-in for walled systems
 * (Yardi / RealPage / Entrata).
 */
import * as buildium from "./buildium.js";
import * as appfolio from "./appfolio.js";
import * as doorloop from "./doorloop.js";

const CONNECTORS = { buildium, appfolio, doorloop };

// Providers whose data is authoritative (sync auto-applies without review).
export const API_PROVIDERS = ["buildium", "appfolio", "doorloop"];

export function getConnector(provider) {
  const connector = CONNECTORS[provider];
  if (!connector) throw new Error(`Unknown PMS provider: ${provider}`);
  return connector;
}

export function isApiProvider(provider) {
  return API_PROVIDERS.includes(provider);
}
