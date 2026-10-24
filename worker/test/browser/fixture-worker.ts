// Test entry point only. Never referenced by application or deployment configs.
// Real Clerk, D1, R2 and database services; deterministic provider, no OpenRouter traffic.
import { createHandler } from '../../src/index';
import { verifySession } from '../../src/auth';
import { aiKeyStore } from '../../src/ai/credentials';
import { ApiError } from '../../src/errors';
import type { AIProvider } from '../../src/ai/contracts';

const fixtureKey = 'cp8c-fixture-only-not-an-api-key';
const models = ['cp8c/fixture', 'cp8c/alternate'].map(id => ({
  id, name: `MOCKED PROVIDER · ${id}`, contextLength: 16000, tools: true,
  pricing: { prompt: '0', completion: '0' },
}));
const provider: AIProvider = {
  async validate(key) { if (key !== fixtureKey) throw new ApiError(401, 'AI_INVALID_KEY', 'Fixture credential rejected.'); },
  async models(key) { await this.validate(key); return models; },
  async complete(key, _model, messages, _tools, signal, onDelta) {
    await this.validate(key);
    let userIndex = messages.length - 1;
    while (userIndex >= 0 && messages[userIndex].role !== 'user') userIndex--;
    const last = messages[userIndex]?.content ?? '';
    if (last.includes('fixture:error')) throw new ApiError(429, 'AI_RATE_LIMIT', 'Deterministic fixture rate limit.');
    if (last.includes('fixture:wait')) {
      for (let i = 0; i < 150; i++) {
        if (signal?.aborted) throw new ApiError(499, 'AI_CANCELLED', 'Fixture cancelled.');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    const hasTool = messages.slice(userIndex + 1).some(m => m.role === 'tool');
    if (!hasTool || last.includes('fixture:loop')) return {
      content: '', toolCalls: [{ id: crypto.randomUUID(), type: 'function', function: { name: 'list_databases', arguments: '{}' } }],
      usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
    };
    const content = 'MOCKED PROVIDER acceptance response. SQL proposal for human review only.\n```sql\nSELECT id, name FROM tenant_data.items LIMIT 2\n```';
    onDelta?.('MOCKED PROVIDER acceptance response. ');
    await new Promise(resolve => setTimeout(resolve, 300));
    onDelta?.(content.slice('MOCKED PROVIDER acceptance response. '.length));
    return { content, toolCalls: [], usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 } };
  },
};
const handler = createHandler(verifySession, undefined, { provider, credentials: aiKeyStore });
export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) return new Response('Local fixture only.', { status: 503 });
    return handler(request, env, context);
  },
};
