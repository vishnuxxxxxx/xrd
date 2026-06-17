/**
 * RELAY — Social Media Operations Team
 * Backend server. Built with Node.js core modules only — no `npm install` required.
 *
 * Run with:  node server.js
 * Config via environment variables (see .env.example):
 *   PORT                  - port to listen on (default 3000)
 *   SESSION_SECRET        - secret used to sign session cookies
 *   TELEGRAM_BOT_TOKEN    - Telegram bot token from @BotFather
 *   TELEGRAM_CHAT_ID      - chat/group/channel id the bot should post to
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Config / .env loading (no dependency — tiny manual parser)
// ---------------------------------------------------------------------------
function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile();

const PORT = parseInt(process.env.PORT || '3000', 10);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MEMBERS_FILE = path.join(DATA_DIR, 'members.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');
const RECRUITS_FILE = path.join(DATA_DIR, 'recruits.json');

// ---------------------------------------------------------------------------
// Tiny JSON "database" helpers
// ---------------------------------------------------------------------------
function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[db] failed to read ${file}:`, err.message);
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function initDataStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(MEMBERS_FILE)) {
    const seedFile = path.join(DATA_DIR, 'members.seed.json');
    const seed = fs.existsSync(seedFile) ? readJSON(seedFile, []) : [];
    writeJSON(MEMBERS_FILE, seed);
  }

  if (!fs.existsSync(REPORTS_FILE)) writeJSON(REPORTS_FILE, []);
  if (!fs.existsSync(RECRUITS_FILE)) writeJSON(RECRUITS_FILE, []);

  if (!fs.existsSync(ADMIN_FILE)) {
    const defaultPassword = 'ChangeMe123!';
    const { salt, hash } = hashPassword(defaultPassword);
    writeJSON(ADMIN_FILE, { username: 'admin', salt, hash });
    console.log('============================================================');
    console.log(' RELAY — first run: a default admin account was created.');
    console.log('   username: admin');
    console.log(`   password: ${defaultPassword}`);
    console.log(' Change this immediately:');
    console.log('   node scripts/set-admin-password.js <new-password>');
    console.log('============================================================');
  }
}

// ---------------------------------------------------------------------------
// Password hashing (PBKDF2 — core `crypto`, no bcrypt dependency needed)
// ---------------------------------------------------------------------------
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

// ---------------------------------------------------------------------------
// Sessions — signed, in-memory tokens (fine for a single-process small team app)
// ---------------------------------------------------------------------------
const sessions = new Map(); // token -> { username, expires }
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, expires: Date.now() + SESSION_TTL_MS });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expires) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  sessions.delete(token);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Telegram integration
// ---------------------------------------------------------------------------
async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[telegram] not configured — message would have been:\n' + text);
    return { ok: false, reason: 'not_configured' };
  }
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
      }),
    });
    const json = await res.json();
    if (!json.ok) console.error('[telegram] API error:', json.description);
    return json;
  } catch (err) {
    console.error('[telegram] request failed:', err.message);
    return { ok: false, reason: err.message };
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------
function sendJSON(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    const MAX = 1024 * 1024; // 1MB cap
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function requireAuth(req) {
  const cookies = parseCookies(req);
  const session = getSession(cookies.relay_session);
  return session;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, urlPath) {
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  if (filePath === '/admin') filePath = '/admin.html';
  const fullPath = path.normalize(path.join(PUBLIC_DIR, filePath));

  // Prevent path traversal outside the public directory
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
function isNonEmptyString(v, maxLen = 2000) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen;
}

function sanitizeMemberPublic(m) {
  return { id: m.id, memberId: m.memberId, name: m.name, role: m.role, status: m.status };
}

function nextNumericId(prefix, list) {
  let max = 0;
  list.forEach((item) => {
    const match = String(item.memberId || '').match(/(\d+)$/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  });
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------
async function handleApi(req, res, urlPath, query) {
  // ---- Public: roster (sanitized) ----
  if (urlPath === '/api/members' && req.method === 'GET') {
    const members = readJSON(MEMBERS_FILE, []);
    return sendJSON(res, 200, { members: members.map(sanitizeMemberPublic) });
  }

  // ---- Public: member ID check ----
  if (urlPath === '/api/verify-id' && req.method === 'POST') {
    const body = await readBody(req);
    const memberId = (body.memberId || '').trim();
    if (!isNonEmptyString(memberId, 50)) {
      return sendJSON(res, 400, { valid: false, error: 'Enter a member ID to check.' });
    }
    const members = readJSON(MEMBERS_FILE, []);
    const found = members.find(
      (m) => m.memberId.toLowerCase() === memberId.toLowerCase()
    );
    if (!found) {
      return sendJSON(res, 200, { valid: false });
    }
    return sendJSON(res, 200, {
      valid: true,
      member: { memberId: found.memberId, name: found.name, role: found.role, status: found.status },
    });
  }

  // ---- Public: recruitment submission ----
  if (urlPath === '/api/recruit' && req.method === 'POST') {
    const body = await readBody(req);
    const { name, email, phone, platforms, availability, message } = body;
    if (!isNonEmptyString(name, 120) || !isNonEmptyString(email, 200) || !isNonEmptyString(message, 4000)) {
      return sendJSON(res, 400, { error: 'Name, email, and message are required.' });
    }
    const recruits = readJSON(RECRUITS_FILE, []);
    const entry = {
      id: crypto.randomUUID(),
      name: name.trim(),
      email: email.trim(),
      phone: typeof phone === 'string' ? phone.trim() : '',
      platforms: Array.isArray(platforms) ? platforms.filter((p) => typeof p === 'string') : [],
      availability: typeof availability === 'string' ? availability.trim() : '',
      message: message.trim(),
      status: 'New',
      submittedAt: new Date().toISOString(),
    };
    recruits.unshift(entry);
    writeJSON(RECRUITS_FILE, recruits);

    sendTelegramMessage(
      `<b>New recruitment application</b>\n` +
      `Name: ${escapeHtml(entry.name)}\n` +
      `Email: ${escapeHtml(entry.email)}\n` +
      (entry.phone ? `Phone: ${escapeHtml(entry.phone)}\n` : '') +
      (entry.platforms.length ? `Platforms: ${escapeHtml(entry.platforms.join(', '))}\n` : '') +
      (entry.availability ? `Availability: ${escapeHtml(entry.availability)}\n` : '') +
      `Message: ${escapeHtml(entry.message)}`
    );

    return sendJSON(res, 201, { ok: true });
  }

  // ---- Public: problem report -> notifies Telegram ----
  if (urlPath === '/api/report' && req.method === 'POST') {
    const body = await readBody(req);
    const { name, contact, category, urgency, description } = body;
    if (!isNonEmptyString(name, 120) || !isNonEmptyString(description, 4000)) {
      return sendJSON(res, 400, { error: 'Name and description are required.' });
    }
    const reports = readJSON(REPORTS_FILE, []);
    const entry = {
      id: crypto.randomUUID(),
      name: name.trim(),
      contact: typeof contact === 'string' ? contact.trim() : '',
      category: isNonEmptyString(category, 60) ? category.trim() : 'Other',
      urgency: isNonEmptyString(urgency, 30) ? urgency.trim() : 'Normal',
      description: description.trim(),
      status: 'Open',
      submittedAt: new Date().toISOString(),
    };
    reports.unshift(entry);
    writeJSON(REPORTS_FILE, reports);

    await sendTelegramMessage(
      `<b>⚠ New problem report</b> [${escapeHtml(entry.urgency)}]\n` +
      `From: ${escapeHtml(entry.name)}\n` +
      (entry.contact ? `Contact: ${escapeHtml(entry.contact)}\n` : '') +
      `Category: ${escapeHtml(entry.category)}\n` +
      `Details: ${escapeHtml(entry.description)}`
    );

    return sendJSON(res, 201, { ok: true });
  }

  // ---- Admin: login ----
  if (urlPath === '/api/admin/login' && req.method === 'POST') {
    const body = await readBody(req);
    const { username, password } = body;
    const admin = readJSON(ADMIN_FILE, null);
    if (!admin || !isNonEmptyString(username, 80) || !isNonEmptyString(password, 200)) {
      return sendJSON(res, 400, { error: 'Username and password are required.' });
    }
    if (username !== admin.username || !verifyPassword(password, admin.salt, admin.hash)) {
      return sendJSON(res, 401, { error: 'Incorrect username or password.' });
    }
    const token = createSession(admin.username);
    res.setHeader(
      'Set-Cookie',
      `relay_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`
    );
    return sendJSON(res, 200, { ok: true, username: admin.username });
  }

  // ---- Admin: logout ----
  if (urlPath === '/api/admin/logout' && req.method === 'POST') {
    const cookies = parseCookies(req);
    destroySession(cookies.relay_session);
    res.setHeader('Set-Cookie', 'relay_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return sendJSON(res, 200, { ok: true });
  }

  // ---- Admin: current session check ----
  if (urlPath === '/api/admin/session' && req.method === 'GET') {
    const session = requireAuth(req);
    return sendJSON(res, 200, { authenticated: !!session, username: session ? session.username : null });
  }

  // From here on, every route requires a valid admin session.
  if (urlPath.startsWith('/api/admin/')) {
    const session = requireAuth(req);
    if (!session) {
      return sendJSON(res, 401, { error: 'Not authenticated.' });
    }

    // ---- Admin: full member roster ----
    if (urlPath === '/api/admin/members' && req.method === 'GET') {
      return sendJSON(res, 200, { members: readJSON(MEMBERS_FILE, []) });
    }

    // ---- Admin: add member ----
    if (urlPath === '/api/admin/members' && req.method === 'POST') {
      const body = await readBody(req);
      const { name, role } = body;
      if (!isNonEmptyString(name, 120) || !isNonEmptyString(role, 120)) {
        return sendJSON(res, 400, { error: 'Name and role are required.' });
      }
      const members = readJSON(MEMBERS_FILE, []);
      const newMember = {
        id: crypto.randomUUID(),
        memberId: nextNumericId('RLY', members),
        name: name.trim(),
        role: role.trim(),
        status: body.status === 'Offline' ? 'Offline' : 'Active',
      };
      members.push(newMember);
      writeJSON(MEMBERS_FILE, members);
      return sendJSON(res, 201, { member: newMember });
    }

    // ---- Admin: update / delete a specific member ----
    const memberMatch = urlPath.match(/^\/api\/admin\/members\/([^/]+)$/);
    if (memberMatch) {
      const memberDbId = memberMatch[1];
      const members = readJSON(MEMBERS_FILE, []);
      const idx = members.findIndex((m) => m.id === memberDbId);

      if (req.method === 'PUT') {
        if (idx === -1) return sendJSON(res, 404, { error: 'Member not found.' });
        const body = await readBody(req);
        if (isNonEmptyString(body.name, 120)) members[idx].name = body.name.trim();
        if (isNonEmptyString(body.role, 120)) members[idx].role = body.role.trim();
        if (body.status === 'Active' || body.status === 'Offline') members[idx].status = body.status;
        writeJSON(MEMBERS_FILE, members);
        return sendJSON(res, 200, { member: members[idx] });
      }

      if (req.method === 'DELETE') {
        if (idx === -1) return sendJSON(res, 404, { error: 'Member not found.' });
        const [removed] = members.splice(idx, 1);
        writeJSON(MEMBERS_FILE, members);
        return sendJSON(res, 200, { ok: true, removed });
      }
    }

    // ---- Admin: reports ----
    if (urlPath === '/api/admin/reports' && req.method === 'GET') {
      return sendJSON(res, 200, { reports: readJSON(REPORTS_FILE, []) });
    }

    const reportMatch = urlPath.match(/^\/api\/admin\/reports\/([^/]+)$/);
    if (reportMatch && req.method === 'PUT') {
      const body = await readBody(req);
      const reports = readJSON(REPORTS_FILE, []);
      const idx = reports.findIndex((r) => r.id === reportMatch[1]);
      if (idx === -1) return sendJSON(res, 404, { error: 'Report not found.' });
      if (isNonEmptyString(body.status, 30)) reports[idx].status = body.status.trim();
      writeJSON(REPORTS_FILE, reports);
      return sendJSON(res, 200, { report: reports[idx] });
    }

    // ---- Admin: recruitment submissions ----
    if (urlPath === '/api/admin/recruits' && req.method === 'GET') {
      return sendJSON(res, 200, { recruits: readJSON(RECRUITS_FILE, []) });
    }

    const recruitMatch = urlPath.match(/^\/api\/admin\/recruits\/([^/]+)$/);
    if (recruitMatch && req.method === 'PUT') {
      const body = await readBody(req);
      const recruits = readJSON(RECRUITS_FILE, []);
      const idx = recruits.findIndex((r) => r.id === recruitMatch[1]);
      if (idx === -1) return sendJSON(res, 404, { error: 'Application not found.' });
      if (isNonEmptyString(body.status, 30)) recruits[idx].status = body.status.trim();
      writeJSON(RECRUITS_FILE, recruits);
      return sendJSON(res, 200, { recruit: recruits[idx] });
    }

    return sendJSON(res, 404, { error: 'Unknown admin route.' });
  }

  return sendJSON(res, 404, { error: 'Unknown route.' });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
initDataStore();

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const urlPath = decodeURIComponent(parsedUrl.pathname);

    if (urlPath.startsWith('/api/')) {
      await handleApi(req, res, urlPath, parsedUrl.searchParams);
      return;
    }

    serveStatic(req, res, urlPath);
  } catch (err) {
    console.error('[server] error handling request:', err);
    sendJSON(res, 500, { error: 'Internal server error.' });
  }
});

server.listen(PORT, () => {
  console.log(`RELAY server running at http://localhost:${PORT}`);
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — reports will log to console instead of sending.');
  }
});
