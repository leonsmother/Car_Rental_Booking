require('dotenv').config({ path: '../.env' });
const { authenticate } = require('./auth');
const requireRole = require('./requireRole');

const fakeRes = () => ({ status(c) { this.c = c; return this; }, json(b) { console.log(this.c, b); } });
const run = (headers, role) =>
  authenticate({ headers }, fakeRes(), () => {
    const req = { user: { groups: (headers['x-local-groups'] || '').split(' ') } };
    requireRole(role)(req, fakeRes(), () => console.log('allowed'));
  });

run({}, 'staff');                                                         // 401
run({ 'x-local-user': 'u1', 'x-local-groups': 'customer' }, 'staff');     // 403
run({ 'x-local-user': 'u2', 'x-local-groups': 'staff' }, 'staff');        // allowed