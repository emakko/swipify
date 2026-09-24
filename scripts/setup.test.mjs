import { describe, expect, it } from 'vitest';
import { currentClientId, envWithClientId, parseClientId } from './setup.mjs';

const ID = '0123456789abcdef0123456789ABCDEF';

describe('parseClientId', () => {
  it('accepts 32 hex characters, ignoring surrounding whitespace', () => {
    expect(parseClientId(ID)).toBe(ID);
    expect(parseClientId(`  ${ID}\n`)).toBe(ID);
  });

  it('rejects anything else', () => {
    expect(parseClientId('')).toBeNull();
    expect(parseClientId('paste-your-client-id-here')).toBeNull();
    expect(parseClientId(ID.slice(1))).toBeNull();
    expect(parseClientId(`${ID}0`)).toBeNull();
    expect(parseClientId(ID.replace('0', 'g'))).toBeNull();
  });
});

describe('currentClientId', () => {
  it('reads a valid Client ID from .env contents', () => {
    expect(currentClientId(`VITE_SPOTIFY_CLIENT_ID=${ID}\n`)).toBe(ID);
    expect(currentClientId(`OTHER=1\r\nVITE_SPOTIFY_CLIENT_ID= ${ID} \r\n`)).toBe(ID);
  });

  it('returns null for a missing file, a missing line or the placeholder', () => {
    expect(currentClientId(null)).toBeNull();
    expect(currentClientId('OTHER=1\n')).toBeNull();
    expect(currentClientId('VITE_SPOTIFY_CLIENT_ID=paste-your-client-id-here\n')).toBeNull();
  });
});

describe('envWithClientId', () => {
  it('creates the file contents when there is no .env', () => {
    expect(envWithClientId(null, ID)).toBe(`VITE_SPOTIFY_CLIENT_ID=${ID}\n`);
  });

  it('replaces the existing line and keeps the others', () => {
    const before = 'A=1\nVITE_SPOTIFY_CLIENT_ID=paste-your-client-id-here\nB=2\n';
    expect(envWithClientId(before, ID)).toBe(`A=1\nVITE_SPOTIFY_CLIENT_ID=${ID}\nB=2\n`);
  });

  it('appends the line when it is missing', () => {
    expect(envWithClientId('A=1', ID)).toBe(`A=1\nVITE_SPOTIFY_CLIENT_ID=${ID}\n`);
  });
});
