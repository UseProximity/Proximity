// Listing Detail. Single scrolling screen (not web's 5-tab sticky layout;
// scoped down for mobile v1). Reviews shown to everyone per the plan's
// decision (API is public/soft-auth); review voting/submission and driving
// times are deferred (auth / large separate feature).
//
// Visual-polish pass (design-system Stage I): back/heart moved from a
// separate white header bar into floating circular overlays on the hero
// carousel, and the carousel gained a "1 / N" pagination pill.
//
// Second polish pass: the content block below the hero is now a stack of
// white DetailCards on a light gray page background: Quick facts /
// Description / Amenities & Utilities / Location / Reviews / Contact
// landlord each get their own card, rather than one continuous page
// separated only by hairlines. Headline (title/address/price/rating) stays
// uncarded, directly on the page background, since it's the page's own
// title, not a content section.
//
// Third polish pass: `listing.leaseAvailability` was already the correct
// per-listing field (traced through getListing.js/deriveLeaseAvailability:
// it's a real server-derived union of that listing's own unit lease terms,
// not the static filter-options list), but it was rendered unlabeled
// ("summer" instead of "Summer") and mixed into the same badge pool as
// amenities/utilities. It's now mapped through LEASE_AVAILABILITY_FILTER_
// LABELS, and Amenities/Utilities are split into two labeled sub-groups
// within their own card.
//
// Fourth polish pass: the back button moved out of the hero into a
// persistent header (transparent over the hero, crossfades to a solid app
// bar on scroll; see `scrollY`/`heroPhase`/`solidPhase` below) so it's
// reachable at any scroll position, not just at the very top. The lease/
// walk-times row from the third pass was de-emphasized from tinted pills
// (`HighlightPill`, removed) to plain "Label · Value" text (`LabeledFact`),
// matching the visual weight of the beds/baths/sqft facts above it. It's still
// the same underlying data, just no longer reading as its own special
// category. All data, fetching, and handlers below are unchanged across
// every pass; only how they're grouped, labeled, and rendered.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
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
  buildUnitTabs,
} from "@proximity/shared";
import apiClient from "../../src/lib/apiClient";
import { Badge } from "../../src/components/ui/Badge";
import { Button } from "../../src/components/ui/Button";
import { ChatAvatar } from "../../src/components/chat/ChatAvatar";
import { CHAT_MAX_BODY, chatErrorMessage, defaultListingInquiry, isConfirmSend, leaseForChat } from "../../src/lib/chatFormat";
import { confirmSendAnyway } from "../../src/lib/chatConfirm";
import { StarRating } from "../../src/components/ui/StarRating";
import { BackToTopButton } from "../../src/components/ui/BackToTopButton";
import { SectionHeader } from "../../src/components/ui/SectionHeader";
import { FieldLabel } from "../../src/components/ui/FieldLabel";
import { ReviewCard } from "../../src/components/listings/ReviewCard";
import { SectionNav } from "../../src/components/listings/SectionNav";
import { UnitLeases } from "../../src/components/listings/UnitLeases";
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

// Persistent header bar and section chip row heights. Section jumps stop below
// both (plus a small gap) so the card heading is never covered.
const HEADER_HEIGHT = 56;
const NAV_HEIGHT = 44;
const SECTION_GAP = 8;
// Scroll distance after which the back-to-top button appears.
const BACK_TO_TOP_OFFSET = 600;

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

// Plain "Label · Value" secondary fact: lease type/terms and walk times.
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

// The screen's single card treatment: white surface, container radius,
// a soft near-page-color border, the lighter `shadows.subtle` tier, generous
// padding. It's used for every major section below (Quick facts, Description,
// Amenities & Utilities, Location, Reviews, Contact landlord). Deliberately
// not used for smaller sub-pieces (e.g. a single walk-time row); the goal
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
  // hero) to a solid app bar as the user scrolls, measured against the
  // hero's real rendered height (via onLayout below) rather than a guessed
  // constant, so it adapts to different screen widths/aspect ratios. Two
  // opacity values (rather than interpolating color strings into the
  // third-party back icon) drive everything: `heroPhase` fades out the
  // hero-style chrome (translucent backdrop + white icon), `solidPhase`
  // fades in the app-bar chrome (white background + border + dark icon);
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

  // Section navigation. Each card reports its y inside the card stack (onLayout
  // fires again whenever a card resizes, e.g. the map or reviews finishing), and
  // the stack reports its own y inside the scroll content. Jump targets are the
  // sum of the two, read at tap time, so nothing is hardcoded.
  const insets = useSafeAreaInsets();
  const stackY = useRef(0);
  const sectionY = useRef({});
  const [showNav, setShowNav] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const [activeSection, setActiveSection] = useState(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [messageFocusedState, setMessageFocusedState] = useState(false);
  const visibleKeys = useRef([]);
  // While a tapped chip's animated page scroll is under way, scroll events must
  // not move the highlight on to whichever section happens to pass by (or the
  // last one, when the page bottoms out). Cleared as soon as the user drags.
  const activeLockUntil = useRef(0);
  const heroHeightRef = useRef(280);
  heroHeightRef.current = heroHeight;

  const user = useAuthStore((state) => state.user);
  const isSaved = useFavoritesStore((state) => state.isSaved(id));
  const toggleFavorite = useFavoritesStore((state) => state.toggleFavorite);

  // In-app message to the landlord. The text is prefilled with the same opening
  // line as web and stays editable; `messageEdited` stops a re-render from
  // overwriting words the user has typed.
  const [messageText, setMessageText] = useState("");
  const [messageEdited, setMessageEdited] = useState(false);
  const [sending, setSending] = useState(false);
  const [messageError, setMessageError] = useState(null);

  // Keeps the message box in view when the keyboard opens. The page is a single
  // ScrollView inside a KeyboardAvoidingView, which shrinks the visible area but
  // does not scroll to the focused field, so once the keyboard has finished
  // appearing the page scrolls to its end, where the Message card sits.
  const scrollRef = useRef(null);
  const messageFocused = useRef(false);
  useEffect(() => {
    const subscription = Keyboard.addListener("keyboardDidShow", () => {
      setKeyboardOpen(true);
      if (messageFocused.current) scrollRef.current?.scrollToEnd({ animated: true });
    });
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => setKeyboardOpen(false));
    return () => {
      subscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    apiClient.listings
      .getListing(id)
      .then(setListing)
      .catch((err) => setError(err.message ?? "Failed to load listing"))
      .finally(() => setLoading(false));
  }, [id]);

  // Review safety. Wording mirrors the web ReviewsTab. A duplicate report is a
  // success on the server, so it reads the same as a first one here.
  async function handleReportReview(review) {
    try {
      await apiClient.listings.reportReview(review._id);
      Alert.alert("Report sent", "Thanks, we'll take a look at this review.");
    } catch (err) {
      if (err?.status === 401) return; // session expired: the api client already signed out
      Alert.alert("Couldn't send your report", "Please try again.");
    }
  }

  function handleBlockReviewAuthor(review) {
    Alert.alert(
      "Block user?",
      "Their reviews will no longer be visible to you.\n\nIf you want to unblock this user later, contact Proximity support at info@useproximity.org.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            try {
              await apiClient.listings.blockReviewAuthor(review._id);
            } catch (err) {
              if (err?.status === 401) return;
              Alert.alert("Couldn't block this user", "Please try again.");
              return;
            }
            // The server now sends this author's reviews score-only
            // (hiddenByBlock), so a refetch makes them disappear from the list.
            await apiClient.listings.getListing(id).then(setListing).catch(() => {});
            Alert.alert("User blocked successfully.");
          },
        },
      ]
    );
  }

  // Units and their leases, as on web. The first unit starts open; the lease the
  // message is about defaults to the open unit's first (cheapest) offering and
  // follows the Contact button on a landlord's card. A lease that is no longer
  // on the open unit (the unit changed, or the listing refetched) falls back to
  // that unit's first one.
  const unitTabs = useMemo(() => buildUnitTabs(listing?.unitTypes), [listing?.unitTypes]);
  const [selectedUnitIdx, setSelectedUnitIdx] = useState(0);
  const unitIdx = unitTabs[selectedUnitIdx] ? selectedUnitIdx : 0;
  const selectedUnit = unitTabs[unitIdx]?.unit ?? null;
  const selectedUnitLeases = useMemo(() => selectedUnit?.leases ?? [], [selectedUnit]);
  const [selectedLeaseId, setSelectedLeaseId] = useState(null);
  useEffect(() => {
    setSelectedLeaseId((current) =>
      current && selectedUnitLeases.some((l) => l.id === current) ? current : selectedUnitLeases[0]?.id ?? null
    );
  }, [selectedUnitLeases]);
  const selectedLease = selectedUnitLeases.find((l) => l.id === selectedLeaseId) ?? null;

  // Who the message goes to: the selected lease's landlord, falling back to the
  // listing owner for anything the lease does not name. The server routes the
  // chat by the lease id sent with it.
  const ownerName = listing?.owner?.name ?? null;
  const recipientName = selectedLease ? selectedLease.landlordName ?? ownerName : ownerName;
  const recipientImage = selectedLease ? selectedLease.landlordImage ?? listing?.owner?.image : listing?.owner?.image;
  useEffect(() => {
    if (messageEdited) return;
    setMessageText(defaultListingInquiry(recipientName));
  }, [recipientName, messageEdited]);

  async function handleStartChat(confirmed = false) {
    if (!listing) return;
    const body = messageText.trim();
    if (!body || sending) return;

    if (!user) {
      Alert.alert("Sign in required", "Sign in to message the landlord.", [
        { text: "Cancel", style: "cancel" },
        { text: "Sign In", onPress: () => router.push("/(auth)/login") },
      ]);
      return;
    }

    let confirmMessage = null;
    setSending(true);
    setMessageError(null);
    try {
      const lease = selectedLease ?? leaseForChat(listing);
      const result = await apiClient.chat.startListingChat({
        listingId: listing._id,
        body,
        leaseId: lease?.id,
        confirmed: confirmed === true,
      });
      setMessageEdited(false);
      router.push({
        pathname: "/chat/[threadId]",
        params: {
          threadId: result.threadId,
          name: lease?.landlordName ?? recipientName ?? "",
          listingTitle: listing.title ?? listing.address ?? "",
        },
      });
    } catch (err) {
      if (err?.status === 401) return; // session expired: the api client already signed out
      if (isConfirmSend(err)) {
        confirmMessage = err.body.error; // nothing was sent; the draft stays for Edit
      } else {
        setMessageError(chatErrorMessage(err, "Couldn't send your message. Please try again."));
      }
    } finally {
      setSending(false);
    }
    if (confirmMessage && (await confirmSendAnyway(confirmMessage))) {
      await handleStartChat(true);
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

  function handleScroll(e) {
    const y = e.nativeEvent.contentOffset.y;
    // Setting the same boolean again is a no-op, so this does not re-render on
    // every scroll tick.
    const navVisible = y > heroHeightRef.current - HEADER_HEIGHT;
    setShowNav(navVisible);
    setShowTop(y > BACK_TO_TOP_OFFSET);
    if (Date.now() < activeLockUntil.current) return;

    // Active chip: the last section whose top has reached the line just below
    // the pinned bars. Pinned to the last section at the very bottom, since a
    // short final card can never scroll up to that line.
    const { contentSize, layoutMeasurement } = e.nativeEvent;
    const atBottom = y + layoutMeasurement.height >= contentSize.height - 4;
    const line = y + HEADER_HEIGHT + NAV_HEIGHT + SECTION_GAP + 4;
    let current = null;
    const entries = Object.entries(sectionY.current).filter(([key]) => visibleKeys.current.includes(key));
    for (const [key, top] of entries) {
      if (stackY.current + top <= line && (current == null || top > sectionY.current[current])) current = key;
    }
    if (atBottom) {
      const keys = entries.map(([key]) => key);
      current = keys.reduce((a, b) => (a == null || sectionY.current[b] > sectionY.current[a] ? b : a), null);
    }
    setActiveSection(current);
  }

  function measureSection(key) {
    return (e) => {
      sectionY.current[key] = e.nativeEvent.layout.y;
    };
  }

  // Contact on a landlord's lease card: make that lease the one the message is
  // about, then bring the message card into view. The input is not focused.
  function handleContactLease(lease) {
    setSelectedLeaseId(lease.id);
    scrollToSection("message");
  }

  function scrollToSection(key) {
    const y = sectionY.current[key];
    if (y == null) return;
    const target = stackY.current + y - HEADER_HEIGHT - NAV_HEIGHT - SECTION_GAP;
    setActiveSection(key);
    activeLockUntil.current = Date.now() + 900;
    scrollRef.current?.scrollTo({ y: Math.max(0, target), animated: true });
  }

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
  // Rating and count use every review, as on web and the server: a blocked
  // author's review stays in the score, only its text is hidden.
  const visibleReviews = reviews.filter((r) => !r.hiddenByBlock);
  const avgRating = reviews.length > 0 ? reviews.reduce((sum, r) => sum + (r.rating ?? 0), 0) / reviews.length : 0;
  // The landlord can be messaged in-app (server-computed), and it isn't the
  // signed-in user's own listing. owner._id is null when the listing only has a
  // contact address and no landlord account yet; that is never "mine".
  const isOwnListing = !!user?.id && listing.owner?._id === user.id;
  const canMessage = listing.owner?.canChat === true && !isOwnListing;
  const hasAmenities = listing.amenities?.length > 0 || listing.utilitiesIncluded?.length > 0;
  // One chip per card that actually renders, in page order.
  const navSections = [
    unitTabs.length > 0 ? { key: "units", label: "Units & Leases" } : null,
    listing.description ? { key: "description", label: "Description" } : null,
    hasAmenities ? { key: "amenities", label: "Amenities & Utilities" } : null,
    { key: "location", label: "Location" },
    { key: "reviews", label: "Reviews" },
    canMessage ? { key: "message", label: "Contact" } : null,
  ].filter(Boolean);
  visibleKeys.current = navSections.map((section) => section.key);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={["top"]}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {/* Persistent header: transparent over the hero at rest, crossfades
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
          {showNav ? (
            <SectionNav
              sections={navSections}
              activeKey={activeSection}
              onSelect={scrollToSection}
              height={NAV_HEIGHT}
            />
          ) : null}
        </View>

        <Animated.ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 40 }}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false, listener: handleScroll })}
          scrollEventThrottle={16}
          onScrollBeginDrag={() => {
            activeLockUntil.current = 0;
          }}
        >
          {/* Hero: its own visual area, a carousel with floating heart overlay + pagination pill */}
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

            {/* No background container behind the heart: same thick white
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

          {/* Headline: not a card, sits directly on the page background as the screen's own title */}
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

          {canMessage ? (
            <View className="px-4 pb-2">
              <Button size="md" onPress={() => scrollToSection("message")}>
                Contact
              </Button>
            </View>
          ) : null}

          {/* Card stack: each major section is its own white, shadowed card on the light page background */}
          <View className="px-4 pb-4 gap-4" onLayout={(e) => { stackY.current = e.nativeEvent.layout.y; }}>
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

            {unitTabs.length > 0 ? (
              <View onLayout={measureSection("units")}>
                <UnitLeases
                  tabs={unitTabs}
                  selectedIdx={unitIdx}
                  onSelectIdx={setSelectedUnitIdx}
                  onContact={canMessage ? handleContactLease : undefined}
                />
              </View>
            ) : null}

            {listing.description ? (
              <View onLayout={measureSection("description")}>
              <DetailCard>
                <SectionHeader icon={FileText} title="Description" />
                <Text className="text-sm text-gray-700 leading-relaxed">{listing.description}</Text>
              </DetailCard>
              </View>
            ) : null}

            {hasAmenities && (
              <View onLayout={measureSection("amenities")}>
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
              </View>
            )}

            <View onLayout={measureSection("location")}>
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
            </View>

            <View onLayout={measureSection("reviews")}>
            <DetailCard>
              <SectionHeader
                icon={Star}
                title="Reviews"
                subtitle={reviews.length > 0 ? `${avgRating.toFixed(1)} · ${reviews.length} review${reviews.length === 1 ? "" : "s"}` : undefined}
              />
              {visibleReviews.length === 0 ? (
                <Text className="text-sm text-gray-500">No reviews yet.</Text>
              ) : (
                visibleReviews.map((review) => (
                  <ReviewCard
                    key={review._id}
                    review={review}
                    ownerName={listing.owner?.name}
                    onReport={user ? handleReportReview : undefined}
                    onBlock={user ? handleBlockReviewAuthor : undefined}
                  />
                ))
              )}
            </DetailCard>
            </View>

            {canMessage ? (
              <View onLayout={measureSection("message")}>
              <DetailCard>
                <SectionHeader icon={Mail} title="Message the landlord" />

                <View className="gap-2.5">
                  <View className="flex-row items-center gap-2.5">
                    <ChatAvatar name={recipientName} image={recipientImage} size={36} />
                    <View className="flex-1">
                      <Text className="text-[11px] text-gray-400">Message to</Text>
                      <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
                        {recipientName ?? "Property manager"}
                      </Text>
                    </View>
                  </View>

                  <TextInput
                    className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                    placeholder={defaultListingInquiry(recipientName)}
                    multiline
                    numberOfLines={4}
                    value={messageText}
                    onChangeText={(value) => {
                      setMessageEdited(true);
                      setMessageText(value.slice(0, CHAT_MAX_BODY));
                    }}
                    editable={!sending}
                    onFocus={() => {
                      messageFocused.current = true;
                      setMessageFocusedState(true);
                    }}
                    onBlur={() => {
                      messageFocused.current = false;
                      setMessageFocusedState(false);
                    }}
                    style={{ minHeight: 90, maxHeight: 160, textAlignVertical: "top" }}
                  />

                  {messageError ? <Text className="text-red-500 text-xs">{messageError}</Text> : null}

                  <Button onPress={() => handleStartChat()} loading={sending} disabled={!messageText.trim()}>
                    Send message
                  </Button>
                </View>
              </DetailCard>
              </View>
            ) : null}
          </View>
        </Animated.ScrollView>

        {showTop && !keyboardOpen && !messageFocusedState ? (
          <BackToTopButton
            bottom={insets.bottom + 16}
            onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
          />
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
