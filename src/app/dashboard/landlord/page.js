"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Calendar,
  BarChart3,
  TrendingUp,
  MapPin,
  Bell,
  Target,
  Search,
  Home,
  Plus,
  User,
  Eye,
  MessageSquare,
  Clock,
  TrendingDown,
  Star,
  ThumbsUp,
  Bed,
  Bath,
  Square,
  ArrowLeft,
  Menu,
  Pencil,
  Trash2,
  Camera,
  X,
  Users,
  UserPlus,
} from "lucide-react";

import LeasingFunnel from "@/components/dashboard/leasing-funnel";
import DraggableImageGrid from "@/components/ui/DraggableImageGrid";
import {
  getAreaRangeLabel,
  getRentRangeLabel,
  getUnitValuesLabel,
  calcAge,
} from "@/utils/listingFormatters";
import ReviewReplySection from "@/components/listings/ReviewReplySection";

// Simple components
const Card = ({ children, className = "", onClick }) => (
  <div
    className={`bg-white rounded-lg border border-gray-200 shadow-sm ${className}`}
    onClick={onClick}
  >
    {children}
  </div>
);

const CardHeader = ({ children, className = "" }) => (
  <div className={`p-6 pb-2 ${className}`}>{children}</div>
);

const CardContent = ({ children, className = "" }) => (
  <div className={`p-6 pt-0 ${className}`}>{children}</div>
);

const CardTitle = ({ children, className = "" }) => (
  <h3
    className={`text-lg font-semibold leading-none tracking-tight ${className}`}
  >
    {children}
  </h3>
);

const Button = ({
  children,
  variant = "default",
  size = "default",
  className = "",
  onClick,
  ...props
}) => {
  const baseClasses =
    "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background";

  const variants = {
    default: "bg-red-600 text-white hover:bg-red-700",
    ghost: "hover:bg-gray-100 hover:text-gray-900",
    outline: "border border-gray-200 bg-white hover:bg-gray-50",
  };

  const sizes = {
    default: "h-10 py-2 px-4",
    sm: "h-9 px-3 rounded-md",
    icon: "h-10 w-10",
  };

  return (
    <button
      className={`${baseClasses} ${variants[variant]} ${sizes[size]} ${className}`}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
};

const Badge = ({ children, variant = "default", className = "" }) => {
  const variants = {
    default: "bg-red-600 text-white",
    secondary: "bg-gray-100 text-gray-900",
    outline: "border border-gray-200 bg-white text-gray-900",
  };

  return (
    <div
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${variants[variant]} ${className}`}
    >
      {children}
    </div>
  );
};

const StarRating = ({ rating, size = "sm" }) => {
  const starSize = size === "lg" ? "h-5 w-5" : "h-4 w-4";

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`${starSize} ${
            star <= rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"
          }`}
        />
      ))}
    </div>
  );
};

// Sections --------------------------------------------------------------------
function ProfileSection({
  user,
  isEditing,
  form,
  onChange,
  saving,
  cancelEdit,
  saveProfile,
  setIsEditing,
}) {
  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Loading profile...</p>
      </div>
    );
  }

  return (
    <div className="bg-white p-5 sm:p-8 rounded-lg shadow-lg mb-8">
      <div className="flex flex-col md:flex-row gap-5 md:gap-8">
        {/* Profile Image */}
        <div className="flex-shrink-0 flex justify-center md:block">
          <img
            src={user.image}
            alt={user.name}
            className="w-24 h-24 sm:w-32 sm:h-32 rounded-full object-cover border border-gray-200 shadow-md"
          />
        </div>

        {/* Profile Info */}
        <div className="flex-1 min-w-0">
          {!isEditing ? (
            <>
              <div className="flex items-center flex-wrap gap-2">
                <h1 className="text-2xl sm:text-4xl font-bold text-gray-900 break-words">
                  {user.name}
                </h1>
                <Badge
                  variant="secondary"
                  className="bg-red-50 text-red-700 border border-red-200"
                  aria-label="Account role: Landlord"
                >
                  Landlord
                </Badge>
              </div>
              {user.numReviews === 0 ? (
                <p className="text-gray-500 text-sm italic">No ratings yet</p>
              ) : (
                <div className="text-yellow-500 text-lg">
                  {"★".repeat(user.rating)}
                  <span className="text-gray-300">
                    {"★".repeat(5 - user.rating)}
                  </span>
                </div>
              )}
              <p className="text-gray-500 mt-2 text-base sm:text-lg">
                {user.listings.length} active listings
              </p>{" "}
              <p className="text-gray-400 text-sm sm:text-base mt-2">
                {calcAge(user.birthday) != null
                  ? `${calcAge(user.birthday)} years old`
                  : null}
                {user.gender ? ` • ${user.gender}` : ""}
              </p>
              <p className="text-gray-500 text-sm sm:text-base mt-2 break-words">
                📞 {user.phone} • ✉️ {user.email}
              </p>
              {/* Additional Info */}
              <div className="mt-6">
                <h2 className="text-xl font-semibold text-gray-900">
                  About Me
                </h2>
                <p className="text-gray-600 mt-2">
                  {user.description || "No description provided."}
                </p>
              </div>
            </>
          ) : (
            // Edit form
            <form
              className="grid grid-cols-1 md:grid-cols-2 gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                saveProfile();
              }}
            >
              <div className="col-span-1">
                <label className="block text-sm font-medium text-gray-700">
                  Name
                </label>
                <input
                  name="name"
                  value={form.name}
                  onChange={onChange}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Your name"
                />
              </div>
              <div className="col-span-1">
                <label className="block text-sm font-medium text-gray-700">
                  Phone
                </label>
                <input
                  name="phone"
                  value={form.phone == "N/A" ? "" : form.phone}
                  onChange={onChange}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="+1 (555) 555-5555"
                />
              </div>
              <div className="col-span-1">
                <label className="block text-sm font-medium text-gray-700">
                  Birthday
                </label>
                <input
                  type="date"
                  name="birthday"
                  max={new Date().toISOString().split("T")[0]}
                  value={form.birthday}
                  onChange={onChange}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div className="col-span-1">
                <label className="block text-sm font-medium text-gray-700">
                  Gender
                </label>
                <select
                  name="gender"
                  value={form.gender}
                  onChange={onChange}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="unspecified">Unspecified</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Non-binary">Non-binary</option>
                  <option value="Prefer not to say">Prefer not to say</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="col-span-1 md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">
                  About
                </label>
                <textarea
                  name="description"
                  value={form.description}
                  onChange={onChange}
                  rows={4}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Tell others about yourself"
                />
              </div>

              <div className="col-span-1 md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">
                  How&apos;d you find us?
                </label>
                <select
                  name="referralSource"
                  value={form.referralSource}
                  onChange={onChange}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">Not specified</option>
                  <option value="Social Media">Social Media</option>
                  <option value="A Friend">A Friend</option>
                  <option value="Colleague">Colleague</option>
                  <option value="On Campus">On Campus</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="col-span-1 md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">
                  I am a…
                </label>
                <select
                  name="role"
                  value={form.role}
                  onChange={onChange}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="student">Student</option>
                  <option value="landlord">Landlord</option>
                  <option value="parent">Parent</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="col-span-1 md:col-span-2 flex gap-3 pt-2">
                <Button
                  type="submit"
                  variant="default"
                  className="text-white bg-red-600 hover:bg-red-700 disabled:opacity-70"
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save changes"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={cancelEdit}
                  className="border-gray-300"
                  disabled={saving}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* Actions */}
        <div className="flex-shrink-0">
          {!isEditing ? (
            <Button
              variant="default"
              size="default"
              className="w-full md:w-auto text-white bg-red-600 hover:bg-red-700"
              onClick={() => setIsEditing(true)}
            >
              Edit Profile
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AnalyticsDashboardSection({ viewAsId }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <div className="text-2xl">📊</div>
        <h2 className="text-xl font-bold text-gray-900">Analytics</h2>
        <p className="text-sm text-gray-500 ml-1">
          Track performance across your listings
        </p>
      </div>
      <LeasingFunnel viewAsId={viewAsId} />
    </div>
  );
}

// Add / Edit Listing Modal -------------------------------------------------------
// Values are the exact boolean column names on `listing_amenities` / `listing_utilities`.
// The API writes `row[name] = true` for each, so anything not in these lists is dropped.
const AMENITY_OPTIONS = [
  "air_conditioning",
  "dishwasher",
  "gym",
  "laundry",
  "mailroom",
  "microwave",
  "oven",
  "parking",
  "pets_allowed",
  "pool",
  "refrigerator",
  "rooftop",
  "storage",
  "stove",
  "study_room",
];
const AMENITY_LABELS = {
  air_conditioning: "Air Conditioning",
  dishwasher: "Dishwasher",
  gym: "Gym",
  laundry: "Laundry",
  mailroom: "Mailroom",
  microwave: "Microwave",
  oven: "Oven",
  parking: "Parking",
  pets_allowed: "Pets Allowed",
  pool: "Pool",
  refrigerator: "Refrigerator",
  rooftop: "Rooftop",
  storage: "Storage",
  stove: "Stove",
  study_room: "Study Room",
};
const UTILITY_OPTIONS = [
  "electric",
  "gas",
  "heat",
  "water",
  "internet",
  "trash",
  "cable",
  "sewer",
  "cooling",
];
const UTILITY_LABELS = {
  electric: "Electric",
  gas: "Gas",
  heat: "Heat",
  water: "Water",
  internet: "Internet",
  trash: "Trash",
  cable: "Cable",
  sewer: "Sewer",
  cooling: "Cooling",
};
const HOME_TYPES = ["apartment", "house", "condo", "townhouse", "other"];
const LEASE_TYPES = ["standard", "sublease", "short-term"];

const emptyUnit = () => ({
  bedrooms: "",
  bathrooms: "",
  rent: "",
  area: "",
  available: true,
});

function AddEditListingModal({ listing, onClose, onSuccess, user }) {
  const isEdit = !!listing;
  const [form, setForm] = useState({
    address: listing?.address ?? "",
    title: listing?.title ?? "",
    description: listing?.description ?? "",
    home_type: (
      listing?.home_type ??
      listing?.homeType ??
      "apartment"
    ).toLowerCase(),
    lease_type: listing?.lease_type ?? listing?.leaseType ?? "standard",
    furnished: listing?.furnished ?? false,
    sublease_friendly:
      listing?.sublease_friendly ?? listing?.subleaseFriendly ?? false,
    twenty_one_plus:
      listing?.twenty_one_plus ?? listing?.twentyOnePlus ?? false,
    move_in_date:
      listing?.move_in_date ??
      (listing?.moveInDate ? listing.moveInDate.slice(0, 10) : ""),
    // Auto-fill contact info from the landlord's profile for new listings
    contact_email:
      listing?.contact_email ?? listing?.contactEmail ?? user?.email ?? "",
    contact_phone:
      listing?.contact_phone ?? listing?.contactPhone ?? user?.phone ?? "",
    contact_name:
      listing?.contact_name ?? listing?.contactName ?? user?.name ?? "",
    amenities: listing?.amenities ?? [],
    utilities_included:
      listing?.utilities_included ?? listing?.utilitiesIncluded ?? [],
    lease_availability: (() => {
      const raw =
        listing?.lease_availability ?? listing?.leaseAvailability ?? [];
      const canon = ["Semester", "10-Month", "12-Month", "Summer"];
      const byLower = new Map(canon.map((v) => [v.toLowerCase(), v]));
      return Array.from(
        new Set(
          raw.map((v) => byLower.get(String(v).toLowerCase())).filter(Boolean)
        )
      );
    })(),
  });
  const rawUnits = listing?.listing_units ?? listing?.unitTypes ?? [];
  const [units, setUnits] = useState(
    rawUnits.length
      ? rawUnits.map((u) => ({
          bedrooms: u.bedrooms ?? "",
          bathrooms: u.bathrooms ?? "",
          rent: u.rent ?? "",
          area: u.area ?? "",
          available: u.available ?? true,
        }))
      : [emptyUnit()]
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Image upload
  const [stagedFiles, setStagedFiles] = useState([]);
  const [stagedPreviews, setStagedPreviews] = useState([]);
  const [existingImages, setExistingImages] = useState(listing?.images ?? []);
  const [savingImageOrder, setSavingImageOrder] = useState(false);

  // Auto Street View default photo (new listings only). Coordinates come from the selected
  // address suggestion; if kept, /api/addListing stores it server-side as the cover photo.
  const [coords, setCoords] = useState({ lat: null, lng: null });
  const [streetView, setStreetView] = useState({ available: false, url: null });
  const [streetViewDeleted, setStreetViewDeleted] = useState(false);
  const [streetViewLoading, setStreetViewLoading] = useState(false);
  const showStreetView = !isEdit && streetView.available && !streetViewDeleted;

  const fetchStreetViewPreview = async (address, lat, lng) => {
    setStreetViewDeleted(false);
    setStreetView({ available: false, url: null });
    setStreetViewLoading(true);
    try {
      const params = new URLSearchParams({ address, lat: String(lat), lng: String(lng) });
      const res = await fetch(`/api/streetview/preview?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.available && data?.url) setStreetView({ available: true, url: data.url });
    } catch (err) {
      console.error("Street View preview error:", err);
    } finally {
      setStreetViewLoading(false);
    }
  };

  const handleReorderExistingImages = async (nextUrls) => {
    const prev = existingImages;
    setExistingImages(nextUrls);
    if (!isEdit) return;
    setSavingImageOrder(true);
    try {
      const listingId = listing._id || listing.id;
      const res = await fetch(`/api/landlord/listings/${listingId}/images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: nextUrls }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to save image order.");
        setExistingImages(prev);
      }
    } catch {
      setError("Failed to save image order.");
      setExistingImages(prev);
    } finally {
      setSavingImageOrder(false);
    }
  };

  // Address autocomplete
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressDropdownOpen, setAddressDropdownOpen] = useState(false);
  const addressRef = useRef(null);
  const addressDebounceRef = useRef(null);

  // Close address dropdown on outside click
  useEffect(() => {
    function onOutsideClick(e) {
      if (addressRef.current && !addressRef.current.contains(e.target)) {
        setAddressDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutsideClick);
    document.addEventListener("touchstart", onOutsideClick);
    return () => {
      document.removeEventListener("mousedown", onOutsideClick);
      document.removeEventListener("touchstart", onOutsideClick);
    };
  }, []);

  const fetchAddressSuggestions = useCallback((query) => {
    if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
    if (!query || query.trim().length < 3) {
      setAddressSuggestions([]);
      setAddressDropdownOpen(false);
      return;
    }
    addressDebounceRef.current = setTimeout(async () => {
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      if (!token) return;
      setAddressLoading(true);
      try {
        const encoded = encodeURIComponent(query.trim());
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&limit=5&country=US&types=address,place`
        );
        const data = await res.json();
        const suggestions = (data.features ?? []).map((f) => ({
          label: f.place_name,
          center: f.center,
        }));
        setAddressSuggestions(suggestions);
        setAddressDropdownOpen(suggestions.length > 0);
      } catch {
        setAddressSuggestions([]);
      } finally {
        setAddressLoading(false);
      }
    }, 300);
  }, []);

  const handleAddressInput = (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, address: value }));
    fetchAddressSuggestions(value);
  };

  const selectAddressSuggestion = (suggestion) => {
    const autoTitle = suggestion.label.split(",")[0].trim();
    setForm((f) => ({
      ...f,
      address: suggestion.label,
      title:
        !f.title || f.title === (f.address || "").split(",")[0].trim()
          ? autoTitle
          : f.title,
    }));
    setAddressSuggestions([]);
    setAddressDropdownOpen(false);

    // Mapbox center is [lng, lat]. Capture it and fetch a Street View default (new listings).
    const [lng, lat] = suggestion.center ?? [];
    if (lat != null && lng != null) {
      setCoords({ lat, lng });
      if (!isEdit) fetchStreetViewPreview(suggestion.label, lat, lng);
    }
  };

  const compressImage = (file) =>
    new Promise((resolve) => {
      // Skip files already under 1 MB
      if (file.size < 1 * 1024 * 1024) {
        resolve(file);
        return;
      }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1920;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const ratio = Math.min(MAX / width, MAX / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size >= file.size) {
              resolve(file);
              return;
            }
            resolve(
              new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
                type: "image/jpeg",
              })
            );
          },
          "image/jpeg",
          0.85
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    });

  const handleImageFiles = async (files) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    const compressed = await Promise.all(imgs.map(compressImage));
    setStagedFiles((prev) => [...prev, ...compressed]);
    setStagedPreviews((prev) => [
      ...prev,
      ...compressed.map((f) => URL.createObjectURL(f)),
    ]);
  };

  const removeStagedImage = (i) => {
    URL.revokeObjectURL(stagedPreviews[i]);
    setStagedFiles((prev) => prev.filter((_, idx) => idx !== i));
    setStagedPreviews((prev) => prev.filter((_, idx) => idx !== i));
  };

  const removeExistingImage = (url) =>
    setExistingImages((prev) => prev.filter((u) => u !== url));

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  };

  const toggleMulti = (field, val) =>
    setForm((f) => ({
      ...f,
      [field]: f[field].includes(val)
        ? f[field].filter((x) => x !== val)
        : [...f[field], val],
    }));

  const addUnit = () => setUnits((u) => [...u, emptyUnit()]);
  const removeUnit = (i) => setUnits((u) => u.filter((_, idx) => idx !== i));
  const updateUnit = (i, field, val) =>
    setUnits((u) =>
      u.map((unit, idx) => (idx === i ? { ...unit, [field]: val } : unit))
    );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.address.trim()) {
      setError("Address is required.");
      return;
    }
    if (!form.description.trim()) {
      setError("Description is required.");
      return;
    }
    if (units.length === 0) {
      setError("At least one unit is required.");
      return;
    }
    if (units.some((u) => u.bedrooms === "" || u.bathrooms === "")) {
      setError("Each unit needs bedrooms and bathrooms.");
      return;
    }

    setSubmitting(true);
    try {
      const unitPayload = units.map((u) => ({
        bedrooms: Number(u.bedrooms),
        bathrooms: Number(u.bathrooms),
        rent: u.rent !== "" ? Number(u.rent) : null,
        area: u.area !== "" ? Number(u.area) : null,
        available: u.available !== false,
      }));

      let res;
      if (isEdit) {
        res = await fetch(
          `/api/landlord/listings/${listing._id || listing.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address: form.address,
              title: form.title,
              description: form.description,
              home_type: form.home_type,
              lease_type: form.lease_type,
              furnished: form.furnished,
              sublease_friendly: form.sublease_friendly,
              twenty_one_plus: form.twenty_one_plus,
              move_in_date: form.move_in_date || null,
              contact_email: form.contact_email || null,
              contact_phone: form.contact_phone || null,
              contact_name: form.contact_name || null,
              amenities: form.amenities,
              utilities_included: form.utilities_included,
              lease_availability: form.lease_availability,
              // persist any existing-image removals
              images: existingImages,
              units: unitPayload,
            }),
          }
        );
      } else {
        res = await fetch("/api/addListing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            unitTypes: unitPayload,
            // addListing expects camelCase for contact fields
            contactEmail: form.contact_email || null,
            contactPhone: form.contact_phone || null,
            contactName: form.contact_name || null,
            // Pass selected coordinates so the server skips re-geocoding and the stored
            // Street View shot matches the preview orientation.
            ...(coords.lat != null && coords.lng != null
              ? { longitude: coords.lng, latitude: coords.lat }
              : {}),
            attachStreetView: showStreetView,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }

      // Upload staged images via presigned URLs so files go directly from the
      // browser to R2, bypassing Vercel's 4.5 MB serverless body limit.
      if (stagedFiles.length > 0) {
        const listingId = isEdit ? listing._id || listing.id : data.listing?.id;
        if (listingId) {
          // Step 1: get presigned PUT URLs for each file
          const presignRes = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              listingId,
              files: stagedFiles.map((f) => ({ name: f.name, type: f.type })),
            }),
          });
          if (!presignRes.ok) {
            const presignData = await presignRes.json().catch(() => ({}));
            console.error(
              "[upload] failed to get presigned URLs:",
              presignData.error
            );
            setError(
              `Listing saved, but images failed to upload: ${
                presignData.error || `server error ${presignRes.status}`
              }`
            );
            setSubmitting(false);
            return;
          }
          const { presigned } = await presignRes.json();

          // Step 2: upload each file directly to R2
          const uploadResults = await Promise.allSettled(
            stagedFiles.map((file, i) =>
              fetch(presigned[i].uploadUrl, {
                method: "PUT",
                body: file,
                headers: { "Content-Type": file.type },
              })
            )
          );
          const failedUploads = uploadResults.filter(
            (r) => r.status === "rejected" || !r.value?.ok
          );
          if (failedUploads.length > 0) {
            console.error(
              "[upload] some files failed to upload to R2:",
              failedUploads
            );
            setError(
              `Listing saved, but ${failedUploads.length} image(s) failed to upload. Please try re-uploading them.`
            );
            setSubmitting(false);
            return;
          }

          // Step 3: record the confirmed public URLs on the listing
          const confirmRes = await fetch("/api/upload", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              listingId,
              urls: presigned.map((p) => p.publicUrl),
            }),
          });
          if (!confirmRes.ok) {
            const confirmData = await confirmRes.json().catch(() => ({}));
            console.error(
              "[upload] failed to confirm image URLs:",
              confirmData.error
            );
            setError(
              `Listing saved, but images were uploaded and could not be saved: ${
                confirmData.error || `server error ${confirmRes.status}`
              }`
            );
            setSubmitting(false);
            return;
          }
        }
      }

      // Check if the contact info differs from the landlord's profile
      const diff = {};
      const trim = (v) => (v ?? "").trim();
      if (
        trim(form.contact_name) &&
        trim(form.contact_name) !== trim(user?.name)
      ) {
        diff.name = trim(form.contact_name);
      }
      if (
        trim(form.contact_email) &&
        trim(form.contact_email) !== trim(user?.email)
      ) {
        diff.email = trim(form.contact_email);
      }
      if (
        trim(form.contact_phone) &&
        trim(form.contact_phone) !== trim(user?.phone)
      ) {
        diff.phone = trim(form.contact_phone);
      }

      await onSuccess(unitPayload, Object.keys(diff).length > 0 ? diff : null);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8 px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">
            {isEdit ? "Edit Listing" : "Add New Listing"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors"
          >
            <svg
              className="h-5 w-5 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {/* Listing Details */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Listing Details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 relative" ref={addressRef}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Address *
                </label>
                <div className="relative">
                  <input
                    name="address"
                    value={form.address}
                    onChange={handleAddressInput}
                    onFocus={() =>
                      addressSuggestions.length > 0 &&
                      setAddressDropdownOpen(true)
                    }
                    required
                    autoComplete="off"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 pr-8"
                    placeholder="123 Main St, St. Louis, MO 63130"
                  />
                  {addressLoading && (
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                      <svg
                        className="animate-spin h-4 w-4 text-gray-400"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v8z"
                        />
                      </svg>
                    </div>
                  )}
                </div>
                {addressDropdownOpen && addressSuggestions.length > 0 && (
                  <ul className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                    {addressSuggestions.map((s, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => selectAddressSuggestion(s)}
                          className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-red-50 active:bg-red-100 flex items-start gap-2 border-b border-gray-100 last:border-0"
                        >
                          <svg
                            className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                          </svg>
                          <span className="leading-snug">{s.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Display Name
                </label>
                <input
                  name="title"
                  value={form.title}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="e.g. Cozy Studio Near Campus"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description *
                </label>
                <textarea
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  required
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Describe the property..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Home Type
                </label>
                <select
                  name="home_type"
                  value={form.home_type}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  {HOME_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Lease Type
                </label>
                <select
                  name="lease_type"
                  value={form.lease_type}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  {LEASE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Lease Availability
                </label>
                <div className="flex flex-wrap gap-2">
                  {["Semester", "10-Month", "12-Month", "Summer"].map((opt) => {
                    const selected = (form.lease_availability || []).includes(
                      opt
                    );
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            lease_availability: selected
                              ? prev.lease_availability.filter((v) => v !== opt)
                              : [...(prev.lease_availability || []), opt],
                          }))
                        }
                        className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                          selected
                            ? "bg-red-500 text-white border-red-500"
                            : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Move-in Date
                </label>
                <input
                  type="date"
                  name="move_in_date"
                  value={form.move_in_date}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div className="flex items-center gap-4 pt-5">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    name="furnished"
                    checked={form.furnished}
                    onChange={handleChange}
                    className="accent-red-600"
                  />
                  Furnished
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    name="sublease_friendly"
                    checked={form.sublease_friendly}
                    onChange={handleChange}
                    className="accent-red-600"
                  />
                  Sublease Friendly
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    name="twenty_one_plus"
                    checked={form.twenty_one_plus}
                    onChange={handleChange}
                    className="accent-red-600"
                  />
                  21+ Only
                </label>
              </div>
            </div>
          </div>

          {/* Amenities */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Amenities
            </h3>
            <div className="flex flex-wrap gap-2">
              {AMENITY_OPTIONS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => toggleMulti("amenities", a)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    form.amenities.includes(a)
                      ? "bg-red-600 text-white border-red-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-red-400"
                  }`}
                >
                  {AMENITY_LABELS[a]}
                </button>
              ))}
            </div>
          </div>

          {/* Utilities */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Utilities Included
            </h3>
            <div className="flex flex-wrap gap-2">
              {UTILITY_OPTIONS.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => toggleMulti("utilities_included", u)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    form.utilities_included.includes(u)
                      ? "bg-red-600 text-white border-red-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-red-400"
                  }`}
                >
                  {UTILITY_LABELS[u]}
                </button>
              ))}
            </div>
          </div>

          {/* Contact Info */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Contact Info
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { name: "contact_name", label: "Name", type: "text" },
                { name: "contact_email", label: "Email", type: "email" },
                { name: "contact_phone", label: "Phone", type: "text" },
              ].map(({ name, label, type }) => (
                <div key={name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {label}
                  </label>
                  <input
                    name={name}
                    type={type}
                    value={form[name]}
                    onChange={handleChange}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Units */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Units *
              </h3>
              <button
                type="button"
                onClick={addUnit}
                className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700 font-medium"
              >
                <Plus className="h-4 w-4" />
                Add Unit
              </button>
            </div>
            <div className="space-y-3">
              {units.map((unit, i) => (
                <div
                  key={i}
                  className="flex items-end gap-3 p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { field: "bedrooms", label: "Beds *", min: "0" },
                      {
                        field: "bathrooms",
                        label: "Baths *",
                        min: "0",
                        step: "0.5",
                      },
                      { field: "rent", label: "Rent ($/mo)", min: "0" },
                      { field: "area", label: "Area (sq ft)", min: "0" },
                    ].map(({ field, label, min, step }) => (
                      <div key={field}>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          {label}
                        </label>
                        <input
                          type="number"
                          min={min}
                          step={step}
                          value={unit[field]}
                          onChange={(e) => updateUnit(i, field, e.target.value)}
                          className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                      </div>
                    ))}
                    <label className="flex items-center gap-2 text-sm text-gray-700 select-none sm:col-span-4">
                      <input
                        type="checkbox"
                        checked={unit.available !== false}
                        onChange={(e) =>
                          updateUnit(i, "available", e.target.checked)
                        }
                        className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                      />
                      Available
                    </label>
                  </div>
                  {units.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeUnit(i)}
                      className="p-1.5 text-gray-400 hover:text-red-600 transition-colors flex-shrink-0"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Photos */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Photos
            </h3>

            {/* Existing images (edit mode) — drag to reorder */}
            {isEdit && existingImages.length > 0 && (
              <div className="mb-3">
                <DraggableImageGrid
                  images={existingImages}
                  onReorder={handleReorderExistingImages}
                  onRemove={removeExistingImage}
                  saving={savingImageOrder}
                />
              </div>
            )}

            {/* Street View default (new listings) */}
            {streetViewLoading && (
              <p className="text-xs text-gray-500 mb-3 flex items-center gap-1.5">
                <span className="w-3 h-3 border border-gray-300 border-t-red-500 rounded-full animate-spin" />
                Looking for a Street View photo…
              </p>
            )}
            {showStreetView && (
              <div className="flex flex-wrap gap-2 mb-3">
                <div className="relative w-20 h-20 flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={streetView.url}
                    alt="Street View of the property"
                    className="w-full h-full object-cover rounded-lg border border-gray-200"
                  />
                  <button
                    type="button"
                    onClick={() => setStreetViewDeleted(true)}
                    aria-label="Remove Street View photo"
                    className="absolute -top-1.5 -right-1.5 bg-red-600 hover:bg-red-700 text-white rounded-full w-5 h-5 flex items-center justify-center shadow transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] text-center py-0.5 rounded-b-lg">
                    Street View
                  </div>
                </div>
              </div>
            )}

            {/* Staged previews */}
            {stagedPreviews.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {stagedPreviews.map((url, i) => (
                  <div key={i} className="relative w-20 h-20 flex-shrink-0">
                    <img
                      src={url}
                      alt=""
                      className="w-full h-full object-cover rounded-lg border border-gray-200"
                    />
                    <button
                      type="button"
                      onClick={() => removeStagedImage(i)}
                      className="absolute -top-1.5 -right-1.5 bg-red-600 hover:bg-red-700 text-white rounded-full w-5 h-5 flex items-center justify-center shadow transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-[9px] text-center py-0.5 rounded-b-lg">
                      new
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Drop / tap to upload */}
            <label
              className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-red-400 hover:bg-red-50 active:bg-red-50 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleImageFiles(e.dataTransfer.files);
              }}
            >
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handleImageFiles(e.target.files)}
              />
              <Camera className="h-6 w-6 text-gray-400 mb-1" />
              <span className="text-sm text-gray-500 font-medium">
                Drop photos here or tap to browse
              </span>
              <span className="text-xs text-gray-400 mt-0.5">
                JPG, PNG, WebP — auto-compressed if large
              </span>
            </label>
          </div>

          {/* Footer */}
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
            >
              {submitting
                ? "Saving..."
                : isEdit
                ? "Save Changes"
                : "Create Listing"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ManageCoOwnersModal({ listing, currentUserId, onClose }) {
  const listingId = listing._id || listing.id;
  const [landlords, setLandlords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [promoting, setPromoting] = useState(null);

  const currentIsPrimary =
    landlords.find((l) => l.userId === currentUserId)?.isPrimary ?? false;

  useEffect(() => {
    fetch(`/api/landlord/listings/${listingId}/landlords`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setLandlords(data);
      })
      .catch(() => setError("Failed to load co-owners."))
      .finally(() => setLoading(false));
  }, [listingId]);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError(null);
    setAdding(true);
    try {
      const res = await fetch(`/api/landlord/listings/${listingId}/landlords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to add co-owner.");
        return;
      }
      setLandlords((prev) => [...prev, data]);
      setEmail("");
    } catch {
      setError("Network error.");
    } finally {
      setAdding(false);
    }
  };

  const handleMakePrimary = async (userId) => {
    const target = landlords.find((l) => l.userId === userId);
    const name = target?.name || target?.email || "this person";
    if (
      !confirm(`Make ${name} the primary owner? You will lose primary status.`)
    )
      return;
    setError(null);
    setPromoting(userId);
    try {
      const res = await fetch(`/api/landlord/listings/${listingId}/landlords`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to transfer primary.");
        return;
      }
      setLandlords((prev) =>
        prev.map((l) => ({ ...l, isPrimary: l.userId === userId }))
      );
    } catch {
      setError("Network error.");
    } finally {
      setPromoting(null);
    }
  };

  const handleRemove = async (userId) => {
    setError(null);
    setRemoving(userId);
    try {
      const res = await fetch(`/api/landlord/listings/${listingId}/landlords`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to remove co-owner.");
        return;
      }
      setLandlords((prev) => prev.filter((l) => l.userId !== userId));
    } catch {
      setError("Network error.");
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Co-owners</h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">
              {listing.title || listing.address}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              People with access
            </p>
            {loading ? (
              <p className="text-sm text-gray-400 py-2">Loading…</p>
            ) : (
              <ul className="space-y-2">
                {landlords.map((l) => (
                  <li
                    key={l.userId}
                    className="flex items-center justify-between gap-3 py-1"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                        <User className="h-4 w-4 text-gray-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {l.name || l.email || "Unknown"}
                          {l.isPrimary && (
                            <span className="ml-2 text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded uppercase tracking-wide">
                              Primary
                            </span>
                          )}
                        </p>
                        {l.name && l.email && (
                          <p className="text-xs text-gray-400 truncate">
                            {l.email}
                          </p>
                        )}
                      </div>
                    </div>
                    {!l.isPrimary && (
                      <div className="flex items-center gap-1 shrink-0">
                        {currentIsPrimary && (
                          <button
                            onClick={() => handleMakePrimary(l.userId)}
                            disabled={!!promoting}
                            className="text-xs text-purple-600 hover:text-purple-700 font-medium px-2 py-1 rounded-md hover:bg-purple-50 transition-colors disabled:opacity-50"
                          >
                            {promoting === l.userId
                              ? "Saving…"
                              : "Make Primary"}
                          </button>
                        )}
                        {l.userId !== currentUserId && (
                          <button
                            onClick={() => handleRemove(l.userId)}
                            disabled={removing === l.userId}
                            className="text-xs text-red-600 hover:text-red-700 font-medium px-2 py-1 rounded-md hover:bg-red-50 transition-colors disabled:opacity-50"
                          >
                            {removing === l.userId ? "Removing…" : "Remove"}
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Add co-owner by email
            </p>
            <form onSubmit={handleAdd} className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="landlord@email.com"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                type="submit"
                disabled={adding || !email.trim()}
                className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
              >
                <UserPlus className="h-4 w-4" />
                {adding ? "Adding…" : "Add"}
              </button>
            </form>
            <p className="text-xs text-gray-400 mt-1.5">
              The person must already have a Proximity account.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Properties Page Content
function PropertiesSection({
  user,
  setUser,
  handlePropertySelect,
  router,
  onAddListing,
  onEditListing,
  onDeleteListing,
  onManageCoOwners,
}) {
  const [togglingId, setTogglingId] = useState(null);

  async function handleToggleUnavailable(e, property) {
    e.stopPropagation();
    setTogglingId(property._id);
    try {
      const res = await fetch(`/api/listing/${property._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unavailable: !property.unavailable }),
      });
      if (res.ok) {
        const { unavailable } = await res.json();
        setUser((prev) => ({
          ...prev,
          listings: prev.listings.map((l) =>
            l._id === property._id ? { ...l, unavailable } : l
          ),
        }));
      }
    } finally {
      setTogglingId(null);
    }
  }
  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Loading properties...</p>
      </div>
    );
  }

  // Empty state when no properties
  if (!user.listings || user.listings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <div className="flex items-center justify-center h-12 w-12 rounded-full bg-red-50">
          <Home className="h-6 w-6 text-red-600" />
        </div>
        <p className="text-gray-600 text-lg">
          You don&apos;t have any properties yet.
        </p>
        <div className="flex gap-3">
          <Button
            variant="default"
            className="text-white bg-red-600 hover:bg-red-700"
            onClick={onAddListing}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Listing
          </Button>
          <Button
            variant="outline"
            className="border-gray-300"
            onClick={() => router.push("/browse")}
          >
            Browse Listings
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Your Properties</h1>
          <p className="text-gray-500 text-sm sm:text-base">
            Manage and view analytics for all your listings
          </p>
        </div>
        <div className="flex items-center flex-wrap gap-2 sm:gap-3">
          <Badge variant="secondary" className="bg-green-100 text-green-800">
            {user.listings.filter((l) => !l.unavailable).length} Available
          </Badge>
          <Badge variant="secondary" className="bg-gray-100 text-gray-600">
            {user.listings.filter((l) => l.unavailable).length} Unavailable
          </Badge>
          <button
            onClick={onAddListing}
            className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Listing
          </button>
        </div>
      </div>

      <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {user.listings.map((property) => (
          <Card
            key={property._id}
            className="hover:shadow-xl transition-all duration-300 cursor-pointer group border-0 shadow-md hover:scale-[1.02]"
            onClick={() => handlePropertySelect(property)}
          >
            <div className="relative overflow-hidden rounded-t-lg">
              {property.images?.length > 0 ? (
                <img
                  src={property.images[0]}
                  alt={property.title || property.address}
                  className="w-full h-48 object-cover"
                />
              ) : (
                <div
                  className={`w-full h-48 bg-gradient-to-br flex items-center justify-center ${
                    property.unavailable
                      ? "from-gray-100 to-gray-200"
                      : "from-red-100 to-red-200"
                  }`}
                >
                  <Home
                    className={`h-16 w-16 ${
                      property.unavailable ? "text-gray-400" : "text-red-400"
                    }`}
                  />
                </div>
              )}
              <Badge
                className={`absolute top-3 right-3 shadow-sm ${
                  property.unavailable ? "bg-gray-500" : "bg-green-600"
                }`}
              >
                {property.unavailable ? "Unavailable" : "Available"}
              </Badge>
              <button
                onClick={(e) => handleToggleUnavailable(e, property)}
                disabled={togglingId === property._id}
                className="absolute bottom-3 left-3 bg-white/90 hover:bg-white text-xs font-semibold px-2.5 py-1 rounded-full shadow transition disabled:opacity-50"
              >
                {togglingId === property._id
                  ? "Saving…"
                  : property.unavailable
                  ? "Mark Available"
                  : "Mark Unavailable"}
              </button>
            </div>

            <CardHeader className="pb-2">
              <CardTitle className="text-lg group-hover:text-red-600 transition-colors">
                {property.name}
                {/*TODO should a property have a name? Would is be easier for the landlord to manage? */}
              </CardTitle>
              <div className="flex items-center gap-1 text-sm text-gray-500">
                <MapPin className="h-3 w-3" />
                <span className="truncate">{property.address}</span>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-xs text-gray-600">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1">
                    <Bed className="h-3 w-3" />
                    <span className="font-medium">
                      {getUnitValuesLabel(property.unitTypes, "bedrooms")} bed
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Bath className="h-3 w-3" />
                    <span className="font-medium">
                      {getUnitValuesLabel(property.unitTypes, "bathrooms")} bath
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Square className="h-3 w-3" />
                    <span className="font-medium">
                      {getAreaRangeLabel(property.unitTypes)} SF
                    </span>
                  </div>
                </div>
              </div>

              <div className="text-xl font-bold text-gray-900">
                {getRentRangeLabel(property.unitTypes)}
                <span className="text-sm font-normal text-gray-500">
                  /month
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-red-600" />
                <span className="text-sm font-medium text-gray-700">
                  {property.numClicks ?? 0} views
                </span>
              </div>

              {property.coOwners?.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <User className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    Shared with:{" "}
                    {property.coOwners
                      .map((o) => o.name || "Unknown")
                      .join(", ")}
                  </span>
                </div>
              )}

              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditListing(property);
                  }}
                  className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-blue-600 font-medium px-2.5 py-1.5 rounded-md hover:bg-blue-50 transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onManageCoOwners(property);
                  }}
                  className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-purple-600 font-medium px-2.5 py-1.5 rounded-md hover:bg-purple-50 transition-colors"
                >
                  <Users className="h-3.5 w-3.5" />
                  Co-owners
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteListing(property);
                  }}
                  className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-red-600 font-medium px-2.5 py-1.5 rounded-md hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ReviewsSection({ user, viewAsId }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedListingId, setSelectedListingId] = useState("all");
  const [selectedRating, setSelectedRating] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const reviewsPerPage = 5;

  useEffect(() => {
    fetch(
      `/api/landlord/reviews${
        viewAsId ? `?viewAs=${encodeURIComponent(viewAsId)}` : ""
      }`
    )
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setReviews(data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filteredReviews = reviews.filter((r) => {
    const matchesListing =
      selectedListingId === "all" || r.listing?.id === selectedListingId;
    const matchesRating =
      selectedRating === "all" || r.rating === Number(selectedRating);
    return matchesListing && matchesRating;
  });

  const totalPages = Math.max(
    1,
    Math.ceil(filteredReviews.length / reviewsPerPage)
  );
  const paginatedReviews = filteredReviews.slice(
    (currentPage - 1) * reviewsPerPage,
    currentPage * reviewsPerPage
  );

  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : null;

  const ratingCounts = [5, 4, 3, 2, 1].map((s) => ({
    stars: s,
    count: reviews.filter((r) => r.rating === s).length,
  }));
  const maxCount = Math.max(...ratingCounts.map((r) => r.count), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reviews</h1>
        <p className="text-gray-500">Approved reviews from tenants</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48 text-gray-400">
          Loading…
        </div>
      ) : reviews.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
          <Star className="h-8 w-8 text-gray-300" />
          <p className="text-gray-500 font-medium">No reviews yet</p>
          <p className="text-sm text-gray-400">
            Approved tenant reviews will appear here.
          </p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="flex flex-wrap gap-6 items-start">
            <div className="flex items-center gap-3">
              <Star className="h-6 w-6 text-yellow-400" />
              <span className="text-3xl font-bold">{avgRating}</span>
              <span className="text-sm text-gray-500">
                {reviews.length} review{reviews.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-end gap-2">
              {ratingCounts.map(({ stars, count }) => (
                <div key={stars} className="flex flex-col items-center gap-0.5">
                  <span className="text-xs text-gray-500">{count}</span>
                  <div
                    className="w-5 bg-red-500 rounded-t"
                    style={{
                      height: `${Math.max(4, (count / maxCount) * 48)}px`,
                    }}
                  />
                  <span className="text-xs text-gray-400">{stars}★</span>
                </div>
              ))}
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <select
              value={selectedListingId}
              onChange={(e) => {
                setSelectedListingId(e.target.value);
                setCurrentPage(1);
              }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All Properties</option>
              {(user?.listings || []).map((l) => (
                <option key={l._id || l.id} value={l._id || l.id}>
                  {l.title || l.address}
                </option>
              ))}
            </select>
            <select
              value={selectedRating}
              onChange={(e) => {
                setSelectedRating(e.target.value);
                setCurrentPage(1);
              }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All Ratings</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} Stars
                </option>
              ))}
            </select>
          </div>

          {/* List */}
          <Card>
            <CardContent className="p-6">
              {paginatedReviews.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">
                  No reviews match the selected filters.
                </p>
              ) : (
                <div className="space-y-6">
                  {paginatedReviews.map((review) => (
                    <div
                      key={review.id}
                      className="border-b border-gray-100 last:border-0 pb-6 pt-6 last:pb-0"
                    >
                      <div className="flex items-start gap-3">
                        {review.reviewer?.image ? (
                          <img
                            src={review.reviewer.image}
                            alt=""
                            className="h-9 w-9 rounded-full object-cover"
                          />
                        ) : (
                          <div className="h-9 w-9 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                            <User className="h-4 w-4 text-gray-500" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-sm">
                              {review.reviewer?.name || "Anonymous"}
                            </span>
                            <StarRating rating={review.rating} />
                            <span className="text-xs text-gray-400">
                              {new Date(review.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          {review.listing && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              {review.listing.title || review.listing.address}
                            </p>
                          )}
                          {review.comment && (
                            <p className="text-sm text-gray-700 mt-2">
                              {review.comment}
                            </p>
                          )}
                          {/* Landlord Reply */}
                          <ReviewReplySection
                            review={review}
                            owner={user}
                            isLandlord={true}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <button
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 text-sm border rounded-lg disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() =>
                  setCurrentPage((p) => Math.min(p + 1, totalPages))
                }
                disabled={currentPage === totalPages}
                className="px-4 py-2 text-sm border rounded-lg disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const METRIC_COLORS = {
  clicks: "#dc2626",
  saves: "#d97706",
  contacts: "#2563eb",
};
const METRIC_LABELS = { clicks: "Views", saves: "Saves", contacts: "Contacts" };
const RANGE_OPTIONS_CHART = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "6m", label: "6 months" },
];

function generateDates(range) {
  const days = range === "7d" ? 7 : range === "6m" ? 182 : 30;
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * 86400000);
    return d.toISOString().split("T")[0];
  });
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ListingMetricsChart({ listingId, viewAsId }) {
  const [range, setRange] = useState("30d");
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedMetrics, setSelectedMetrics] = useState([
    "clicks",
    "saves",
    "contacts",
  ]);

  useEffect(() => {
    if (!listingId) return;
    setLoading(true);
    const params = new URLSearchParams({ range, listingIds: listingId });
    if (viewAsId) params.set("viewAs", viewAsId);
    fetch(`/api/landlord/metrics?${params}`)
      .then((r) => r.json())
      .then((data) => setMetrics(data.metrics ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [listingId, range]);

  const dates = generateDates(range);
  const chartData = dates.map((d) => {
    const row = { date: fmtDate(d) };
    ["clicks", "saves", "contacts"].forEach((type) => {
      const m = metrics.find(
        (x) => x.metric_type === type && x.recorded_date === d
      );
      row[type] = m?.count ?? 0;
    });
    return row;
  });

  const maxValue =
    selectedMetrics.length > 0
      ? Math.max(
          ...chartData.flatMap((d) => selectedMetrics.map((t) => d[t] ?? 0)),
          1
        )
      : 1;

  const toggleMetric = (type) => {
    setSelectedMetrics((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const tickInterval = range === "7d" ? 0 : range === "30d" ? 4 : 20;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">
          Engagement Over Time
        </CardTitle>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {["clicks", "saves", "contacts"].map((type) => {
              const active = selectedMetrics.includes(type);
              return (
                <button
                  key={type}
                  onClick={() => toggleMetric(type)}
                  className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors border ${
                    active
                      ? "text-white"
                      : "bg-white text-gray-400 border-gray-200"
                  }`}
                  style={
                    active
                      ? {
                          backgroundColor: METRIC_COLORS[type],
                          borderColor: METRIC_COLORS[type],
                        }
                      : {}
                  }
                >
                  {METRIC_LABELS[type]}
                </button>
              );
            })}
          </div>
          <div className="flex gap-1">
            {RANGE_OPTIONS_CHART.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setRange(value)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                  range === value
                    ? "bg-red-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
            Loading…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              data={chartData}
              margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                interval={tickInterval}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                allowDecimals={false}
                domain={[0, maxValue]}
              />
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                formatter={(val, name) => [val, METRIC_LABELS[name] ?? name]}
              />
              <Legend
                formatter={(name) => METRIC_LABELS[name] ?? name}
                wrapperStyle={{ fontSize: 12 }}
              />
              {["clicks", "saves", "contacts"]
                .filter((t) => selectedMetrics.includes(t))
                .map((type) => (
                  <Line
                    key={type}
                    type="monotone"
                    dataKey={type}
                    stroke={METRIC_COLORS[type]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// Property Detail View
function PropertyAnalyticsSection({
  handleBackToProperties,
  selectedProperty: p,
  onEditListing,
  viewAsId,
}) {
  const router = useRouter();
  const [allTimeMetrics, setAllTimeMetrics] = useState([]);
  const [contactTotals, setContactTotals] = useState({});

  const listingId = p?._id || p?.id;
  useEffect(() => {
    if (!listingId) return;
    const params = new URLSearchParams({ range: "all", listingIds: listingId });
    if (viewAsId) params.set("viewAs", viewAsId);
    fetch(`/api/landlord/metrics?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setAllTimeMetrics(data.metrics ?? []);
        setContactTotals(data.contactTotals ?? {});
      })
      .catch(console.error);
  }, [listingId, viewAsId]);

  if (!p) return null;

  const totalViews = allTimeMetrics
    .filter((m) => m.metric_type === "clicks")
    .reduce((sum, m) => sum + m.count, 0);
  const totalSaves = allTimeMetrics
    .filter((m) => m.metric_type === "saves")
    .reduce((sum, m) => sum + m.count, 0);
  const totalContacts = contactTotals[listingId] ?? 0;

  const units = p.unitTypes ?? [];
  const images = Array.isArray(p.images) ? p.images : [];
  const amenities = Array.isArray(p.amenities) ? p.amenities : [];
  const utilities = Array.isArray(p.utilitiesIncluded)
    ? p.utilitiesIncluded
    : [];

  const handleViewAsStudent = () => {
    window.open(`/browse?panel=${p._id || p.id}`, "_blank");
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBackToProperties}
          className="flex items-center gap-2 hover:bg-red-50 hover:text-red-600"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Properties
        </Button>
        <div className="h-4 w-px bg-gray-300" />
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {p.title || p.address}
          </h1>
          {p.title && <p className="text-sm text-gray-500">{p.address}</p>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge
            className={`${
              p.unavailable ? "bg-gray-500" : "bg-green-600"
            } text-white`}
          >
            {p.unavailable ? "Unavailable" : "Available"}
          </Badge>
          <button
            onClick={handleViewAsStudent}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-300 hover:border-green-400 hover:text-green-600 hover:bg-green-50 transition-colors"
          >
            <Eye className="h-3.5 w-3.5" />
            View as Student
          </button>
          {onEditListing && (
            <button
              onClick={() => onEditListing(p)}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-300 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Images */}
      {images.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {images.map((url, i) => (
            <img
              key={i}
              src={url}
              alt=""
              className="h-48 w-72 flex-shrink-0 object-cover rounded-xl border border-gray-200"
            />
          ))}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-5">
        {[
          {
            label: "Views",
            value: totalViews,
            icon: <Eye className="h-4 w-4 text-red-600" />,
          },
          {
            label: "Saves",
            value: totalSaves,
            icon: <Star className="h-4 w-4 text-yellow-500" />,
          },
          {
            label: "Contacts",
            value: totalContacts,
            icon: <MessageSquare className="h-4 w-4 text-blue-500" />,
          },
          {
            label: "Reviews",
            value: p.numReviews ?? 0,
            icon: <MessageSquare className="h-4 w-4 text-purple-500" />,
          },
          {
            label: "Rating",
            value:
              p.numReviews > 0 ? `${Number(p.rating).toFixed(1)} / 5` : "—",
            icon: <ThumbsUp className="h-4 w-4 text-green-500" />,
          },
        ].map(({ label, value, icon }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              {icon}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Per-listing metrics chart */}
      <ListingMetricsChart listingId={p._id || p.id} viewAsId={viewAsId} />

      {/* Details */}
      <Card>
        <CardHeader>
          <CardTitle>Property Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 text-sm">
            {[
              { label: "Home type", value: p.homeType },
              { label: "Lease type", value: p.leaseType },
              { label: "Furnished", value: p.furnished ? "Yes" : "No" },
              {
                label: "Sublease friendly",
                value: p.subleaseFriendly ? "Yes" : "No",
              },
              {
                label: "Move-in date",
                value: p.moveInDate
                  ? new Date(p.moveInDate).toLocaleDateString()
                  : "—",
              },
              { label: "Rent range", value: getRentRangeLabel(units) || "—" },
            ].map(({ label, value }) => (
              <div key={label}>
                <dt className="text-gray-500 font-medium">{label}</dt>
                <dd className="text-gray-900 capitalize mt-0.5">
                  {value ?? "—"}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {/* Units */}
      {units.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Units ({units.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    {[
                      "Beds",
                      "Baths",
                      "Rent / mo",
                      "Area (sq ft)",
                      "Availability",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2.5 font-medium text-gray-500 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {units.map((u, i) => (
                    <tr
                      key={i}
                      className="border-b border-gray-50 last:border-0 hover:bg-gray-50"
                    >
                      <td className="px-4 py-2.5">{u.bedrooms ?? "—"}</td>
                      <td className="px-4 py-2.5">{u.bathrooms ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        {u.rent != null ? `$${u.rent.toLocaleString()}` : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {u.area != null ? u.area.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {u.leaseAvailability ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Amenities & utilities */}
      {(amenities.length > 0 || utilities.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {amenities.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Amenities</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {amenities.map((a) => (
                    <span
                      key={a}
                      className="px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {utilities.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Utilities Included</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {utilities.map((u) => (
                    <span
                      key={u}
                      className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium"
                    >
                      {u}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Contact info */}
      {(p.contactName || p.contactEmail || p.contactPhone) && (
        <Card>
          <CardHeader>
            <CardTitle>Contact Info</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              {p.contactName && (
                <div>
                  <dt className="text-gray-500 font-medium">Name</dt>
                  <dd className="mt-0.5">{p.contactName}</dd>
                </div>
              )}
              {p.contactEmail && (
                <div>
                  <dt className="text-gray-500 font-medium">Email</dt>
                  <dd className="mt-0.5 break-all">{p.contactEmail}</dd>
                </div>
              )}
              {p.contactPhone && (
                <div>
                  <dt className="text-gray-500 font-medium">Phone</dt>
                  <dd className="mt-0.5">{p.contactPhone}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Notification Section - Not in the sidebar
function NotificationSection({
  pendingReviews = [],
  onApprove,
  onReject,
  loadingMap = {},
}) {
  if (!pendingReviews || pendingReviews.length === 0) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-md text-center">
        <div className="text-3xl mb-2">🔔</div>
        <h3 className="text-lg font-semibold mb-1">No pending reviews</h3>
        <p className="text-sm text-gray-500">
          When a student leaves a review for you or one of your listings, it
          will appear here for approval.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Pending Reviews</h2>

      <div className="divide-y rounded-lg overflow-hidden bg-white border border-gray-100 shadow-sm">
        {pendingReviews.map((r) => {
          const id = r._id || r.id;
          const reviewerName = r.reviewer?.name || r.name || "Anonymous";
          const reviewerImage = r.reviewer?.image?.trim?.()
            ? r.reviewer.image
            : "/default-icons/default-user.png";
          const isListing = !!r.listing;
          const targetText = isListing
            ? r.listing?.address || "A listing"
            : "Your landlord profile";
          const loading = !!loadingMap[id];

          return (
            <div
              key={id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <img
                  src={reviewerImage}
                  alt={reviewerName}
                  onError={(e) =>
                    (e.currentTarget.src = "/default-icons/default-user.png")
                  }
                  className="w-10 h-10 rounded-full object-cover border"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">
                      {reviewerName}
                    </span>
                    <span className="text-xs text-gray-500">
                      left a review for
                    </span>
                    <span className="text-sm font-medium text-gray-700">
                      {targetText}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    onApprove?.(id, isListing ? "listing" : "user")
                  }
                  disabled={loading}
                  className="px-3 py-1.5 rounded-md bg-green-600 text-white text-sm hover:bg-green-700 disabled:opacity-60"
                >
                  {loading ? "..." : "Accept"}
                </button>

                <button
                  onClick={() => onReject?.(id, isListing ? "listing" : "user")}
                  disabled={loading}
                  className="px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  {loading ? "..." : "Decline"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// End Sections --------------------------------------------------------------------

// Main Dashboard Component
export default function ProximityDashboard({ initialViewAsId } = {}) {
  const [activeView, setActiveView] = useState("profile");
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState(null);

  const [listingModal, setListingModal] = useState(null); // null | {mode:'add'} | {mode:'edit',listing}
  const [coOwnersModal, setCoOwnersModal] = useState(null); // null | listing
  const [profileUpdatePrompt, setProfileUpdatePrompt] = useState(null); // null | { name?, email?, phone? }
  const [updatingProfile, setUpdatingProfile] = useState(false);

  const { update: updateSession } = useSession();
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    description: "",
    birthday: "",
    gender: "unspecified",
    referralSource: "",
    role: "landlord",
  });

  const router = useRouter();
  const searchParams = useSearchParams();
  // Read viewAsId once and lock it — never let URL changes reset it
  const viewAsIdRef = useRef(initialViewAsId ?? searchParams.get("viewAs"));
  const viewAsId = viewAsIdRef.current;
  const isViewingAs = !!viewAsId;
  const initializedFromUrl = useRef(false);

  useEffect(() => {
    fetchUser();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // restore tab + selected listing from URL on initial load
  useEffect(() => {
    if (!user || initializedFromUrl.current) return;
    initializedFromUrl.current = true;
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    const propertyId = params.get("property");
    if (tab) setActiveView(tab);
    if (propertyId) {
      const listing = user.listings?.find(
        (l) => l._id === propertyId || l.id === propertyId
      );
      if (listing) setSelectedProperty(listing);
    }
  }, [user]);

  // Keep selectedProperty in sync with the freshest user.listings so that
  // re-opening the edit modal after a save shows the updated data.
  useEffect(() => {
    if (!selectedProperty || !user?.listings) return;
    const fresh = user.listings.find(
      (l) => l._id === selectedProperty._id || l.id === selectedProperty.id
    );
    if (fresh && fresh !== selectedProperty) setSelectedProperty(fresh);
  }, [user, selectedProperty]);

  // keep form in sync when user loads
  useEffect(() => {
    if (!user) return;
    setForm({
      name: user.name || "",
      phone: user.phone || "",
      description: user.description || "",
      birthday: user.birthday
        ? new Date(user.birthday).toISOString().split("T")[0]
        : "",
      gender: user.gender || "unspecified",
      referralSource: user.referralSource || "",
      role: (user.role || "landlord").toLowerCase(),
    });
  }, [user]);

  const fetchUser = async () => {
    try {
      const url = isViewingAs
        ? `/api/admin/viewUser?id=${encodeURIComponent(viewAsId)}`
        : `/api/getUser`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch user: ${response.statusText}`);
      }
      setUser(await response.json());
    } catch (error) {
      console.error("Error fetching User:", error);
    }
  };

  // helpers for form
  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const cancelEdit = () => {
    setIsEditing(false);
    // reset to server values
    if (user) {
      setForm({
        name: user.name || "",
        phone: user.phone || "",
        description: user.description || "",
        birthday: user.birthday
          ? new Date(user.birthday).toISOString().split("T")[0]
          : "",
        gender: user.gender || "unspecified",
        referralSource: user.referralSource || "",
        role: (user.role || "landlord").toLowerCase(),
      });
    }
  };

  const saveProfile = async () => {
    try {
      setSaving(true);
      const initialRole = (user?.role || "landlord").toLowerCase();
      const res = await fetch("/api/editProfile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name: form.name?.trim(),
          phone: form.phone?.trim(),
          description: form.description?.trim(),
          birthday: form.birthday || null,
          gender: form.gender || "unspecified",
          referralSource: form.referralSource || "",
          role: form.role,
        }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      const updated = await res.json();
      setUser(updated);
      setIsEditing(false);
      const newRole = (updated?.role ?? form.role ?? "").toLowerCase();
      if (newRole && newRole !== initialRole) {
        await updateSession({ role: newRole });
        if (newRole === "student") {
          router.replace("/dashboard/student");
          return;
        }
        if (newRole === "parent" || newRole === "other") {
          router.replace("/dashboard/student");
          return;
        }
        if (newRole === "super" || newRole === "admin") {
          router.replace("/dashboard/admin");
          return;
        }
      }
    } catch (e) {
      console.error(e);
      alert("Couldn't save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleAddListing = () => setListingModal({ mode: "add" });
  const handleEditListing = (listing) =>
    setListingModal({ mode: "edit", listing });
  const handleManageCoOwners = (listing) => setCoOwnersModal(listing);
  const handleDeleteListing = async (property) => {
    if (
      !confirm(
        `Delete "${property.title || property.address}"? This cannot be undone.`
      )
    )
      return;
    try {
      const res = await fetch(
        `/api/landlord/listings/${property._id || property.id}`,
        {
          method: "DELETE",
        }
      );
      if (res.ok) {
        setUser((prev) => ({
          ...prev,
          listings: prev.listings.filter(
            (l) => l._id !== property._id && l.id !== property.id
          ),
        }));
      } else {
        alert("Could not delete listing. Please try again.");
      }
    } catch {
      alert("Network error.");
    }
  };
  const handleListingModalSuccess = async (
    updatedUnits = null,
    profileDiff = null
  ) => {
    if (updatedUnits && listingModal?.listing) {
      const listingId = listingModal.listing._id || listingModal.listing.id;
      setUser((prev) => ({
        ...prev,
        listings: prev.listings.map((l) =>
          l._id === listingId || l.id === listingId
            ? {
                ...l,
                unitTypes: updatedUnits.map((u) => ({
                  bedrooms: u.bedrooms != null ? Number(u.bedrooms) : null,
                  bathrooms: u.bathrooms != null ? Number(u.bathrooms) : null,
                  area: u.area != null ? Number(u.area) : null,
                  rent: u.rent != null ? Number(u.rent) : null,
                })),
              }
            : l
        ),
      }));
    }
    await fetchUser();
    setListingModal(null);
    if (profileDiff) setProfileUpdatePrompt(profileDiff);
  };

  const handleProfileUpdate = async (shouldUpdate) => {
    if (!shouldUpdate) {
      setProfileUpdatePrompt(null);
      return;
    }
    setUpdatingProfile(true);
    try {
      await fetch("/api/editProfile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(profileUpdatePrompt.name && { name: profileUpdatePrompt.name }),
          ...(profileUpdatePrompt.email && {
            email: profileUpdatePrompt.email,
          }),
          ...(profileUpdatePrompt.phone && {
            phone: profileUpdatePrompt.phone,
          }),
        }),
      });
      await fetchUser();
    } catch {
      // non-fatal — proceed regardless
    } finally {
      setUpdatingProfile(false);
      setProfileUpdatePrompt(null);
    }
  };

  const handleNavigation = (key) => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setActiveView(key);
    setSelectedProperty(null);
    setSidebarOpen(false);
    const p = new URLSearchParams({ tab: key });
    if (viewAsId) p.set("viewAs", viewAsId);
    window.history.replaceState(null, "", `?${p.toString()}`);
  };

  const handlePropertySelect = (property) => {
    setSelectedProperty(property);
    setActiveView("property-analytics");
    const p = new URLSearchParams({
      tab: "properties",
      property: property._id || property.id,
    });
    if (viewAsId) p.set("viewAs", viewAsId);
    window.history.replaceState(null, "", `?${p.toString()}`);
  };

  const handleBackToProperties = () => {
    setSelectedProperty(null);
    setActiveView("properties");
    const p = new URLSearchParams({ tab: "properties" });
    if (viewAsId) p.set("viewAs", viewAsId);
    window.history.replaceState(null, "", `?${p.toString()}`);
  };

  const getPageTitle = () => {
    if (selectedProperty) return selectedProperty.name;
    switch (activeView) {
      case "properties":
        return "Properties";
      case "settings":
        return "Settings";
      case "reviews":
        return "My Reviews";
      case "profile":
        return "My Profile";
      case "analytics":
        return "Analytics";
      default:
        return "Landlord Dashboard";
    }
  };

  const renderContent = () => {
    if (selectedProperty)
      return (
        <PropertyAnalyticsSection
          handleBackToProperties={handleBackToProperties}
          selectedProperty={selectedProperty}
          onEditListing={handleEditListing}
          viewAsId={viewAsId}
        />
      );
    switch (activeView) {
      case "properties":
        return (
          <PropertiesSection
            user={user}
            setUser={setUser}
            handlePropertySelect={handlePropertySelect}
            router={router}
            onAddListing={handleAddListing}
            onEditListing={handleEditListing}
            onDeleteListing={handleDeleteListing}
            onManageCoOwners={handleManageCoOwners}
          />
        );
      case "reviews":
        return <ReviewsSection user={user} viewAsId={viewAsId} />;
      case "analytics":
        return <AnalyticsDashboardSection viewAsId={viewAsId} />;
      case "profile":
      default:
        return (
          <ProfileSection
            user={user}
            isEditing={isEditing}
            form={form}
            onChange={onChange}
            saving={saving}
            cancelEdit={cancelEdit}
            saveProfile={saveProfile}
            setIsEditing={setIsEditing}
          />
        );
    }
  };

  return (
    <>
      {listingModal && (
        <AddEditListingModal
          listing={listingModal.mode === "edit" ? listingModal.listing : null}
          onClose={() => setListingModal(null)}
          onSuccess={handleListingModalSuccess}
          user={user}
        />
      )}
      {coOwnersModal && (
        <ManageCoOwnersModal
          listing={coOwnersModal}
          currentUserId={user?.id}
          onClose={() => setCoOwnersModal(null)}
        />
      )}
      {profileUpdatePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Update your Proximity profile?
            </h3>
            <p className="text-sm text-gray-600">
              The contact info you entered is different from what&apos;s on your
              profile. Would you like to update your profile too?
            </p>
            <ul className="text-sm text-gray-800 space-y-1 bg-gray-50 rounded-lg p-3">
              {profileUpdatePrompt.name && (
                <li>
                  <span className="font-medium">Name:</span>{" "}
                  {profileUpdatePrompt.name}
                </li>
              )}
              {profileUpdatePrompt.email && (
                <li>
                  <span className="font-medium">Email:</span>{" "}
                  {profileUpdatePrompt.email}
                </li>
              )}
              {profileUpdatePrompt.phone && (
                <li>
                  <span className="font-medium">Phone:</span>{" "}
                  {profileUpdatePrompt.phone}
                </li>
              )}
            </ul>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                disabled={updatingProfile}
                onClick={() => handleProfileUpdate(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
              >
                No, keep current profile
              </button>
              <button
                type="button"
                disabled={updatingProfile}
                onClick={() => handleProfileUpdate(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {updatingProfile ? "Updating…" : "Yes, update profile"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="w-full min-h-screen bg-gray-50 font-sans">
        {isViewingAs && user && (
          <div className="bg-gray-900 text-white px-6 py-2 flex items-center justify-between text-sm">
            <span>
              Viewing as{" "}
              <span className="font-semibold">{user.name || user.email}</span>
              <span className="ml-2 text-gray-400 font-mono text-xs">
                {user.id}
              </span>
            </span>
            <a
              href="/dashboard/admin"
              className="text-gray-300 hover:text-white underline"
            >
              ← Exit
            </a>
          </div>
        )}
        <div className="flex">
          {/* Mobile backdrop — only visible when sidebar is open on < md */}
          {sidebarOpen && (
            <div
              className="md:hidden fixed inset-0 bg-black/40 z-30"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
          )}

          {/* Sidebar: fixed drawer on mobile, sticky column on desktop */}
          <aside
            className={`${
              sidebarOpen ? "translate-x-0" : "-translate-x-full"
            } md:translate-x-0 fixed md:sticky top-0 left-0 z-40 w-64 h-screen bg-white border-r border-gray-200 overflow-y-auto transition-transform duration-200 ease-out flex-shrink-0`}
          >
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600 text-white font-bold">
                  P
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">Proximity</span>
                  <span className="text-xs text-gray-500">Landlord Portal</span>
                </div>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="md:hidden p-1.5 text-gray-500 hover:bg-gray-100 rounded-md"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 space-y-6">
              <div>
                <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                  Overview
                </h3>
                <div className="space-y-1">
                  <button
                    onClick={() => handleNavigation("profile")}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-left transition-colors ${
                      activeView === "profile"
                        ? "bg-red-50 text-red-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <User className="h-4 w-4" />
                    My Profile
                  </button>
                  <button
                    onClick={() => handleNavigation("analytics")}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-left transition-colors ${
                      activeView === "analytics"
                        ? "bg-red-50 text-red-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <BarChart3 className="h-4 w-4" />
                    Analytics
                  </button>
                  <button
                    onClick={() => handleNavigation("properties")}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-left transition-colors ${
                      activeView === "properties" || selectedProperty
                        ? "bg-red-50 text-red-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <MapPin className="h-4 w-4" />
                    Properties
                  </button>
                  <button
                    onClick={() => handleNavigation("reviews")}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-left transition-colors ${
                      activeView === "reviews"
                        ? "bg-red-50 text-red-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <Star className="h-4 w-4" />
                    Reviews
                  </button>
                </div>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 border-b bg-white px-4 sm:px-6 py-3 sm:py-4 sticky top-0 z-20">
              <h1 className="text-base sm:text-lg font-semibold text-gray-900 truncate min-w-0">
                {getPageTitle()}
              </h1>
              <button
                onClick={() => setSidebarOpen(true)}
                className="md:hidden p-2 -mr-2 text-gray-700 hover:bg-gray-100 rounded-md flex-shrink-0"
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </button>
            </div>

            <main className="p-4 sm:p-6">{renderContent()}</main>
          </div>
        </div>
      </div>
    </>
  );
}
