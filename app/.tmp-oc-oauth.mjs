import { OpenCode } from '@opencode/client';
const client = OpenCode.make({ baseUrl: 'http://127.0.0.1:4097', headers: { Authorization: 'Basic ' + Buffer.from('opencode:ARdx4l3UCVzK-EqFehFg1T8kk2Ax1SqVL6ibYVj8ptA').toString('base64') } });
try {
  const out = await client.integration.oauth.connect({ integrationID: 'opencode', methodID: 'device' });
  console.log('connect', JSON.stringify(out).slice(0,800));
  const st = await client.integration.oauth.status({ integrationID: 'opencode', attemptID: out.data.attemptID });
  console.log('status', JSON.stringify(st).slice(0,500));
  await client.integration.oauth.cancel({ integrationID: 'opencode', attemptID: out.data.attemptID }).catch(e=>console.log('cancel err', e?.message));
} catch (e) { console.log('err', e?._tag, e?.message, JSON.stringify(e).slice(0,500)); }
