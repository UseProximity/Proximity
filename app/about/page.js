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
    bio: "Ben is a student at Washington University in St. Louis with a passion for making the off-campus housing search less painful. He built Proximity after experiencing firsthand how fragmented and frustrating the process was for students.",
    image: "/founders/flicker.jpeg",
    linkedin: "https://www.linkedin.com/in/benjaminflicker/", // update with real URL
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
        <div className="flex flex-wrap justify-center gap-12">
          {founders.map((founder) => (
            <div
              key={founder.name}
              className="flex flex-col items-center text-center max-w-xs"
            >
              <div className="relative w-80 h-80 rounded-full overflow-hidden shadow-lg mb-6 ring-4 ring-red-100">
                <Image
                  src={founder.image}
                  alt={founder.name}
                  fill
                  className="object-cover"
                />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">{founder.name}</h2>
              <p className="text-red-500 font-medium text-sm mt-1 mb-4">
                {founder.role}
              </p>
              <p className="text-gray-500 text-base leading-relaxed">{founder.bio}</p>
              {founder.linkedin && (
                <Link
                  href={founder.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-5 inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-xl transition-all shadow-sm"
                >
                  LinkedIn ↗
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Mission callout ── */}
      <section className="bg-red-500 text-white text-center px-6 py-16">
        <h2 className="text-3xl font-bold mb-3">Our Mission</h2>
        <p className="text-red-100 max-w-2xl mx-auto text-lg">
          Proximity exists to give every college student a stress-free path to
          finding their next home — whether that's off-campus housing or a
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