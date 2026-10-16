import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CtrlAltSocials", template: "%s · CtrlAltSocials" },
  description: "Post and schedule across every project's social accounts from one place.",
  appleWebApp: { capable: true, title: "CtrlAlt", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#0b0d12" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
