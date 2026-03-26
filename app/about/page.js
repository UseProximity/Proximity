import Image from "next/image";
import Link from "next/link";
import Footer from "@/components/Footer";

export const metadata = {
  title: "About the Founder | Proximity",
  description: "Meet the man behind Proximity.",
};

const founders = [
  {
    name: "Ben Flicker",
    role: "Founder",
    bioLines: [
      "I'm Ben, a sophomore at WashU, and like most students here, I had to figure out off-campus housing the hard way.",
      "When I started my search, I was bouncing between Zillow, Facebook groups, Apartments.com, and random landlord websites just to see what was available near campus. Listings were outdated, landlords ghosted me, and there was no way to compare apartments side by side on the things that actually matter to students — like how far it is from campus, whether semester lease terms were available, or if other students lived nearby.",
      "The worst part? There were no reviews. No way to hear from students who'd actually lived in these places. I wanted to know whether the landlord was responsive, whether the apartment matched the listing, and what the experience was really like. You'd sign a lease and just hope for the best.",
      "I talked to friends, classmates, and random WashU students and heard the same story over and over. So I built Proximity, a single platform where WashU students can browse off-campus listings near campus, filter by what actually matters, read honest reviews from other students, and make a confident decision without the chaos.",
      "Proximity is the tool I wish existed when I started looking.",
    ],
    image: "/founders/flicker.jpeg",
    linkedin: "https://www.linkedin.com/in/benjaminflicker/",
  },
  // Add more founders here as needed
];

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-white">
      {/* ── Hero ── */}
      <section className="bg-gradient-to-br from-red-50 to-white px-6 py-20 text-center">
        <p className="text-red-500 font-semibold text-sm uppercase tracking-widest mb-3">
          The Team
        </p>
        <h1 className="text-5xl font-bold text-gray-900 mb-4">
          Meet the Founder
        </h1>
        <p className="text-gray-500 text-lg max-w-xl mx-auto">
          I was a student who got tired of the housing search. So I fixed it.
        </p>
      </section>

      {/* ── Founder Cards ── */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="flex flex-col gap-16">
          {founders.map((founder) => (
            <div
              key={founder.name}
              className="flex flex-col md:flex-row items-center md:items-center gap-6 md:gap-20"
            >
              {/* Left: image + identity */}
              <div className="flex flex-col items-center text-center flex-shrink-0 w-80">
                <div className="relative w-72 h-72 rounded-full overflow-hidden shadow-lg mb-6 ring-4 ring-red-100">
                  <Image
                    src={founder.image}
                    alt={founder.name}
                    fill
                    className="object-cover"
                  />
                </div>
                <h2 className="text-2xl font-bold text-gray-900">
                  {founder.name}
                </h2>
                <p className="text-red-500 font-medium text-sm mt-1 mb-5">
                  {founder.role}
                </p>
                {founder.linkedin && (
                  <Link
                    href={founder.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-xl transition-all shadow-sm"
                  >
                    LinkedIn ↗
                  </Link>
                )}
              </div>
              {/* Right: bio */}
              <div className="flex flex-col gap-4 text-gray-500 text-base leading-relaxed">
                {founder.bioLines.map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Mission callout ── */}
      <section className="bg-red-500 text-white text-center px-6 py-16">
        <h2 className="text-3xl font-bold mb-3">Our Mission</h2>
        <p className="text-red-100 max-w-2xl mx-auto text-lg">
          Proximity exists to give every college student a stress-free path to
          finding their next home — whether that&apos;s off-campus housing or a
          campus roommate.
        </p>
        <Link
          href="/browse"
          className="mt-8 inline-block px-7 py-3 bg-white text-red-500 font-semibold rounded-xl hover:bg-red-50 transition-all"
        >
          Browse Listings
        </Link>
      </section>

      <Footer />
    </main>
  );
}
