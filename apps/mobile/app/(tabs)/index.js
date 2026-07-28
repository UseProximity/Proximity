// Browse listings tab (home screen).
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DEFAULT_FILTERS, filterListings, countActiveFilters } from "@proximity/shared";
import apiClient from "../../src/lib/apiClient";
import { ListingCard } from "../../src/components/listings/ListingCard";
import { FilterSheet } from "../../src/components/listings/FilterSheet";
import { BrowseMapView } from "../../src/components/listings/BrowseMapView";

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
      <View className="flex-row items-center gap-2.5 px-4 pt-2 pb-3">
        <TextInput
          className="flex-1 h-11 border border-gray-200 rounded-lg px-3 text-sm"
          placeholder="Search by address or title"
          value={search}
          onChangeText={setSearch}
        />
        <Pressable
          onPress={() => setFilterSheetVisible(true)}
          className="h-11 px-4 rounded-lg bg-gray-100 items-center justify-center flex-row gap-1.5"
        >
          <Text className="text-sm font-medium text-gray-700">Filters</Text>
          {activeFilterCount > 0 && (
            <View className="bg-red-600 rounded-full w-5 h-5 items-center justify-center">
              <Text className="text-white text-[10px] font-bold">{activeFilterCount}</Text>
            </View>
          )}
        </Pressable>
        <View className="flex-row bg-gray-100 rounded-lg p-1">
          {["list", "map"].map((v) => (
            <Pressable
              key={v}
              onPress={() => setView(v)}
              className={`px-3 h-9 items-center justify-center rounded-md ${view === v ? "bg-white" : ""}`}
            >
              <Text className={`text-xs font-medium capitalize ${view === v ? "text-gray-900" : "text-gray-500"}`}>
                {v}
              </Text>
            </Pressable>
          ))}
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
