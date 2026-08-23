import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { sendMailSafe } from "@/lib/outreach";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { calcAge } from "@/utils/listingFormatters";

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL SETUP INSTRUCTIONS
//
// This route sends an email from info@useproximity.org to the landlord's email
// when a prospective tenant submits the contact form on a listing page.
//
// You must set the following environment variables in your .env.local file:
//
//   EMAIL_HOST=...
//   EMAIL_PORT=587
//   EMAIL_USER=...
//   EMAIL_PASS=...
//
// ─── OPTION A: Gmail App Password ────────────────────────────────────────────
//
//   1. The sending account (info@useproximity.org) must have 2-Step Verification
//      enabled in Google Account settings.
//   2. Go to: Google Account → Security → App Passwords
//   3. Generate an app password for "Mail" / "Other (custom name)"
//   4. Set env vars:
//        EMAIL_HOST=smtp.gmail.com
//        EMAIL_PORT=587
//        EMAIL_USER=info@useproximity.org
//        EMAIL_PASS=<the 16-character app password>
//
// ─── OPTION B: SendGrid ──────────────────────────────────────────────────────
//
//   1. Sign up at sendgrid.com and verify your sending domain (useproximity.org)
//   2. Create an API key with "Mail Send" permissions
//   3. Set env vars:
//        EMAIL_HOST=smtp.sendgrid.net
//        EMAIL_PORT=587
//        EMAIL_USER=apikey
//        EMAIL_PASS=<your SendGrid API key>
//
// ─── OPTION C: Resend (recommended for Next.js) ──────────────────────────────
//
//   Alternatively, replace this entire route with the Resend SDK:
//     npm install resend
//   Then use:
//     import { Resend } from 'resend';
//     const resend = new Resend(process.env.RESEND_API_KEY);
//     await resend.emails.send({ from, to, subject, html });
//
// ─────────────────────────────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false, // true for port 465, false for 587 (STARTTLS)
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      firstName,
      lastName,
      email,
      phone,
      message,
      listingId,
      leaseId,
      landlordName,
      listingAddress,
    } = body;
    // NOTE: any landlordEmail in the body is ignored — the recipient is resolved
    // from the database below so a caller cannot choose who this mails.

    // Validate required fields
    if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !message?.trim()) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    /*
     * Resolve the recipient from the chosen lease.
     *
     * One lease is one landlord's offering, so the lease — not the property —
     * determines who hears about this enquiry. Resolving it here rather than
     * trusting the request body also closes an open-relay hole: the recipient
     * address used to come straight from the client, so this endpoint could be
     * made to mail an arbitrary address with Proximity's own branding.
     */
    let toEmail = null;
    let toName = null;
    let leaseSummary = null;

    if (leaseId) {
      const { data: lease, error: leaseError } = await supabase
        .from("unit_leases")
        .select(
          `id, rent, sublease, furnished, lease_term_months, available_from,
           contact_name, contact_email,
           users!owner_id(name, email),
           listing_units!unit_id(
             unit_designator, unit_number, bedrooms, bathrooms,
             listings!listing_id(id, address, contact_name, contact_email)
           )`
        )
        .eq("id", leaseId)
        .maybeSingle();

      if (leaseError) {
        console.error("[contactLandlord] Lease lookup failed:", leaseError.message);
        return NextResponse.json(
          { error: "Could not reach that landlord." },
          { status: 500 }
        );
      }
      if (!lease) {
        return NextResponse.json(
          { error: "That lease is no longer available." },
          { status: 404 }
        );
      }

      const unit = lease.listing_units;
      const parentListing = unit?.listings;

      // The lease's own contact wins, then its owner's account, then the
      // property-level contact for leases that predate per-lease contacts.
      toEmail =
        lease.contact_email ||
        lease.users?.email ||
        parentListing?.contact_email ||
        null;
      toName =
        lease.contact_name ||
        lease.users?.name ||
        parentListing?.contact_name ||
        null;

      const unitLabel = unit?.unit_designator
        ? unit.unit_designator === "Whole"
          ? "Whole property"
          : `${unit.unit_designator} ${unit.unit_number ?? ""}`.trim()
        : null;

      leaseSummary = {
        unitLabel,
        bedrooms: unit?.bedrooms ?? null,
        bathrooms: unit?.bathrooms ?? null,
        rent: lease.rent,
        sublease: !!lease.sublease,
        furnished: lease.furnished,
        terms: Array.isArray(lease.lease_term_months)
          ? lease.lease_term_months
          : [],
        availableFrom: lease.available_from,
        address: parentListing?.address ?? null,
      };
    }

    // Fall back to the property's own contact — never to a client-supplied
    // address — for listings with no lease to select.
    if (!toEmail && listingId) {
      const { data: listingRow } = await supabase
        .from("listings")
        .select("contact_name, contact_email, listing_landlords(user_id, is_primary)")
        .eq("id", listingId)
        .is("deleted_at", null)
        .maybeSingle();

      if (listingRow?.contact_email) {
        toEmail = listingRow.contact_email;
        toName = listingRow.contact_name ?? null;
      } else {
        const ll = listingRow?.listing_landlords ?? [];
        const primary = ll.find((x) => x.is_primary) ?? ll[0] ?? null;
        if (primary?.user_id) {
          const { data: owner } = await supabase
            .from("users")
            .select("name, email")
            .eq("id", primary.user_id)
            .maybeSingle();
          toEmail = owner?.email ?? null;
          toName = owner?.name ?? null;
        }
      }
    }

    if (!toEmail) {
      return NextResponse.json(
        { error: "This listing has no contact on file." },
        { status: 422 }
      );
    }

    const resolvedLandlordName = toName || landlordName || null;

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      );
    }

    const senderName = `${firstName.trim()} ${lastName.trim()}`;

    // Which offering the enquiry is about. Without this a landlord with several
    // leases at one property cannot tell which one the student means.
    const leaseDetailHtml = leaseSummary
      ? `
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;margin:16px 0;">
            <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;">Regarding this lease</p>
            <p style="margin:0;font-weight:600;">${[
              leaseSummary.unitLabel,
              leaseSummary.rent != null
                ? `$${Number(leaseSummary.rent).toLocaleString("en-US")}/mo`
                : "Price on request",
            ]
              .filter(Boolean)
              .join(" · ")}</p>
            <p style="margin:4px 0 0;font-size:13px;color:#4b5563;">${[
              leaseSummary.bedrooms != null
                ? leaseSummary.bedrooms === 0
                  ? "Studio"
                  : `${leaseSummary.bedrooms} bed`
                : null,
              leaseSummary.bathrooms != null
                ? `${leaseSummary.bathrooms} bath`
                : null,
              leaseSummary.terms.length
                ? `${leaseSummary.terms.join(", ")} month`
                : null,
              leaseSummary.sublease ? "Sublease" : null,
              leaseSummary.furnished ? "Furnished" : null,
            ]
              .filter(Boolean)
              .join(" · ")}</p>
          </div>`
      : "";

    const landlordMailOptions = {
      from: `"Proximity" <${process.env.EMAIL_USER || "info@useproximity.org"}>`,
      to: toEmail,
      replyTo: email,
      subject: `New Inquiry: ${
        leaseSummary?.unitLabel
          ? `${leaseSummary.unitLabel}, `
          : ""
      }${listingAddress || "Your Listing"} — via Proximity`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111827;">
          <p>Hi ${resolvedLandlordName || "there"},</p>

          <p>You've received a new inquiry about your listing at <strong>${listingAddress || "your property"}</strong> through Proximity.</p>

          ${leaseDetailHtml}

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />

          <p style="margin: 6px 0;"><strong>From:</strong> ${senderName}</p>
          <p style="margin: 6px 0;"><strong>Email:</strong> <a href="mailto:${email}" style="color: #dc2626;">${email}</a></p>
          <p style="margin: 6px 0;"><strong>Phone:</strong> ${phone?.trim() || "Not provided"}</p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />

          <p style="margin-bottom: 8px;"><strong>Message:</strong></p>
          <p style="white-space: pre-wrap; color: #374151; font-style: italic;">"${message.trim()}"</p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />

          <p>You can reply directly to this email to respond to ${firstName.trim()}. Quick responses help students make confident decisions, and responsive landlords tend to get the best tenants.</p>

          <p>Best,<br/>The Proximity Team<br/><a href="https://useproximity.org" style="color: #dc2626;">useproximity.org</a></p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 12px;">
            You're receiving this because your property is listed on Proximity. Questions? Contact us at
            <a href="mailto:info@useproximity.org" style="color: #9ca3af;">info@useproximity.org</a>
          </p>
        </div>
      `,
    };

    const studentConfirmationOptions = {
      from: `"Proximity" <${process.env.EMAIL_USER || "info@useproximity.org"}>`,
      to: email,
      subject: `We got your message about ${listingAddress || "the listing"}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111827;">
          <p>Hi ${firstName.trim()},</p>

          <p>Thanks for reaching out! Your message about <strong>${listingAddress || "the listing"}</strong> has been received, and the landlord will be in touch with you shortly.</p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />

          <p style="margin-bottom: 8px; color: #6b7280;"><strong>Your message:</strong></p>
          <p style="white-space: pre-wrap; color: #374151; font-style: italic;">"${message.trim()}"</p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />

          <p>Best,<br/>The Proximity Team<br/><a href="https://useproximity.org" style="color: #dc2626;">useproximity.org</a></p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 12px;">
            You're receiving this because you submitted an inquiry on Proximity. Questions? Contact us at
            <a href="mailto:info@useproximity.org" style="color: #9ca3af;">info@useproximity.org</a>
          </p>
        </div>
      `,
    };

    // Server-side 21+ age guard
    if (listingId) {
      const session = await auth();
      if (session?.user?.email) {
        const { data: listingRow } = await supabase
          .from("listings")
          .select("twenty_one_plus")
          .eq("id", listingId)
          .single();

        if (listingRow?.twenty_one_plus) {
          const { data: userRow } = await supabase
            .from("users")
            .select("birthday")
            .eq("email", session.user.email)
            .single();

          const age = calcAge(userRow?.birthday ?? null);
          if (age === null || age < 21) {
            return NextResponse.json({ error: "Age restriction: must be 21+" }, { status: 403 });
          }
        }
      }
    }

    // If email credentials are not configured, log and return success (dev mode)
    if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn("[contactLandlord] Email env vars not set — skipping send in dev mode.");
      console.log("[contactLandlord] Would have sent:", { to: toEmail, from: senderName, subject: landlordMailOptions.subject });
      return NextResponse.json({ ok: true, dev: true });
    }

    const landlordInfo = await sendMailSafe(transporter, landlordMailOptions);
    console.log(`[contactLandlord] Landlord email sent to ${toEmail} — messageId: ${landlordInfo.messageId}`);

    const studentInfo = await sendMailSafe(transporter, studentConfirmationOptions);
    console.log(`[contactLandlord] Student confirmation sent to ${email} — messageId: ${studentInfo.messageId}`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/contactLandlord failed:", error);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
