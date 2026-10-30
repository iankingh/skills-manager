import path from 'node:path';
import { expandHomePath } from './agentRegistry.js';

/** Resolve one user-supplied name beneath a directory, never a nested path. */
export function directChildPath(parent: string, name: string): string {
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0')
  ) {
    throw new Error(`無效的檔案或資料夾名稱：${String(name)}`);
  }
  const root = expandHomePath(parent);
  const child = path.resolve(root, name);
  const relative = path.relative(root, child);
  if (!relative || relative === '..' || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new Error(`路徑不在指定資料夾內：${name}`);
  }
  return child;
}
