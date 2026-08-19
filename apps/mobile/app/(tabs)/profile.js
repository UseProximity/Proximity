// Profile tab - Enhanced with full user management
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import { ChevronRight, FileText, Home, LogOut, Lock, Pencil, ShieldCheck, Info, User } from "lucide-react-native";
import { useAuth } from "../../src/hooks/useAuth";
import { useFavoritesStore } from "../../src/store/favoritesStore";
import { colors } from "../../src/theme/tokens";

function ProfileSection({ title, children }) {
  return (
    <View className="mb-6">
      <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 px-1">
        {title}
      </Text>
      <View className="bg-white rounded-2xl border border-gray-200">
        {children}
      </View>
    </View>
  );
}

function MenuItem({ label, icon: Icon, onPress, destructive = false, showBorder = true }) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center justify-between px-4 py-3.5 ${showBorder ? "border-b border-gray-100" : ""}`}
    >
      <View className="flex-row items-center gap-3">
        <Icon size={18} color={destructive ? colors.primary : colors.textSecondary} strokeWidth={2} />
        <Text className={`text-sm font-medium ${destructive ? "text-red-600" : "text-gray-900"}`}>
          {label}
        </Text>
      </View>
      <ChevronRight size={18} color={colors.textMuted} strokeWidth={2} />
    </Pressable>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { user, isHydrated, logout } = useAuth();
  const savedListings = useFavoritesStore((state) => state.savedListings);

  const handleLogout = () => {
    Alert.alert(
      "Log out",
      "Are you sure you want to log out?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log out",
          style: "destructive",
          onPress: () => logout(),
        },
      ]
    );
  };

  if (!isHydrated) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-gray-50 px-8">
        <View className="w-20 h-20 rounded-full bg-gray-200 items-center justify-center mb-4">
          <User size={32} color={colors.textMuted} strokeWidth={1.5} />
        </View>
        <Text className="text-lg font-bold text-gray-900 mb-1">Sign in to Proximity</Text>
        <Text className="text-sm text-gray-500 text-center mb-6">
          Save listings and manage your profile once you're signed in.
        </Text>
        <Link href="/(auth)/login" asChild>
          <Pressable className="bg-red-600 rounded-xl px-6 py-3">
            <Text className="text-white font-semibold text-sm">Sign in</Text>
          </Pressable>
        </Link>
      </SafeAreaView>
    );
  }

  // Get initials from name
  const initials = user.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "U";

  const roleLabel = user.role === "landlord" ? "Landlord" : user.role === "super" ? "Admin" : "Student";
  const roleColor = user.role === "landlord" ? "bg-blue-100 text-blue-700" : user.role === "super" ? "bg-purple-100 text-purple-700" : "bg-green-100 text-green-700";

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 12 }}>
        {/* Header with avatar */}
        <View className="items-center mb-6">
          <View className="w-20 h-20 rounded-full bg-red-600 items-center justify-center mb-3">
            <Text className="text-white text-2xl font-bold">{initials}</Text>
          </View>
          <Text className="text-xl font-bold text-gray-900">{user.name}</Text>
          <Text className="text-sm text-gray-500 mt-0.5">{user.email}</Text>
          <View className={`mt-2 px-3 py-1 rounded-full ${roleColor}`}>
            <Text className="text-xs font-semibold">{roleLabel}</Text>
          </View>
        </View>

        {/* Stats */}
        <Pressable
          onPress={() => router.push("/(tabs)/saved")}
          className="bg-white rounded-2xl border border-gray-200 p-4 mb-6"
        >
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-2xl font-bold text-gray-900">{savedListings.length}</Text>
              <Text className="text-sm text-gray-500 mt-0.5">Saved Listings</Text>
            </View>
            <ChevronRight size={18} color={colors.textMuted} strokeWidth={2} />
          </View>
        </Pressable>

        {/* Account Section */}
        <ProfileSection title="Account">
          <MenuItem label="Edit Profile" icon={Pencil} onPress={() => router.push("/profile/edit")} />
          <MenuItem label="Change Password" icon={Lock} onPress={() => router.push("/profile/change-password")} showBorder={false} />
        </ProfileSection>

        {/* Landlord Section */}
        {(user.role === "landlord" || user.role === "super") && (
          <ProfileSection title="Landlord">
            <MenuItem label="Add Listing" icon={Home} onPress={() => router.push("/listings/add")} showBorder={false} />
          </ProfileSection>
        )}

        {/* About Section */}
        <ProfileSection title="About">
          <MenuItem label="Terms of Service" icon={FileText} onPress={() => {}} />
          <MenuItem label="Privacy Policy" icon={ShieldCheck} onPress={() => {}} />
          <MenuItem
            label="Version 1.0.0"
            icon={Info}
            onPress={() => {}}
            showBorder={false}
          />
        </ProfileSection>

        {/* Logout */}
        <View className="bg-white rounded-2xl border border-gray-200">
          <MenuItem label="Log out" icon={LogOut} onPress={handleLogout} destructive showBorder={false} />
        </View>

        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}
