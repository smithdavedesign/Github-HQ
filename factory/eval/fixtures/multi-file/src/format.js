// Capitalise every word: "the quick fox" -> "The Quick Fox"
function titleCase(input) {
  return input
    .split(' ')
    .map(word => word.charAt(1).toUpperCase() + word.slice(1))
    .join(' ')
}

module.exports = { titleCase }
