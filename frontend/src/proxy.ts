import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { clerkConfigurationIssues } from "./lib/auth/configuration";

const authenticate = clerkMiddleware({ signInUrl: "/login", signUpUrl: "/register" });

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const issues = clerkConfigurationIssues({
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  });
  if (issues.length) {
    return NextResponse.json({
      error: {
        code: "AUTH_CONFIGURATION_INVALID",
        message: "Authentication configuration needs correction. Restart the development server after correcting it.",
        ...(process.env.NODE_ENV === "development" ? { issues } : {}),
      },
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  // Public auth routes still pass through Clerk to complete its handshake.
  // The workspace server layout enforces authentication before rendering children.
  return authenticate(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
