"use client";

import { useState, useEffect } from "react";
import { Copy, Star, User } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { StarRating } from "@/components/ui/StarRating";
import ReviewReplySection from "@/components/listings/ReviewReplySection";

function InviteLinkCard({ userId }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);

  const link = origin && userId ? `${origin}/review-invite/${userId}` : "";

  function copy() {
    if (!link) return;
    navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card>
      <CardContent className="!p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Build trust with verified reviews
          </h3>
          <p className="mt-1.5 text-sm text-gray-600 leading-relaxed">
          Students rely on reviews when deciding who to contact. Share this link with past 
          tenants who are verified WashU students — they pick which property to 
          review and submit in under a minute.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            readOnly
            value={link}
            placeholder="Loading…"
            onFocus={(e) => e.target.select()}
            className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
          />
          <button
            type="button"
            onClick={copy}
            disabled={!link}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </CardContent>
    </Card>
  );
} 

export default function ReviewsSection({ user, viewAsId }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedListingId, setSelectedListingId] = useState("all");
  const [selectedRating, setSelectedRating] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const reviewsPerPage = 5;

  useEffect(() => {
    fetch(
      `/api/landlord/reviews${
        viewAsId ? `?viewAs=${encodeURIComponent(viewAsId)}` : ""
      }`
    )
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setReviews(data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filteredReviews = reviews.filter((r) => {
    const matchesListing =
      selectedListingId === "all" || r.listing?.id === selectedListingId;
    const matchesRating =
      selectedRating === "all" || r.rating === Number(selectedRating);
    return matchesListing && matchesRating;
  });

  const totalPages = Math.max(
    1,
    Math.ceil(filteredReviews.length / reviewsPerPage)
  );
  const paginatedReviews = filteredReviews.slice(
    (currentPage - 1) * reviewsPerPage,
    currentPage * reviewsPerPage
  );

  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : null;

  const ratingCounts = [5, 4, 3, 2, 1].map((s) => ({
    stars: s,
    count: reviews.filter((r) => r.rating === s).length,
  }));
  const maxCount = Math.max(...ratingCounts.map((r) => r.count), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reviews</h1>
        <p className="text-gray-500">Verified reviews from tenants</p>
      </div>

      <InviteLinkCard userId={user?.id} />

      {loading ? (
        <div className="flex items-center justify-center h-48 text-gray-400">
          Loading…
        </div>
      ) : reviews.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
          <Star className="h-8 w-8 text-gray-300" />
          <p className="text-gray-500 font-medium">No reviews yet</p>
          <p className="text-sm text-gray-400">
            Approved tenant reviews will appear here.
          </p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="flex flex-wrap gap-6 items-start">
            <div className="flex items-center gap-3">
              <Star className="h-6 w-6 text-yellow-400" />
              <span className="text-3xl font-bold">{avgRating}</span>
              <span className="text-sm text-gray-500">
                {reviews.length} review{reviews.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-end gap-2">
              {ratingCounts.map(({ stars, count }) => (
                <div key={stars} className="flex flex-col items-center gap-0.5">
                  <span className="text-xs text-gray-500">{count}</span>
                  <div
                    className="w-5 bg-red-500 rounded-t"
                    style={{
                      height: `${Math.max(4, (count / maxCount) * 48)}px`,
                    }}
                  />
                  <span className="text-xs text-gray-400">{stars}★</span>
                </div>
              ))}
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <select
              value={selectedListingId}
              onChange={(e) => {
                setSelectedListingId(e.target.value);
                setCurrentPage(1);
              }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All Properties</option>
              {(user?.listings || []).map((l) => (
                <option key={l._id || l.id} value={l._id || l.id}>
                  {l.title || l.address}
                </option>
              ))}
            </select>
            <select
              value={selectedRating}
              onChange={(e) => {
                setSelectedRating(e.target.value);
                setCurrentPage(1);
              }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All Ratings</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} Stars
                </option>
              ))}
            </select>
          </div>

          {/* List */}
          <Card>
            <CardContent className="p-6">
              {paginatedReviews.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">
                  No reviews match the selected filters.
                </p>
              ) : (
                <div className="space-y-6">
                  {paginatedReviews.map((review) => (
                    <div
                      key={review.id}
                      className="border-b border-gray-100 last:border-0 pb-6 pt-6 last:pb-0"
                    >
                      <div className="flex items-start gap-3">
                        {review.reviewer?.image ? (
                          <img
                            src={review.reviewer.image}
                            alt=""
                            className="h-9 w-9 rounded-full object-cover"
                          />
                        ) : (
                          <div className="h-9 w-9 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                            <User className="h-4 w-4 text-gray-500" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-sm">
                              {review.reviewer?.name || "Anonymous"}
                            </span>
                            <StarRating rating={review.rating} />
                            <span className="text-xs text-gray-400">
                              {new Date(review.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          {review.listing && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              {review.listing.title || review.listing.address}
                            </p>
                          )}
                          {review.comment && (
                            <p className="text-sm text-gray-700 mt-2">
                              {review.comment}
                            </p>
                          )}
                          {/* Landlord Reply */}
                          <ReviewReplySection
                            review={review}
                            owner={user}
                            isLandlord={true}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <button
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 text-sm border rounded-lg disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() =>
                  setCurrentPage((p) => Math.min(p + 1, totalPages))
                }
                disabled={currentPage === totalPages}
                className="px-4 py-2 text-sm border rounded-lg disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
