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
import { auth } from "@/auth";
import ProfileCompletionModal from "@/components/auth/ProfileCompletionModal";
import GlobalListingModal from "@/components/listings/GlobalListingModal";
import Providers from "@/components/layout/Providers";
import AnalyticsTracker from "@/components/ui/AnalyticsTracker";
import { Analytics } from '@vercel/analytics/next';
import { GoogleAnalytics } from '@next/third-parties/google';

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "WashU Student Housing Matchmaking | Honest Peer Reviews | Pre-Vetted Listings | Proximity",
  description: "Proximity helps WashU students find the perfect off-campus apartment. Verified listings, honest peer reviews, and free personalized matchmaking near Washington University in St. Louis.",
};

export default async function RootLayout({ children }) {
  const session = await auth();
  return (
    <html lang="en" data-theme="">
      <head>
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "Proximity",
              alternateName: "useproximity.org",
              url: "https://useproximity.org/",
            }),
          }}
        />
      </head>
      <body className={inter.className}>
        <div>
          <Toaster />
        </div>
        <Providers session={session}>
          <Header session={session} />
          <ProfileCompletionModal session={session} />
          <GlobalListingModal />
          <AnalyticsTracker />
          {children}
          <Analytics />
          <GoogleAnalytics gaId="G-QJCHSZJXQY" />
        </Providers>
      </body>
    </html>
  );
}
