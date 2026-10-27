import { Hono } from 'hono';
import { hasSession } from '../auth';
import { clearLogs, deleteUnusedGeneratedAssets, storageUsage } from '../storage';

const passwordOnly = { error: 'Sign in with the studio password to delete files or logs.' };

export function storageRoutes() {
  const app = new Hono();

  app.get('/api/storage', (c) => c.json(storageUsage()));

  // Destructive maintenance is deliberately password-only: an agent token can make films, not wipe the pod.
  // Only generated files no project or library record points at; see server/storage.ts.
  app.delete('/api/storage/output', async (c) => {
    if (!hasSession(c)) return c.json(passwordOnly, 403);
    return c.json({ ok: true, ...(await deleteUnusedGeneratedAssets()) });
  });

  app.delete('/api/storage/logs', (c) => {
    if (!hasSession(c)) return c.json(passwordOnly, 403);
    return c.json({ ok: true, ...clearLogs() });
  });

  return app;
}
