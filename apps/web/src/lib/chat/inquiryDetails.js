/*
 * The detail lines under a student's message in a landlord email
 * (lib/inquiryEmail.js): which unit they are asking about and who they are,
 * as "WashU student, class of 2028". Never their email or phone.
 *
 * Every lookup is best effort: a failure leaves the line out rather than
 * holding up the email.
 */
import supabase from "@/lib/supabase";
import { studentLine, unitLabel } from "@/lib/inquiryEmail";

const LEASE_FIELDS = "rent, rent_is_per_person, description, unit:listing_units!unit_id(name, unit_number, bedrooms, area)";

/** The "Interested in" line for a unit_leases id, or null. */
export async function unitLine(leaseId) {
  if (!leaseId) return null;
  const { data, error } = await supabase.from("unit_leases").select(LEASE_FIELDS).eq("id", leaseId).maybeSingle();
  if (error) console.error("inquiryDetails: lease lookup failed:", error);
  const label = unitLabel(data);
  return label ? `Interested in: ${label}` : null;
}

/** "WashU student, class of 2028" for a user id, or "Student". */
export async function studentDetailLine(userId) {
  if (!userId) return "Student";
  const { data, error } = await supabase
    .from("users")
    .select("graduation_year, school:schools!school_id(short_name, name)")
    .eq("id", userId)
    .maybeSingle();
  if (error) console.error("inquiryDetails: student lookup failed:", error);
  return studentLine({ school: data?.school?.short_name || data?.school?.name, graduationYear: data?.graduation_year });
}

/**
 * Details for a chat alert to the landlord side: the conversation's unit and
 * the student, plus the recipient's first name for stripping "Hi <name>,".
 */
export async function chatInquiryDetails({ threadId, recipientId }) {
  try {
    const [{ data: thread }, { data: owner }] = await Promise.all([
      supabase.from("chat_threads").select("lease_id, interested_user_id").eq("id", threadId).maybeSingle(),
      supabase.from("users").select("name").eq("id", recipientId).maybeSingle(),
    ]);
    const [unit, student] = await Promise.all([unitLine(thread?.lease_id), studentDetailLine(thread?.interested_user_id)]);
    return {
      details: [unit, student].filter(Boolean),
      ownerFirst: String(owner?.name ?? "").trim().split(/\s+/)[0] || null,
    };
  } catch (err) {
    console.error("inquiryDetails: chat details failed:", err);
    return { details: [], ownerFirst: null };
  }
}
