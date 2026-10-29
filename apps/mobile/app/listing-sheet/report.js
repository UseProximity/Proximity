// Report-reason list for a listing, presented as a native form sheet (see the
// "listing-sheet/report" screen in app/_layout.js) so iOS provides the swipe-down
// dismissal. Opened from the listing detail screen with the listing id. Same shape as
// the chat report sheet, plus an optional note. The reported landlord is not told.
import { useEffect, useRef, useState } from "react";
import { Alert, Keyboard, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LISTING_REPORT_DETAILS_MAX, LISTING_REPORT_REASONS } from "@proximity/shared";
import apiClient from "../../src/lib/apiClient";
import { getErrorMessage } from "../../src/lib/apiError";
import { showError } from "../../src/lib/showError";
import { ERROR_MESSAGES } from "../../src/lib/errorMessages";

export default function ListingReportSheet() {
  const { listingId } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [details, setDetails] = useState("");
  const [sending, setSending] = useState(false);

  // False once the sheet is gone (Cancel, or swiped down) while a report is still on its
  // way: a late answer must not pop whatever screen is then on top, or set state here.
  const isOpen = useRef(true);
  useEffect(() => {
    isOpen.current = true;
    return () => {
      isOpen.current = false;
    };
  }, []);

  const send = async (reason) => {
    setSending(true);
    Keyboard.dismiss();
    let result;
    try {
      result = await apiClient.listings.reportListing(listingId, { reason: reason.value, details: details.trim() });
    } catch (err) {
      // Dismissed while the request was out: the user walked away, so a failure is not
      // announced (a success still is, below, since the report was filed).
      if (!isOpen.current) return;
      setSending(false);
      if (err?.status === 401) {
        // The api client has signed out (or nobody was signed in). Nothing was reported, so
        // say so and offer sign in, as the listing screen does before opening this sheet.
        router.back();
        Alert.alert("Sign in to report", ERROR_MESSAGES.AUTH.SESSION_EXPIRED, [
          { text: "Cancel", style: "cancel" },
          { text: "Sign in", onPress: () => router.push("/(auth)/login") },
        ]);
        return;
      }
      showError(getErrorMessage(err, ERROR_MESSAGES.LISTINGS.REPORT_LISTING));
      return;
    }
    if (isOpen.current) router.back();
    if (result?.alreadyReported) {
      Alert.alert("Already reported", "You have already reported this listing.");
    } else {
      Alert.alert("Report submitted", "Thanks for letting us know.");
    }
  };

  const confirm = (reason) => {
    if (sending) return;
    Alert.alert("Report this listing?", `Reason: ${reason.label}`, [
      { text: "Cancel", style: "cancel" },
      { text: "Report", onPress: () => send(reason) },
    ]);
  };

  return (
    <View className="bg-white px-4 pt-8" style={{ paddingBottom: insets.bottom + 12 }}>
      <Text className="text-base font-bold text-gray-900 text-center">Report this listing</Text>
      <Text className="text-sm text-gray-500 text-center mt-1 mb-3 px-2">
        Why are you reporting it? The landlord won&apos;t be told.
      </Text>
      <TextInput
        className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white mb-3"
        placeholder="Add details (optional)"
        placeholderTextColor="#9ca3af"
        multiline
        value={details}
        onChangeText={(value) => setDetails(value.slice(0, LISTING_REPORT_DETAILS_MAX))}
        editable={!sending}
        maxLength={LISTING_REPORT_DETAILS_MAX}
        style={{ minHeight: 70, maxHeight: 110, textAlignVertical: "top" }}
      />
      <View className="bg-gray-50 rounded-2xl overflow-hidden">
        {LISTING_REPORT_REASONS.map((reason, index) => (
          <Pressable
            key={reason.value}
            onPress={() => confirm(reason)}
            disabled={sending}
            className={`px-4 justify-center active:bg-gray-100 ${
              index > 0 ? "border-t border-gray-200" : ""
            } ${sending ? "opacity-50" : ""}`}
            style={{ height: 52 }}
          >
            <Text className="text-base text-gray-900">{reason.label}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={() => router.back()} className="h-12 items-center justify-center mt-1">
        <Text className="text-base font-semibold text-gray-500">Cancel</Text>
      </Pressable>
    </View>
  );
}
