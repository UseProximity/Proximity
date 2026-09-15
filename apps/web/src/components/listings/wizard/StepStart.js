"use client";

import Link from "next/link";
import Image from "next/image";
import { PencilLine, RefreshCw } from "lucide-react";
import ListingDraftImport from "@/components/listings/ListingDraftImport";

const PMS_LOGOS = [
  { label: "Buildium", logo: "/pms-logos/buildium.png" },
  { label: "AppFolio", logo: "/pms-logos/appfolio.png" },
  { label: "DoorLoop", logo: "/pms-logos/doorloop.png" },
  { label: "Rentec Direct", logo: "/pms-logos/rentecdirect.png" },
];

/*
 * The import screen: the website box is open and ready, with the other ways in
 * underneath it. It used to hide the box behind a card you had to click first,
 * which meant three clicks from "Add listing" to somewhere you could type.
 *
 * `showScratch` is false when the caller already offered "type it in" — the
 * add-listing page forks before mounting this, so repeating the option here
 * would send a landlord who chose Import back to the path they just declined.
 * `initialImportUrl` carries an address typed on that fork so the read starts
 * on arrival instead of asking for it twice.
 */
export default function StepStart({ w, onBegin, showScratch = true, initialImportUrl = "" }) {
  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight text-gray-900">
        Add your listings
      </h2>
      <p className="mt-1 text-sm text-gray-500">
        Paste your website and we do the typing. You review everything first.
      </p>

      <div className="mt-5">
        <ListingDraftImport
          embedded
          onApply={w.applyDraft}
          initialUrl={initialImportUrl}
        />
      </div>

      <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-400">
        Other ways to add
      </p>

      <div className="mt-2 grid gap-3">
        <Link
          href="/dashboard/landlord?tab=integrations"
          className="group flex items-start gap-4 rounded-xl border border-gray-200 p-4 text-left transition-colors hover:border-red-400 hover:bg-red-50/50"
        >
          <div className="flex shrink-0 -space-x-2 pt-0.5">
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
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
              I use Buildium, AppFolio, DoorLoop or Rentec
              <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                Beta
              </span>
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              Connect once. Listings create and update themselves.
            </p>
          </div>
          <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-gray-300 group-hover:text-red-500" />
        </Link>

        {showScratch && (
          <button
            type="button"
            onClick={onBegin}
            className="group flex items-start gap-4 rounded-xl border border-gray-200 p-4 text-left transition-colors hover:border-red-400 hover:bg-red-50/50"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100">
              <PencilLine className="h-5 w-5 text-gray-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">Type it in myself</p>
              <p className="mt-0.5 text-xs text-gray-500">
                A few quick questions. About 4 minutes.
              </p>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}
