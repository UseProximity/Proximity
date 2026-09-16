"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Globe, PencilLine, RefreshCw } from "lucide-react";
import ListingDraftImport from "@/components/listings/ListingDraftImport";

const PMS_LOGOS = [
  { label: "Buildium", logo: "/pms-logos/buildium.png" },
  { label: "AppFolio", logo: "/pms-logos/appfolio.png" },
  { label: "DoorLoop", logo: "/pms-logos/doorloop.png" },
  { label: "Rentec Direct", logo: "/pms-logos/rentecdirect.png" },
];

/*
 * The fork in the road: import from a website, sync a PMS, or type it in.
 * One decision, three big targets, no form fields in sight yet.
 */
/*
 * `showScratch` is false when the caller already offered "type it in" — the
 * add-listing page forks before mounting this, so repeating the option here
 * would send a landlord who chose Import back to the manual path they just
 * declined.
 */
export default function StepStart({ w, onBegin, showScratch = true }) {
  const [showImport, setShowImport] = useState(false);

  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight text-gray-900">
        Add your listings
      </h2>

      {showImport ? (
        <div className="mt-5">
          <ListingDraftImport embedded onApply={w.applyDraft} />
          <button
            type="button"
            onClick={() => setShowImport(false)}
            className="mt-3 text-xs text-gray-500 hover:text-gray-700"
          >
            ← Other options
          </button>
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="group flex items-center gap-4 rounded-xl border border-gray-200 p-4 text-left transition-colors hover:border-red-400 hover:bg-red-50/50"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
              <Globe className="h-5 w-5 text-red-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                Import from your website
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  Fastest
                </span>
              </p>
              <p className="text-xs text-gray-500">
                Your photos, units, and details, pulled in automatically. Ready
                to review in about a minute.
              </p>
            </div>
          </button>

          <Link
            href="/dashboard/landlord?tab=integrations"
            className="group flex items-center gap-4 rounded-xl border border-gray-200 p-4 text-left transition-colors hover:border-red-400 hover:bg-red-50/50"
          >
            <div className="flex shrink-0 -space-x-2">
              {PMS_LOGOS.map((p) => (
                <Image
                  key={p.label}
                  src={p.logo}
                  alt={p.label}
                  title={p.label}
                  width={56}
                  height={56}
                  className="h-8 w-8 rounded-full border border-gray-200 bg-white object-contain p-1 shadow-sm"
                />
              ))}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">
                I use Buildium, AppFolio, DoorLoop, or Rentec
              </p>
              <p className="text-xs text-gray-500">
                Connect once. Listings create and update themselves.
              </p>
            </div>
            <RefreshCw className="ml-auto h-4 w-4 shrink-0 text-gray-300 group-hover:text-red-500" />
          </Link>

          {showScratch && (
          <button
            type="button"
            onClick={onBegin}
            className="group flex items-center gap-4 rounded-xl border border-gray-200 p-4 text-left transition-colors hover:border-red-400 hover:bg-red-50/50"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100">
              <PencilLine className="h-5 w-5 text-gray-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">Start from scratch</p>
              <p className="text-xs text-gray-500">
                A few quick questions. About 4 minutes.
              </p>
            </div>
          </button>
          )}
        </div>
      )}
    </div>
  );
}
