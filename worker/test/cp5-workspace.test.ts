import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createHandler } from '../src/index';
import { unauthorized, unavailable } from '../src/errors';
import { ExternalCredentialStore, externalStore } from '../src/byodb/credentials';
import { ExternalResolver, externalSource, type ExternalRow } from '../src/byodb/service';
import { destinations, publicIPv4, destinationDigest } from '../src/byodb/policy';
import { UnavailableMySQLAdapter } from '../src/byodb/mysql';
import { EncryptedAIKeys } from '../src/ai/credentials';
import { AuthorizedAITools } from '../src/ai/tools';
import type { AIProvider, ChatMessage } from '../src/ai/contracts';
import type { VaultBucket } from '../src/neon/credential-vault';
const wa = '11111111-1111-4111-8111-111111111111', wb = '22222222-2222-4222-8222-222222222222';
const users = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'];
const secret = randomBytes(24).toString('hex'), ring = JSON.stringify({ test: randomBytes(32).toString('hex') });
const destination = { id: 'approved', hostname: 'db.example.com', address: '8.8.8.8', port: 5432, databases: ['customer'], roles: ['reader'], schemas: ['app'] };
let runtime: Miniflare, db: D1Database, bucket: VaultBucket, env: Env;
let mode = 'normal', calls = 0, afterModel: (() => Promise<void>) | null = null;
const transport = { read: vi.fn(async () => ({ columns: [], rows: [], truncated: false, elapsedMs: 1 })) };
const provider: AIProvider = { validate: async () => { }, models: async () => [{ id: 'test/model', name: 'Fixture', contextLength: 8000, tools: true, pricing: { prompt: '0', completion: '0' } }], complete: async (_key, _model, _messages: ChatMessage[], _tools, signal, onDelta) => { calls++; if (mode === 'wait')
        await new Promise<void>(resolve => { signal?.addEventListener('abort', () => resolve(), { once: true }); setTimeout(resolve, 500); }); await afterModel?.(); if (mode === 'loop')
        return { content: '', toolCalls: [{ id: 'tool-' + calls, type: 'function', function: { name: 'list_databases', arguments: '{}' } }], usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 } }; onDelta?.('Fixture answer'); return { content: 'Fixture answer', toolCalls: [], usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 } }; } };
const connectionTest = vi.fn(async () => { });
const handler = () => createHandler(async (request) => { const id = request.headers.get('Authorization')?.replace('Bearer ', ''); if (!['0', '1', '2', '3'].includes(id ?? ''))
    throw unauthorized(); return { clerkUserId: 'clerk-' + id, sessionId: 'mocked-local' }; }, { transport }, { provider, credentials: () => new EncryptedAIKeys(bucket, ring, 'test') }, { external: { store: () => new ExternalCredentialStore(bucket, ring, 'test'), test: connectionTest } });
async function call(path: string, method = 'GET', body?: object, who = '0', configuration = env) { return handler()(new Request('https://local.test/api/v1' + path, { method, headers: { Authorization: 'Bearer ' + who, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), configuration); }
const path = (w = wa) => `/workspaces/${w}`;
async function body(response: Response) { return response.json() as Promise<any>; }
beforeAll(async () => {
    runtime = new Miniflare({ ...convertV4MiniflareOptions({ modules: true, script: "export default {fetch(){return new Response('local')}}", compatibilityDate: '2026-10-22', d1Databases: ['DB'], r2Buckets: ['VAULT'] }), telemetry: { enabled: false } });
    db = await runtime.getD1Database('DB');
    const r2 = await runtime.getR2Bucket('VAULT');
    bucket = { get: async (key) => { const o = await r2.get(key); return o ? { size: o.size, etag: o.etag, json: () => o.json() } : null; }, put: (key, value, options) => r2.put(key, value, options) };
    env = { METADATA: db, BYODB_ALLOWED_DESTINATIONS: JSON.stringify([destination]), BYODB_VAULT_KEYS: ring, BYODB_VAULT_KEY_ID: 'test', TENANT_CREDENTIALS: bucket as R2Bucket };
    for (const name of ['0001_metadata.sql', '0002_neon_poc.sql', '0003_ai_workspace.sql', '0004_external_databases.sql', '0005_agent_workflows.sql','0007_mysql_databases.sql','0008_mysql_ai_context.sql'])
        await db.batch(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8').split(';').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
    for (let i = 0; i < users.length; i++)
        await db.prepare('INSERT INTO users(id,clerk_user_id) VALUES (?,?)').bind(users[i], 'clerk-' + i).run();
    await db.batch([db.prepare("INSERT INTO organizations(id,slug,name,created_by) VALUES ('org','org','Org',?)").bind(users[0]), ...users.map((u, i) => db.prepare("INSERT INTO memberships(id,organization_id,user_id,role) VALUES (?,'org',?,?)").bind('m' + i, u, i === 0 ? 'owner' : 'member')), db.prepare("INSERT INTO workspaces(id,organization_id,slug,name,created_by) VALUES (?,'org','a','A',?),(?,'org','b','B',?)").bind(wa, users[0], wb, users[0]), ...users.slice(1).map((u, i) => db.prepare('INSERT INTO workspace_memberships(id,workspace_id,user_id,role) VALUES (?,?,?,?)').bind('w' + i, wa, u, i === 0 ? 'admin' : 'viewer'))]);
    const ref = 'ai-openrouter/' + crypto.randomUUID();
    await new EncryptedAIKeys(bucket, ring, 'test').put(users[0], ref, secret);
    await db.prepare("INSERT INTO ai_provider_credentials(user_id,provider,credential_reference,status) VALUES (?,'openrouter',?,'active')").bind(users[0], ref).run();
}, 30000);
afterAll(async () => { await runtime?.dispose(); });
describe('BYODB constrained policy and encrypted storage; local D1/R2, mocked network validation', () => {
    it('rejects private, reserved, noncanonical and rebinding-style destinations', () => { for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '198.18.1.1', '203.0.113.2', '224.0.0.1', '0.0.0.0', '::1', '2130706433', '0177.0.0.1', '127.1', 'db.example.com', '8.8.8.999'])
        expect(publicIPv4(ip), ip).toBe(false); expect(publicIPv4('8.8.8.8')).toBe(true); for (const change of [{ address: '127.0.0.1' }, { port: 80 }, { hostname: 'https://db.example.com' }, { roles: ['postgres; DROP ROLE x'] }, { connectionString: 'forbidden' }])
        expect(() => destinations(JSON.stringify([{ ...destination, ...change }]))).toThrow(); expect(() => destinations(undefined)).toThrow(); });
    it('binds ciphertext to organization, workspace, connection and purpose; revokes', async () => { const store = new ExternalCredentialStore(bucket, ring, 'test'), scope = { organizationId: 'org', workspaceId: wa, connectionId: 'e'.repeat(32) }, ref = 'byodb-postgresql/' + crypto.randomUUID(); await store.put(scope, ref, secret); expect(await store.read(scope, ref)).toBe(secret); for (const altered of [{ ...scope, workspaceId: wb }, { ...scope, organizationId: 'other' }, { ...scope, connectionId: 'f'.repeat(32) }])
        await expect(store.read(altered, ref)).rejects.toThrow(); await expect(new ExternalCredentialStore(bucket, JSON.stringify({ test: randomBytes(32).toString('hex') }), 'test').read(scope, ref)).rejects.toThrow(); await store.revoke(scope, ref); await expect(store.read(scope, ref)).rejects.toThrow(); expect(() => externalStore({ METADATA: db })).toThrow(); });
    it('supports a retained old wrapping key and rejects tampered or missing ciphertext', async () => { const scope = { organizationId: 'org', workspaceId: wa, connectionId: 'd'.repeat(32) }, ref = 'byodb-postgresql/' + crypto.randomUUID(), original = new ExternalCredentialStore(bucket, ring, 'test'); await original.put(scope, ref, secret); const rotated = new ExternalCredentialStore(bucket, JSON.stringify({ ...JSON.parse(ring), next: randomBytes(32).toString('hex') }), 'next'); expect(await rotated.read(scope, ref)).toBe(secret); const objectPath = `external-credentials/${scope.connectionId}/${ref}.json`, object = (await bucket.get(objectPath))!, envelope = await object.json() as {
        ciphertext: string;
    }; envelope.ciphertext = (envelope.ciphertext.startsWith('00') ? '01' : '00') + envelope.ciphertext.slice(2); await bucket.put(objectPath, JSON.stringify(envelope), {onlyIf:{etagMatches:object.etag},httpMetadata:{contentType:"application/json"}}); await expect(rotated.read(scope, ref)).rejects.toThrow(); await expect(rotated.read(scope, 'byodb-postgresql/' + crypto.randomUUID())).rejects.toThrow(); });
    it('does not connect for invalid, cross-workspace or unauthorized requests', async () => { connectionTest.mockClear(); for (const [url, payload, who, status] of [[path() + '/external-connections', { name: 'X', destinationId: 'unapproved', database: 'customer', username: 'reader', schema: 'app', password: secret }, '0', 400], [path() + '/external-connections', { host: '127.0.0.1' }, '0', 400], [path() + '/external-connections', {}, '2', 403], [path(wb) + '/external-connections', {}, '2', 404]] as const) {
        const result = await call(url, 'POST', payload, who);
        expect(result.status).toBe(status);
        expect(await result.text()).not.toContain(secret);
    } expect(connectionTest).not.toHaveBeenCalled(); });
    it('validates then saves; never returns credentials; resolves only a pinned approved endpoint', async () => {
        const result = await call(path() + '/external-connections', 'POST', { name: 'External', destinationId: 'approved', database: 'customer', username: 'reader', schema: 'app', password: secret });
        expect(result.status).toBe(201);
        const id = (await body(result)).data.id;
        const row = (await db.prepare('SELECT * FROM external_databases WHERE id=?').bind(id).first<ExternalRow>())!;
        expect(JSON.stringify(row)).not.toContain(secret);
        const resolver = new ExternalResolver(env);
        const credential = await resolver.resolve(externalSource(row));
        expect(credential.host).toBe(destination.address);
        expect(credential.serverName).toBe(destination.hostname);
        expect(credential.password).toBe(secret);
        await expect(new ExternalResolver({ ...env, BYODB_ALLOWED_DESTINATIONS: JSON.stringify([{ ...destination, address: '8.8.4.4' }]) }).resolve(externalSource(row))).rejects.toThrow();
        expect(row.destination_digest).toBe(destinationDigest(destination));
        for (const suffix of ['/external-connections', '/databases']) {
            const listing = await call(path() + suffix);
            const text = await listing.text();
            expect(text).not.toContain(secret);
            expect(text).not.toContain(row.credential_reference);
        }
        expect((await call(path(wb) + `/databases/${id}/schemas`, 'GET', undefined, '1')).status).toBe(404);
        const rename = await call(path() + `/external-connections/${id}`, 'POST', { action: 'rename', name: 'Renamed', revision: 1 });
        expect(rename.status).toBe(200);
        expect((await call(path() + `/external-connections/${id}`, 'POST', { action: 'disconnect', revision: 1 })).status).toBe(409);
        expect((await call(path() + `/external-connections/${id}`, 'POST', { action: 'rotate', revision: 2, password: secret })).status).toBe(200);
        expect((await call(path() + `/external-connections/${id}`, 'POST', { action: 'disconnect', revision: 3 })).status).toBe(200);
        await expect(resolver.resolve(externalSource(row))).rejects.toThrow();
        expect((await db.prepare('SELECT status FROM connections WHERE id=?').bind(id).first<{
            status: string;
        }>())?.status).toBe('disabled');
    });
    it('sanitizes failed validation and does not persist invalid connections', async () => { connectionTest.mockRejectedValueOnce(unavailable()); const before = await db.prepare('SELECT count(*) AS n FROM external_databases').first(); const result = await call(path() + '/external-connections', 'POST', { name: 'Failure', destinationId: 'approved', database: 'customer', username: 'reader', schema: 'app', password: secret }); expect(result.status).toBe(503); expect(await result.text()).not.toContain(secret); expect(await db.prepare('SELECT count(*) AS n FROM external_databases').first()).toEqual(before); });
    it('marks MySQL unavailable without fabricated connectivity', async () => { await expect(new UnavailableMySQLAdapter().test()).rejects.toMatchObject({ status: 501 }); });
});
describe('Agents: real D1 persistence, mocked Clerk/provider/SQL', () => {
    let agent = '';
    const config = { name: 'Analyst', template: 'schema-analyst', instructions: 'Explain safely', model: 'test/model', databaseId: null, maxSteps: 2, deadlineSeconds: 10, allowRows: false };
    it('validates limits and scopes definitions to their owner and workspace', async () => { for (const change of [{ maxSteps: 0 }, { maxSteps: 9 }, { deadlineSeconds: 0 }, { deadlineSeconds: 121 }, { template: 'admin' }, { databaseId: 'f'.repeat(32) }])
        expect((await call(path() + '/agents', 'POST', { ...config, ...change })).status).toBe(change.databaseId ? 404 : 400); const r = await call(path() + '/agents', 'POST', config); expect(r.status).toBe(201); agent = (await body(r)).data.id; expect((await body(await call(path() + '/agents'))).data).toHaveLength(1); expect((await body(await call(path() + '/agents', 'GET', undefined, '1'))).data).toHaveLength(0); expect((await call(path(wb) + `/agents/${agent}`, 'POST', config)).status).toBe(404); expect((await call(path() + `/agents/${agent}`, 'POST', config, '1')).status).toBe(404); });
    it('persists model steps, usage, final status and run history', async () => { mode = 'normal'; calls = 0; const response = await call(path() + `/agents/${agent}/run`, 'POST', { goal: 'Explain selected schema' }); expect(response.headers.get('Content-Type')).toBe('text/event-stream'); const text = await response.text(); expect(text).toContain('event: complete'); expect(text).not.toContain(secret); expect(calls).toBe(1); const list = (await body(await call(path() + '/agent-runs'))).data; expect(list[0].status).toBe('completed'); const detail = (await body(await call(path() + `/agent-runs/${list[0].id}`))).data; expect(detail.steps.some((s: any) => s.kind === 'model')).toBe(true); expect(detail.run.usage.totalTokens).toBe(3); expect(detail.messages.at(-1).content).toBe('Fixture answer'); expect((await call(path() + `/agent-runs/${list[0].id}`, 'GET', undefined, '1')).status).toBe(404); expect((await call(path(wb) + `/agent-runs/${list[0].id}`)).status).toBe(404); });
    it('enforces bounded loops and records tool traces', async () => { mode = 'loop'; calls = 0; const response = await call(path() + `/agents/${agent}/run`, 'POST', { goal: 'Loop fixture' }); await response.text(); expect(calls).toBe(2); const row = (await body(await call(path() + '/agent-runs'))).data[0]; expect(row.status).toBe('failed'); expect(row.errorCode).toBe('AI_TOOL_LIMIT'); const detail = (await body(await call(path() + `/agent-runs/${row.id}`))).data; expect(detail.steps.filter((s: any) => s.kind === 'model')).toHaveLength(2); expect(detail.steps.some((s: any) => s.kind === 'tool')).toBe(true); mode = 'normal'; });
    it('cancels before further tool/model execution and persists cancellation', async () => { mode = 'normal'; calls = 0; afterModel = async () => { const current = (await body(await call(path() + '/agent-runs'))).data[0]; expect((await call(path() + `/agent-runs/${current.id}/cancel`, 'POST', {})).status).toBe(200); }; await (await call(path() + `/agents/${agent}/run`, 'POST', { goal: 'Cancel fixture' })).text(); afterModel = null; const current = (await body(await call(path() + '/agent-runs'))).data[0]; expect(current.status).toBe('cancelled'); expect(calls).toBe(1); });
    it('validates tool arguments, template allowlists, row opt-in and cross-workspace access', async () => { const tools = new AuthorizedAITools(env, { transport }, { workspaceId: wa, userId: users[0], databaseId: null, allowRows: false }, 'test', { allowed: ['list_databases', 'preview_table'] }); transport.read.mockClear(); for (const [name, args] of [['execute_sql', '{}'], ['list_databases', JSON.stringify({ workspaceId: wb })], ['preview_table', JSON.stringify({ table: 'x' })], ['list_tables', '{}']])
        await expect(tools.execute(name, args)).rejects.toThrow(); expect(transport.read).not.toHaveBeenCalled(); });
    it('enforces persisted execution deadlines before continuing', async () => { mode = 'normal'; calls = 0; afterModel = async () => { await db.prepare("UPDATE agent_runs SET deadline_at=? WHERE status='running'").bind(Date.now() - 1).run(); }; await (await call(path() + `/agents/${agent}/run`, 'POST', { goal: 'Deadline fixture' })).text(); afterModel = null; const current = (await body(await call(path() + '/agent-runs'))).data[0]; expect(current.status).toBe('cancelled'); expect(current.errorCode).toBe('AGENT_DEADLINE'); expect(calls).toBe(1); });
    it('stops immediately when tool trace persistence fails',async()=>{
        mode='loop';calls=0;
        await db.prepare("CREATE TRIGGER cp5_trace_failure BEFORE INSERT ON agent_run_steps WHEN json_extract(NEW.detail_json,'$.kind')='tool' BEGIN SELECT RAISE(ABORT,'local trace failure'); END").run();
        try {await (await call(path()+`/agents/${agent}/run`,'POST',{goal:'Trace failure fixture'})).text();const current=(await body(await call(path()+'/agent-runs'))).data[0];expect(current.status).toBe('failed');expect(current.errorCode).toBe('AI_TRACE_UNAVAILABLE');expect(calls).toBe(1);}
        finally{await db.prepare('DROP TRIGGER cp5_trace_failure').run();mode='normal';}
    });
    it('retains history after soft deletion and rejects new invocations', async () => { expect((await call(path() + `/agents/${agent}`, 'POST', { action: 'delete' })).status).toBe(200); expect((await body(await call(path() + '/agents'))).data).toHaveLength(0); expect((await call(path() + `/agents/${agent}/run`, 'POST', { goal: 'No' })).status).toBe(404); expect((await body(await call(path() + '/agent-runs'))).data.length).toBeGreaterThan(0); });
});
describe('Workspace memberships and explicit D1 authority', () => {
    it('lists roles, audits allowed changes, blocks viewers and admin privilege escalation', async () => { const list = await body(await call(path() + '/members')); expect(list.authority).toBe('d1'); expect(list.clerkOrganizationSync).toBe('not-linked'); expect(list.invitations.available).toBe(false); expect((await call(path() + `/members/${users[2]}`, 'POST', { role: 'member' }, '2')).status).toBe(403); for (const role of ['admin', 'owner'])
        expect((await call(path() + `/members/${users[2]}`, 'POST', { role }, '1')).status).toBe(403); expect((await call(path() + `/members/${users[2]}`, 'POST', { role: 'member' }, '1')).status).toBe(200); expect((await db.prepare("SELECT count(*) AS n FROM audit_events WHERE action='member.role'").first<{
        n: number;
    }>())!.n).toBeGreaterThan(0); expect((await call(path() + `/members/${users[0]}`, 'POST', { action: 'remove' })).status).toBe(409); });
    it('removes assignments, hides unassigned candidates from readers and denies access immediately', async () => { expect((await call(path() + `/members/${users[3]}`, 'POST', { action: 'remove' })).status).toBe(200); expect((await call(path() + '/members', 'GET', undefined, '3')).status).toBe(404); const reader = await body(await call(path() + '/members', 'GET', undefined, '2')); expect(reader.data.some((m: any) => m.id === users[3])).toBe(false); });
    it('fails closed if Clerk organization consistency is required but not configured', async () => { for (const suffix of ['/members', '/agents', '/databases'])
        expect((await call(path() + suffix, 'GET', undefined, '0', { ...env, WORKSPACE_MEMBERSHIP_MODE: 'clerk' })).status).toBe(503); });
    it('prevents concurrent removal/demotion of all remaining workspace owners', async () => { await db.prepare("UPDATE memberships SET role='member' WHERE user_id=?").bind(users[0]).run(); await db.batch([db.prepare("INSERT INTO workspace_memberships(id,workspace_id,user_id,role) VALUES ('owner0',?,?,'owner')").bind(wa, users[0]), db.prepare("UPDATE workspace_memberships SET role='owner' WHERE workspace_id=? AND user_id=?").bind(wa, users[1])]); const results = await Promise.all([call(path() + `/members/${users[0]}`, 'POST', { role: 'viewer' }, '0'), call(path() + `/members/${users[1]}`, 'POST', { action: 'remove' }, '1')]); expect(results.map(r => r.status).sort()).toEqual([200, 409]); expect((await db.prepare("SELECT count(*) AS n FROM workspace_memberships WHERE workspace_id=? AND role='owner'").bind(wa).first<{
        n: number;
    }>())!.n).toBe(1); });
});
