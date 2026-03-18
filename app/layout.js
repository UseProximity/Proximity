import { Inter } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import { Header } from "@/components/Header";
import { auth } from "@/auth";
import ProfileCompletionModal from "@/components/ProfileCompletionModal";
import Providers from "@/components/Providers";

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
        <link rel="icon" href="/logo.png" type="image/png" />
      </head>
      <body className={inter.className}>
        <div>
          <Toaster />
        </div>
        <Providers session={session}>
          <Header session={session} />
          <ProfileCompletionModal session={session} />
          {children}
        </Providers>
      </body>
    </html>
  );
}
