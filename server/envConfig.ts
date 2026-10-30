import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves the project root directory whether running from `server/` (tsx) or `dist-server/server/` (built).
 */
export function getProjectRootDir(): string {
  const candidates = [
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '../..'),
    process.cwd(),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
  }
  return process.cwd();
}

/**
 * Loads `.env` from the project root into `process.env` without overriding existing environment variables.
 * If `.env` does not exist yet, automatically bootstraps it from `.env.example` so git clones work out-of-the-box.
 */
export function loadDotEnv(): void {
  const rootDir = getProjectRootDir();
  const envPath = path.join(rootDir, '.env');
  const envExamplePath = path.join(rootDir, '.env.example');

  if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
    try {
      fs.copyFileSync(envExamplePath, envPath);
    } catch {
      // Ignore if directory is read-only
    }
  }

  const targetToRead = fs.existsSync(envPath)
    ? envPath
    : fs.existsSync(envExamplePath)
    ? envExamplePath
    : null;
  if (!targetToRead) return;

  try {
    const content = fs.readFileSync(targetToRead, 'utf-8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // Ignore .env read errors
  }
}

// Automatically load .env on module import
loadDotEnv();

export function resolveSeedDirectory(envVarName: string, defaultRelativeDir: string): string {
  const rootDir = getProjectRootDir();
  const raw = process.env[envVarName]?.trim() || defaultRelativeDir;
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(rootDir, raw);
}
