import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GM Manager | Quản lý dự án",
  description: "GM Manager quản lý hồ sơ và thư mục dự án theo tháng, năm.",
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
