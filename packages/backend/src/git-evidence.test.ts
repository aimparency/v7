import { describe, expect, it } from 'vitest';
import { parseAimCommitEvidence } from './git-evidence.js';

describe('parseAimCommitEvidence', () => {
  it('parses Git log records used by the aim evidence query', () => {
    const evidence = parseAimCommitEvidence(
      '0123456789012345678901234567890123456789\x1f01234567\x1ffeat: realize aim abc-123\x1fTest User\x1f2026-07-21T18:00:00+02:00\x1e'
    );

    expect(evidence).toHaveLength(1);
    expect(evidence[0].subject).toBe('feat: realize aim abc-123');
    expect(evidence[0].shortHash).toBe('01234567');
  });

  it('preserves empty history as no implementation evidence', () => {
    expect(parseAimCommitEvidence('')).toEqual([]);
  });
});
