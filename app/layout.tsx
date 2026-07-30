import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Extendr",
  description: "Extend videos to an exact duration and download the final MP4.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}