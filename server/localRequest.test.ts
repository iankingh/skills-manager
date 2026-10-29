import { describe, expect, it } from 'vitest';
import { isTrustedLocalRequest } from './localRequest.js';

describe('local HTTP request boundary', () => {
  it('accepts the local app and local CLI', () => {
    expect(isTrustedLocalRequest({ host: '127.0.0.1:3847' })).toBe(true);
    expect(isTrustedLocalRequest({ host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' })).toBe(true);
  });

  it('rejects remote origins and rebinding hosts', () => {
    expect(isTrustedLocalRequest({ host: 'evil.example:3847' })).toBe(false);
    expect(isTrustedLocalRequest({ host: '127.0.0.1:3847', origin: 'https://evil.example' })).toBe(false);
    expect(isTrustedLocalRequest({ host: '127.0.0.1:3847', 'sec-fetch-site': 'cross-site' })).toBe(false);
    expect(isTrustedLocalRequest({ host: 'localhost.evil.example:3847' })).toBe(false);
  });
});
