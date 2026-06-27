"use client";

export default function NotificationSection({
  pendingReviews = [],
  onApprove,
  onReject,
  loadingMap = {},
}) {
  if (!pendingReviews || pendingReviews.length === 0) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-md text-center">
        <div className="text-3xl mb-2">🔔</div>
        <h3 className="text-lg font-semibold mb-1">No pending reviews</h3>
        <p className="text-sm text-gray-500">
          When a student leaves a review for you or one of your listings, it
          will appear here for approval.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Pending Reviews</h2>

      <div className="divide-y rounded-lg overflow-hidden bg-white border border-gray-100 shadow-sm">
        {pendingReviews.map((r) => {
          const id = r._id || r.id;
          const reviewerName = r.reviewer?.name || r.name || "Anonymous";
          const reviewerImage = r.reviewer?.image?.trim?.()
            ? r.reviewer.image
            : "/default-icons/default-user.png";
          const isListing = !!r.listing;
          const targetText = isListing
            ? r.listing?.address || "A listing"
            : "Your landlord profile";
          const loading = !!loadingMap[id];

          return (
            <div
              key={id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <img
                  src={reviewerImage}
                  alt={reviewerName}
                  onError={(e) =>
                    (e.currentTarget.src = "/default-icons/default-user.png")
                  }
                  className="w-10 h-10 rounded-full object-cover border"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">
                      {reviewerName}
                    </span>
                    <span className="text-xs text-gray-500">
                      left a review for
                    </span>
                    <span className="text-sm font-medium text-gray-700">
                      {targetText}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    onApprove?.(id, isListing ? "listing" : "user")
                  }
                  disabled={loading}
                  className="px-3 py-1.5 rounded-md bg-green-600 text-white text-sm hover:bg-green-700 disabled:opacity-60"
                >
                  {loading ? "..." : "Accept"}
                </button>

                <button
                  onClick={() => onReject?.(id, isListing ? "listing" : "user")}
                  disabled={loading}
                  className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  {loading ? "..." : "Decline"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
