"use client";

import AuthCard from "@/components/auth/AuthCard";

export default function LoginClient({ callbackUrl, initialTab }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <AuthCard callbackUrl={callbackUrl} initialTab={initialTab} showBackHome />
    </div>
  );
}
