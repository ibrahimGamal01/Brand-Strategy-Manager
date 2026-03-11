import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

const themeInitScript = `
(() => {
  try {
    const modeKey = "bat-theme-mode";
    const legacyKey = "bat-theme";
    const parseMode = (value) =>
      value === "light" || value === "dark" || value === "system" ? value : null;
    const stored = parseMode(window.localStorage.getItem(modeKey));
    const legacy = parseMode(window.localStorage.getItem(legacyKey));
    const mode = stored || (legacy === "light" || legacy === "dark" ? legacy : null) || "system";
    const resolved =
      mode === "system"
        ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : mode;
    const root = document.documentElement;
    root.setAttribute("data-theme", resolved);
    root.setAttribute("data-theme-mode", mode);
    root.style.colorScheme = resolved;
  } catch {}
})();
`;

export const metadata: Metadata = {
  metadataBase: new URL("https://bat-platform.example"),
  title: {
    default: "BAT | Brand Autopilot Terminal",
    template: "%s | BAT"
  },
  description:
    "BAT is your marketing agency in chat. Grounded recommendations, live activity visibility, and auditable decisions for every workspace.",
  openGraph: {
    title: "BAT | Brand Autopilot Terminal",
    description:
      "Everything in one chat-first marketing workspace with evidence-linked answers and approval workflows.",
    type: "website"
  },
  robots: {
    index: true,
    follow: true
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} suppressHydrationWarning />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
