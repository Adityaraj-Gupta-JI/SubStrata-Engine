"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

const groups = [
  { label: "Workspace", links: [["Dashboard", "/dashboard"], ["AI chat", "/ai-chat"], ["Databases", "/databases"], ["SQL editor", "/sql-editor"], ["Explorer", "/explorer"], ["Agent runs", "/agent-runs"]] },
  { label: "Settings", links: [["AI settings", "/settings/ai"], ["Access control", "/settings/access-control"], ["Account", "/settings/account"]] },
] as const;

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-[#07080c] text-[#e0e6ed] lg:flex">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3 focus:text-black">Skip to content</a>
      <header className="flex items-center justify-between border-b border-[#2a3047] bg-[#0d0e17] p-4 lg:hidden">
        <Link href="/dashboard" className="font-bold text-[#ff0055]">SUBSTRATA</Link>
        <button type="button" aria-expanded={open} aria-controls="workspace-nav" onClick={() => setOpen(!open)} className="rounded border border-[#2a3047] px-3 py-1">{open ? "Close" : "Menu"}</button>
      </header>
      <aside id="workspace-nav" className={`${open ? "block" : "hidden"} border-r border-[#2a3047] bg-[#0d0e17] p-5 lg:block lg:min-h-screen lg:w-64 lg:shrink-0`}>
        <Link href="/dashboard" className="hidden text-xl font-black tracking-wider text-[#ff0055] lg:block">SUBSTRATA</Link>
        <div className="mt-5 rounded border border-[#2a3047] bg-[#131522] p-3 text-xs">
          <span className="block text-[#8b9bb4]">WORKSPACE</span>
          <span className="font-bold">Local demo</span>
          <span className="mt-1 block text-[#8b9bb4]">Hosted accounts not connected</span>
        </div>
        <nav aria-label="Workspace navigation" className="mt-6 space-y-6">
          {groups.map(group => <div key={group.label}>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[#8b9bb4]">{group.label}</p>
            <div className="space-y-1">{group.links.map(([label, href]) => <Link key={href} href={href} onClick={() => setOpen(false)} aria-current={pathname === href ? "page" : undefined} className={`block rounded px-3 py-2 text-sm hover:bg-[#1a1e30] ${pathname === href ? "bg-[#ff0055]/15 text-[#ff0055]" : "text-[#c3cedc]"}`}>{label}</Link>)}</div>
          </div>)}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="hidden items-center justify-between border-b border-[#2a3047] bg-[#0d0e17] px-6 py-4 lg:flex"><span className="text-sm font-bold">Database workspace</span><span className="text-xs text-[#8b9bb4]">Local preview · no account session</span></div>
        <main id="main-content" className="min-w-0 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
