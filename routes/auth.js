const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const rawName = req.body.name;
    const rawEmail = req.body.email;
    const password = req.body.password;
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';

    if (!name || !email || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    if (name.length > 100) return res.status(400).json({ error: 'Name must not exceed 100 characters' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = db.transaction(() => {
      const result = db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
        .run(name, email, passwordHash, 'user');
      const id = Number(result.lastInsertRowid);
      db.prepare('INSERT INTO auto_book_settings (user_id, is_enabled) VALUES (?, 0)').run(id);
      return id;
    })();
    const token = jwt.sign({ id: userId, email, name, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ message: 'Registration successful', token, user: { id: userId, name, email, role: 'user' } });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body.password;
    if (!email || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      message: 'Login successful', token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

router.get('/me', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

router.put('/profile', authenticateToken, (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (name.length > 100) return res.status(400).json({ error: 'Name must not exceed 100 characters' });
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
  res.json(db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(req.user.id));
});

module.exports = router;
