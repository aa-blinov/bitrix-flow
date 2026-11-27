import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pkceMatches, redirectMatches, validRedirectUri } from './mcp-oauth';

describe('validRedirectUri', () => {
  it('accepts https, loopback http and native app schemes', () => {
    expect(validRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(validRedirectUri('http://127.0.0.1:33418/callback')).toBe(true);
    expect(validRedirectUri('http://localhost:6274/oauth/callback')).toBe(true);
    expect(validRedirectUri('cursor://anysphere.cursor-retrieval/oauth/callback')).toBe(true);
  });

  // Страница согласия сама переходит по адресу возврата: исполняемая схема дала бы XSS.
  it('rejects schemes that run code and plain http to other hosts', () => {
    expect(validRedirectUri('javascript:alert(1)')).toBe(false);
    expect(validRedirectUri('JavaScript:alert(1)')).toBe(false);
    expect(validRedirectUri('data:text/html,hi')).toBe(false);
    expect(validRedirectUri('http://evil.example/cb')).toBe(false);
    expect(validRedirectUri('https://claude.ai/cb#frag')).toBe(false);
    expect(validRedirectUri('https://user:pass@claude.ai/cb')).toBe(false);
    expect(validRedirectUri(42)).toBe(false);
  });
});

describe('redirectMatches', () => {
  it('matches exactly, and loopback on any port', () => {
    const registered = ['https://claude.ai/cb', 'http://127.0.0.1:1000/cb'];
    expect(redirectMatches(registered, 'https://claude.ai/cb')).toBe(true);
    expect(redirectMatches(registered, 'https://claude.ai/cb/../x')).toBe(false);
    expect(redirectMatches(registered, 'https://claude.ai/cb?x=1')).toBe(false);
    expect(redirectMatches(registered, 'http://127.0.0.1:5555/cb')).toBe(true);
    expect(redirectMatches(registered, 'http://127.0.0.1:5555/other')).toBe(false);
    expect(redirectMatches(registered, 'http://localhost:1000/cb')).toBe(false);
  });
});

describe('pkceMatches', () => {
  it('checks the S256 challenge', () => {
    const verifier = 'a'.repeat(43);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(pkceMatches(verifier, challenge)).toBe(true);
    expect(pkceMatches('b'.repeat(43), challenge)).toBe(false);
    expect(pkceMatches('short', challenge)).toBe(false);
  });
});
