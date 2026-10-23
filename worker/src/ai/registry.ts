import { badRequest } from "../errors";
import type { AIProvider, Model } from "./contracts";
export class ModelRegistry {
    constructor(private readonly provider: AIProvider) { }
    async list(key: string, signal?: AbortSignal): Promise<Model[]> {
        const rows = await this.provider.models(key, signal);
        return [...new Map(rows.map(row => [row.id, row])).values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    async select(key: string, id: string, signal?: AbortSignal) {
        const model = (await this.list(key, signal)).find(row => row.id === id);
        if (!model)
            throw badRequest("Selected model is unavailable. Choose another model.");
        return model;
    }
    // Conservative character cap, not a tokenizer or a guarantee of provider
    // token counts. Provider context-limit failures still return controlled errors.
    inputBudget(model: Model) { return Math.max(2000, Math.min(36000, (model.contextLength || 16000) * 2 - 4000)); }
}
