import type { ReactNode } from "react";

export function RouteShell({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <section className="mx-auto max-w-5xl space-y-5">
    <div><h1 className="text-2xl font-black tracking-wide text-white md:text-3xl">{title}</h1><p className="mt-2 text-sm text-[#8b9bb4]">{description}</p></div>
    {children ?? <div role="status" className="rounded-xl border border-[#2a3047] bg-[#0d0e17] p-6 text-sm text-[#c3cedc]">This workspace feature is not connected yet.</div>}
  </section>;
}
