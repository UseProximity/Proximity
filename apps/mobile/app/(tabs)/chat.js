// Placeholder Chat tab. The real matchmaking/Proxy chat experience lives at
// matchmaking.js (this route used to hold it — renamed in Stage H once a
// genuine, separate future Chat feature needed its own tab). This screen is
// intentionally empty: no state, no API calls, no chat UI — just a
// design-system-consistent "coming soon" empty state (icon in `textMuted` +
// one-line message in `textSecondary`, per design-system/MASTER.md §7).
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MessageCircle } from "lucide-react-native";
import { colors } from "../../src/theme/tokens";

export default function ChatScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
      <View className="mb-4">
        <MessageCircle size={40} color={colors.textMuted} strokeWidth={1.5} />
      </View>
      <Text className="text-lg font-bold text-gray-900 mb-1">Chat is coming soon</Text>
      <Text className="text-sm text-gray-500 text-center">
        Direct messaging with landlords and other students is on the way.
      </Text>
    </SafeAreaView>
  );
}
