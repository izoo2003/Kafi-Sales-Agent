import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kafi Mailer",
  description: "Bulk & individual email via Vercel SMTP (off Railway)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
