import { OpenCode } from '@opencode/client';
const client = OpenCode.make({ baseUrl: 'http://127.0.0.1:4097', headers: { Authorization: 'Basic ' + Buffer.from('opencode:ARdx4l3UCVzK-EqFehFg1T8kk2Ax1SqVL6ibYVj8ptA').toString('base64') } });
const models = await client.model.list();
console.log('models', models.data.filter(m=>m.providerID==='opencode').slice(0,3).map(m=>({id:m.id, name:m.name})));
const info = await client.integration.get({ integrationID: 'opencode' });
console.log('connections', JSON.stringify(info.data.connections));
try {
  const gen = await client.generate.text({ prompt: 'Reply with the single word OK.', model: { id: 'big-pickle', providerID: 'opencode' } });
  console.log('gen', JSON.stringify(gen));
} catch (e) { console.log('gen err', e?._tag, e?.message, JSON.stringify(e).slice(0,300)); }
