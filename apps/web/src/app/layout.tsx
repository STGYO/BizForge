import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BizForge",
  description: "Modular automation operating system for small businesses"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
