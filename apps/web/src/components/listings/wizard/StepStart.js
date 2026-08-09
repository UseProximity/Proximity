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
export default function StepStart({ w, onBegin }) {
  const [showImport, setShowImport] = useState(false);

  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight text-gray-900">
        Add your listing
      </h2>
      <p className="mt-1.5 text-sm text-gray-500">
        Pick the fastest way in. You can review everything before it goes live.
      </p>

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
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">
                I have a website — fill it out for me
              </p>
              <p className="text-xs text-gray-500">
                Paste your property site. We pre-fill the details and photos.
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
        </div>
      )}
    </div>
  );
}
