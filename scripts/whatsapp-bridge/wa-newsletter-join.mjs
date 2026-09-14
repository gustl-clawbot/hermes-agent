import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
const logger = pino({ level: 'warn' });

const SESSION_DIR = '/home/gustl/.hermes/whatsapp/session';
// Mehrere Invite-Codes: node wa-newsletter-join.mjs <code1> [code2 ...]
const INVITE_CODES = process.argv.slice(2);
if (INVITE_CODES.length === 0) {
  console.log('Usage: node wa-newsletter-join.mjs <invite-code> [more...]');
  process.exit(1);
}
const log = (x) => console.log(x);

const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
const version = await fetchLatestBaileysVersion();
const sock = makeWASocket({
  version: version.version,
  auth: state,
  printQRInTerminal: false,
  browser: ['Hermes Agent', 'Chrome', '120.0'],
  syncFullHistory: false,
  markOnlineOnConnect: false,
  getMessage: async () => ({ conversation: '' }),
  logger,
});

let connected = false;
sock.ev.on('connection.update', (u) => {
  if (u.connection === 'open') connected = true;
  if (u.connection === 'close') {
    const code = new Boom(u.lastDisconnect?.error)?.output?.statusCode;
    log('CLOSE code=' + code);
    process.exit(2);
  }
});
sock.ev.on('creds.update', saveCreds);

// wait for open
for (let i = 0; i < 60 && !connected; i++) {
  await new Promise(r => setTimeout(r, 1000));
}
if (!connected) { log('NO CONNECTION'); process.exit(1); }
log('CONNECTED');

// connect + für jeden Invite-Code: resolve → follow → verify
for (const INVITE_CODE of INVITE_CODES) {
  log('--- Kanal: ' + INVITE_CODE + ' ---');
  // 1. resolve invite -> newsletter jid
  let meta = null;
  try {
    meta = await sock.newsletterMetadata('invite', INVITE_CODE);
    log('META invite: ' + JSON.stringify({ id: meta?.id, name: meta?.name, subscribers: meta?.subscribers }));
  } catch (e) {
    log('META ERROR: ' + e.message); continue;
  }
  if (!meta?.id) { log('NO JID RESOLVED'); continue; }
  const nid = meta.id;

  // 2. follow
  try {
    const res = await sock.newsletterFollow(nid);
    log('FOLLOW result: ' + JSON.stringify(res).slice(0, 500));
  } catch (e) {
    log('FOLLOW ERROR: ' + JSON.stringify({ message: e.message, status: e.status }).slice(0, 500));
    // fall through: verify anyway
  }

  // 3. verify subscribed state
  try {
    const v = await sock.newsletterMetadata('jid', nid);
    log('VERIFY meta jid: ' + JSON.stringify({ id: v?.id, name: v?.name, viewer: v?.viewer_metadata ?? v?.viewer }));
  } catch (e) {
    log('VERIFY ERROR: ' + e.message);
  }
}

sock.end(undefined);
process.exit(0);
