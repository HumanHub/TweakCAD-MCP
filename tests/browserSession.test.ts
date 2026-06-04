import { describe, it, expect, vi } from 'vitest';
import { BrowserSession, type WsLike } from '../src/browserSession.ts';
import { encode } from '../src/protocol.ts';

function fakeWs() {
  const sent: string[] = [];
  let open = true;
  const ws: WsLike = {
    send: (d) => sent.push(d),
    isOpen: () => open,
  };
  return { sent, ws, close: () => { open = false; } };
}

describe('BrowserSession', () => {
  it('relays executeTool and resolves with the browser response', async () => {
    const s = new BrowserSession();
    const { sent, ws } = fakeWs();
    s.attach(ws);

    const p = s.executeTool('get_document', { a: 1 });
    expect(sent).toHaveLength(1);
    const req = JSON.parse(sent[0]!);
    expect(req.type).toBe('executeTool');
    expect(req.name).toBe('get_document');
    expect(req.input).toEqual({ a: 1 });

    s.handleFrame(encode({ id: req.id, ok: true, result: { doc: true } }));
    await expect(p).resolves.toEqual({ id: req.id, ok: true, result: { doc: true } });
  });

  it('rejects when no browser session is attached', async () => {
    const s = new BrowserSession();
    await expect(s.executeTool('x', {})).rejects.toThrow(/no active browser session/i);
  });

  it('captures the hello catalogue and fires onToolsChanged', () => {
    const s = new BrowserSession();
    const { ws } = fakeWs();
    s.attach(ws);
    const spy = vi.fn();
    s.onToolsChanged = spy;

    s.handleFrame(
      encode({
        type: 'hello',
        tools: [{ name: 'get_document', description: 'd', inputSchema: { type: 'object' } }],
      }),
    );

    expect(s.getTools()).toHaveLength(1);
    expect(s.getTools()[0]!.name).toBe('get_document');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('detach rejects in-flight calls and clears the catalogue', async () => {
    const s = new BrowserSession();
    const { ws } = fakeWs();
    s.attach(ws);
    s.handleFrame(
      encode({ type: 'hello', tools: [{ name: 'a', description: '', inputSchema: { type: 'object' } }] }),
    );
    const changed = vi.fn();
    s.onToolsChanged = changed;

    const p = s.executeTool('a', {});
    s.detach('gone');

    await expect(p).rejects.toThrow(/gone/);
    expect(s.getTools()).toHaveLength(0);
    expect(changed).toHaveBeenCalled(); // catalogue cleared
  });

  it('times out a call with no reply', async () => {
    const s = new BrowserSession({ requestTimeoutMs: 10 });
    const { ws } = fakeWs();
    s.attach(ws);
    await expect(s.executeTool('x', {})).rejects.toThrow(/timed out/);
  });
});
