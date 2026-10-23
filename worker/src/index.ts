import {agentRoute} from "./agents/routes";
import {membershipRoute} from "./access/routes";
import {externalRoute} from "./byodb/routes";
import type {ExternalServices} from "./byodb/service";
import { aiRoute, type AIServices } from "./ai/routes";
import { verifySession, type SessionIdentity } from "./auth";
import { ApiError, badRequest, json, notFound, unavailable } from "./errors";
import {
  createOrganization, createWorkspace, getOrganization, listConnections,
  listOrganizations, listWorkspaces, resolveUser, workspaceAccess,
} from "./metadata";
import { nameAndSlug, pagination, uuid } from "./validation";
import { databaseRoute, defaultDatabaseServices, type DatabaseServices } from "./database/gateway";

export type Authenticator = (request: Request, env: Env) => Promise<SessionIdentity>;

function cors(request: Request, env: Env, response: Response): Response {
  const origin = request.headers.get("Origin");
  if (origin && env.FRONTEND_ORIGIN && origin === env.FRONTEND_ORIGIN) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.headers.set("Vary", "Origin");
  }
  return response;
}

async function route(request: Request, env: Env, requestId: string, authenticate: Authenticator, databases?: DatabaseServices, ai?: AIServices, context?: ExecutionContext,platform?:{external?:ExternalServices}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (method === "GET" && path === "/api/v1/health") {
    return json({ status: "ok", requestId }, 200, requestId);
  }
  if (!path.startsWith("/api/v1/")) throw notFound();
  if (!env.METADATA) throw unavailable();
  const identity = await authenticate(request, env);
  if(env.WORKSPACE_MEMBERSHIP_MODE!==undefined&&env.WORKSPACE_MEMBERSHIP_MODE!=="d1")throw unavailable();
  const user = await resolveUser(env.METADATA, identity.clerkUserId);
  const db = env.METADATA;
  if(/^\/api\/v1\/workspaces\/[^/]+\/(agents|agent-runs)(?:\/|$)/.test(path)){const response=await agentRoute(request,env,user.id,requestId,databases,ai,context);if(response)return response;}
  if(/^\/api\/v1\/workspaces\/[^/]+\/external-connections(?:\/|$)/.test(path)){const response=await externalRoute(request,env,user.id,requestId,platform?.external);if(response)return response;}
  if(/^\/api\/v1\/workspaces\/[^/]+\/members(?:\/|$)/.test(path)){const response=await membershipRoute(request,env,user.id,requestId);if(response)return response;}

  if (path.startsWith("/api/v1/ai/") || /^\/api\/v1\/workspaces\/[^/]+\/ai\//.test(path)) {
    const response=await aiRoute(request,env,user.id,requestId,databases,ai,context);
    if(response)return response;
  }
  if (path.match(/^\/api\/v1\/workspaces\/[^/]+\/databases(?:\/|$)/)) {
    const response = await databaseRoute(request, env, user.id, requestId, databases ?? defaultDatabaseServices(env, request));
    if (response) return response;
  }

  if (method === "GET" && path === "/api/v1/auth/session") {
    return json({ user: { id: user.id }, session: { authenticated: true }, requestId }, 200, requestId);
  }
  if (path === "/api/v1/organizations") {
    if (method === "GET") {
      const { limit, offset } = pagination(url);
      return json({ data: await listOrganizations(db, user.id, limit, offset), page: { limit, offset }, requestId }, 200, requestId);
    }
    if (method === "POST") {
      const { name, slug } = await nameAndSlug(request);
      return json({ data: await createOrganization(db, user.id, name, slug, requestId), requestId }, 201, requestId);
    }
  }
  const org = path.match(/^\/api\/v1\/organizations\/([^/]+)$/);
  if (org && method === "GET") {
    return json({ data: await getOrganization(db, uuid(org[1]), user.id), requestId }, 200, requestId);
  }
  const orgWorkspaces = path.match(/^\/api\/v1\/organizations\/([^/]+)\/workspaces$/);
  if (orgWorkspaces) {
    const organizationId = uuid(orgWorkspaces[1]);
    if (method === "GET") {
      const { limit, offset } = pagination(url);
      return json({ data: await listWorkspaces(db, organizationId, user.id, limit, offset), page: { limit, offset }, requestId }, 200, requestId);
    }
    if (method === "POST") {
      const { name, slug } = await nameAndSlug(request);
      return json({ data: await createWorkspace(db, organizationId, user.id, name, slug, requestId), requestId }, 201, requestId);
    }
  }
  const workspace = path.match(/^\/api\/v1\/workspaces\/([^/]+)$/);
  if (workspace && method === "GET") {
    const result = await workspaceAccess(db, uuid(workspace[1]), user.id);
    return json({ data: result.workspace, role: result.role, requestId }, 200, requestId);
  }
  const connections = path.match(/^\/api\/v1\/workspaces\/([^/]+)\/connections$/);
  if (connections && method === "GET") {
    const { limit, offset } = pagination(url);
    return json({ data: await listConnections(db, uuid(connections[1]), user.id, limit, offset), page: { limit, offset }, requestId }, 200, requestId);
  }
  if (path.endsWith("/connections") && method === "POST") {
    throw new ApiError(501, "NOT_IMPLEMENTED", "Connection creation is not available.");
  }
  if (method === "POST" && path === "/api/v1/execute-sql") {
    throw new ApiError(501, "NOT_IMPLEMENTED", "SQL execution is not available.");
  }
  throw notFound();
}

export function createHandler(authenticate: Authenticator = verifySession, databases?: DatabaseServices, ai?: AIServices,platform?:{external?:ExternalServices}) {
  return async (request: Request, env: Env, context?: ExecutionContext): Promise<Response> => {
    const requestId = crypto.randomUUID();
    if (request.method === "OPTIONS") {
      const origin = request.headers.get("Origin");
      if (!origin || !env.FRONTEND_ORIGIN || origin !== env.FRONTEND_ORIGIN) {
        return json({ error: { code: "FORBIDDEN", message: "Origin denied.", requestId } }, 403, requestId);
      }
      return cors(request, env, new Response(null, { status: 204, headers: { "X-Request-Id": requestId } }));
    }
    try {
      return cors(request, env, await route(request, env, requestId, authenticate, databases, ai, context,platform));
    } catch (error) {
      if (error instanceof ApiError) {
        return cors(request, env, json({ error: { code: error.code, message: error.publicMessage, requestId } }, error.status, requestId));
      }
      console.error(JSON.stringify({ event: "request_failed", requestId, path: new URL(request.url).pathname }));
      return cors(request, env, json({ error: { code: "INTERNAL_ERROR", message: "Internal server error.", requestId } }, 500, requestId));
    }
  };
}

export default {
  fetch: createHandler(),
} satisfies ExportedHandler<Env>;
