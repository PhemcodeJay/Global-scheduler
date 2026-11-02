const express = require('express');
const db = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const autoBookService = require('../services/autoBook');

const router = express.Router();

// Apply admin middleware
router.use(authenticateToken);
router.use(requireAdmin);

// Get auto-book settings
router.get('/', (req, res) => {
  try {
    const settings = db.prepare(`
      SELECT abs.*, u.name, u.email 
      FROM auto_book_settings abs
      JOIN users u ON abs.user_id = u.id
      ORDER BY u.name
    `).all();
    
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch auto-book settings' });
  }
});

// Toggle auto-book for user (admin). Preserve the user's preferences when an
// administrator changes only the on/off state.
router.put('/:userId', (req, res) => {
  try {
    const { is_enabled } = req.body;
    if (typeof is_enabled !== 'boolean' && is_enabled !== 0 && is_enabled !== 1) {
      return res.status(400).json({ error: 'is_enabled must be true or false' });
    }

    const current = db.prepare('SELECT * FROM auto_book_settings WHERE user_id = ?').get(req.params.userId) || {};
    const enabled = is_enabled === true || is_enabled === 1 ? 1 : 0;

    db.prepare(`
      INSERT INTO auto_book_settings (user_id, is_enabled, preferred_services, preferred_times)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        is_enabled = excluded.is_enabled
    `).run(
      req.params.userId,
      enabled,
      current.preferred_services ?? null,
      current.preferred_times ?? null
    );

    // Enabling monitoring should take effect immediately, not next poll.
    if (enabled) autoBookService.requestImmediateCheck();

    res.json({ message: 'Auto-book setting updated', is_enabled: enabled });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update auto-book setting' });
  }
});

// Get recent activity
router.get('/activity', (req, res) => {
  try {
    const { limit } = req.query;
    const l = limit ? parseInt(limit) : 20;
    
    const activities = db.prepare(`
      SELECT 
        'booking' as type,
        a.id,
        a.created_at,
        a.status,
        u.name as user_name,
        u.email as user_email,
        s.service_name,
        s.date,
        s.start_time
      FROM appointments a
      JOIN users u ON a.user_id = u.id
      JOIN slots s ON a.slot_id = s.id
      UNION ALL
      SELECT 
        'registration' as type,
        u.id,
        u.created_at,
        NULL as status,
        u.name,
        u.email,
        NULL as service_name,
        NULL as date,
        NULL as start_time
      FROM users u
      ORDER BY created_at DESC
      LIMIT ?
    `).all(l);
    
    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

module.exports = router;
