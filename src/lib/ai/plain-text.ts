/**
 * Model prose → plain text for places that render it as a paragraph. Models add a markdown
 * heading or bold even when asked not to (the public quarterly report showed a literal
 * "# Q3 2026 Portfolio Commentary"). Pure.
 */
export function plainText(md: string): string {
  return md
    .split('\n')
    .filter(line => !/^\s{0,3}#{1,6}\s/.test(line))          // headings
    .map(line => line.replace(/^\s*[-*+]\s+/, ''))          // bullet markers
    .join(' ')
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2')             // bold
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2') // italics
    .replace(/`([^`]+)`/g, '$1')                            // inline code
    .replace(/\s+/g, ' ')
    .trim()
}
