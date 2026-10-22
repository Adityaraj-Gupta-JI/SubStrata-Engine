import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "SubStrata Engine",
  description: "Database workspace preview",
};
// src/app/layout.tsx

export default function RootLayout({ children }: LayoutProps<"/">) {
  const document = (
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
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    ? <ClerkProvider publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY} signInUrl="/login" signUpUrl="/register" signInFallbackRedirectUrl="/dashboard" signUpFallbackRedirectUrl="/dashboard">{document}</ClerkProvider>
    : document;
}
