import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SubStrata Engine",
  description: "Database workspace preview",
};
// src/app/layout.tsx

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <body className="h-full bg-[#0d0e12] text-[#f2ede1]">
        {children}
      </body>
    </html>
  );
}
