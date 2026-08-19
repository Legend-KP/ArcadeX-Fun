import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppProviders from "@/components/AppProviders";

export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "ArcadeX",
  description: "Play fun games on ArcadeX — multi-chain web arcade",
  icons: {
    icon: "/thumbnails/arcadex-favicon.webp",
    shortcut: "/thumbnails/arcadex-favicon.webp",
    apple: "/thumbnails/arcadex-favicon.webp",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
