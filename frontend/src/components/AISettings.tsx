"use client";
import { useState, type FormEvent } from "react";
import { aiApi } from "@/lib/api/ai";
import { RouteShell } from "./RouteShell";
import { aiButton, aiError, aiInput, aiPanel, ModelSelector, useAIProvider } from "./AIProviderState";
export function AISettings() {
    const provider = useAIProvider();
    const [key, setKey] = useState(""), [model, setModel] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
    async function credential(action: "save" | "validate" | "revoke") {
        setBusy(true);
        setError("");
        setNotice("");
        const submitted = key;
        setKey("");
        try {
            const result = await aiApi.credential(await provider.token(), action === "revoke" ? { action } : { action, key: submitted });
            if (result.data.valid)
                setNotice("OpenRouter validated this key. It was not saved.");
            if (result.data.configured)
                setNotice("Key validated and stored encrypted.");
            if (result.data.revoked)
                setNotice("SubStrata access to this key was revoked. Revoke the key at OpenRouter too if it may have been exposed.");
            await provider.refresh();
        }
        catch (error) {
            setError(aiError(error));
        }
        finally {
            setBusy(false);
        }
    }
    async function preference(e: FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
            await aiApi.credential(await provider.token(), { action: "preferences", model: model || provider.state?.defaultModel || "" });
            setNotice("Default model saved.");
            await provider.refresh();
        }
        catch (error) {
            setError(aiError(error));
        }
        finally {
            setBusy(false);
        }
    }
    return <RouteShell title="AI settings" description="Your own OpenRouter key. Requests run through the authorized backend; credentials are never returned after submission."><div className={aiPanel}>
    {provider.loading && <p role="status">Loading AI settings…</p>}{(error || provider.error) && <p role="alert" className="text-[#ff8da8]">{error || provider.error}</p>}{notice && <p role="status">{notice}</p>}
    {provider.state && !provider.state.storageConfigured && <div id="ai-storage-setup" role="status" className="space-y-2"><p>The OpenRouter key field is locked because secure credential storage is not configured on the API.</p><p>For local development, configure <code>AI_VAULT_KEYS</code> and <code>AI_VAULT_KEY_ID</code> privately in <code>worker/.dev.vars</code>, with the <code>TENANT_CREDENTIALS</code> R2 binding. The keyring must map the matching key ID to a cryptographically random 64-character lowercase hexadecimal encryption key. Never put these values in frontend variables or paste them into chat.</p><p>Restart the local API, then refresh setup. Your OpenRouter key is a separate provider credential; enter it here only after the field unlocks.</p><button type="button" className={aiButton} disabled={busy || provider.loading} onClick={() => void provider.refresh()}>Refresh secure storage setup</button></div>}
    <p>OpenRouter: {provider.state?.configured ? "Key configured" : "No active key"}</p>
    <form onSubmit={e => { e.preventDefault(); void credential("save"); }} className="space-y-3"><label className="block" htmlFor="openrouter-key">{provider.state?.configured ? "Replace OpenRouter key" : "OpenRouter key"}</label><input id="openrouter-key" type="password" autoComplete="new-password" spellCheck={false} maxLength={512} className={aiInput} value={key} onChange={e => setKey(e.target.value)} disabled={busy || !provider.state?.storageConfigured} aria-describedby={provider.state && !provider.state.storageConfigured ? "ai-storage-setup" : undefined}/><div className="flex flex-wrap gap-3"><button type="submit" className={aiButton} disabled={busy || !key || !provider.state?.storageConfigured}>Validate and save encrypted</button><button type="button" className={aiButton} disabled={busy || !key || !provider.state?.storageConfigured} onClick={() => void credential("validate")}>Validate only</button><button type="button" className={aiButton} disabled={busy || !provider.state?.configured} onClick={() => void credential("revoke")}>Revoke SubStrata access</button></div></form>
    <form onSubmit={preference} className="space-y-3"><ModelSelector models={provider.models} value={model || provider.state?.defaultModel || ""} onChange={setModel} disabled={busy}/><div className="flex gap-3"><button className={aiButton} disabled={busy || !provider.state?.configured || !provider.state.storageConfigured || !(model || provider.state.defaultModel)}>Save default model</button><button type="button" className={aiButton} disabled={busy || provider.loading} onClick={() => void provider.refresh()}>Refresh models</button></div></form>
    <p className="text-sm text-[#8b9bb4]">Your key stays in memory until submission, then is cleared. OpenRouter may bill requests against your account. Schema context is sent only for your selected database; row previews require a separate conversation opt-in.</p>
  </div></RouteShell>;
}
