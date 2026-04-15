import { Inter } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import { Header } from "@/components/Header";
import { auth } from "@/auth";
import ProfileCompletionModal from "@/components/ProfileCompletionModal";
import GlobalListingModal from "@/components/GlobalListingModal";
import Providers from "@/components/Providers";
import AnalyticsTracker from "@/components/AnalyticsTracker";
import { Analytics } from '@vercel/analytics/next';

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Proximity",
  description: "Find Housing Near Your University",
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
        </Providers>
      </body>
    </html>
  );
}
