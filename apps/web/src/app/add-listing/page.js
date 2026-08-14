"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import AddListingWizard from "@/components/listings/wizard/AddListingWizard";

// Full-page "Add Listing" flow for landlords (and super): the step-by-step
// wizard (website import, PMS shortcut, or from scratch); on success we drop
// the landlord back on their dashboard. Role gating lives in layout.js.
export default function AddListingPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  // The form prefills contact fields from `user` on its first render, so wait
  // for the profile fetch to settle before mounting it.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch("/api/getUser")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setUser(data))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 py-4">
      {ready ? (
        <AddListingWizard
          user={user}
          onClose={() => router.push("/dashboard/landlord")}
          onSuccess={() => {
            toast.success("Listing published!");
            router.push("/dashboard/landlord?tab=properties");
          }}
        />
      ) : (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-gray-200 border-t-red-500 rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
