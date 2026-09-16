"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import Image from "next/image";
import Link from "next/link";
import { PencilLine, Globe, Loader2, RefreshCw, Sparkles } from "lucide-react";
import AddListingWizard from "@/components/listings/wizard/AddListingWizard";
import AddListingFlow from "@/components/listings/add/AddListingFlow";

/*
 * Full-page "Add Listing" for landlords (and super).
 *
 * Two paths. Typing a listing in by hand goes through AddListingFlow, which
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
   * "manual" is the new flow, "assisted" the old wizard. `site` carries the
   * address typed on the fork so the import starts on arrival rather than
   * making them type it again.
   */
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode");
  const site = searchParams.get("site") ?? "";
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
          initialImportUrl={site}
          onClose={() => setMode(null)}
          onSuccess={() => {
            toast.success("Listing published!");
            router.push("/dashboard/landlord?tab=properties");
          }}
        />
      ) : (
        <StartChoice
          onManual={() => setMode("manual")}
          onImport={(address) =>
            router.push(
              `/add-listing?mode=assisted${
                address ? `&site=${encodeURIComponent(address)}` : ""
              }`
            )
          }
        />
      )}
    </div>
  );
}

const PMS_LOGOS = [
  { label: "Buildium", logo: "/pms-logos/buildium.png" },
  { label: "AppFolio", logo: "/pms-logos/appfolio.png" },
  { label: "DoorLoop", logo: "/pms-logos/doorloop.png" },
  { label: "Rentec Direct", logo: "/pms-logos/rentecdirect.png" },
];

/*
 * All three ways in, on the first screen, with the website box ready to type
 * into. It used to take three clicks to reach that box: pick "import" here,
 * pick "import" again inside the wizard, then open the box. A landlord who came
 * to paste their website address should be able to paste it.
 */
function StartChoice({ onManual, onImport }) {
  const [address, setAddress] = useState("");
  // The click navigates to the wizard, which has to compile and mount before it
  // can show its own progress. On a cold dev server that gap is seconds of a
  // button that looks like it did nothing.
  const [going, setGoing] = useState(false);
  const go = () => {
    const a = address.trim();
    if (!a || going) return;
    setGoing(true);
    onImport(a);
  };
  const card =
    "flex w-full items-start gap-4 rounded-xl border border-gray-200 bg-white p-4 text-left";
  const clickable =
    "group transition hover:border-red-400 hover:bg-red-50/50 cursor-pointer";

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold text-gray-900">List your place</h1>
      <p className="mb-6 mt-1 text-sm text-gray-500">
        Pick whichever is easiest. You review everything before it goes live.
      </p>

      <div className="space-y-3">
        {/* 1. The fast path, with the box right here. */}
        <div className={`${card} border-red-200 bg-white`}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
            <Globe className="h-5 w-5 text-red-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
              Import from your website
              <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                Fastest
              </span>
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              Paste your address below and we pull in your photos, units and details.
              You pick which properties to list.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                inputMode="url"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    go();
                  }
                }}
                placeholder="yourproperty.com"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                type="button"
                onClick={go}
                disabled={!address.trim() || going}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {going ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Opening…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" /> Find my properties
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 2. By hand. */}
        <button type="button" onClick={onManual} className={`${card} ${clickable}`}>
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

        {/* 3. PMS sync — straight to the integrations page, not via the wizard. */}
        <Link
          href="/dashboard/landlord?tab=integrations"
          className={`${card} ${clickable}`}
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
              Connect once. Your listings create and update themselves.
            </p>
          </div>
          <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-gray-300 group-hover:text-red-500" />
        </Link>

      </div>
    </div>
  );
}
