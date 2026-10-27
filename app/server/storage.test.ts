import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearLogs, isUnusedGenerated, logUsage } from './storage';
import type { Asset } from '../shared/types';

function asset(patch: Partial<Asset> = {}): Asset {
  return {
    id: 'a1',
    kind: 'image',
    origin: 'generated',
    file: '2026-10/a1.png',
    width: 512,
    height: 512,
    favorite: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

describe('isUnusedGenerated', () => {
  it('accepts a plain generated asset', () => {
    expect(isUnusedGenerated(asset(), new Set())).toBe(true);
  });

  it('keeps uploads, exports and favorites', () => {
    expect(isUnusedGenerated(asset({ origin: 'upload' }), new Set())).toBe(false);
    expect(isUnusedGenerated(asset({ origin: 'export' }), new Set())).toBe(false);
    expect(isUnusedGenerated(asset({ favorite: true }), new Set())).toBe(false);
  });

  it('keeps assets attached to a project or shot, or referenced by the library', () => {
    expect(isUnusedGenerated(asset({ projectId: 'p1' }), new Set())).toBe(false);
    expect(isUnusedGenerated(asset({ shotId: 'sh1' }), new Set())).toBe(false);
    expect(isUnusedGenerated(asset(), new Set(['a1']))).toBe(false);
  });
});

describe('clearLogs', () => {
  let dataDir: string;

  afterEach(() => {
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('truncates .log files, leaves other files alone, and reports the bytes freed', () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-storage-test-'));
    fs.mkdirSync(path.join(dataDir, 'logs'));
    fs.writeFileSync(path.join(dataDir, 'logs', 'server.log'), 'server output');
    fs.writeFileSync(path.join(dataDir, 'logs', 'comfyui.log'), 'comfy output');
    fs.writeFileSync(path.join(dataDir, 'logs', 'notes.txt'), 'do not touch');

    expect(logUsage(dataDir)).toEqual({ files: 2, bytes: 13 + 12 });
    expect(clearLogs(dataDir)).toEqual({ files: 2, bytes: 13 + 12 });

    expect(fs.readFileSync(path.join(dataDir, 'logs', 'server.log'), 'utf8')).toBe('');
    expect(fs.readFileSync(path.join(dataDir, 'logs', 'comfyui.log'), 'utf8')).toBe('');
    expect(fs.readFileSync(path.join(dataDir, 'logs', 'notes.txt'), 'utf8')).toBe('do not touch');
    expect(logUsage(dataDir)).toEqual({ files: 2, bytes: 0 });
  });

  it('returns zero when there is no logs folder', () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-storage-test-'));
    expect(logUsage(dataDir)).toEqual({ files: 0, bytes: 0 });
    expect(clearLogs(dataDir)).toEqual({ files: 0, bytes: 0 });
  });
});
