const jwt = require('jsonwebtoken');
const { prisma } = require('../db');

async function requireAuth(req, res, next) {
  try {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Sign in required.' });
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true, country: true },
    });
    if (!user) return res.status(401).json({ error: 'Session is no longer valid.' });
    req.user = user;
    next();
  } catch (_) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

function requireSeller(req, res, next) {
  if (!req.user || !['SELLER', 'ADMIN'].includes(req.user.role)) {
    return res.status(403).json({ error: 'A seller account is required.' });
  }
  next();
}

module.exports = { requireAuth, requireSeller };
