import { auth } from "@/auth";
import { redirect } from "next/navigation";
import LoginClient from "./LoginClient";

function sanitizeCallbackUrl(raw) {
  if (!raw) return "/dashboard";
  // Prevent open redirect: must be a relative path starting with /
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const callbackUrl = sanitizeCallbackUrl(params?.callbackUrl);
  const initialTab = params?.tab === "signup" ? "signup" : "signin";

  const session = await auth();
  // A deleted account keeps a truthy session object (see auth.js's session
  // callback) but with no id. Checking bare truthiness here would bounce that
  // session straight to callbackUrl, which dashboard/layout.js now redirects
  // right back to /login for the same reason — an infinite loop.
  if (session?.user?.id) {
    redirect(callbackUrl);
  }

  return <LoginClient callbackUrl={callbackUrl} initialTab={initialTab} />;
}
