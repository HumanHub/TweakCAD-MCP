/**
 * Library entry point — re-exports the bridge surface for tests and any
 * programmatic embedding. End users invoke the CLI (`tweakcad-mcp`).
 */

export { BridgeServer, type BridgeServerOptions } from './bridgeServer.ts';
export {
  BrowserSession,
  NO_SESSION_MESSAGE,
  type BrowserSessionOptions,
  type WsLike,
} from './browserSession.ts';
export { createMcpServer, type McpServerOptions } from './mcpServer.ts';
export type {
  ExecuteToolRequest,
  ToolResponse,
  ToolResponseOk,
  ToolResponseErr,
  HelloEvent,
  McpToolDescriptor,
} from './protocol.ts';
export { encode, decode, isToolResponse, isHelloEvent } from './protocol.ts';
