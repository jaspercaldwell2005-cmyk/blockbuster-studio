import { afterEach, describe, expect, it } from 'vitest';
import {
  containerLoopbackAlias,
  isContainerRuntime,
  isLoopbackHost,
  rewriteLoopbackBaseUrl,
} from './loopback';

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

describe('loopback detection', () => {
  it('recognises the usual loopback spellings', () => {
    for (const host of ['127.0.0.1', 'LOCALHOST', '::1', '[::1]']) expect(isLoopbackHost(host)).toBe(true);
    for (const host of ['host.docker.internal', '192.168.1.10', 'example.com']) expect(isLoopbackHost(host)).toBe(false);
  });

  it('honours the container override', () => {
    process.env.STUDIO_LLM_IN_CONTAINER = '1';
    expect(isContainerRuntime()).toBe(true);
    process.env.STUDIO_LLM_IN_CONTAINER = '0';
    expect(isContainerRuntime()).toBe(false);
  });
});

describe('rewriteLoopbackBaseUrl', () => {
  it('leaves the URL alone outside a container', () => {
    expect(rewriteLoopbackBaseUrl('http://127.0.0.1:8888/v1', { inContainer: false })).toBe('http://127.0.0.1:8888/v1');
  });

  it('translates loopback to the host alias inside a container', () => {
    expect(rewriteLoopbackBaseUrl('http://127.0.0.1:8888/v1', { inContainer: true })).toBe(
      'http://host.docker.internal:8888/v1',
    );
    expect(rewriteLoopbackBaseUrl('http://localhost:11434/v1', { inContainer: true })).toBe(
      'http://host.docker.internal:11434/v1',
    );
    expect(rewriteLoopbackBaseUrl('https://[::1]:8443/api/v1', { inContainer: true })).toBe(
      'https://host.docker.internal:8443/api/v1',
    );
  });

  it('leaves non-loopback hosts untouched', () => {
    expect(rewriteLoopbackBaseUrl('https://openrouter.ai/api/v1', { inContainer: true })).toBe(
      'https://openrouter.ai/api/v1',
    );
  });

  it('supports a custom alias and an explicit opt-out', () => {
    expect(rewriteLoopbackBaseUrl('http://127.0.0.1:8888/v1', { inContainer: true, alias: 'gateway.local' })).toBe(
      'http://gateway.local:8888/v1',
    );
    expect(rewriteLoopbackBaseUrl('http://127.0.0.1:8888/v1', { inContainer: true, alias: '' })).toBe(
      'http://127.0.0.1:8888/v1',
    );
  });

  it('reads the alias from the environment', () => {
    process.env.STUDIO_LLM_LOOPBACK_ALIAS = 'docker-host';
    expect(containerLoopbackAlias()).toBe('docker-host');
    process.env.STUDIO_LLM_LOOPBACK_ALIAS = '';
    expect(containerLoopbackAlias()).toBe('');
  });
});
