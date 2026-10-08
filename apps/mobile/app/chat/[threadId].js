// Conversation screen. Loads the latest page of messages, marks the thread read,
// and sends text messages. Older messages load when the user scrolls toward the
// start of the conversation (the list is inverted, so "end" is the oldest
// message). New messages arrive over realtime (lib/chatRealtime.js); the REST
// reload on focus and the refresh button in the header remain as the fallback.
// Attachments are not supported on mobile yet.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, RefreshCw } from "lucide-react-native";
import apiClient from "../../src/lib/apiClient";
import {
  CHAT_MAX_BODY,
  chatErrorMessage,
  mergeMessages,
} from "../../src/lib/chatFormat";
import { useAuthStore } from "../../src/store/authStore";
import { useChatUnreadStore } from "../../src/store/chatUnreadStore";
import { subscribeThread } from "../../src/lib/chatRealtime";
import { MessageBubble } from "../../src/components/chat/MessageBubble";
import { SendButton } from "../../src/components/ui/SendButton";
import { colors } from "../../src/theme/tokens";

const PAGE_SIZE = 30;

export default function ChatThreadScreen() {
  const { threadId, name, listingTitle } = useLocalSearchParams();
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isAuthHydrated = useAuthStore((state) => state.isHydrated);

  const [messages, setMessages] = useState([]); // oldest first
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const loadedOnce = useRef(false);
  const messagesRef = useRef([]);
  messagesRef.current = messages;

  const markRead = useCallback(() => {
    // Best effort: a failed read receipt must never get in the way of reading.
    // The tab badge is refreshed once the server has recorded the read.
    apiClient.chat
      .markRead(threadId)
      .then(() => useChatUnreadStore.getState().refresh())
      .catch(() => {});
  }, [threadId]);

  // Latest page. Merged into what is already on screen so a refresh does not
  // throw away older pages the user has scrolled back through.
  const loadLatest = useCallback(
    async ({ initial = false } = {}) => {
      try {
        const page = await apiClient.chat.getMessages(threadId, {
          limit: PAGE_SIZE,
        });
        setMessages((current) => mergeMessages(current, page));
        if (initial) setHasMore(page.length >= PAGE_SIZE);
        setError(null);
        markRead();
      } catch (err) {
        if (err?.status === 401) return; // session expired: the api client already signed out
        if (initial)
          setError(chatErrorMessage(err, "Couldn't load this conversation."));
      } finally {
        setLoading(false);
      }
    },
    [threadId, markRead]
  );

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      const initial = !loadedOnce.current;
      loadedOnce.current = true;
      loadLatest({ initial });
    }, [user?.id, loadLatest])
  );

  // Tell the store which conversation is open, so the Chat tab badge does not
  // flicker for messages this screen reads straight away.
  useEffect(() => {
    useChatUnreadStore.getState().setActiveThreadId(threadId);
    return () => useChatUnreadStore.getState().setActiveThreadId(null);
  }, [threadId]);

  // Realtime enhances the REST loading above; it does not replace it. A new
  // message is merged in as it arrives (and marked read when it is from the other
  // person), and every (re)subscribe refetches the latest page so anything missed
  // while disconnected is recovered. The refresh button and the focus reload still
  // work if the socket is down.
  useEffect(() => {
    if (!user?.id || !threadId) return undefined;
    return subscribeThread(threadId, {
      onInsert: (message) => {
        const last = messagesRef.current.filter((m) => !m.pending).at(-1);
        setMessages((current) => {
          // Our own send is already on screen as a pending bubble: replace it
          // rather than showing the message twice.
          let rest = current;
          if (message.isMine) {
            const pendingIndex = current.findIndex(
              (m) => m.pending && m.body === message.body
            );
            if (pendingIndex !== -1) {
              rest = current.filter((_, i) => i !== pendingIndex);
            }
          }
          return mergeMessages(rest, [message]);
        });
        if (!message.isMine) markRead();
        // The raw row has no listing title, so fetch the full version when the
        // conversation moves to another listing.
        if (message.listingId && message.listingId !== last?.listingId) {
          loadLatest();
        }
      },
      onSubscribed: () => {
        loadLatest();
      },
    });
  }, [threadId, user?.id, loadLatest, markRead]);

  // The list is oldest-first; scrolling toward the start asks for messages
  // created before the oldest one held.
  const loadOlder = useCallback(async () => {
    if (!hasMore || loadingOlder || loading) return;
    const oldest = messages.find((m) => !m.pending);
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const page = await apiClient.chat.getMessages(threadId, {
        limit: PAGE_SIZE,
        before: oldest.createdAt,
      });
      setMessages((current) => mergeMessages(page, current));
      setHasMore(page.length >= PAGE_SIZE);
    } catch (err) {
      if (err?.status === 401) return;
      setSendError(chatErrorMessage(err, "Couldn't load earlier messages."));
    } finally {
      setLoadingOlder(false);
    }
  }, [hasMore, loadingOlder, loading, messages, threadId]);

  const handleSend = useCallback(async () => {
    const body = text.trim();
    if (!body || sending) return;

    const tempId = `pending-${Date.now()}`;
    const optimistic = {
      id: tempId,
      threadId,
      senderId: user?.id,
      isMine: true,
      body,
      messageType: "text",
      metadata: {},
      createdAt: new Date().toISOString(),
      pending: true,
    };

    setSending(true);
    setSendError(null);
    setText("");
    setMessages((current) => [...current, optimistic]);

    try {
      const result = await apiClient.chat.sendMessage(threadId, { body });
      setMessages((current) => {
        // Realtime may already have delivered the confirmed row and replaced the
        // pending bubble; then there is nothing left to settle.
        if (!current.some((m) => m.id === tempId)) return current;
        const confirmed = {
          ...optimistic,
          id: result?.messageId ?? tempId,
          listingId: result?.listingId ?? null,
          pending: false,
        };
        return mergeMessages(
          current.filter((m) => m.id !== tempId),
          [confirmed]
        );
      });
      markRead();
    } catch (err) {
      setMessages((current) => current.filter((m) => m.id !== tempId));
      if (err?.status !== 401) {
        setText(body); // give the words back so nothing typed is lost
        setSendError(
          chatErrorMessage(err, "Couldn't send your message. Please try again.")
        );
      }
    } finally {
      setSending(false);
    }
  }, [text, sending, threadId, user?.id, markRead]);

  // Newest first for the inverted list.
  const data = [...messages].reverse();

  const renderItem = ({ item, index }) => {
    const older = data[index + 1];
    const startsRun = !older || older.senderId !== item.senderId;
    const listingChanged =
      !!item.listingId && (!older || older.listingId !== item.listingId);
    return (
      <MessageBubble
        message={item}
        senderName={!item.isMine && startsRun ? name || null : null}
        listingLabel={
          listingChanged
            ? item.listingTitle || item.listingAddress || null
            : null
        }
      />
    );
  };

  const displayName = name || "Conversation";

  if (isAuthHydrated && !user) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
        <Text className="text-gray-500 text-center mb-4">
          Sign in to view this conversation.
        </Text>
        <Pressable onPress={() => router.replace("/(auth)/login")} hitSlop={8}>
          <Text className="text-red-600 font-semibold">Sign in</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
      <View className="flex-row items-center px-2 py-2.5 border-b border-gray-100">
        <Pressable onPress={() => router.back()} hitSlop={8} className="p-2">
          <ChevronLeft size={24} color={colors.textPrimary} strokeWidth={2} />
        </Pressable>
        <View className="flex-1 mx-1">
          <Text numberOfLines={1} className="text-base font-bold text-gray-900">
            {displayName}
          </Text>
          {listingTitle ? (
            <Text numberOfLines={1} className="text-xs text-gray-500">
              {listingTitle}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => loadLatest()}
          hitSlop={8}
          className="p-2"
          accessibilityLabel="Refresh"
        >
          <RefreshCw size={18} color={colors.textSecondary} strokeWidth={2} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={8}
      >
        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" />
          </View>
        ) : error && messages.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-gray-500 text-center mb-4">{error}</Text>
            <Pressable
              onPress={() => {
                setLoading(true);
                loadLatest({ initial: true });
              }}
              hitSlop={8}
            >
              <Text className="text-red-600 font-semibold">Try again</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={data}
            inverted
            keyExtractor={(message) => message.id}
            renderItem={renderItem}
            onEndReached={loadOlder}
            onEndReachedThreshold={0.3}
            contentContainerStyle={{ paddingVertical: 12 }}
            keyboardShouldPersistTaps="handled"
            ListFooterComponent={
              loadingOlder ? <ActivityIndicator className="py-3" /> : null
            }
            ListEmptyComponent={
              <Text
                className="text-sm text-gray-400 text-center py-8"
                style={{ transform: [{ scaleY: -1 }] }}
              >
                No messages yet. Say hello below.
              </Text>
            }
          />
        )}

        {sendError ? (
          <Text className="text-xs text-red-500 px-4 pb-1">{sendError}</Text>
        ) : null}

        <View className="border-t border-gray-100 bg-white px-4 pt-2.5 pb-3 flex-row items-end gap-2">
          <TextInput
            value={text}
            onChangeText={(value) => setText(value.slice(0, CHAT_MAX_BODY))}
            placeholder="Write a message"
            multiline
            editable={!loading}
            className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2.5 max-h-28"
          />
          {sending ? (
            <View className="w-9 h-9 items-center justify-center">
              <ActivityIndicator />
            </View>
          ) : (
            <SendButton
              onPress={handleSend}
              disabled={!text.trim() || loading}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
