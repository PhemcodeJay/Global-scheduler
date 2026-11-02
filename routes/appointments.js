const express = require('express');
const db = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const router = express.Router();

function selectedAppointment(id) {
  return db.prepare(`SELECT a.*, s.service_name, s.date, s.start_time, s.end_time,
    s.status AS slot_status FROM appointments a JOIN slots s ON s.id = a.slot_id WHERE a.id = ?`).get(id);
}
function syncSlot(slotId) {
  const slot = db.prepare('SELECT capacity FROM slots WHERE id = ?').get(slotId);
  if (!slot) return;
  const count = db.prepare("SELECT COUNT(*) AS count FROM appointments WHERE slot_id = ? AND status = 'confirmed'").get(slotId).count;
  db.prepare('UPDATE slots SET booked_count = ?, status = ? WHERE id = ?')
    .run(count, count >= slot.capacity ? 'booked' : 'available', slotId);
}

router.get('/', authenticateToken, (req, res) => {
  const query = req.user.role === 'admin'
    ? `SELECT a.*, s.service_name, s.date, s.start_time, s.end_time, s.status AS slot_status
       FROM appointments a JOIN slots s ON s.id = a.slot_id ORDER BY a.created_at DESC`
    : `SELECT a.*, s.service_name, s.date, s.start_time, s.end_time, s.status AS slot_status
       FROM appointments a JOIN slots s ON s.id = a.slot_id WHERE a.user_id = ? ORDER BY a.created_at DESC`;
  const rows = req.user.role === 'admin' ? db.prepare(query).all() : db.prepare(query).all(req.user.id);
  res.json(rows);
});

router.post('/', authenticateToken, (req, res) => {
  const startedAt = Date.now();
  if (req.user.role === 'admin') return res.status(403).json({ error: 'Admins manage booked appointments from the admin panel' });
  const body = req.body;
  const slotId = Number(body.slot_id);
  const name = typeof body.client_name === 'string' ? body.client_name.trim() : '';
  const email = typeof body.client_email === 'string' ? body.client_email.trim().toLowerCase() : '';
  const dob = typeof body.date_of_birth === 'string' ? body.date_of_birth : '';
  const nationality = typeof body.nationality === 'string' ? body.nationality.trim() : '';
  const passport = typeof body.passport_number === 'string' ? body.passport_number.trim().toUpperCase() : '';
  if (!Number.isSafeInteger(slotId) || slotId < 1 || !name || !email) return res.status(400).json({ error: 'Slot, client name, and email are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid client email' });
  if (name.length > 100 || email.length > 254 || nationality.length > 100) return res.status(400).json({ error: 'Client details are too long' });
  if (!dob || dob > new Date().toISOString().slice(0,10)) return res.status(400).json({ error: 'A valid date of birth is required' });
  if (!nationality) return res.status(400).json({ error: 'Nationality is required' });
  if (!/^[A-Z0-9]{5,20}$/.test(passport)) return res.status(400).json({ error: 'Passport number must be 5-20 letters or numbers' });
  if (body.passport_expiry && !/^\d{4}-\d{2}-\d{2}$/.test(body.passport_expiry)) return res.status(400).json({ error: 'Passport expiry is invalid' });

  let appointmentId;
  try {
    db.transaction(() => {
      const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId);
      if (!slot) throw Object.assign(new Error('Slot not found'), { status: 404 });
      if (slot.status !== 'available' || slot.booked_count >= slot.capacity) throw Object.assign(new Error('Slot is no longer available'), { status: 409 });
      if (db.prepare("SELECT id FROM appointments WHERE slot_id=? AND user_id=? AND status='confirmed'").get(slotId, req.user.id)) {
        throw Object.assign(new Error('You already have a booking for this slot'), { status: 409 });
      }
      if (db.prepare("SELECT id FROM appointments WHERE slot_id=? AND client_email=? AND status='confirmed'").get(slotId, email)) {
        throw Object.assign(new Error('This email already has a booking for this slot'), { status: 409 });
      }
      const result = db.prepare(`INSERT INTO appointments
        (slot_id,user_id,client_name,client_email,client_phone,notes,date_of_birth,gender,nationality,passport_number,passport_expiry,status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'confirmed')`).run(
          slotId, req.user.id, name, email, String(body.client_phone || '').slice(0,50), String(body.notes || '').slice(0,2000),
          dob, String(body.gender || '').slice(0,30), nationality, passport, String(body.passport_expiry || '')
        );
      appointmentId = Number(result.lastInsertRowid);
      syncSlot(slotId);
    })();
    const tookMs = Date.now() - startedAt;
    res.set('Server-Timing', `booking;dur=${tookMs}`);
    res.status(201).json({ message: 'Booking confirmed!', took_ms: tookMs, appointment: selectedAppointment(appointmentId) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Booking error:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

router.put('/:id/status', authenticateToken, requireAdmin, (req, res) => {
  if (!['completed','no_show'].includes(req.body.status)) return res.status(400).json({ error: 'Status must be completed or no_show' });
  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
  if (appointment.status !== 'confirmed') return res.status(400).json({ error: 'Only confirmed appointments can be updated' });
  db.transaction(() => {
    db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(req.body.status, appointment.id);
    syncSlot(appointment.slot_id);
  })();
  res.json({ message: 'Appointment status updated', appointment: selectedAppointment(appointment.id) });
});

router.delete('/:id', authenticateToken, (req, res) => {
  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
  if (req.user.role !== 'admin' && appointment.user_id !== req.user.id) return res.status(403).json({ error: 'Not authorized to cancel this appointment' });
  if (appointment.status === 'cancelled') return res.status(400).json({ error: 'Appointment is already cancelled' });
  db.transaction(() => {
    db.prepare("UPDATE appointments SET status='cancelled' WHERE id=?").run(appointment.id);
    syncSlot(appointment.slot_id);
  })();
  res.json({ message: 'Appointment cancelled successfully' });
});

module.exports = router;
