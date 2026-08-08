import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orbit CRM | Customer pipeline",
  description: "A calm, focused CRM dashboard for managing customer relationships.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
