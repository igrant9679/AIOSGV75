# Fonts

The interface fonts, self-hosted so a build never needs the network (see the note in
`app/layout.tsx`). Latin subset only, downloaded from Google Fonts (fonts.gstatic.com) on
2026-11-26. All are licensed under the SIL Open Font License 1.1.

| File | Family |
| --- | --- |
| plus-jakarta-sans-var.woff2 | Plus Jakarta Sans (variable, 200-800) |
| space-grotesk-var.woff2 | Space Grotesk (variable, 300-700) |
| jetbrains-mono-var.woff2 | JetBrains Mono (variable, 100-800) |
| inter-var.woff2 | Inter (variable, 100-900) |
| ibm-plex-sans-var.woff2 | IBM Plex Sans (variable, 100-700) |
| ibm-plex-mono-400/500/700.woff2 | IBM Plex Mono |
| atkinson-hyperlegible-400/700.woff2 | Atkinson Hyperlegible |
| source-serif-4-var.woff2 | Source Serif 4 (variable, 200-900) |
| fira-code-var.woff2 | Fira Code (variable, 300-700) |

To add a face: download its latin woff2 from Google Fonts' CSS
(`https://fonts.googleapis.com/css2?family=...`), put it here, and declare it with
`localFont()` in `app/layout.tsx`.
