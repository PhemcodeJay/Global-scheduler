const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'gonest.db');
const raw = new DatabaseSync(dbPath);
const db = {
  prepare: (...args) => raw.prepare(...args),
  exec: (...args) => raw.exec(...args),
  close: () => raw.close(),
  pragma: statement => raw.exec(`PRAGMA ${statement}`),
  transaction: fn => (...args) => {
    raw.exec('BEGIN');
    try { const result = fn(...args); raw.exec('COMMIT'); return result; }
    catch (error) { raw.exec('ROLLBACK'); throw error; }
  }
};
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, role TEXT DEFAULT 'user', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, service_name TEXT NOT NULL, description TEXT,
    date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
    capacity INTEGER DEFAULT 1 CHECK(capacity > 0), booked_count INTEGER DEFAULT 0 CHECK(booked_count >= 0),
    status TEXT DEFAULT 'available', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, slot_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    client_name TEXT NOT NULL, client_email TEXT NOT NULL, client_phone TEXT, notes TEXT,
    status TEXT DEFAULT 'confirmed', date_of_birth TEXT, gender TEXT, nationality TEXT,
    passport_number TEXT, passport_expiry TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (slot_id) REFERENCES slots(id), FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS auto_book_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL,
    is_enabled INTEGER DEFAULT 0, preferred_services TEXT, preferred_times TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);
const fixedServiceTimes = new Map([
  ['Business Consultation', { start: '09:00', end: '10:00' }],
  ['Visa Processing Help', { start: '10:00', end: '10:30' }],
  ['Immigration Advisory', { start: '11:00', end: '11:45' }],
  ['Document Verification', { start: '13:00', end: '13:20' }],
  ['Passport Services', { start: '14:00', end: '14:30' }]
]);

// Normalize every service to one daily slot. Existing appointments are moved
// to the keeper slot before the other rows are removed.
const serviceDayGroups = db.prepare(`
  SELECT service_name, date, MIN(id) AS keep_id
  FROM slots
  GROUP BY service_name, date
  HAVING COUNT(*) > 1
`).all();
if (serviceDayGroups.length) {
  db.transaction(() => {
    const findSlots = db.prepare('SELECT * FROM slots WHERE service_name = ? AND date = ? ORDER BY id');
    const moveAppointments = db.prepare('UPDATE appointments SET slot_id = ? WHERE slot_id = ?');
    const deleteSlot = db.prepare('DELETE FROM slots WHERE id = ?');
    const updateKeeper = db.prepare('UPDATE slots SET start_time = ?, end_time = ?, capacity = ?, booked_count = ?, status = ? WHERE id = ?');
    for (const group of serviceDayGroups) {
      const rows = findSlots.all(group.service_name, group.date);
      const keeper = rows.find(row => row.id === group.keep_id) || rows[0];
      const fixed = fixedServiceTimes.get(group.service_name);
      const start = fixed ? fixed.start : rows[0].start_time;
      const end = fixed ? fixed.end : rows[0].end_time;
      for (const row of rows) {
        if (row.id === keeper.id) continue;
        moveAppointments.run(keeper.id, row.id);
        deleteSlot.run(row.id);
      }
      const confirmed = db.prepare("SELECT COUNT(*) AS count FROM appointments WHERE slot_id = ? AND status = 'confirmed'").get(keeper.id).count;
      const capacity = Math.max(keeper.capacity, ...rows.map(row => row.capacity), confirmed);
      updateKeeper.run(start, end, capacity, confirmed, confirmed >= capacity ? 'booked' : 'available', keeper.id);
    }
  })();
}

// A service can have only one availability slot on a given day.
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_slots_unique_service_date
  ON slots(service_name, date)`);

const columns = new Set(db.prepare('PRAGMA table_info(appointments)').all().map(column => column.name));
for (const [name, type] of [
  ['date_of_birth', 'TEXT'], ['gender', 'TEXT'], ['nationality', 'TEXT'],
  ['passport_number', 'TEXT'], ['passport_expiry', 'TEXT']
]) if (!columns.has(name)) db.exec(`ALTER TABLE appointments ADD COLUMN ${name} ${type}`);

function seedData() {
  const bcrypt = require('bcryptjs');
  const email = (process.env.ADMIN_EMAIL || 'admin@gonest.com').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare(`INSERT INTO users (name,email,password,role) VALUES (?,?,?,'admin')
    ON CONFLICT(email) DO UPDATE SET role='admin'`).run('Admin User', email, bcrypt.hashSync(password, 10));
  if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count <= 1 && process.env.SEED_DEMO_DATA === 'true') {
    const hash = bcrypt.hashSync('user123', 10);
    db.prepare('INSERT OR IGNORE INTO users (name,email,password,role) VALUES (?,?,?,?)').run('John Doe','john@example.com',hash,'user');
    db.prepare('INSERT OR IGNORE INTO users (name,email,password,role) VALUES (?,?,?,?)').run('Sarah Johnson','sarah@example.com',hash,'user');
  }
  for (const user of db.prepare('SELECT id FROM users').all()) {
    db.prepare('INSERT OR IGNORE INTO auto_book_settings (user_id,is_enabled) VALUES (?,0)').run(user.id);
  }
  if (db.prepare('SELECT COUNT(*) AS count FROM slots').get().count) return;
  const services = [
    ['Business Consultation',60,'One-on-one business advisory session'], ['Visa Processing Help',30,'Assistance with visa application process'],
    ['Immigration Advisory',45,'Expert guidance on immigration matters'], ['Document Verification',20,'Verify and authenticate your documents'],
    ['Passport Services',30,'Passport application and renewal help']
  ];
  for (let day = 0; day < 7; day++) {
    const d = new Date(); d.setDate(d.getDate() + day);
    const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    services.forEach(([name, duration, description]) => {
      const fixed = fixedServiceTimes.get(name);
      db.prepare(`INSERT INTO slots (service_name,description,date,start_time,end_time,capacity,booked_count,status)
        VALUES (?,?,?,?,?,1,0,'available')`).run(name, description, date, fixed.start, fixed.end);
    });
  }
  console.log('Database seeded with Gonest International demo data');
}
seedData();
module.exports = db;
