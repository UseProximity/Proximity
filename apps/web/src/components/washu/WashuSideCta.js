import Link from "next/link";

// Default for listing pages (neighborhoods, bedroom counts, budgets): the grid
// above already shows inventory, so the rail pushes the personalised next step.
const MATCH_DEFAULT = {
  title: "Tell us what you want. We'll find it.",
  body: "Share your budget and move-in date. We'll send you places near campus that actually fit.",
  primary: { label: "Find my apartment", href: "/matchmaking" },
  secondary: { label: "See every listing on the map", href: "/browse" },
};

// Answer pages have no grid, so each rail points at the action the article
// sets up.
const BY_SLUG = {
  sublease: {
    eyebrow: "Subleases on Proximity",
    title: "Posted by students. Open to everyone.",
    body: "Browse every live sublease near campus, or list your place for the summer in minutes.",
    primary: { label: "Browse subleases", href: "#listings" },
    secondary: { label: "Post your sublease", href: "/add-sublease" },
  },
  "housing-cost": {
    title: "Personalized housing match.",
    body: "Tell us your budget and we'll match you with places near campus that fit it.",
    primary: { label: "Find my apartment", href: "/matchmaking" },
    secondary: {
      label: "Open the budget guide",
      href: "/guides/washu-off-campus-budget",
    },
  },
  "lease-timing": {
    eyebrow: "Don't wait for February",
    title: "The best places go before November.",
    body: "Tell us what you need now and we'll start looking before the signing wave hits.",
    primary: { label: "Find my apartment", href: "/matchmaking" },
    secondary: { label: "Browse what's open now", href: "/browse" },
  },
  "washu-owned-apartments": {
    eyebrow: "Compare the price",
    title: "Renting private usually costs far less.",
    body: "See what private apartments near campus actually cost, with reviews from students who lived there.",
    primary: { label: "Browse private listings", href: "/browse" },
    secondary: { label: "Find my apartment", href: "/matchmaking" },
  },
  "graduate-student-housing": {
    eyebrow: "Searching from out of town?",
    title: "We'll shortlist places for you.",
    body: "Tell us your campus and budget. We'll send you places that fit, free.",
    primary: { label: "Find my apartment", href: "/matchmaking" },
    secondary: {
      label: "Med campus apartments",
      href: "/washu/central-west-end-apartments",
    },
  },
  "student-safety": {
    eyebrow: "Real student reviews",
    title: "Read the reviews before you sign.",
    body: "Students who lived there tell you how the block and the landlord really are.",
    primary: { label: "Browse reviewed listings", href: "/browse" },
    secondary: {
      label: "Guide for parents",
      href: "/guides/washu-parent-guide",
    },
  },
};

function CtaLink({ href, className, children }) {
  // In-page anchors stay plain <a> so the browser scrolls instead of routing.
  return href.startsWith("#") ? (
    <a href={href} className={className}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/** Sticky call to action in the empty right column beside a /washu article. */
export default function WashuSideCta({ slug }) {
  const cta = BY_SLUG[slug] ?? MATCH_DEFAULT;
  return (
    <aside className="hidden lg:block">
      <div className="sticky top-32 rounded-3xl bg-gray-950 p-6 text-white shadow-xl">
        {cta.eyebrow ? (
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-red-500">
            {cta.eyebrow}
          </p>
        ) : null}
        <p className="text-2xl font-black leading-tight">{cta.title}</p>
        <p className="mt-3 text-sm leading-relaxed text-gray-300">{cta.body}</p>
        <CtaLink
          href={cta.primary.href}
          className="mt-6 flex w-full items-center justify-center rounded-xl bg-red-600 px-5 py-3 font-bold text-white hover:bg-red-700 transition-colors"
        >
          {cta.primary.label}
        </CtaLink>
        <CtaLink
          href={cta.secondary.href}
          className="mt-3 block text-center text-sm font-semibold text-gray-300 underline decoration-gray-600 underline-offset-4 hover:text-white hover:decoration-white"
        >
          {cta.secondary.label}
        </CtaLink>
      </div>
    </aside>
  );
}
