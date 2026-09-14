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
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${azeret.variable} h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
