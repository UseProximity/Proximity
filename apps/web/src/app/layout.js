/*
 * Root layout — the single server component that wraps every page in the app. Fetches
 * the NextAuth session server-side so it is available to Header and ProfileCompletionModal
 * without a client-side waterfall. Renders the global shell: Inter font, Leaflet CSS,
 * toast notifications, the site Header, the profile completion gate modal, and the
 * URL-driven GlobalListingModal that can open any listing from any page via ?listing=.
 * Also mounts the Vercel Analytics beacon and Google Analytics (GA4) tag. All client
 * state providers (SessionProvider, FavoritesProvider) are composed inside Providers.
 * Defines the site-wide <title> and <description> used for SEO.
 */
import { Inter } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import { Header } from "@/components/layout/Header";
import StagingBanner from "@/components/layout/StagingBanner";
import StagingEmailPicker from "@/components/layout/StagingEmailPicker";
import { auth } from "@/auth";
import { appEnv, isPilot } from "@/lib/appEnv";
import ProfileCompletionModal from "@/components/auth/ProfileCompletionModal";
import GlobalListingModal from "@/components/listings/GlobalListingModal";
import FeedbackWidget from "@/components/feedback/FeedbackWidget";
import Providers from "@/components/layout/Providers";
import { Analytics } from "@vercel/analytics/next";
import { GoogleAnalytics } from "@next/third-parties/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  // A pilot is a real production deployment on its own public domain with no
  // deployment protection, serving the same pages as the live site. Left
  // indexable it would become a duplicate copy of useproximity.org in search
  // results, competing with the canonical site and exposing a landlord's
  // in-progress listings. Keep crawlers off it entirely.
  ...(isPilot()
    ? { robots: { index: false, follow: false, nocache: true } }
    : {}),
  title:
    "WashU Student Housing Matchmaking | Honest Peer Reviews | Pre-Vetted Listings | Proximity",
  description:
    "Proximity helps WashU students find the perfect off-campus apartment. Verified listings, honest peer reviews, and free personalized matchmaking near Washington University in St. Louis.",
  openGraph: {
    siteName: "WashU Student Housing",
    title:
      "WashU Student Housing Matchmaking | Honest Peer Reviews | Pre-Vetted Listings | Proximity",
    description:
      "Proximity helps WashU students find the perfect off-campus apartment. Verified listings, honest peer reviews, and free personalized matchmaking near Washington University in St. Louis.",
    url: "https://useproximity.org/",
  },
};

export default async function RootLayout({ children }) {
  const session = await auth();
  return (
    <html lang="en" data-theme="">
      <head>
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta
          name="impact-site-verification"
          value="adb0995a-e102-4c41-90cd-dc3477fc8b5b"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "WashU Student Housing",
              alternateName: "Proximity",
              url: "https://useproximity.org/",
            }),
          }}
        />
      </head>
      <body className={inter.className}>
        <StagingBanner />
        {/* The email-destination picker is internal tooling: a floating pill that
            auto-opens and asks which inbox should receive test mail. A pilot is a
            real property manager looking at their own portfolio, so it has no
            business on their screen. Off the pilot it behaves as before. Where
            pilot mail actually goes is fixed in outreach.js. */}
        {!isPilot() && <StagingEmailPicker env={appEnv()} />}
        <div>
          <Toaster />
        </div>
        <Providers session={session}>
          <Header session={session} />
          <ProfileCompletionModal session={session} />
          <GlobalListingModal />
          <FeedbackWidget />
          {children}
          <Analytics />
          {/* GA only on the real site — staging/preview/local sessions would land in
              the same property and skew the funnels. Vercel Analytics separates
              environments on its own, so it stays mounted everywhere. */}
          {appEnv() === "production" && <GoogleAnalytics gaId="G-QJCHSZJXQY" />}
        </Providers>
      </body>
    </html>
  );
}
