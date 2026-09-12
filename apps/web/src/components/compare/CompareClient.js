"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { ArrowLeft, Share2, Check, Footprints, CircleDollarSign } from "lucide-react";
import toast from "react-hot-toast";
import { useCompare, compareItem } from "@/context/CompareContext";
import { buildRows, compareHref, displayName, headlineDeltas, resolveSide } from "@/lib/compare/model";
import { trackEvent } from "@/utils/analytics";
import PropertyCard from "./PropertyCard";
import QuickFacts from "./QuickFacts";
import DetailsList from "./DetailsList";
import PropertyPicker from "./PropertyPicker";
import ReplaceChooser from "./ReplaceChooser";

const SIDE_KEYS = [
  { unit: "au", lease: "al" },
  { unit: "bu", lease: "bl" },
];

export default function CompareClient({ sides, addCandidate, picker, requested, initial }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { setItems, setOpening } = useCompare();
  const ids = sides.map((s) => s?._id ?? null);
  // Which slots were filled when the page opened: those animate in together on
  // landing; anything added later animates in on its own.
  const [landed] = useState(() => ids.map(Boolean));

  const [basis, setBasis] = useState(initial.basis);
  const [choice, setChoice] = useState({
    0: { unit: initial.au, lease: initial.al },
    1: { unit: initial.bu, lease: initial.bl },
  });
  const [pickerFor, setPickerFor] = useState(null);
  const [copied, setCopied] = useState(false);

  // Keep the Compare pills elsewhere in the app in step with this page.
  useEffect(() => {
    setItems(sides.filter(Boolean).map(compareItem));
    setOpening(false);
  }, [ids[0], ids[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  // A requested id that did not resolve was hidden, removed or malformed.
  useEffect(() => {
    const dropped = ["a", "b"].filter((k) => requested[k] && !sides[k === "a" ? 0 : 1]);
    if (dropped.length) toast("That listing isn't available any more. Pick another.");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resolved = useMemo(
    () => sides.map((listing, i) => (listing ? resolveSide(listing, choice[i].unit, choice[i].lease) : null)),
    [sides, choice]
  );

  // Unit, offer and basis live in the URL too, so a copied link shows the same
  // thing. replaceState keeps it out of the history stack and off the server.
  useEffect(() => {
    const extra = { basis: basis === "unit" ? "unit" : null, add: addCandidate?._id ?? null };
    resolved.forEach((side, i) => {
      if (!side) return;
      extra[SIDE_KEYS[i].unit] = side.unit?.id ?? null;
      extra[SIDE_KEYS[i].lease] = side.lease?.id ?? null;
    });
    window.history.replaceState(window.history.state, "", compareHref(ids, extra));
  }, [resolved, basis, ids[0], ids[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  const names = resolved.map((s) => (s ? displayName(s.listing) : null));
  const sections = useMemo(() => buildRows(resolved, basis), [resolved, basis]);
  const deltas = useMemo(() => headlineDeltas(resolved, basis), [resolved, basis]);
  const both = resolved.every(Boolean);

  // Slot changes go through the server (new listing data), which remounts this
  // component, so the basis and the untouched side's unit/offer ride along in
  // the URL and come back through `initial`.
  const navigate = (nextIds, extra = {}) => {
    const carried = { basis: basis === "unit" ? "unit" : null, ...extra };
    nextIds.forEach((id, i) => {
      const prev = ids.indexOf(id);
      if (id && prev >= 0 && resolved[prev]) {
        carried[SIDE_KEYS[i].unit] = resolved[prev].unit?.id ?? null;
        carried[SIDE_KEYS[i].lease] = resolved[prev].lease?.id ?? null;
      }
    });
    startTransition(() => router.push(compareHref(nextIds, carried)));
  };

  const choose = (slot, listingId) => {
    const next = [...ids];
    next[slot] = listingId;
    setChoice((c) => ({ ...c, [slot]: { unit: null, lease: null } }));
    setPickerFor(null);
    trackEvent("Compare Slot Filled", { listingId, slot: slot + 1 });
    navigate(next);
  };

  /*
   * Share = send this exact comparison to a roommate. The URL carries both
   * listings, the chosen units and the rent basis, so they open the same view.
   * Phones get the native share sheet (Messages, WhatsApp...); desktops copy
   * the link.
   */
  const share = async () => {
    const url = window.location.href;
    const title = names.every(Boolean) ? `${names[0]} vs ${names[1]}` : "Apartment comparison";
    trackEvent("Compare Shared", { listings: ids.filter(Boolean) });
    if (navigator.share) {
      try {
        await navigator.share({ title, text: `${title} on Proximity`, url });
        return;
      } catch {
        // dismissed the sheet; fall through to copying
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied. Send it to a roommate.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Copy the address bar to share this comparison.");
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 sm:px-6 lg:px-8" aria-busy={pending}>
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/browse"
            className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to listings
          </Link>
          <button
            type="button"
            onClick={share}
            disabled={!ids[0]}
            className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 disabled:opacity-40"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Share2 className="h-4 w-4" />}
            {copied ? "Link copied" : "Share with a roommate"}
          </button>
        </div>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">Side by side.</h1>
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-medium text-gray-500">Show rent</span>
            <div role="group" aria-label="Show rent" className="inline-flex rounded-full border border-gray-200 bg-gray-50 p-0.5">
              {[
                ["person", "Per person"],
                ["unit", "Whole apartment"],
              ].map(([key, text]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setBasis(key)}
                  aria-pressed={basis === key}
                  className={`h-7 rounded-full px-3 text-xs font-medium transition-colors ${
                    basis === key ? "bg-white text-gray-900 shadow-sm ring-1 ring-black/5" : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Cards with the quick-facts spine between them */}
        <div
          className={`mt-8 grid grid-cols-2 items-stretch gap-3 md:grid-cols-[1fr_230px_1fr] md:gap-0 lg:grid-cols-[1fr_280px_1fr] xl:grid-cols-[1fr_320px_1fr] ${
            pending ? "opacity-70 transition-opacity" : ""
          }`}
        >
          {[0, 1].map((slot) => (
            <div key={slot} className={slot === 1 ? "col-start-2 min-w-0 md:col-start-3" : "min-w-0"}>
              <AnimatePresence mode="wait">
                <PropertyCard
                  key={ids[slot] ?? `empty-${slot}`}
                  side={resolved[slot]}
                  slot={slot}
                  basis={basis}
                  delay={landed[slot] || !ids[slot] ? slot * 0.35 : 0}
                  onPick={() => setPickerFor(slot)}
                  onUnit={(unitId) => setChoice((c) => ({ ...c, [slot]: { unit: unitId, lease: null } }))}
                  onLease={(leaseId) => setChoice((c) => ({ ...c, [slot]: { ...c[slot], lease: leaseId } }))}
                />
              </AnimatePresence>
            </div>
          ))}
          <QuickFacts sides={resolved} basis={basis} delay={0.75} />
        </div>

        {/* The two tradeoffs that decide most searches */}
        {both ? (
          <motion.div
            key={`${ids[0]}-${ids[1]}-${basis}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: landed.every(Boolean) ? 1.0 : 0.1 }}
            className="mt-10 grid gap-6 rounded-2xl bg-white p-6 shadow-[0_18px_48px_-24px_rgba(15,23,42,0.3)] ring-1 ring-black/5 sm:grid-cols-2 sm:gap-8 sm:p-7"
          >
            <Tradeoff icon={CircleDollarSign} delta={deltas.rent} fallback="Add rent to compare cost." />
            <Tradeoff icon={Footprints} delta={deltas.walk} fallback="Walk times aren't available for both." />
          </motion.div>
        ) : (
          <p className="mt-10 rounded-2xl bg-gray-50 p-6 text-center text-sm text-gray-500">
            Add a second apartment to see the tradeoffs.
          </p>
        )}

        <DetailsList sections={sections} names={names} both={both} basis={basis} />
      </main>

      <PropertyPicker
        open={pickerFor !== null}
        slot={pickerFor}
        items={picker}
        currentId={pickerFor !== null ? ids[pickerFor] : null}
        otherId={pickerFor !== null ? ids[1 - pickerFor] : null}
        onChoose={(listingId) => choose(pickerFor, listingId)}
        onClose={() => setPickerFor(null)}
      />

      {addCandidate && (
        <ReplaceChooser
          candidate={addCandidate}
          names={names}
          onReplace={(slot) => choose(slot, addCandidate._id)}
          onCancel={() => navigate(ids)}
        />
      )}
    </MotionConfig>
  );
}

function Tradeoff({ icon: Icon, delta, fallback }) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50 ring-1 ring-red-100">
        <Icon className="h-5 w-5 text-red-600" strokeWidth={2} />
      </span>
      {delta ? (
        <>
          <p className="text-base font-semibold text-gray-900">{delta.text}</p>
          <p className="mt-0.5 text-sm text-gray-500">{delta.sub}</p>
        </>
      ) : (
        <p className="text-sm text-gray-500">{fallback}</p>
      )}
    </div>
  );
}
