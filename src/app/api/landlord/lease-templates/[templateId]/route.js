import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

async function resolveTemplate(templateId, userId) {
  const { data, error } = await supabase
    .from("lease_templates")
    .select("*")
    .eq("id", templateId)
    .eq("landlord_id", userId)
    .single();
  if (error || !data) return { err: "Not found", status: 404 };
  return { template: data };
}

// GET /api/landlord/lease-templates/[templateId]
export async function GET(_req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { templateId } = await params;
  const { template, err, status } = await resolveTemplate(templateId, session.user.id);
  if (err) return NextResponse.json({ error: err }, { status });
  return NextResponse.json(template);
}

// PATCH /api/landlord/lease-templates/[templateId]
// Allows updating display_name, listing_id, is_active, template_pdf_url.
export async function PATCH(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { templateId } = await params;
  const { err, status } = await resolveTemplate(templateId, session.user.id);
  if (err) return NextResponse.json({ error: err }, { status });

  const body = await req.json();
  const ALLOWED = new Set(["display_name", "listing_id", "is_active", "template_pdf_url"]);
  const updates = Object.fromEntries(Object.entries(body).filter(([k]) => ALLOWED.has(k)));
  if (!Object.keys(updates).length)
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });

  const { data, error } = await supabase
    .from("lease_templates")
    .update(updates)
    .eq("id", templateId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/landlord/lease-templates/[templateId]
// Soft-deactivates rather than hard-deletes (executed leases reference this).
export async function DELETE(_req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { templateId } = await params;
  const { err, status } = await resolveTemplate(templateId, session.user.id);
  if (err) return NextResponse.json({ error: err }, { status });

  const { error } = await supabase
    .from("lease_templates")
    .update({ is_active: false })
    .eq("id", templateId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
