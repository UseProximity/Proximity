"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { signIn, useSession } from "next-auth/react";

const INPUT_BASE =
  "w-full rounded-xl border bg-white px-4 py-3 text-[15px] text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-100";

const SELECT_BASE =
  "w-full appearance-none rounded-xl border bg-white px-4 py-3 pr-10 text-[15px] text-gray-900 outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-100";

const TEXT_SUBTLE = "text-sm text-gray-500";
const ERROR_TEXT = "mt-2 text-sm font-medium text-red-600";

function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}

function isValidEmail(email) {
  // Keep this intentionally simple; mirrors browser-level email validation closely enough.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function CheckIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function RadioPill({ id, name, value, checked, onChange, children }) {
  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type="radio"
        value={value}
        checked={checked}
        onChange={onChange}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        className={cn(
          "inline-flex cursor-pointer select-none items-center rounded-full border px-4 py-2 text-sm font-medium transition",
          "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50",
          "peer-checked:border-red-500 peer-checked:bg-red-500 peer-checked:text-white",
          "peer-focus-visible:ring-4 peer-focus-visible:ring-red-100"
        )}
      >
        {children}
      </label>
    </div>
  );
}

function CheckboxPill({
  id,
  name,
  value,
  checked,
  onChange,
  disabled,
  children,
}) {
  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type="checkbox"
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        className={cn(
          "inline-flex cursor-pointer select-none items-center rounded-full border px-4 py-2 text-sm font-medium transition",
          "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50",
          "peer-checked:border-red-500 peer-checked:bg-red-500 peer-checked:text-white",
          "peer-focus-visible:ring-4 peer-focus-visible:ring-red-100",
          disabled && !checked && "cursor-not-allowed opacity-50 hover:bg-white"
        )}
      >
        {children}
      </label>
    </div>
  );
}

function Divider() {
  return <div className="my-10 h-px w-full bg-gray-200" />;
}

function ResponseSummary({ response: r, onEdit }) {
  if (!r) return null;

  const Row = ({ label, value }) =>
    value ? (
      <div className="flex items-start justify-between gap-4 py-3 border-b border-gray-100 last:border-0">
        <span className="text-sm text-gray-500 w-40 flex-shrink-0">{label}</span>
        <span className="text-sm font-medium text-gray-900 text-right">{value}</span>
      </div>
    ) : null;

  const priorities = Array.isArray(r.priorities) && r.priorities.length > 0
    ? r.priorities.join(", ")
    : null;

  const commuteLabel = r.commute
    ? r.commute + (r.medical_campus ? " · Medical campus" : "")
    : null;

  return (
    <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
      <div className="lg:col-span-7">
        <div className="mx-auto w-full rounded-3xl bg-white shadow-xl ring-1 ring-black/5 px-6 py-8 sm:px-10 sm:py-10">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-gray-900">Your preferences</h2>
            <button
              onClick={onEdit}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition"
            >
              Edit preferences
            </button>
          </div>

          <Row label="Name" value={r.name} />
          <Row label="Email" value={r.email} />
          <Row label="Year of school" value={r.year_of_school} />
          <Row label="Group size" value={r.group_size} />
          <Row label="Budget / person" value={r.budget} />
          <Row label="Lease term" value={r.lease_term} />
          <Row label="Furnished" value={r.furnished} />
          <Row label="Commute" value={commuteLabel} />
          <Row label="Top priorities" value={priorities} />
          <Row label="Student type" value={r.student_type} />
          <Row label="Area" value={r.area} />
          <Row label="Notes" value={r.notes} />
        </div>
      </div>

      <aside className="lg:col-span-5">
        <div className="lg:sticky lg:top-24">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <p className="text-sm font-semibold text-gray-900">
              Need to update your preferences?
            </p>
            <p className={cn(TEXT_SUBTLE, "mt-1")}>
              Hit &ldquo;Edit preferences&rdquo; to make changes. We&apos;ll use
              your latest answers to refine your recommendations.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

export default function ConciergeFormClient() {
  const FORM_ACTION =
    process.env.NEXT_PUBLIC_FORMSPREE_CONCIERGE_URL ||
    "https://formspree.io/f/xkoqolpy";
  const EXIT_POLL_ACTION =
    process.env.NEXT_PUBLIC_FORMSPREE_EXIT_POLL_URL ||
    "https://formspree.io/f/mnjozlzn";

  const initialForm = useMemo(
    () => ({
      _source: "concierge_form",
      name: "",
      email: "",
      year_of_school: "",
      group_size: "",
      budget: "",
      lease_term: "",
      lease_term_other: "",
      furnished: "",
      commute: "",
      medical_campus: false,
      priorities: [],
      priorities_other: "",
      student_type: "",
      area: "",
      area_other: "",
      notes: "",
      referral_source: "",
      exit_feedback: "",
    }),
    []
  );

  const { data: session, status: sessionStatus } = useSession();

  const [mode, setMode] = useState("loading"); // "loading" | "new" | "view" | "edit"
  const [existingResponse, setExistingResponse] = useState(null);

  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [isNewUser, setIsNewUser] = useState(false);

  const [showExitPoll, setShowExitPoll] = useState(false);
  const [exitPollThanks, setExitPollThanks] = useState(false);

  const groupRefs = useRef({});

  const prioritiesCount = form.priorities.length;
  const showStudentTypePrompt = form.priorities.includes(
    "Close to other WashU students"
  );

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!session?.user) {
      setMode("new");
      return;
    }
    fetch("/api/matchmaking")
      .then((r) => r.json())
      .then((data) => {
        if (data.hasResponse && data.response) {
          setExistingResponse(data.response);
          setMode("view");
        } else {
          setMode("new");
        }
      })
      .catch(() => setMode("new"));
  }, [sessionStatus, session]);

  useEffect(() => {
    if (!submitted) return;
    const t = setTimeout(() => setShowExitPoll(true), 1500);
    return () => clearTimeout(t);
  }, [submitted]);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function setGroupError(key) {
    setErrors((prev) => ({ ...prev, [key]: true }));
  }

  function validate() {
    const nextErrors = {};
    const order = [
      "name",
      "email",
      "group_size",
      "budget",
      "lease_term",
      "furnished",
      "commute",
      "area",
    ];

    if (!form.name.trim()) nextErrors.name = true;
    if (!form.email.trim() || !isValidEmail(form.email))
      nextErrors.email = true;

    if (!form.group_size) nextErrors.group_size = true;
    if (!form.budget) nextErrors.budget = true;
    if (!form.lease_term) nextErrors.lease_term = true;
    if (!form.furnished) nextErrors.furnished = true;
    if (!form.commute) nextErrors.commute = true;
    if (!form.area) nextErrors.area = true;

    setErrors(nextErrors);

    const first = order.find((k) => nextErrors[k]);
    if (first && groupRefs.current[first]) {
      groupRefs.current[first].scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }

    return Object.keys(nextErrors).length === 0;
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitError(false);
    if (!validate()) return;

    const payload = {
      name: form.name,
      email: form.email,
      year_of_school: form.year_of_school,
      group_size: form.group_size,
      budget: form.budget,
      lease_term: form.lease_term === "Other" ? form.lease_term_other : form.lease_term,
      furnished: form.furnished,
      commute: form.commute,
      medical_campus: form.medical_campus,
      priorities: form.priorities,
      student_type: form.student_type,
      area: form.area === "Other" ? form.area_other : form.area,
      notes: form.notes,
      referral_source: form.referral_source,
    };

    setSubmitting(true);
    try {
      const response = await fetch("/api/matchmaking", {
        method: mode === "edit" ? "PATCH" : "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Submit failed: ${response.status}`);

      if (mode === "edit") {
        // Refresh the stored response and return to view
        const refreshed = await fetch("/api/matchmaking");
        const refreshData = await refreshed.json();
        if (refreshData.response) setExistingResponse(refreshData.response);
        setMode("view");
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setIsNewUser(data.isNewUser);
        setSubmitted(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (err) {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setForm(initialForm);
    setErrors({});
    setSubmitted(false);
    setSubmitting(false);
    setShowExitPoll(false);
    setExitPollThanks(false);
    setSubmitError(false);
    setIsNewUser(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startEditing() {
    const r = existingResponse;
    if (!r) return;
    const knownLeaseTerms = ["Semester only", "Full year only", "Open to either"];
    const knownAreas = ["The Loop", "Central West End", "Clayton", "No preference"];
    setForm({
      ...initialForm,
      name: r.name || "",
      email: r.email || "",
      year_of_school: r.year_of_school || "",
      group_size: r.group_size || "",
      budget: r.budget || "",
      lease_term: knownLeaseTerms.includes(r.lease_term) ? r.lease_term : (r.lease_term ? "Other" : ""),
      lease_term_other: knownLeaseTerms.includes(r.lease_term) ? "" : (r.lease_term || ""),
      furnished: r.furnished || "",
      commute: r.commute || "",
      medical_campus: r.medical_campus || false,
      priorities: Array.isArray(r.priorities) ? r.priorities : [],
      student_type: r.student_type || "",
      area: knownAreas.includes(r.area) ? r.area : (r.area ? "Other" : ""),
      area_other: knownAreas.includes(r.area) ? "" : (r.area || ""),
      notes: r.notes || "",
      referral_source: r.referral_source || "",
    });
    setErrors({});
    setMode("edit");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitExitPoll(feedback) {
    const formData = new FormData();
    formData.append("_source", "exit_poll");
    formData.append("exit_feedback", feedback);
    if (form.name.trim()) formData.append("name", form.name.trim());
    if (form.year_of_school)
      formData.append("year_of_school", form.year_of_school);

    try {
      await fetch(EXIT_POLL_ACTION, {
        method: "POST",
        body: formData,
        headers: { Accept: "application/json" },
      });
    } catch (err) {
      // Best-effort only.
    }
  }

  function togglePriority(value, checked) {
    setErrors((prev) => {
      // priorities aren't required; just clear any incidental error state
      if (!prev.priorities) return prev;
      const next = { ...prev };
      delete next.priorities;
      return next;
    });

    setForm((prev) => {
      const current = prev.priorities;
      if (checked) {
        if (current.includes(value)) return prev;
        if (current.length >= 2) return prev; // enforce "pick up to 2"
        const next = [...current, value];
        const nextForm = { ...prev, priorities: next };
        // Student type prompt resets when "Close..." is not selected
        if (!next.includes("Close to other WashU students"))
          nextForm.student_type = "";
        return nextForm;
      }
      const next = current.filter((v) => v !== value);
      const nextForm = { ...prev, priorities: next };
      if (!next.includes("Close to other WashU students"))
        nextForm.student_type = "";
      if (value === "Other") nextForm.priorities_other = "";
      return nextForm;
    });
  }

  // If lease_term switches away from "Other", clear the text box.
  useEffect(() => {
    if (form.lease_term !== "Other" && form.lease_term_other) {
      setForm((prev) => ({ ...prev, lease_term_other: "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.lease_term]);

  useEffect(() => {
    if (form.area !== "Other" && form.area_other) {
      setForm((prev) => ({ ...prev, area_other: "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.area]);

  return (
    <main className="min-h-screen bg-white">
      {/* ── Hero ── */}
      <section className="relative overflow-hidden bg-gradient-to-b from-red-50 to-white px-6 py-20 text-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        >
          <div className="absolute -top-44 left-1/2 h-96 w-[52rem] -translate-x-1/2 rounded-full bg-red-200/25 blur-3xl" />
          <div className="absolute -top-10 -right-28 h-80 w-80 rounded-full bg-red-100/40 blur-3xl" />
          <div className="absolute -bottom-40 -left-32 h-96 w-96 rounded-full bg-red-100/30 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-5xl">
          <p className="text-red-500 font-semibold text-sm uppercase tracking-widest mb-3">
            Matchmaking
          </p>

          {mode === "loading" && (
          <div className="mt-10 flex justify-center">
            <div className="h-8 w-72 rounded-lg bg-gray-100 animate-pulse" />
          </div>
        )}

        {mode === "view" && (
          <>
            <h1 className="text-5xl font-bold text-gray-900 mb-4">
              Your housing preferences
            </h1>
            <p className="text-gray-500 text-lg max-w-xl mx-auto">
              We&apos;ve got your details on file. Edit them anytime.
            </p>
          </>
        )}

        {(mode === "new" || mode === "edit") && !submitted ? (
            <>
              <h1
                id="formHeading"
                className="text-5xl font-bold text-gray-900 mb-4"
              >
                {mode === "edit"
                  ? "Update your preferences"
                  : "Tell us what you\u2019re looking for"}
              </h1>
              <p
                id="formSubtitle"
                className="text-gray-500 text-lg max-w-xl mx-auto"
              >
                {mode === "edit"
                  ? "Make changes below and save your updated preferences."
                  : "Fill this out for free personalized housing recommendations."}
              </p>
            </>
          ) : (mode === "new" || mode === "edit") && (
            <div className="mt-10 max-w-2xl w-full rounded-3xl bg-white shadow-xl ring-1 ring-black/5 px-7 py-10 sm:px-10 sm:py-12">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white">
                <CheckIcon />
              </div>
              <h2 className="mt-6 text-2xl sm:text-3xl font-bold text-gray-900 text-center">
                You&apos;re all set!
              </h2>
              <p className="mt-3 text-gray-500 text-base leading-relaxed text-center">
                We&apos;ve got your preferences and we&apos;ll send you
                personalized housing recommendations within 48 hours. Keep an
                eye on your inbox.
              </p>

              {isNewUser && (
                <div className="mt-8 rounded-2xl bg-red-50 border border-red-100 px-6 py-5">
                  <p className="text-sm font-semibold text-gray-900 text-center">
                    Finalize your matchmaking
                  </p>
                  <p className="mt-1 text-sm text-gray-500 text-center">
                    Create a free account so we can reach you and track your preferences.
                  </p>
                  <button
                    type="button"
                    onClick={() => signIn("google", { callbackUrl: "/" })}
                    className="mt-4 w-full rounded-xl bg-red-500 px-4 py-3 text-sm font-semibold text-white hover:bg-red-600 transition"
                  >
                    Create account with Google
                  </button>
                </div>
              )}

              {showExitPoll && (
                <div id="exitPoll" className="mt-10">
                  <p className="text-sm text-gray-500 text-center">
                    One last thing — what almost stopped you from filling this
                    out? <span className="text-gray-400">(Optional)</span>
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {[
                      {
                        id: "ef1",
                        value: "Too many questions",
                        label: "Too many questions",
                      },
                      {
                        id: "ef2",
                        value: "Wasn’t sure it’s legit",
                        label: "Wasn’t sure it’s legit",
                      },
                      {
                        id: "ef3",
                        value: "Didn’t want to share email",
                        label: "Didn’t want to share email",
                      },
                      {
                        id: "ef4",
                        value: "Nothing, it was easy",
                        label: "Nothing, it was easy",
                      },
                    ].map((opt) => (
                      <RadioPill
                        key={opt.id}
                        id={opt.id}
                        name="exit_feedback"
                        value={opt.value}
                        checked={form.exit_feedback === opt.value}
                        onChange={() => {
                          setField("exit_feedback", opt.value);
                          setExitPollThanks(true);
                          void submitExitPoll(opt.value);
                          setTimeout(() => reset(), 200);
                        }}
                      >
                        {opt.label}
                      </RadioPill>
                    ))}
                  </div>
                  {exitPollThanks && (
                    <p
                      id="exitPollThanks"
                      className="mt-4 text-sm text-gray-500 text-center"
                    >
                      Thanks! This helps us improve.
                    </p>
                  )}
                </div>
              )}

              <div className="mt-10 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={reset}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
                >
                  Submit Another Response
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {mode === "view" && (
        <section className="mx-auto max-w-6xl px-6 pt-10 pb-24">
          <ResponseSummary response={existingResponse} onEdit={startEditing} />
        </section>
      )}

      {(mode === "new" || mode === "edit") && !submitted && (
        <section className="mx-auto max-w-6xl px-6 pt-10 pb-24">
          <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
            {/* Form card */}
            <div className="lg:col-span-7">
              <div className="mx-auto w-full rounded-3xl bg-white shadow-xl ring-1 ring-black/5 px-6 py-8 sm:px-10 sm:py-10">
                <form
                  id="proximityForm"
                  action={FORM_ACTION}
                  method="POST"
                  onSubmit={onSubmit}
                  noValidate
                >
                  {/* Hidden field for source tracking */}
                  <input type="hidden" name="_source" value={form._source} />

                  {/* 1. Name */}
                  <div
                    className="mb-7"
                    ref={(el) => {
                      groupRefs.current.name = el;
                    }}
                  >
                    <label
                      htmlFor="name"
                      className="block text-sm font-semibold text-gray-900"
                    >
                      Name
                    </label>
                    <input
                      type="text"
                      id="name"
                      name="name"
                      value={form.name}
                      onChange={(e) => setField("name", e.target.value)}
                      placeholder="First and last name"
                      className={cn(
                        INPUT_BASE,
                        errors.name && "border-red-400 focus:border-red-500"
                      )}
                    />
                    <span
                      id="err-name"
                      className={cn(ERROR_TEXT, !errors.name && "hidden")}
                    >
                      Please enter your name.
                    </span>
                  </div>

                  {/* 2. Email */}
                  <div
                    className="mb-7"
                    ref={(el) => {
                      groupRefs.current.email = el;
                    }}
                  >
                    <label
                      htmlFor="email"
                      className="block text-sm font-semibold text-gray-900"
                    >
                      Email{" "}
                      <span className="ml-1 text-[13px] font-normal text-gray-400">
                        WashU email preferred
                      </span>
                    </label>
                    <input
                      type="email"
                      id="email"
                      name="email"
                      value={form.email}
                      onChange={(e) => setField("email", e.target.value)}
                      placeholder="you@wustl.edu"
                      className={cn(
                        INPUT_BASE,
                        errors.email && "border-red-400 focus:border-red-500"
                      )}
                    />
                    <span
                      id="err-email"
                      className={cn(ERROR_TEXT, !errors.email && "hidden")}
                    >
                      Please enter a valid email.
                    </span>
                  </div>

                  <div className="mb-7">
                    <label
                      htmlFor="year"
                      className="block text-sm font-semibold text-gray-900"
                    >
                      Year of school{" "}
                      <span className="ml-1 text-[13px] font-normal text-gray-400">
                        Optional
                      </span>
                    </label>
                    <div className="relative">
                      <select
                        id="year"
                        name="year_of_school"
                        value={form.year_of_school}
                        onChange={(e) =>
                          setField("year_of_school", e.target.value)
                        }
                        className={SELECT_BASE}
                      >
                        <option value="">Select your year</option>
                        <option value="Freshman">Freshman</option>
                        <option value="Sophomore">Sophomore</option>
                        <option value="Junior">Junior</option>
                        <option value="Senior">Senior</option>
                        <option value="Masters">Masters</option>
                        <option value="PhD">PhD</option>
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400">
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          aria-hidden="true"
                        >
                          <path
                            d="M7 10l5 5 5-5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                    </div>
                  </div>

                  <Divider />

                  {/* 3. Group size */}
                  <div
                    className={cn(
                      "mb-8",
                      errors.group_size && "rounded-2xl ring-2 ring-red-100"
                    )}
                    ref={(el) => {
                      groupRefs.current.group_size = el;
                    }}
                  >
                    <p className="block text-sm font-semibold text-gray-900">
                      How many people total, including yourself?
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[
                        { id: "gs1", value: "1", label: "Just me" },
                        { id: "gs2", value: "2", label: "2" },
                        { id: "gs3", value: "3", label: "3" },
                        { id: "gs4", value: "4", label: "4" },
                        { id: "gs5", value: "5+", label: "5+" },
                      ].map((opt) => (
                        <RadioPill
                          key={opt.id}
                          id={opt.id}
                          name="group_size"
                          value={opt.value}
                          checked={form.group_size === opt.value}
                          onChange={(e) =>
                            setField("group_size", e.target.value)
                          }
                        >
                          {opt.label}
                        </RadioPill>
                      ))}
                    </div>
                    <span
                      id="err-group_size"
                      className={cn(ERROR_TEXT, !errors.group_size && "hidden")}
                    >
                      Please select how many people.
                    </span>
                  </div>

                  {/* 4. Budget */}
                  <div
                    className={cn(
                      "mb-8",
                      errors.budget && "rounded-2xl ring-2 ring-red-100"
                    )}
                    ref={(el) => {
                      groupRefs.current.budget = el;
                    }}
                  >
                    <p className="block text-sm font-semibold text-gray-900">
                      Monthly budget per person?
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[
                        { id: "b1", value: "Under $800", label: "Under $800" },
                        {
                          id: "b2",
                          value: "$800-$1,000",
                          label: "$800–$1,000",
                        },
                        {
                          id: "b3",
                          value: "$1,000-$1,300",
                          label: "$1,000–$1,300",
                        },
                        {
                          id: "b4",
                          value: "$1,300-$1,600",
                          label: "$1,300–$1,600",
                        },
                        { id: "b5", value: "$1,600+", label: "$1,600+" },
                        { id: "b6", value: "Not sure", label: "Not sure" },
                      ].map((opt) => (
                        <RadioPill
                          key={opt.id}
                          id={opt.id}
                          name="budget"
                          value={opt.value}
                          checked={form.budget === opt.value}
                          onChange={(e) => setField("budget", e.target.value)}
                        >
                          {opt.label}
                        </RadioPill>
                      ))}
                    </div>
                    <span
                      id="err-budget"
                      className={cn(ERROR_TEXT, !errors.budget && "hidden")}
                    >
                      Please select a budget range.
                    </span>
                  </div>

                  {/* 5. Lease term */}
                  <div
                    className={cn(
                      "mb-8",
                      errors.lease_term && "rounded-2xl ring-2 ring-red-100"
                    )}
                    ref={(el) => {
                      groupRefs.current.lease_term = el;
                    }}
                  >
                    <p className="block text-sm font-semibold text-gray-900">
                      Lease term preference?
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[
                        {
                          id: "lt1",
                          value: "Semester",
                          label: "Semester",
                        },
                        {
                          id: "lt2",
                          value: "12 month",
                          label: "12 month",
                        },
                        {
                          id: "lt3",
                          value: "10 month",
                          label: "10 month",
                        },
                        {
                          id: "lt4",
                          value: "Flexible",
                          label: "Flexible",
                        },
                        { id: "lt5", value: "Other", label: "Other" },
                      ].map((opt) => (
                        <RadioPill
                          key={opt.id}
                          id={opt.id}
                          name="lease_term"
                          value={opt.value}
                          checked={form.lease_term === opt.value}
                          onChange={(e) =>
                            setField("lease_term", e.target.value)
                          }
                        >
                          {opt.label}
                        </RadioPill>
                      ))}
                    </div>
                    <span
                      id="err-lease_term"
                      className={cn(ERROR_TEXT, !errors.lease_term && "hidden")}
                    >
                      Please select a lease term.
                    </span>
                    <div
                      id="leaseOther"
                      className={cn(
                        "mt-3",
                        form.lease_term !== "Other" && "hidden"
                      )}
                    >
                      <input
                        type="text"
                        name="lease_term_other"
                        value={form.lease_term_other}
                        onChange={(e) =>
                          setField("lease_term_other", e.target.value)
                        }
                        placeholder="e.g. Summer sublease, month-to-month..."
                        className={INPUT_BASE}
                      />
                    </div>
                  </div>

                  {/* 6. Furnished */}
                  <div
                    className={cn(
                      "mb-8",
                      errors.furnished && "rounded-2xl ring-2 ring-red-100"
                    )}
                    ref={(el) => {
                      groupRefs.current.furnished = el;
                    }}
                  >
                    <p className="block text-sm font-semibold text-gray-900">
                      Furnished or unfurnished?
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[
                        { id: "f1", value: "Furnished", label: "Furnished" },
                        {
                          id: "f2",
                          value: "Unfurnished",
                          label: "Unfurnished",
                        },
                        {
                          id: "f3",
                          value: "No preference",
                          label: "No preference",
                        },
                      ].map((opt) => (
                        <RadioPill
                          key={opt.id}
                          id={opt.id}
                          name="furnished"
                          value={opt.value}
                          checked={form.furnished === opt.value}
                          onChange={(e) =>
                            setField("furnished", e.target.value)
                          }
                        >
                          {opt.label}
                        </RadioPill>
                      ))}
                    </div>
                    <span
                      id="err-furnished"
                      className={cn(ERROR_TEXT, !errors.furnished && "hidden")}
                    >
                      Please select a preference.
                    </span>
                  </div>

                  <Divider />

                  {/* 7. Commute */}
                  <div
                    className={cn(
                      "mb-10",
                      errors.commute && "rounded-2xl ring-2 ring-red-100"
                    )}
                    ref={(el) => {
                      groupRefs.current.commute = el;
                    }}
                  >
                    <p className="block text-sm font-semibold text-gray-900">
                      How do you plan to commute to campus?
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[
                        { id: "c1", value: "Car", label: "Car" },
                        { id: "c2", value: "Walk/Bike", label: "Walk / Bike" },
                        {
                          id: "c3",
                          value: "Campus shuttle",
                          label: "Campus shuttle",
                        },
                        {
                          id: "c4",
                          value: "Public transit",
                          label: "Public transit",
                        },
                        {
                          id: "c5",
                          value: "Not sure yet",
                          label: "Not sure yet",
                        },
                      ].map((opt) => (
                        <RadioPill
                          key={opt.id}
                          id={opt.id}
                          name="commute"
                          value={opt.value}
                          checked={form.commute === opt.value}
                          onChange={(e) => setField("commute", e.target.value)}
                        >
                          {opt.label}
                        </RadioPill>
                      ))}
                    </div>
                    <span
                      id="err-commute"
                      className={cn(ERROR_TEXT, !errors.commute && "hidden")}
                    >
                      Please select your commute method.
                    </span>

                    <div className="mt-4 flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="medical"
                        name="medical_campus"
                        value="Yes"
                        checked={form.medical_campus}
                        onChange={(e) =>
                          setField("medical_campus", e.target.checked)
                        }
                        className="h-5 w-5 accent-red-500"
                      />
                      <label
                        htmlFor="medical"
                        className="text-sm font-medium text-gray-700"
                      >
                        I&apos;ll be commuting to the Medical Campus
                      </label>
                    </div>
                  </div>

                  {/* 8. What matters */}
                  <div className="mb-10">
                    <label className="block text-sm font-semibold text-gray-900">
                      What matters most to you?{" "}
                      <span className="ml-1 text-[13px] font-normal text-gray-400">
                        Pick up to 2
                      </span>
                    </label>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {[
                        {
                          id: "p1",
                          value: "Walking distance to campus",
                          label: "Walking distance to campus",
                        },
                        {
                          id: "p2",
                          value: "Near restaurants & nightlife",
                          label: "Near restaurants & nightlife",
                        },
                        {
                          id: "p3",
                          value: "Quiet area to focus",
                          label: "Quiet area to focus",
                        },
                        {
                          id: "p4",
                          value: "Strong amenities (gym, pool)",
                          label: "Strong amenities (gym, pool)",
                        },
                        {
                          id: "p5",
                          value: "Most space for best price",
                          label: "Most space for best price",
                        },
                        {
                          id: "p6",
                          value: "Close to other WashU students",
                          label: "Close to other WashU students",
                        },
                        {
                          id: "p7",
                          value: "Cheapest option available",
                          label: "Cheapest option available",
                        },
                        { id: "p8", value: "Other", label: "Other" },
                      ].map((opt) => {
                        const checked = form.priorities.includes(opt.value);
                        const disabled = !checked && prioritiesCount >= 2;
                        return (
                          <CheckboxPill
                            key={opt.id}
                            id={opt.id}
                            name="priorities"
                            value={opt.value}
                            checked={checked}
                            disabled={disabled}
                            onChange={(e) =>
                              togglePriority(opt.value, e.target.checked)
                            }
                          >
                            {opt.label}
                          </CheckboxPill>
                        );
                      })}
                    </div>

                    <div
                      id="prioritiesOther"
                      className={cn(
                        "mt-3",
                        !form.priorities.includes("Other") && "hidden"
                      )}
                    >
                      <input
                        type="text"
                        name="priorities_other"
                        value={form.priorities_other}
                        onChange={(e) =>
                          setField("priorities_other", e.target.value)
                        }
                        placeholder="What else matters to you?"
                        className={INPUT_BASE}
                      />
                    </div>

                    <div
                      id="studentTypePrompt"
                      className={cn("mt-5", !showStudentTypePrompt && "hidden")}
                    >
                      <label className="block text-sm font-semibold text-gray-900">
                        Are you an undergraduate or graduate student?
                      </label>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {[
                          {
                            id: "st1",
                            value: "Undergraduate",
                            label: "Undergraduate",
                          },
                          { id: "st2", value: "Graduate", label: "Graduate" },
                        ].map((opt) => (
                          <RadioPill
                            key={opt.id}
                            id={opt.id}
                            name="student_type"
                            value={opt.value}
                            checked={form.student_type === opt.value}
                            onChange={(e) =>
                              setField("student_type", e.target.value)
                            }
                          >
                            {opt.label}
                          </RadioPill>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 9. Area */}
                  <div
                    className={cn(
                      "mb-10",
                      errors.area && "rounded-2xl ring-2 ring-red-100"
                    )}
                    ref={(el) => {
                      groupRefs.current.area = el;
                    }}
                  >
                    <p className="block text-sm font-semibold text-gray-900">
                      Preferred area?
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[
                        { id: "a1", value: "The Loop", label: "The Loop" },
                        {
                          id: "a2",
                          value: "Central West End",
                          label: "Central West End",
                        },
                        { id: "a3", value: "Clayton", label: "Clayton" },
                        {
                          id: "a4",
                          value: "No preference",
                          label: "No preference",
                        },
                        { id: "a5", value: "Other", label: "Other" },
                      ].map((opt) => (
                        <RadioPill
                          key={opt.id}
                          id={opt.id}
                          name="area"
                          value={opt.value}
                          checked={form.area === opt.value}
                          onChange={(e) => setField("area", e.target.value)}
                        >
                          {opt.label}
                        </RadioPill>
                      ))}
                    </div>
                    <span
                      id="err-area"
                      className={cn(ERROR_TEXT, !errors.area && "hidden")}
                    >
                      Please select a preferred area.
                    </span>
                    <div
                      id="areaOther"
                      className={cn("mt-3", form.area !== "Other" && "hidden")}
                    >
                      <input
                        type="text"
                        name="area_other"
                        value={form.area_other}
                        onChange={(e) => setField("area_other", e.target.value)}
                        placeholder="e.g. Dogtown, Maplewood, U City..."
                        className={INPUT_BASE}
                      />
                    </div>
                  </div>

                  <Divider />

                  {/* 10. Anything else */}
                  <div className="mb-7">
                    <label
                      htmlFor="notes"
                      className="block text-sm font-semibold text-gray-900"
                    >
                      Anything else we should know?{" "}
                      <span className="ml-1 text-[13px] font-normal text-gray-400">
                        Optional
                      </span>
                    </label>
                    <textarea
                      id="notes"
                      name="notes"
                      value={form.notes}
                      onChange={(e) => setField("notes", e.target.value)}
                      placeholder="Parking needs, pet situation, move-in timing, roommate preferences..."
                      className={cn(INPUT_BASE, "min-h-[96px] resize-y")}
                    />
                  </div>

                  <div className="mb-10">
                    <label
                      htmlFor="referral"
                      className="block text-sm font-semibold text-gray-900"
                    >
                      How did you hear about us?{" "}
                      <span className="ml-1 text-[13px] font-normal text-gray-400">
                        Optional
                      </span>
                    </label>
                    <div className="relative">
                      <select
                        id="referral"
                        name="referral_source"
                        value={form.referral_source}
                        onChange={(e) =>
                          setField("referral_source", e.target.value)
                        }
                        className={SELECT_BASE}
                      >
                        <option value="">Select one</option>
                        <option value="Instagram">Instagram</option>
                        <option value="TikTok">TikTok</option>
                        <option value="Friend / word of mouth">
                          Friend / word of mouth
                        </option>
                        <option value="GroupMe">GroupMe</option>
                        <option value="WashU Facebook group">
                          WashU Facebook group
                        </option>
                        <option value="Flyer on campus">Flyer on campus</option>
                        <option value="Other">Other</option>
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400">
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          aria-hidden="true"
                        >
                          <path
                            d="M7 10l5 5 5-5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className={cn(
                      "w-full rounded-2xl bg-red-500 px-5 py-4 text-base font-semibold text-white transition",
                      "hover:bg-red-600 shadow-sm",
                      submitting && "opacity-70 cursor-not-allowed"
                    )}
                    disabled={submitting}
                  >
                    {submitting
                      ? mode === "edit" ? "Saving..." : "Sending..."
                      : submitError
                        ? "Something went wrong — try again"
                        : mode === "edit"
                          ? "Save preferences"
                          : "Get My Recommendations"}
                  </button>
                  {mode === "edit" ? (
                    <button
                      type="button"
                      onClick={() => setMode("view")}
                      className="mt-3 w-full rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition"
                    >
                      Cancel
                    </button>
                  ) : (
                    <p className="mt-4 text-center text-sm text-gray-400 leading-relaxed">
                      We&apos;ll get back to you within 48 hours with personalized
                      picks.
                    </p>
                  )}
                </form>
              </div>
            </div>

            {/* Side panel */}
            <aside className="lg:col-span-5">
              <div className="lg:sticky lg:top-24">
                <div className="grid gap-3">
                    <div className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4">
                      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-red-50 text-red-600">
                        <span className="text-sm font-semibold">1</span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          Tell us your needs
                        </p>
                        <p className={cn(TEXT_SUBTLE, "mt-1")}>
                          Budget, lease term, commute, and what you care about
                          most.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4">
                      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-red-50 text-red-600">
                        <span className="text-sm font-semibold">2</span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          We match you
                        </p>
                        <p className={cn(TEXT_SUBTLE, "mt-1")}>
                          We look for listings that fit what you picked (and
                          what students actually want).
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4">
                      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-red-50 text-red-600">
                        <span className="text-sm font-semibold">3</span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          You get recommendations
                        </p>
                        <p className={cn(TEXT_SUBTLE, "mt-1")}>
                          Personalized picks delivered to your email within 48
                          hours.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
                    <p className="text-sm font-semibold text-gray-900">
                      Good to know
                    </p>
                    <p className={cn(TEXT_SUBTLE, "mt-1")}>
                      If you&apos;re unsure on budget or lease term, pick “Not
                      sure”. We can still match you.
                    </p>
                    <p className={cn(TEXT_SUBTLE, "mt-2")}>
                      Your answers aren&apos;t posted publicly, they&apos;re
                      just used to generate recommendations.
                    </p>
                  </div>
              </div>
            </aside>
          </div>
        </section>
      )}
    </main>
  );
}
