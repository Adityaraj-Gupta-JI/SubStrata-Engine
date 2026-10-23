import { platformGet, platformPost, platformStream } from './platform';
import type { AIMessage } from './ai';
export interface Agent {
    id: string;
    name: string;
    template: string;
    instructions: string;
    model: string;
    databaseId: string | null;
    maxSteps: number;
    deadlineSeconds: number;
    allowRows: boolean;
}
export interface AgentTemplate {
    id: string;
    name: string;
    goal: string;
    tools: string[];
}
export interface AgentStep {
    sequence: number;
    kind: string;
    name: string;
    status: string;
    elapsedMs: number;
    usage?: {
        totalTokens: number;
    };
    errorCode?: string;
}
export interface AgentRun {
    id: string;
    agentId: string;
    conversationId: string;
    goal: string;
    status: string;
    errorCode: string | null;
    usage: {
        totalTokens: number;
    } | null;
    createdAt: string;
    finishedAt: string | null;
}
export interface Destination {
    id: string;
    hostname: string;
    databases: string[];
    roles: string[];
    schemas: string[];
}
export interface ExternalConnection {
    id: string;
    name: string;
    engine: string;
    destinationId: string;
    databaseName: string;
    username: string;
    schema: string;
    state: string;
    checkedAt: string | null;
    revision: number;
    error: string | null;
}
export interface WorkspaceMember {
    id: string;
    display_name: string | null;
    email: string | null;
    organizationRole: string;
    role: string | null;
    inherited: number;
    assignmentId: string | null;
}
const root = (w: string) => `/workspaces/${encodeURIComponent(w)}`;
export const cp5Api = {
    agents: (w: string, t: string) => platformGet<{
        data: Agent[];
        templates: AgentTemplate[];
    }>(`${root(w)}/agents`, t),
    saveAgent: (w: string, t: string, value: Omit<Agent, 'id'>, id?: string) => platformPost<{
        data: {
            id: string;
        };
    }>(`${root(w)}/agents${id ? `/${encodeURIComponent(id)}` : ''}`, t, value),
    deleteAgent: (w: string, t: string, id: string) => platformPost(`${root(w)}/agents/${encodeURIComponent(id)}`, t, { action: 'delete' }),
    runAgent: (w: string, t: string, id: string, goal: string, onDelta: (text: string) => void, signal: AbortSignal, onEvent: (type: string, data: unknown) => void) => platformStream<{
        runId: string;
        status: string;
        conversationId: string;
        messages: AIMessage[];
    }>(`${root(w)}/agents/${encodeURIComponent(id)}/run`, t, { goal }, onDelta, signal, onEvent),
    runs: (w: string, t: string) => platformGet<{
        data: AgentRun[];
    }>(`${root(w)}/agent-runs`, t),
    run: (w: string, t: string, id: string) => platformGet<{
        data: {
            run: AgentRun;
            steps: AgentStep[];
            messages: AIMessage[];
        };
    }>(`${root(w)}/agent-runs/${encodeURIComponent(id)}`, t),
    cancel: (w: string, t: string, id: string) => platformPost(`${root(w)}/agent-runs/${encodeURIComponent(id)}/cancel`, t, {}),
    connections: (w: string, t: string) => platformGet<{
        data: ExternalConnection[];
        canManage: boolean;
        mysql: {
            available: boolean;
            reason: string;
        };
    }>(`${root(w)}/external-connections`, t),
    destinations: (w: string, t: string) => platformGet<{
        data: Destination[];
    }>(`${root(w)}/external-connections/destinations`, t),
    connection: (w: string, t: string, value: Record<string, unknown>, id?: string) => platformPost<{
        data: {
            id?: string;
            validated?: boolean;
            disconnected?: boolean;
            saved?: boolean;
        };
    }>(`${root(w)}/external-connections${id ? `/${encodeURIComponent(id)}` : ''}`, t, value),
    members: (w: string, t: string) => platformGet<{
        data: WorkspaceMember[];
        canManage: boolean;
        role: string;
        authority: string;
        clerkOrganizationSync: string;
        invitations: {
            available: boolean;
            reason: string;
        };
    }>(`${root(w)}/members`, t),
    member: (w: string, t: string, userId: string, body: {
        role?: string;
        action?: string;
    }) => platformPost(`${root(w)}/members/${encodeURIComponent(userId)}`, t, body),
};
