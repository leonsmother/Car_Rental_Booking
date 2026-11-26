// services/inspection/src/requireRole.js
// requireRole('staff') -> 403 for anyone else. authenticate (auth.js) must run first.
module.exports = function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
};
