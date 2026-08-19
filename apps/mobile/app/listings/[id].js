// Listing Detail. Single scrolling screen (not web's 5-tab sticky layout —
// scoped down for mobile v1). Reviews shown to everyone per the plan's
// decision (API is public/soft-auth); review voting/submission and driving
// times are deferred (auth / large separate feature).
//
// Visual-polish pass (design-system Stage I): back/heart moved from a
// separate white header bar into floating circular overlays on the hero
// carousel, and the carousel gained a "1 / N" pagination pill.
//
// Second polish pass: the content block below the hero is now a stack of
// white DetailCards on a light gray page background — Quick facts /
// Description / Amenities & Utilities / Location / Reviews / Contact
// landlord each get their own card — rather than one continuous page
// separated only by hairlines. Headline (title/address/price/rating) stays
// uncarded, directly on the page background, since it's the page's own
// title, not a content section.
//
// Third polish pass: `listing.leaseAvailability` was already the correct
// per-listing field (traced through getListing.js/deriveLeaseAvailability —
// it's a real server-derived union of that listing's own unit lease terms,
// not the static filter-options list), but it was rendered unlabeled
// ("summer" instead of "Summer") and mixed into the same badge pool as
// amenities/utilities. It's now mapped through LEASE_AVAILABILITY_FILTER_
// LABELS, and Amenities/Utilities are split into two labeled sub-groups
// within their own card.
//
// Fourth polish pass: the back button moved out of the hero into a
// persistent header (transparent over the hero, crossfades to a solid app
// bar on scroll — see `scrollY`/`heroPhase`/`solidPhase` below) so it's
// reachable at any scroll position, not just at the very top. The lease/
// walk-times row from the third pass was de-emphasized from tinted pills
// (`HighlightPill`, removed) to plain "Label · Value" text (`LabeledFact`),
// matching the visual weight of the beds/baths/sqft facts above it — still
// the same underlying data, just no longer reading as its own special
// category. All data, fetching, and handlers below are unchanged across
// every pass — only how they're grouped, labeled, and rendered.
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
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
import {
  ChevronLeft,
  BedDouble,
  Bath,
  Ruler,
  FileText,
  Tag,
  MapPin,
  Star,
  Mail,
} from "lucide-react-native";
import {
  getRentRangeLabel,
  getUnitValuesLabel,
  getAreaRangeLabel,
  getCampusWalkMinutes,
  AMENITY_LABELS,
  UTILITY_LABELS,
  LEASE_AVAILABILITY_FILTER_LABELS,
  WASHU_PLACES,
} from "@proximity/shared";
import apiClient from "../../src/lib/apiClient";
import { Badge } from "../../src/components/ui/Badge";
import { StarRating } from "../../src/components/ui/StarRating";
import { SectionHeader } from "../../src/components/ui/SectionHeader";
import { FieldLabel } from "../../src/components/ui/FieldLabel";
import { ReviewCard } from "../../src/components/listings/ReviewCard";
import { ListingDetailMap } from "../../src/components/listings/ListingDetailMap";
import { HeartIcon } from "../../src/components/ui/HeartIcon";
import { useFavoritesStore } from "../../src/store/favoritesStore";
import { useAuthStore } from "../../src/store/authStore";
import { colors, shadows } from "../../src/theme/tokens";

function walkTimesList(listing) {
  const pwm = listing.placeWalkMinutes;
  if (!pwm || typeof pwm !== "object") return [];
  return WASHU_PLACES.map((place) => ({ name: place.name, minutes: pwm[place.name] }))
    .filter((row) => Number.isFinite(row.minutes))
    .sort((a, b) => a.minutes - b.minutes);
}

function QuickFact({ icon: Icon, value, label }) {
  return (
    <View className="flex-1 items-center">
      <View className="flex-row items-center gap-1.5">
        <Icon size={16} color={colors.textSecondary} strokeWidth={2} />
        <Text className="text-sm font-semibold text-gray-900">{value}</Text>
      </View>
      <Text className="text-[11px] text-gray-500 mt-0.5">{label}</Text>
    </View>
  );
}

// Plain "Label · Value" secondary fact — lease type/terms and walk times.
// Deliberately not a tinted pill (an earlier pass tried that and it read as
// its own special category); this sits at the same small, muted visual
// weight as the rest of the app's secondary captions, differentiated only
// by its label prefix, not color or shape.
function LabeledFact({ label, value }) {
  return (
    <Text className="text-xs">
      <Text className="font-semibold text-gray-600">{label}</Text>
      <Text className="text-gray-400"> · </Text>
      <Text className="text-gray-500">{value}</Text>
    </Text>
  );
}

// The screen's single card treatment — white surface, container radius,
// a soft near-page-color border, the lighter `shadows.subtle` tier, generous
// padding — used for every major section below (Quick facts, Description,
// Amenities & Utilities, Location, Reviews, Contact landlord). Deliberately
// not used for smaller sub-pieces (e.g. a single walk-time row) — the goal
// is a handful of substantial, gently-lifted cards, not a screen full of
// heavy nested boxes.
function DetailCard({ children }) {
  return (
    <View className="bg-white rounded-2xl border border-gray-50 p-4" style={shadows.subtle}>
      {children}
    </View>
  );
}

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();

  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  // Drives the persistent header's crossfade from transparent (over the
  // hero) to a solid app bar as the user scrolls — measured against the
  // hero's real rendered height (via onLayout below) rather than a guessed
  // constant, so it adapts to different screen widths/aspect ratios. Two
  // opacity values (rather than interpolating color strings into the
  // third-party back icon) drive everything: `heroPhase` fades out the
  // hero-style chrome (translucent backdrop + white icon), `solidPhase`
  // fades in the app-bar chrome (white background + border + dark icon) —
  // both are plain `opacity` on `Animated.View`, the simplest and most
  // robust Animated primitive, no custom-component wrapping needed.
  const scrollY = useRef(new Animated.Value(0)).current;
  const [heroHeight, setHeroHeight] = useState(280);
  const fadeEnd = Math.max(heroHeight - 40, 40);
  const heroPhase = scrollY.interpolate({
    inputRange: [0, fadeEnd],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });
  const solidPhase = scrollY.interpolate({
    inputRange: [0, fadeEnd],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

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
      <SafeAreaView className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (error || !listing) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-gray-50 px-6">
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
    <SafeAreaView className="flex-1 bg-gray-50" edges={["top"]}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {/* Persistent header — transparent over the hero at rest, crossfades
            into a solid app bar as the page scrolls, so back navigation
            never scrolls out of reach. Sits outside the ScrollView so it
            never moves; the mainstream "collapsing header" pattern (Airbnb/
            Zillow-style listing screens) rather than a floating orphaned
            button. */}
        <View className="absolute top-0 left-0 right-0 z-10">
          <Animated.View
            className="absolute top-0 left-0 right-0 bottom-0 border-b border-gray-100"
            style={{ backgroundColor: colors.white, opacity: solidPhase }}
          />
          <View className="flex-row items-center h-14 px-3">
            <Pressable onPress={() => router.back()} hitSlop={4} className="w-10 h-10 items-center justify-center">
              <Animated.View
                className="absolute w-10 h-10 rounded-full items-center justify-center"
                style={{ backgroundColor: "rgba(0,0,0,0.4)", opacity: heroPhase }}
              >
                <ChevronLeft size={20} color="#ffffff" strokeWidth={2.5} />
              </Animated.View>
              <Animated.View className="items-center justify-center" style={{ opacity: solidPhase }}>
                <ChevronLeft size={20} color={colors.textPrimary} strokeWidth={2.5} />
              </Animated.View>
            </Pressable>
          </View>
        </View>

        <Animated.ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
          scrollEventThrottle={16}
        >
          {/* Hero — its own visual area, carousel with floating heart overlay + pagination pill */}
          <View className="relative" onLayout={(e) => setHeroHeight(e.nativeEvent.layout.height)}>
            {listing.images?.length > 0 ? (
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(e) => {
                  const { contentOffset, layoutMeasurement } = e.nativeEvent;
                  setActiveImageIndex(Math.round(contentOffset.x / layoutMeasurement.width));
                }}
              >
                {listing.images.map((url, i) => (
                  <Image
                    key={i}
                    source={{ uri: url }}
                    className="w-screen aspect-video bg-gray-100"
                    resizeMode="cover"
                  />
                ))}
              </ScrollView>
            ) : (
              <View className="w-full aspect-video bg-gray-100 items-center justify-center">
                <Text className="text-gray-400">No image</Text>
              </View>
            )}

            {/* No background container behind the heart — same thick white
                outline as ListingCard, sitting directly on the photo, with
                fill (not the outline) distinguishing saved from unsaved.
                HeartIcon's own Pressable still carries the 44x44 touch
                target via inline style. */}
            <View className="absolute top-3 right-3">
              <HeartIcon isSaved={isSaved} onPress={handleHeartPress} size="lg" onImage />
            </View>

            {listing.images?.length > 1 && (
              <View className="absolute bottom-3 right-3 bg-black/50 rounded-full px-2.5 py-1">
                <Text className="text-white text-xs font-semibold">
                  {activeImageIndex + 1} / {listing.images.length}
                </Text>
              </View>
            )}
          </View>

          {/* Headline — not a card, sits directly on the page background as the screen's own title */}
          <View className="px-4 pt-4 pb-2">
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
          </View>

          {/* Card stack — each major section is its own white, shadowed card on the light page background */}
          <View className="px-4 pb-4 gap-4">
            <DetailCard>
              <View className="flex-row items-center">
                <QuickFact icon={BedDouble} value={bedLabel} label="Beds" />
                <View className="w-px h-8 bg-gray-200" />
                <QuickFact icon={Bath} value={bathLabel} label="Baths" />
                <View className="w-px h-8 bg-gray-200" />
                <QuickFact icon={Ruler} value={areaLabel} label="Sq Ft" />
              </View>
              {(listing.leaseType ||
                listing.leaseAvailability?.length > 0 ||
                campusMin != null ||
                shuttleMin != null) && (
                <View className="flex-row flex-wrap gap-x-4 gap-y-1.5 mt-3 pt-3 border-t border-gray-100">
                  {listing.leaseType ? <LabeledFact label="Lease" value={listing.leaseType} /> : null}
                  {listing.leaseAvailability?.length > 0 && (
                    <LabeledFact
                      label="Terms"
                      value={listing.leaseAvailability.map((term) => LEASE_AVAILABILITY_FILTER_LABELS[term] ?? term).join(", ")}
                    />
                  )}
                  {campusMin != null && <LabeledFact label="Campus" value={`${campusMin} min`} />}
                  {shuttleMin != null && <LabeledFact label="Shuttle" value={`${shuttleMin} min`} />}
                </View>
              )}
            </DetailCard>

            {listing.description ? (
              <DetailCard>
                <SectionHeader icon={FileText} title="Description" />
                <Text className="text-sm text-gray-700 leading-relaxed">{listing.description}</Text>
              </DetailCard>
            ) : null}

            {(listing.amenities?.length > 0 || listing.utilitiesIncluded?.length > 0) && (
              <DetailCard>
                <SectionHeader icon={Tag} title="Amenities & Utilities" />
                {listing.amenities?.length > 0 && (
                  <View className="mb-3">
                    <FieldLabel>Amenities</FieldLabel>
                    <View className="flex-row flex-wrap gap-2">
                      {listing.amenities.map((a) => (
                        <Badge key={`amenity-${a}`} variant="outline">
                          {AMENITY_LABELS[a] ?? a}
                        </Badge>
                      ))}
                    </View>
                  </View>
                )}
                {listing.utilitiesIncluded?.length > 0 && (
                  <View>
                    <FieldLabel>Utilities Included</FieldLabel>
                    <View className="flex-row flex-wrap gap-2">
                      {listing.utilitiesIncluded.map((u) => (
                        <Badge key={`utility-${u}`} variant="outline">
                          {UTILITY_LABELS[u] ?? u}
                        </Badge>
                      ))}
                    </View>
                  </View>
                )}
              </DetailCard>
            )}

            <DetailCard>
              <SectionHeader icon={MapPin} title="Location" />
              <ListingDetailMap latitude={listing.latitude} longitude={listing.longitude} />
              {(walkRows.length > 0 || shuttleMin != null) && (
                <View className="mt-3">
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
            </DetailCard>

            <DetailCard>
              <SectionHeader
                icon={Star}
                title="Reviews"
                subtitle={reviews.length > 0 ? `${avgRating.toFixed(1)} · ${reviews.length} review${reviews.length === 1 ? "" : "s"}` : undefined}
              />
              {reviews.length === 0 ? (
                <Text className="text-sm text-gray-500">No reviews yet.</Text>
              ) : (
                reviews.map((review) => (
                  <ReviewCard key={review._id} review={review} ownerName={listing.owner?.name} />
                ))
              )}
            </DetailCard>

            <DetailCard>
              <SectionHeader icon={Mail} title="Contact landlord" />

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
                      className="flex-1 h-11 border border-gray-200 rounded-xl px-3 text-sm bg-white"
                      placeholder="First name"
                      value={contactForm.firstName}
                      onChangeText={(v) => setContactForm((f) => ({ ...f, firstName: v }))}
                      editable={!sending}
                    />
                    <TextInput
                      className="flex-1 h-11 border border-gray-200 rounded-xl px-3 text-sm bg-white"
                      placeholder="Last name"
                      value={contactForm.lastName}
                      onChangeText={(v) => setContactForm((f) => ({ ...f, lastName: v }))}
                      editable={!sending}
                    />
                  </View>
                  <TextInput
                    className="h-11 border border-gray-200 rounded-xl px-3 text-sm bg-white"
                    placeholder="Email"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={contactForm.email}
                    onChangeText={(v) => setContactForm((f) => ({ ...f, email: v }))}
                    editable={!sending}
                  />
                  <TextInput
                    className="h-11 border border-gray-200 rounded-xl px-3 text-sm bg-white"
                    placeholder="Phone (optional)"
                    keyboardType="phone-pad"
                    value={contactForm.phone}
                    onChangeText={(v) => setContactForm((f) => ({ ...f, phone: v }))}
                    editable={!sending}
                  />
                  <TextInput
                    className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white"
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
            </DetailCard>
          </View>
        </Animated.ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
