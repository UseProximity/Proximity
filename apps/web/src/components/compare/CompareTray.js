"use client";

/*
 * The shortlist bar that appears once a student picks a listing to compare.
 * Says what happens next, opens the comparison, or clears the picks. Hidden
 * on the /compare page itself, where the cards already show the same state.
 */

import { useState } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Loader2, Plus, X } from "lucide-react";
import { useCompare } from "@/context/CompareContext";
import { compareHref } from "@/lib/compare/model";

export default function CompareTray() {
  const { items, ids, clear } = useCompare();
  const pathname = usePathname();
  const router = useRouter();
  const [opening, setOpening] = useState(false);

  const show = items.length > 0 && pathname !== "/compare";
  const ready = items.length === 2;
  // Browse on a phone has its own map/list bar along the bottom.
  const lift = pathname === "/browse" ? "bottom-[76px] md:bottom-6" : "bottom-4 md:bottom-6";

  const openCompare = () => {
    setOpening(true);
    router.push(compareHref(ids));
    setTimeout(() => setOpening(false), 4000);
  };

  return (
    <AnimatePresence>
      {show && (
        <div className={`pointer-events-none fixed left-0 right-0 z-40 flex justify-center px-4 ${lift}`}>
        <motion.div
          key="tray"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98, transition: { duration: 0.16 } }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          role="status"
          aria-live="polite"
          className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-full bg-gray-900 p-2 pl-2.5 text-white shadow-2xl"
        >
          <div className="flex items-center -space-x-2">
            {[0, 1].map((i) => {
              const it = items[i];
              return it ? (
                <span
                  key={it.id}
                  className="relative h-10 w-10 overflow-hidden rounded-full border-2 border-gray-900 bg-gray-700"
                  title={it.name}
                >
                  {it.image && <Image src={it.image} alt="" fill sizes="40px" className="object-cover" />}
                </span>
              ) : (
                <span
                  key={`empty-${i}`}
                  className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-gray-500 bg-gray-900 text-gray-400"
                >
                  <Plus className="h-4 w-4" />
                </span>
              );
            })}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold">{ready ? "Ready to compare" : items[0].name}</p>
            <p className="truncate text-xs text-gray-400">{ready ? `${items[0].name} vs ${items[1].name}` : "Pick one more, or compare now"}</p>
          </div>
          <button
            type="button"
            onClick={openCompare}
            disabled={opening}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-70"
          >
            {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {opening ? "Opening" : "Compare"}
            {!opening && <ArrowRight className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={clear}
            aria-label="Clear comparison picks"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
