// Bottom tab navigator: Browse | Chat | Matchmaking | Saved | Profile.
// Icons/colors per design-system/MASTER.md §7 — active tab uses `primary`,
// inactive uses `textMuted`, icons from the shared Lucide set (§6). All 5
// tabs use the same flat icon treatment (Stage H's raised/logo-mark
// treatment for Matchmaking was tried and reverted after on-device review —
// it read as too special-cased rather than consistent with the other 4).
import { Tabs } from "expo-router";
import { Heart, MessageCircle, Search, Sparkles, User } from "lucide-react-native";
import { colors } from "../../src/theme/tokens";

const TAB_ICONS = {
  index: Search,
  chat: MessageCircle,
  matchmaking: Sparkles,
  saved: Heart,
  profile: User,
};

export default function TabsLayout() {
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
      <Tabs.Screen name="chat" options={{ title: "Chat" }} />
      <Tabs.Screen name="matchmaking" options={{ title: "Matchmaking" }} />
      <Tabs.Screen name="saved" options={{ title: "Saved" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
