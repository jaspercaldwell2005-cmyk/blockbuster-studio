// OpenCode integration: run a private OpenCode server as a child process, sign in through its
// device OAuth flow, and make stateless text generations with the account's models.
//
// Why a child process: OpenCode 2.x ships as a standalone binary (`@opencode/cli`), so the studio
// does not need the user to install anything. The server binds to loopback on a random port with a
// generated password; the studio is the only client.
//
// Credential isolation:
//   - OpenCode stores the OAuth credential in its own data directory (DATA_DIR/opencode), never in
//     the studio database and never in the browser.
//   - The studio never calls OpenCode's credential API, so the token value never enters this process.
//   - Generation is the stateless `/api/experimental/generate` text endpoint. It has no tools, no
//     shell, no file access and no MCP; the model only ever sees the prompt text.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { DATA_DIR } from '../config';

const OPENCODE_INTEGRATION = 'opencode';
const OPENCODE_PROVIDER = 'opencode';

export interface OpenCodeModel {
  id: string;
  name: string;
}

export interface OpenCodeStatus {
  ready: boolean;
  connected: boolean;
  account?: string;
  models: OpenCodeModel[];
}

export interface OpenCodeSignIn {
  attemptID: string;
  url: string;
  instructions: string;
  expires: number;
}

export interface OpenCodeSignInStatus {
  status: 'pending' | 'complete' | 'failed' | 'expired';
  message?: string;
  connected: boolean;
}

type Client = import('@opencode/client').OpenCodeClient;

interface Running {
  child: ChildProcess;
  client: Client;
  port: number;
  exited: boolean;
}

let running: Running | undefined;
let starting: Promise<Running> | undefined;

function openCodeRoot(): string {
  return path.join(DATA_DIR, 'opencode');
}

function binaryPath(): string {
  // Resolve through the package so this works from both `tsx server/index.ts` and dist/server.js.
  const require = createRequire(import.meta.url);
  const pkg = require.resolve('@opencode/cli/package.json');
  return path.join(path.dirname(pkg), 'bin', 'opencode.exe');
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!port) throw new Error('Could not find a free port for OpenCode');
  return port;
}

function startServer(): Promise<Running> {
  return (async () => {
    const root = openCodeRoot();
    const workspace = path.join(root, 'workspace');
    for (const dir of [root, workspace, path.join(root, 'data'), path.join(root, 'config'), path.join(root, 'state'), path.join(root, 'cache')]) {
      mkdirSync(dir, { recursive: true });
    }

    const port = await freePort();
    const child = spawn(binaryPath(), ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
      cwd: workspace,
      env: {
        ...process.env,
        HOME: root,
        XDG_DATA_HOME: path.join(root, 'data'),
        XDG_CONFIG_HOME: path.join(root, 'config'),
        XDG_STATE_HOME: path.join(root, 'state'),
        XDG_CACHE_HOME: path.join(root, 'cache'),
        OPENCODE_CONFIG_DIR: path.join(root, 'config', 'opencode'),
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const state: Running = { child, client: undefined as unknown as Client, port, exited: false };
    child.once('exit', () => {
      state.exited = true;
      if (running === state) running = undefined;
    });

    // The CLI prints the generated basic-auth password on stdout. Keep it in memory only; never log
    // or return it, and never pass it to a model.
    let password = '';
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`OpenCode did not start within 20 seconds${stderr ? `: ${stderr.slice(-500)}` : ''}`));
      }, 20_000);

      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };

      let stdout = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        if (!password) {
          const match = /server password (\S+)/.exec(stdout);
          if (match) password = match[1];
        }
        if (password && /server listening on/.test(stdout)) done();
      });
      child.once('error', (err) => done(err instanceof Error ? err : new Error(String(err))));
      child.once('exit', (code) => done(new Error(`OpenCode exited during startup (code ${code ?? 'unknown'})${stderr ? `: ${stderr.slice(-500)}` : ''}`)));
    }).catch((err) => {
      child.kill('SIGTERM');
      throw err;
    });

    const { OpenCode } = await import('@opencode/client');
    const auth = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
    state.client = OpenCode.make({
      baseUrl: `http://127.0.0.1:${port}`,
      headers: { Authorization: auth },
    });

    // The listener is up before its integration/model catalog finishes loading. Wait for the
    // OpenCode integration we use, so the first status call doesn't race startup.
    const deadline = Date.now() + 15_000;
    for (;;) {
      try {
        await state.client.integration.get({ integrationID: OPENCODE_INTEGRATION });
        break;
      } catch (err) {
        if (Date.now() > deadline) {
          state.child.kill('SIGTERM');
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    running = state;
    return state;
  })();
}

async function ensureServer(): Promise<Running> {
  if (running && !running.exited) return running;
  if (!starting) {
    starting = startServer().finally(() => {
      starting = undefined;
    });
  }
  return starting;
}

/** Ask OpenCode for the account connection state and its model catalog. */
export async function openCodeStatus(): Promise<OpenCodeStatus> {
  const { client } = await ensureServer();
  const [integration, models] = await Promise.all([
    client.integration.get({ integrationID: OPENCODE_INTEGRATION }),
    client.model.list(),
  ]);
  const connections = integration.data.connections.filter((entry) => entry.type === 'credential');
  const account = connections[0]?.label;
  return {
    ready: true,
    connected: connections.length > 0,
    account,
    models: models.data
      .filter((model) => model.providerID === OPENCODE_PROVIDER && model.enabled !== false)
      .map((model) => ({ id: model.id, name: model.name }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
  };
}

/** Start the browser device-code flow. The token is saved by OpenCode, never by the studio. */
export async function startOpenCodeSignIn(): Promise<OpenCodeSignIn> {
  const { client } = await ensureServer();
  const out = await client.integration.oauth.connect({
    integrationID: OPENCODE_INTEGRATION,
    methodID: 'device',
  });
  return {
    attemptID: out.data.attemptID,
    url: out.data.url,
    instructions: out.data.instructions,
    expires: out.data.time.expires,
  };
}

/** Poll one sign-in attempt. Credentials are stored by OpenCode when the browser approves. */
export async function openCodeSignInStatus(attemptID: string): Promise<OpenCodeSignInStatus> {
  const { client } = await ensureServer();
  const out = await client.integration.oauth.status({
    integrationID: OPENCODE_INTEGRATION,
    attemptID,
  });
  const status = out.data.status;
  if (status === 'complete') {
    const integration = await client.integration.get({ integrationID: OPENCODE_INTEGRATION });
    return {
      status,
      connected: integration.data.connections.some((entry) => entry.type === 'credential'),
    };
  }
  return {
    status,
    message: status === 'failed' ? out.data.message : undefined,
    connected: false,
  };
}

/** Revoke the saved OpenCode account without reading the credential value. */
export async function disconnectOpenCode(): Promise<void> {
  const { client } = await ensureServer();
  const integration = await client.integration.get({ integrationID: OPENCODE_INTEGRATION });
  for (const connection of integration.data.connections) {
    if (connection.type === 'credential') {
      await client.credential.remove({ credentialID: connection.id });
    }
  }
}

/** One stateless text generation. No tools, no shell, no files: prompt text in, text out. */
export async function generateOpenCodeText(prompt: string, modelID: string): Promise<string> {
  if (!modelID.trim()) throw new Error('Choose an OpenCode model first');
  const { client } = await ensureServer();
  const out = await client.generate.text({
    prompt,
    model: { id: modelID, providerID: OPENCODE_PROVIDER },
  });
  return out.text;
}

/** Stop the child server; used on process exit and by tests. */
export async function stopOpenCode(): Promise<void> {
  const state = running;
  running = undefined;
  starting = undefined;
  if (!state) return;
  state.child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (!state.exited) state.child.kill('SIGKILL');
}

process.once('exit', () => {
  running?.child.kill('SIGKILL');
});
