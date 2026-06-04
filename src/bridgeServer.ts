/**
 * WebSocket server that accepts a single browser session and routes
 * its frames into the shared `BrowserSession`.
 *
 * Single-session policy (v1)
 * --------------------------
 * Only one browser may be connected at a time. Concurrent attempts are
 * rejected immediately with a 1013 ("try again later") close code and
 * a descriptive reason. Multi-session relay is future work — it would
 * require keying relayed calls by session id.
 */

import { WebSocketServer, type WebSocket } from 'ws';
import { BrowserSession, type WsLike } from './browserSession.ts';

export interface BridgeServerOptions {
  /** TCP port to listen on. */
  port: number;
  /** Bind host. Default: 127.0.0.1 (loopback only). */
  host?: string;
  /** Called whenever the session count transitions 0->1 or 1->0. */
  onSessionChange?: (sessions: number) => void;
  /** Optional sink for human-readable status lines. */
  log?: (line: string) => void;
}

const NOOP_LOG = (_line: string): void => {
  /* swallowed */
};

/**
 * Wrap a `ws.WebSocket` as the WsLike duck-type expected by BrowserSession.
 */
function adapt(ws: WebSocket): WsLike {
  return {
    send: (data) => ws.send(data),
    isOpen: () => ws.readyState === ws.OPEN,
  };
}

export class BridgeServer {
  private readonly opts: Required<Omit<BridgeServerOptions, 'onSessionChange' | 'host'>> &
    Pick<BridgeServerOptions, 'onSessionChange' | 'host'>;
  private wss: WebSocketServer | null = null;
  private active: WebSocket | null = null;
  private readonly host: BrowserSession;

  constructor(host: BrowserSession, opts: BridgeServerOptions) {
    this.host = host;
    this.opts = {
      port: opts.port,
      log: opts.log ?? NOOP_LOG,
      ...(opts.host !== undefined ? { host: opts.host } : {}),
      ...(opts.onSessionChange !== undefined
        ? { onSessionChange: opts.onSessionChange }
        : {}),
    };
  }

  /** Start listening. Resolves once the server is bound. */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wssOpts: ConstructorParameters<typeof WebSocketServer>[0] = {
        port: this.opts.port,
        host: this.opts.host ?? '127.0.0.1',
      };
      const wss = new WebSocketServer(wssOpts);

      const onListening = (): void => {
        wss.off('error', onError);
        resolve();
      };
      const onError = (err: Error): void => {
        wss.off('listening', onListening);
        reject(err);
      };
      wss.once('listening', onListening);
      wss.once('error', onError);

      wss.on('connection', (ws) => this.onConnection(ws));
      this.wss = wss;
    });
  }

  /** Stop accepting connections and close the active session, if any. */
  async stop(): Promise<void> {
    const wss = this.wss;
    this.wss = null;
    if (this.active !== null) {
      try {
        this.active.close(1001, 'bridge shutting down');
      } catch {
        /* ignore */
      }
      this.active = null;
      this.host.detach('bridge shutting down');
      this.opts.onSessionChange?.(0);
    }
    if (wss === null) return;
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
  }

  private onConnection(ws: WebSocket): void {
    if (this.active !== null) {
      this.opts.log('rejecting connection — another browser is already attached');
      try {
        ws.close(1013, 'another browser is already attached');
      } catch {
        /* ignore */
      }
      return;
    }

    this.active = ws;
    this.host.attach(adapt(ws));
    this.opts.log('browser connected (1 active session)');
    this.opts.onSessionChange?.(1);

    ws.on('message', (raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      this.host.handleFrame(text);
    });

    const teardown = (reason: string): void => {
      if (this.active !== ws) return;
      this.active = null;
      this.host.detach(reason);
      this.opts.log(`browser disconnected (${reason}) — 0 active sessions`);
      this.opts.onSessionChange?.(0);
    };

    ws.on('close', () => teardown('socket closed'));
    ws.on('error', (err) => {
      this.opts.log(`socket error: ${err.message}`);
      teardown(`socket error: ${err.message}`);
    });
  }
}
