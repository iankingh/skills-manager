import path from 'node:path';

/** Resolve one user-supplied name beneath a directory, never a nested path. */
export function directChildPath(parent: string, name: string): string {
  if (
    typeof name !== 'string' ||
    !name ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0')
  ) {
    throw new Error(`無效的檔案或資料夾名稱：${String(name)}`);
  }
  const root = path.resolve(parent);
  const child = path.resolve(root, name);
  if (path.dirname(child) !== root) {
    throw new Error(`路徑不在指定資料夾內：${name}`);
  }
  return child;
}
