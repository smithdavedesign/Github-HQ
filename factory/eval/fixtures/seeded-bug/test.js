const assert = require('node:assert')
const { add, mul } = require('./calc')

assert.strictEqual(add(2, 3), 5)
assert.strictEqual(add(-1, 1), 0)
assert.strictEqual(mul(4, 5), 20)
console.log('ok')
