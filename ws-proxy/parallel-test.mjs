import WebSocket from 'ws';
const mode = process.argv[2]; // 'proxy' or 'direct'
const target = process.argv[3];
const url = mode === 'proxy' 
  ? 'ws://localhost:4100/p/' + target
  : target;
const turnId = mode + '-' + Date.now();
console.log('[' + mode + '] connecting to:', url.slice(0,80));
const ws = new WebSocket(url);
ws.on('open', () => {
  console.log('[' + mode + '] OPEN, sending ping...');
  ws.send(JSON.stringify({ type: 'ping', nonce: mode + '-ping' }));
  setTimeout(() => {
    console.log('[' + mode + '] sending agent.prompt turnId=' + turnId);
    ws.send(JSON.stringify({
      type: 'agent.prompt',
      prompt: 'respond with only the number 42',
      turnId,
    }));
  }, 1000);
});
ws.on('message', (d) => {
  const ev = JSON.parse(d.toString());
  const s = ev.type === 'agent.chunk' ? ev.delta?.slice(0,60) :
    ev.type === 'agent.done' ? ('exit=' + ev.exitCode + ' cost=$' + ev.costUsd) :
    ev.type === 'agent.error' ? ev.message?.slice(0,100) :
    JSON.stringify(ev).slice(0,60);
  console.log('[' + mode + '][' + new Date().toISOString().slice(11,19) + ']', ev.type, '|', s);
  if (ev.type === 'agent.done' || ev.type === 'agent.error') { ws.close(); process.exit(0); }
});
ws.on('error', e => { console.log('[' + mode + '] ERROR:', e.message); process.exit(1); });
ws.on('close', (c) => console.log('[' + mode + '] CLOSED code=' + c));
setTimeout(() => { console.log('[' + mode + '] TIMEOUT 2min'); ws.close(); process.exit(1); }, 120000);
