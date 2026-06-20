# @tweakcad/mcp-bridge

A small Node CLI that relays Model Context Protocol (MCP) traffic between
**any MCP-capable client** and a running TweakCAD web app. MCP is a generic
protocol, so the same bridge works with Claude Desktop, Claude Code, Cursor,
Windsurf, VS Code (Copilot agent mode), Zed, Cline, Gemini CLI, OpenAI Codex,
JetBrains AI Assistant, and any other client that speaks MCP.

The bridge speaks MCP over stdio and WebSocket (`ws://127.0.0.1:7788` by
default) to the browser tab.

```
+----------------+        stdio (MCP)         +-----------------+        ws (JSON)         +----------------+
|  MCP client    | <------------------------> |  tweakcad-mcp   | <----------------------> |  CAD web app   |
+----------------+                            +-----------------+                          +----------------+
```

The bridge itself holds **no document state** — every tool call is forwarded
to the browser, which is the source of truth. Read-only reads
(`get_document`, `get_diagnostics`) are answered from a small in-memory cache
the browser keeps up to date via push events.

## Install / run

From a checkout of the monorepo:

```bash
pnpm --filter @tweakcad/mcp-bridge install
pnpm --filter @tweakcad/mcp-bridge build
pnpm --filter @tweakcad/mcp-bridge start    # listens on ws://127.0.0.1:7788
```

CLI options:

```
tweakcad-mcp [--port <number>]
  --port, -p <number>   WebSocket bridge port (default 7788)
  --help, -h            Show usage
```

Exit with `Ctrl-C`; the bridge closes the WebSocket cleanly and exits 0.

## Register with your MCP client

The bridge presents itself as a standard MCP stdio server: a client launches
`node .../dist/cli.js` and talks to it over stdio. Almost every client uses
the same `mcpServers` JSON object and differs only in **where** that config
lives; a few use a different key or file format. Find your client below and
adjust the absolute path to the built `dist/cli.js`.

### Clients using the standard `mcpServers` JSON

Claude Desktop, Claude Code, Cursor, Windsurf, Cline, Gemini CLI, and most
others accept this exact object — drop it into the file listed in the table:

```json
{
  "mcpServers": {
    "tweakcad": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-bridge/dist/cli.js", "--port", "7788"]
    }
  }
}
```

| Client | Config file |
|---|---|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) · `%APPDATA%\Claude\claude_desktop_config.json` (Windows) — restart after editing |
| Claude Code | project `.mcp.json` (or run `claude mcp add tweakcad -- node /abs/path/dist/cli.js`) |
| Cursor | `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per-project) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Cline (VS Code ext.) | `cline_mcp_settings.json` (via the extension's MCP settings) |
| Gemini CLI | `~/.gemini/settings.json` |
| JetBrains AI Assistant | IDE Settings → Tools → AI Assistant → MCP (same JSON shape) |

### VS Code (Copilot agent mode)

VS Code uses a `servers` key (not `mcpServers`). Add to `.vscode/mcp.json`
in your workspace:

```json
{
  "servers": {
    "tweakcad": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-bridge/dist/cli.js", "--port", "7788"]
    }
  }
}
```

### OpenAI Codex CLI

Codex reads `~/.codex/config.toml`; MCP servers live under the `mcp_servers`
table:

```toml
[mcp_servers.tweakcad]
command = "node"
args = ["/absolute/path/to/mcp-bridge/dist/cli.js", "--port", "7788"]
```

### Zed

Zed calls them `context_servers` in `settings.json`:

```json
{
  "context_servers": {
    "tweakcad": {
      "command": { "path": "node", "args": ["/absolute/path/to/mcp-bridge/dist/cli.js", "--port", "7788"] }
    }
  }
}
```

### Once the package is published

You can skip the absolute path and use the `tweakcad-mcp` command directly —
e.g. for the standard `mcpServers` shape:

```json
{
  "mcpServers": {
    "tweakcad": {
      "command": "tweakcad-mcp",
      "args": ["--port", "7788"]
    }
  }
}
```

## Enable the bridge in the CAD app

Open the CAD app, click the **Settings** icon (top-right), and toggle
**Enable AI bridge** in the AI tab. Set host/port to match the bridge
process (default `localhost:7788`).

A small dot appears next to the Settings icon showing the connection
state — yellow while connecting, green when the bridge is reachable,
red on error. Hover for the URL and last error message; click to jump
back into Settings.

The browser opens a WebSocket to the bridge, sends an initial document
snapshot, and starts answering tool calls. Mutations from the MCP client
go through the same `CommandBus` the human UI uses — bad commands are
rejected with the same validation messages a human would see.

## Tool surface

The bridge forwards the full `@tweakcad/core` tool catalog (~50 tools) to the
connected MCP client, verbatim — the catalogue of record is
`@tweakcad/core` `tools.ts` (mirrored in cad-architecture.md §34). The set:

| Tool | Notes |
|---|---|
| `cad_help` | Returns the workflow guide (canonical ordering, gotchas, patterns). Call first. |
| `get_document` | Cached on the bridge; refreshed by browser push events. |
| `query_features` | Compact timeline summary per part. |
| `get_diagnostics` | Project-wide results cached via push events. Per-part queries round-trip to the browser for filtering. |
| `dispatch_command` | Any `CadCommand` (see `@tweakcad/core/src/commands/types.ts`). Escape hatch when no wrapped tool exists. |
| `begin_transaction` / `end_transaction` | Group multiple dispatches into one undo step. |
| `sketch_create` / `sketch_draw_line` / `sketch_draw_rectangle` / `sketch_draw_circle` / `sketch_draw_slot` / `sketch_draw_arc` / `sketch_draw_arc3point` / `sketch_draw_polygon` / `sketch_draw_ellipse` / `sketch_draw_spline` / `sketch_draw_point` | Wrapped sketch primitives — flat JSON schemas, return new ids. |
| `sketch_apply_constraint` / `sketch_remove_constraint` | Apply / remove any of the 19 constraint kinds (one discriminated-union tool, keyed on `constraint.type`). |
| `sketch_trim` / `sketch_extend` / `sketch_fillet` / `sketch_offset` / `sketch_mirror` | Sketch modify ops (coverage per op: trim line/arc/circle; extend line; fillet line↔line; offset line/circle; mirror line/circle/arc). |
| `sketch_move_point` / `sketch_move_points` | Drag one or many sketch points; re-solves. |
| `list_sketch_elements` / `sketch_pick_geometry` | Sketch id-discovery + hit-test. |
| `feature_extrude` / `feature_revolve` / `feature_loft` / `feature_sweep` | Solid creation. `feature_extrude` and `feature_revolve` auto-pick a profile when one isn't given. |
| `feature_fillet` / `feature_chamfer` / `feature_hole` / `feature_shell` | Edge / face modifiers. Need stable edge / face ids from `list_edges` / `list_faces` (or `find_edges` / `find_face`). |
| `feature_mirror` / `feature_pattern` | Body replication (mirror across plane; linear / circular pattern). |
| `list_bodies` / `list_faces` / `list_edges` | ID-discovery; round-trip to the browser. |
| `find_edges` / `find_face` | Filtered discovery: "edges between two faces", "faces touching this edge", etc. Returns the same shape as `list_*`. |
| `list_sketch_regions` | Closed regions detected in a sketch. |
| `wait_for_rebuild` | Block until the worker has finished its current rebuild. Call after any geometry-creating tool before reading diagnostics. |
| `view_fit_all` | Frame all visible geometry. |
| `view_set_standard` | Snap to `front` / `back` / `top` / `bottom` / `left` / `right` / `home`. |
| `view_zoom` | One step `in` or `out`. |
| `view_screenshot` | JPEG of the viewport returned as image content (multi-modal). |

The browser-side mutations dispatched through `dispatch_command` execute
against the live `documentStore` + `commandBus` — same code path the human
UI uses, so validation messages match exactly what a human would see.

## Architecture notes

- **Single session for v1.** A second browser attempting to connect while
  another is active is rejected with WebSocket close code 1013 and a clear
  reason. Multi-session relay is future work and would require keying tool
  calls by session id (which `@tweakcad/core`'s tools layer doesn't expose
  yet).
- **Cached reads.** `ToolHost.getDocument()` and `getDiagnostics()` are
  synchronous in `@tweakcad/core`, so the bridge maintains a local cache
  that the browser refreshes via `document_changed` / `diagnostics_updated`
  push events. The cache may be slightly stale between user actions but
  that's acceptable at the pace of tool calls.
- **`view_get_state` was removed** from the tool catalog. The earlier
  iteration kept the method but marked it UNSUPPORTED on the bridge
  (camera state would flood the WS if cache-served). The eventual call
  is that the tool earned ~60 tokens of context per request and no
  flow actually needed it. The remaining four view tools (fit /
  standard / zoom / screenshot) are action-shaped and round-trip async
  cleanly.
- **Stdio is reserved for MCP.** All human-readable logging goes to stderr;
  writing diagnostics to stdout would corrupt the MCP framing.

## Development

```bash
pnpm --filter @tweakcad/mcp-bridge typecheck
pnpm --filter @tweakcad/mcp-bridge test
pnpm --filter @tweakcad/mcp-bridge build
```

The test suite mocks the WebSocket client end-to-end; there's no need for a
running browser or MCP client to develop locally.

## License

GNU Affero General Public License, version 3 or later
([AGPL-3.0-or-later](./LICENSE)). Copyright © 2026 HumanHub / TweakCAD.
