import { Hono } from 'hono';
import { listOpenAiModels, resolveOpenAiEndpoint, testOpenAiConnection } from '../ai/openai';
import {
  disconnectOpenCode,
  generateOpenCodeText,
  openCodeSignInStatus,
  openCodeStatus,
  startOpenCodeSignIn,
} from '../ai/opencode';

/** Settings helpers for OpenAI-compatible LLMs: list the server's models and test a chat call. */
export const aiRoutes = new Hono();

function endpointOverrides(body: Record<string, unknown>) {
  const str = (key: string) => (typeof body[key] === 'string' ? (body[key] as string) : undefined);
  return {
    baseUrl: str('baseUrl'),
    host: str('host'),
    port: str('port'),
    apiKey: str('apiKey'),
    model: str('model'),
  };
}

aiRoutes.post('/api/ai/models', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const endpoint = resolveOpenAiEndpoint(endpointOverrides(body));
  if (!endpoint.baseUrl) return c.json({ error: 'Add the LLM host and port first' }, 400);
  try {
    return c.json(await listOpenAiModels(endpoint));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

aiRoutes.post('/api/ai/test', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const endpoint = resolveOpenAiEndpoint(endpointOverrides(body));
  if (!endpoint.baseUrl) return c.json({ error: 'Add the LLM host and port first' }, 400);
  if (!endpoint.model) return c.json({ error: 'Choose an LLM model first' }, 400);
  try {
    return c.json(await testOpenAiConnection(endpoint));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

// ── OpenCode ─────────────────────────────────────────────────────────────────────────────────────
// The account credential lives inside OpenCode's own data directory. These routes only expose the
// connection state, the model catalog, the device-code URL, and plain text generations.

aiRoutes.get('/api/ai/opencode/status', async (c) => {
  try {
    return c.json(await openCodeStatus());
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

aiRoutes.post('/api/ai/opencode/connect', async (c) => {
  try {
    return c.json(await startOpenCodeSignIn());
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

aiRoutes.get('/api/ai/opencode/connect/:attemptID', async (c) => {
  try {
    return c.json(await openCodeSignInStatus(c.req.param('attemptID')));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

aiRoutes.post('/api/ai/opencode/disconnect', async (c) => {
  try {
    await disconnectOpenCode();
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

aiRoutes.post('/api/ai/opencode/test', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  if (!model) return c.json({ error: 'Choose an OpenCode model first' }, 400);
  const started = Date.now();
  try {
    const reply = await generateOpenCodeText('Reply with the single word OK.', model);
    return c.json({ model, latencyMs: Date.now() - started, reply: reply.trim().slice(0, 200) });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});
