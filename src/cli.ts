#!/usr/bin/env node
/**
 * tweakcad-mcp CLI entrypoint.
 *
 * Starts:
 *   - a WebSocket server on --port (default 7788), single-session.
 *   - an MCP stdio server. The bridge is a pure relay: tool calls are
 *     forwarded to the connected browser, which runs them against the
 *     live editor and replies. The browser advertises its tool catalogue
 *     on connect.
 *
 * MCP traffic flows over stdio (stdin = client -> server, stdout =
 * server -> client). Everything human-readable goes to STDERR so we
 * never corrupt the stdio protocol.
 */

import { BridgeServer } from './bridgeServer.ts';
import { BrowserSession } from './browserSession.ts';
import { createMcpServer } from './mcpServer.ts';

const DEFAULT_PORT = 7788;

function parseArgs(argv: readonly string[]): {
  port: number;
  help: boolean;
} {
  let port = DEFAULT_PORT;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      help = true;
    } else if (a === '--port' || a === '-p') {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error(`${a} requires a value`);
      }
      const n = Number(next);
      if (!Number.isInteger(n) || n <= 0 || n > 65535) {
        throw new Error(`invalid port: ${next}`);
      }
      port = n;
      i++;
    } else if (a !== undefined && a.startsWith('--port=')) {
      const n = Number(a.slice('--port='.length));
      if (!Number.isInteger(n) || n <= 0 || n > 65535) {
        throw new Error(`invalid port: ${a}`);
      }
      port = n;
    } else {
      throw new Error(`unknown argument: ${String(a)}`);
    }
  }
  return { port, help };
}

const USAGE = `tweakcad-mcp — MCP relay for the TweakCAD

USAGE
  tweakcad-mcp [--port <number>]

OPTIONS
  --port, -p <number>   WebSocket bridge port (default ${DEFAULT_PORT})
  --help, -h            Show this message

The bridge speaks MCP on stdio (for Claude Desktop or another MCP
client) and relays tool calls to the running TweakCAD web app over
WebSocket. Open the web app and enable the AI bridge in Settings -> AI
to connect.
`;

function log(line: string): void {
  // Never write to stdout — that channel belongs to MCP.
  process.stderr.write(`[tweakcad-mcp] ${line}\n`);
}

async function main(argv: readonly string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    process.stderr.write(USAGE);
    return 2;
  }

  if (parsed.help) {
    process.stderr.write(USAGE);
    return 0;
  }

  const host = new BrowserSession();
  const bridge = new BridgeServer(host, {
    port: parsed.port,
    log,
    onSessionChange: (n) => {
      if (n === 0) log('waiting for browser session...');
    },
  });

  try {
    await bridge.start();
  } catch (e) {
    log(`failed to start WebSocket bridge: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  log(`WebSocket bridge listening on ws://127.0.0.1:${parsed.port}`);
  log('waiting for browser session...');

  const { connectStdio } = createMcpServer(host);
  try {
    await connectStdio();
  } catch (e) {
    log(`failed to start MCP stdio server: ${e instanceof Error ? e.message : String(e)}`);
    await bridge.stop();
    return 1;
  }
  log('MCP server ready on stdio');

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`received ${signal}, shutting down...`);
    bridge
      .stop()
      .catch((e) => log(`shutdown error: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        process.exit(0);
      });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Keep the process alive; stdio + ws both hold event-loop refs.
  return await new Promise<number>(() => {
    /* never resolves — exit via signal handler */
  });
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== 0) process.exit(code);
  },
  (err) => {
    process.stderr.write(`[tweakcad-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
