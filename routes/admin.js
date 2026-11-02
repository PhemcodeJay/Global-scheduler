const express = require('express');
const db = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const MANAGED_APPOINTMENT_STATUSES = new Set(['confirmed', 'completed', 'no_show', 'cancelled']);
router.use(authenticateToken);
router.use(requireAdmin);

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function count(sql, ...params) {
  return Number(db.prepare(sql).get(...params).count);
}

router.get('/stats', (req, res) => {
  try {
    res.json({
      totalUsers: count('SELECT COUNT(*) AS count FROM users'),
      activeUsers: count("SELECT COUNT(*) AS count FROM users WHERE datetime(created_at) >= datetime('now', '-30 days')"),
      totalSlots: count('SELECT COUNT(*) AS count FROM slots'),
      availableSlots: count("SELECT COUNT(*) AS count FROM slots WHERE status = 'available' AND booked_count < capacity"),
      bookedSlots: count("SELECT COUNT(*) AS count FROM slots WHERE status = 'booked' OR booked_count >= capacity"),
      totalAppointments: count("SELECT COUNT(*) AS count FROM appointments WHERE status != 'cancelled'"),
      todayAppointments: count(`SELECT COUNT(*) AS count FROM appointments a JOIN slots s ON s.id = a.slot_id
        WHERE a.status != 'cancelled' AND s.date = date('now')`),
      cancelledAppointments: count("SELECT COUNT(*) AS count FROM appointments WHERE status = 'cancelled'")
    });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.get('/users', (req, res) => {
  try {
    const { role } = req.query;
    if (role && !['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const query = role
      ? 'SELECT id, name, email, role, created_at FROM users WHERE role = ? ORDER BY created_at DESC, id DESC'
      : 'SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC, id DESC';
    res.json(db.prepare(query).all(...(role ? [role] : [])));
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.put('/users/:id/role', (req, res) => {
  const userId = parseId(req.params.id);
  if (!userId) return res.status(400).json({ error: 'Invalid user ID' });
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Role must be user or admin' });
    const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'admin' && role === 'user' && count("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'") <= 1) {
      return res.status(409).json({ error: 'The last admin cannot be demoted' });
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    res.json(db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(userId));
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

router.delete('/users/:id', (req, res) => {
  const userId = parseId(req.params.id);
  if (!userId) return res.status(400).json({ error: 'Invalid user ID' });
  try {
    if (userId === Number(req.user.id)) return res.status(400).json({ error: 'Cannot delete your own account' });
    const target = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const appointmentCount = count('SELECT COUNT(*) AS count FROM appointments WHERE user_id = ?', userId);
    if (appointmentCount) return res.status(409).json({ error: 'Users with appointment history cannot be deleted', appointments: appointmentCount });
    if (target.role === 'admin' && count("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'") <= 1) {
      return res.status(409).json({ error: 'The last admin cannot be deleted' });
    }
    db.transaction(() => {
      db.prepare('DELETE FROM auto_book_settings WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    })();
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

router.get('/slots', (req, res) => {
  try {
    const { date, status } = req.query;
    const conditions = [];
    const params = [];
    if (date) { conditions.push('date = ?'); params.push(date); }
    if (status) {
      if (!['available', 'booked'].includes(status)) return res.status(400).json({ error: 'Invalid slot status' });
      conditions.push('status = ?'); params.push(status);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    res.json(db.prepare(`SELECT * FROM slots${where} ORDER BY date DESC, start_time`).all(...params));
  } catch (error) {
    console.error('Error fetching admin slots:', error);
    res.status(500).json({ error: 'Failed to fetch slots' });
  }
});

router.get('/appointments', (req, res) => {
  try {
    const { status, date, search } = req.query;
    const conditions = [];
    const params = [];
    if (status) {
      if (!MANAGED_APPOINTMENT_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid appointment status' });
      conditions.push('a.status = ?'); params.push(status);
    }
    if (date) { conditions.push('s.date = ?'); params.push(date); }
    if (search && search.trim()) {
      conditions.push(`(a.client_name LIKE ? OR a.client_email LIKE ? OR a.passport_number LIKE ? OR s.service_name LIKE ?)`);
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }
    let query = `SELECT a.*, s.service_name, s.date, s.start_time, s.end_time,
      s.status AS slot_status, s.capacity, s.booked_count
      FROM appointments a JOIN slots s ON s.id = a.slot_id`;
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ` ORDER BY CASE a.status WHEN 'confirmed' THEN 1 WHEN 'completed' THEN 2
      WHEN 'no_show' THEN 3 ELSE 4 END, s.date, s.start_time, a.id DESC`;
    res.json(db.prepare(query).all(...params));
  } catch (error) {
    console.error('Error fetching managed appointments:', error);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

router.patch('/appointments/:id/status', (req, res) => {
  const appointmentId = parseId(req.params.id);
  if (!appointmentId) return res.status(400).json({ error: 'Invalid appointment ID' });
  try {
    const status = req.body.status;
    if (!MANAGED_APPOINTMENT_STATUSES.has(status)) {
      return res.status(400).json({ error: 'Status must be confirmed, completed, no_show, or cancelled' });
    }
    const result = db.transaction(() => {
      const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId);
      if (!appointment) return { error: 'Appointment not found', code: 404 };
      const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(appointment.slot_id);
      if (!slot) return { error: 'Appointment slot not found', code: 409 };
      if (status === 'confirmed' && appointment.status !== 'confirmed' && slot.booked_count >= slot.capacity) {
        return { error: 'This slot is full; the cancelled booking cannot be restored', code: 409 };
      }
      if (status === appointment.status) return { appointmentId, unchanged: true };
      db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(status, appointmentId);
      const confirmedCount = count("SELECT COUNT(*) AS count FROM appointments WHERE slot_id = ? AND status = 'confirmed'", appointment.slot_id);
      db.prepare('UPDATE slots SET booked_count = ?, status = ? WHERE id = ?')
        .run(confirmedCount, confirmedCount >= slot.capacity ? 'booked' : 'available', appointment.slot_id);
      return { appointmentId };
    })();
    if (result.error) return res.status(result.code).json({ error: result.error });
    const appointment = db.prepare(`SELECT a.*, s.service_name, s.date, s.start_time, s.end_time,
      s.status AS slot_status, s.capacity, s.booked_count
      FROM appointments a JOIN slots s ON s.id = a.slot_id WHERE a.id = ?`).get(appointmentId);
    res.json({ message: `Appointment marked as ${status.replace('_', ' ')}`, appointment });
  } catch (error) {
    console.error('Error updating managed appointment:', error);
    res.status(500).json({ error: 'Failed to update appointment' });
  }
});

module.exports = router;
