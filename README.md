# swagger-mcp

An MCP (Model Context Protocol) server that fetches a Swagger/OpenAPI **JSON** document and returns an **integration-friendly JSON index**:
- API metadata (title/version/servers/tags)
- Auth schemes + global security requirements
- Endpoints (path + method) with parameters, request bodies, and response schemas
- Component schemas (simplified)

## Install

```bash
npm install
npm run build
```

## Run (stdio MCP server)

```bash
node dist/index.js
```

Your MCP client should launch the server as a stdio process.
If you run it in a normal terminal, it will appear to “hang” because it’s waiting for MCP JSON-RPC messages on stdin.

### Debug logs

Enable startup logs on stderr:

```bash
SWAGGER_MCP_DEBUG=1 node dist/index.js
```

## MCP Tool

### `swagger.integrationJson`

Input:
```json
{
  "jsonUrl": "https://example.com/openapi.json",
  "username": "optional-basic-auth-username",
  "password": "optional-basic-auth-password"
}
```

Output:
- `structuredContent`: the parsed integration JSON object
- `content[0].text`: the same JSON stringified (pretty-printed)

## Example MCP client config

Example `mcpServers` entry (adjust the command/path for your client):

```json
{
  "mcpServers": {
    "swagger-mcp": {
      "command": "node",
      "args": ["<ABS_PATH_TO_THIS_REPO>/dist/index.js"],
      "env": { "SWAGGER_MCP_DEBUG": "1" }
    }
  }
}
```
