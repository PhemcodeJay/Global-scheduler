// Quick verification: loads config/database.js (creates tables + seeds), then reports counts
try {
  const db = require('./config/database');
  const users = db.prepare('SELECT COUNT(*) as c FROM users').get();
  const slots = db.prepare('SELECT COUNT(*) as c FROM slots').get();
  const admin = db.prepare('SELECT email, role FROM users WHERE role = ?').get('admin');
  console.log('DB OK');
  console.log('users=' + users.c);
  console.log('slots=' + slots.c);
  console.log('admin=' + (admin ? admin.email : 'MISSING'));
  process.exit(0);
} catch (err) {
  console.error('DB FAIL:', err.message);
  process.exit(1);
}
