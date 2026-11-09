import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const OG_DESCRIPTION =
  "No collateral, no bank, no committee. A panel of AI underwriters runs inside the contract, reads a borrower's own live public evidence under validator consensus, and agrees on a bounded credit grade before a token moves. Powered by GenLayer.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "Credence",
  title: "Credence — undercollateralized credit, underwritten by AI consensus",
  description:
    "No collateral, no bank, no committee. A borrower submits public evidence of creditworthiness; an on-chain panel of AI underwriters fetches it live, judges it, and must agree on a bounded credit grade before a token moves. Powered by GenLayer Intelligent Contracts.",
  manifest: `${BASE}/site.webmanifest`,
  icons: {
    icon: [{ url: `${BASE}/favicon.svg`, type: "image/svg+xml" }],
  },
  openGraph: {
    type: "website",
    siteName: "Credence",
    url: "/",
    title: "Credit without collateral. Underwritten by AI consensus.",
    description: OG_DESCRIPTION,
    images: [
      {
        url: `${BASE}/og-image.svg`,
        width: 1200,
        height: 630,
        type: "image/svg+xml",
        alt: "Credence — Credit without collateral, underwritten by AI consensus.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Credit without collateral. Underwritten by AI consensus.",
    description: OG_DESCRIPTION,
    images: [`${BASE}/og-image.svg`],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

/**
 * Apply the stored theme before first paint so there is no flash. Defaults to
 * the dark "keynote" brand theme; only an explicit stored "light" opts out.
 */
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('credence-theme');var d=document.documentElement;if(t==='light'){d.classList.remove('dark');}else{d.classList.add('dark');}}catch(e){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
