import { createRequire } from "node:module";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { fetchAllProviders } from "./providers.js";

const _require = createRequire(import.meta.url);
const { version } = _require("../package.json") as { version: string };

const TOOL_NAME = "get_provider_status";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function parseArguments(value: unknown): { timeoutMs?: number } | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  const { timeoutMs } = value;
  if (timeoutMs !== undefined && typeof timeoutMs !== "number") return undefined;
  return { timeoutMs };
}

export async function runMcpServer(): Promise<void> {
  const server = new Server(
    { name: "provider-status-mcp", version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: TOOL_NAME,
        description:
          "Retrieve aggregated status for all AI providers: Claude, Codex (OpenAI), and GitHub Copilot. " +
          "Returns whether each provider is currently rate limited, current window usage percentage, " +
          "and when each limit resets. Use this to quickly determine which provider is available for work.",
        inputSchema: {
          type: "object",
          properties: {
            timeoutMs: {
              type: "number",
              description: "Per-provider timeout in milliseconds. Defaults to 30000.",
            },
          },
          additionalProperties: false,
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== TOOL_NAME) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      };
    }

    const args = parseArguments(request.params.arguments);
    if (!args) {
      return {
        content: [{ type: "text", text: "Invalid arguments: timeoutMs must be a number." }],
        isError: true,
      };
    }

    try {
      const result = await fetchAllProviders(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
