// Bottom tab navigator: Browse | Saved/My Listings | Matchmaking | Chat | Profile.
// Icons/colors per design-system/MASTER.md §7 — active tab uses `primary`,
// inactive uses `textMuted`, icons from the shared Lucide set (§6). All tabs
// use the same flat icon treatment (Stage H's raised/logo-mark treatment for
// Matchmaking was tried and reverted after on-device review — it read as too
// special-cased rather than consistent with the rest).
//
// The second tab is role-dependent: students get Saved (favorited listings),
// landlords get My Listings (their own properties) instead — same slot, same
// position in both orderings, per the profile-split plan's mobile-focused
// landlord experience. Both routes must stay declared as Tabs.Screen — Expo
// Router auto-registers every file under (tabs)/ as a tab regardless of
// whether it's explicitly declared, so simply omitting one from JSX doesn't
// hide it, it just falls back to a default tab appended at the end (this bit
// us: a 6th, undeclared tab was showing up last for whichever role's screen
// got omitted). `options.href: null` is the actual, documented way to hide a
// declared tab from the bar while keeping its route valid — each screen also
// keeps its own role gate as a safety net (see my-listings.js).
import { Tabs } from "expo-router";
import { Building2, Heart, MessageCircle, Search, Sparkles, User } from "lucide-react-native";
import { isLandlord } from "@proximity/auth-core";
import { useAuthStore } from "../../src/store/authStore";
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
      <Tabs.Screen name="chat" options={{ title: "Chat" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
