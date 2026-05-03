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
  if (session) {
    redirect(callbackUrl);
  }

  return <LoginClient callbackUrl={callbackUrl} initialTab={initialTab} />;
}
