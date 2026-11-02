// Gonest International - full-stack auto-book regression test.
// Requires the application to be running at http://localhost:3000.
// Checks rules persistence, settings validation, service-list routing, and
// push-triggered booking latency against the 3,000ms target.
const db = require('./config/database');
const bcrypt = require('bcryptjs');

const BASE = 'http://localhost:3000';
const TEST_SERVICE = `SLA Speed Test ${Date.now()}`;
const TEST_EMAIL = `speedtest-${Date.now()}@example.com`;

async function api(path, options = {}, token) {
  const response = await fetch(BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  return { response, data: await response.json() };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  let testUserId;
  let slotId;
  const enabledBeforeTest = db.prepare('SELECT user_id FROM auto_book_settings WHERE is_enabled = 1')
    .all().map(row => row.user_id);

  try {
    const adminLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@gonest.com', password: 'admin123' })
    });
    assert(adminLogin.response.ok && adminLogin.data.token, 'Admin login failed');

    // A unique service keeps this test isolated from real customer rules.
    db.prepare('UPDATE auto_book_settings SET is_enabled = 0 WHERE is_enabled = 1').run();
    const createdUser = db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run('Speed Test', TEST_EMAIL, bcrypt.hashSync('test123', 10), 'user');
    testUserId = Number(createdUser.lastInsertRowid);
    db.prepare('INSERT INTO auto_book_settings (user_id, is_enabled, preferred_services, preferred_times) VALUES (?, 0, ?, ?)')
      .run(testUserId, JSON.stringify([TEST_SERVICE]), JSON.stringify(['morning']));

    const userLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: TEST_EMAIL, password: 'test123' })
    });
    assert(userLogin.response.ok && userLogin.data.token, 'Test user login failed');
    const userToken = userLogin.data.token;

    const services = await api('/api/slots/services/list', {}, userToken);
    assert(services.response.ok && Array.isArray(services.data), 'Service list route did not return an array');

    const settings = await api('/api/auto-book/settings', {}, userToken);
    assert(settings.response.ok && settings.data.preferred_services[0] === TEST_SERVICE,
      'Stored service preferences were not returned as an array');

    const adminToggle = await api(`/api/admin/settings/${testUserId}`, {
      method: 'PUT', body: JSON.stringify({ is_enabled: false })
    }, adminLogin.data.token);
    assert(adminToggle.response.ok, 'Admin setting toggle failed');
    const preserved = await api('/api/auto-book/settings', {}, userToken);
    assert(preserved.data.preferred_services[0] === TEST_SERVICE && preserved.data.preferred_times[0] === 'morning',
      'Admin toggle erased client preferences');

    const invalid = await api('/api/auto-book/settings', {
      method: 'PUT', body: JSON.stringify({ preferred_times: ['not-a-time'] })
    }, userToken);
    assert(!invalid.response.ok, 'Invalid time preference was accepted');

    const enabled = await api('/api/auto-book/settings', {
      method: 'PUT', body: JSON.stringify({ is_enabled: true })
    }, userToken);
    assert(enabled.response.ok && enabled.data.is_enabled === 1, 'Could not enable test monitor');

    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const started = Date.now();
    const createdSlot = await api('/api/slots', {
      method: 'POST',
      body: JSON.stringify({
        service_name: TEST_SERVICE, description: 'push SLA regression test',
        date: tomorrow, start_time: '09:30', end_time: '10:30', capacity: 1
      })
    }, adminLogin.data.token);
    assert(createdSlot.response.ok && createdSlot.data.id, 'Slot creation failed');
    slotId = Number(createdSlot.data.id);

    let appointment;
    while (Date.now() - started < 6000) {
      appointment = db.prepare("SELECT * FROM appointments WHERE slot_id = ? AND status = 'confirmed'").get(slotId);
      if (appointment) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const elapsed = Date.now() - started;
    assert(appointment && appointment.client_email === TEST_EMAIL, 'Matching slot was not auto-booked');
    assert(elapsed < 3000, `Auto-book exceeded SLA: ${elapsed}ms`);
    console.log(`PASS: settings, rule validation, service list, and push auto-book in ${elapsed}ms (< 3000ms).`);
  } finally {
    if (slotId) db.prepare('DELETE FROM appointments WHERE slot_id = ?').run(slotId);
    if (slotId) db.prepare('DELETE FROM slots WHERE id = ?').run(slotId);
    if (testUserId) {
      db.prepare('DELETE FROM auto_book_settings WHERE user_id = ?').run(testUserId);
      db.prepare('DELETE FROM users WHERE id = ?').run(testUserId);
    }
    for (const id of enabledBeforeTest) {
      db.prepare('UPDATE auto_book_settings SET is_enabled = 1 WHERE user_id = ?').run(id);
    }
    console.log(`Cleanup complete; re-enabled ${enabledBeforeTest.length} existing monitor(s).`);
  }
})().catch(error => {
  console.error('FAIL:', error.message);
  process.exitCode = 1;
});
