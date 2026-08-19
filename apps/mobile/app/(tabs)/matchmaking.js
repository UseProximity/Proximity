// Matchmaking chat tab ("Proxy"). Ported behavior from
// apps/web/src/components/matchmaking/ChatClient.js — same conversation state
// machine (via the shared questionEngine + chatStore), same request shapes
// against apiClient.matchmaking.*, rebuilt as a native chat UI rather than a
// copy of the web layout (custom FlatList, no @chatscope/chat-ui-kit-react —
// web doesn't actually use it either).
//
// Auth-deferred, matching this phase's scope: no login is required here. The
// API resolves anonymous requests to a shared guest identity whenever
// isProdData() is false (dev/staging), which is what EXPO_PUBLIC_API_URL
// points at during development — see the Phase 5 Audit in the build plan.
//
// Route renamed from chat.js to matchmaking.js (Stage H) — the tab bar now
// has a separate, genuinely-empty future "Chat" tab, so this file's old name
// would have collided with it. No hardcoded references to "/(tabs)/chat"
// existed anywhere else in the app (confirmed via grep before renaming), so
// this was a safe rename with no other call sites to update.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link } from "expo-router";
import { useChatStore } from "../../src/store/chatStore";
import { ChatBubble } from "../../src/components/matchmaking/ChatBubble";
import { AnswerBar } from "../../src/components/matchmaking/AnswerBar";
import { RecommendationCard } from "../../src/components/matchmaking/RecommendationCard";
import { DraftCompose } from "../../src/components/matchmaking/DraftCompose";
import { SendButton } from "../../src/components/ui/SendButton";

function TypingRow() {
  return (
    <View className="flex-row items-center gap-2 px-4 mb-3">
      <View className="w-6 h-6 rounded-full bg-red-600 items-center justify-center">
        <Text className="text-white text-[11px] font-bold">P</Text>
      </View>
      <View className="bg-gray-100 rounded-2xl rounded-tl-sm px-3.5 py-2.5">
        <Text className="text-gray-400 text-xs">Proxy is typing…</Text>
      </View>
    </View>
  );
}

export default function MatchmakingScreen() {
  const {
    messages,
    status,
    loading,
    needsAuth,
    error,
    isInitialized,
    init,
    startOver,
    answerQuestion,
    sendMessage,
    sendDraft,
    editAnswer,
  } = useChatStore();
  const [composerText, setComposerText] = useState("");
  const listRef = useRef(null);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length]);

  const handleSend = useCallback(() => {
    const text = composerText.trim();
    if (!text) return;
    setComposerText("");
    sendMessage(text);
  }, [composerText, sendMessage]);

  const lastMessage = messages[messages.length - 1];
  const activeQuestion = lastMessage?.question;
  const hasRecommendations = status === "recommendations_ready";

  if (needsAuth) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
        <Text className="text-lg font-bold text-gray-900 mb-1">Sign in to chat with Proxy</Text>
        <Text className="text-sm text-gray-500 text-center mb-6">
          Answer a few quick questions and get free personalized off-campus housing matches near WashU.
        </Text>
        <Link href="/(auth)/login" asChild>
          <Pressable className="bg-red-600 rounded-lg px-6 py-3">
            <Text className="text-white font-semibold text-sm">Sign in</Text>
          </Pressable>
        </Link>
      </SafeAreaView>
    );
  }

  if (!isInitialized || (loading && messages.length === 0)) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (error && messages.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={startOver} />}
        >
          <View className="flex-1 items-center justify-center mt-20 px-6">
            <Text className="text-gray-500 text-center mb-4">{error}</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <View className="flex-row items-center justify-between px-4 py-2.5 border-b border-gray-100">
        <Text className="text-sm font-semibold text-gray-900">Chat with Proxy</Text>
        <Pressable onPress={startOver} hitSlop={8}>
          <Text className="text-xs text-red-600 font-medium">Start over</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={8}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{ paddingVertical: 12, flexGrow: 1 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => (
            <View>
              <ChatBubble message={item} onEdit={item.questionId ? editAnswer : null} />
              {!!item.recommendations?.length && (
                <View className="px-4 mb-2 gap-2">
                  {item.recommendations.map((rec) => (
                    <RecommendationCard key={rec.listing_id} recommendation={rec} />
                  ))}
                </View>
              )}
              {!!item.draft && (
                <View className="px-4 mb-2">
                  <DraftCompose draft={item.draft} onSend={sendDraft} />
                </View>
              )}
            </View>
          )}
          ListFooterComponent={loading && !activeQuestion ? <TypingRow /> : null}
        />

        <View className="border-t border-gray-100 bg-white px-4 py-2.5">
          {activeQuestion ? (
            <AnswerBar question={activeQuestion} onAnswer={answerQuestion} />
          ) : hasRecommendations ? (
            <View className="flex-row items-center gap-2">
              <TextInput
                value={composerText}
                onChangeText={setComposerText}
                placeholder={loading ? "Proxy is typing…" : "Ask Proxy anything…"}
                editable={!loading}
                onSubmitEditing={handleSend}
                className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-full px-4 py-2.5"
              />
              <SendButton onPress={handleSend} disabled={loading || !composerText.trim()} />
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
