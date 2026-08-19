import { Alert, Image, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { getRentRangeLabel, getCampusWalkMinutes } from "@proximity/shared";
import { HeartIcon } from "../ui/HeartIcon";
import { useFavoritesStore } from "../../store/favoritesStore";
import { useAuthStore } from "../../store/authStore";

// Ported from apps/web/src/components/listings/MapPopupCard.js's ListingCard.
// Omitted vs. web (cosmetic/non-essential, not a functional gap): analytics
// trackEvent calls, the cached-image-load spinner, the "See all N photos"
// badge, and the hover progress-bar indicator (no hover on mobile anyway).
function rangeLabel(values) {
  if (values.length === 0) return "N/A";
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? String(min) : `${min}-${max}`;
}

function WalkBadge({ minutes, label }) {
  if (minutes == null) return null;
  const isCampus = label === "campus";
  const filled = isCampus
    ? minutes < 12 ? 1 : minutes < 20 ? 2 : minutes < 30 ? 3 : minutes < 45 ? 4 : 5
    : minutes <= 2 ? 1 : minutes <= 5 ? 2 : minutes <= 10 ? 3 : minutes <= 15 ? 4 : 5;
  const color =
    filled <= 1 ? "#22c55e" : filled <= 2 ? "#84cc16" : filled <= 3 ? "#eab308" : filled <= 4 ? "#f97316" : "#ef4444";
  return (
    <View className="flex-row items-center gap-1">
      <Text style={{ color }} className="text-[10px] font-medium">
        {minutes} min
      </Text>
      <Text className="text-[10px] text-gray-400 capitalize">{label}</Text>
    </View>
  );
}

export function ListingCard({ listing }) {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isSaved = useFavoritesStore((state) => state.isSaved(listing._id));
  const toggleFavorite = useFavoritesStore((state) => state.toggleFavorite);

  const addressBeforeComma = listing.address.split(",")[0].trim();
  const title = listing.title || addressBeforeComma;
  const cityStateZip =
    listing.title && listing.title !== addressBeforeComma
      ? listing.address
      : listing.address.replace(/^[^,]+,\s*/, "");

  const bedLabel = rangeLabel(listing.unitTypes.map((u) => u.bedrooms).filter(Number.isFinite));
  const bathLabel = rangeLabel(listing.unitTypes.map((u) => u.bathrooms).filter(Number.isFinite));

  const imageUrl = listing.images?.[0];
  const rentLabel = getRentRangeLabel(listing.unitTypes);
  const campusMin = getCampusWalkMinutes(listing.placeWalkMinutes);
  const shuttleMin = typeof listing.shuttleWalkMinutes === "number" ? listing.shuttleWalkMinutes : null;

  const handleHeartPress = async (e) => {
    e.stopPropagation();
    
    if (!user) {
      Alert.alert(
        "Sign in required",
        "Sign in to save listings and access them anytime.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Sign In", onPress: () => router.push("/(auth)/login") },
        ]
      );
      return;
    }

    try {
      await toggleFavorite(listing._id, listing);
    } catch (error) {
      Alert.alert("Error", "Failed to update favorites. Please try again.");
    }
  };

  return (
    <Pressable
      onPress={() => router.push(`/listings/${listing._id}`)}
      className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-4"
    >
      <View className="relative aspect-video bg-gray-100">
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            className={`w-full h-full ${listing.unavailable ? "opacity-50" : ""}`}
            resizeMode="cover"
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <Text className="text-gray-400">No image</Text>
          </View>
        )}
        {listing.unavailable && (
          <View className="absolute top-3 left-3 bg-gray-800/80 rounded-full px-2.5 py-1">
            <Text className="text-white text-xs font-semibold">Unavailable</Text>
          </View>
        )}
        {/* Heart icon in top-right corner — no background circle (design-
            system polish pass): a thick white outline reads clearly against
            any photo on its own, with fill (solid red vs. semi-transparent
            black) distinguishing saved from unsaved, so a filled backing
            pill isn't needed. HeartIcon's own Pressable still carries the
            44x44 touch target via inline style, so removing the wrapper
            doesn't shrink the tap area, only its visible background. */}
        <View className="absolute top-2 right-2">
          <HeartIcon isSaved={isSaved} onPress={handleHeartPress} size="lg" onImage />
        </View>
      </View>

      <View className="p-3">
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1 min-w-0">
            <Text numberOfLines={1} className="font-bold text-gray-900 text-sm">
              {title}
            </Text>
            {!!cityStateZip && (
              <Text numberOfLines={1} className="text-xs text-gray-500 mt-0.5">
                {cityStateZip}
              </Text>
            )}
          </View>
          <Text className={`font-bold text-sm ${listing.unavailable ? "text-gray-400" : "text-gray-800"}`}>
            {rentLabel}
            {rentLabel !== "Contact for Pricing" && <Text className="text-xs font-normal">/mo</Text>}
          </Text>
        </View>

        <View className="flex-row items-center justify-between mt-2">
          <Text className="text-gray-500 text-xs flex-1" numberOfLines={1}>
            {bedLabel} bed | {bathLabel} bath
            {listing.leaseType ? ` | ${listing.leaseType}` : ""}
          </Text>
          {!!listing.owner?.name && (
            <Text className="text-gray-400 text-xs ml-2" numberOfLines={1}>
              {listing.owner.name}
            </Text>
          )}
        </View>

        {(campusMin != null || shuttleMin != null) && (
          <View className="flex-row gap-3 mt-1.5">
            <WalkBadge minutes={campusMin} label="campus" />
            <WalkBadge minutes={shuttleMin} label="shuttle" />
          </View>
        )}
      </View>
    </Pressable>
  );
}
