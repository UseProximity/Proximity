import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import { colors } from "../../theme/tokens";
import { BrandHeader } from "./BrandHeader";

// Shared frame for the sign-in and sign-up screens: safe area, keyboard
// avoidance and scrolling (so small phones and the open keyboard never hide the
// form), then the branding block, then the screen's own content. `top` renders
// above the branding (e.g. a back link); `compact` shrinks the branding for
// short, text-only states. `onBack` adds a back chevron pinned to the top-left,
// above the scrolling content; `backLabel` puts a text label beside it.
export function AuthScreen({ top = null, compact = false, onBack = null, backLabel = null, children }) {
  return (
    <SafeAreaView className="flex-1 bg-white">
      {onBack ? (
        <View className="flex-row px-2 pt-1">
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={backLabel ?? "Go back"}
            hitSlop={8}
            className="flex-row items-center p-2"
          >
            <ChevronLeft size={24} color={colors.textPrimary} strokeWidth={2} />
            {backLabel ? <Text className="text-[15px] font-medium text-gray-900">{backLabel}</Text> : null}
          </Pressable>
        </View>
      ) : null}
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 28, paddingVertical: 24 }}
        >
          {top}
          <View className={compact ? "mb-6" : "mb-8"}>
            <BrandHeader compact={compact} />
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
