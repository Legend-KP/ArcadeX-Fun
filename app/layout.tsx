import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppProviders from "@/components/AppProviders";
import { readFirebaseConfigFromEnv } from "@/lib/firebase-config";

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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const firebaseConfig = readFirebaseConfigFromEnv();
  const configScript = `window.__FIREBASE_CONFIG__=${JSON.stringify(firebaseConfig).replace(/</g, "\\u003c")};`;

  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: configScript }} />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
