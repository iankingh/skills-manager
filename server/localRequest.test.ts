import { describe, expect, it } from 'vitest';
import { isTrustedLocalRequest } from './localRequest.js';

describe('local HTTP request boundary', () => {
  it('accepts the local app and local CLI', () => {
    expect(isTrustedLocalRequest({ host: '127.0.0.1:3847' })).toBe(true);
    expect(isTrustedLocalRequest({ host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' })).toBe(true);
  });

  it.each(['[::1]', '[::1]:3847', '::1'])('accepts IPv6 loopback Host %s', (host) => {
    expect(isTrustedLocalRequest({ host })).toBe(true);
  });

  it('accepts a bracketed IPv6 loopback Origin', () => {
    expect(isTrustedLocalRequest({ host: '[::1]:3847', origin: 'http://[::1]:5173' })).toBe(true);
  });

  it.each([undefined, '', '::1:3847', '[::2]:3847', '[::1].evil.example:3847'])('rejects missing or invalid Host %s', (host) => {
    expect(isTrustedLocalRequest({ host })).toBe(false);
  });

  it.each(['null', 'not-a-url', 'file:///tmp/app', 'https://localhost:3847', 'http://[::2]:5173'])('rejects invalid Origin %s', (origin) => {
    expect(isTrustedLocalRequest({ host: '[::1]:3847', origin })).toBe(false);
  });

  it('keeps cross-site requests blocked for IPv6 loopback', () => {
    expect(isTrustedLocalRequest({ host: '[::1]:3847', 'sec-fetch-site': 'cross-site' })).toBe(false);
  });

  it('rejects remote origins and rebinding hosts', () => {
    expect(isTrustedLocalRequest({ host: 'evil.example:3847' })).toBe(false);
    expect(isTrustedLocalRequest({ host: '127.0.0.1:3847', origin: 'https://evil.example' })).toBe(false);
    expect(isTrustedLocalRequest({ host: '127.0.0.1:3847', 'sec-fetch-site': 'cross-site' })).toBe(false);
    expect(isTrustedLocalRequest({ host: 'localhost.evil.example:3847' })).toBe(false);
  });
});
