import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/libs/supabase";

export async function PATCH(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    // Build allowed fields mapped to snake_case for Supabase
    const allowedFields = {};

    if (body.name !== undefined) allowedFields.name = body.name;
    if (body.phone !== undefined) allowedFields.phone = body.phone;
    if (body.description !== undefined) allowedFields.description = body.description;
    if (body.gender !== undefined) allowedFields.gender = body.gender;
    if (body.profileComplete !== undefined) allowedFields.profile_complete = body.profileComplete;
    if (body.referralSource !== undefined) allowedFields.referral_source = body.referralSource;
    if (body.image !== undefined) allowedFields.image = body.image;

    if (body.birthday !== undefined && body.birthday !== null) {
      const parsed = new Date(body.birthday);
      if (!isNaN(parsed.getTime())) allowedFields.birthday = parsed.toISOString();
    }

    // Only allow role changes if provided; super can only be set if already super
    if (body.role !== undefined && body.role !== null) {
      if (body.role === "super") {
        const { data: currentUser } = await supabase
          .from("users")
          .select("role")
          .eq("id", session.user.id)
          .single();
        if (currentUser?.role !== "super") {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      }
      allowedFields.role = body.role;
    }

    const { data: updated, error } = await supabase
      .from("users")
      .update(allowedFields)
      .eq("id", session.user.id)
      .select()
      .single();

    if (error) {
      console.error("PATCH /api/editProfile failed:", error);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    if (!updated) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (e) {
    console.error("PATCH /api/user/profile failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
