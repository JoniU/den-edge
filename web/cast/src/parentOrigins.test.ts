import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_PARENT_ORIGINS, parentOrigins } from './parentOrigins';

describe('Cast sender parent origins', () => {
  it('allows the production app and exact one-command contributor origin by default', () => {
    expect([...parentOrigins()]).toEqual(['https://d.oxy.fi', 'http://localhost:5173']);
  });

  it('accepts the build-time space/comma format without widening origins', () => {
    expect([...parentOrigins('https://one.example, https://two.example')]).toEqual([
      'https://one.example',
      'https://two.example',
    ]);
    expect(parentOrigins().has('http://localhost:5174')).toBe(false);
  });

  it('keeps every bundled default in the server CSP and image build', () => {
    const rust = readFileSync(new URL('../../../src/cast.rs', import.meta.url), 'utf8');
    const dockerfile = readFileSync(new URL('../../../Dockerfile', import.meta.url), 'utf8');
    expect(rust.match(/None => "([^"]+)",/)?.[1]).toBe(DEFAULT_PARENT_ORIGINS);
    const imageOrigins = parentOrigins(
      dockerfile.match(/ARG DEN_PARENT_ORIGINS="([^"]+)"/)?.[1] ?? '',
    );
    for (const origin of parentOrigins()) expect(imageOrigins.has(origin)).toBe(true);
  });
});
