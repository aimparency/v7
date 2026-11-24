// Text split into plain parts and web links, so a comment's URLs (a prepared
// draft, a document) are one click away. Trailing punctuation stays text.
export type TextPart = { text: string, href?: string }

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]*[^\s<>"')\].,;:!?]/g

export function linkParts(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index!
    if (start > last) parts.push({ text: text.slice(last, start) })
    parts.push({ text: match[0], href: match[0] })
    last = start + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}
