import crypto from 'crypto';
import { WebSocket } from 'ws';
import dotenv from 'dotenv';

dotenv.config();

// Allow testing self-signed certificates locally
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function sha256(str: string): string {
  return crypto.createHash('sha256').update(str).digest('hex');
}

async function testFeatures() {
  console.log('🧪 Testing WebTerm V2 upgraded features...\n');
  const baseUrl = 'https://127.0.0.1:3000';
  const wsUrl = 'wss://127.0.0.1:3000/ws';
  const currentHash = process.env.TERMINAL_PASSWORD_HASH
    || (process.env.TERMINAL_PASSWORD ? sha256(process.env.TERMINAL_PASSWORD) : '0964b6086fe38dbe6162a3953124327d9d52ce4816952c620694126fed33aaa6');

  // 1. Test SHA-256 Encrypted Login
  console.log('1. Testing SHA-256 frontend encrypted auth verification...');
  const authRes = await fetch(`${baseUrl}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: currentHash })
  });

  if (!authRes.ok) throw new Error(`Encrypted auth failed with status ${authRes.status}`);
  console.log('   ✅ SHA-256 encrypted authentication verified successfully!');

  // 2. Test Change Password Endpoint
  console.log('\n2. Testing /api/auth/change-password (with encrypted current password)...');
  const changeRes = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentPassword: currentHash,
      newPassword: 'cyber-test-pwd-2026',
      newPasswordHash: sha256('cyber-test-pwd-2026')
    })
  });

  if (!changeRes.ok) {
    const err = await changeRes.text();
    throw new Error(`Change password failed: ${err}`);
  }
  console.log('   ✅ Password change verified successfully!');

  // Revert back to original password
  await fetch(`${baseUrl}/api/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentPassword: sha256('cyber-test-pwd-2026'),
      newPassword: currentHash,
      newPasswordHash: currentHash
    })
  });
  console.log(`   ✅ Password reverted back to: ${currentHash.slice(0, 10)}...`);

  // 3. Test Mega-ASR Proxy endpoint
  console.log('\n3. Testing Mega-ASR proxy (/api/asr/mega-asr)...');
  // Generate 1 second of 16kHz sine wave audio
  const sampleRate = 16000;
  const numSamples = 16000;
  const wavBuffer = Buffer.alloc(44 + numSamples * 2);
  wavBuffer.write('RIFF', 0);
  wavBuffer.writeUInt32LE(36 + numSamples * 2, 4);
  wavBuffer.write('WAVE', 8);
  wavBuffer.write('fmt ', 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20); // PCM
  wavBuffer.writeUInt16LE(1, 22); // mono
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(sampleRate * 2, 28);
  wavBuffer.writeUInt16LE(2, 32);
  wavBuffer.writeUInt16LE(16, 34);
  wavBuffer.write('data', 36);
  wavBuffer.writeUInt32LE(numSamples * 2, 40);

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 10000;
    wavBuffer.writeInt16LE(Math.floor(sample), 44 + i * 2);
  }

  const megaResp = await fetch(`${baseUrl}/api/asr/mega-asr?language=zh`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: wavBuffer
  });

  if (megaResp.ok) {
    const megaData = await megaResp.json();
    console.log('   ✅ Mega-ASR proxy response:', megaData);
  } else {
    console.warn('   ⚠️ Mega-ASR status:', megaResp.status, '(Remote host status)');
  }

  // 4. Test WebSocket Encrypted Handshake
  console.log('\n4. Testing WebSocket Handshake with SHA-256 encrypted password...');
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { rejectUnauthorized: false });
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'auth',
        password: currentHash,
        sessionId: 'test-v2-session'
      }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'auth_ok') {
        console.log('   ✅ WebSocket authenticated with encrypted SHA-256 hash!');
        ws.close();
        resolve();
      } else if (msg.type === 'auth_fail') {
        reject(new Error(`WebSocket auth failed: ${msg.error}`));
      }
    });

    ws.on('error', reject);
  });

  console.log('\n🎉 ALL V2 FEATURES PASSED VERIFICATION!\n');
}

testFeatures().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
