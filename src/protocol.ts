/**
 * Wire protocol between the bridge (Node) and the browser (TweakCAD's
 * bridge module).
 *
 * Pure relay: the bridge runs NO tool logic of its own. It forwards each
 * MCP tool call to the browser, which executes it against the live editor
 * and replies. The browser also advertises its tool catalogue on connect
 * so the bridge can answer MCP `ListTools` without bundling the catalogue.
 *
 *   MCP client ──MCP/stdio──▶ bridge ──{executeTool}──▶ browser (runs executeTool)
 *                                    ◀──{result}──────
 *   browser ──{hello, tools}──▶ bridge   (on connect; refreshes ListTools)
 *
 * JSON-only frames. Unparseable/stale frames are dropped on receipt.
 */

// --- Bridge -> browser: run a tool ------------------------------------------

export type ExecuteToolRequest = {
  id: string;
  type: 'executeTool';
  name: string;
  input: unknown;
};

// --- Browser -> bridge: the result of an executeTool request ----------------

export type ToolResponseOk = { id: string; ok: true; result: unknown };
export type ToolResponseErr = {
  id: string;
  ok: false;
  error: { code: string; message: string; field?: string };
};
export type ToolResponse = ToolResponseOk | ToolResponseErr;

// --- Browser -> bridge: advertise the tool catalogue (sent on connect) ------

export type McpToolDescriptor = {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: readonly string[];
    additionalProperties?: boolean;
  };
};

export type HelloEvent = { type: 'hello'; tools: McpToolDescriptor[] };

// --- Type guards (frames come from another process) -------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isToolResponse(v: unknown): v is ToolResponse {
  if (!isRecord(v)) return false;
  if (typeof v.id !== 'string') return false;
  if (v.ok === true) return true;
  if (v.ok === false) {
    const err = (v as { error?: unknown }).error;
    return (
      isRecord(err) &&
      typeof (err as { code?: unknown }).code === 'string' &&
      typeof (err as { message?: unknown }).message === 'string'
    );
  }
  return false;
}

export function isHelloEvent(v: unknown): v is HelloEvent {
  return isRecord(v) && v.type === 'hello' && Array.isArray((v as { tools?: unknown }).tools);
}

/** Encode a value as a JSON string for a WebSocket text frame. */
export function encode(value: unknown): string {
  return JSON.stringify(value);
}

/** Decode a WebSocket text frame; returns `undefined` on parse failure. */
export function decode(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
