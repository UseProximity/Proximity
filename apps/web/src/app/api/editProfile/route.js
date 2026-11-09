import { NextResponse, after } from "next/server";
import { getRequestUser } from "@/lib/getRequestUser";
import supabase from "@/lib/supabase";
import { updateAsUser } from "@/lib/supabaseWithUser";
import { SELF_ASSIGNABLE_ROLES } from "@/lib/auth/roles";
import { sendMrecFormOnce } from "@/lib/users/mrecForm";
import { normalizeMoveIn, normalizeMonths, normalizeBeds } from "@/lib/listings/leaseFit";
import { prefColumns, savedList, touchesListColumns, withoutListColumns } from "@/lib/listings/leasePrefsColumns";

export async function PATCH(req) {
  try {
    // Web cookie or mobile Bearer token.
    const authUser = await getRequestUser(req);
    if (!authUser?.email) {
      console.error("PATCH /api/editProfile: no session email", { authUser });
      return NextResponse.json({ error: "Unauthorized — no session email" }, { status: 401 });
    }

    console.log("PATCH /api/editProfile: looking up email", authUser.email);

    const { data: sbUser, error: lookupError } = await supabase
      .from("users")
      .select("id, roles!role_id(name)")
      .eq("email", authUser.email)
      .single();

    if (lookupError) {
      console.error("PATCH /api/editProfile: Supabase lookup error", {
        email: authUser.email,
        error: lookupError,
      });
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!sbUser) {
      console.error("PATCH /api/editProfile: no row for email", authUser.email);
      return NextResponse.json(
        { error: `No Supabase user row for email: ${authUser.email}` },
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
    // The business a landlord account represents ("Keeley Properties"). Shown
    // next to their name in chat and in message alert emails.
    if (body.companyName !== undefined) {
      const company = typeof body.companyName === "string" ? body.companyName.trim().slice(0, 100) : "";
      allowedFields.company_name = company || null;
    }
    if (body.description !== undefined) allowedFields.description = body.description;
    if (body.gender !== undefined) allowedFields.gender = body.gender;
    if (body.profileComplete !== undefined) allowedFields.profile_complete = body.profileComplete;
    if (body.referralSource !== undefined) allowedFields.referral_source = body.referralSource;
    if (body.image !== undefined) allowedFields.image = body.image;

    // Chat / outreach emails. Honoured by rpc_chat_notification_recipient.
    if (body.emailNotifications !== undefined) {
      allowedFields.email_notifications = Boolean(body.emailNotifications);
    } else if (body.email_notifications !== undefined) {
      allowedFields.email_notifications = Boolean(body.email_notifications);
    }

    // Accept both camelCase (mobile) and snake_case (web)
    if (body.graduation_year !== undefined)
      allowedFields.graduation_year = body.graduation_year ?? null;
    if (body.graduationYear !== undefined)
      allowedFields.graduation_year = body.graduationYear ?? null;
    if (body.graduation_month !== undefined)
      allowedFields.graduation_month = body.graduation_month ?? null;
    if (body.graduationMonth !== undefined)
      allowedFields.graduation_month = body.graduationMonth ?? null;

    // The student's bed counts, move-in month and lease lengths, which every
    // listing's lease options are narrowed by. null or [] clears. A move-in date is stored as the
    // first of its month: only the month means anything. Sizes and lengths
    // take a list (Wyatt, 2026-11-01) or, from older clients, one number.
    if (body.preferredMoveInDate !== undefined) {
      const raw = body.preferredMoveInDate;
      const moveIn = raw === null || raw === "" ? null : normalizeMoveIn(raw);
      if (raw !== null && raw !== "" && !moveIn) {
        return NextResponse.json({ error: "Invalid move-in month" }, { status: 400 });
      }
      allowedFields.preferred_move_in_date = moveIn;
    }
    const listOf = (raw) => (raw === null || raw === "" ? [] : Array.isArray(raw) ? raw : [raw]);
    if (body.preferredLeaseMonths !== undefined) {
      const raw = listOf(body.preferredLeaseMonths);
      if (raw.length > 24 || raw.some((m) => normalizeMonths(m) == null)) {
        return NextResponse.json({ error: "Invalid lease length" }, { status: 400 });
      }
      Object.assign(allowedFields, prefColumns({ months: raw }));
    }
    if (body.preferredBeds !== undefined) {
      const raw = listOf(body.preferredBeds);
      if (raw.length > 21 || raw.some((b) => normalizeBeds(b) == null)) {
        return NextResponse.json({ error: "Invalid bed count" }, { status: 400 });
      }
      Object.assign(allowedFields, prefColumns({ beds: raw }));
    }

    // Only allow role changes if provided. Anything off the self-assignable
    // allowlist (super, admin, system, ...) requires the caller to be super.
    if (body.role !== undefined && body.role !== null) {
      if (currentRole !== "super" && !SELF_ASSIGNABLE_ROLES.has(body.role)) {
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

    console.log("PATCH /api/editProfile: updating fields", { fields: Object.keys(allowedFields) });

    const update = (data) => updateAsUser(supabase, { userId: supabaseId, table: "users", data, rowId: supabaseId });
    let { error } = await update(allowedFields);
    // Before migration 202611010001 the list columns don't exist: save the
    // first picks in the single columns rather than failing the whole profile.
    if (error && touchesListColumns(allowedFields)) ({ error } = await update(withoutListColumns(allowedFields)));

    if (error) {
      console.error("PATCH /api/editProfile: update failed", {
        supabaseId,
        fields: Object.keys(allowedFields),
        error,
      });
      return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
    }

    const PROFILE = "name, company_name, birthday, gender, phone, description, preferred_move_in_date, preferred_lease_months, preferred_beds, roles!role_id(name)";
    const readBack = (cols) => supabase.from("users").select(cols).eq("id", supabaseId).single();
    let { data: updated, error: fetchError } = await readBack(`${PROFILE}, preferred_beds_list, preferred_lease_months_list`);
    if (fetchError) ({ data: updated, error: fetchError } = await readBack(PROFILE));

    if (fetchError || !updated) {
      console.error("PATCH /api/editProfile: fetch after update failed", { supabaseId });
      return NextResponse.json({ error: "Update returned no row" }, { status: 404 });
    }

    // Just became a landlord: send the MREC form, once, after the response.
    if (body.role === "landlord" && currentRole !== "landlord") after(() => sendMrecFormOnce(supabase, supabaseId, { req }));

    // Expose role name at the top level so clients can read `updated.role`
    // and feed it to NextAuth session.update({ role }). Prefer camelCase for
    // the email preference so dashboards don't have to dual-read snake_case.
    const { roles, ...rest } = updated;
    return NextResponse.json({
      ...rest,
      role: roles?.name ?? null,
      emailNotifications: rest.email_notifications !== false,
      preferredMoveInDate: rest.preferred_move_in_date ?? null,
      preferredLeaseMonths: savedList(rest.preferred_lease_months_list, rest.preferred_lease_months),
      preferredBeds: savedList(rest.preferred_beds_list, rest.preferred_beds),
    });
  } catch (e) {
    console.error("PATCH /api/user/profile failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
