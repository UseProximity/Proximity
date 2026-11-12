// "Suggested for you" section at the top of the Browse list. Ported from
// apps/web/src/components/listings/SuggestedStrip.js (its phone "stack"
// layout): the same cards as the list under it, then a divider. Renders
// nothing without suggestions, so a student without enough signal never sees
// an empty heading. The badge ties the cards to their badged map pins (keep it
// in step with SUGGESTED_BADGE in scripts/generate-pin-icons.js).
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
    <View accessibilityLabel="Suggested for you">
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
      {/* The cards' own bottom margin plus this makes web's 24pt gap. */}
      <View className="mt-2 mb-6 border-t border-gray-200" />
    </View>
  );
}
