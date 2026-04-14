/**
 * Utility functions for handling date/time conversions between timestamps and local date/time strings
 */
/**
 * Convert a timestamp to a local date string (YYYY-MM-DD)
 */
export function timestampToLocalDate(timestamp) {
    const date = new Date(timestamp);
    return date.getFullYear() + '-' +
        String(date.getMonth() + 1).padStart(2, '0') + '-' +
        String(date.getDate()).padStart(2, '0');
}
/**
 * Convert a timestamp to a local time string (HH:MM)
 */
export function timestampToLocalTime(timestamp) {
    const date = new Date(timestamp);
    return String(date.getHours()).padStart(2, '0') + ':' +
        String(date.getMinutes()).padStart(2, '0');
}
/**
 * Convert local date and time strings to a timestamp
 */
export function localDateTimeToTimestamp(date, time) {
    if (!date)
        return Date.now();
    const dateTimeString = time ? `${date}T${time}` : date;
    return new Date(dateTimeString).getTime();
}
//# sourceMappingURL=dateTimeUtils.js.map