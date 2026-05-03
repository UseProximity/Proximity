"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import toast from "react-hot-toast";

//If landlordName is provided, it's a landlord review section
export default function ReviewsSection({
  reviews,
  session,
  landlordName = null,
  reviewedId,
}) {
  const [reviewText, setReviewText] = useState("");
  const [rating, setRating] = useState(0);
  const [loading, setLoading] = useState(false);

  // Handles submit of a new review
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    if (!session) {
      signIn(undefined, { callbackUrl: "/browse" });
      return;
    }

    if (!["student", "super"].includes(session.user.role)) {
      toast.error("Only students can leave reviews.");
      return;
    }

    if (reviewText.trim().length < 5 || rating < 1 || rating > 5) {
      toast.error(
        "Please write a valid review and select a rating between 1–5 stars."
      );
      return;
    }

    try {
      setLoading(true);

      const res = await fetch("/api/submitReview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating,
          comment: reviewText.trim(),
          reviewedUserId: landlordName ? reviewedId : null,
          listingId: landlordName ? null : reviewedId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error("Failed to submit review:", data.error);
        return;
      }
    } catch (error) {
      console.error("Failed to submit review:", error);
    } finally {
      setLoading(false);
      setReviewText("");
      setRating(0);
      setLoading(false);
    }
  };

  return (
    <>
      {/* Reviews */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-xl font-semibold mb-4">
          Reviews For {landlordName === null ? "The Property" : landlordName}
        </h2>

        {/*Case where there are no reviews yet*/}
        {reviews.filter((r) => r.legitimacy).length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-10 text-gray-500">
            <div className="mb-3 text-5xl">📝</div>
            <h3 className="text-lg font-semibold text-gray-700 mb-1">
              No Reviews Yet
            </h3>
            {landlordName === null ? (
              <p className="text-sm text-gray-500 max-w-md">
                This property hasn’t been reviewed by any students yet. Once
                someone has lived here, their feedback will appear below.
              </p>
            ) : (
              <p className="text-sm text-gray-500 max-w-md">
                This landlord hasn’t received any feedback from students yet.
                Once someone has rented from them, their review will appear
                below.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/*Case where there are reviews*/}
            {reviews
              .filter((r) => r.legitimacy)
              .map((review, index) => (
                <div key={index} className="border-b pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <img
                        src={
                          review.reviewer?.image &&
                          review.reviewer.image.trim() !== ""
                            ? review.reviewer.image
                            : "/default-icons/default-user.png"
                        }
                        alt={review.reviewer?.name || "Anonymous"}
                        className="w-8 h-8 rounded-full object-cover"
                      />
                      <span className="font-semibold text-gray-900">
                        {review.reviewer?.name || "Anonymous"}
                      </span>
                    </div>
                    <span className="text-yellow-500 text-sm sm:text-base">
                      {"★".repeat(review.rating)}
                      <span className="text-gray-300">
                        {"★".repeat(5 - review.rating)}
                      </span>
                    </span>
                  </div>
                  <p className="text-gray-700 mt-2 text-sm sm:text-base">
                    {review.comment}
                  </p>
                </div>
              ))}
          </div>
        )}
        {/* leave a review input area */}
        <form onSubmit={handleSubmit} className="mt-8 border-t pt-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-3">
            Share Your Experience
          </h3>

          {landlordName === null ? (
            <p className="text-sm text-gray-500 mb-4">
              Only students who have stayed here should leave a review.
            </p>
          ) : (
            <p className="text-sm text-gray-500 mb-4">
              Only students who have rented from {landlordName} should leave a
              review.
            </p>
          )}

          {/* Star Rating */}
          <div className="flex items-center mb-4 space-x-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                className={`text-2xl transition ${
                  star <= rating
                    ? "text-yellow-400"
                    : "text-gray-300 hover:text-yellow-300"
                }`}
                aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
              >
                ★
              </button>
            ))}
            <span className="ml-2 text-sm text-gray-500">
              {rating ? `${rating} / 5` : "Select a rating"}
            </span>
          </div>

          {/* Review Textarea */}
          <textarea
            id="review"
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value)}
            placeholder="Write your review..."
            className="w-full border border-gray-300 rounded-lg p-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 transition"
            rows={4}
            maxLength={1000}
            minLength={3}
          />

          <div className="flex justify-end mt-3">
            <button
              type="submit"
              disabled={
                !reviewText.trim() ||
                reviewText.trim().length < 5 ||
                rating === 0
              }
              className="bg-red-600 text-white text-sm font-medium px-5 py-2 rounded-lg shadow-md hover:bg-red-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Posting...</span>
                </span>
              ) : (
                "Post Review"
              )}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
