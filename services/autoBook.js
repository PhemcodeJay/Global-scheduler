const db = require('../config/database');

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

// Time-of-day preference matcher for auto-book rules.
// Accepts exact "HH:MM" values or buckets: morning/afternoon/evening.
// Empty prefs (or null) = any time is acceptable.
function matchesPreferredTime(startTime, prefs) {
  if (!Array.isArray(prefs) || prefs.length === 0) return true;
  const hour = parseInt(String(startTime).split(':')[0], 10) || 0;
  return prefs.some(preference => {
    const value = String(preference);
    if (value.includes(':')) return value === startTime;
    if (value === 'morning') return hour >= 6 && hour < 12;
    if (value === 'afternoon') return hour >= 12 && hour < 18;
    if (value === 'evening') return hour >= 18 || hour < 6;
    return false;
  });
}

class AutoBookService {
  constructor() {
    this.monitoring = false;
    this.intervalId = null;
    this.checking = false;
    this.pendingCheck = null;
    this.totalBookings = 0;
    this.sumBookingMs = 0;
    this.lastBookingMs = 0;
    // Poll fast enough to book well within the 1-second SLA.
    // Default 100ms; override with AUTO_BOOK_INTERVAL_MS env var.
    this.checkInterval = Math.max(50, parseInt(process.env.AUTO_BOOK_INTERVAL_MS, 10) || 100);
  }

  start() {
    if (process.env.AUTO_BOOK_ENABLED === 'false') {
      console.log('Auto-book monitor disabled by AUTO_BOOK_ENABLED=false');
      return;
    }
    if (this.monitoring) return;
    
    console.log('🔍 Auto-book service started');
    this.monitoring = true;
    
    // Check immediately
    this.checkAvailableSlots();
    
    // Set interval
    this.intervalId = setInterval(() => {
      this.checkAvailableSlots();
    }, this.checkInterval);
  }

  stop() {
    if (!this.monitoring) return;
    
    console.log('⏹️ Auto-book service stopped');
    this.monitoring = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.pendingCheck) {
      clearTimeout(this.pendingCheck);
      this.pendingCheck = null;
    }
  }

  checkAvailableSlots() {
    if (this.checking) return; // skip this tick if the previous check is still running
    this.checking = true;
    try {
      // Get all users with auto-book enabled
      const users = db.prepare(`
        SELECT abs.*, u.name, u.email 
        FROM auto_book_settings abs
        JOIN users u ON abs.user_id = u.id
        WHERE abs.is_enabled = 1
      `).all();

      if (users.length === 0) {
        return;
      }

      // Get all available slots
      const availableSlots = db.prepare(`
        SELECT s.*, 
          (SELECT COUNT(*) FROM appointments a WHERE a.slot_id = s.id AND a.status = 'confirmed') as actual_bookings
        FROM slots s
        WHERE s.status = 'available' 
          AND s.booked_count < s.capacity
          AND s.date >= date('now')
        ORDER BY s.date, s.start_time
        LIMIT 100
      `).all();

      if (availableSlots.length === 0) {
        return;
      }

      // Process each user
      users.forEach(user => {
        // Skip users who already hold an upcoming confirmed booking
        const existingBooking = db.prepare(`
          SELECT a.id FROM appointments a
          JOIN slots s ON a.slot_id = s.id
          WHERE a.user_id = ? AND a.status = 'confirmed' AND s.date >= date('now')
          LIMIT 1
        `).get(user.user_id);
        
        if (existingBooking) return;
        
        const preferences = parseJsonArray(user.preferred_services);
        const preferredTimes = parseJsonArray(user.preferred_times);

        // Find matching slot (respects per-client service + time preferences)
        const matchingSlot = availableSlots.find(slot => {
          if (preferences.length > 0 && !preferences.includes(slot.service_name)) return false;
          return matchesPreferredTime(slot.start_time, preferredTimes);
        });

        if (matchingSlot) {
          this.bookSlotForUser(user, matchingSlot);
        }
      });
    } catch (error) {
      console.error('Auto-book check error:', error);
    } finally {
      this.checking = false;
    }
  }

  bookSlotForUser(user, slot) {
    try {
      const started = Date.now();
      const transaction = db.transaction(() => {
        // Re-check capacity inside the transaction to prevent overbooking when
        // several monitored users compete for the same slot in one tick
        const current = db.prepare('SELECT booked_count, capacity FROM slots WHERE id = ?').get(slot.id);
        if (!current || current.booked_count >= current.capacity) return null;

        // Check if user already booked this slot
        const existing = db.prepare(
          "SELECT id FROM appointments WHERE slot_id = ? AND user_id = ? AND status = 'confirmed'"
        ).get(slot.id, user.user_id);

        if (existing) return null;

        // Create appointment automatically
        const result = db.prepare(`
          INSERT INTO appointments (slot_id, user_id, client_name, client_email, client_phone, notes, status)
          VALUES (?, ?, ?, ?, ?, ?, 'confirmed')
        `).run(
          slot.id,
          user.user_id,
          user.name,
          user.email,
          '',
          'Auto-booked by monitoring service'
        );

        // Update slot
        db.prepare('UPDATE slots SET booked_count = booked_count + 1 WHERE id = ?').run(slot.id);
        
        const updatedSlot = db.prepare('SELECT booked_count, capacity FROM slots WHERE id = ?').get(slot.id);
        if (updatedSlot.booked_count >= updatedSlot.capacity) {
          db.prepare("UPDATE slots SET status = 'booked' WHERE id = ?").run(slot.id);
        }

        return result;
      });

      const result = transaction();

      if (result) {
        this.lastBookingMs = Date.now() - started;
        this.totalBookings += 1;
        this.sumBookingMs += this.lastBookingMs;
        console.log(`✅ Auto-booked in ${this.lastBookingMs}ms: ${slot.service_name} (${slot.date} ${slot.start_time}) for ${user.name} (${user.email})`);
        this.notify({
          event: 'booking.auto',
          booked_in_ms: this.lastBookingMs,
          booked_for: user.email,
          slot: { id: slot.id, service: slot.service_name, date: slot.date, start_time: slot.start_time, end_time: slot.end_time }
        });
      }
    } catch (error) {
      console.error(`Failed to auto-book for ${user.email}:`, error);
    }
  }

  // Fire an optional webhook so the agency can plug in WhatsApp/Telegram/
  // email alert gateways later. No URL configured = silent no-op.
  notify(payload) {
    const url = process.env.SLOT_ALERT_WEBHOOK_URL;
    if (!url) return;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ts: new Date().toISOString(), source: 'gonest-autobook', ...payload })
    }).catch(err => console.error('Webhook notify failed:', err.message));
  }

  // Called by API routes when a slot is created/updated so booking happens
  // instantly (push) instead of waiting for the next poll tick.
  requestImmediateCheck() {
    if (this.checking) {
      // A check is mid-flight (it may have already read the slot list) -
      // queue one follow-up check right after it finishes
      if (!this.pendingCheck) {
        this.pendingCheck = setTimeout(() => {
          this.pendingCheck = null;
          this.checkAvailableSlots();
        }, 50);
      }
      return;
    }
    this.checkAvailableSlots();
  }

  getStatus() {
    return {
      monitoring: this.monitoring,
      interval: this.checkInterval,
      totalBookings: this.totalBookings,
      lastBookingMs: this.lastBookingMs,
      avgBookingMs: this.totalBookings ? Math.round(this.sumBookingMs / this.totalBookings) : 0,
      message: this.monitoring ? `Monitoring for available slots (every ${this.checkInterval}ms; target under 1000ms)...` : 'Service stopped',
      target_ms: 1000
    };
  }
}

// Create singleton instance
const autoBookService = new AutoBookService();

// Start service when module is loaded
autoBookService.start();

module.exports = autoBookService;
