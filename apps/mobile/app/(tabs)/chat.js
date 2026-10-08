// Messages inbox (the Chat tab). Lists the signed-in user's conversations from
// GET /api/chat/threads. Reloads every time the tab gains focus, since there is
// no realtime on mobile yet, and supports pull-to-refresh. Tapping a row opens
// the thread screen at app/chat/[threadId].js.
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { MessageCircle } from "lucide-react-native";
import apiClient from "../../src/lib/apiClient";
import { chatErrorMessage } from "../../src/lib/chatFormat";
import { useAuthStore } from "../../src/store/authStore";
import { useChatUnreadStore } from "../../src/store/chatUnreadStore";
import { ThreadRow } from "../../src/components/chat/ThreadRow";
import { Button } from "../../src/components/ui/Button";
import { colors } from "../../src/theme/tokens";

export default function ChatInboxScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isAuthHydrated = useAuthStore((state) => state.isHydrated);

  const [threads, setThreads] = useState(null); // null = not loaded yet
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiClient.chat.listThreads();
      const list = Array.isArray(data) ? data : [];
      setThreads(list);
      useChatUnreadStore.getState().setFromThreads(list);
      setError(null);
    } catch (err) {
      if (err?.status === 401) return; // session expired: the api client already signed out
      setError(chatErrorMessage(err, "Couldn't load your messages."));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) {
        setThreads(null);
        setError(null);
        return;
      }
      load();
    }, [user?.id, load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openThread = (thread) => {
    router.push({
      pathname: "/chat/[threadId]",
      params: {
        threadId: thread.threadId,
        name: thread.otherUserName ?? "",
        listingTitle: thread.listingCount > 1 ? "" : thread.listingTitle ?? thread.listingAddress ?? "",
      },
    });
  };

  if (!isAuthHydrated) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
        <Text className="text-xl font-bold text-gray-900 mb-2">Messages</Text>
        <Text className="text-sm text-gray-500 text-center mb-6">
          Sign in to message landlords and keep your conversations in one place.
        </Text>
        <Button onPress={() => router.push("/(auth)/login")} className="self-stretch">
          Sign in
        </Button>
      </SafeAreaView>
    );
  }

  const loading = threads === null && !error;

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <View className="px-4 py-3 border-b border-gray-100">
        <Text className="text-lg font-bold text-gray-900">Messages</Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <FlatList
          data={threads ?? []}
          keyExtractor={(thread) => thread.threadId}
          renderItem={({ item }) => <ThreadRow thread={item} onPress={() => openThread(item)} />}
          ItemSeparatorComponent={() => <View className="h-px bg-gray-100 ml-[72px]" />}
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            error ? (
              <View className="flex-1 items-center justify-center px-8">
                <Text className="text-gray-500 text-center mb-4">{error}</Text>
                <Pressable onPress={load} hitSlop={8}>
                  <Text className="text-red-600 font-semibold">Try again</Text>
                </Pressable>
              </View>
            ) : (
              <View className="flex-1 items-center justify-center px-8">
                <View className="mb-4">
                  <MessageCircle size={40} color={colors.textMuted} strokeWidth={1.5} />
                </View>
                <Text className="text-lg font-bold text-gray-900 mb-1">No messages yet</Text>
                <Text className="text-sm text-gray-500 text-center mb-6">
                  Open a listing and tap Send message to start a conversation with the landlord.
                </Text>
                <Button onPress={() => router.push("/(tabs)")} className="self-stretch">
                  Browse listings
                </Button>
              </View>
            )
          }
          ListHeaderComponent={
            error && threads?.length ? (
              <Text className="text-xs text-red-500 text-center py-2">{error}</Text>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}
