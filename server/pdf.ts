import { extractText, getDocumentProxy } from 'unpdf'

/** Extract merged plain text from a PDF's raw bytes. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes)
  const { text } = await extractText(pdf, { mergePages: true })
  return Array.isArray(text) ? text.join('\n\n') : text
}
