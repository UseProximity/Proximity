// Bottom tab navigator. Tabs: Browse, Chat, Saved, Profile. Icons/colors
// per design-system/MASTER.md §7 — active tab uses `primary`, inactive uses
// `textMuted`, icons from the shared Lucide set (§6). Flagged during Stage F
// review and folded in here (design-system/../../.claude/plans's Stage G
// addendum) since this file had no icon logic in code at all before.
import { Tabs } from "expo-router";
import { Heart, MessageCircle, Search, User } from "lucide-react-native";
import { colors } from "../../src/theme/tokens";

const TAB_ICONS = {
  index: Search,
  chat: MessageCircle,
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
          tabBarIcon: ({ color, size }) => <Icon color={color} size={size} strokeWidth={2} />,
        };
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Browse" }} />
      <Tabs.Screen name="chat" options={{ title: "Chat" }} />
      <Tabs.Screen name="saved" options={{ title: "Saved" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
