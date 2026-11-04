// Spreadsheet-driven batch templates (the Orshot bulk-generation idea,
// local edition): a CSV whose rows name a file and give the values that
// change per render — caption text and backdrop colour.

export interface TemplateRow {
  /** Image filename (with or without extension), matched case-insensitively. */
  file: string
  caption?: string
  color?: string
  /** Promo badge text ("SALE", "-20%") sealed in the corner. */
  badge?: string
}

/** Split one CSV line, honouring double quotes and escaped quotes. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        current += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ",") {
      cells.push(current)
      current = ""
    } else {
      current += ch
    }
  }
  cells.push(current)
  return cells.map((c) => c.trim())
}

const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * Parse template CSV with a header row. Recognised columns: file (or
 * filename/name), caption, color. Unknown columns are ignored so a real
 * spreadsheet export can be dropped in as-is.
 */
export function parseTemplateCsv(text: string): TemplateRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase())
  const fileIdx = header.findIndex((h) => ["file", "filename", "name"].includes(h))
  if (fileIdx < 0) return []
  const captionIdx = header.indexOf("caption")
  const colorIdx = header.findIndex((h) => ["color", "colour", "background"].includes(h))
  const badgeIdx = header.indexOf("badge")

  const rows: TemplateRow[] = []
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line)
    const file = cells[fileIdx]?.trim()
    if (!file) continue
    const row: TemplateRow = { file }
    const caption = captionIdx >= 0 ? cells[captionIdx]?.trim() : undefined
    if (caption) row.caption = caption
    const color = colorIdx >= 0 ? cells[colorIdx]?.trim() : undefined
    if (color && HEX.test(color)) row.color = color
    const badge = badgeIdx >= 0 ? cells[badgeIdx]?.trim() : undefined
    if (badge) row.badge = badge.slice(0, 10)
    rows.push(row)
  }
  return rows
}

/** Match a template row to a batch item name, ignoring extension and case. */
export function templateFor(
  rows: TemplateRow[],
  itemName: string
): TemplateRow | undefined {
  const norm = (s: string) => s.replace(/\.[^/.]+$/, "").toLowerCase()
  const target = norm(itemName)
  return rows.find((r) => norm(r.file) === target || r.file.toLowerCase() === itemName.toLowerCase())
}
