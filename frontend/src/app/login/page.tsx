import Link from "next/link";
import { RouteShell } from "@/components/RouteShell";
export default function LoginPage() { return <main className="min-h-screen bg-[#07080c] p-6 text-white"><RouteShell title="Log in" description="Authentication is not connected yet."><p role="status" className="rounded border border-[#2a3047] bg-[#0d0e17] p-5">Login is unavailable. <Link className="text-[#00f0ff] underline" href="/dashboard">View local workspace</Link> or <Link className="text-[#00f0ff] underline" href="/register">registration information</Link>.</p></RouteShell></main>; }
