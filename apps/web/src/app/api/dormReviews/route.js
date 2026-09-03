/*
 * Dorm (on-campus) reviews.
 *
 * @auth public
 *
 * Three shapes of submission arrive here, and all three must keep working:
 *
 *   1. The Campus Hub's inline form: a first name and a class year, no account.
 *      The oldest path; deliberately still anonymous.
 *   2. A signed-in student from /review's on-campus branch, attributed to their
 *      account via the session.
 *   3. A signed-out student from /review (the QR flow), supplying name, class and
 *      school email, which creates an incomplete account (see
 *      lib/reviews/onboarding.js) and returns a profile-setup token.
 *
 * Tags live in the dorm_review_tags join table, NOT in a column on dorm_reviews.
 * This route used to insert `tags` as if it were a column, which silently failed
 * every submission that carried one. Hence the join-table write below.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { schoolForEmail } from "@/lib/schools";
import { normalizeReviewSource } from "@/lib/reviews/source";
import { anonReviewRateKey, anonReviewRateLimited } from "@/lib/reviews/rateLimit";
import { ensureReviewerAccount, normalizeClassYear } from "@/lib/reviews/onboarding";

export const dynamic = "force-dynamic";

const MAX_TAGS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const dormName = searchParams.get("dorm");

  const SELECT = "*, dorms(name), dorm_review_tags(tags(name))";

  let query = supabase
    .from("dorm_reviews")
    .select(SELECT)
    .order("created_at", { ascending: false });

  if (dormName) {
    // Resolve dorm name → id first; dot-path filtering on joined tables is not supported in PostgREST
    const { data: dormRecord } = await supabase
      .from("dorms")
      .select("id")
      .eq("name", dormName)
      .maybeSingle();

    if (!dormRecord) {
      return NextResponse.json([]);
    }

    query = supabase
      .from("dorm_reviews")
      .select(SELECT)
      .eq("dorm_id", dormRecord.id)
      .order("created_at", { ascending: false });
  }

  const { data: reviews, error } = await query;

  if (error) {
    console.error("GET /api/dormReviews failed:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  return NextResponse.json(reviews || []);
}

/*
 * Attach tag names to a review through the join table, creating a tag row for a
 * name we've never seen. Matching is case-insensitive because `tags` already
 * holds both "Quiet Floor" and "quiet floor" from the Mongo migration, and a
 * third casing would only fragment the filters further.
 *
 * Best-effort: a tag that won't attach must not cost the student their review.
 */
async function attachDormTags(reviewId, tagNames) {
  const wanted = [
    ...new Set(
      (Array.isArray(tagNames) ? tagNames : [])
        .map((t) => String(t || "").trim())
        .filter(Boolean)
    ),
  ].slice(0, MAX_TAGS);
  if (!wanted.length) return;

  try {
    const { data: existing } = await supabase.from("tags").select("id, name");

    /*
     * `tags` carries case-duplicated rows from the Mongo migration: both
     * "Social Floor" and "social floor" exist. Tag names are rendered verbatim
     * on the Campus Hub, so when a name resolves to several rows, prefer the
     * capitalised one; picking whichever row the query happened to return first
     * would make new reviews sprout lowercase chips next to title-case ones.
     */
    const candidates = new Map(); // lowercased name -> rows
    for (const tag of existing || []) {
      const key = String(tag.name).toLowerCase();
      if (!candidates.has(key)) candidates.set(key, []);
      candidates.get(key).push(tag);
    }
    const byLower = new Map(
      [...candidates].map(([key, rows]) => {
        const titled = rows.find((r) => /^[A-Z]/.test(String(r.name)));
        return [key, (titled || rows[0]).id];
      })
    );

    const tagIds = new Set();
    for (const name of wanted) {
      let id = byLower.get(name.toLowerCase());
      if (!id) {
        const { data: created, error: createErr } = await supabase
          .from("tags")
          .insert({ name })
          .select("id")
          .maybeSingle();
        if (createErr) {
          console.error("[dormReviews] tag create failed:", createErr.message);
          continue;
        }
        id = created?.id;
        if (id) byLower.set(name.toLowerCase(), id);
      }
      if (id) tagIds.add(id);
    }

    if (!tagIds.size) return;
    const { error } = await supabase
      .from("dorm_review_tags")
      .insert([...tagIds].map((tag_id) => ({ review_id: reviewId, tag_id })));
    if (error) console.error("[dormReviews] tag attach failed:", error.message);
  } catch (e) {
    console.error("[dormReviews] tag attach threw:", e?.message);
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      name,
      classYear,
      rating,
      dorm,
      dormType,
      tags,
      content,
      anonymous,
      source,
      reviewer,
    } = body;

    const session = await auth();
    const sessionUserId = session?.user?.id || null;
    const signedOutReviewer = !sessionUserId && reviewer ? reviewer : null;

    // ── Shared validation ───────────────────────────────────────────────────
    // Half-star scale, same as listing reviews: 0.5 to 5 in 0.5 increments.
    const ratingNum = Number(rating);
    if (
      !Number.isFinite(ratingNum) ||
      ratingNum < 0.5 ||
      ratingNum > 5 ||
      !Number.isInteger(ratingNum * 2)
    ) {
      return NextResponse.json(
        { error: "Please set a rating (half a star to 5)." },
        { status: 400 }
      );
    }
    if (!dorm) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!content?.trim() || content.trim().length < 10) {
      return NextResponse.json({ error: "Review too short" }, { status: 400 });
    }

    const gradYear = normalizeClassYear(signedOutReviewer?.classYear ?? classYear);
    if (!gradYear) {
      return NextResponse.json({ error: "Select your class year." }, { status: 400 });
    }

    // Resolve dorm name → dorm_id
    const { data: dormRecord, error: dormError } = await supabase
      .from("dorms")
      .select("id, name")
      .eq("name", dorm)
      .maybeSingle();

    if (dormError || !dormRecord) {
      return NextResponse.json({ error: "Dorm not found" }, { status: 404 });
    }

    // ── Resolve who's reviewing ─────────────────────────────────────────────
    let reviewerUserId = sessionUserId;
    let displayName = session?.user?.name || null;
    let setupToken = null;
    let setupEmail = null;
    // Signed-out reviewer whose email already belongs to a real account.
    let existingAccount = false;
    if (signedOutReviewer) {
      const email = String(signedOutReviewer.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email) || !schoolForEmail(email)) {
        return NextResponse.json(
          { error: "Use your school email address so we can verify your review." },
          { status: 400 }
        );
      }
      if (anonReviewRateLimited(anonReviewRateKey(req, email))) {
        return NextResponse.json(
          { error: "That's a lot of reviews at once. Please try again later." },
          { status: 429 }
        );
      }

      const account = await ensureReviewerAccount({
        firstName: signedOutReviewer.firstName,
        lastName: signedOutReviewer.lastName,
        email,
        classYear: gradYear,
        source: normalizeReviewSource(source),
      });
      if (account.error) {
        return NextResponse.json({ error: account.error }, { status: 400 });
      }
      reviewerUserId = account.userId;
      displayName = account.displayName;
      setupToken = account.setupToken;
      setupEmail = email;
      existingAccount = !!account.existingAccount;
    } else if (!sessionUserId) {
      // Legacy Campus Hub path: a first name and nothing else.
      if (!name?.trim()) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }
      displayName = name.trim();
    }

    // reviewer_name is NOT NULL and is what the Campus Hub renders on the card.
    const reviewerName = anonymous ? "Anonymous" : displayName || "Anonymous";

    const reviewData = {
      dorm_id: dormRecord.id,
      user_id: reviewerUserId,
      reviewer_name: reviewerName,
      class_year: gradYear,
      rating: ratingNum,
      content: content.trim(),
      source: normalizeReviewSource(source),
    };
    // dorm_type is NOT NULL with a '' default; only set it when we were told.
    if (dormType) reviewData.dorm_type = dormType;

    /*
     * A direct insert rather than the write-as-user RPC: dorm_reviews is not on
     * that function's table allowlist, and widening a SECURITY DEFINER function
     * every landlord write depends on, to gain an action_log row for a dorm
     * review that has never had one, is not a trade this feature should make.
     * Attribution still lands where it matters: user_id on the row.
     */
    const { data: review, error: insertError } = await supabase
      .from("dorm_reviews")
      .insert(reviewData)
      .select()
      .maybeSingle();
    if (insertError) {
      console.error("POST /api/dormReviews insert failed:", insertError);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    if (review?.id) await attachDormTags(review.id, tags);

    return NextResponse.json(
      {
        ...review,
        setupToken,
        existingAccount,
        prefill: setupToken
          ? {
              firstName: String(signedOutReviewer.firstName || "").trim(),
              lastName: String(signedOutReviewer.lastName || "").trim(),
              email: setupEmail,
              role: "student",
              graduationYear: gradYear,
              graduationMonth: 5,
              gender: "",
              referralSource: "",
            }
          : null,
      },
      { status: 201 }
    );
  } catch (e) {
    console.error("POST /api/dormReviews failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
