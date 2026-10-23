export interface Model {
    id: string;
    name: string;
    contextLength: number;
    tools: boolean;
    pricing: {
        prompt: string;
        completion: string;
    };
}
export interface ToolCall {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
}
export interface ChatMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_call_id?: string;
    tool_calls?: ToolCall[];
}
export interface Usage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}
export interface Completion {
    content: string;
    toolCalls: ToolCall[];
    usage: Usage | null;
}
export interface ToolDefinition {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: object;
    };
}
export interface AIProvider {
    validate(key: string, signal?: AbortSignal): Promise<void>;
    models(key: string, signal?: AbortSignal): Promise<Model[]>;
    complete(key: string, model: string, messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal, onDelta?: (text: string) => void): Promise<Completion>;
}
export interface Trace {
    tool: string;
    status: "success" | "denied" | "unavailable";
    elapsedMs: number;
}
export interface StoredMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    status: string;
    proposedSql: string | null;
    usage: Usage | null;
    trace: Trace[];
    errorCode: string | null;
    createdAt: string;
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
