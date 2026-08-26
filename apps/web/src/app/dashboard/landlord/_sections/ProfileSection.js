"use client";

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { calcAge } from "@/utils/listingFormatters";
import DeleteAccountButton from "@/components/account/DeleteAccountButton";

export default function ProfileSection({
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
                {user.listings?.length ?? 0} active listings
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

      <DeleteAccountButton />
    </div>
  );
}
