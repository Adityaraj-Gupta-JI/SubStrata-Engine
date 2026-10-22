import { SignIn } from "@clerk/nextjs";

export default function LoginPage() {
  return <main className="flex min-h-screen items-center justify-center bg-[#07080c] p-6 text-white">
    {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
      ? <SignIn routing="path" path="/login" />
      : <p role="status">Authentication is not configured yet.</p>}
  </main>;
}
