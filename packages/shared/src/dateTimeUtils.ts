/**
 * Utility functions for handling date/time conversions between timestamps and local date/time strings
 */

/**
 * Convert a timestamp to a local date string (YYYY-MM-DD)
 */
export function timestampToLocalDate(timestamp: number): string {
  const date = new Date(timestamp)
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0')
}

/**
 * Convert a timestamp to a local time string (HH:MM)
 */
export function timestampToLocalTime(timestamp: number): string {
  const date = new Date(timestamp)
  return String(date.getHours()).padStart(2, '0') + ':' +
    String(date.getMinutes()).padStart(2, '0')
}

/**
 * Convert local date and time strings to a timestamp
 */
export function localDateTimeToTimestamp(date: string, time: string): number {
  if (!date) return Date.now()
  const dateTimeString = time ? `${date}T${time}` : date
  return new Date(dateTimeString).getTime()
}

/**
 * Set date and time fields from a timestamp
 */
export function setDateTimeFromTimestamp(
  timestamp: number,
  setDate: (date: string) => void,
  setTime: (time: string) => void
): void {
  setDate(timestampToLocalDate(timestamp))
  setTime(timestampToLocalTime(timestamp))
}