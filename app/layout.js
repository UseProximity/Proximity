import { Inter } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import { Header } from "@/components/Header";
import { auth } from "@/auth";

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
        <Header role={session?.user?.role} />
        {children}
      </body>
    </html>
  );
}
