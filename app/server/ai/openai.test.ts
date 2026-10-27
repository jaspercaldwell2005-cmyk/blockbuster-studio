import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openai-test-'));
process.env.DATA_DIR = tmpDir;

const { listOpenAiModels, resolveOpenAiEndpoint, testOpenAiConnection } = await import('./openai');
const { updateSettings } = await import('../settings');

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('resolveOpenAiEndpoint', () => {
  it('uses the passed host and port for an unsaved Settings test', () => {
    const endpoint = resolveOpenAiEndpoint({ host: '127.0.0.1', port: '8888' });
    expect(endpoint.baseUrl).toBe('http://127.0.0.1:8888/v1');
  });

  it('prefers a full base URL from saved settings', () => {
    updateSettings({ openaiHost: '127.0.0.1', openaiPort: '8888', openaiBaseUrl: 'https://openrouter.ai/api/v1', llmProvider: 'openai_compatible' });
    expect(resolveOpenAiEndpoint().baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('derives a base URL when only host and port are saved', () => {
    const saved = updateSettings({ openaiBaseUrl: '', openaiHost: 'host.docker.internal', openaiPort: '8888' });
    expect(saved.openaiHost).toBe('host.docker.internal');
    expect(saved.openaiPort).toBe('8888');
    expect(saved.openaiBaseUrl).toBe('http://host.docker.internal:8888/v1');
  });

  it('reaches the Docker host when the user enters a loopback address', () => {
    process.env.STUDIO_LLM_IN_CONTAINER = '1';
    try {
      expect(resolveOpenAiEndpoint({ host: '127.0.0.1', port: '8888' }).baseUrl).toBe(
        'http://host.docker.internal:8888/v1',
      );
      expect(resolveOpenAiEndpoint({ baseUrl: 'http://localhost:8888/v1' }).baseUrl).toBe(
        'http://host.docker.internal:8888/v1',
      );
    } finally {
      delete process.env.STUDIO_LLM_IN_CONTAINER;
    }
  });
});

describe('listOpenAiModels', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the OpenAI data[].id shape and sorts the ids', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ object: 'list', data: [{ id: 'unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL' }, { id: 'another-model' }] }),
    );
    const result = await listOpenAiModels({ baseUrl: 'http://127.0.0.1:8888/v1', apiKey: '' });
    expect(result.models).toEqual(['another-model', 'unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL']);
    expect(result.baseUrl).toBe('http://127.0.0.1:8888/v1');
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('http://127.0.0.1:8888/v1/models');
  });

  it('reports which advertised models are already loaded', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        object: 'list',
        data: [
          { id: 'ollama/gemma4-moe:latest', loaded: false },
          { id: 'unsloth/Qwen3.8-27B-GGUF', loaded: true },
        ],
      }),
    );
    const result = await listOpenAiModels({ baseUrl: 'http://127.0.0.1:8888/v1', apiKey: '' });
    expect(result.models).toEqual(['ollama/gemma4-moe:latest', 'unsloth/Qwen3.8-27B-GGUF']);
    expect(result.loadedModels).toEqual(['unsloth/Qwen3.8-27B-GGUF']);
  });

  it('sends the bearer token when one is set', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ data: [{ id: 'm' }] }));
    await listOpenAiModels({ baseUrl: 'http://host:8888/v1', apiKey: 'not-needed' });
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer not-needed');
  });

  it('explains an HTTP error', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(listOpenAiModels({ baseUrl: 'http://host:8888/v1', apiKey: '' })).rejects.toThrow(
      'OpenAI-compatible server returned 404: nope',
    );
  });

  it('explains a network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(listOpenAiModels({ baseUrl: 'http://127.0.0.1:8888/v1', apiKey: '' })).rejects.toThrow(
      'Could not reach http://127.0.0.1:8888/v1/models',
    );
  });
});

describe('testOpenAiConnection', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts a small chat completion and returns the reply', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'OK' } }] }));
    const result = await testOpenAiConnection({
      baseUrl: 'http://127.0.0.1:8888/v1',
      apiKey: '',
      model: 'unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL',
    });
    expect(result.model).toBe('unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL');
    expect(result.reply).toBe('OK');
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8888/v1/chat/completions');
    expect(JSON.parse(String((init as RequestInit).body)).messages[0].content).toContain('OK');
  });

  it('requires a model', async () => {
    await expect(testOpenAiConnection({ baseUrl: 'http://127.0.0.1:8888/v1', apiKey: '', model: '' })).rejects.toThrow(
      'Choose an LLM model first',
    );
  });

  it('accepts a reasoning model that used its whole reply budget on reasoning_content', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: '', reasoning_content: 'We need to reply with OK.' } }] }),
    );
    const result = await testOpenAiConnection({ baseUrl: 'http://host:8888/v1', apiKey: '', model: 'reasoner' });
    expect(result.reply).toBe('We need to reply with OK.');
  });
});
