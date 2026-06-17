/**
 * Set or reset the RELAY admin password.
 * Usage: node scripts/set-admin-password.js <new-password> [new-username]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ADMIN_FILE = path.join(__dirname, '..', 'data', 'admin.json');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

const [, , newPassword, newUsername] = process.argv;

if (!newPassword || newPassword.length < 8) {
  console.error('Usage: node scripts/set-admin-password.js <new-password> [new-username]');
  console.error('The password must be at least 8 characters.');
  process.exit(1);
}

let admin = { username: 'admin' };
if (fs.existsSync(ADMIN_FILE)) {
  try {
    admin = JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8'));
  } catch (err) {
    console.warn('Could not read existing admin.json, creating a fresh one.');
  }
}

if (newUsername) admin.username = newUsername;
const { salt, hash } = hashPassword(newPassword);
admin.salt = salt;
admin.hash = hash;

fs.mkdirSync(path.dirname(ADMIN_FILE), { recursive: true });
fs.writeFileSync(ADMIN_FILE, JSON.stringify(admin, null, 2), 'utf8');

console.log(`Admin credentials updated. Username: ${admin.username}`);
