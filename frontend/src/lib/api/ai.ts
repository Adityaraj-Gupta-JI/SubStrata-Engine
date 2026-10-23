import { platformGet, platformPost, platformStream } from "./platform";
export interface AIModel {
    id: string;
    name: string;
    contextLength: number;
    tools: boolean;
    pricing: {
        prompt: string;
        completion: string;
    };
}
export interface AIProviderState {
    provider: string;
    configured: boolean;
    storageConfigured: boolean;
    defaultModel: string | null;
}
export interface Conversation {
    id: string;
    workspaceId: string;
    databaseId: string | null;
    title: string;
    model: string;
    busy: boolean;
    updatedAt: string;
}
export interface AIMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    status: string;
    proposedSql: string | null;
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    } | null;
    trace: {
        tool: string;
        status: string;
        elapsedMs: number;
    }[];
    errorCode: string | null;
    createdAt: string;
}
export interface Activity {
    id: string;
    action: string;
    resource_type: string;
    resource_id: string;
    outcome: string;
    created_at: string;
}
const root = (workspace: string) => `/workspaces/${encodeURIComponent(workspace)}/ai`;
const item = (workspace: string, id: string) => `${root(workspace)}/conversations/${encodeURIComponent(id)}`;
export const aiApi = {
    provider: (token: string) => platformGet<{
        data: AIProviderState;
    }>("/ai/providers/openrouter", token),
    credential: (token: string, body: {
        action: "save" | "validate";
        key: string;
    } | {
        action: "revoke";
    } | {
        action: "preferences";
        model: string;
    }) => platformPost<{
        data: {
            configured?: boolean;
            valid?: boolean;
            revoked?: boolean;
            defaultModel?: string;
        };
    }>("/ai/providers/openrouter", token, body),
    models: (token: string) => platformGet<{
        data: AIModel[];
    }>("/ai/models", token),
    list: (workspace: string, token: string) => platformGet<{
        data: Conversation[];
    }>(`${root(workspace)}/conversations`, token),
    create: (workspace: string, token: string, body: {
        model: string;
        databaseId: string | null;
        title: string;
        allowRows: boolean;
    }) => platformPost<{
        data: Conversation;
    }>(`${root(workspace)}/conversations`, token, body),
    get: (workspace: string, id: string, token: string) => platformGet<{
        data: {
            conversation: Conversation;
            messages: AIMessage[];
        };
    }>(item(workspace, id), token),
    send: (workspace: string, id: string, token: string, content: string, signal?: AbortSignal) => platformPost<{
        data: {
            messages: AIMessage[];
            status: string;
        };
    }>(`${item(workspace, id)}/messages`, token, { content }, signal),
    sendStream: (workspace: string, id: string, token: string, content: string, onDelta: (text: string) => void, signal?: AbortSignal) => platformStream<{
        messages: AIMessage[];
        status: string;
    }>(`${item(workspace, id)}/messages`, token, { content, stream: true }, onDelta, signal),
    activity: (workspace: string, token: string) => platformGet<{
        data: Activity[];
    }>(`${root(workspace)}/activity`, token),
};
