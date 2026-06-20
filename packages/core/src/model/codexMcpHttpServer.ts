import { randomBytes, randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {
  ModelToolExecutionResult,
  ModelToolExecutor,
  ProviderExecutedToolCall,
} from './client.js';
import { ESHYRA_MCP_SERVER_NAME } from './codexEnv.js';
import { toolInputSchemaToZodShape } from './jsonSchemaToZod.js';
import type { ModelToolDefinition } from './toolSchema.js';

/**
 * In-process Streamable-HTTP MCP server for the Codex adapter (eshyra-jl8n).
 *
 * Codex has no in-process MCP option like the Claude Agent SDK's
 * `createSdkMcpServer`: the `codex` CLI connects to MCP servers either as stdio
 * subprocesses or over Streamable HTTP. To keep Eshyra tool execution in the
 * SAME process as the deterministic executor — so a tool call runs inside the
 * live, SAVEPOINT-wrapped turn transaction rather than a second DB handle in a
 * spawned process — this module hosts an MCP server over loopback HTTP and
 * points Codex at it (`mcp_servers.eshyra.url`). The CLI is the MCP client; the
 * tool handlers run here, in the parent.
 *
 * Each tool handler delegates to the {@link ModelToolExecutor} bridge and
 * records the call/result as a {@link ProviderExecutedToolCall} under the bare
 * Eshyra name — exactly the provider-executed-call pattern the Claude Agent SDK
 * MCP adapter uses. The handler never reimplements gameplay semantics; a tool
 * failure comes back as an MCP error result (with `isError`) rather than a throw
 * so one bad call cannot crash the agent loop.
 *
 * Access control: the server binds to `127.0.0.1` on an ephemeral port and
 * requires a per-call bearer token (a fresh 256-bit secret). Codex sends it via
 * `mcp_servers.eshyra.bearer_token_env_var`. Requests without the exact token
 * get a `401` and never reach a tool. The server lives only for the duration of
 * one `complete()` call and is torn down in a `finally`.
 */

/** Path the MCP Streamable-HTTP endpoint is served on. */
const MCP_ENDPOINT_PATH = '/mcp';

/** The MCP tool-result shape returned by a handler. Mirrors `CallToolResult`. */
interface McpToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Serialize a deterministic tool result into an MCP tool-result payload. */
function toResultPayload(
  result: ModelToolExecutionResult,
): Record<string, unknown> {
  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, code: result.code, message: result.message };
}

/** Render a deterministic tool result as an MCP `CallToolResult`. */
function toMcpToolResult(result: ModelToolExecutionResult): McpToolResult {
  const payload = toResultPayload(result);
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    ...(result.ok ? {} : { isError: true }),
  };
}

/** A running in-process Eshyra MCP server bound to loopback. */
export interface EshyraMcpHttpServer {
  /** Full URL Codex should connect to (e.g. `http://127.0.0.1:54123/mcp`). */
  readonly url: string;
  /** Bearer token the server requires on every request. */
  readonly token: string;
  /** Stop the HTTP listener and close the MCP transport. Idempotent. */
  close(): Promise<void>;
}

/**
 * Start an in-process Streamable-HTTP MCP server exposing `defs` as tools whose
 * handlers run through `executor` and append to `executed`. Resolves once the
 * server is listening on an ephemeral loopback port.
 */
export async function startEshyraMcpHttpServer(
  defs: readonly ModelToolDefinition[],
  executor: ModelToolExecutor | undefined,
  executed: ProviderExecutedToolCall[],
): Promise<EshyraMcpHttpServer> {
  const token = randomBytes(32).toString('hex');

  const mcp = new McpServer({
    name: ESHYRA_MCP_SERVER_NAME,
    version: '0.1.0',
  });

  for (const def of defs) {
    mcp.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: toolInputSchemaToZodShape(def.inputSchema),
      },
      async (args: unknown) => {
        const result: ModelToolExecutionResult = executor
          ? await executor({ name: def.name, args })
          : {
              ok: false,
              code: 'no_executor',
              message: `no tool executor wired for ${def.name}`,
            };
        // Record under the Eshyra name — provider/MCP naming never reaches here.
        executed.push({ name: def.name, args, result });
        return toMcpToolResult(result);
      },
    );
  }

  // Stateful single-session transport: the MCP handshake's
  // `notifications/initialized` POST is only accepted when a session id is in
  // play (stateless mode rejects it), and both the MCP SDK client and Codex's
  // rmcp client echo the `mcp-session-id` from the initialize response
  // automatically. `enableJsonResponse` keeps responses plain JSON — no SSE
  // stream needed for a single short-lived turn.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  });
  await mcp.connect(transport);

  const httpServer: Server = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        try {
          if (!authorized(req, token) || !isMcpPath(req)) {
            res.writeHead(req.headers.authorization ? 404 : 401).end();
            return;
          }
          // Let the transport's Node wrapper read the request stream itself —
          // pre-draining it here would hand the transport an empty body.
          await transport.handleRequest(req, res);
        } catch {
          if (!res.headersSent) {
            res.writeHead(500).end();
          }
        }
      })();
    },
  );

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });

  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    httpServer.close();
    throw new Error('Eshyra MCP server failed to bind a loopback port');
  }

  let closed = false;
  return {
    url: `http://127.0.0.1:${address.port}${MCP_ENDPOINT_PATH}`,
    token,
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      await transport.close().catch(() => {});
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

/** True when the request carries exactly the expected bearer token. */
function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization;
  return header === `Bearer ${token}`;
}

/** True when the request targets the MCP endpoint path. */
function isMcpPath(req: IncomingMessage): boolean {
  const path = (req.url ?? '').split('?')[0];
  return path === MCP_ENDPOINT_PATH;
}
