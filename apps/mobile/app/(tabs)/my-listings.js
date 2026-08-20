// Landlord's "My Listings" tab — a focused, mobile-appropriate subset of web's
// landlord dashboard Properties section: view your listings, toggle
// availability, delete, and reach the existing Add Listing flow. No
// analytics/charts, reviews, PMS sync, or co-owner management here by
// design (see the profile-split plan) — those stay web-only.
//
// Moved here from app/profile/my-listings.js (Stage: tab nav) to become a
// primary tab for landlords, shown in place of Saved (see (tabs)/_layout.js's
// role-based second tab) — students see Saved instead. Landlord/student
// data/toggle/delete logic is unchanged from the original screen; only the
// header changed (dropped the "Back" affordance a pushed sub-screen needs,
// since tab roots don't have back history — matches saved.js's plain title
// header instead).
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, Pressable, RefreshControl, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Plus, Trash2 } from "lucide-react-native";
import { isLandlord } from "@proximity/auth-core";
import { getRentRangeLabel } from "@proximity/shared";
import { useAuth } from "../../src/hooks/useAuth";
import apiClient from "../../src/lib/apiClient";
import { getErrorMessage } from "../../src/lib/apiError";
import { colors } from "../../src/theme/tokens";

function rangeLabel(values) {
  if (values.length === 0) return "N/A";
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? String(min) : `${min}-${max}`;
}

function MyListingCard({ listing, onToggleAvailability, onDelete, togglingId, deletingId }) {
  const router = useRouter();
  const bedLabel = rangeLabel(listing.unitTypes.map((u) => u.bedrooms).filter(Number.isFinite));
  const bathLabel = rangeLabel(listing.unitTypes.map((u) => u.bathrooms).filter(Number.isFinite));
  const rentLabel = getRentRangeLabel(listing.unitTypes);
  const imageUrl = listing.images?.[0];
  const isToggling = togglingId === listing._id;
  const isDeleting = deletingId === listing._id;

  return (
    <Pressable
      onPress={() => router.push(`/listings/${listing._id}`)}
      className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-4"
    >
      <View className="aspect-video bg-gray-100">
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} className="w-full h-full" resizeMode="cover" />
        ) : (
          <View className="flex-1 items-center justify-center">
            <Text className="text-gray-400">No image</Text>
          </View>
        )}
      </View>

      <View className="p-3">
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1 min-w-0">
            <Text numberOfLines={1} className="font-bold text-gray-900 text-sm">
              {listing.title || listing.address.split(",")[0].trim()}
            </Text>
            <Text numberOfLines={1} className="text-xs text-gray-500 mt-0.5">
              {listing.address}
            </Text>
          </View>
          <Text className="font-bold text-sm text-gray-800">
            {rentLabel}
            {rentLabel !== "Contact for Pricing" && <Text className="text-xs font-normal">/mo</Text>}
          </Text>
        </View>

        <Text className="text-gray-500 text-xs mt-2">
          {bedLabel} bed | {bathLabel} bath
        </Text>

        <View className="flex-row items-center justify-between mt-3 pt-3 border-t border-gray-100">
          <View className="flex-row items-center gap-2">
            <Switch
              value={!listing.unavailable}
              onValueChange={() => onToggleAvailability(listing)}
              disabled={isToggling}
              trackColor={{ true: colors.primary }}
            />
            <Text className="text-xs font-medium text-gray-700">
              {listing.unavailable ? "Unavailable" : "Available"}
            </Text>
          </View>
          <Pressable onPress={() => onDelete(listing)} disabled={isDeleting} hitSlop={8}>
            {isDeleting ? (
              <ActivityIndicator size="small" />
            ) : (
              <Trash2 size={18} color={colors.textMuted} strokeWidth={2} />
            )}
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

export default function MyListingsScreen() {
  const router = useRouter();
  const { user, isHydrated } = useAuth();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await apiClient.user.getUser();
      setListings(data.listings ?? []);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, "Couldn't load your listings."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (user && isLandlord(user.role)) load();
  }, [user, load]);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleToggleAvailability = async (listing) => {
    setTogglingId(listing._id);
    const nextUnavailable = !listing.unavailable;
    setListings((prev) =>
      prev.map((l) => (l._id === listing._id ? { ...l, unavailable: nextUnavailable } : l))
    );
    try {
      await apiClient.landlord.updateListing(listing._id, { unavailable: nextUnavailable });
    } catch (err) {
      setListings((prev) =>
        prev.map((l) => (l._id === listing._id ? { ...l, unavailable: listing.unavailable } : l))
      );
      Alert.alert("Error", getErrorMessage(err, "Couldn't update availability. Please try again."));
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = (listing) => {
    Alert.alert(
      "Delete listing",
      `Are you sure you want to delete ${listing.title || listing.address}? This can't be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeletingId(listing._id);
            try {
              await apiClient.landlord.deleteListing(listing._id);
              setListings((prev) => prev.filter((l) => l._id !== listing._id));
            } catch (err) {
              Alert.alert("Error", getErrorMessage(err, "Couldn't delete this listing. Please try again."));
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  if (!isHydrated || (loading && listings.length === 0 && !error)) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  // Safety net: (tabs)/_layout.js only shows this tab to landlords, but a
  // stale deep link (or a role change mid-session) could still land here.
  if (!user || !isLandlord(user.role)) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white px-8">
        <Text className="text-lg font-bold text-gray-900 mb-1">For landlords only</Text>
        <Text className="text-sm text-gray-500 text-center mb-6">
          My Listings is available to landlord accounts.
        </Text>
        <Pressable onPress={() => router.replace("/(tabs)")} className="bg-gray-100 rounded-xl px-6 py-3">
          <Text className="text-gray-900 font-semibold text-sm">Go to Browse</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-100">
        <Text className="text-lg font-bold text-gray-900">My Listings</Text>
        <Pressable onPress={() => router.push("/listings/add")} hitSlop={12}>
          <Plus size={22} color={colors.primary} strokeWidth={2.5} />
        </Pressable>
      </View>

      <FlatList
        data={listings}
        keyExtractor={(item) => item._id}
        contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        renderItem={({ item }) => (
          <MyListingCard
            listing={item}
            onToggleAvailability={handleToggleAvailability}
            onDelete={handleDelete}
            togglingId={togglingId}
            deletingId={deletingId}
          />
        )}
        ListEmptyComponent={
          error ? (
            <View className="flex-1 items-center justify-center mt-20 px-6">
              <Text className="text-gray-500 text-center mb-4">{error}</Text>
              <Pressable onPress={load} className="bg-gray-100 rounded-xl px-6 py-3">
                <Text className="text-gray-900 font-semibold text-sm">Try again</Text>
              </Pressable>
            </View>
          ) : (
            <View className="flex-1 items-center justify-center mt-20 px-6">
              <Text className="text-gray-900 font-semibold text-base mb-1">No listings yet</Text>
              <Text className="text-sm text-gray-500 text-center mb-6">
                Add your first property to start reaching students.
              </Text>
              <Pressable onPress={() => router.push("/listings/add")} className="bg-red-600 rounded-xl px-6 py-3">
                <Text className="text-white font-semibold text-sm">Add Listing</Text>
              </Pressable>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}
