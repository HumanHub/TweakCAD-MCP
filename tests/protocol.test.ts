import { describe, it, expect } from 'vitest';
import {
  encode,
  decode,
  isToolResponse,
  isHelloEvent,
} from '../src/protocol.ts';

describe('protocol', () => {
  it('round-trips encode/decode', () => {
    const v = { id: 'r1', ok: true, result: { a: 1 } };
    expect(decode(encode(v))).toEqual(v);
  });

  it('decode returns undefined on bad JSON', () => {
    expect(decode('not json{')).toBeUndefined();
  });

  it('isToolResponse accepts ok + err shapes', () => {
    expect(isToolResponse({ id: 'r1', ok: true, result: 1 })).toBe(true);
    expect(
      isToolResponse({ id: 'r1', ok: false, error: { code: 'X', message: 'm' } }),
    ).toBe(true);
  });

  it('isToolResponse rejects malformed', () => {
    expect(isToolResponse({ ok: true })).toBe(false); // no id
    expect(isToolResponse({ id: 'r1', ok: false })).toBe(false); // no error
    expect(isToolResponse({ id: 'r1', ok: false, error: {} })).toBe(false);
    expect(isToolResponse({ type: 'hello', tools: [] })).toBe(false);
  });

  it('isHelloEvent requires a tools array', () => {
    expect(isHelloEvent({ type: 'hello', tools: [] })).toBe(true);
    expect(isHelloEvent({ type: 'hello' })).toBe(false);
    expect(isHelloEvent({ type: 'other', tools: [] })).toBe(false);
  });
});
