import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CtrlAltSocials", template: "%s · CtrlAltSocials" },
  description: "Post and schedule across every project's social accounts from one place.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
