// Add Listing wizard shell. Architecture mirrors
// apps/web/src/components/listings/wizard/AddListingWizard.js: one
// centralized form-state object (not step-local state), validateStep() per
// step, full re-validation on publish. PMS/website-import (web's "Start"
// step) is out of scope for v1 — the wizard opens directly on Address.
//
// No disk-based autosave (web uses localStorage; mobile has no AsyncStorage
// dependency installed and expo-secure-store's size ceiling is too small for
// a multi-unit draft) — the draft lives in React state only.
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { emptyUnit } from "@proximity/shared";
import { useAuth } from "../../../src/hooks/useAuth";
import apiClient from "../../../src/lib/apiClient";
import { pickImages, compressImage, uploadImages } from "../../../src/lib/imageUpload";
import { Button } from "../../../src/components/ui/Button";
import { getErrorMessage } from "../../../src/lib/apiError";
import StepAddress from "../../../src/components/listings/wizard/StepAddress";
import StepBasics from "../../../src/components/listings/wizard/StepBasics";
import StepUnits from "../../../src/components/listings/wizard/StepUnits";
import StepPerks from "../../../src/components/listings/wizard/StepPerks";
import StepPhotos from "../../../src/components/listings/wizard/StepPhotos";
import StepDescription from "../../../src/components/listings/wizard/StepDescription";
import StepReview from "../../../src/components/listings/wizard/StepReview";

export const STEPS = [
  { id: "address", label: "Address" },
  { id: "basics", label: "Basics" },
  { id: "units", label: "Units & rent" },
  { id: "perks", label: "Amenities" },
  { id: "photos", label: "Photos" },
  { id: "description", label: "Description" },
  { id: "review", label: "Review" },
];

const blankForm = (user) => ({
  address: "",
  title: "",
  description: "",
  home_type: "apartment",
  lease_type: "standard",
  furnished: false,
  sublease_friendly: false,
  twenty_one_plus: false,
  move_in_date: "",
  contact_email: user?.email ?? "",
  contact_phone: user?.phone ?? "",
  contact_name: user?.name ?? "",
  amenities: [],
  utilities_included: [],
});

export default function AddListingScreen() {
  const router = useRouter();
  const { user, isHydrated } = useAuth();

  const [stepId, setStepId] = useState("address");
  const [form, setForm] = useState(() => blankForm(user));
  const [units, setUnits] = useState([emptyUnit()]);
  const [customAmenities, setCustomAmenities] = useState([]);
  const [availabilityMode, setAvailabilityMode] = useState("now");
  const [coords, setCoords] = useState({ lat: null, lng: null });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [visited, setVisited] = useState(() => new Set());
  const [stagedImages, setStagedImages] = useState([]);

  // --- Role gate — mirrors web's add-listing/layout.js redirect-if-not-landlord,
  // as an inline empty state rather than a silent navigation (the route is only
  // reachable via Profile's landlord-only entry point, so this is a safety net).
  if (!isHydrated) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }
  if (!user || !["landlord", "super"].includes(user.role)) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white px-8">
        <Text className="text-lg font-bold text-gray-900 mb-1">For landlords only</Text>
        <Text className="text-sm text-gray-500 text-center mb-6">
          Add Listing is available to landlord accounts.
        </Text>
        <Button variant="secondary" onPress={() => router.back()}>
          Go back
        </Button>
      </SafeAreaView>
    );
  }

  const setField = (name, value) => setForm((f) => ({ ...f, [name]: value }));
  const toggleMulti = (field, val) =>
    setForm((f) => ({
      ...f,
      [field]: f[field].includes(val) ? f[field].filter((x) => x !== val) : [...f[field], val],
    }));

  const addUnit = () => setUnits((u) => [...u, emptyUnit()]);
  const removeUnit = (i) => setUnits((u) => u.filter((_, idx) => idx !== i));
  const updateUnit = (i, field, val) =>
    setUnits((u) => u.map((unit, idx) => (idx === i ? { ...unit, [field]: val } : unit)));
  const toggleUnitTerm = (i, months) =>
    setUnits((u) =>
      u.map((unit, idx) => {
        if (idx !== i) return unit;
        const cur = Array.isArray(unit.leaseTermMonths) ? unit.leaseTermMonths : [];
        const next = cur.includes(months) ? cur.filter((m) => m !== months) : [...cur, months].sort((a, b) => a - b);
        return { ...unit, leaseTermMonths: next };
      })
    );

  const addCustomAmenity = (v) => {
    const val = v.trim();
    if (!val) return;
    setCustomAmenities((prev) => (prev.some((a) => a.toLowerCase() === val.toLowerCase()) ? prev : [...prev, val]));
  };
  const removeCustomAmenity = (val) => setCustomAmenities((prev) => prev.filter((a) => a !== val));

  // --- Photos. Picked/compressed locally; uploaded to R2 only once the
  // listing exists (see publish()), mirroring AddListingWizard.js's
  // staged-file flow.
  const addImages = async () => {
    const picked = await pickImages();
    if (!picked.length) return;
    const compressed = await Promise.all(picked.map(compressImage));
    setStagedImages((prev) => [...prev, ...compressed]);
  };
  const removeStagedImage = (i) => setStagedImages((imgs) => imgs.filter((_, idx) => idx !== i));

  // --- Navigation, ported from AddListingWizard.js (minus PMS-import bits)
  const stepIndex = STEPS.findIndex((s) => s.id === stepId);

  const validateStep = (id) => {
    if (id === "address" && !form.address.trim()) return "Enter the property address to continue.";
    if (id === "basics" && availabilityMode === "date" && !form.move_in_date)
      return "Pick the date it becomes available, or choose Available now.";
    if (id === "units") {
      if (units.length === 0) return "Add at least one unit.";
      if (units.some((u) => u.bedrooms === "" || u.bathrooms === "")) return "Each unit needs bedrooms and bathrooms.";
      if (units.some((u) => u.available !== false && !(Array.isArray(u.leaseTermMonths) && u.leaseTermMonths.length > 0)))
        return "Pick at least one lease term for each available unit.";
    }
    if (id === "description" && !form.description.trim()) return "A short description is required.";
    return null;
  };

  const stepComplete = (id) => {
    switch (id) {
      case "address":
        return !!form.address.trim();
      case "units":
        return (
          units.length > 0 &&
          units.every((u) => u.bedrooms !== "" && u.bathrooms !== "") &&
          units.every((u) => u.available === false || (Array.isArray(u.leaseTermMonths) && u.leaseTermMonths.length > 0))
        );
      case "description":
        return !!form.description.trim();
      case "basics":
      case "perks":
        return visited.has(id);
      case "photos":
        return visited.has(id) || stagedImages.length > 0;
      default:
        return false;
    }
  };

  const goTo = (id) => {
    setError(null);
    setStepId(id);
  };

  const next = () => {
    const problem = validateStep(stepId);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setVisited((prev) => new Set([...prev, stepId]));
    const idx = STEPS.findIndex((s) => s.id === stepId);
    if (idx < STEPS.length - 1) setStepId(STEPS[idx + 1].id);
  };

  const back = () => {
    setError(null);
    const idx = STEPS.findIndex((s) => s.id === stepId);
    if (idx > 0) setStepId(STEPS[idx - 1].id);
    else router.back();
  };

  // --- Publish.
  const publish = async () => {
    for (const s of STEPS) {
      const problem = validateStep(s.id);
      if (problem) {
        setError(problem);
        setStepId(s.id);
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      const unitPayload = units.map((u) => ({
        bedrooms: Number(u.bedrooms),
        bathrooms: Number(u.bathrooms),
        rent: u.rent !== "" ? Number(u.rent) : null,
        area: u.area !== "" ? Number(u.area) : null,
        available: u.available !== false,
        title: (u.title ?? "").trim() || null,
        floorPlanImageUrl: u.floorPlanImageUrl || null,
        leaseTermMonths: Array.isArray(u.leaseTermMonths)
          ? u.leaseTermMonths.map(Number).filter((m) => Number.isFinite(m) && m > 0)
          : [],
      }));

      const result = await apiClient.listings.createListing({
        ...form,
        unitTypes: unitPayload,
        customAmenities,
        moveInDate: form.move_in_date || null,
        contactEmail: form.contact_email || null,
        contactPhone: form.contact_phone || null,
        contactName: form.contact_name || null,
        ...(coords.lat != null && coords.lng != null ? { longitude: coords.lng, latitude: coords.lat } : {}),
        // Street View is stored at sort_order 0 (the cover slot) at create
        // time, before any staged photos land via /api/upload afterward —
        // so attaching it unconditionally would bury a landlord's own cover
        // photo under an auto screenshot. Mirrors web's
        // `!streetViewDeleted && stagedFiles.length === 0` (mobile has no
        // client-side Street View preview to delete, so it simplifies to
        // just checking for staged photos).
        attachStreetView: stagedImages.length === 0,
      });
      const listingId = result.listing.id;

      // A photo failure never un-saves the listing — surface it as a
      // non-blocking alert and continue, matching AddListingWizard.js's
      // toast-and-continue behavior.
      if (stagedImages.length > 0) {
        try {
          const { failedCount } = await uploadImages(listingId, stagedImages);
          if (failedCount > 0) {
            Alert.alert(
              "Listing published",
              `${failedCount} photo${failedCount === 1 ? "" : "s"} failed to upload. You can re-add them from the listing later.`
            );
          }
        } catch {
          Alert.alert("Listing published", "Photos failed to upload. You can re-add them from the listing later.");
        }
      }

      router.replace(`/listings/${listingId}`);
    } catch (err) {
      setError(getErrorMessage(err, "Something went wrong. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const w = {
    user,
    form,
    setField,
    toggleMulti,
    units,
    addUnit,
    removeUnit,
    updateUnit,
    toggleUnitTerm,
    customAmenities,
    addCustomAmenity,
    removeCustomAmenity,
    stagedImages,
    addImages,
    removeStagedImage,
    coords,
    setCoords,
    availabilityMode,
    setAvailabilityMode,
    stepComplete,
    goTo,
    error,
    submitting,
    publish,
  };

  const renderStep = () => {
    switch (stepId) {
      case "address":
        return <StepAddress w={w} />;
      case "basics":
        return <StepBasics w={w} />;
      case "units":
        return <StepUnits w={w} />;
      case "perks":
        return <StepPerks w={w} />;
      case "photos":
        return <StepPhotos w={w} />;
      case "description":
        return <StepDescription w={w} />;
      case "review":
        return <StepReview w={w} />;
      default:
        return null;
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-100">
        <Pressable onPress={back} hitSlop={12}>
          <Text className="text-red-600 text-base">← Back</Text>
        </Pressable>
        <Text className="text-base font-semibold text-gray-900">Add Listing</Text>
        <View className="w-12" />
      </View>

      <View className="px-4 pb-3 pt-3 border-b border-gray-100">
        <Text className="text-xs font-medium text-gray-500">
          Step {stepIndex + 1} of {STEPS.length} · {STEPS[stepIndex].label}
        </Text>
        <View className="mt-2.5 flex-row gap-1.5">
          {STEPS.map((s, i) => {
            const done = stepComplete(s.id) || i < stepIndex;
            const reachable = i <= stepIndex || done;
            return (
              <Pressable
                key={s.id}
                onPress={() => reachable && goTo(s.id)}
                className={`h-1.5 flex-1 rounded-full ${
                  s.id === stepId ? "bg-red-600" : done ? "bg-red-300" : "bg-gray-200"
                }`}
              />
            );
          })}
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
        {renderStep()}
        {error ? (
          <View className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <Text className="text-sm text-red-700">{error}</Text>
          </View>
        ) : null}
      </ScrollView>

      {stepId !== "review" ? (
        <View className="flex-row items-center justify-between border-t border-gray-100 px-4 py-3">
          <Pressable onPress={back} hitSlop={12}>
            <Text className="text-sm font-medium text-gray-500">← Back</Text>
          </Pressable>
          <Button onPress={next}>Next</Button>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
