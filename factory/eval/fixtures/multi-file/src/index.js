const { slugify } = require('./strings')
const { titleCase } = require('./format')

function postMeta(title) {
  return { title: titleCase(title), slug: slugify(title) }
}

module.exports = { postMeta }
