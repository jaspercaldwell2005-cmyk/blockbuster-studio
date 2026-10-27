import { describe, expect, it } from 'vitest';
import { buildOpenAiBaseUrl, normalizeOpenAiBaseUrl, parseOpenAiBaseUrl } from './llm';

describe('parseOpenAiBaseUrl', () => {
  it('splits a local endpoint into host, port and path', () => {
    expect(parseOpenAiBaseUrl('http://127.0.0.1:8888/v1')).toEqual({
      protocol: 'http',
      host: '127.0.0.1',
      port: '8888',
      path: '/v1',
    });
  });

  it('keeps a hosted provider path and https', () => {
    expect(parseOpenAiBaseUrl('https://openrouter.ai/api/v1')).toEqual({
      protocol: 'https',
      host: 'openrouter.ai',
      port: '',
      path: '/api/v1',
    });
  });

  it('fills in /v1 when no path is given', () => {
    expect(parseOpenAiBaseUrl('localhost:8888').path).toBe('/v1');
  });

  it('strips a pasted chat/completions suffix', () => {
    expect(parseOpenAiBaseUrl('http://127.0.0.1:8888/v1/chat/completions').path).toBe('/v1');
  });

  it('returns an empty endpoint for blank input', () => {
    expect(parseOpenAiBaseUrl('')).toEqual({ protocol: 'http', host: '', port: '', path: '/v1' });
  });
});

describe('buildOpenAiBaseUrl', () => {
  it('builds the Unsloth endpoint from host and port', () => {
    expect(buildOpenAiBaseUrl({ protocol: 'http', host: '127.0.0.1', port: '8888', path: '/v1' })).toBe(
      'http://127.0.0.1:8888/v1',
    );
  });

  it('accepts a host that already has a port, without duplicating it', () => {
    expect(buildOpenAiBaseUrl({ protocol: 'http', host: 'host.docker.internal:8888', port: '1234', path: '/v1' })).toBe(
      'http://host.docker.internal:8888/v1',
    );
  });

  it('accepts a full pasted URL', () => {
    expect(buildOpenAiBaseUrl({ protocol: 'http', host: 'https://openrouter.ai/api/v1', port: '', path: '/v1' })).toBe(
      'https://openrouter.ai/api/v1',
    );
  });

  it('adds a leading slash to the path', () => {
    expect(buildOpenAiBaseUrl({ protocol: 'https', host: 'example.com', port: '', path: 'api/v1' })).toBe(
      'https://example.com/api/v1',
    );
  });

  it('returns empty for a blank host', () => {
    expect(buildOpenAiBaseUrl({ protocol: 'http', host: '  ', port: '8888', path: '/v1' })).toBe('');
  });
});

describe('normalizeOpenAiBaseUrl', () => {
  it('normalises a bare host into a usable base URL', () => {
    expect(normalizeOpenAiBaseUrl('127.0.0.1:8888')).toBe('http://127.0.0.1:8888/v1');
  });

  it('leaves a full provider URL alone', () => {
    expect(normalizeOpenAiBaseUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1');
  });
});
