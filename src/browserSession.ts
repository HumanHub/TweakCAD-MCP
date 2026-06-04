/**
 * BrowserSession — the bridge's view of the one connected browser tab.
 *
 * Pure relay: this holds NO document cache and runs NO tool logic. It
 * (1) forwards `executeTool` requests to the browser and correlates the
 * replies by id, and (2) keeps the latest tool catalogue the browser
 * advertised via `hello`, so the MCP server can answer ListTools.
 *
 * Replaces the old SessionHost, which implemented the core ToolHost
 * interface + a push-fed document cache. None of that is needed once
 * execution runs in the browser (where the live document already lives).
 */

import {
  encode,
  decode,
  isToolResponse,
  isHelloEvent,
  type ExecuteToolRequest,
  type ToolResponse,
  type McpToolDescriptor,
} from './protocol.ts';

/** Minimal duck-typed WebSocket (the subset both `ws` and tests provide). */
export interface WsLike {
  send(data: string): void;
  /** `true` if the socket is open and `send` is safe to call. */
  isOpen(): boolean;
}

export const NO_SESSION_MESSAGE =
  'no active browser session — open TweakCAD and enable the AI bridge in Settings → AI.';

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

type Pending = {
  resolve: (r: ToolResponse) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export interface BrowserSessionOptions {
  /** Override the per-call round-trip timeout (ms). Default: 60 000. */
  requestTimeoutMs?: number;
}

export class BrowserSession {
  private socket: WsLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private readonly timeoutMs: number;
  private tools: McpToolDescriptor[] = [];

  /**
   * Fired when the advertised tool catalogue changes (browser connect with
   * `hello`, or disconnect → empty). The MCP server wires this to
   * `tools/list_changed` so MCP clients re-fetch ListTools.
   */
  onToolsChanged: (() => void) | null = null;

  constructor(opts: BrowserSessionOptions = {}) {
    this.timeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  // --- Lifecycle ------------------------------------------------------------

  attach(socket: WsLike): void {
    this.socket = socket;
  }

  /** Drop the socket: reject in-flight calls and clear the catalogue. */
  detach(reason = 'browser disconnected'): void {
    this.socket = null;
    const err = new Error(reason);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    if (this.tools.length > 0) {
      this.tools = [];
      this.onToolsChanged?.();
    }
  }

  hasSession(): boolean {
    return this.socket !== null && this.socket.isOpen();
  }

  /** The tools the browser last advertised (empty when no session). */
  getTools(): McpToolDescriptor[] {
    return this.tools;
  }

  /** Feed a raw text frame: a tool response (resolve) or a hello (catalogue). */
  handleFrame(text: string): void {
    const parsed = decode(text);
    if (parsed === undefined) return;

    if (isToolResponse(parsed)) {
      const p = this.pending.get(parsed.id);
      if (!p) return; // late / duplicate
      this.pending.delete(parsed.id);
      clearTimeout(p.timer);
      p.resolve(parsed);
      return;
    }

    if (isHelloEvent(parsed)) {
      this.tools = parsed.tools;
      this.onToolsChanged?.();
    }
  }

  // --- Relay ----------------------------------------------------------------

  /**
   * Forward a tool call to the browser and await its reply. Rejects if no
   * browser is connected or the round-trip times out.
   */
  executeTool(name: string, input: unknown): Promise<ToolResponse> {
    const sock = this.socket;
    if (sock === null || !sock.isOpen()) {
      return Promise.reject(new Error(NO_SESSION_MESSAGE));
    }
    const id = `r${this.nextId++}`;
    const req: ExecuteToolRequest = { id, type: 'executeTool', name, input };
    return new Promise<ToolResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`tool '${name}' timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        sock.send(encode(req));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }
}
