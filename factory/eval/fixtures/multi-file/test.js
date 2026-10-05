const assert = require('node:assert')
const { postMeta } = require('./src/index')

assert.deepStrictEqual(postMeta('the quick fox'), { title: 'The Quick Fox', slug: 'the-quick-fox' })
assert.deepStrictEqual(postMeta('Hello World!'), { title: 'Hello World!', slug: 'hello-world' })
console.log('ok')
