export async function fetchSwaggerJson(params: {
  jsonUrl: string;
  username?: string;
  password?: string;
  timeoutMs?: number;
}): Promise<{ status: number; contentType: string | null; json: unknown }> {
  const timeoutMs = params.timeoutMs ?? 30_000;

  const parsedUrl = (() => {
    try {
      return new URL(params.jsonUrl);
    } catch {
      throw new Error(`Invalid URL: ${params.jsonUrl}`);
    }
  })();

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`Unsupported protocol "${parsedUrl.protocol}". Only http and https are allowed.`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      accept: "application/json, */*",
      "user-agent": "swagger-mcp/1.0.0 (+https://modelcontextprotocol.io)",
    };

    const username = params.username ?? "";
    const password = params.password ?? "";
    if ((params.username && params.username.length > 0) || (params.password && params.password.length > 0)) {
      const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
      headers.authorization = `Basic ${token}`;
    }

    const res = await fetch(params.jsonUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    const contentType = res.headers.get("content-type");
    const text = await res.text();

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      const snippet = text.slice(0, 4000);
      throw new Error(
        `Failed to parse response as JSON (status ${res.status}, content-type ${contentType ?? "unknown"}). Body starts with:\n${snippet}`,
      );
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} while fetching Swagger/OpenAPI JSON.`);
    }

    return { status: res.status, contentType, json };
  } finally {
    clearTimeout(timeout);
  }
}

