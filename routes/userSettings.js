const express = require('express');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const VALID_TIME_PREFERENCES = new Set(['morning', 'afternoon', 'evening']);
const EXACT_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseStoredArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function serializeSettings(settings) {
  return {
    ...settings,
    preferred_services: parseStoredArray(settings.preferred_services),
    preferred_times: parseStoredArray(settings.preferred_times)
  };
}

function validateStringArray(value, fieldName, maxLength = 120) {
  if (value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);

  return [...new Set(value
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean))]
    .map(item => {
      if (item.length > maxLength) throw new Error(`${fieldName} contains an invalid value`);
      return item;
    });
}

function validateTimePreferences(value) {
  if (value === null) return [];
  if (!Array.isArray(value)) throw new Error('preferred_times must be an array');

  return [...new Set(value)].map(preference => {
    if (typeof preference !== 'string') throw new Error('preferred_times contains an invalid value');
    const normalized = preference.trim().toLowerCase();
    if (!VALID_TIME_PREFERENCES.has(normalized) && !EXACT_TIME_PATTERN.test(normalized)) {
      throw new Error('preferred_times may contain morning, afternoon, evening, or a valid HH:MM time');
    }
    return normalized;
  });
}

function parseEnabled(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === 0 || value === 1) return value;
  throw new Error('is_enabled must be true or false');
}

const router = express.Router();

// Get current user's auto-book settings
router.get('/settings', authenticateToken, (req, res) => {
  try {
    let settings = db.prepare('SELECT * FROM auto_book_settings WHERE user_id = ?').get(req.user.id);
    
    if (!settings) {
      db.prepare('INSERT INTO auto_book_settings (user_id, is_enabled) VALUES (?, 0)').run(req.user.id);
      settings = { user_id: req.user.id, is_enabled: 0, preferred_services: null, preferred_times: null };
    }
    
    res.json(serializeSettings(settings));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch auto-book settings' });
  }
});

// Update current user's auto-book settings. Every field is optional so a
// toggle from the dashboard never wipes the client's saved booking rules.
router.put('/settings', authenticateToken, (req, res) => {
  try {
    const { is_enabled, preferred_services, preferred_times } = req.body;
    const current = db.prepare('SELECT * FROM auto_book_settings WHERE user_id = ?').get(req.user.id) || {};
    const newEnabled = is_enabled !== undefined ? parseEnabled(is_enabled) : (current.is_enabled || 0);

    let newServices = current.preferred_services ?? null;
    if (preferred_services !== undefined) {
      const services = validateStringArray(preferred_services, 'preferred_services');
      newServices = services.length ? JSON.stringify(services) : null;
    }

    let newTimes = current.preferred_times ?? null;
    if (preferred_times !== undefined) {
      const times = validateTimePreferences(preferred_times);
      newTimes = times.length ? JSON.stringify(times) : null;
    }

    db.prepare(`
      INSERT INTO auto_book_settings (user_id, is_enabled, preferred_services, preferred_times)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        is_enabled = excluded.is_enabled,
        preferred_services = excluded.preferred_services,
        preferred_times = excluded.preferred_times
    `).run(req.user.id, newEnabled, newServices, newTimes);

    res.json(serializeSettings({
      user_id: req.user.id,
      is_enabled: newEnabled,
      preferred_services: newServices,
      preferred_times: newTimes
    }));
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to save auto-book setting' });
  }
});

module.exports = router;