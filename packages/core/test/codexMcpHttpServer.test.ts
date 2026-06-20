import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ModelToolExecutionResult,
  ModelToolExecutor,
  ProviderExecutedToolCall,
} from '../src/model/client.js';
import {
  type EshyraMcpHttpServer,
  startEshyraMcpHttpServer,
} from '../src/model/codexMcpHttpServer.js';
import type { ModelToolDefinition } from '../src/model/toolSchema.js';

/**
 * Round-trip coverage for the in-process Eshyra MCP HTTP server (eshyra-jl8n),
 * driven by the real MCP SDK client over loopback. Verifies tool handlers
 * delegate to the deterministic executor bridge (never reimplementing gameplay),
 * record provider-executed calls under the bare Eshyra name, surface tool errors
 * as MCP `isError` results, and reject unauthenticated requests.
 */

const rollDef: ModelToolDefinition = {
  name: 'roll',
  description: 'roll dice',
  inputSchema: {
    type: 'object',
    properties: { dice: { type: 'string' }, reason: { type: 'string' } },
    required: ['dice'],
    additionalProperties: false,
  },
};

function executorReturning(
  result: ModelToolExecutionResult,
): ModelToolExecutor & { calls: { name: string; args: unknown }[] } {
  const calls: { name: string; args: unknown }[] = [];
  const fn = ((call: { name: string; args: unknown }) => {
    calls.push({ name: call.name, args: call.args });
    return result;
  }) as ModelToolExecutor & { calls: { name: string; args: unknown }[] };
  fn.calls = calls;
  return fn;
}

async function connect(
  server: EshyraMcpHttpServer,
  token = server.token,
): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

describe('startEshyraMcpHttpServer', () => {
  let server: EshyraMcpHttpServer | undefined;
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close().catch(() => {});
    await server?.close().catch(() => {});
    client = undefined;
    server = undefined;
  });

  it('binds a loopback URL with a fresh bearer token', async () => {
    server = await startEshyraMcpHttpServer(
      [rollDef],
      executorReturning({
        ok: true,
        data: {},
      }),
      [],
    );
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(server.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('exposes each tool definition by its bare Eshyra name', async () => {
    server = await startEshyraMcpHttpServer(
      [rollDef],
      executorReturning({ ok: true, data: {} }),
      [],
    );
    client = await connect(server);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['roll']);
  });

  it('delegates a tool call to the executor and records the provider-executed call', async () => {
    const executor = executorReturning({ ok: true, data: { total: 17 } });
    const executed: ProviderExecutedToolCall[] = [];
    server = await startEshyraMcpHttpServer([rollDef], executor, executed);
    client = await connect(server);

    const result = await client.callTool({
      name: 'roll',
      arguments: { dice: '1d20+5', reason: 'attack' },
    });

    // The executor ran with the Eshyra name + args; the server did not reroll.
    expect(executor.calls).toEqual([
      { name: 'roll', args: { dice: '1d20+5', reason: 'attack' } },
    ]);
    // Recorded under the Eshyra name for the transcript.
    expect(executed).toEqual([
      {
        name: 'roll',
        args: { dice: '1d20+5', reason: 'attack' },
        result: { ok: true, data: { total: 17 } },
      },
    ]);
    expect(result.structuredContent).toEqual({
      ok: true,
      data: { total: 17 },
    });
  });

  it('returns a tool error as an MCP isError result without throwing', async () => {
    const executed: ProviderExecutedToolCall[] = [];
    server = await startEshyraMcpHttpServer(
      [rollDef],
      executorReturning({
        ok: false,
        code: 'invalid_args',
        message: 'bad dice',
      }),
      executed,
    );
    client = await connect(server);

    const result = await client.callTool({
      name: 'roll',
      arguments: { dice: '??' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      code: 'invalid_args',
      message: 'bad dice',
    });
    expect(executed[0].result).toEqual({
      ok: false,
      code: 'invalid_args',
      message: 'bad dice',
    });
  });

  it('rejects a request whose bearer token does not match', async () => {
    server = await startEshyraMcpHttpServer(
      [rollDef],
      executorReturning({ ok: true, data: {} }),
      [],
    );
    await expect(connect(server, 'wrong-token')).rejects.toThrow();
  });
});
