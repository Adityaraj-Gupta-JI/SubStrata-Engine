"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth, UserButton } from "@clerk/nextjs";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { platformGet, platformPost, platformToken, type Organization, type Page, type Session, type Workspace } from "@/lib/api/platform";

const groups = [
  { label: "Workspace", links: [["Dashboard", "/dashboard"], ["AI chat", "/ai-chat"], ["Databases", "/databases"], ["SQL editor", "/sql-editor"], ["Explorer", "/explorer"], ["Agent runs", "/agent-runs"]] },
  { label: "Settings", links: [["AI settings", "/settings/ai"], ["Access control", "/settings/access-control"], ["Account", "/settings/account"]] },
] as const;

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [status, setStatus] = useState("Loading session…");
  const [create, setCreate] = useState<"organization" | "workspace" | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await platformToken(getToken);
        await platformGet<Session>("/auth/session", token);
        const result = await platformGet<Page<Organization>>("/organizations", token);
        if (cancelled) return;
        setOrganizations(result.data);
        setOrganizationId(result.data[0]?.id ?? "");
        setStatus(result.data.length ? "" : "No organizations yet.");
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "Workspace unavailable.");
      }
    })();
    return () => { cancelled = true; };
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    if (!organizationId || !isSignedIn) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await platformToken(getToken);
        const result = await platformGet<Page<Workspace>>(`/organizations/${organizationId}/workspaces`, token);
        if (cancelled) return;
        setWorkspaces(result.data);
        setWorkspaceId(result.data[0]?.id ?? "");
        setStatus(result.data.length ? "" : "No workspaces assigned.");
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "Workspace unavailable.");
      }
    })();
    return () => { cancelled = true; };
  }, [getToken, organizationId, isSignedIn]);

  async function createMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!create || saving || (create === "workspace" && !organizationId)) return;
    const form = new FormData(event.currentTarget);
    const payload = { name: String(form.get("name") ?? ""), slug: String(form.get("slug") ?? "") };
    setSaving(true);
    setStatus("Saving metadata…");
    try {
      const token = await platformToken(getToken);
      if (create === "organization") {
        const result = await platformPost<{ data: Organization }>("/organizations", token, payload);
        setOrganizations(previous => [result.data, ...previous]);
        setWorkspaces([]);
        setWorkspaceId("");
        setOrganizationId(result.data.id);
      } else {
        const result = await platformPost<{ data: Workspace }>(`/organizations/${organizationId}/workspaces`, token, payload);
        setWorkspaces(previous => [result.data, ...previous]);
        setWorkspaceId(result.data.id);
      }
      setCreate(null);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Metadata could not be saved.");
    } finally { setSaving(false); }
  }
  return (
    <div className="min-h-screen bg-[#07080c] text-[#e0e6ed] lg:flex">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3 focus:text-black">Skip to content</a>
      <header className="flex items-center justify-between border-b border-[#2a3047] bg-[#0d0e17] p-4 lg:hidden">
        <Link href="/dashboard" className="font-bold text-[#ff0055]">SUBSTRATA</Link>
        <button type="button" aria-expanded={open} aria-controls="workspace-nav" onClick={() => setOpen(!open)} className="rounded border border-[#2a3047] px-3 py-1">{open ? "Close" : "Menu"}</button>
      </header>
      <aside id="workspace-nav" className={`${open ? "block" : "hidden"} border-r border-[#2a3047] bg-[#0d0e17] p-5 lg:block lg:min-h-screen lg:w-64 lg:shrink-0`}>
        <Link href="/dashboard" className="hidden text-xl font-black tracking-wider text-[#ff0055] lg:block">SUBSTRATA</Link>
        <div className="mt-5 space-y-2 rounded border border-[#2a3047] bg-[#131522] p-3 text-xs">
          <label className="block text-[#8b9bb4]" htmlFor="organization-select">ORGANIZATION</label>
          <select id="organization-select" value={organizationId} onChange={event => { setOrganizationId(event.target.value); setWorkspaceId(""); setWorkspaces([]); setStatus("Loading workspaces…"); }} className="w-full bg-[#0d0e17] p-2 text-white" disabled={!organizations.length || saving}>
            {!organizations.length && <option value="">None available</option>}
            {organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="underline" disabled={!isSignedIn || saving} onClick={() => setCreate("organization")}>New organization</button>
            <button type="button" className="underline" disabled={!organizationId || saving} onClick={() => setCreate("workspace")}>New workspace</button>
          </div>
          {create && <form onSubmit={createMetadata} className="space-y-2">
            <p>Create {create}. Workspace creation requires an owner or admin.</p>
            <label className="block">Name<input name="name" required minLength={2} maxLength={100} disabled={saving} className="mt-1 w-full bg-[#0d0e17] p-2" /></label>
            <label className="block">Slug<input name="slug" required maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*" disabled={saving} className="mt-1 w-full bg-[#0d0e17] p-2" /></label>
            <button type="submit" disabled={saving} className="mr-3 underline">{saving ? "Saving…" : "Create"}</button>
            <button type="button" disabled={saving} onClick={() => setCreate(null)} className="underline">Cancel</button>
          </form>}
          <label className="block text-[#8b9bb4]" htmlFor="workspace-select">WORKSPACE</label>
          <select id="workspace-select" value={workspaceId} onChange={event => setWorkspaceId(event.target.value)} className="w-full bg-[#0d0e17] p-2 text-white" disabled={!workspaces.length}>
            {!workspaces.length && <option value="">None available</option>}
            {workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
          {status && <p role="status" className="text-[#ff8da8]">{status}</p>}
        </div>
        <nav aria-label="Workspace navigation" className="mt-6 space-y-6">
          {groups.map(group => <div key={group.label}>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[#8b9bb4]">{group.label}</p>
            <div className="space-y-1">{group.links.map(([label, href]) => <Link key={href} href={href} onClick={() => setOpen(false)} aria-current={pathname === href ? "page" : undefined} className={`block rounded px-3 py-2 text-sm hover:bg-[#1a1e30] ${pathname === href ? "bg-[#ff0055]/15 text-[#ff0055]" : "text-[#c3cedc]"}`}>{label}</Link>)}</div>
          </div>)}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="hidden items-center justify-between border-b border-[#2a3047] bg-[#0d0e17] px-6 py-4 lg:flex"><span className="text-sm font-bold">Database workspace</span><UserButton /></div>
        <main id="main-content" className="min-w-0 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
