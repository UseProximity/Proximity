/*
 * Demo mode — a synthetic PMS account for testing the entire flow (connect →
 * discover → confirm → cron sync → badges) without a real Buildium/AppFolio
 * account or a Nango connection.
 *
 * A "mock-" connection id short-circuits the Buildium connector BEFORE any
 * Nango call. Hard-gated off in production: on the live site a mock id just
 * fails verification like any bad credential.
 *
 * Simulating a lease-up: set PMS_MOCK_LEASED to a comma-separated list of unit
 * labels (e.g. PMS_MOCK_LEASED="2B,4A"), restart, and re-run the cron — those
 * units go occupied, and freeing them relists on the next run.
 */
import { appEnv } from "../appEnv.js";

export function isMockConnection(connectionId) {
  return (
    typeof connectionId === "string" &&
    connectionId.startsWith("mock-") &&
    appEnv() !== "production"
  );
}

const forcedLeased = () =>
  new Set(
    (process.env.PMS_MOCK_LEASED || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );

const unit = (id, label, { beds, baths, rent, available, availableFrom = null, area = null }) => ({
  externalUnitId: id,
  label,
  available: forcedLeased().has(label) ? false : available,
  rent,
  bedrooms: beds,
  bathrooms: baths,
  area,
  availableFrom: forcedLeased().has(label) ? "2027-05-31" : availableFrom,
  beds: null,
  rawStatus: null,
});

export function mockVerify() {
  return { ok: true, accountLabel: "Demo account (sample data)" };
}

export function mockSnapshot() {
  return {
    properties: [
      {
        externalPropertyId: "demo-p1",
        name: "Clemens Court (Demo)",
        address: "6633 Clemens Ave",
        city: "St. Louis",
        state: "MO",
        zip: "63130",
        units: [
          unit("demo-u1", "1A", { beds: 2, baths: 1, rent: 1150, available: true, area: 850 }),
          unit("demo-u2", "2B", { beds: 2, baths: 1, rent: 1195, available: true, area: 850 }),
          unit("demo-u3", "3C", { beds: 2, baths: 1, rent: 1150, available: false, availableFrom: "2027-06-01", area: 850 }),
          unit("demo-u4", "4D", { beds: 4, baths: 2, rent: 2400, available: false, availableFrom: "2027-08-01", area: 1400 }),
        ],
      },
      {
        externalPropertyId: "demo-p2",
        name: "Pershing Commons (Demo)",
        address: "6308 Pershing Ave",
        city: "St. Louis",
        state: "MO",
        zip: "63130",
        units: [
          unit("demo-u5", "House", { beds: 3, baths: 2, rent: 2250, available: true, area: 1600 }),
        ],
      },
      {
        // Deliberately far from campus — demos the radius filter
        externalPropertyId: "demo-p3",
        name: "Downtown Lofts (Demo)",
        address: "1000 Market St",
        city: "St. Louis",
        state: "MO",
        zip: "63101",
        units: [
          unit("demo-u6", "12F", { beds: 1, baths: 1, rent: 1400, available: true, area: 700 }),
        ],
      },
    ],
    errors: [],
  };
}
