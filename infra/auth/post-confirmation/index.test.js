// node index.test.js  (no AWS, no database)
const assert = require('assert');
const { createHandler } = require('./index');

const ev = (over = {}) => ({
  triggerSource: 'PostConfirmation_ConfirmSignUp',
  userPoolId: 'eu-central-1_abc',
  userName: 'u1',
  request: { userAttributes: { sub: 'sub-1', email: 'a@b.com' } },
  ...over,
});

(async () => {
  let calls = [];
  const h = createHandler({
    insertUser: async (id, email) => calls.push(['db', id, email]),
    addToGroup: async (pool, user) => calls.push(['group', pool, user]),
  });

  const e1 = ev();
  assert.strictEqual(await h(e1), e1, 'returns the event');
  assert.deepStrictEqual(calls, [['db', 'sub-1', 'a@b.com'], ['group', 'eu-central-1_abc', 'u1']]);

  calls = [];
  await h(ev({ triggerSource: 'PostConfirmation_ConfirmForgotPassword' }));
  assert.deepStrictEqual(calls, [], 'forgot-password does nothing');

  await assert.rejects(h(ev({ request: { userAttributes: { sub: 'x' } } })), /Missing sub or email/);

  const bad = createHandler({ insertUser: async () => { throw new Error('db down'); }, addToGroup: async () => {} });
  await assert.rejects(bad(ev()), /db down/);

  const order = [];
  await createHandler({
    insertUser: async () => order.push('db'),
    addToGroup: async () => order.push('group'),
  })(ev());
  assert.deepStrictEqual(order, ['db', 'group']);

  console.log('all post-confirmation tests passed');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });