// Listing Detail. Single scrolling screen (not web's 5-tab sticky layout —
// scoped down for mobile v1). Reviews shown to everyone per the plan's
// decision (API is public/soft-auth); review voting/submission and driving
// times are deferred (auth / large separate feature).
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft, Footprints } from "lucide-react-native";
import {
  getRentRangeLabel,
  getUnitValuesLabel,
  getAreaRangeLabel,
  getCampusWalkMinutes,
  AMENITY_LABELS,
  UTILITY_LABELS,
  WASHU_PLACES,
} from "@proximity/shared";
import apiClient from "../../src/lib/apiClient";
import { Badge } from "../../src/components/ui/Badge";
import { StarRating } from "../../src/components/ui/StarRating";
import { ReviewCard } from "../../src/components/listings/ReviewCard";
import { ListingDetailMap } from "../../src/components/listings/ListingDetailMap";
import { HeartIcon } from "../../src/components/ui/HeartIcon";
import { useFavoritesStore } from "../../src/store/favoritesStore";
import { useAuthStore } from "../../src/store/authStore";
import { colors } from "../../src/theme/tokens";

function walkTimesList(listing) {
  const pwm = listing.placeWalkMinutes;
  if (!pwm || typeof pwm !== "object") return [];
  return WASHU_PLACES.map((place) => ({ name: place.name, minutes: pwm[place.name] }))
    .filter((row) => Number.isFinite(row.minutes))
    .sort((a, b) => a.minutes - b.minutes);
}

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();

  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const user = useAuthStore((state) => state.user);
  const isSaved = useFavoritesStore((state) => state.isSaved(id));
  const toggleFavorite = useFavoritesStore((state) => state.toggleFavorite);

  const [contactForm, setContactForm] = useState({ firstName: "", lastName: "", email: "", phone: "", message: "" });
  const [sending, setSending] = useState(false);
  const [contactError, setContactError] = useState(null);
  const [contactSent, setContactSent] = useState(false);

  useEffect(() => {
    apiClient.listings
      .getListing(id)
      .then(setListing)
      .catch((err) => setError(err.message ?? "Failed to load listing"))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleContactSubmit() {
    if (!listing) return;
    setSending(true);
    setContactError(null);
    try {
      await apiClient.contactLandlord.contactLandlord({
        ...contactForm,
        listingId: listing._id,
        landlordEmail: listing.contactEmail ?? listing.owner?.email,
        landlordName: listing.contactName ?? listing.owner?.name,
        listingAddress: listing.address,
      });
      setContactSent(true);
    } catch (err) {
      setContactError(err.message ?? "Failed to send message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  const handleHeartPress = async () => {
    if (!user) {
      Alert.alert(
        "Sign in required",
        "Sign in to save listings and access them anytime.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Sign In", onPress: () => router.push("/(auth)/login") },
        ]
      );
      return;
    }

    try {
      await toggleFavorite(id, listing);
    } catch (error) {
      Alert.alert("Error", "Failed to update favorites. Please try again.");
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (error || !listing) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-gray-500 text-center">{error ?? "Listing not found."}</Text>
        <Pressable onPress={() => router.back()} className="mt-4">
          <Text className="text-red-600 font-medium">Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const rentLabel = getRentRangeLabel(listing.unitTypes);
  const bedLabel = getUnitValuesLabel(listing.unitTypes, "bedrooms");
  const bathLabel = getUnitValuesLabel(listing.unitTypes, "bathrooms");
  const areaLabel = getAreaRangeLabel(listing.unitTypes);
  const campusMin = getCampusWalkMinutes(listing.placeWalkMinutes);
  const shuttleMin = typeof listing.shuttleWalkMinutes === "number" ? listing.shuttleWalkMinutes : null;
  const walkRows = walkTimesList(listing);
  const reviews = listing.reviews ?? [];
  const avgRating = reviews.length > 0 ? reviews.reduce((sum, r) => sum + (r.rating ?? 0), 0) / reviews.length : 0;

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-100">
          <Pressable onPress={() => router.back()} hitSlop={12} className="flex-row items-center">
            <ChevronLeft size={18} color={colors.primary} strokeWidth={2.5} />
            <Text className="text-red-600 text-base">Back</Text>
          </Pressable>
          <HeartIcon isSaved={isSaved} onPress={handleHeartPress} size="2xl" />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {listing.images?.length > 0 ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
              {listing.images.map((url, i) => (
                <Image key={i} source={{ uri: url }} className="w-screen aspect-video bg-gray-100" resizeMode="cover" />
              ))}
            </ScrollView>
          ) : (
            <View className="w-full aspect-video bg-gray-100 items-center justify-center">
              <Text className="text-gray-400">No image</Text>
            </View>
          )}

          <View className="p-4">
            <Text className="text-xl font-bold text-gray-900">{listing.title || listing.address}</Text>
            <Text className="text-sm text-gray-500 mt-1">{listing.address}</Text>

            <View className="flex-row items-center justify-between mt-3">
              <Text className="text-lg font-bold text-gray-900">
                {rentLabel}
                {rentLabel !== "Contact for Pricing" && <Text className="text-sm font-normal">/mo</Text>}
              </Text>
              {reviews.length > 0 && (
                <View className="flex-row items-center gap-1.5">
                  <StarRating rating={Math.round(avgRating)} />
                  <Text className="text-xs text-gray-400">({reviews.length})</Text>
                </View>
              )}
            </View>

            <Text className="text-sm text-gray-600 mt-1">
              {bedLabel} bed · {bathLabel} bath · {areaLabel} sq ft
              {listing.leaseType ? ` · ${listing.leaseType}` : ""}
            </Text>

            {(campusMin != null || shuttleMin != null) && (
              <View className="flex-row gap-4 mt-2">
                {campusMin != null && (
                  <View className="flex-row items-center gap-1">
                    <Footprints size={13} color={colors.textSecondary} strokeWidth={2} />
                    <Text className="text-xs text-gray-500">{campusMin} min to campus</Text>
                  </View>
                )}
                {shuttleMin != null && (
                  <View className="flex-row items-center gap-1">
                    <Footprints size={13} color={colors.textSecondary} strokeWidth={2} />
                    <Text className="text-xs text-gray-500">{shuttleMin} min to shuttle</Text>
                  </View>
                )}
              </View>
            )}

            {listing.description ? (
              <Text className="text-sm text-gray-700 leading-relaxed mt-4">{listing.description}</Text>
            ) : null}

            {(listing.leaseAvailability?.length > 0 || listing.amenities?.length > 0 || listing.utilitiesIncluded?.length > 0) && (
              <View className="mt-4">
                <Text className="text-base font-bold text-gray-900 mb-2">Details</Text>
                <View className="flex-row flex-wrap gap-2">
                  {(listing.leaseAvailability ?? []).map((term) => (
                    <Badge key={`lease-${term}`} variant="secondary">
                      {term}
                    </Badge>
                  ))}
                  {(listing.amenities ?? []).map((a) => (
                    <Badge key={`amenity-${a}`} variant="outline">
                      {AMENITY_LABELS[a] ?? a}
                    </Badge>
                  ))}
                  {(listing.utilitiesIncluded ?? []).map((u) => (
                    <Badge key={`utility-${u}`} variant="outline">
                      {UTILITY_LABELS[u] ?? u} included
                    </Badge>
                  ))}
                </View>
              </View>
            )}

            <View className="mt-5">
              <Text className="text-base font-bold text-gray-900 mb-2">Location</Text>
              <ListingDetailMap latitude={listing.latitude} longitude={listing.longitude} />
            </View>

            {walkRows.length > 0 && (
              <View className="mt-5">
                <Text className="text-base font-bold text-gray-900 mb-2">Places</Text>
                {walkRows.map((row) => (
                  <View key={row.name} className="flex-row items-center justify-between py-2 border-b border-gray-100">
                    <Text className="text-sm text-gray-700 flex-1">{row.name}</Text>
                    <Text className="text-sm text-gray-500">{row.minutes} min</Text>
                  </View>
                ))}
                {shuttleMin != null && (
                  <View className="flex-row items-center justify-between py-2 border-b border-gray-100">
                    <Text className="text-sm text-gray-700 flex-1">Nearest shuttle stop</Text>
                    <Text className="text-sm text-gray-500">{shuttleMin} min</Text>
                  </View>
                )}
              </View>
            )}

            <View className="mt-5">
              <Text className="text-base font-bold text-gray-900 mb-2">
                Reviews {reviews.length > 0 ? `(${reviews.length})` : ""}
              </Text>
              {reviews.length === 0 ? (
                <Text className="text-sm text-gray-500">No reviews yet.</Text>
              ) : (
                reviews.map((review) => (
                  <ReviewCard key={review._id} review={review} ownerName={listing.owner?.name} />
                ))
              )}
            </View>

            <View className="mt-6 pt-5 border-t border-gray-200">
              <Text className="text-base font-bold text-gray-900 mb-3">Contact landlord</Text>

              {contactSent ? (
                <View className="bg-green-50 rounded-lg p-4">
                  <Text className="text-green-700 text-sm font-medium">
                    Message sent! The landlord will reach out to you directly.
                  </Text>
                </View>
              ) : (
                <View className="gap-2.5">
                  <View className="flex-row gap-2.5">
                    <TextInput
                      className="flex-1 h-11 border border-gray-200 rounded-xl px-3 text-sm"
                      placeholder="First name"
                      value={contactForm.firstName}
                      onChangeText={(v) => setContactForm((f) => ({ ...f, firstName: v }))}
                      editable={!sending}
                    />
                    <TextInput
                      className="flex-1 h-11 border border-gray-200 rounded-xl px-3 text-sm"
                      placeholder="Last name"
                      value={contactForm.lastName}
                      onChangeText={(v) => setContactForm((f) => ({ ...f, lastName: v }))}
                      editable={!sending}
                    />
                  </View>
                  <TextInput
                    className="h-11 border border-gray-200 rounded-xl px-3 text-sm"
                    placeholder="Email"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={contactForm.email}
                    onChangeText={(v) => setContactForm((f) => ({ ...f, email: v }))}
                    editable={!sending}
                  />
                  <TextInput
                    className="h-11 border border-gray-200 rounded-xl px-3 text-sm"
                    placeholder="Phone (optional)"
                    keyboardType="phone-pad"
                    value={contactForm.phone}
                    onChangeText={(v) => setContactForm((f) => ({ ...f, phone: v }))}
                    editable={!sending}
                  />
                  <TextInput
                    className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
                    placeholder="Message"
                    multiline
                    numberOfLines={4}
                    value={contactForm.message}
                    onChangeText={(v) => setContactForm((f) => ({ ...f, message: v }))}
                    editable={!sending}
                    style={{ minHeight: 90, textAlignVertical: "top" }}
                  />

                  {contactError ? <Text className="text-red-500 text-xs">{contactError}</Text> : null}

                  <Pressable
                    onPress={handleContactSubmit}
                    disabled={sending}
                    className={`h-11 rounded-xl items-center justify-center mt-1 ${sending ? "bg-gray-300" : "bg-red-600"}`}
                  >
                    {sending ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text className="text-white font-semibold text-sm">Send message</Text>
                    )}
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
