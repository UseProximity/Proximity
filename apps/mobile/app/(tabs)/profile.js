// Profile tab. Logged out: entry point into the (auth) login/signup flow
// (browsing itself never requires login, so this is the only place a user
// is prompted to sign in). Logged in: basic account info + logout. Saved
// listings and profile editing are still deferred to Phase 6.
import { ActivityIndicator, Pressable, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link } from "expo-router";
import { useAuth } from "../../src/hooks/useAuth";

export default function ProfileScreen() {
  const { user, isHydrated, logout } = useAuth();

  if (!isHydrated) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white px-8">
        <Text className="text-lg font-bold text-gray-900 mb-1">Sign in to Proximity</Text>
        <Text className="text-sm text-gray-500 text-center mb-6">
          Save listings and manage your profile once you're signed in.
        </Text>
        <Link href="/(auth)/login" asChild>
          <Pressable className="bg-gray-900 rounded-lg px-6 py-3">
            <Text className="text-white font-semibold text-sm">Sign in</Text>
          </Pressable>
        </Link>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white px-6 pt-8">
      <Text className="text-lg font-bold text-gray-900">{user.name}</Text>
      <Text className="text-sm text-gray-500 mt-0.5 mb-8">{user.email}</Text>
      <Pressable onPress={logout} className="bg-red-600 rounded-lg px-6 py-3 self-start">
        <Text className="text-white font-semibold text-sm">Log out</Text>
      </Pressable>
    </SafeAreaView>
  );
}
