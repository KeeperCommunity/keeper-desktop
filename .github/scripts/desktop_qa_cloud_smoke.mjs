// Disposable Desktop-only smoke. No phone, signer, wallet data or signing action.
import { createCipheriv, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const requireClient = createRequire(join(process.env.CLIENT_DIR, 'package.json'));
const { io } = requireClient('socket.io-client');
const temp = process.env.RUNNER_TEMP;
const evidence = process.env.EVIDENCE_DIR;
const screenTool = join(temp, 'desktop-qa-screen');
const screenshot = join(temp, 'desktop-private-screen.png');
const report = {
  source: 'ef050663d33be51f25fb10310d5a0549b111e273', artifact_id: 11615331902,
  workflow_run_id: 37928395053, state: 'INCOMPLETE', tests: {},
  limits: 'Desktop-only disposable cloud smoke; phone pairing, QR camera scanning, reconnect/retry/rotation matrix, physical signer and PSBT round trip NOT RUN. No Continue click, wallet data, signing or broadcast.',
};
let app;
let socket;
let launchError = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const record = (name, ok) => { report.tests[name] = ok ? 'PASS' : 'FAIL'; if (!ok) throw new Error(name); };
function inspect() {
  execFileSync('/usr/sbin/screencapture', ['-x', '-t', 'png', screenshot], { stdio: 'ignore' });
  return JSON.parse(execFileSync(screenTool, [screenshot], { encoding: 'utf8' }));
}
function includes(view, value) { return view.text.some(item => item.text.toLowerCase().includes(value.toLowerCase())); }
async function until(check, label, seconds = 35) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const view = inspect();
    if (check(view)) return view;
    await pause(1000);
  }
  throw new Error(label);
}
function encrypt(key, data) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  return { iv: iv.toString('hex'), encryptedData: encrypted.toString('hex'), authTag: cipher.getAuthTag().toString('hex') };
}
try {
  mkdirSync(evidence, { recursive: true });
  app = spawn(process.env.APP_BINARY, [], { stdio: 'ignore' });
  app.on('error', () => { launchError = true; });
  await pause(2000);
  record('native_process_launch', !launchError && Boolean(app.pid) && app.exitCode === null);
  const welcome = await until(view => includes(view, 'Get Started'), 'Welcome/channel readiness unavailable');
  record('live_channel_welcome_ready', true);
  const button = welcome.text.find(item => item.text.toLowerCase().includes('get started'));
  // Match screenshot pixel coordinates to the current display logical dimensions.
  const display = execFileSync('/usr/bin/swift', ['-e', 'import AppKit; let f=NSScreen.main!.frame; print("\(f.width) \(f.height)")'], {encoding: 'utf8'}).trim().split(' ').map(Number);
  execFileSync(screenTool, ['click', String(button.x * display[0] / welcome.width), String(button.y * display[1] / welcome.height)], { stdio: 'ignore' });
  const paired = await until(view => view.qr.some(value => /^[0-9a-f]{64}$/.test(value)), 'QR readiness/click unavailable');
  const key = paired.qr.find(value => /^[0-9a-f]{64}$/.test(value));
  const { createHash } = await import('node:crypto');
  const room = createHash('sha256').update(key).digest('hex');
  record('fresh_qr_rendered', true);
  socket = io('https://channel.bitcoinkeeper.app/', { transports: ['websocket', 'polling'], reconnection: false, timeout: 15000 });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', () => reject(new Error('Disposable channel sender unavailable'))); });
  const send = requestData => socket.emit('JOIN_CHANNEL', { room, network: 'TESTNET', requestData });
  const request = { action: 'ADD_DEVICE', signerType: 'LEDGER', accountNumber: 0 };
  const altered = encrypt(key, request);
  altered.authTag = (altered.authTag[0] === '0' ? '1' : '0') + altered.authTag.slice(1);
  send(altered);
  await pause(3000);
  const rejected = inspect();
  record('altered_tag_keeps_qr_without_connect_modal', rejected.qr.includes(key) && !includes(rejected, 'Connect Ledger'));
  send({ action: 'ADD_DEVICE', signerType: 'LEDGER' });
  await pause(2000);
  const plain = inspect();
  record('plaintext_keeps_qr_without_connect_modal', plain.qr.includes(key) && !includes(plain, 'Connect Ledger'));
  send(encrypt(key, { action: 'ADD_DEVICE' }));
  const malformed = await until(view => includes(view, 'Signer type was not provided'), 'Authenticated malformed-action error unavailable', 15);
  record('malformed_authenticated_action_shows_error_without_connect_modal', !includes(malformed, 'Connect Ledger'));
  send(encrypt(key, request));
  const valid = await until(view => includes(view, 'Connect Ledger'), 'Valid encrypted request did not open Connect Ledger', 15);
  record('valid_encrypted_add_device_opens_connect_ledger', !includes(valid, 'Signer type was not provided'));
  record('native_process_remains_running', app.exitCode === null);
  report.state = 'PASSED_DESKTOP_ONLY';
} catch (error) {
  // Only fixed labels are emitted; screen contents, QR keys and rooms stay private.
  report.state = 'BLOCKED_OR_FAILED';
  const label = String(error.message);
  const fixedLabels = new Set([
    ...Object.keys(report.tests),
    'Welcome/channel readiness unavailable', 'QR readiness/click unavailable',
    'Disposable channel sender unavailable', 'Authenticated malformed-action error unavailable',
    'Valid encrypted request did not open Connect Ledger',
  ]);
  report.failure = fixedLabels.has(label) ? label : 'Cloud runner/tool failure; no private UI data preserved';
  process.exitCode = 1;
} finally {
  socket?.disconnect();
  app?.kill('SIGTERM');
  rmSync(screenshot, { force: true });
  writeFileSync(join(evidence, 'desktop-cloud-smoke.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
