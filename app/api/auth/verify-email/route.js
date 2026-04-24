import { redirect } from "next/navigation";
import supabase from "@/libs/supabase";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    redirect("/login?error=invalid_token");
  }

  const now = new Date().toISOString();
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("email_verification_token", token)
    .eq("email_verified", false)
    .gt("email_verification_expires_at", now)
    .single();

  if (!user) {
    redirect("/login?error=invalid_token");
  }

  await supabase
    .from("users")
    .update({
      email_verified: true,
      email_verification_token: null,
      email_verification_expires_at: null,
    })
    .eq("id", user.id);

  redirect("/login?verified=1");
}
