import type { Metadata, Viewport } from "next";
import { Azeret_Mono } from "next/font/google";
import "./globals.css";

const azeret = Azeret_Mono({
  variable: "--font-azeret",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const title = "Drawing - neon sketchpad";
const description =
  "A minimal neon sketchpad for Apple Pencil. Pressure-sensitive glow on pure black, six neon styles, download or share as PNG.";

export const metadata: Metadata = {
  title,
  description,
  applicationName: "Drawing",
  appleWebApp: { capable: true, title: "Drawing", statusBarStyle: "black-translucent" },
  openGraph: { title, description, type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // Zoom stays enabled (WCAG 1.4.4). The canvas sets touch-action: none, so a
  // pinch there never scrolls or zooms the page mid-stroke.
  viewportFit: "cover",
};

// Typed explicitly rather than with Next's generated `LayoutProps`, which only
// exists after a build - `npm run typecheck` has to work on a fresh clone.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${azeret.variable} h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
