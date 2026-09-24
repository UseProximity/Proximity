"use client";

import ListingDraftImport from "@/components/listings/ListingDraftImport";

/*
 * The import screen: just the website box, open and ready.
 *
 * It used to repeat the other ways in underneath ("type it in", "connect your
 * property manager"), which made sense when this was the first screen a
 * landlord saw. It isn't any more — the add-listing page offers all three up
 * front — so re-listing them here only asked someone to make a choice they had
 * already made. Backing out is the wizard's own Cancel.
 *
 * `initialImportUrl` carries the address typed on that first screen so the read
 * starts on arrival instead of asking for it twice.
 */
export default function StepStart({ w, initialImportUrl = "" }) {
  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight text-gray-900">
        Add your listings
      </h2>
      <p className="mt-1 text-sm text-gray-500">
        Paste your website and we will fill what we can. You review everything first.
      </p>

      <div className="mt-5">
        <ListingDraftImport
          embedded
          onApply={w.applyDraft}
          onImportMany={w.onImportMany}
          initialUrl={initialImportUrl}
        />
      </div>
    </div>
  );
}
