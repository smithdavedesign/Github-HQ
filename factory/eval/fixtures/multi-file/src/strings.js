// Turn a title into a URL slug: "Hello World!" -> "hello-world"
function slugify(input) {
  return input
    .trim()
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
}

module.exports = { slugify }
