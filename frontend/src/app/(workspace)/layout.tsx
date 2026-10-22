import { WorkspaceShell } from "@/components/WorkspaceShell";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <main className="min-h-screen bg-[#07080c] p-8 text-white"><h1 className="text-xl font-bold">Authentication not configured</h1><p className="mt-3">Set up Clerk to access the hosted workspace.</p></main>;
  }
  const session = await auth();
  if (!session.userId) redirect("/login");
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
