/**
 * MCP stdio server. Pure relay: it advertises the tool catalogue the
 * browser sent via `hello`, and forwards each tool call to the browser
 * through the BrowserSession. No `@tweakcad/core`, no tool logic here.
 *
 * Before a browser connects, ListTools is empty; when one connects (or
 * disconnects) we emit `tools/list_changed` so the client re-fetches.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { BrowserSession, NO_SESSION_MESSAGE } from './browserSession.ts';

export interface McpServerOptions {
  name?: string;
  version?: string;
}

const DEFAULT_NAME = 'tweakcad-mcp-bridge';
const DEFAULT_VERSION = '0.1.0';

/** An image value the browser's executor returns for view_screenshot. */
type ImageValue = { kind: 'image'; mimeType: string; data: string };
function isImageValue(v: unknown): v is ImageValue {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { kind?: unknown }).kind === 'image' &&
    typeof (v as { data?: unknown }).data === 'string' &&
    typeof (v as { mimeType?: unknown }).mimeType === 'string'
  );
}

export function createMcpServer(
  session: BrowserSession,
  opts: McpServerOptions = {},
): {
  server: Server;
  connectStdio: () => Promise<void>;
} {
  const server = new Server(
    { name: opts.name ?? DEFAULT_NAME, version: opts.version ?? DEFAULT_VERSION },
    { capabilities: { tools: { listChanged: true } } },
  );

  // Browser connect/disconnect changes the catalogue → tell the client.
  session.onToolsChanged = () => {
    server.sendToolListChanged().catch(() => {
      /* client may not support notifications; ignore */
    });
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: session.getTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const input = req.params.arguments ?? {};

    let res;
    try {
      res = await session.executeTool(name, input);
    } catch (e) {
      // No session / timeout / transport error — surface as a tool error.
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: e instanceof Error ? e.message : String(e),
          },
        ],
      };
    }

    if (!res.ok) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `[${res.error.code}] ${res.error.message}` }],
      };
    }

    // view_screenshot returns an image value — surface it as MCP image
    // content so the client can actually see it.
    if (isImageValue(res.result)) {
      return {
        content: [
          { type: 'image' as const, data: res.result.data, mimeType: res.result.mimeType },
        ],
      };
    }

    return {
      content: [{ type: 'text' as const, text: safeStringify(res.result) }],
    };
  });

  const connectStdio = async (): Promise<void> => {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  };

  return { server, connectStdio };
}

/** `JSON.stringify` that survives circular refs and BigInts. */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_k, v) => {
      if (typeof v === 'bigint') return v.toString();
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    },
    2,
  );
}

// Re-export so cli.ts and tests don't need a separate import.
export { NO_SESSION_MESSAGE };
