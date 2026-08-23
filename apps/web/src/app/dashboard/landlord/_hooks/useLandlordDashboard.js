"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

export function useLandlordDashboard({ initialViewAsId } = {}) {
  const [activeView, setActiveView] = useState("profile");
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState(null);

  const [listingModal, setListingModal] = useState(null); // null | {mode:'add'} | {mode:'edit',listing}
  const [coOwnersModal, setCoOwnersModal] = useState(null); // null | listing
  const [leaseModal, setLeaseModal] = useState(null); // null | { property, lease }
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
      referralSource: user.referralSource || user.referral_source || "",
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
        referralSource: user.referralSource || user.referral_source || "",
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

  /*
   * Lease-level controls, for a landlord whose stake here is an OFFERING rather
   * than the property record. These hit /api/leases/[leaseId], which is scoped
   * to the caller's own lease — unlike the property routes above, which replace
   * the whole unit set and would (rightly) 403 them.
   */
  const handleEditLease = (property) => {
    const lease = (property.myLeases ?? []).find((x) => x.isActive) ?? property.myLeases?.[0];
    if (!lease) {
      alert("We couldn't find your listing at this property. Try reloading.");
      return;
    }
    setLeaseModal({ property, lease });
  };

  const handleWithdrawLease = async (property) => {
    const lease = (property.myLeases ?? []).find((x) => x.isActive) ?? property.myLeases?.[0];
    if (!lease) {
      alert("We couldn't find your listing at this property. Try reloading.");
      return;
    }
    const where = lease.unitLabel ? `your listing for ${lease.unitLabel}` : "your listing";
    if (
      !confirm(
        `Withdraw ${where} at ${property.title || property.address}? It stops showing to students. The property itself is not affected.`
      )
    )
      return;
    try {
      const res = await fetch(`/api/leases/${lease.id}`, { method: "DELETE" });
      if (res.ok) {
        // Withdrawn, not deleted — the lease row survives as the ownership
        // record, so the property stays on their dashboard, now with no live
        // offering. Refetch rather than guess at the new shape.
        await fetchUser();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Could not withdraw your listing. Please try again.");
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
      case "integrations":
        return "PMS Sync (Beta)";
      case "profile":
        return "My Profile";
      case "analytics":
        return "Analytics";
      default:
        return "Landlord Dashboard";
    }
  };

  return {
    // state
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
    leaseModal,
    setLeaseModal,
    profileUpdatePrompt,
    updatingProfile,
    isEditing,
    setIsEditing,
    saving,
    form,
    // derived
    viewAsId,
    isViewingAs,
    // handlers
    onChange,
    cancelEdit,
    saveProfile,
    handleAddListing,
    handleEditListing,
    handleManageCoOwners,
    handleDeleteListing,
    handleEditLease,
    handleWithdrawLease,
    fetchUser,
    handleListingModalSuccess,
    handleProfileUpdate,
    handleNavigation,
    handlePropertySelect,
    handleBackToProperties,
    getPageTitle,
    router,
  };
}
