import { WebSocket } from 'ws';

async function wait(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function runTests() {
  console.log('🧪 Starting Cyberpunk WebTerm automated test suite...\n');
  const baseUrl = 'http://127.0.0.1:13399';
  const wsUrl = 'ws://127.0.0.1:13399/ws';

  // 1. Health & Status
  console.log('1. Checking /api/status...');
  const statusRes = await fetch(`${baseUrl}/api/status`);
  if (!statusRes.ok) throw new Error(`Status check failed: ${statusRes.status}`);
  const statusData = await statusRes.json();
  console.log('   ✅ Server is online:', statusData);

  // 2. Auth Verification API
  console.log('\n2. Testing /api/auth/verify...');
  const wrongAuth = await fetch(`${baseUrl}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong-password-123' })
  });
  if (wrongAuth.status !== 401) throw new Error('Expected 401 for wrong password');
  console.log('   ✅ Wrong password correctly rejected with 401');

  const correctAuth = await fetch(`${baseUrl}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: '12345678' })
  });
  if (!correctAuth.ok) throw new Error('Expected 200 for correct password');
  console.log('   ✅ Correct password accepted');

  // 3. ASR API
  console.log('\n3. Testing /api/asr...');
  const asrConfigRes = await fetch(`${baseUrl}/api/asr/config`);
  const asrConfig = await asrConfigRes.json();
  console.log('   ✅ ASR Config:', asrConfig);

  // Send a dummy WAV audio payload
  const dummyWavHeader = Buffer.alloc(44);
  dummyWavHeader.write('RIFF', 0);
  dummyWavHeader.write('WAVE', 8);
  const asrRes = await fetch(`${baseUrl}/api/asr`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: dummyWavHeader
  });
  if (!asrRes.ok) throw new Error(`ASR API failed: ${asrRes.status}`);
  const asrData = await asrRes.json();
  console.log('   ✅ ASR transcribed response:', asrData);

  // 4. WebSocket Authentication Failure
  console.log('\n4. Testing WebSocket Auth Failure...');
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'auth',
        password: 'bad-password',
        sessionId: 'test-session-fail'
      }));
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'auth_fail') {
        console.log('   ✅ WebSocket received auth_fail as expected:', msg.error);
        ws.close();
        resolve();
      } else {
        reject(new Error(`Unexpected message: ${JSON.stringify(msg)}`));
      }
    });
    ws.on('error', reject);
  });

  // 5. WebSocket Connection, PTY Execution & Session Resume
  console.log('\n5. Testing WebSocket PTY Execution & Session Resume...');
  const testSessionId = `test-persist-${Date.now()}`;

  // Step 5a: First connection - run command
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let outputBuffer = '';

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'auth',
        password: '12345678',
        sessionId: testSessionId,
        cols: 100,
        rows: 30
      }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'auth_ok') {
        console.log('   ✅ Auth OK received for session:', msg.sessionId);
        // Execute a distinctive echo command
        setTimeout(() => {
          ws.send(JSON.stringify({
            type: 'input',
            data: 'echo "CYBERPUNK_PERSISTENCE_VERIFIED_2026"\r'
          }));
        }, 300);
      } else if (msg.type === 'output') {
        outputBuffer += msg.data;
        if (outputBuffer.includes('CYBERPUNK_PERSISTENCE_VERIFIED_2026')) {
          console.log('   ✅ Received PTY command output!');
          // Now disconnect socket abruptly to simulate browser refresh/tab close
          ws.close();
          resolve();
        }
      }
    });

    ws.on('error', reject);
  });

  await wait(500);

  // Step 5b: Second connection with same sessionId - verify history replay!
  console.log('\n6. Reconnecting to same session ID to verify Session Resume history replay...');
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let historyReceived = false;

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'auth',
        password: 'cyberpunk2026',
        sessionId: testSessionId,
        cols: 100,
        rows: 30
      }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'history') {
        if (msg.data.includes('CYBERPUNK_PERSISTENCE_VERIFIED_2026')) {
          console.log('   ✅ History replay verified! Output preserved from previous session!');
          historyReceived = true;
          // Test Ping/Pong
          ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
        } else {
          reject(new Error('History did not contain expected session output'));
        }
      } else if (msg.type === 'pong' && historyReceived) {
        console.log('   ✅ Ping/Pong roundtrip verified!');
        ws.close();
        resolve();
      }
    });

    ws.on('error', reject);
  });

  console.log('\n🎉 ALL SYSTEM & ARCHITECTURE VERIFICATION TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
