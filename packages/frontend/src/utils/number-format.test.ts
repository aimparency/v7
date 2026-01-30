import { describe, it, expect } from 'vitest'
import { formatWithK, parseK, displayValue } from './number-format'

describe('formatWithK', () => {
  describe('millions', () => {
    it('formats exact millions without ~', () => {
      expect(formatWithK(1_000_000)).toBe('1m')
      expect(formatWithK(10_000_000)).toBe('10m')
      expect(formatWithK(100_000_000)).toBe('100m')
    })

    it('formats near millions with ~', () => {
      expect(formatWithK(9_500_000)).toBe('~9.5m')
      expect(formatWithK(9_700_000)).toBe('~9.7m')
      expect(formatWithK(15_600_000)).toBe('~15.6m')
    })

    it('rounds millions to 2 decimal places', () => {
      expect(formatWithK(9_567_000)).toBe('~9.57m')
      expect(formatWithK(12_345_678)).toBe('~12.35m')
    })
  })

  describe('thousands', () => {
    it('formats exact thousands without ~', () => {
      expect(formatWithK(1000)).toBe('1k')
      expect(formatWithK(10_000)).toBe('10k')
      expect(formatWithK(100_000)).toBe('100k')
    })

    it('formats near thousands with ~', () => {
      expect(formatWithK(9500)).toBe('~9.5k')
      expect(formatWithK(9700)).toBe('~9.7k')
      expect(formatWithK(15_600)).toBe('~15.6k')
    })

    it('rounds thousands to 2 decimal places', () => {
      expect(formatWithK(9567)).toBe('~9.57k')
      expect(formatWithK(12_345)).toBe('~12.35k')
    })

    it('does not format values below 9500', () => {
      expect(formatWithK(9499)).toBe('9499')
      expect(formatWithK(5000)).toBe('5000')
      expect(formatWithK(1500)).toBe('1500')
    })
  })

  describe('small values', () => {
    it('formats with max 2 decimal places', () => {
      expect(formatWithK(42.123456)).toBe('42.12')
      expect(formatWithK(1.999)).toBe('2')
      expect(formatWithK(0.5)).toBe('0.5')
    })

    it('handles whole numbers', () => {
      expect(formatWithK(42)).toBe('42')
      expect(formatWithK(100)).toBe('100')
      expect(formatWithK(999)).toBe('999')
    })
  })
})

describe('parseK', () => {
  describe('millions', () => {
    it('parses m suffix', () => {
      expect(parseK('1m')).toBe(1_000_000)
      expect(parseK('10m')).toBe(10_000_000)
      expect(parseK('2.5m')).toBe(2_500_000)
    })

    it('parses m suffix with ~ prefix', () => {
      expect(parseK('~10m')).toBe(10_000_000)
      expect(parseK('~2.5m')).toBe(2_500_000)
    })

    it('handles uppercase M', () => {
      expect(parseK('10M')).toBe(10_000_000)
      expect(parseK('~5.5M')).toBe(5_500_000)
    })
  })

  describe('thousands', () => {
    it('parses k suffix', () => {
      expect(parseK('10k')).toBe(10_000)
      expect(parseK('1.5k')).toBe(1500)
      expect(parseK('100k')).toBe(100_000)
    })

    it('parses k suffix with ~ prefix', () => {
      expect(parseK('~10k')).toBe(10_000)
      expect(parseK('~1.5k')).toBe(1500)
    })

    it('handles uppercase K', () => {
      expect(parseK('10K')).toBe(10_000)
      expect(parseK('~5K')).toBe(5000)
    })
  })

  describe('plain numbers', () => {
    it('parses numbers without suffix', () => {
      expect(parseK('42')).toBe(42)
      expect(parseK('100')).toBe(100)
      expect(parseK('1.5')).toBe(1.5)
    })

    it('handles whitespace', () => {
      expect(parseK('  10k  ')).toBe(10_000)
      expect(parseK('  42  ')).toBe(42)
    })
  })

  describe('edge cases', () => {
    it('handles invalid input', () => {
      expect(parseK('')).toBe(0)
      expect(parseK('abc')).toBe(0)
      expect(parseK('k')).toBe(0)
      expect(parseK('m')).toBe(0)
    })

    it('handles decimal precision', () => {
      expect(parseK('1.234k')).toBe(1234)
      expect(parseK('2.5678m')).toBe(2_567_800)
    })
  })
})

describe('displayValue', () => {
  it('uses formatWithK', () => {
    expect(displayValue(10_000)).toBe('10k')
    expect(displayValue(1_000_000)).toBe('1m')
    expect(displayValue(9700)).toBe('~9.7k')
    expect(displayValue(42.5)).toBe('42.5')
  })
})

describe('round-trip (format -> parse)', () => {
  it('preserves values for thousands', () => {
    const values = [1000, 10_000, 100_000, 9500]
    values.forEach(val => {
      const formatted = formatWithK(val)
      const parsed = parseK(formatted)
      expect(parsed).toBeCloseTo(val, -2) // Within 100 (rounding tolerance)
    })
  })

  it('preserves values for millions', () => {
    const values = [1_000_000, 10_000_000, 9_500_000]
    values.forEach(val => {
      const formatted = formatWithK(val)
      const parsed = parseK(formatted)
      expect(parsed).toBeCloseTo(val, -5) // Within 100k (rounding tolerance)
    })
  })
})
