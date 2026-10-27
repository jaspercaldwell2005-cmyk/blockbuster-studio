import { OpenCode } from '@opencode/sdk';
const oc = await OpenCode.create({ database: { path: '/tmp/opencode-sdk-test/sessions.db' }, config: { directory: '/tmp/opencode-sdk-test', project: false } });
console.log('created', Object.keys(oc).slice(0,20));
try {
  const info = await oc.server.info();
  console.log('info', JSON.stringify(info).slice(0,300));
} catch (e) { console.error('info err', e?.message || e); }
try {
  const integrations = await oc.integration.list();
  console.log('integrations type', typeof integrations, JSON.stringify(integrations).slice(0,200));
} catch (e) { console.error('integration err', e?.message || e); }
try {
  const models = await oc.model.list();
  console.log('models', JSON.stringify(models).slice(0,500));
} catch (e) { console.error('model err', e?.message || e); }
await oc.close();
