import WebSocket from 'ws';
const url = process.argv[2];
const projectId = process.argv[3];
console.log('Connecting to remote broker:', url.substring(0, 80) + '...');
const ws = new WebSocket(url);
ws.on('open', () => {
  console.log('OPEN - sending ping first...');
  ws.send(JSON.stringify({ type: 'ping', nonce: 'test123' }));
  setTimeout(() => {
    console.log('Sending agent.prompt...');
    ws.send(JSON.stringify({
      type: 'agent.prompt',
      prompt: 'change the h1 heading text to "Welcome from Claude!"',
      turnId: 'direct-test-1',
    }));
  }, 1000);
});
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('MSG:', msg.type, JSON.stringify(msg).substring(0, 120));
  if (msg.type === 'agent.done' || msg.type === 'agent.error') {
    console.log('DONE, closing');
    ws.close();
    process.exit(0);
  }
});
ws.on('error', (e) => { console.log('ERROR:', e.message); });
ws.on('close', (code, reason) => { console.log('CLOSED code=' + code, reason?.toString() || ''); });
setTimeout(() => {
  console.log('TIMEOUT after 3min');
  ws.close();
  process.exit(1);
}, 3 * 60 * 1000);
