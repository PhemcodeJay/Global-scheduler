const express = require('express');
const db = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const autoBookService = require('../services/autoBook');
const router = express.Router();
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FIXED_SERVICE_TIMES = new Map([
  ['Business Consultation', { start: '09:00', end: '10:00' }],
  ['Visa Processing Help', { start: '10:00', end: '10:30' }],
  ['Immigration Advisory', { start: '11:00', end: '11:45' }],
  ['Document Verification', { start: '13:00', end: '13:20' }],
  ['Passport Services', { start: '14:00', end: '14:30' }]
]);

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function availableSlots(where = '', params = []) {
  return db.prepare(`SELECT s.*,
    (SELECT COUNT(*) FROM appointments a WHERE a.slot_id=s.id AND a.status='confirmed') AS actual_bookings
    FROM slots s ${where} ORDER BY s.date,s.start_time`).all(...params).map(slot => ({
      ...slot, available_spots: Math.max(0, slot.capacity - slot.booked_count)
    }));
}
function validateSlot(body, partial = false) {
  const service = body.service_name === undefined ? undefined : String(body.service_name).trim();
  const description = body.description === undefined ? undefined : String(body.description).trim();
  const date = body.date === undefined ? undefined : String(body.date);
  const start = body.start_time === undefined ? undefined : String(body.start_time);
  const end = body.end_time === undefined ? undefined : String(body.end_time);
  const capacity = body.capacity === undefined ? undefined : Number(body.capacity);
  if (!partial || service !== undefined) {
    if (!service || service.length > 120) throw Object.assign(new Error('Service name is required and must not exceed 120 characters'), { status: 400 });
  }
  if (description !== undefined && description.length > 500) throw Object.assign(new Error('Description is too long'), { status: 400 });
  if (date !== undefined && (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00`)))) throw Object.assign(new Error('Enter a valid date'), { status: 400 });
  if (start !== undefined && !TIME.test(start)) throw Object.assign(new Error('Enter a valid start time'), { status: 400 });
  if (end !== undefined && !TIME.test(end)) throw Object.assign(new Error('Enter a valid end time'), { status: 400 });
  if (capacity !== undefined && (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 100)) throw Object.assign(new Error('Capacity must be between 1 and 100'), { status: 400 });
  const fixed = service ? FIXED_SERVICE_TIMES.get(service) : undefined;
  return { service, description, date, start: fixed ? fixed.start : start, end: fixed ? fixed.end : end, capacity };
}

router.get('/', authenticateToken, (req, res) => {
  const conditions = ["s.status='available'", 's.booked_count < s.capacity'];
  const params = [];
  if (req.query.date) { conditions.push('s.date=?'); params.push(String(req.query.date)); }
  if (req.query.service) { conditions.push('s.service_name=?'); params.push(String(req.query.service)); }
  res.json(availableSlots(`WHERE ${conditions.join(' AND ')}`, params));
});

router.get('/services/list', authenticateToken, (req, res) => {
  res.json(db.prepare('SELECT service_name, description FROM slots GROUP BY service_name ORDER BY service_name').all());
});

router.get('/:id', authenticateToken, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid slot ID' });
  const slot = availableSlots('WHERE s.id=?', [id])[0];
  if (!slot) return res.status(404).json({ error: 'Slot not found' });
  res.json(slot);
});

router.post('/', authenticateToken, requireAdmin, (req, res) => {
  try {
    const value = validateSlot(req.body);
    if (value.end <= value.start) return res.status(400).json({ error: 'End time must be after start time' });
    const result = db.prepare(`INSERT INTO slots (service_name,description,date,start_time,end_time,capacity,booked_count,status)
      VALUES (?,?,?,?,?,?,0,'available')`).run(value.service,value.description||'',value.date,value.start,value.end,value.capacity||1);
    autoBookService.notify({ event:'slot.created', slot:{ id:Number(result.lastInsertRowid), service:value.service, date:value.date, start_time:value.start, end_time:value.end } });
    autoBookService.requestImmediateCheck();
    res.status(201).json(db.prepare('SELECT * FROM slots WHERE id=?').get(result.lastInsertRowid));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error:error.message });
    if (String(error.code).includes('CONSTRAINT_UNIQUE') || error.errcode === 2067) {
      return res.status(409).json({ error: 'A slot for this service already exists on that date' });
    }
    console.error('Error creating slot:', error); res.status(500).json({ error:'Failed to create slot' });
  }
});

router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error:'Invalid slot ID' });
  try {
    const current = db.prepare('SELECT * FROM slots WHERE id=?').get(id);
    if (!current) return res.status(404).json({ error:'Slot not found' });
    const value = validateSlot(req.body, true);
    const next = {
      service_name:value.service ?? current.service_name, description:value.description ?? current.description,
      date:value.date ?? current.date, start_time:value.start ?? current.start_time, end_time:value.end ?? current.end_time,
      capacity:value.capacity ?? current.capacity
    };
    if (next.end_time <= next.start_time) return res.status(400).json({ error:'End time must be after start time' });
    const confirmed = db.prepare("SELECT COUNT(*) AS count FROM appointments WHERE slot_id=? AND status='confirmed'").get(id).count;
    if (next.capacity < confirmed) return res.status(409).json({ error:`Capacity cannot be lower than ${confirmed} confirmed bookings` });
    const status = next.capacity > confirmed ? 'available' : 'booked';
    db.prepare('UPDATE slots SET service_name=?,description=?,date=?,start_time=?,end_time=?,capacity=?,booked_count=?,status=? WHERE id=?')
      .run(next.service_name,next.description||'',next.date,next.start_time,next.end_time,next.capacity,confirmed,status,id);
    autoBookService.notify({ event:'slot.updated', slot:{ id } }); autoBookService.requestImmediateCheck();
    res.json(db.prepare('SELECT * FROM slots WHERE id=?').get(id));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error:error.message });
    if (String(error.code).includes('CONSTRAINT_UNIQUE') || error.errcode === 2067) {
      return res.status(409).json({ error: 'A slot for this service already exists on that date' });
    }
    console.error('Error updating slot:', error); res.status(500).json({ error:'Failed to update slot' });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error:'Invalid slot ID' });
  const slot = db.prepare('SELECT id FROM slots WHERE id=?').get(id);
  if (!slot) return res.status(404).json({ error:'Slot not found' });
  const appointmentCount = db.prepare('SELECT COUNT(*) AS count FROM appointments WHERE slot_id=?').get(id).count;
  if (appointmentCount > 0) {
    return res.status(409).json({ error: 'Cannot delete a slot with appointment history', appointments: appointmentCount });
  }
  db.prepare('DELETE FROM slots WHERE id=?').run(id);
  res.json({ message:'Slot deleted successfully' });
});
module.exports = router;
