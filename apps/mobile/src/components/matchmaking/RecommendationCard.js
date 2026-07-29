// Renders one matchmaking recommendation: an "intention" pill, the shared
// ListingCard (fetched in full — the chat response only carries a slim
// card_data preview + listing_id, same as web's RecommendationCards.js), and
// the one-line reason. Tapping the card navigates to the listing detail
// screen via ListingCard's own built-in router.push.
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import apiClient from "../../lib/apiClient";
import { ListingCard } from "../listings/ListingCard";

// Full class strings (not interpolated) — NativeWind, like Tailwind, only
// picks up class names it can see literally in source.
const INTENTION_COLORS = {
  "Best overall match": { bg: "bg-red-100", text: "text-red-700" },
  "Closest to campus": { bg: "bg-blue-100", text: "text-blue-700" },
  "Best value": { bg: "bg-green-100", text: "text-green-700" },
  "Best reviews": { bg: "bg-yellow-100", text: "text-yellow-700" },
  "Most amenities": { bg: "bg-purple-100", text: "text-purple-700" },
  "Most flexible lease": { bg: "bg-orange-100", text: "text-orange-700" },
  "Best social fit": { bg: "bg-pink-100", text: "text-pink-700" },
};
const DEFAULT_INTENTION_COLOR = { bg: "bg-gray-100", text: "text-gray-700" };

export function RecommendationCard({ recommendation }) {
  const [listing, setListing] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient.listings
      .getListing(recommendation.listing_id)
      .then((data) => !cancelled && setListing(data))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [recommendation.listing_id]);

  const { bg, text } = INTENTION_COLORS[recommendation.intention] ?? DEFAULT_INTENTION_COLOR;

  return (
    <View className="mb-1">
      <View className={`self-start rounded-full px-2.5 py-1 mb-1.5 ${bg}`}>
        <Text className={`text-[11px] font-semibold ${text}`}>{recommendation.intention}</Text>
      </View>
      {listing ? (
        <ListingCard listing={listing} />
      ) : failed ? (
        <View className="aspect-video rounded-2xl bg-gray-100 items-center justify-center mb-4">
          <Text className="text-xs text-gray-400">Couldn&apos;t load this listing</Text>
        </View>
      ) : (
        <View className="aspect-video rounded-2xl bg-gray-100 items-center justify-center mb-4">
          <ActivityIndicator />
        </View>
      )}
      {!!recommendation.reason && (
        <Text numberOfLines={2} className="text-[11px] text-gray-500 italic -mt-3 mb-3">
          {recommendation.reason}
        </Text>
      )}
    </View>
  );
}
