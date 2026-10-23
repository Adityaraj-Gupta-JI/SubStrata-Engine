"use client";
import { useEffect, useRef, useState } from "react";
import { aiApi } from "@/lib/api/ai";
import { aiButton, aiError, aiInput, ModelSelector, useAIProvider } from "./AIProviderState";
import type { useDatabaseWorkspace } from "./DatabaseWorkspace";
export function SQLAssistance({ workspace, onDraft }: {
    workspace: ReturnType<typeof useDatabaseWorkspace>;
    onDraft: (sql: string) => void;
}) {
    const provider = useAIProvider();
    const [prompt, setPrompt] = useState(""), [model, setModel] = useState(""), [busy, setBusy] = useState(false), [answer, setAnswer] = useState(""), [error, setError] = useState("");
    const controller = useRef<AbortController | null>(null);
    useEffect(() => () => controller.current?.abort(), []);
    async function generate() {
        setBusy(true);
        setError("");
        setAnswer("");
        controller.current = new AbortController();
        try {
            const token = await workspace.token(), conversation = await aiApi.create(workspace.workspaceId, token, { databaseId: workspace.databaseId, model: model || provider.state?.defaultModel || "", title: "SQL assistance", allowRows: false });
            const result = await aiApi.send(workspace.workspaceId, conversation.data.id, token, `Propose one read-only SELECT using the actual selected schema, explain it, and put it in a sql code fence. Do not execute it. Request: ${prompt}`, controller.current.signal);
            const message = result.data.messages.filter(m => m.role === "assistant").at(-1);
            if (!message || message.status !== "completed")
                throw new Error(message?.content || "SQL generation did not complete.");
            setAnswer(message.content);
            if (message.proposedSql)
                onDraft(message.proposedSql);
            else
                setError("The response contained no permitted SELECT proposal. Refine the request or review it in chat.");
        }
        catch (error) {
            setError(aiError(error));
        }
        finally {
            setBusy(false);
        }
    }
    return <details className="space-y-3 border-t border-[#2a3047] pt-4"><summary>AI SQL assistance · manual execution only</summary><ModelSelector id="sql-ai-model" models={provider.models} value={model || provider.state?.defaultModel || ""} onChange={setModel} disabled={busy}/><label htmlFor="sql-ai-prompt" className="block">Describe the read-only query</label><textarea id="sql-ai-prompt" rows={3} maxLength={4000} className={aiInput} value={prompt} onChange={e => setPrompt(e.target.value)}/><button type="button" className={aiButton} disabled={busy || !prompt.trim() || workspace.database?.state !== "active" || !provider.state?.configured || !(model || provider.state.defaultModel)} onClick={() => void generate()}>{busy ? "Generating…" : "Generate / regenerate SQL draft"}</button>{busy && <button type="button" className={aiButton} onClick={() => controller.current?.abort()}>Cancel generation</button>}{(error || provider.error) && <p role="alert">{error || provider.error}</p>}{answer && <p className="whitespace-pre-wrap text-sm">{answer}</p>}<p className="text-xs text-[#8b9bb4]">Uses actual authorized schema when available. Generation is saved as a conversation. Execution still requires the editor button.</p></details>;
}
