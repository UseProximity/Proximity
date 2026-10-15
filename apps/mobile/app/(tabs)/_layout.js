// Bottom tab navigator: Browse | Saved/My Listings | Matchmaking | Chat | Profile.
// Icons/colors per design-system/MASTER.md §7: active tab uses `primary`,
// inactive uses `textMuted`, icons from the shared Lucide set (§6). All tabs
// use the same flat icon treatment (Stage H's raised/logo-mark treatment for
// Matchmaking was tried and reverted after on-device review, since it read as too
// special-cased rather than consistent with the rest).
//
// The second tab is role-dependent: students get Saved (favorited listings),
// landlords get My Listings (their own properties) instead, taking the same slot and the same
// position in both orderings, per the profile-split plan's mobile-focused
// landlord experience. Both routes must stay declared as Tabs.Screen, because Expo
// Router auto-registers every file under (tabs)/ as a tab regardless of
// whether it's explicitly declared, so simply omitting one from JSX doesn't
// hide it, it just falls back to a default tab appended at the end (this bit
// us: a 6th, undeclared tab was showing up last for whichever role's screen
// got omitted). `options.href: null` is the actual, documented way to hide a
// declared tab from the bar while keeping its route valid. Each screen also
// keeps its own role gate as a safety net (see my-listings.js).
import { useEffect } from "react";
import { AppState } from "react-native";
import { Tabs } from "expo-router";
import { Building2, Heart, MessageCircle, Search, Sparkles, User } from "lucide-react-native";
import { isLandlord } from "@proximity/auth-core";
import { useAuthStore } from "../../src/store/authStore";
import { useChatUnreadStore } from "../../src/store/chatUnreadStore";
import { startChatRealtime, stopChatRealtime, subscribeInbox } from "../../src/lib/chatRealtime";
import { colors } from "../../src/theme/tokens";

const TAB_ICONS = {
  index: Search,
  saved: Heart,
  "my-listings": Building2,
  matchmaking: Sparkles,
  chat: MessageCircle,
  profile: User,
};

export default function TabsLayout() {
  const user = useAuthStore((state) => state.user);
  const landlord = isLandlord(user?.role);

  // Unread badge on the Chat tab. Loaded from the server when the user is known
  // and again whenever the app returns to the foreground; cleared on sign-out.
  const userId = user?.id;
  const unreadCount = useChatUnreadStore((state) => state.unreadCount);
  useEffect(() => {
    const { refresh, reset } = useChatUnreadStore.getState();
    if (!userId) {
      reset();
      return undefined;
    }
    refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => subscription.remove();
  }, [userId]);

  // Realtime: one connection for the signed-in user, opened here so the badge is
  // live on every tab and closed on sign-out. A new message (or a reconnect,
  // which may have missed some) triggers a debounced refetch; the REST refresh
  // above stays as the fallback if the socket is down.
  useEffect(() => {
    if (!userId) return undefined;
    startChatRealtime(userId);

    let timer = null;
    let lastThreadId;
    const schedule = (threadId) => {
      // Several messages in a burst collapse into one refetch; a mix of
      // threads means "any".
      lastThreadId = timer && lastThreadId !== threadId ? undefined : threadId;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        useChatUnreadStore.getState().notifyInboxChanged(lastThreadId);
      }, 400);
    };
    const unsubscribe = subscribeInbox({
      onInsert: (message) => schedule(message.threadId),
      onSubscribed: () => schedule(undefined),
    });

    return () => {
      clearTimeout(timer);
      unsubscribe();
      stopChatRealtime();
    };
  }, [userId]);

  return (
    <Tabs
      screenOptions={({ route }) => {
        const Icon = TAB_ICONS[route.name];
        return {
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarIcon: Icon ? ({ color, size }) => <Icon color={color} size={size} strokeWidth={2} /> : undefined,
        };
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Browse" }} />
      <Tabs.Screen name="saved" options={{ title: "Saved", href: landlord ? null : undefined }} />
      <Tabs.Screen name="my-listings" options={{ title: "Listings", href: landlord ? undefined : null }} />
      <Tabs.Screen name="matchmaking" options={{ title: "Matchmaking" }} />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          tabBarBadge: unreadCount > 0 ? (unreadCount > 99 ? "99+" : unreadCount) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.primary, color: colors.white, fontSize: 11 },
        }}
      />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
