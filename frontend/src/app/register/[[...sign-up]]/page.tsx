import { SignUp } from "@clerk/nextjs";

export default function RegisterPage() {
  return <main className="flex min-h-screen items-center justify-center bg-[#07080c] p-6 text-white">
    {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
      ? <SignUp routing="path" path="/register" />
      : <p role="status">Registration is not configured yet.</p>}
  </main>;
}
