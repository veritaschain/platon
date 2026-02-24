import crypto from 'crypto'

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content.trim().toLowerCase()).digest('hex')
}

export function detectLoop(contents: string[]): boolean {
  if (contents.length < 2) return false
  const hashes = contents.map(hashContent)
  const uniqueHashes = new Set(hashes)
  return uniqueHashes.size < hashes.length
}

export function hashMessage(content: string): string {
  return hashContent(content)
}
