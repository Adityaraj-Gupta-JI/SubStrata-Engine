import Link from "next/link";
import { RouteShell } from "@/components/RouteShell";

const cards = [
  { title: "AI chat", href: "/ai-chat", note: "Existing OpenRouter chat and local EAV demo" },
  { title: "Databases", href: "/databases", note: "Tenant metadata and provisioning status" },
  { title: "SQL editor", href: "/sql-editor", note: "Read-only SELECT workspace" },
  { title: "Explorer", href: "/explorer", note: "Schema inspection and bounded previews" },
];

export default function DashboardPage() {
  return <RouteShell title="Dashboard" description="Your authenticated SubStrata workspace. Database access requires a configured tenant runtime connection.">
    <div className="grid gap-4 sm:grid-cols-2">{cards.map(card => <Link key={card.href} href={card.href} className="rounded-xl border border-[#2a3047] bg-[#0d0e17] p-5 hover:border-[#ff0055]">
      <h2 className="font-bold text-[#00f0ff]">{card.title}</h2><p className="mt-2 text-sm text-[#8b9bb4]">{card.note}</p>
    </Link>)}</div>
  </RouteShell>;
}
