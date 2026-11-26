// One Find Your Place match: the listing's photo and facts, then why it matched
// and any caveat the search added. The same lines as the website's MatchCard
// (apps/web/src/components/findYourPlace/MatchCard.js), stacked as on a phone.
// The price is the one of the lease this student matched, not the listing's range.
import { Image, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { getRentRangeLabel, getCampusWalkMinutes } from "@proximity/shared";
import { HeartIcon } from "../ui/HeartIcon";
import { WalkBadge, RatingBadge } from "../listings/ListingCard";
import { useFavoritesStore } from "../../store/favoritesStore";
import { getErrorMessage } from "../../lib/apiError";
import { ERROR_MESSAGES } from "../../lib/errorMessages";
import { showError } from "../../lib/showError";

const range = (values) => {
  const nums = values.filter(Number.isFinite);
  if (!nums.length) return null;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  return lo === hi ? String(lo) : `${lo}-${hi}`;
};

export function MatchCardSkeleton() {
  return (
    <View className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-4" accessibilityElementsHidden>
      <View className="aspect-video bg-gray-200" />
      <View className="p-3 gap-2">
        <View className="h-3.5 w-2/3 rounded bg-gray-200" />
        <View className="h-3 w-1/2 rounded bg-gray-100" />
        <View className="h-3 w-5/6 rounded bg-gray-100" />
      </View>
    </View>
  );
}

export function MatchCard({ match, listing }) {
  const router = useRouter();
  const isSaved = useFavoritesStore((state) => state.isSaved(listing._id));
  const toggleFavorite = useFavoritesStore((state) => state.toggleFavorite);

  const street = (listing.address ?? "").split(",")[0].trim();
  const title = listing.title || street;
  // Under a named building the full address; under a street-address title, the rest of it.
  const cityStateZip =
    listing.title && listing.title !== street ? listing.address : (listing.address ?? "").replace(/^[^,]+,\s*/, "");
  const units = listing.unitTypes ?? [];
  const beds = range(units.map((u) => u.bedrooms));
  const baths = range(units.map((u) => u.bathrooms));
  // null = the matched lease publishes no rent; undefined = a match saved before
  // the search sent prices, which shows the listing's range.
  const rent =
    match.price === undefined
      ? getRentRangeLabel(units)
      : match.price
      ? `$${match.price.amount.toLocaleString("en-US")}`
      : "Contact for Pricing";
  const per = match.price?.per === "person" ? "/person" : "/mo";
  const walk = getCampusWalkMinutes(listing.placeWalkMinutes);
  const shuttle = typeof listing.shuttleWalkMinutes === "number" ? listing.shuttleWalkMinutes : null;
  const image = listing.images?.[0];

  const open = (section) =>
    router.push({ pathname: "/listings/[id]", params: section ? { id: listing._id, section } : { id: listing._id } });

  const onHeart = async (e) => {
    e?.stopPropagation?.();
    try {
      await toggleFavorite(listing._id, listing);
    } catch (error) {
      showError(getErrorMessage(error, ERROR_MESSAGES.LISTINGS.FAVORITE));
    }
  };

  return (
    <Pressable
      onPress={() => open()}
      accessibilityRole="link"
      accessibilityLabel={title}
      className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-4"
    >
      <View className="relative aspect-video bg-gray-100">
        {image ? (
          <Image source={{ uri: image }} className="w-full h-full" resizeMode="cover" accessibilityLabel={listing.address ?? title} />
        ) : (
          <View className="flex-1 items-center justify-center">
            <Text className="text-gray-400">No image</Text>
          </View>
        )}
        <View className="absolute top-2 right-2">
          <HeartIcon isSaved={isSaved} onPress={onHeart} size="lg" onImage />
        </View>
      </View>

      <View className="p-3">
        <View className="flex-row items-start justify-between gap-2">
          <Text numberOfLines={1} className="flex-1 font-bold text-gray-900 text-sm">
            {title}
          </Text>
          <Text className="font-bold text-sm text-gray-800">
            {rent}
            {rent !== "Contact for Pricing" && <Text className="text-xs font-normal">{per}</Text>}
          </Text>
        </View>
        {!!cityStateZip && (
          <Text numberOfLines={1} className="text-xs text-gray-500 mt-0.5">
            {cityStateZip}
          </Text>
        )}
        <Text numberOfLines={1} className="text-xs text-gray-500 mt-2">
          {beds ?? "N/A"} bed | {baths ?? "N/A"} bath
          {listing.leaseType ? ` | ${listing.leaseType}` : ""}
        </Text>
        {(walk != null || shuttle != null) && (
          <View className="flex-row gap-3 mt-1.5">
            <WalkBadge minutes={walk} label="campus" />
            <WalkBadge minutes={shuttle} label="shuttle" />
          </View>
        )}

        <Text className="text-sm leading-5 text-gray-700 mt-2.5">{match.reason}</Text>
        {!!match.note && <Text className="text-xs leading-5 text-red-600 mt-1">{match.note}</Text>}

        <View className="flex-row items-center justify-between mt-3">
          <Pressable
            onPress={() => open("message")}
            accessibilityRole="button"
            accessibilityLabel={`Contact about ${title}`}
            hitSlop={6}
            className="h-9 px-4 rounded-full border border-red-300 bg-white items-center justify-center active:bg-red-50"
          >
            <Text className="text-xs font-medium text-red-600">Contact</Text>
          </Pressable>
          <RatingBadge listing={listing} />
        </View>
      </View>
    </Pressable>
  );
}
