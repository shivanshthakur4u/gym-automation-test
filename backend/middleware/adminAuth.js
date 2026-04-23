const { verifyAdminToken } = require('../services/authService');

function parseBearer(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Accepts: Authorization: Bearer <ADMIN_API_KEY> OR Authorization: Bearer <JWT from POST /api/auth/login>
 */
function requireAdmin(req, res, next) {
  const staticKey = process.env.ADMIN_API_KEY;
  const token = parseBearer(req);
  if (!token) {
    return res.status(401).json({ success: false, error: 'Missing Authorization Bearer token' });
  }
  if (staticKey && token === staticKey) {
    return next();
  }
  try {
    const decoded = verifyAdminToken(token);
    if (decoded.sub !== 'admin' && decoded.role !== 'admin') {
      return res.status(401).json({ success: false, error: 'Invalid token subject' });
    }
    return next();
  } catch {
    if (!staticKey) {
      return res.status(503).json({
        success: false,
        error: 'ADMIN_API_KEY is not set and JWT verification failed. Set ADMIN_API_KEY or use a valid JWT.',
      });
    }
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      hint:
        'Do not set JWT_SECRET to your access token. JWT_SECRET must be a fixed random signing string. ' +
        'If you changed ADMIN_API_KEY or JWT_SECRET, click Get JWT again, or use Authorization: Bearer <ADMIN_API_KEY>.',
    });
  }
}

module.exports = { requireAdmin, parseBearer };
