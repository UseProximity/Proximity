import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { updateAsUser } from "@/lib/supabaseWithUser";

export async function PATCH(req) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      console.error("PATCH /api/editProfile: no session email", { session });
      return NextResponse.json({ error: "Unauthorized — no session email" }, { status: 401 });
    }

    console.log("PATCH /api/editProfile: looking up email", session.user.email);

    const { data: sbUser, error: lookupError } = await supabase
      .from("users")
      .select("id, roles!role_id(name)")
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

    const currentRole = sbUser.roles?.name ?? null;
    console.log("PATCH /api/editProfile: found Supabase user", { id: sbUser.id, role: currentRole });

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

    // Only allow role changes if provided; only super can promote to super or admin
    if (body.role !== undefined && body.role !== null) {
      if ((body.role === "super" || body.role === "admin") && currentRole !== "super") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const { data: roleRow, error: roleErr } = await supabase
        .from("roles")
        .select("id")
        .eq("name", body.role)
        .single();
      if (roleErr || !roleRow) {
        return NextResponse.json({ error: `Unknown role: ${body.role}` }, { status: 400 });
      }
      allowedFields.role_id = roleRow.id;
    }

    console.log("PATCH /api/editProfile: updating fields", allowedFields);

    const { error } = await updateAsUser(supabase, {
      userId: supabaseId,
      table: "users",
      data: allowedFields,
      rowId: supabaseId,
    });

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

    const { data: updated, error: fetchError } = await supabase
      .from("users")
      .select("*, roles!role_id(name)")
      .eq("id", supabaseId)
      .single();

    if (fetchError || !updated) {
      console.error("PATCH /api/editProfile: fetch after update failed", { supabaseId });
      return NextResponse.json({ error: "Update returned no row" }, { status: 404 });
    }

    // Expose role name at the top level so clients can read `updated.role`
    // and feed it to NextAuth session.update({ role }).
    const { roles, ...rest } = updated;
    return NextResponse.json({ ...rest, role: roles?.name ?? null });
  } catch (e) {
    console.error("PATCH /api/user/profile failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
