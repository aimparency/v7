/**
 * Formats a number with "k" suffix for thousands
 * Rules:
 * - If last 3 digits are 0: show "k" (e.g. 10000 -> "10k")
 * - If >= 9500: round to thousands with "~" prefix (e.g. 9700 -> "~10k")
 * - Otherwise: show as-is
 */
export function formatWithK(value: number): string {
  if (value >= 9500 && value % 1000 !== 0) {
    // Round to nearest thousand and add ~ prefix
    const rounded = Math.round(value / 1000)
    return `~${rounded}k`
  } else if (value >= 1000 && value % 1000 === 0) {
    // Exact thousands - no ~ prefix
    return `${value / 1000}k`
  } else {
    // Less than 9500 or not close to thousands
    return value.toString()
  }
}

/**
 * Parses a string that may contain "k" suffix
 * Examples:
 * - "10k" -> 10000
 * - "~10k" -> 10000
 * - "1.5k" -> 1500
 * - "42" -> 42
 */
export function parseK(input: string): number {
  const cleaned = input.trim().replace(/^~/, '') // Remove optional ~ prefix

  if (cleaned.toLowerCase().endsWith('k')) {
    const numPart = cleaned.slice(0, -1)
    const parsed = parseFloat(numPart)
    return isNaN(parsed) ? 0 : parsed * 1000
  }

  const parsed = parseFloat(cleaned)
  return isNaN(parsed) ? 0 : parsed
}

/**
 * Formats for display in input fields (read-only display values)
 * Uses formatWithK rules
 */
export function displayValue(value: number): string {
  return formatWithK(value)
}
