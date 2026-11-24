// Find Your Place, page 3: the top matches, or an honest empty or error state.
// Same states and wording as the website (apps/web/src/components/findYourPlace/
// StepMatches.js). "Browse All N Matches" opens the Browse tab with the answers
// set as its filters; N is counted by the server with Browse's own filter rules.
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { DEFAULT_FILTERS } from "@proximity/shared";
import apiClient from "../../lib/apiClient";
import { useBrowseHandoffStore } from "../../store/browseHandoffStore";
import { Button } from "../ui/Button";
import { MatchCard, MatchCardSkeleton } from "./MatchCard";

// The longest the skeletons wait on a slow card before the set is shown anyway.
const REVEAL_WAIT_MS = 2500;

function Skeletons() {
  return [0, 1, 2, 3].map((i) => <MatchCardSkeleton key={i} />);
}

function BrowseButton({ browse, className = "" }) {
  const router = useRouter();
  const count = Number.isFinite(browse?.count) ? browse.count : null;
  const filtered = !!browse?.filters && count !== 0;
  const label = !filtered ? "Browse All Listings" : count == null ? "Browse All Matches" : `Browse All ${count} Matches`;
  return (
    <Pressable
      onPress={() => {
        // Unfiltered, Browse starts clean, as the website's fresh browse page does.
        useBrowseHandoffStore
          .getState()
          .send(filtered ? { filters: browse.filters, suggested: browse.suggested ?? null } : { filters: DEFAULT_FILTERS, suggested: null });
        router.navigate("/(tabs)");
      }}
      accessibilityRole="button"
      className={`self-start h-9 px-4 rounded-full border border-red-300 bg-white items-center justify-center active:bg-red-50 ${className}`}
    >
      <Text className="text-xs font-medium text-red-600">{label}</Text>
    </Pressable>
  );
}

// The four matches, shown together once each has its listing (or failed), so
// they arrive as one set. A listing that cannot be loaded is left out.
function MatchList({ matches, browse }) {
  const [byId, setById] = useState({});
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setById({});
    setTimedOut(false);
    const timer = setTimeout(() => !cancelled && setTimedOut(true), REVEAL_WAIT_MS);
    for (const m of matches) {
      apiClient.listings
        .getListing(m.listing_id)
        .then((listing) => !cancelled && setById((prev) => ({ ...prev, [m.listing_id]: listing ?? false })))
        .catch(() => !cancelled && setById((prev) => ({ ...prev, [m.listing_id]: false })));
    }
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [matches]);

  const revealed = timedOut || matches.every((m) => byId[m.listing_id] !== undefined);
  const nearOnly = matches.every((m) => m.near_miss);

  return (
    <View>
      <Text className="text-[15px] font-semibold text-gray-900">Your Top Matches</Text>
      {nearOnly && (
        <Text className="text-xs text-gray-500 mt-0.5">
          Nothing fits every answer right now, so these are the closest. Each one says what it misses.
        </Text>
      )}
      <BrowseButton browse={browse} className="mt-2 mb-3" />
      {revealed ? (
        matches.map((m) =>
          byId[m.listing_id] ? (
            <MatchCard key={m.listing_id} match={m} listing={byId[m.listing_id]} />
          ) : byId[m.listing_id] === undefined ? (
            <MatchCardSkeleton key={m.listing_id} />
          ) : null
        )
      ) : (
        <Skeletons />
      )}
    </View>
  );
}

export function StepMatches({ loading, error, results, onRetry, onFixAnswers }) {
  if (loading) {
    return (
      <View>
        <Text className="text-[15px] font-semibold text-gray-900">Finding your top matches...</Text>
        <Text className="text-xs text-gray-500 mt-1 mb-3">Checking every live listing against what you told us.</Text>
        <Skeletons />
      </View>
    );
  }

  if (error) {
    return (
      <View accessibilityRole="alert">
        <Text className="text-[15px] font-semibold text-gray-900">{error.title}</Text>
        <Text className="text-sm text-gray-500 mt-1">{error.body}</Text>
        <Button onPress={error.action === "fix" ? onFixAnswers : onRetry} className="mt-5 self-start">
          {error.action === "fix" ? "Check my answers" : "Try again"}
        </Button>
      </View>
    );
  }

  const matches = results?.matches ?? [];
  if (!matches.length) {
    return (
      <View>
        <Text className="text-[15px] font-semibold text-gray-900">Nothing fits all of that right now</Text>
        <Text className="text-sm text-gray-500 mt-1">
          No live listing matches every answer, even allowing for one near miss. Go back and loosen one of them (rent,
          lease length or move-in date usually open things up), or browse everything.
        </Text>
        <BrowseButton browse={null} className="mt-5" />
      </View>
    );
  }

  return <MatchList matches={matches} browse={results.browse} />;
}
