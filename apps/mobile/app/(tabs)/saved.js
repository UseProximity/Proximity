// Saved/favorites tab. Displays user's saved listings with pull-to-refresh.
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, Text, View, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useFavoritesStore } from "../../src/store/favoritesStore";
import { useAuthStore } from "../../src/store/authStore";
import { ListingCard } from "../../src/components/listings/ListingCard";

export default function SavedScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const { savedListings, isHydrated, isLoading, hydrate, refresh } = useFavoritesStore();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!isHydrated && user) {
      hydrate();
    }
  }, [isHydrated, user, hydrate]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  // Not logged in
  if (!user) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
        <Text className="text-xl font-bold text-gray-900 mb-2">Save your favorites</Text>
        <Text className="text-sm text-gray-500 text-center mb-6">
          Sign in to save listings and access them anytime, anywhere.
        </Text>
        <Pressable
          onPress={() => router.push("/(auth)/login")}
          className="bg-gray-900 rounded-lg px-6 py-3"
        >
          <Text className="text-white font-semibold text-sm">Sign in</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // Loading initial data
  if (!isHydrated || (isLoading && savedListings.length === 0)) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  // Empty state
  if (savedListings.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
        <View className="px-4 py-3 border-b border-gray-100">
          <Text className="text-lg font-bold text-gray-900">Saved Listings</Text>
        </View>
        <FlatList
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View className="items-center">
              <Text className="text-5xl mb-4">♡</Text>
              <Text className="text-lg font-bold text-gray-900 mb-2">No saved listings yet</Text>
              <Text className="text-sm text-gray-500 text-center mb-6">
                Start browsing to save your favorites!
              </Text>
              <Pressable
                onPress={() => router.push("/(tabs)")}
                className="bg-red-600 rounded-lg px-6 py-3"
              >
                <Text className="text-white font-semibold text-sm">Browse Listings</Text>
              </Pressable>
            </View>
          }
        />
      </SafeAreaView>
    );
  }

  // Has saved listings
  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <View className="px-4 py-3 border-b border-gray-100">
        <Text className="text-lg font-bold text-gray-900">
          Saved Listings ({savedListings.length})
        </Text>
      </View>
      <FlatList
        data={savedListings}
        keyExtractor={(item) => item._id}
        contentContainerStyle={{ padding: 16, paddingTop: 8 }}
        renderItem={({ item }) => <ListingCard listing={item} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />
    </SafeAreaView>
  );
}
