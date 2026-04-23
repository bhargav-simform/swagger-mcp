import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fetchSwaggerJson } from "./fetchSpec.js";
import { buildIntegrationJson } from "./swagger.js";

const debugEnabled =
  process.env.SWAGGER_MCP_DEBUG === "1" ||
  process.env.SWAGGER_MCP_DEBUG === "true" ||
  process.env.DEBUG === "swagger-mcp" ||
  process.env.DEBUG === "1" ||
  process.env.DEBUG === "true";

function debugLog(message: string) {
  if (!debugEnabled) return;
  process.stderr.write(`[swagger-mcp] ${message}\n`);
}

const server = new McpServer({
  name: "swagger-mcp",
  version: "1.0.0",
});

debugLog(`starting (pid=${process.pid})`);

server.registerTool(
  "swagger-integrationJson",
  {
    title: "Swagger → Integration JSON",
    description:
      "Fetch a Swagger/OpenAPI JSON URL (optionally Basic Auth) and return a normalized JSON index of endpoints, schemas, and auth schemes to help integrate the API quickly.",
    inputSchema: z
      .object({
        jsonUrl: z
          .string()
          .url()
          .refine(
            (url) => {
              try {
                const { protocol } = new URL(url);
                return protocol === "http:" || protocol === "https:";
              } catch {
                return false;
              }
            },
            { message: "jsonUrl must use the http or https protocol." },
          )
          .describe("Public or internal URL (http or https) to the Swagger/OpenAPI JSON document."),
        username: z.string().min(1).max(255).optional().describe("Optional HTTP Basic Auth username."),
        password: z.string().min(1).max(255).optional().describe("Optional HTTP Basic Auth password."),
      })
      .refine(
        (data) =>
          (data.username !== undefined && data.password !== undefined) ||
          (data.username === undefined && data.password === undefined),
        {
          message: "username and password must both be provided together, or both omitted.",
        },
      ),
    // NOTE: MCP SDK currently normalizes output schemas as objects; using `z.any()`
    // can cause `normalizeObjectSchema()` to return `undefined`, which later crashes
    // during output validation (Cannot read properties of undefined (reading '_zod')).
    // A permissive passthrough object keeps validation enabled without over-specifying.
    outputSchema: z.object({}).passthrough(),
  },
  async ({ jsonUrl, username, password }) => {
    try {
      const fetchedAt = new Date().toISOString();
      const fetchParams: { jsonUrl: string; username?: string; password?: string } = { jsonUrl };
      if (username !== undefined) fetchParams.username = username;
      if (password !== undefined) fetchParams.password = password;
      const { status, contentType, json } = await fetchSwaggerJson(fetchParams);

      const buildParams: Parameters<typeof buildIntegrationJson>[0] = {
        jsonUrl,
        fetchedAt,
        httpStatus: status,
        contentType,
        spec: json,
      };
      if (username !== undefined) buildParams.username = username;
      if (password !== undefined) buildParams.password = password;

      const result = buildIntegrationJson(buildParams);

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: message }],
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  debugLog("connecting stdio transport");
  await server.connect(transport);
  debugLog("connected");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
