"use client";
import Link from 'next/link';
import { setupSteps } from '@/lib/product-workflow';
import { DatabaseSelector, useDatabaseWorkspace } from './DatabaseWorkspace';
import { RouteShell } from './RouteShell';
import { aiButton, aiPanel } from './AIProviderState';
export function OnboardingWorkspace() {
  const workspace=useDatabaseWorkspace();
  return <RouteShell title="Get started" description="Resume setup from your saved workspace and database selection. Readiness is checked against the authorized API on every visit.">
    <section className={aiPanel}><h2 className="font-bold">Your setup</h2><DatabaseSelector workspace={workspace}/><ol className="space-y-3">{setupSteps(workspace.workspaceId,workspace.database).map((step,i)=><li key={step.id}><span aria-label={step.done?'Complete':'Required'}>{step.done?'✓':'○'}</span> {i+1}. <Link className="underline" href={step.href}>{step.title}</Link></li>)}</ol><p>Create an organization and workspace using the sidebar. On mobile, open Menu to access the workspace controls.</p></section>
    <div className="grid gap-4 md:grid-cols-2"><section className={aiPanel}><h2 className="font-bold">Managed Neon</h2><p>A separate PostgreSQL database and restricted roles for this workspace. Provisioning requires owner-configured infrastructure and workspace owner or admin permission.</p>{workspace.list&&!workspace.list.capabilities.provisioningConfigured&&<p role="status">Setup required: managed provisioning is unavailable.</p>}<Link className={aiButton} href="/databases">View managed database setup</Link></section><section className={aiPanel}><h2 className="font-bold">Bring your own database</h2><p>Connect PostgreSQL or MySQL using an owner-approved destination and restricted role. The connection form validates credentials before saving. Credentials stay encrypted on the server.</p><p>MySQL is read-only. PostgreSQL changes require separate owner opt-in and explicit per-query approval.</p><Link className={aiButton} href="/databases">Configure PostgreSQL or MySQL</Link></section></div>
    <section className={aiPanel}><h2 className="font-bold">Explore, query, then ask AI</h2><p>Select an active database, inspect a table, and use Open in SQL editor to prepare your first SELECT. No query runs automatically.</p><div className="flex flex-wrap gap-3"><Link className={aiButton} href="/explorer">Explore schema and relationships</Link><Link className={aiButton} href="/sql-editor">Review your first query</Link><Link className={aiButton} href="/settings/ai">Optional: configure OpenRouter BYOK</Link></div><p>AI setup is optional. Provider requests require your configured key and model; generated SQL always remains a proposal until you review it.</p></section>
  </RouteShell>;
}
