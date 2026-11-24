// "Suggested for you" section at the top of the Browse list. Ported from
// apps/web/src/components/listings/SuggestedStrip.js (its phone "stack"
// layout): the same cards as the list under it. Renders nothing without
// suggestions, so a student without enough signal never sees an empty heading.
// Mobile-only, beyond web: the heading and cards sit in a soft gold block
// instead of ending with a divider, because with one card per row the group's
// end was hard to see while scrolling. Amber-50 with an amber-200 edge keeps it
// apart from the amber warning banners (amber-100/400, amber-50/300).
// The badge ties the cards to their badged map pins (keep it in step with
// SUGGESTED_BADGE in scripts/generate-pin-icons.js).
// Web shows the heading in its results row; mobile's results row already holds
// the count and the List/Map toggle, so the heading sits above the cards.
// Web's suggested_impression / suggested_click analytics are not ported: the
// mobile app has no analytics.
import { Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { ListingCard } from "./ListingCard";
import { colors } from "../../theme/tokens";

export function SuggestedSection({ listings }) {
  if (!listings.length) return null;
  return (
    <View
      accessibilityLabel="Suggested for you"
      // No bottom padding: the last card's own mb-4 makes it match the top.
      className="bg-amber-50 border border-amber-200 rounded-2xl px-4 pt-4 mb-6"
    >
      <View className="flex-row items-center gap-2 mb-3">
        <Svg width={14} height={14} viewBox="20.5 -0.5 10 10">
          <Circle cx="25.5" cy="4.5" r="5" fill={colors.suggestedBadge} />
          <Path
            d="M25.5 1.8l0.77 1.93 1.93 0.77-1.93 0.77-0.77 1.93-0.77-1.93-1.93-0.77 1.93-0.77z"
            fill={colors.white}
          />
        </Svg>
        <Text className="text-xs font-bold text-gray-900">Suggested for you</Text>
      </View>
      {listings.map((listing) => (
        <ListingCard key={listing._id} listing={listing} />
      ))}
    </View>
  );
}
