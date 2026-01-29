"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Home,
  Heart,
  List,
  Settings,
  Bell,
  Star,
  Plus,
  MapPin,
  User,
  Trash2,
  TrendingUp,
  TrendingDown,
  Eye,
  Square,
  Bed,
  Bath,
} from "lucide-react";
import {
  getAreaRangeLabel,
  getRentRangeLabel,
  getUnitValuesLabel,
} from "@/utils/listingFormatters";

// Components ------------------------------------------------------------------

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
    <div className="bg-white p-8 rounded-lg shadow-lg mb-8">
      <div className="flex flex-col md:flex-row gap-8">
        {/* Profile Image */}
        <div className="flex-shrink-0">
          <img
            src={user.image}
            alt={user.name}
            className="w-32 h-32 rounded-full object-cover border border-gray-200 shadow-md"
          />
        </div>

        {/* Profile Info */}
        <div className="flex-1">
          {!isEditing ? (
            <>
              <h1 className="text-4xl font-bold text-gray-900">{user.name}</h1>
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
              <p className="text-gray-500 mt-2 text-lg">
                {user.listings.length} active sub-leases
              </p>{" "}
              <p className="text-gray-400 text-base mt-2">
                {user.age} years old • {user.gender}
              </p>
              <p className="text-gray-500 text-base mt-2">
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
                  Age
                </label>
                <input
                  type="number"
                  min="16"
                  max="120"
                  name="age"
                  value={form.age}
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

function SubleasesSection({ user, router }) {
  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Loading sub-leases...</p>
      </div>
    );
  }

  // If no subleases, show empty state
  if (user?.listings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <div className="flex items-center justify-center h-12 w-12 rounded-full bg-red-50">
          <List className="h-6 w-6 text-red-600" />
        </div>
        <p className="text-gray-600 text-lg">
          You don&apos;t have any sub-leases yet.
        </p>
        <div className="flex gap-3">
          <Button
            variant="default"
            className="text-white bg-red-600 hover:bg-red-700"
            onClick={() => router.push("/add-sub-lease")}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Sub-Lease
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

  // Case where the user actaul has subleases
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Your Sub-Leases</h1>
          <p className="text-gray-500">
            Manage and view analytics for all your sub-leases.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant="secondary" className="bg-green-100 text-green-800">
            {user.listings.length} Available{" "}
            {/*TODO: Fixed number for now, fix that */}
          </Badge>
          <Badge variant="secondary" className="bg-blue-100 text-blue-800">
            0 Rented {/*TODO: Fixed number for now, fix that */}
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {user.listings.map((property) => (
          <Card
            key={property._id}
            className="hover:shadow-xl transition-all duration-300 cursor-pointer group border-0 shadow-md hover:scale-[1.02]"
          >
            <div className="relative overflow-hidden">
              <div className="w-full h-48 bg-gradient-to-br from-red-100 to-red-200 flex items-center justify-center">
                <Home className="h-16 w-16 text-red-400" />
              </div>
              <Badge
                className={`absolute top-3 right-3 shadow-sm ${
                  property.status !== "Available"
                    ? "bg-blue-600"
                    : "bg-green-600"
                }`}
              >
                Available {/*TODO fixed status for now, fix that */}
              </Badge>
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
                  69 views {/*TODO fixed number of views for now, fix that */}
                </span>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <div className="flex items-center gap-2">
                  {property.weeklyGrowth >= 0 ? (
                    <TrendingUp className="h-4 w-4 text-green-600" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-600" />
                  )}
                  <span
                    className={`text-sm font-medium ${
                      property.weeklyGrowth >= 0
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {property.weeklyGrowth >= 0 ? "+" : ""}
                    -12.7% this week
                    {/*TODO fixed weeklyGrowth for now, fix that */}
                  </span>
                </div>
                <div
                  className={`text-sm font-medium ${
                    property.monthlyGrowth >= 0
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {property.monthlyGrowth >= 0 ? "+" : ""}
                  -1.2% monthly{" "}
                  {/*TODO fixed monthlyGrowth for now, fix that */}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function FavoriteListingsSection({
  user,
  removingIds,
  handleRemoveFavorite,
  router,
}) {
  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Loading profile...</p>
      </div>
    );
  }

  // If no favorites, show empty state
  if (!user.favorites || user.favorites.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <p className="text-gray-500 text-lg">
          You don&apos;t have any favorite listings yet.
        </p>
        <Button
          variant="default"
          size="default"
          className="text-white bg-red-600 hover:bg-red-700"
          onClick={() => router.push("/browse")}
        >
          Browse Listings
        </Button>
      </div>
    );
  }

  // Case where the user has favorites
  return (
    <div className="space-y-6">
      <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {user.favorites.map((listing) => (
          <div
            key={listing._id}
            className="relative group bg-white rounded-2xl shadow-lg transition-colors duration-200 overflow-hidden border border-gray-100 hover:border-red-200"
          >
            <Link href={`/browse?listing=${listing._id}`}>
              <div className="relative">
                <img
                  src={listing.images[0]}
                  alt=""
                  className="w-full h-48 object-cover"
                />
              </div>
              <div className="p-5 bg-gradient-to-br from-gray-50/50 to-white">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-2xl text-black">
                    {getRentRangeLabel(listing.unitTypes)}
                    <span className="text-sm font-normal">/month</span>
                  </h3>
                </div>
                <div className="flex items-center space-x-3 mb-4">
                  <div className="flex items-center space-x-1 bg-gradient-to-r from-emerald-50 to-red-50 border border-emerald-200 px-3 py-1.5 rounded-full shadow-sm">
                    <span className="text-emerald-700 font-semibold text-sm">
                      {getUnitValuesLabel(listing.unitTypes, "bedrooms")}
                    </span>
                    <span className="text-emerald-600 text-xs">bd</span>
                  </div>
                  <div className="flex items-center space-x-1 bg-gradient-to-r from-rose-50 to-pink-50 border border-rose-200 px-3 py-1.5 rounded-full shadow-sm">
                    <span className="text-rose-700 font-semibold text-sm">
                      {getUnitValuesLabel(listing.unitTypes, "bathrooms")}
                    </span>
                    <span className="text-rose-600 text-xs">ba</span>
                  </div>
                  <div className="flex items-center space-x-1 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 px-3 py-1.5 rounded-full shadow-sm">
                    <span className="text-amber-700 font-semibold text-sm">
                      {getAreaRangeLabel(listing.unitTypes)}
                    </span>
                    <span className="text-amber-600 text-xs">sqft</span>
                  </div>
                </div>
                <div className="flex items-start space-x-2 bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <svg
                    className="w-4 h-4 text-indigo-500 mt-0.5 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <p className="text-sm text-gray-700 leading-relaxed font-medium">
                    {listing.address}
                  </p>
                </div>
              </div>
            </Link>
            <div className="absolute bottom-0 left-0 w-0 h-0.5 bg-red-600 transition-[width] duration-300 group-hover:w-full" />

            <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-md rounded-full p-2 shadow-xl border border-white/50">
              {/* Replace HeartIcon with Trash button */}
              <button
                onClick={(e) => handleRemoveFavorite(listing._id, e)}
                disabled={removingIds.has(String(listing._id))}
                aria-label="Remove from favorites"
                className="rounded-full p-2 hover:bg-red-50 text-red-600 disabled:opacity-60"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// End Sections ----------------------------------------------------------------

// Main Dashboard Component
export default function StudentDashboard() {
  const [activeView, setActiveView] = useState("profile");
  const [user, setUser] = useState(null);
  const [removingIds, setRemovingIds] = useState(new Set());

  // NEW: edit mode + form state
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    description: "",
    age: "",
    gender: "unspecified",
  });

  const router = useRouter();

  useEffect(() => {
    fetchUser();
  }, []);

  // keep form in sync when user loads
  useEffect(() => {
    if (!user) return;
    setForm({
      name: user.name || "",
      phone: user.phone || "",
      description: user.description || "",
      age: user.age ?? "",
      gender: user.gender || "unspecified",
    });
  }, [user]);

  const fetchUser = async () => {
    try {
      const response = await fetch(`/api/getUser`);
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
    setForm((f) => ({
      ...f,
      // keep age as "" when empty, otherwise a number (don't collapse 0)
      [name]: name === "age" ? (value === "" ? "" : Number(value)) : value,
    }));
  };

  const cancelEdit = () => {
    setIsEditing(false);
    // reset to server values
    if (user) {
      setForm({
        name: user.name || "",
        phone: user.phone || "",
        description: user.description || "",
        age: user.age ?? "",
        gender: user.gender || "unspecified",
      });
    }
  };

  const saveProfile = async () => {
    try {
      setSaving(true);
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
          age: form.age ? Number(form.age) : null,
          gender: form.gender || "unspecified",
        }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      const updated = await res.json();
      setUser(updated);
      setIsEditing(false);
    } catch (e) {
      console.error(e);
      alert("Couldn't save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveFavorite = async (listingId, e) => {
    e?.preventDefault();
    e?.stopPropagation();

    if (!user) return;
    const key = String(listingId);
    if (removingIds.has(key)) return;

    // optimistic remove
    const snapshot = user;
    setRemovingIds((prev) => new Set(prev).add(key));
    setUser((u) =>
      !u
        ? u
        : {
            ...u,
            favorites: (u.favorites || []).filter(
              (f) => String((f && f._id) || f) !== key
            ),
            favoritesIds: (u.favoritesIds || []).filter(
              (id) => String(id) !== key
            ),
          }
    );

    try {
      const res = await fetch(`/api/favorites/${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
    } catch (err) {
      console.error("Could not remove favorite:", err);
      // rollback
      setUser(snapshot);
    } finally {
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleNavigation = (key) => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setActiveView(key);
  };

  const getPageTitle = () => {
    switch (activeView) {
      case "subleases":
        return "My Subleases";
      case "favorites":
        return "My Favorite Listings";
      case "profile":
        return "Profile";
      default:
        return "Student Dashboard";
    }
  };

  const renderContent = () => {
    switch (activeView) {
      case "subleases":
        return <SubleasesSection user={user} router={router} />;
      case "favorites":
        return (
          <FavoriteListingsSection
            user={user}
            router={router}
            removingIds={removingIds}
            handleRemoveFavorite={handleRemoveFavorite}
          />
        );
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
    <div className="w-full min-h-screen bg-gray-50 font-sans">
      <div className="flex">
        {/* Sidebar */}
        <div className="w-64 bg-white border-r border-gray-200 h-screen sticky top-0 overflow-y-auto">
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600 text-white font-bold">
                S
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold">Proximity</span>
                <span className="text-xs text-gray-500">Student Portal</span>
              </div>
            </div>
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
                  Profile
                </button>
                <button
                  onClick={() => handleNavigation("favorites")}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-left transition-colors ${
                    activeView === "favorites"
                      ? "bg-red-50 text-red-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <Heart className="h-4 w-4" />
                  My Favorite Listings
                </button>
                <button
                  onClick={() => handleNavigation("subleases")}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-left transition-colors ${
                    activeView === "subleases"
                      ? "bg-red-50 text-red-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <List className="h-4 w-4" />
                  My Subleases
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1">
          <div className="flex items-center justify-between border-b bg-white px-6 py-4">
            <h1 className="text-lg font-semibold text-gray-900">
              {getPageTitle()}
            </h1>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-red-50 hover:text-red-600"
              >
                <Bell className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-red-50 hover:text-red-600"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <main className="p-6">{renderContent()}</main>
        </div>
      </div>
    </div>
  );
}
