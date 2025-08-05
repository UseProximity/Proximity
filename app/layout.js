import { Inter } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { UserProvider } from "@/context/UserContext";
import { Toaster } from "react-hot-toast";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Proximity",
  description: "Find Housing Near Your University",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="">
      <head>
        <link rel="icon" href="/logo.png" type="image/png" />
      </head>
      <body className={inter.className}>
        <div>
          <Toaster />
        </div>
        <UserProvider>{children}</UserProvider>
      </body>
    </html>
  );
}
