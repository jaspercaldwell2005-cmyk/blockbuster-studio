// Headless layout audit for text/content overflow.
//
//   npm run audit:overflow
//
// By default this starts a throwaway studio server on a random port with a temporary DATA_DIR,
// creates a password, seeds an OpenAI-compatible provider, and visits the main routes at several
// phone/tablet/desktop widths. It reports elements whose content is clipped or that extend past
// the viewport, then exits non-zero when anything is found.
//
// To audit an existing studio instead:
//
//   BASE_URL=http://127.0.0.1:3001 STUDIO_PASSWORD='your password' npm run audit:overflow
//
// Elements inside a deliberate overflow:auto/scroll container, ellipsized text, and line-clamped
// text are ignored: those are intentional scroll/truncation designs, not layout bugs.

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.BASE_URL?.trim().replace(/\/$/, '') || '';
const PASSWORD = process.env.STUDIO_PASSWORD || '';
const HEADED = process.env.HEADED === '1';
const KEEP_SCREENSHOTS = process.env.OVERFLOW_SCREENSHOTS !== '0';
const SCREENSHOT_DIR = path.resolve(ROOT, process.env.OVERFLOW_SCREENSHOT_DIR || '.overflow');
const ROUTES = (process.env.OVERFLOW_ROUTES || '/,/settings,/projects,/cast,/locations,/loras')
  .split(',')
  .map((route) => route.trim())
  .filter(Boolean);
const VIEWPORTS = (process.env.OVERFLOW_VIEWPORTS || '320x640,360x740,390x844,768x1024,1280x800')
  .split(',')
  .map((entry) => {
    const [width, height] = entry.trim().split('x').map(Number);
    if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error(`Bad viewport: ${entry}`);
    return { width, height };
  });

const MOCK_MODELS = [
  'unsloth/Qwen3.8-27B-GGUF',
  'unsloth/DeepSeek-V4.1-Flash-1017-GGUF:UD-Q8_K_XXL',
  'ollama/gemma4-moe:latest',
  'ollama/hf.co/unsloth/Qwen3.5-27B-GGUF:Q4_K_M',
  'ollama/hf.co/unsloth/gemma-4-26B-A4B-it-GGUF:MXFP4_MOE',
  'ollama/qwen3-coder:30b',
];

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(baseUrl, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The studio server did not become healthy at ${baseUrl}`);
}

async function startTemporaryServer() {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'bb-overflow-'));
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(path.join(ROOT, 'node_modules', '.bin', 'tsx'), ['server/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: String(port),
      HOST: '127.0.0.1',
      WEB_DIST: path.join(ROOT, 'dist', 'web'),
      COMFY_MOCK: '1',
      AGENT_ACCESS: 'false',
      MODELS_STATUS_FILE: path.join(dataDir, 'models-status.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));

  try {
    await waitForHealth(baseUrl);
  } catch (err) {
    child.kill('SIGTERM');
    throw new Error(`${err instanceof Error ? err.message : err}\n\n${log.slice(-4000)}`);
  }

  return {
    baseUrl,
    stop: async () => {
      child.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (!child.killed) child.kill('SIGKILL');
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

const AUDIT_PASSWORD = 'overflow-audit-password';

async function authenticate(context, baseUrl, temporary) {
  const session = await context.request.get(`${baseUrl}/api/session`);
  const state = await session.json().catch(() => ({}));
  if (state.authenticated) return;

  // A throwaway server is claimed by the first browser context; later contexts sign in.
  if (state.setupOpen || (temporary && !state.claimed)) {
    const res = await context.request.post(`${baseUrl}/api/setup`, {
      data: { password: AUDIT_PASSWORD },
    });
    if (res.ok()) return;
    if (res.status() !== 409) {
      throw new Error(`Could not set the audit password: ${res.status()} ${await res.text()}`);
    }
  }

  const password = temporary ? AUDIT_PASSWORD : PASSWORD;
  if (!password) {
    throw new Error(
      'This studio already has a password. Set STUDIO_PASSWORD (or point BASE_URL at an unclaimed studio).',
    );
  }
  const res = await context.request.post(`${baseUrl}/api/login`, { data: { password } });
  if (!res.ok()) throw new Error(`Login failed: ${res.status()} ${await res.text()}`);
}

async function seedSettings(context, baseUrl) {
  const res = await context.request.put(`${baseUrl}/api/settings`, {
    data: {
      llmProvider: 'openai_compatible',
      openaiHost: '127.0.0.1',
      openaiPort: '8889',
      openaiBaseUrl: 'http://127.0.0.1:8889/v1',
      openaiModel: MOCK_MODELS[0],
    },
  });
  if (!res.ok()) throw new Error(`Could not seed settings: ${res.status()} ${await res.text()}`);
}

function routeSlug(route) {
  return route === '/' ? 'home' : route.replace(/^\//, '').replace(/[^\w-]+/g, '-');
}

function collectOverflows() {
  const issues = [];
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const MAX_ISSUES = 60;

  const selectorFor = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part += `#${node.id}`;
        parts.unshift(part);
        break;
      }
      const classes = [...node.classList]
        .filter((name) => !name.includes(':') && !name.includes('[') && !name.startsWith('data-'))
        .slice(0, 3);
      if (classes.length) part += `.${classes.join('.')}`;
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  const textFor = (el) => {
    const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > 70 ? `${text.slice(0, 67)}…` : text;
  };

  const hidden = (el, style) =>
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.opacity === '0' ||
    el.getBoundingClientRect().width === 0 ||
    el.getBoundingClientRect().height === 0;

  const inScrollContainer = (el, axis) => {
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const value = axis === 'x' ? style.overflowX : style.overflowY;
      if (value === 'auto' || value === 'scroll') return true;
    }
    return false;
  };

  const clippedByAncestor = (el, axis) => {
    const rect = el.getBoundingClientRect();
    for (let node = el.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const value = axis === 'x' ? style.overflowX : style.overflowY;
      if (value !== 'hidden' && value !== 'clip') continue;
      const bounds = node.getBoundingClientRect();
      if (axis === 'x' && (rect.right > bounds.right + 1 || rect.left < bounds.left - 1)) return true;
      if (axis === 'y' && (rect.bottom > bounds.bottom + 1 || rect.top < bounds.top - 1)) return true;
    }
    return false;
  };

  const add = (issue) => {
    if (issues.length >= MAX_ISSUES) return;
    const key = `${issue.kind}|${issue.selector}|${Math.round(issue.rect.left)}|${Math.round(issue.rect.top)}`;
    if (issues.some((entry) => entry.key === key)) return;
    issues.push({ ...issue, key });
  };

  // A wrapper that clips its own content is fine when the clipped content lives in an inner scroll
  // area (the app shell does this: fixed chrome plus a scrolling page). Mark those wrappers so the
  // clipped-x/y checks below don't report the outer box.
  const hasScrollingDescendantX = new Set();
  const hasScrollingDescendantY = new Set();
  for (const node of document.querySelectorAll('*')) {
    const style = getComputedStyle(node);
    const scrollsX = style.overflowX === 'auto' || style.overflowX === 'scroll';
    const scrollsY = style.overflowY === 'auto' || style.overflowY === 'scroll';
    if (!scrollsX && !scrollsY) continue;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (scrollsX) hasScrollingDescendantX.add(parent);
      if (scrollsY) hasScrollingDescendantY.add(parent);
    }
  }

  for (const el of document.querySelectorAll('*')) {
    const tag = el.tagName;
    if (['HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'OPTION', 'DATALIST', 'TEMPLATE'].includes(tag)) {
      continue;
    }
    if (tag === 'SVG' || tag === 'PATH' || tag === 'CIRCLE' || tag === 'RECT' || tag === 'LINE' || tag === 'POLYGON') continue;

    const style = getComputedStyle(el);
    if (hidden(el, style)) continue;
    if (el.closest('[aria-hidden="true"]')) continue;

    const rect = el.getBoundingClientRect();
    const selector = selectorFor(el);
    const text = textFor(el);
    const base = {
      selector,
      tag: tag.toLowerCase(),
      text,
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };

    const isField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
    const ellipsized = style.textOverflow === 'ellipsis';
    const lineClamped = style.webkitLineClamp && style.webkitLineClamp !== 'none';
    const scrollsX = style.overflowX === 'auto' || style.overflowX === 'scroll';
    const scrollsY = style.overflowY === 'auto' || style.overflowY === 'scroll';

    if (!isField && !scrollsX && !ellipsized && !inScrollContainer(el, 'x') && !hasScrollingDescendantX.has(el) && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
      add({
        ...base,
        kind: 'clipped-x',
        detail: `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`,
      });
    }

    if (!isField && !scrollsY && !lineClamped && !inScrollContainer(el, 'y') && !hasScrollingDescendantY.has(el) && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1) {
      add({
        ...base,
        kind: 'clipped-y',
        detail: `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}`,
      });
    }

    if (!inScrollContainer(el, 'x') && !clippedByAncestor(el, 'x') && (rect.right > viewportWidth + 1 || rect.left < -1)) {
      add({
        ...base,
        kind: 'outside-x',
        detail: `x ${Math.round(rect.left)}–${Math.round(rect.right)} outside viewport 0–${viewportWidth}`,
      });
    }

    if (!inScrollContainer(el, 'y') && !clippedByAncestor(el, 'y') && (rect.bottom > viewportHeight + 1 || rect.top < -1)) {
      add({
        ...base,
        kind: 'outside-y',
        detail: `y ${Math.round(rect.top)}–${Math.round(rect.bottom)} outside viewport 0–${viewportHeight}`,
      });
    }
  }

  return issues.map(({ key, ...issue }) => issue);
}

function formatIssue(issue) {
  const text = issue.text ? ` “${issue.text}”` : '';
  return `  ${issue.kind}: <${issue.tag}>${text}\n    ${issue.selector}\n    ${issue.detail}`;
}

async function main() {
  const temporary = !BASE_URL;
  let server;
  let browser;
  let failures = 0;

  try {
    if (temporary) {
      server = await startTemporaryServer();
    }
    const baseUrl = BASE_URL || server.baseUrl;

    browser = await chromium.launch({ headless: !HEADED });
    if (KEEP_SCREENSHOTS) mkdirSync(SCREENSHOT_DIR, { recursive: true });

    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on('pageerror', (err) => consoleErrors.push(err.message));

      // Deterministic model list with long ids, including one loaded model.
      await context.route('**/api/ai/models', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            baseUrl: 'http://127.0.0.1:8889/v1',
            models: MOCK_MODELS,
            loadedModels: [MOCK_MODELS[0]],
          }),
        }),
      );

      await authenticate(context, baseUrl, temporary);
      if (temporary) await seedSettings(context, baseUrl);

      for (const route of ROUTES) {
        await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);

        let modelCount = null;
        if (route === '/settings') {
          const findModels = page.getByRole('button', { name: /find models/i }).first();
          if (await findModels.count()) {
            await findModels.click();
            await page.waitForTimeout(400);
          }
          modelCount = await page.locator('[role="listbox"][aria-label="Discovered models"] [role="option"]').count();
        }

        // Self-check: inject a deliberately overflowing label so a green run proves the detector
        // still sees real overflows instead of silently skipping everything.
        if (process.env.OVERFLOW_SELFTEST === '1') {
          await page.evaluate(() => {
            const el = document.createElement('div');
            el.id = 'audit-selftest';
            el.style.cssText = 'width:60px;white-space:nowrap;overflow:visible;color:transparent';
            el.textContent = 'this label is far wider than its box and must be caught';
            document.body.appendChild(el);
          });
        }

        const issues = await page.evaluate(collectOverflows);
        const notes = [];
        if (modelCount !== null) notes.push(`${modelCount} model${modelCount === 1 ? '' : 's'} listed`);
        if (process.env.OVERFLOW_SELFTEST === '1') notes.push('self-test injected');
        const note = notes.length ? ` — ${notes.join(', ')}` : '';

        if (issues.length === 0) {
          process.stdout.write(`✓ ${viewport.width}×${viewport.height} ${route}${note}\n`);
          continue;
        }

        failures += issues.length;
        process.stdout.write(`✗ ${viewport.width}×${viewport.height} ${route} — ${issues.length} overflow issue(s)${note}\n`);
        for (const issue of issues) process.stdout.write(`${formatIssue(issue)}\n`);

        if (KEEP_SCREENSHOTS) {
          const file = path.join(SCREENSHOT_DIR, `${viewport.width}x${viewport.height}-${routeSlug(route)}.png`);
          await page.screenshot({ path: file, fullPage: false });
          process.stdout.write(`  screenshot: ${path.relative(ROOT, file)}\n`);
        }
      }

      if (consoleErrors.length) {
        failures += consoleErrors.length;
        process.stdout.write(`✗ ${viewport.width}×${viewport.height} page errors:\n`);
        for (const message of consoleErrors) process.stdout.write(`  ${message}\n`);
      }

      await context.close();
    }
  } finally {
    await browser?.close().catch(() => {});
    await server?.stop().catch(() => {});
  }

  if (failures) {
    process.stdout.write(`\n${failures} overflow issue(s) found.\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('\nNo unintended overflows found.\n');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
