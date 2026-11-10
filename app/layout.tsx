import type { Metadata } from "next";
import {
  Space_Grotesk,
  JetBrains_Mono,
  Inter,
  IBM_Plex_Sans,
  IBM_Plex_Mono,
  Atkinson_Hyperlegible,
  Source_Serif_4,
  Fira_Code,
  Plus_Jakarta_Sans,
} from "next/font/google";
import Shell from "@/components/Shell";
import { appearanceBootScript } from "@/lib/appearance";
import "./globals.css";

// The default interface face (MissionCommand look).
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

// Optional faces for Appearance → fonts. Self-hosted by next/font at build
// time; preload is off so a face's files are only fetched once it's chosen.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], preload: false });
const plexSans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600", "700"], preload: false });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500", "700"], preload: false });
const atkinson = Atkinson_Hyperlegible({ variable: "--font-atkinson", subsets: ["latin"], weight: ["400", "700"], preload: false });
const sourceSerif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"], preload: false });
const firaCode = Fira_Code({ variable: "--font-fira-code", subsets: ["latin"], preload: false });

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
