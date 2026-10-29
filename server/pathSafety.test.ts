import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { directChildPath } from './pathSafety.js';

describe('direct child path boundary', () => {
  const parent = path.join(os.tmpdir(), 'skills-path-test');

  it('expands the home directory before resolving a child', () => {
    expect(directChildPath('~/.agents/skills', 'my-skill')).toBe(
      path.join(os.homedir(), '.agents', 'skills', 'my-skill')
    );
    expect(directChildPath('~', 'my-skill')).toBe(path.join(os.homedir(), 'my-skill'));
  });

  it.each(['my-skill', '..notes', '.hidden', '技能_審查', ' review agent.md '])('preserves a valid name: %s', (name) => {
    expect(directChildPath(parent, name)).toBe(path.join(parent, name));
  });

  it.each(['', '   ', '.', '..', '../outside', '..\\outside', 'a/b', 'a\\b', '/absolute', '\\absolute', 'bad\0name'])('rejects an unsafe name: %j', (name) => {
    expect(() => directChildPath(parent, name)).toThrow(/無效/);
  });

  it.each([null, undefined, 42, {}])('rejects a non-string name: %j', (name) => {
    expect(() => directChildPath(parent, name as unknown as string)).toThrow(/無效/);
  });

  it.runIf(process.platform === 'win32')('resolves native Windows paths with either drive letter case', () => {
    for (const root of ['C:\\Skills', 'c:\\Skills']) {
      expect(directChildPath(root, 'my-skill')).toBe(path.join(root, 'my-skill'));
    }
  });

  it.runIf(process.platform === 'win32')('rejects a child that switches Windows drives', () => {
    expect(() => directChildPath('C:\\Skills', 'D:')).toThrow(/路徑不在/);
  });
});
