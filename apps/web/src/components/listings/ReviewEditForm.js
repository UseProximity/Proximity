"use client";

import { useState } from "react";
import StarRatingInput from "@/components/ui/StarRatingInput";
import { checkReviewText } from "@/lib/contentRules";

/*
 * In-place editor for a review (text + overall stars) or a landlord reply
 * (text only: leave initialRating undefined). Holds the same no-names rule as
 * the submit forms; the API checks it again.
 *
 * onSave({ text, rating }) resolves true when the save worked, which closes
 * the editor via the caller.
 */
export default function ReviewEditForm({
  initialText,
  initialRating,
  minLength = 1,
  onSave,
  onCancel,
}) {
  const withRating = initialRating !== undefined;
  const [text, setText] = useState(initialText || "");
  const [rating, setRating] = useState(initialRating || 0);
  const [saving, setSaving] = useState(false);

  const problem = checkReviewText(text);
  const tooShort = text.trim().length < minLength;
  const canSave = !saving && !problem && !tooShort && (!withRating || rating >= 0.5);

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({ text: text.trim(), rating });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 space-y-2">
      {withRating && (
        <StarRatingInput
          value={rating}
          onChange={setRating}
          px={18}
          color="red"
          showValue={false}
        />
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        aria-invalid={problem ? true : undefined}
        className="w-full resize-none rounded-lg border border-gray-200 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
      />
      {problem && <p className="text-sm text-red-600">{problem}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-full px-4 py-1.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="rounded-full bg-red-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
