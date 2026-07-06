export function xmlAttr(element: string, name: string): string | null {
  const match = element.match(new RegExp(`${name}="([^"]*)"`, 'i'))
  return match ? decodeXml(match[1] ?? '') : null
}

export function xmlElements(xml: string, tagName: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'))].map((match) => match[0] ?? '')
}

export function xmlText(xml: string, tagName: string): string | null {
  const match = xml.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, 'i'))
  return match ? decodeXml(stripTags(match[1] ?? '').trim()) : null
}

export function xmlTexts(xml: string, tagName: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, 'gi'))]
    .map((match) => decodeXml(stripTags(match[1] ?? '').trim()))
    .filter(Boolean)
}

export function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ')
}

export function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}
