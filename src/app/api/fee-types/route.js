import supabase from "@/lib/supabase";

// GET /api/fee-types — public read, used in the add-listing wizard fee form
export async function GET() {
  const { data, error } = await supabase
    .from("fee_types")
    .select("id, name, category, display_label, sort_order")
    .order("sort_order");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data ?? []);
}
