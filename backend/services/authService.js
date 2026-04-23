const jwt = require('jsonwebtoken');

function getJwtSecret() {
  return process.env.JWT_SECRET || process.env.ADMIN_API_KEY || 'change-me-in-production';
}

/**
 * @param {object} [payload] extra claims (e.g. { v: 1 })
 */
function issueAdminToken(payload = {}) {
  return jwt.sign(
    { sub: 'admin', role: 'admin', ...payload },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function verifyAdminToken(token) {
  return jwt.verify(token, getJwtSecret());
}

module.exports = { issueAdminToken, verifyAdminToken, getJwtSecret };
