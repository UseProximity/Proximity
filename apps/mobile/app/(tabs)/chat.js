// Messages inbox (the Chat tab). Lists the signed-in user's conversations from
// GET /api/chat/threads. Reloads every time the tab gains focus, since there is
// no realtime on mobile yet, and supports pull-to-refresh. Tapping a row opens
// the thread screen at app/chat/[threadId].js.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { MessageCircle } from "lucide-react-native";
import apiClient from "../../src/lib/apiClient";
import { getErrorMessage } from "../../src/lib/apiError";
import { ERROR_MESSAGES } from "../../src/lib/errorMessages";
import { ErrorMessage, ErrorState } from "../../src/components/ui/ErrorMessage";
import { useAuthStore } from "../../src/store/authStore";
import { useChatUnreadStore } from "../../src/store/chatUnreadStore";
import { ThreadRow } from "../../src/components/chat/ThreadRow";
import { Button } from "../../src/components/ui/Button";
import { LoggedOutScreen } from "../../src/components/brand/LoggedOutScreen";
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
      setError(getErrorMessage(err, ERROR_MESSAGES.CHAT.LOAD_THREADS));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) {
        setThreads(null);
        setError(null);
        return undefined;
      }
      load();
      // While this screen is showing, a realtime message reloads this list
      // directly (the layout otherwise only refreshes the badge count).
      useChatUnreadStore.getState().setInboxActive(true);
      return () => useChatUnreadStore.getState().setInboxActive(false);
    }, [user?.id, load])
  );

  const inboxVersion = useChatUnreadStore((state) => state.inboxVersion);
  const seenVersion = useRef(inboxVersion);
  useEffect(() => {
    if (inboxVersion === seenVersion.current) return;
    seenVersion.current = inboxVersion;
    if (user?.id && useChatUnreadStore.getState().inboxActive) load();
  }, [inboxVersion, user?.id, load]);

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
        image: thread.otherUserImage ?? "",
        unavailable: thread.unavailable ? "1" : "",
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
      <LoggedOutScreen
        title="Message landlords"
        description="Sign in to message landlords and keep your conversations in one place."
      />
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
              <ErrorState message={error} onAction={load} />
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
              <ErrorMessage compact className="mx-4 my-2">
                {error}
              </ErrorMessage>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}
