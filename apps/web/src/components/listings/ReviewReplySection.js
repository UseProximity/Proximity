"use client";

import { useState } from "react";
import { toast } from "react-hot-toast";

export default function ReviewReplySection({ review, owner, isLandlord }) {
  const [replyTexts, setReplyTexts] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reviewId = review.id || review._id; // Support both review.id and review._id for flexibility

  async function handleReplySubmit(reviewId) {
    const reply = replyTexts[reviewId];

    if (!reply?.trim()) return;

    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      console.log("Review:", review);
      console.log("Submitting reply", { reviewId, reply });
      const res = await fetch("/api/replyReview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reviewId,
          reply,
        }),
      });

      if (!res.ok) {
        toast.error("Failed to post reply");
        return;
      }

      toast.success("Reply posted!");

      window.location.reload();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      {review.landlordReply && (
        <div className="mt-4 pl-10 border-l-2 border-gray-200">
          <div className="flex items-center gap-2">
            <img
              src={
                owner.image?.trim()
                  ? owner.image
                  : "/default-icons/default-user.png"
              }
              alt={owner.name}
              className="w-8 h-8 rounded-full object-cover"
            />
            <div>
              <span className="font-medium text-sm text-gray-900">
                {owner.name ? `${owner.name} (Landlord)` : "(Landlord)"}
              </span>
              <div className="text-xs text-gray-400">
                {new Date(
                  review.landlordReply.updatedAt ||
                    review.landlordReply.createdAt
                ).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </div>
            </div>
          </div>
          <p className="text-sm text-gray-600 mt-1">
            {review.landlordReply.reply}
          </p>
        </div>
      )}
      {isLandlord && !review.landlordReply && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <textarea
            value={replyTexts[reviewId] || ""}
            onChange={(e) =>
              setReplyTexts((prev) => ({
                ...prev,
                [reviewId]: e.target.value,
              }))
            }
            placeholder="Reply to this review..."
            rows={3}
            className="w-full border border-gray-200 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
          />

          <div className="flex justify-end mt-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleReplySubmit(reviewId)}
              className="bg-red-600 text-white text-xs font-medium px-4 py-2 rounded-full hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting && (
                <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}

              {isSubmitting ? "Posting..." : "Reply"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
