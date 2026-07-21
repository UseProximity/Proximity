"use client";

import { BarChart3, MapPin, Plug, Star, User, Menu, X } from "lucide-react";
import ListingFormPanel from "@/components/listings/ListingFormPanel";
import AnalyticsDashboardSection from "./_sections/AnalyticsDashboardSection";
import IntegrationsSection from "./_sections/IntegrationsSection";
import ManageCoOwnersModal from "./_modals/ManageCoOwnersModal";
import ProfileSection from "./_sections/ProfileSection";
import PropertiesSection from "./_sections/PropertiesSection";
import ReviewsSection from "./_sections/ReviewsSection";
import PropertyAnalyticsSection from "./_sections/PropertyAnalyticsSection";
import { useLandlordDashboard } from "./_hooks/useLandlordDashboard";

export default function ProximityDashboard({ initialViewAsId } = {}) {
  const {
    activeView,
    selectedProperty,
    sidebarOpen,
    setSidebarOpen,
    user,
    setUser,
    listingModal,
    setListingModal,
    coOwnersModal,
    setCoOwnersModal,
    profileUpdatePrompt,
    updatingProfile,
    isEditing,
    setIsEditing,
    saving,
    form,
    viewAsId,
    isViewingAs,
    onChange,
    cancelEdit,
    saveProfile,
    handleAddListing,
    handleEditListing,
    handleManageCoOwners,
    handleDeleteListing,
    handleListingModalSuccess,
    handleProfileUpdate,
    handleNavigation,
    handlePropertySelect,
    handleBackToProperties,
    getPageTitle,
    router,
  } = useLandlordDashboard({ initialViewAsId });

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
      case "integrations":
        return <IntegrationsSection />;
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
                  <button
                    onClick={() => handleNavigation("integrations")}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-left transition-colors ${
                      activeView === "integrations"
                        ? "bg-red-50 text-red-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <Plug className="h-4 w-4" />
                    PMS Sync
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
