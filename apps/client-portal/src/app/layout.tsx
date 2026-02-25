import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
