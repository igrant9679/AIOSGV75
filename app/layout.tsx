import type { Metadata } from "next";
import localFont from "next/font/local";
import Shell from "@/components/Shell";
import { appearanceBootScript } from "@/lib/appearance";
import "./globals.css";

// Fonts live in app/fonts (latin subset, SIL Open Font License; see app/fonts/README.md).
// They used to come from next/font/google, which fetches them at EVERY build: Turbopack's
// Google-font loader failed about one build in three ("next/font/google queries have exactly
// one entry"), which made remote updates (Fleet → Versions) fail at random. Local files
// build the same every time, with no network.

// The default interface face (MissionCommand look).
const jakarta = localFont({ variable: "--font-jakarta", src: "./fonts/plus-jakarta-sans-var.woff2", weight: "200 800" });

const spaceGrotesk = localFont({ variable: "--font-space-grotesk", src: "./fonts/space-grotesk-var.woff2", weight: "300 700" });

const jetbrains = localFont({ variable: "--font-jetbrains", src: "./fonts/jetbrains-mono-var.woff2", weight: "100 800" });

// Optional faces for Appearance → fonts. Preload is off so a face's files are only fetched once it's chosen.
const inter = localFont({ variable: "--font-inter", src: "./fonts/inter-var.woff2", weight: "100 900", preload: false });
const plexSans = localFont({ variable: "--font-plex-sans", src: "./fonts/ibm-plex-sans-var.woff2", weight: "100 700", preload: false });
const plexMono = localFont({
  variable: "--font-plex-mono",
  src: [
    { path: "./fonts/ibm-plex-mono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-700.woff2", weight: "700", style: "normal" },
  ],
  preload: false,
});
const atkinson = localFont({
  variable: "--font-atkinson",
  src: [
    { path: "./fonts/atkinson-hyperlegible-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/atkinson-hyperlegible-700.woff2", weight: "700", style: "normal" },
  ],
  preload: false,
});
const sourceSerif = localFont({ variable: "--font-source-serif", src: "./fonts/source-serif-4-var.woff2", weight: "200 900", preload: false });
const firaCode = localFont({ variable: "--font-fira-code", src: "./fonts/fira-code-var.woff2", weight: "300 700", preload: false });

const FONT_VARS = [jakarta, spaceGrotesk, jetbrains, inter, plexSans, plexMono, atkinson, sourceSerif, firaCode].map((f) => f.variable).join(" ");

export const metadata: Metadata = {
  title: "AI OPERATIONS CONTROL // Local AI Operations Deck",
  description: "Local mission control for Claude Code and companion AI agents",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${FONT_VARS} h-full antialiased`}
      // the boot script sets data-theme + appearance attributes before hydration — expected mismatch
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* apply the saved theme and appearance before first paint */}
        <script dangerouslySetInnerHTML={{ __html: appearanceBootScript() }} />
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
