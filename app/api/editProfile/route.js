import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/libs/supabase";

export async function PATCH(req) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      console.error("PATCH /api/editProfile: no session email", { session });
      return NextResponse.json({ error: "Unauthorized — no session email" }, { status: 401 });
    }

    console.log("PATCH /api/editProfile: looking up email", session.user.email);

    // Always look up by email — session.user.id may be a MongoDB ObjectId for new users
    const { data: sbUser, error: lookupError } = await supabase
      .from("users")
      .select("id, role")
      .eq("email", session.user.email)
      .single();

    if (lookupError) {
      console.error("PATCH /api/editProfile: Supabase lookup error", {
        email: session.user.email,
        error: lookupError,
      });
      return NextResponse.json(
        { error: "User not found in Supabase", detail: lookupError.message, code: lookupError.code },
        { status: 404 }
      );
    }

    if (!sbUser) {
      console.error("PATCH /api/editProfile: no row for email", session.user.email);
      return NextResponse.json(
        { error: `No Supabase user row for email: ${session.user.email}` },
        { status: 404 }
      );
    }

    console.log("PATCH /api/editProfile: found Supabase user", { id: sbUser.id, role: sbUser.role });

    const supabaseId = sbUser.id;
    const body = await req.json();

    // Build allowed fields mapped to snake_case for Supabase
    const allowedFields = {};

    if (body.name !== undefined) allowedFields.name = body.name;
    if (body.birthday !== undefined) allowedFields.birthday = body.birthday || null;
    if (body.phone !== undefined) allowedFields.phone = body.phone;
    if (body.description !== undefined) allowedFields.description = body.description;
    if (body.gender !== undefined) allowedFields.gender = body.gender;
    if (body.profileComplete !== undefined) allowedFields.profile_complete = body.profileComplete;
    if (body.referralSource !== undefined) allowedFields.referral_source = body.referralSource;
    if (body.image !== undefined) allowedFields.image = body.image;

    if (body.graduation_year !== undefined)
      allowedFields.graduation_year = body.graduation_year ?? null;
    if (body.graduation_month !== undefined)
      allowedFields.graduation_month = body.graduation_month ?? null;

    // Only allow role changes if provided; super can only be set if already super
    if (body.role !== undefined && body.role !== null) {
      if (body.role === "super") {
        if (sbUser.role !== "super") {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      }
      allowedFields.role = body.role;
    }

    console.log("PATCH /api/editProfile: updating fields", allowedFields);

    const { data: updated, error } = await supabase
      .from("users")
      .update(allowedFields)
      .eq("id", supabaseId)
      .select()
      .single();

    if (error) {
      console.error("PATCH /api/editProfile: update failed", {
        supabaseId,
        allowedFields,
        error,
      });
      return NextResponse.json(
        { error: "DB update failed", detail: error.message, code: error.code },
        { status: 500 }
      );
    }

    if (!updated) {
      console.error("PATCH /api/editProfile: update returned no row", { supabaseId });
      return NextResponse.json({ error: "Update returned no row" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (e) {
    console.error("PATCH /api/user/profile failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
