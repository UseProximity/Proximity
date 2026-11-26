"use client";

/*
 * Shared half-star rating input. Used by every review-submission surface:
 *   - /review and /refer/<id>            (ReviewSubmitForm)
 *   - /review-invite/<landlordId>        (ReviewInviteClient)
 *   - the listing detail modal           (ListingModalInfo)
 *   - the landlord public page           (listings/ReviewsSection)
 *
 * Each star is split into two click targets: the left half sets x.5, the right half
 * sets x.0. Hovering previews exactly what a click will select, so the fill you see
 * is always the value you'd get. Ratings are stored as numeric in Postgres, so the
 * .5 values persist as-is.
 */

import { useState } from "react";

// Fill colors per surface — the review pages use yellow, the listing modal uses red.
const COLORS = {
  yellow: "text-yellow-400",
  red: "text-red-500",
};

export default function StarRatingInput({
  value = 0,
  onChange,
  px = 30,
  color = "yellow",
  readOnly = false,
  allowClear = false,
  showValue = true,
  ariaLabelPrefix = "Rate",
}) {
  const [hover, setHover] = useState(0);

  // While hovering, the stars show the value a click would set — not the stored one.
  const shown = hover || value;
  const fillClass = COLORS[color] || COLORS.yellow;

  function select(next) {
    if (readOnly) return;
    // Optional ratings can be cleared by re-picking the value already set.
    onChange?.(allowClear && next === value ? 0 : next);
  }

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex gap-1"
        onMouseLeave={() => setHover(0)}
        role="radiogroup"
        aria-label={ariaLabelPrefix}
      >
        {[1, 2, 3, 4, 5].map((i) => {
          const fill = Math.max(0, Math.min(1, shown - (i - 1)));
          return (
            <div key={i} className="relative" style={{ width: px, height: px }}>
              <span
                className="absolute inset-0 text-gray-300 leading-none select-none"
                style={{ fontSize: px, lineHeight: 1 }}
              >
                ★
              </span>
              <span
                className={`absolute inset-0 overflow-hidden leading-none select-none ${fillClass}`}
                style={{ width: `${fill * 100}%`, fontSize: px, lineHeight: 1 }}
              >
                ★
              </span>
              {!readOnly && (
                <>
                  <button
                    type="button"
                    aria-label={`${ariaLabelPrefix} ${i - 0.5} stars`}
                    onClick={() => select(i - 0.5)}
                    onMouseEnter={() => setHover(i - 0.5)}
                    onFocus={() => setHover(i - 0.5)}
                    onBlur={() => setHover(0)}
                    className="absolute inset-y-0 left-0 w-1/2 cursor-pointer"
                  />
                  <button
                    type="button"
                    aria-label={`${ariaLabelPrefix} ${i} star${i > 1 ? "s" : ""}`}
                    onClick={() => select(i)}
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(0)}
                    className="absolute inset-y-0 right-0 w-1/2 cursor-pointer"
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
      {showValue && !readOnly && (
        <span className="text-sm text-gray-400 w-8">
          {shown ? shown.toFixed(1) : ""}
        </span>
      )}
    </div>
  );
}
