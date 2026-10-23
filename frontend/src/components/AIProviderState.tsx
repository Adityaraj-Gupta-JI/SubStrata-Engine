"use client";
import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";
import { aiApi, type AIModel, type AIProviderState } from "@/lib/api/ai";
import { platformToken } from "@/lib/api/platform";
export const aiPanel = "space-y-4 rounded-xl border border-[#2a3047] bg-[#0d0e17] p-5";
export const aiButton = "rounded border border-[#2a3047] px-3 py-2 text-sm hover:bg-[#1a1e30] disabled:opacity-50 disabled:cursor-not-allowed";
export const aiInput = "w-full rounded border border-[#2a3047] bg-[#131522] p-3";
export const aiError = (value: unknown) => value instanceof Error ? value.message : "AI request failed.";
export function useAIProvider() {
    const { getToken } = useAuth();
    const [state, setState] = useState<AIProviderState | null>(null), [models, setModels] = useState<AIModel[]>([]), [error, setError] = useState(""), [loading, setLoading] = useState(true);
    const token = useCallback(() => platformToken(getToken), [getToken]);
    const refresh = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const auth = await token(), response = await aiApi.provider(auth);
            setState(response.data);
            if (response.data.configured && response.data.storageConfigured)
                setModels((await aiApi.models(auth)).data);
            else
                setModels([]);
        }
        catch (error) {
            setError(aiError(error));
        }
        finally {
            setLoading(false);
        }
    }, [token]);
    useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
    return { state, models, error, loading, refresh, token };
}
export function ModelSelector({ models, value, onChange, disabled, id = "ai-model" }: {
    models: AIModel[];
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    id?: string;
}) {
    const model = models.find(m => m.id === value);
    return <div className="space-y-2"><label htmlFor={id} className="block text-sm">OpenRouter model</label><select id={id} className={aiInput} value={value} disabled={disabled || !models.length} onChange={e => onChange(e.target.value)}><option value="">Choose a model</option>{models.map(m => <option key={m.id} value={m.id}>{m.name} ({m.id})</option>)}</select>{model && <p className="text-xs text-[#8b9bb4]">Context: {model.contextLength.toLocaleString()} tokens · Prompt/completion price per token: {model.pricing.prompt} / {model.pricing.completion} · {model.tools ? "Tool calling supported" : "Text-only assistance"}</p>}</div>;
}
