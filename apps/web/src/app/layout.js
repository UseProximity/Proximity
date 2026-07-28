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
import { appEnv } from "@/lib/appEnv";
import ProfileCompletionModal from "@/components/auth/ProfileCompletionModal";
import GlobalListingModal from "@/components/listings/GlobalListingModal";
import FeedbackWidget from "@/components/feedback/FeedbackWidget";
import Providers from "@/components/layout/Providers";
import { Analytics } from "@vercel/analytics/next";
import { GoogleAnalytics } from "@next/third-parties/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  metadataBase: new URL("https://useproximity.org"),
  title: "WashU Off-Campus Housing & Honest Peer Reviews | Proximity",
  description:
    "Find your off-campus apartment near WashU with honest peer reviews, verified listings, and free personalized matchmaking — built by students, for students.",
  // "./" resolves against each route, giving every page a self-canonical
  // (query strings dropped). Pages that set their own canonical override it.
  alternates: { canonical: "./" },
  openGraph: {
    siteName: "Proximity",
    title: "WashU Off-Campus Housing & Honest Peer Reviews | Proximity",
    description:
      "Find your off-campus apartment near WashU with honest peer reviews, verified listings, and free personalized matchmaking — built by students, for students.",
    url: "https://useproximity.org/",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
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
              "@graph": [
                {
                  "@type": "WebSite",
                  "@id": "https://useproximity.org/#website",
                  name: "WashU Student Housing",
                  alternateName: "Proximity",
                  url: "https://useproximity.org/",
                  publisher: { "@id": "https://useproximity.org/#organization" },
                },
                {
                  "@type": "Organization",
                  "@id": "https://useproximity.org/#organization",
                  name: "Proximity",
                  url: "https://useproximity.org/",
                  logo: "https://useproximity.org/logo.png",
                  sameAs: [
                    "https://www.instagram.com/useproximity",
                    "https://www.tiktok.com/@useproximity",
                  ],
                },
              ],
            }),
          }}
        />
      </head>
      <body className={inter.className}>
        <StagingBanner />
        <StagingEmailPicker env={appEnv()} />
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
