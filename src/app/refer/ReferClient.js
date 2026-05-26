"use client";

/*
 * CopyLinkBox: shows the ambassador's shareable /refer/<userId> link + copy button.
 * The absolute URL is built from window.location.origin so it's correct in dev & prod.
 */

import { useState, useEffect } from "react";

export function CopyLinkBox({ userId }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);

  const link = origin ? `${origin}/refer/${userId}` : "";

  function copy() {
    if (!link) return;
    navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <label className="block text-sm font-semibold text-gray-800 mb-1.5">
        Your referral link
      </label>
      <div className="flex gap-2">
        <input
          readOnly
          value={link}
          placeholder="Loading…"
          onFocus={(e) => e.target.select()}
          className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50 text-gray-700"
        />
        <button
          onClick={copy}
          disabled={!link}
          className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold whitespace-nowrap disabled:opacity-50"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        Share this with students who’ve lived somewhere — every review they submit through
        it is credited to you.
      </p>
    </div>
  );
}
