const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'pharm_secret_jwt_key_2026';

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      ...decoded,
      user_id: decoded.user_id ?? decoded.id ?? decoded.userId ?? null,
      id: decoded.id ?? decoded.user_id ?? decoded.userId ?? null,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

module.exports = { authenticate };
