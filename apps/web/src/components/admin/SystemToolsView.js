"use client";

import { useState } from "react";
import { adminFetch } from "@/components/admin/adminShared";

/*
 * System > Tools: the maintenance jobs that used to sit in the header's Tools
 * popover. Each one runs against the database the dev/prod switch points at.
 */

function ToolCard({ title, body, button, runningLabel, confirmText, isProd, run }) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState(null);

  async function onClick() {
    if (isProd && !confirm(confirmText)) return;
    setRunning(true);
    setStatus(null);
    try {
      setStatus(await run());
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="mt-1 text-xs text-gray-500">{body}</p>
      <button
        type="button"
        onClick={onClick}
        disabled={running}
        className="mt-3 px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
      >
        {running ? runningLabel : button}
      </button>
      {status && <p className="mt-2 text-xs text-gray-600">{status}</p>}
    </div>
  );
}

export default function SystemToolsView({ dbTarget, isProd }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Tools</h2>
        <p className="text-sm text-gray-500">Maintenance jobs. Each runs on the {isProd ? "production" : "dev"} database.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <ToolCard
          title="Walk times"
          body="Recalculates the walk from every listing to each campus place and shuttle stop."
          button="Recalculate campus walk times"
          runningLabel="Updating…"
          confirmText={"Update walk times on PRODUCTION?\n\nThis recalculates walk times for all listings in the production database."}
          isProd={isProd}
          run={async () => {
            const data = await adminFetch("/api/admin/update-campus-walk-times", dbTarget, { method: "POST" });
            return `Updated ${data.updated}/${data.total} listings${data.failed ? ` (${data.failed} failed)` : ""}`;
          }}
        />
        <ToolCard
          title="Drive times"
          body="Fills in driving times for listings that do not have them yet."
          button="Backfill listing drive times"
          runningLabel="Updating…"
          confirmText={"Update drive times on PRODUCTION?\n\nThis recalculates driving times for all listings in the production database."}
          isProd={isProd}
          run={async () => {
            const data = await adminFetch("/api/admin/update-listing-drive-times", dbTarget, { method: "POST" });
            return `Updated ${data.updated}/${data.total ?? "?"} listings${data.skipped ? ` (${data.skipped} already complete)` : ""}${data.failed ? ` (${data.failed} failed)` : ""}`;
          }}
        />
      </div>
    </div>
  );
}
