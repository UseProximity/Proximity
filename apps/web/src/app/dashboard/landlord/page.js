"use client";

import { useEffect, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  MapPin,
  MessageCircleQuestion,
  Plug,
  Star,
  User,
  Menu,
  X,
  ChevronDown,
} from "lucide-react";
import AnalyticsDashboardSection from "./_sections/AnalyticsDashboardSection";
import IntegrationsSection from "./_sections/IntegrationsSection";
import ManageCoOwnersModal from "./_modals/ManageCoOwnersModal";
import EditLeaseModal from "./_modals/EditLeaseModal";
import ProfileSection from "./_sections/ProfileSection";
import PropertiesSection from "./_sections/PropertiesSection";
import ReviewsSection from "./_sections/ReviewsSection";
import QuestionsSection from "./_sections/QuestionsSection";
import ToursSection from "./_sections/ToursSection";
import PropertyAnalyticsSection from "./_sections/PropertyAnalyticsSection";
import { useLandlordDashboard } from "./_hooks/useLandlordDashboard";

export default function ProximityDashboard({ initialViewAsId } = {}) {
  const {
    activeView,
    selectedProperty,
    sidebarOpen,
    setSidebarOpen,
    user,
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
    handleManageCoOwners,
    handleDeleteListing,
    handleEditLease,
    handleWithdrawLease,
    handleRepublishLease,
    leaseModal,
    setLeaseModal,
    fetchUser,
    handleProfileUpdate,
    handleNavigation,
    handlePropertySelect,
    handleBackToProperties,
    backLabel,
    getPageTitle,
    router,
  } = useLandlordDashboard({ initialViewAsId });

  // Properties opens into Live and Drafts. Open by default: the drafts count is
  // the thing a landlord should not have to go looking for.
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  // What is waiting on the landlord from Proxy (open questions and tour
  // requests), shown as a count on the Questions tab; refreshed every minute.
  const [waiting, setWaiting] = useState({ questions: 0, tours: 0 });
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const qs = viewAsId ? `?viewAs=${encodeURIComponent(viewAsId)}` : "";
      fetch(`/api/landlord/proxy-chat${qs}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled && d?.waiting) setWaiting(d.waiting); }).catch(() => {});
    };
    load();
    const t = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, [viewAsId, activeView]);
  const listings = user?.listings ?? [];
  const draftCount =
    listings.filter((l) => l.isDraft).length +
    listings.filter(
      (l) =>
        !l.isDraft &&
        ((l.draftUnitCount ?? 0) + (l.draftLeaseCount ?? 0) > 0 ||
          (l.ownership === "lease" && l.myLeases?.some((x) => x.isDraft)))
    ).length;
  const inProperties =
    activeView === "properties" || activeView === "drafts" || !!selectedProperty;

  /*
   * This dashboard is reachable by anyone holding a stake, which now includes a
   * student subletting a room. Three of its sections are the property business's
   * back office rather than anything about an offering: portfolio Analytics,
   * Reviews of the landlord, and PMS Sync. A subletter has no portfolio, no
   * reviews, and no property management system, so those are hidden for them.
   *
   * `role` comes from the DB via getUser, not from the JWT, so a freshly
   * promoted landlord sees them without signing out. The APIs behind each
   * section enforce their own access; this only decides what to show.
   */
  const role = (user?.role ?? "").toLowerCase();
  // Sections that belong to running a property business, not to holding one lease.
  const LANDLORD_ONLY = new Set(["analytics", "reviews", "integrations"]);
  const isLandlord = role === "landlord" || role === "super";

  const renderContent = () => {
    if (selectedProperty)
      return (
        <PropertyAnalyticsSection
          handleBackToProperties={handleBackToProperties}
          backLabel={backLabel}
          selectedProperty={selectedProperty}
          viewAsId={viewAsId}
          onPhotosChanged={fetchUser}
          currentUserEmail={user?.email ?? null}
        />
      );
    /*
     * Guarded as well as hidden: ?tab=analytics is a URL anyone can type, and a
     * hidden button is not access control. Someone without the role lands on
     * their properties — the thing they actually came here for — rather than a
     * blank panel or an error.
     */
    const view =
      LANDLORD_ONLY.has(activeView) && !isLandlord ? "properties" : activeView;

    switch (view) {
      case "properties":
      case "drafts":
        return (
          <PropertiesSection
            user={user}
            mode={view === "drafts" ? "drafts" : "live"}
            onPublished={fetchUser}
            handlePropertySelect={handlePropertySelect}
            router={router}
            onAddListing={handleAddListing}
            onDeleteListing={handleDeleteListing}
            onEditLease={handleEditLease}
            onWithdrawLease={handleWithdrawLease}
            onRepublishLease={handleRepublishLease}
            onManageCoOwners={handleManageCoOwners}
          />
        );
      case "reviews":
        return <ReviewsSection user={user} viewAsId={viewAsId} />;
      case "questions":
        return <QuestionsSection viewAsId={viewAsId} />;
      case "tours":
        return <ToursSection viewAsId={viewAsId} />;
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
            canDeleteAccount={!viewAsId}
          />
        );
    }
  };

  return (
    <>
      {coOwnersModal && (
        <ManageCoOwnersModal
          listing={coOwnersModal}
          currentUserId={user?.id}
          onClose={() => setCoOwnersModal(null)}
        />
      )}
      {leaseModal && (
        <EditLeaseModal
          property={leaseModal.property}
          lease={leaseModal.lease}
          onClose={() => setLeaseModal(null)}
          onSaved={fetchUser}
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
            {/* h-16 matches the content header exactly so the two bottom
                borders form one continuous line across the page. */}
            <div className="h-16 px-4 border-b border-gray-200 flex items-center justify-between">
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
                  {isLandlord && (
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
                  )}
                  <button
                    onClick={() => setPropertiesOpen((o) => !o)}
                    aria-expanded={propertiesOpen}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-left transition-colors ${
                      inProperties
                        ? "text-red-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <MapPin className="h-4 w-4" />
                    Properties
                    <ChevronDown
                      className={`ml-auto h-4 w-4 transition-transform ${
                        propertiesOpen ? "" : "-rotate-90"
                      }`}
                    />
                  </button>
                  {propertiesOpen && (
                    <div className="ml-5 space-y-1 border-l border-gray-200 pl-2">
                      {[
                        { key: "properties", label: "Live" },
                        { key: "drafts", label: "Drafts", count: draftCount },
                      ].map(({ key, label, count }) => (
                        <button
                          key={key}
                          onClick={() => handleNavigation(key)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg w-full text-left text-sm transition-colors ${
                            activeView === key
                              ? "bg-red-50 text-red-700 font-medium"
                              : "text-gray-600 hover:bg-gray-50"
                          }`}
                        >
                          {label}
                          {count > 0 && (
                            <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                              {count}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {isLandlord && (
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
                  )}
                  <button
                    onClick={() => handleNavigation("questions")}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-left transition-colors ${
                      activeView === "questions"
                        ? "bg-red-50 text-red-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <MessageCircleQuestion className="h-4 w-4" />
                    Questions
                    {waiting.questions > 0 && (
                      <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">{waiting.questions}</span>
                    )}
                  </button>
                  <button
                    onClick={() => handleNavigation("tours")}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-left transition-colors ${
                      activeView === "tours"
                        ? "bg-red-50 text-red-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <CalendarDays className="h-4 w-4" />
                    Tours
                    {waiting.tours > 0 && (
                      <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">{waiting.tours}</span>
                    )}
                  </button>
                  {isLandlord && (
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
                    <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                      Beta
                    </span>
                  </button>
                  )}
                </div>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <div className="flex-1 min-w-0">
            <div className="flex h-16 items-center justify-between gap-2 border-b bg-white px-4 sm:px-6 sticky top-0 z-20">
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
