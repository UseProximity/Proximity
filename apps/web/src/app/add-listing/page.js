"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { PencilLine, Globe } from "lucide-react";
import AddListingWizard from "@/components/listings/wizard/AddListingWizard";
import AddListingFlow from "@/components/listings/add/AddListingFlow";

/*
 * Full-page "Add Listing" for landlords (and super).
 *
 * Two paths now. Typing a listing in by hand goes through AddListingFlow, which
 * asks the address first and only asks for what that answer doesn't already
 * tell us — so adding one apartment to a building already on the site skips
 * re-describing the building.
 *
 * Importing from a website or a PMS still runs the old wizard: those arrive
 * with a whole property's worth of fields already filled and need the review
 * steps that go with them.
 *
 * Role gating lives in layout.js.
 */
export default function AddListingPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  // The form prefills contact fields from `user` on its first render, so wait
  // for the profile fetch to settle before mounting it.
  const [ready, setReady] = useState(false);
  /*
   * Which path they picked lives in the URL rather than in state, so Back from
   * the flow lands on the fork instead of leaving the page entirely.
   * "manual" is the new flow, "assisted" the old wizard.
   */
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode");
  const setMode = (m) => router.push(m ? `/add-listing?mode=${m}` : "/add-listing");

  useEffect(() => {
    fetch("/api/getUser")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setUser(data))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 py-4">
      {!ready ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-gray-200 border-t-red-500 rounded-full animate-spin" />
        </div>
      ) : mode === "manual" ? (
        <AddListingFlow user={user} />
      ) : mode === "assisted" ? (
        <AddListingWizard
          user={user}
          onClose={() => setMode(null)}
          onSuccess={() => {
            toast.success("Listing published!");
            router.push("/dashboard/landlord?tab=properties");
          }}
        />
      ) : (
        <StartChoice onPick={setMode} />
      )}
    </div>
  );
}

/*
 * The fork, lifted out of the wizard's own first step so the manual path never
 * mounts the wizard at all.
 */
function StartChoice({ onPick }) {
  const card =
    "group flex w-full items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-red-400 hover:bg-red-50/50";
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold text-gray-900">List your place</h1>
      <p className="mb-6 mt-1 text-sm text-gray-500">How would you like to start?</p>
      <div className="space-y-3">
        <button type="button" className={card} onClick={() => onPick("manual")}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100">
            <PencilLine className="h-5 w-5 text-gray-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">Type it in</p>
            <p className="text-xs text-gray-500">
              Enter property/lease information manually.
            </p>
          </div>
        </button>
        <button type="button" className={card} onClick={() => onPick("assisted")}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100">
            <Globe className="h-5 w-5 text-gray-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">Import from a website or your PMS</p>
            <p className="text-xs text-gray-500">
              We&apos;ll pull the details in and you review them.
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}
