import nodemailer from "nodemailer";
import { sendMailSafe } from "@/lib/outreach";

/*
 * "You have a new listing on Proximity": the note a landlord gets when a
 * property of theirs goes in front of students. Sent by addListing when a
 * listing is published straight away, and by /api/landlord/publish when a
 * draft is published later (202610100002), so a draft gets it once, at the
 * moment it is really live, and never at save time.
 */
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

export async function sendNewListingEmail(toEmail, toName, address, listingId) {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("[sendNewListingEmail] Email env vars not set, skipping in dev mode.");
    return;
  }
  const listingUrl = `https://useproximity.org/browse?listing=${listingId}`;
  await sendMailSafe(transporter, {
    from: `"Proximity" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: "You have a new listing on Proximity!",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111827;">
        <p>Hi ${toName || "there"},</p>
        <p>Congratulations! A new listing has been added to your Proximity account.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p><strong>Address:</strong> ${address}</p>
        <p style="margin-top: 16px;">
          <a href="${listingUrl}" style="display: inline-block; background: #dc2626; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">View Your Listing</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p>Best,<br/>The Proximity Team<br/><a href="https://useproximity.org" style="color: #dc2626;">useproximity.org</a></p>
        <p style="color: #9ca3af; font-size: 12px;">You're receiving this because a listing was assigned to your account on Proximity.</p>
      </div>
    `,
  });
}

/*
 * Every owner of a property, by email. Best-effort: a failed send never fails
 * the thing that triggered it.
 */
export async function emailNewListingToOwners(supabase, listingId) {
  try {
    const { data: listing } = await supabase
      .from("listings")
      .select("address, listing_landlords!listing_id(users!user_id(email, name))")
      .eq("id", listingId)
      .maybeSingle();
    for (const row of listing?.listing_landlords ?? []) {
      const u = row.users;
      if (u?.email) await sendNewListingEmail(u.email, u.name, listing.address, listingId);
    }
  } catch (e) {
    console.error("[sendNewListingEmail] failed:", e?.message);
  }
}
