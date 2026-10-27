import { openCodeStatus, startOpenCodeSignIn, openCodeSignInStatus, stopOpenCode } from './server/ai/opencode';
try {
  const status = await openCodeStatus();
  console.log('status', JSON.stringify({ connected: status.connected, models: status.models.slice(0, 5), count: status.models.length }));
  const signIn = await startOpenCodeSignIn();
  console.log('signin', JSON.stringify(signIn));
  const poll = await openCodeSignInStatus(signIn.attemptID);
  console.log('poll', JSON.stringify(poll));
} catch (e) {
  console.error('error', e instanceof Error ? e.message : e);
} finally {
  await stopOpenCode();
}
