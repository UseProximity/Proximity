"use client";

import Link from "next/link";

const INTENTION_COLORS = {
  "Best overall match": "bg-red-100 text-red-700",
  "Closest to campus": "bg-blue-100 text-blue-700",
  "Best value": "bg-green-100 text-green-700",
  "Best reviews": "bg-yellow-100 text-yellow-700",
  "Most amenities": "bg-purple-100 text-purple-700",
  "Most flexible lease": "bg-orange-100 text-orange-700",
  "Best social fit": "bg-pink-100 text-pink-700",
};

function AmenityPill({ label }) {
  return (
    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">
      {label}
    </span>
  );
}

function RecommendationCard({ rec, rank }) {
  const { listing_id, intention, reason, card_data } = rec;
  const intentionClass =
    INTENTION_COLORS[intention] ?? "bg-gray-100 text-gray-700";

  return (
    <Link
      href={`/listings/${listing_id}`}
      className="block bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-md transition-shadow"
    >
      {card_data?.hero_image_url ? (
        <div className="h-40 bg-gray-100 overflow-hidden">
          <img
            src={card_data.hero_image_url}
            alt={card_data.title ?? "Listing"}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="h-40 bg-gray-100 flex items-center justify-center">
          <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
          </svg>
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${intentionClass}`}>
            {rank === 0 ? "★ " : ""}{intention}
          </span>
          {card_data?.min_rent && (
            <span className="text-sm font-bold text-gray-900 flex-shrink-0">
              ${card_data.min_rent.toLocaleString()}/mo
            </span>
          )}
        </div>

        <p className="text-sm font-semibold text-gray-900 line-clamp-1">
          {card_data?.title ?? "Listing"}
        </p>
        <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{card_data?.address}</p>

        {card_data?.top_amenities?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {card_data.top_amenities.map((a) => (
              <AmenityPill key={a} label={a} />
            ))}
          </div>
        )}

        {reason && (
          <p className="text-xs text-gray-500 mt-2 italic line-clamp-2">&ldquo;{reason}&rdquo;</p>
        )}
      </div>
    </Link>
  );
}

export default function RecommendationCards({ recommendations }) {
  if (!recommendations?.length) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-900">Your top matches</h2>
      {recommendations.map((rec, i) => (
        <RecommendationCard key={rec.listing_id} rec={rec} rank={i} />
      ))}
    </div>
  );
}
