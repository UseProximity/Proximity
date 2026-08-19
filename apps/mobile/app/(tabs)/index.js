// Browse listings tab (home screen).
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Search, SlidersHorizontal, Rows3, Map as MapIcon } from "lucide-react-native";
import { DEFAULT_FILTERS, filterListings, countActiveFilters } from "@proximity/shared";
import apiClient from "../../src/lib/apiClient";
import { ListingCard } from "../../src/components/listings/ListingCard";
import { FilterSheet } from "../../src/components/listings/FilterSheet";
import { BrowseMapView } from "../../src/components/listings/BrowseMapView";
import { colors, shadows } from "../../src/theme/tokens";

// The one shadow tier design-system/MASTER.md §5 allows, reserved for
// floating elements — the pill search field and circular filter button are
// a "lifted" pair of controls, the same kind of floating element it's for.
const FLOATING_SHADOW = shadows.floating;

// Matches apps/web/src/components/listings/BrowseContent.js's sort order:
// photos-first, then reviewed-first, then rating desc, then review-count desc.
function sortListings(listings) {
  return [...listings].sort((a, b) => {
    const aHasImages = a.images?.length > 0;
    const bHasImages = b.images?.length > 0;
    if (aHasImages !== bHasImages) return aHasImages ? -1 : 1;

    const aReviews = a.numReviews ?? 0;
    const bReviews = b.numReviews ?? 0;
    const aHasReviews = aReviews > 0;
    const bHasReviews = bReviews > 0;
    if (aHasReviews !== bHasReviews) return aHasReviews ? -1 : 1;

    if (aHasReviews && bHasReviews) {
      if (b.rating !== a.rating) return (b.rating ?? 0) - (a.rating ?? 0);
      return bReviews - aReviews;
    }
    return 0;
  });
}

export default function BrowseScreen() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const [view, setView] = useState("list");

  async function load() {
    try {
      setError(null);
      const data = await apiClient.listings.getListings();
      setListings(data);
    } catch (err) {
      setError(err.message ?? "Failed to load listings");
    }
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const visibleListings = useMemo(() => {
    const filtered = filterListings(listings, filters, { search });
    return sortListings(filtered);
  }, [listings, filters, search]);

  const activeFilterCount = countActiveFilters(filters);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-gray-500 text-center">{error}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <View className="px-4 pt-3 pb-3">
        {/* Search + Filters — a lifted pill field + a matched circular
            button, same white/border/shadow treatment so the two read as
            one control group. No page title here — the tab bar already
            says "Browse"; a repeated heading was pure visual weight with
            no new information. */}
        <View className="flex-row items-center gap-2.5">
          <View
            className="flex-1 flex-row items-center h-12 bg-white border border-gray-200 rounded-full px-4"
            style={FLOATING_SHADOW}
          >
            <Search size={16} color={colors.textMuted} strokeWidth={2} />
            <TextInput
              className="flex-1 ml-2.5 text-sm text-gray-900"
              placeholder="Search by address or title"
              placeholderTextColor="#9ca3af"
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <Pressable
            onPress={() => setFilterSheetVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : "Filters"}
            className="w-12 h-12 rounded-full bg-white border border-gray-200 items-center justify-center"
            style={FLOATING_SHADOW}
          >
            <SlidersHorizontal size={20} color={colors.textSecondary} strokeWidth={2} />
            {activeFilterCount > 0 && (
              <View className="absolute -top-1 -right-1 bg-red-600 rounded-full w-5 h-5 items-center justify-center">
                <Text className="text-white text-[10px] font-bold">{activeFilterCount}</Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* Count + view toggle share one compact row — the count is small/
            secondary (not a headline) and sits here rather than in its own
            header row precisely because this row's whole purpose (what am I
            looking at, and how) is a real relationship between the two,
            not an arbitrary pairing. */}
        <View className="flex-row items-center justify-between mt-3">
          <Text className="text-xs text-gray-500">
            {visibleListings.length} listing{visibleListings.length === 1 ? "" : "s"}
          </Text>
          <View className="flex-row bg-gray-100 rounded-full p-1">
            {[
              { value: "list", label: "List", icon: Rows3 },
              { value: "map", label: "Map", icon: MapIcon },
            ].map(({ value, label, icon: Icon }) => (
              <Pressable
                key={value}
                onPress={() => setView(value)}
                className={`flex-row items-center gap-1.5 px-3.5 h-9 rounded-full ${view === value ? "bg-red-600" : ""}`}
              >
                <Icon size={13} color={view === value ? "#ffffff" : colors.textSecondary} strokeWidth={2} />
                <Text className={`text-xs font-medium ${view === value ? "text-white" : "text-gray-500"}`}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      {view === "map" ? (
        <BrowseMapView listings={visibleListings} />
      ) : (
        <FlatList
          data={visibleListings}
          keyExtractor={(item) => item._id}
          contentContainerStyle={{ padding: 16, paddingTop: 0 }}
          renderItem={({ item }) => <ListingCard listing={item} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View className="items-center justify-center mt-20">
              <View className="mb-3">
                <Search size={32} color={colors.textMuted} strokeWidth={1.5} />
              </View>
              <Text className="text-gray-500">No listings match your search.</Text>
            </View>
          }
        />
      )}

      <FilterSheet
        visible={filterSheetVisible}
        filters={filters}
        onApply={(next) => {
          setFilters(next);
          setFilterSheetVisible(false);
        }}
        onClose={() => setFilterSheetVisible(false)}
      />
    </SafeAreaView>
  );
}
