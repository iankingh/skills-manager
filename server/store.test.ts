import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalStore } from './store.js';

describe('LocalStore recovery boundary', () => {
  it('preserves an unreadable database instead of resetting it on startup', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-store-test-'));
    const dbPath = path.join(root, 'db.json');
    try {
      fs.writeFileSync(dbPath, '{ broken data');
      expect(() => new LocalStore(root)).toThrow(/無法讀取中央資料庫/);
      expect(fs.readFileSync(dbPath, 'utf-8')).toBe('{ broken data');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
