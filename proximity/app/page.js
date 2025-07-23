import { Header } from "@/components/Header";
import { HeroSection } from "@/components/HeroSection";
import { PopularListings } from "@/components/PopularListings";

export default function Home() {
  return (
    <div className="min-h-screen w-full bg-[radial-gradient(circle,rgba(0,0,0,0.03)_1px,transparent_1px),_radial-gradient(circle,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[size:40px_40px]">
      <Header />
      <main className="min-h-screen w-full">
        <HeroSection />
        <PopularListings />
        <section className="w-full flex flex-col items-center py-16">
          <div className="w-full flex justify-center mb-10">
            <div className="bg-gradient-to-r from-red-500 to-red-700 rounded-3xl px-8 py-6 shadow-xl flex flex-col items-center">
              <h2 className="text-4xl md:text-5xl font-extrabold text-white text-center tracking-tight drop-shadow-lg mb-2">
                Made for Students, by Students
              </h2>
              <p className="text-base md:text-xl text-white text-center font-medium opacity-90">
                We lived through Sidechat DMs and sketchy landlords.
                <br />
                Now there&apos;s a better way.
              </p>
            </div>
          </div>
          <div className="flex flex-row gap-8 w-full max-w-7xl justify-center flex-nowrap overflow-x-auto">
            {/* Card 1 */}
            <div
              className="flex flex-col items-center bg-white rounded-3xl p-10 w-[28rem] min-h-[256px]"
              style={{
                boxShadow:
                  "8px 0 24px -8px rgba(0,0,0,0.12), -8px 0 24px -8px rgba(0,0,0,0.12)",
              }}
            >
              <span className="text-5xl mb-4">🎯</span>
              <span className="font-bold text-2xl mb-2 text-center">
                Only for WashU Students
              </span>
              <span className="text-lg text-gray-700 text-center">
                No random spam listings, no scammers. Every listing and review
                is from someone in your community.
              </span>
            </div>
            {/* Card 4 (Subletter) */}
            <div
              className="flex flex-col items-center bg-white rounded-3xl p-10 w-[28rem] min-h-[256px]"
              style={{
                boxShadow:
                  "8px 0 24px -8px rgba(0,0,0,0.12), -8px 0 24px -8px rgba(0,0,0,0.12)",
              }}
            >
              <span className="text-5xl mb-4">📷</span>
              <span className="font-bold text-2xl mb-2 text-center">
                Find a Subletter Without the Chaos
              </span>
              <span className="text-lg text-gray-700 text-center">
                Tired of Sidechat, Reddit, and endless DMs? Proximity makes it
                simple to list or find sublets with real photos, real details,
                and none of the noise.
              </span>
            </div>
            {/* Card 2 (Verified) */}
            <div
              className="flex flex-col items-center bg-white rounded-3xl p-10 w-[28rem] min-h-[256px]"
              style={{
                boxShadow:
                  "8px 0 24px -8px rgba(0,0,0,0.12), -8px 0 24px -8px rgba(0,0,0,0.12)",
              }}
            >
              <span className="text-5xl mb-4">✅</span>
              <span className="font-bold text-2xl mb-2 text-center">
                Verified Reviews
              </span>
              <span className="text-lg text-gray-700 text-center">
                Honest feedback from students who&apos;ve lived there—know what
                to expect before you sign anything.
              </span>
            </div>
            {/* Card 3 (Map-Based) */}
            <div
              className="flex flex-col items-center bg-white rounded-3xl p-10 w-[28rem] min-h-[256px]"
              style={{
                boxShadow:
                  "8px 0 24px -8px rgba(0,0,0,0.12), -8px 0 24px -8px rgba(0,0,0,0.12)",
              }}
            >
              <span className="text-5xl mb-4">🗺️</span>
              <span className="font-bold text-2xl mb-2 text-center">
                Map-Based Browsing
              </span>
              <span className="text-lg text-gray-700 text-center">
                Easily see what&apos;s near campus, your classes, or your
                favorite coffee shop. Explore by neighborhood, not by guesswork.
              </span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
