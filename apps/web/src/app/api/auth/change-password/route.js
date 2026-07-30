import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { auth } from "@/auth";
import { authMobile } from "@/lib/authMobile";

// Helper to get user from either NextAuth session (web) or Bearer token (mobile)
async function getAuthenticatedUser(req) {
  const session = await auth();
  if (session?.user?.id) {
    return { id: session.user.id };
  }

  const mobileAuth = await authMobile(req);
  if (mobileAuth?.user?.id) {
    return { id: mobileAuth.user.id };
  }

  return null;
}

export async function POST(req) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { currentPassword, newPassword } = await req.json();

    // Validation
    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Current password and new password are required" },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "New password must be at least 8 characters" },
        { status: 400 }
      );
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: "New password must be different from current password" },
        { status: 400 }
      );
    }

    // Get user's current password hash
    const { data: userData, error: fetchError } = await supabase
      .from("users")
      .select("password_hash")
      .eq("id", user.id)
      .single();

    if (fetchError || !userData) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Check if user has a password (they might have signed up with Google)
    if (!userData.password_hash) {
      return NextResponse.json(
        { error: "Password change not available for OAuth accounts" },
        { status: 400 }
      );
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(
      currentPassword,
      userData.password_hash
    );

    if (!isValidPassword) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 401 }
      );
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    // Update password in database
    const { error: updateError } = await supabase
      .from("users")
      .update({ password_hash: newPasswordHash })
      .eq("id", user.id);

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Change password error:", err);
    return NextResponse.json(
      { error: "Failed to change password" },
      { status: 500 }
    );
  }
}
