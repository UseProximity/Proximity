"use client";

import { useState, useEffect, useRef } from "react";
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
  X,
  Users,
  UserPlus,
  Copy,
} from "lucide-react";

import LeasingFunnel from "@/components/dashboard/leasing-funnel";
import {
  getAreaRangeLabel,
  getRentRangeLabel,
  getUnitValuesLabel,
  calcAge,
} from "@/utils/listingFormatters";
import ReviewReplySection from "@/components/listings/ReviewReplySection";
import ListingFormPanel from "@/components/listings/ListingFormPanel";

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

const REVIEW_IMPACT_TIERS = ["0", "1-2", "3-4", "5-9", "10+"];

const REVIEW_IMPACT_THRESHOLDS = {
  baselineMinN: 10,
  comparisonMinN: 5,
  minLift: 1.5,
};

function reviewImpactTierLabel(tier) {
  if (tier === "10+") return "10+";
  return tier.replace("-", "–");
}

function nextValidReviewImpactTier(impact, currentBucket, { enforceThresholds = true } = {}) {
  if (!impact?.lift || !impact?.summary) return null;
  if ((impact.summary["0"]?.n ?? 0) < REVIEW_IMPACT_THRESHOLDS.baselineMinN) {
    return null;
  }

  const startIdx = REVIEW_IMPACT_TIERS.indexOf(currentBucket) + 1;
  for (let i = startIdx; i < REVIEW_IMPACT_TIERS.length; i++) {
    const tier = REVIEW_IMPACT_TIERS[i];
    const n = impact.summary[tier]?.n ?? 0;
    const lift = impact.lift[tier];
    if (n < REVIEW_IMPACT_THRESHOLDS.comparisonMinN || typeof lift !== "number") {
      continue;
    }
    if (!enforceThresholds || lift >= REVIEW_IMPACT_THRESHOLDS.minLift) {
      return { tier, lift };
    }
  }
  return null;
}

// Shareable per-landlord review-invite link, copied to clipboard from the
// Reviews tab. `userId` is the LANDLORD's id, even under super/admin
// `?viewAs=` impersonation, because `user` here comes from /api/admin/viewUser
// (which returns the target landlord). Never substitute the session id.
function InviteLinkCard({ userId, impact, enforceThresholds }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);

  const link = origin && userId ? `${origin}/review-invite/${userId}` : "";
  const stat = nextValidReviewImpactTier(impact, "0", { enforceThresholds });

  function copy() {
    if (!link) return;
    navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card>
      <CardContent className="!p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            {stat
              ? "Reviews build trust on Proximity"
              : "Build trust with verified reviews"}
          </h3>
          <p className="mt-1.5 text-sm text-gray-600 leading-relaxed">
            {stat ? (
              <>
                Listings with{" "}
                <span className="font-medium text-gray-900">
                  {reviewImpactTierLabel(stat.tier)}
                </span>{" "}
                reviews have received{" "}
                <span className="font-medium text-gray-900">
                  {stat.lift.toFixed(1)}&times; more contact requests
                </span>{" "}
                than listings with none. Share your invite link with past
                tenants — they pick which property to review.
              </>
            ) : (
              <>
                Students rely on verified WashU-student reviews when deciding
                who to contact. Share this link with past tenants — they pick
                which property to review and submit in under a minute.
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <input
            readOnly
            value={link}
            placeholder="Loading…"
            onFocus={(e) => e.target.select()}
            className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
          />
          <button
            type="button"
            onClick={copy}
            disabled={!link}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewImpactDevPanel({ impact, bypassThresholds, onBypassChange }) {
  const statEnforced = impact
    ? nextValidReviewImpactTier(impact, "0", { enforceThresholds: true })
    : null;
  const statRaw = impact
    ? nextValidReviewImpactTier(impact, "0", { enforceThresholds: false })
    : null;

  return (
    <div className="mt-8 border-t border-gray-200 pt-6">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
        Dev preview — review impact stat
      </p>
      <p className="mt-2 text-sm text-gray-600 leading-relaxed">
        State A (stat in card) only shows when all thresholds pass: baseline
        bucket <code className="text-xs bg-gray-100 px-1 rounded">0</code> has
        n&thinsp;&ge;&thinsp;{REVIEW_IMPACT_THRESHOLDS.baselineMinN}, comparison
        bucket has n&thinsp;&ge;&thinsp;{REVIEW_IMPACT_THRESHOLDS.comparisonMinN},
        and lift&thinsp;&ge;&thinsp;{REVIEW_IMPACT_THRESHOLDS.minLift}&times; vs
        zero-review listings. Otherwise the card shows qualitative State B copy.
      </p>

      <label className="mt-4 flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={bypassThresholds}
          onChange={(e) => onBypassChange(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
        />
        <span className="text-sm text-gray-800">
          Bypass thresholds — show raw platform stat in card
        </span>
      </label>

      {impact?.summary && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2 font-medium">Reviews</th>
                <th className="px-4 py-2 font-medium">Listings (n)</th>
                <th className="px-4 py-2 font-medium">Avg contacts</th>
                <th className="px-4 py-2 font-medium">Lift vs 0</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {REVIEW_IMPACT_TIERS.map((tier) => {
                const row = impact.summary[tier];
                const lift = impact.lift?.[tier];
                return (
                  <tr key={tier} className="text-gray-700">
                    <td className="px-4 py-2 font-medium">
                      {reviewImpactTierLabel(tier)}
                    </td>
                    <td className="px-4 py-2">{row?.n ?? 0}</td>
                    <td className="px-4 py-2">
                      {row?.n ? row.avgContacts.toFixed(2) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {typeof lift === "number" ? `${lift.toFixed(2)}×` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-gray-400">
        {impact?.computedAt
          ? `Data from GET /api/stats/review-impact · computed ${new Date(impact.computedAt).toLocaleString()}`
          : "Loading platform stats…"}
        {impact &&
          ` · Card mode: ${bypassThresholds ? "raw" : "thresholds"} → ${
            (bypassThresholds ? statRaw : statEnforced) ? "State A" : "State B"
          }`}
      </p>
    </div>
  );
}

function ReviewsSection({ user, viewAsId }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedListingId, setSelectedListingId] = useState("all");
  const [selectedRating, setSelectedRating] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [impact, setImpact] = useState(null);
  const [bypassStatThresholds, setBypassStatThresholds] = useState(false);
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

  useEffect(() => {
    fetch("/api/stats/review-impact")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && !data.error) setImpact(data);
      })
      .catch(() => {});
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
      </div>

      <InviteLinkCard
        userId={user?.id}
        impact={impact}
        enforceThresholds={!bypassStatThresholds}
      />

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

      <ReviewImpactDevPanel
        impact={impact}
        bypassThresholds={bypassStatThresholds}
        onBypassChange={setBypassStatThresholds}
      />
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

  const handleAddListing = () => router.push("/add-listing");
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
        <ListingFormPanel
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
