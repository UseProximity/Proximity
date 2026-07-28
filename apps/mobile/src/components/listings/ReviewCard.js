import { View, Text, Image } from "react-native";
import { formatDate } from "@proximity/shared";
import { StarRating } from "../ui/StarRating";

// Read-only port of the review card in apps/web/src/components/listings/
// ListingModalInfo.js's ReviewsTab. Voting and submitting reviews both
// require auth (Phase 6) — this only displays.
export function ReviewCard({ review, ownerName }) {
  const reviewerImage = review.reviewer?.image?.trim() ? review.reviewer.image : null;
  const date = formatDate(review.createdAt, { month: "short", day: "numeric", year: "numeric" });

  return (
    <View className="border-b border-gray-100 py-4">
      <View className="flex-row items-center gap-2">
        {reviewerImage ? (
          <Image source={{ uri: reviewerImage }} className="w-8 h-8 rounded-full" />
        ) : (
          <View className="w-8 h-8 rounded-full bg-gray-200" />
        )}
        <View className="flex-1 min-w-0">
          <Text numberOfLines={1} className="text-sm font-semibold text-gray-900">
            {review.reviewer?.name || "Anonymous"}
          </Text>
          {!!date && <Text className="text-xs text-gray-400">{date}</Text>}
        </View>
        <StarRating rating={review.rating} />
      </View>

      {!!review.comment && (
        <Text className="text-gray-700 text-sm leading-relaxed mt-2">{review.comment}</Text>
      )}

      {!!review.landlordReply && (
        <View className="bg-gray-50 rounded-lg p-3 mt-2">
          <Text className="text-xs font-semibold text-gray-900">
            {ownerName ?? "Landlord"} <Text className="font-normal text-gray-400">(Landlord)</Text>
          </Text>
          <Text className="text-sm text-gray-700 mt-1">{review.landlordReply.reply}</Text>
        </View>
      )}

      <View className="flex-row items-center gap-4 mt-2">
        <Text className="text-xs text-gray-400">👍 {review.upvotes ?? 0}</Text>
        <Text className="text-xs text-gray-400">👎 {review.downvotes ?? 0}</Text>
      </View>
    </View>
  );
}
