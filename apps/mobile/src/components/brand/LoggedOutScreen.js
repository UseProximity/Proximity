import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { BrandMark } from "./BrandMark";
import { Button } from "../ui/Button";

// The one layout every logged-out tab (Profile, Chat, Saved) shares: the logo
// with its rings, the screen's headline and description, then Sign in and
// Create account. Only `title` and `description` vary between tabs.
export function LoggedOutScreen({ title, description }) {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 32, paddingVertical: 24 }}
      >
        <View className="items-center">
          <BrandMark size={72} rings={3} />
          <Text className="text-xs font-semibold tracking-[3px] text-red-600 uppercase mt-4">Proximity</Text>
          <Text accessibilityRole="header" className="text-[26px] font-bold tracking-tight text-gray-900 text-center mt-3">
            {title}
          </Text>
          <Text className="text-base leading-6 text-gray-500 text-center mt-2 max-w-[320px]">{description}</Text>
        </View>

        <View className="gap-3 mt-9">
          <Button size="lg" onPress={() => router.push("/(auth)/login")}>
            Sign in
          </Button>
          <Button size="lg" variant="secondary" onPress={() => router.push("/(auth)/signup")}>
            Create account
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
