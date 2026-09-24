import { describe, expect, it } from 'vitest';
import { codeChallenge, generateVerifier } from './pkce';

describe('pkce', () => {
  it('computes the RFC 7636 example challenge', async () => {
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('generates verifiers of the requested length from the allowed alphabet', () => {
    expect(generateVerifier()).toMatch(/^[A-Za-z0-9\-._~]{64}$/);
    expect(generateVerifier(16)).toHaveLength(16);
  });

  it('generates a different verifier each time', () => {
    expect(generateVerifier()).not.toBe(generateVerifier());
  });
});
