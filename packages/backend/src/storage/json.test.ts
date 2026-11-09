import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { entityFile } from './json.js';

describe('entityFile', () => {
  it('builds the file of an idea or phase id', () => {
    expect(entityFile('/p/.bowman', 'ideas', '11111111-2222-3333-4444-555555555555'))
      .toBe(path.join('/p/.bowman', 'ideas', '11111111-2222-3333-4444-555555555555.json'));
  });

  it('refuses ids that could leave their directory', () => {
    for (const id of ['../meta', '../../etc/passwd', 'a/b', 'a\\b', '.', '..', '', 'x.json']) {
      expect(() => entityFile('/p/.bowman', 'ideas', id)).toThrow('Invalid id');
    }
  });
});
