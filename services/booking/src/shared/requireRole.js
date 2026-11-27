// shared/requireRole.js
module.exports = function requireRole(...allowed) {
  return (req, res, next) => {
    const ok = req.user && req.user.groups.some((g) => allowed.includes(g));
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
};