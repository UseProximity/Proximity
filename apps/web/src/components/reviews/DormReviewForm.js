"use client";

/*
 * The on-campus branch of the review flow: review a dorm you live in or lived in.
 *
 * Feature parity with the Campus Hub's inline dorm form (the rating, the tag
 * chips, and a written review), wrapped in the same progressively
 * disclosed steps as the off-campus branch, and with the same contact block at
 * the bottom so a signed-out reviewer still ends up with an account.
 *
 * The rating is the shared half-star StarRatingInput, identical to the property
 * flow: a dorm is rated on the same scale, by the same student, on the same
 * page, so a different star control here would only read as an inconsistency.
 * dorm_reviews.rating is numeric, so the .5 values persist as-is.
 */

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import { schoolForEmail } from "@/lib/schools";
import StarRatingInput from "@/components/ui/StarRatingInput";
import { INPUT_CLASS, Step } from "./reviewFormUi";
import { DORM_FORM_TAGS } from "./dormReviewOptions";
import ReviewerContactFields, {
  EMAIL_RE,
  EMPTY_CONTACT,
  contactReady,
} from "./ReviewerContactFields";

export default function DormReviewForm({ source = null, onSubmitted, initialContact = null }) {
  const { data: session, status } = useSession();
  const loggedIn = !!session?.user?.id;
  const requireContact = status !== "loading" && !loggedIn;
  const postingAs = loggedIn ? session?.user?.name || session?.user?.email : null;

  const [dorms, setDorms] = useState([]);
  const [dormsLoading, setDormsLoading] = useState(true);
  const [dorm, setDorm] = useState("");
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState([]);
  const [content, setContent] = useState("");
  const [contact, setContact] = useState(initialContact || EMPTY_CONTACT);
  const [anonymous, setAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/dorms");
        const data = res.ok ? await res.json() : [];
        if (!active) return;
        const names = [...new Set((data || []).map((d) => d?.name).filter(Boolean))].sort(
          (a, b) => a.localeCompare(b)
        );
        setDorms(names);
      } catch {
        if (active) setDorms([]);
      } finally {
        if (active) setDormsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const dormReady = !!dorm;
  const ratingReady = rating >= 0.5;
  const contentReady = content.trim().length >= 10;

  const contactSchool = schoolForEmail(contact.email);
  const contactSchoolMismatch =
    requireContact && EMAIL_RE.test(contact.email.trim()) && !contactSchool;
  const identityReady =
    contactReady(contact, { requireContact, requireClassYear: true }) &&
    !contactSchoolMismatch;

  function toggleTag(tag) {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  function handleFormKeyDown(e) {
    if (e.key === "Enter" && e.target.tagName === "INPUT") e.preventDefault();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    if (!dorm) return toast.error("Pick the dorm you lived in.");
    if (rating < 0.5) return toast.error("Please set a rating.");
    if (content.trim().length < 10)
      return toast.error("Please write at least 10 characters.");
    if (!contact.classYear) return toast.error("Select your class year.");
    if (requireContact && !contactReady(contact, { requireContact }))
      return toast.error("Add your name, class year and school email.");
    if (contactSchoolMismatch)
      return toast.error("Use your school email address so we can verify your review.");

    setSubmitting(true);
    try {
      const res = await fetch("/api/dormReviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dorm,
          rating,
          tags,
          content: content.trim(),
          classYear: contact.classYear,
          anonymous,
          source,
          reviewer: requireContact
            ? {
                firstName: contact.firstName.trim(),
                lastName: contact.lastName.trim(),
                classYear: contact.classYear,
                email: contact.email.trim(),
              }
            : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Something went wrong.");
        return;
      }
      if (onSubmitted) onSubmitted(data);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} onKeyDown={handleFormKeyDown} className="space-y-5">
      <Step show number={1} title="Which dorm did you live in?">
        <select
          id="dorm-review-dorm"
          value={dorm}
          onChange={(e) => setDorm(e.target.value)}
          disabled={dormsLoading}
          className={INPUT_CLASS}
        >
          <option value="">{dormsLoading ? "Loading dorms…" : "Select your dorm…"}</option>
          {dorms.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        {!dormsLoading && dorms.length === 0 && (
          <p className="mt-1.5 text-sm text-red-600">
            We couldn&apos;t load the dorm list. Please refresh and try again.
          </p>
        )}
      </Step>

      <Step show={dormReady} number={2} title="How was it overall?">
        <div className="flex justify-center py-1">
          <StarRatingInput value={rating} onChange={setRating} />
        </div>
      </Step>

      <Step show={ratingReady} number={3} title="What was it like? (optional)">
        <div className="flex flex-wrap gap-2">
          {DORM_FORM_TAGS.map((tag) => {
            const active = tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={active}
                onClick={() => toggleTag(tag)}
                className={`px-3 py-1.5 text-sm font-medium rounded-full border transition-colors duration-100 ${
                  active
                    ? "bg-red-500 text-white border-red-500"
                    : "bg-white text-gray-600 border-gray-200 hover:border-red-300"
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </Step>

      <Step show={ratingReady} number={4} title="Tell other students about it">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          placeholder="What was it like living here? Rooms, floor, location, dining… (min. 10 characters)"
          className={INPUT_CLASS}
        />
      </Step>

      <Step
        show={contentReady}
        number={5}
        title={requireContact ? "Almost done: who are you?" : "Post your review"}
      >
        <ReviewerContactFields
          contact={contact}
          onContactChange={setContact}
          anonymous={anonymous}
          onAnonymousChange={setAnonymous}
          requireContact={requireContact}
          requireClassYear
          schoolMismatch={contactSchoolMismatch}
          postingAs={postingAs}
        />

        <button
          type="submit"
          disabled={submitting || !identityReady}
          className="mt-4 w-full py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Submitting…" : "Submit review"}
        </button>
      </Step>
    </form>
  );
}
