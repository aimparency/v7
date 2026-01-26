/**
 * Formats a number with "k" (thousands) or "m" (millions) suffix
 * Rules:
 * - Max 2 decimal places
 * - If >= 9.5M: round to millions with "~" prefix (e.g. 9700000 -> "~10m")
 * - If last 6 digits are 0: show "m" (e.g. 10000000 -> "10m")
 * - If >= 9500: round to thousands with "~" prefix (e.g. 9700 -> "~10k")
 * - If last 3 digits are 0: show "k" (e.g. 10000 -> "10k")
 * - Otherwise: show as-is (max 2 decimals)
 */
export function formatWithK(value: number): string {
  // Handle millions
  if (value >= 9_500_000 && value % 1_000_000 !== 0) {
    // Round to nearest million with ~ prefix
    const rounded = Math.round(value / 1_000_000 * 100) / 100
    return `~${rounded}m`
  } else if (value >= 1_000_000 && value % 1_000_000 === 0) {
    // Exact millions - no ~ prefix
    return `${value / 1_000_000}m`
  }
  // Handle thousands
  else if (value >= 9500 && value % 1000 !== 0) {
    // Round to nearest thousand with ~ prefix
    const rounded = Math.round(value / 1000 * 100) / 100
    return `~${rounded}k`
  } else if (value >= 1000 && value % 1000 === 0) {
    // Exact thousands - no ~ prefix
    return `${value / 1000}k`
  }
  // Small values
  else {
    // Max 2 decimal places for small values
    return Number(value.toFixed(2)).toString()
  }
}

/**
 * Parses a string that may contain "k" (thousands) or "m" (millions) suffix
 * Examples:
 * - "10k" -> 10000
 * - "~10k" -> 10000
 * - "1.5k" -> 1500
 * - "10m" -> 10000000
 * - "~2.5m" -> 2500000
 * - "42" -> 42
 */
export function parseK(input: string): number {
  const cleaned = input.trim().replace(/^~/, '') // Remove optional ~ prefix

  if (cleaned.toLowerCase().endsWith('m')) {
    const numPart = cleaned.slice(0, -1)
    const parsed = parseFloat(numPart)
    return isNaN(parsed) ? 0 : parsed * 1_000_000
  }

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
