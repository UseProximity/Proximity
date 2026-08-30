"use client";

/*
 * Shared chrome for the review flow's two branches (off-campus property,
 * on-campus dorm). Both use the same progressive-disclosure step pattern, so
 * the step header, the field styling and the half-star sub-rating row live here
 * rather than being reimplemented per branch.
 */

import { motion } from "framer-motion";
import StarRatingInput from "@/components/ui/StarRatingInput";

export const INPUT_CLASS =
  "w-full px-3 py-2.5 text-[15px] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400";

/*
 * Bottom breathing room. Mobile browsers put a URL bar and a toolbar over the
 * viewport, and the last thing on this page is the submit button. Without this
 * the button sits under the chrome and the form looks broken rather than
 * finished. pb-32 clears both, and safe-area padding handles the iPhone notch
 * generation.
 */
export const PAGE_BOTTOM_PADDING = "pb-32 sm:pb-40 [padding-bottom:calc(8rem+env(safe-area-inset-bottom))]";

/*
 * One revealed step. Steps render only once the previous one is answered, so the
 * page starts as a single question and grows as it's filled in. Earlier steps
 * stay on screen and editable: this is progressive disclosure, not a wizard you
 * can't go back in.
 */
export function Step({ show, number, title, children }) {
  if (!show) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="border-t border-gray-100 pt-5 first:border-t-0 first:pt-0"
    >
      <div className="flex items-center gap-2 mb-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-50 text-xs font-semibold text-red-600">
          {number}
        </span>
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      </div>
      {children}
    </motion.div>
  );
}

export function SubRating({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-gray-700">
        {label} <span className="text-red-500">*</span>
      </span>
      <StarRatingInput
        value={value}
        onChange={onChange}
        px={22}
        ariaLabelPrefix={`Rate ${label}`}
      />
    </div>
  );
}
