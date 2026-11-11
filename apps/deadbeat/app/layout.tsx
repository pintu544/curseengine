import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Deadbeat", description: "Invoice chasing you can read, on CurseEngine." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
