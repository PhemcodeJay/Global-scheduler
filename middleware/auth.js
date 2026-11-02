const jwt = require('jsonwebtoken');
const db = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters');
}

function authenticateToken(req, res, next) {
  const [scheme, token, extra] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token || extra) {
    return res.status(401).json({ error: 'A valid Bearer access token is required' });
  }

  jwt.verify(token, JWT_SECRET, (error, claims) => {
    if (error) return res.status(401).json({ error: 'Invalid or expired token' });

    // The signed role may be stale after an administrator changes a role.
    // Always authorize against the current database record.
    const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(claims.id);
    if (!user) return res.status(401).json({ error: 'User account no longer exists' });

    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { authenticateToken, requireAdmin, JWT_SECRET };
