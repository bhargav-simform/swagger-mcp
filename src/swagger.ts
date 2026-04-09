import { asStringArray, getArray, getBoolean, getRecord, getString, isRecord } from "./json.js";
import { resolveRef } from "./openapiPointers.js";

export type HttpMethod =
  | "get"
  | "post"
  | "put"
  | "patch"
  | "delete"
  | "head"
  | "options"
  | "trace";

const HTTP_METHODS: readonly HttpMethod[] = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
] as const;

type SwaggerFlavor = "openapi3" | "swagger2";

export type IntegrationJson = {
  source: {
    jsonUrl: string;
    fetchedAt: string;
    http: {
      status: number;
      contentType: string | null;
    };
    auth: { type: "basic"; usernameProvided: boolean; passwordProvided: boolean } | { type: "none" };
  };
  spec: {
    flavor: SwaggerFlavor;
    openapi: string;
    title?: string;
    version?: string;
    description?: string;
    servers: Array<{ url: string; description?: string }>;
    tags: Array<{ name: string; description?: string }>;
  };
  auth: {
    schemes: Array<{
      name: string;
      type?: string;
      description?: string;
      in?: string;
      scheme?: string;
      bearerFormat?: string;
      flow?: string;
      authorizationUrl?: string;
      tokenUrl?: string;
      scopes?: Record<string, string>;
    }>;
    globalSecurity: Array<Record<string, string[]>>;
  };
  endpoints: Array<{
    path: string;
    method: Uppercase<HttpMethod>;
    operationId?: string;
    summary?: string;
    description?: string;
    tags: string[];
    deprecated?: boolean;
    security: Array<Record<string, string[]>> | null;
    parameters: Array<{
      name: string;
      in: string;
      required: boolean;
      description?: string;
      schema?: SchemaSummary;
    }>;
    requestBody: null | {
      required: boolean;
      content: Array<{
        mediaType: string;
        schema?: SchemaSummary;
      }>;
    };
    responses: Array<{
      status: string;
      description?: string;
      content: Array<{
        mediaType: string;
        schema?: SchemaSummary;
      }>;
    }>;
  }>;
  components: {
    schemas: Record<string, SchemaSummary>;
  };
};

export type SchemaSummary =
  | { kind: "ref"; ref: string }
  | {
      kind: "schema";
      type?: string;
      format?: string;
      description?: string;
      enum?: unknown[];
      nullable?: boolean;
      required?: string[];
      properties?: Record<string, SchemaSummary>;
      items?: SchemaSummary;
      oneOf?: SchemaSummary[];
      anyOf?: SchemaSummary[];
      allOf?: SchemaSummary[];
      additionalProperties?: boolean | SchemaSummary;
      example?: unknown;
      default?: unknown;
    };

const EMPTY_SCHEMA: SchemaSummary = { kind: "schema" };

function simplifySchema(spec: unknown, input: unknown, depth: number): SchemaSummary | undefined {
  if (depth <= 0) return undefined;
  if (!isRecord(input)) return undefined;

  const ref = getString(input, "$ref");
  if (ref) return { kind: "ref", ref };

  const resolved = (() => {
    const internalRef = getString(input, "$ref");
    if (!internalRef) return input;
    return resolveRef(spec, internalRef);
  })();

  if (!isRecord(resolved)) return undefined;

  const type = getString(resolved, "type");
  const format = getString(resolved, "format");
  const description = getString(resolved, "description");
  const nullable = getBoolean(resolved, "nullable");
  const example = resolved["example"];
  const def = resolved["default"];
  const enumValue = Array.isArray(resolved["enum"]) ? (resolved["enum"] as unknown[]) : undefined;
  const required = asStringArray(resolved["required"]);

  const propertiesRecord = getRecord(resolved, "properties");
  const properties =
    propertiesRecord
      ? (Object.fromEntries(
          Object.entries(propertiesRecord).map(([key, value]) => [
            key,
            simplifySchema(spec, value, depth - 1) ?? EMPTY_SCHEMA,
          ]),
        ) as Record<string, SchemaSummary>)
      : undefined;

  const items = simplifySchema(spec, resolved["items"], depth - 1);

  const oneOfRaw = getArray(resolved, "oneOf");
  const anyOfRaw = getArray(resolved, "anyOf");
  const allOfRaw = getArray(resolved, "allOf");
  const oneOf = oneOfRaw ? oneOfRaw.map((v) => simplifySchema(spec, v, depth - 1) ?? EMPTY_SCHEMA) : undefined;
  const anyOf = anyOfRaw ? anyOfRaw.map((v) => simplifySchema(spec, v, depth - 1) ?? EMPTY_SCHEMA) : undefined;
  const allOf = allOfRaw ? allOfRaw.map((v) => simplifySchema(spec, v, depth - 1) ?? EMPTY_SCHEMA) : undefined;

  const additionalPropertiesValue = resolved["additionalProperties"];
  let additionalProperties: boolean | SchemaSummary | undefined;
  if (typeof additionalPropertiesValue === "boolean") additionalProperties = additionalPropertiesValue;
  else if (additionalPropertiesValue !== undefined)
    additionalProperties = simplifySchema(spec, additionalPropertiesValue, depth - 1);

  const out: {
    kind: "schema";
    type?: string;
    format?: string;
    description?: string;
    enum?: unknown[];
    nullable?: boolean;
    required?: string[];
    properties?: Record<string, SchemaSummary>;
    items?: SchemaSummary;
    oneOf?: SchemaSummary[];
    anyOf?: SchemaSummary[];
    allOf?: SchemaSummary[];
    additionalProperties?: boolean | SchemaSummary;
    example?: unknown;
    default?: unknown;
  } = { kind: "schema" };

  if (type !== undefined) out.type = type;
  if (format !== undefined) out.format = format;
  if (description !== undefined) out.description = description;
  if (enumValue !== undefined) out.enum = enumValue;
  if (nullable !== undefined) out.nullable = nullable;
  if (required !== undefined) out.required = required;
  if (properties !== undefined) out.properties = properties;
  if (items !== undefined) out.items = items;
  if (oneOf !== undefined) out.oneOf = oneOf;
  if (anyOf !== undefined) out.anyOf = anyOf;
  if (allOf !== undefined) out.allOf = allOf;
  if (additionalProperties !== undefined) out.additionalProperties = additionalProperties;
  if (example !== undefined) out.example = example;
  if (def !== undefined) out.default = def;

  return out;
}

function extractOpenApiServers(spec: Record<string, unknown>): Array<{ url: string; description?: string }> {
  const servers = getArray(spec, "servers") ?? [];
  const out: Array<{ url: string; description?: string }> = [];
  for (const s of servers) {
    if (!isRecord(s)) continue;
    const url = getString(s, "url");
    if (!url) continue;
    const description = getString(s, "description");
    out.push(description !== undefined ? { url, description } : { url });
  }
  return out;
}

function extractSwagger2Servers(spec: Record<string, unknown>): Array<{ url: string; description?: string }> {
  const host = getString(spec, "host");
  const basePath = getString(spec, "basePath") ?? "";
  const schemes = asStringArray(spec["schemes"]) ?? ["https"];
  if (!host) return [];
  return schemes.map((scheme) => ({ url: `${scheme}://${host}${basePath}` }));
}

function extractTags(spec: Record<string, unknown>): Array<{ name: string; description?: string }> {
  const tags = getArray(spec, "tags") ?? [];
  const out: Array<{ name: string; description?: string }> = [];
  for (const t of tags) {
    if (!isRecord(t)) continue;
    const name = getString(t, "name");
    if (!name) continue;
    const description = getString(t, "description");
    out.push(description !== undefined ? { name, description } : { name });
  }
  return out;
}

function extractOpenApiSecuritySchemes(spec: Record<string, unknown>): Array<IntegrationJson["auth"]["schemes"][number]> {
  const components = getRecord(spec, "components");
  const securitySchemes = components ? getRecord(components, "securitySchemes") : undefined;
  if (!securitySchemes) return [];

  const out: Array<IntegrationJson["auth"]["schemes"][number]> = [];
  for (const [name, value] of Object.entries(securitySchemes)) {
    if (!isRecord(value)) continue;
    const scheme: IntegrationJson["auth"]["schemes"][number] = { name };
    const type = getString(value, "type");
    const description = getString(value, "description");
    const inValue = getString(value, "in");
    const schemeValue = getString(value, "scheme");
    const bearerFormat = getString(value, "bearerFormat");
    const flow = getString(value, "flow");
    const authorizationUrl = getString(value, "authorizationUrl");
    const tokenUrl = getString(value, "tokenUrl");
    const scopes = isRecord(value["scopes"]) ? (value["scopes"] as Record<string, string>) : undefined;

    if (type !== undefined) scheme.type = type;
    if (description !== undefined) scheme.description = description;
    if (inValue !== undefined) scheme.in = inValue;
    if (schemeValue !== undefined) scheme.scheme = schemeValue;
    if (bearerFormat !== undefined) scheme.bearerFormat = bearerFormat;
    if (flow !== undefined) scheme.flow = flow;
    if (authorizationUrl !== undefined) scheme.authorizationUrl = authorizationUrl;
    if (tokenUrl !== undefined) scheme.tokenUrl = tokenUrl;
    if (scopes !== undefined) scheme.scopes = scopes;

    out.push(scheme);
  }
  return out;
}

function extractSwagger2SecuritySchemes(spec: Record<string, unknown>): Array<IntegrationJson["auth"]["schemes"][number]> {
  const definitions = getRecord(spec, "securityDefinitions");
  if (!definitions) return [];

  const out: Array<IntegrationJson["auth"]["schemes"][number]> = [];
  for (const [name, value] of Object.entries(definitions)) {
    if (!isRecord(value)) continue;
    const scheme: IntegrationJson["auth"]["schemes"][number] = { name };
    const type = getString(value, "type");
    const description = getString(value, "description");
    const inValue = getString(value, "in");
    const schemeValue = getString(value, "scheme");
    const bearerFormat = getString(value, "bearerFormat");
    const authorizationUrl = getString(value, "authorizationUrl");
    const tokenUrl = getString(value, "tokenUrl");
    const scopes = isRecord(value["scopes"]) ? (value["scopes"] as Record<string, string>) : undefined;

    if (type !== undefined) scheme.type = type;
    if (description !== undefined) scheme.description = description;
    if (inValue !== undefined) scheme.in = inValue;
    if (schemeValue !== undefined) scheme.scheme = schemeValue;
    if (bearerFormat !== undefined) scheme.bearerFormat = bearerFormat;
    if (authorizationUrl !== undefined) scheme.authorizationUrl = authorizationUrl;
    if (tokenUrl !== undefined) scheme.tokenUrl = tokenUrl;
    if (scopes !== undefined) scheme.scopes = scopes;

    out.push(scheme);
  }
  return out;
}

function extractGlobalSecurity(spec: Record<string, unknown>): Array<Record<string, string[]>> {
  const security = spec["security"];
  if (!Array.isArray(security)) return [];
  const out: Array<Record<string, string[]>> = [];
  for (const entry of security) {
    if (!isRecord(entry)) continue;
    const normalized: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(entry)) {
      const scopes = asStringArray(v) ?? [];
      normalized[k] = scopes;
    }
    out.push(normalized);
  }
  return out;
}

function asParametersArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const v of value) {
    if (isRecord(v)) out.push(v);
  }
  return out;
}

function collectParameters(spec: unknown, pathItem: Record<string, unknown>, operation: Record<string, unknown>, flavor: SwaggerFlavor) {
  const pathParams = asParametersArray(pathItem["parameters"]);
  const opParams = asParametersArray(operation["parameters"]);
  const all = [...pathParams, ...opParams];

  const normalized: IntegrationJson["endpoints"][number]["parameters"] = [];

  for (const p of all) {
    const ref = getString(p, "$ref");
    const param = ref ? resolveRef(spec, ref) : p;
    if (!isRecord(param)) continue;

    const name = getString(param, "name");
    const location = getString(param, "in");
    if (!name || !location) continue;

    if (flavor === "swagger2" && location === "body") continue; // requestBody handled separately
    if (flavor === "swagger2" && location === "formData") {
      // We'll treat as parameters; schema derived from type
    }

    const required = getBoolean(param, "required") ?? false;
    const description = getString(param, "description");

    const schemaSource =
      flavor === "openapi3"
        ? param["schema"]
        : isRecord(param["schema"])
          ? param["schema"]
          : (() => {
              const type = getString(param, "type");
              return type ? { type, format: getString(param, "format"), enum: param["enum"] } : undefined;
            })();

    const schema = simplifySchema(spec, schemaSource, 6);

    const paramOut: IntegrationJson["endpoints"][number]["parameters"][number] = {
      name,
      in: location,
      required,
    };
    if (description !== undefined) paramOut.description = description;
    if (schema !== undefined) paramOut.schema = schema;
    normalized.push(paramOut);
  }

  return normalized;
}

function extractRequestBodyOpenApi3(spec: unknown, operation: Record<string, unknown>) {
  const requestBody = operation["requestBody"];
  if (!requestBody) return null;

  const resolved = (() => {
    if (isRecord(requestBody)) {
      const ref = getString(requestBody, "$ref");
      if (ref) return resolveRef(spec, ref);
    }
    return requestBody;
  })();

  if (!isRecord(resolved)) return null;

  const required = getBoolean(resolved, "required") ?? false;
  const contentRecord = getRecord(resolved, "content");
  const content: Array<{ mediaType: string; schema?: SchemaSummary }> = [];
  if (contentRecord) {
    for (const [mediaType, mediaValue] of Object.entries(contentRecord)) {
      if (!isRecord(mediaValue)) continue;
      const schema = simplifySchema(spec, mediaValue["schema"], 7);
      content.push(schema !== undefined ? { mediaType, schema } : { mediaType });
    }
  }
  return { required, content };
}

function extractRequestBodySwagger2(spec: unknown, operation: Record<string, unknown>) {
  const parameters = asParametersArray(operation["parameters"]);
  const bodyParam = parameters.find((p) => getString(p, "in") === "body");
  if (!bodyParam) return null;

  const resolved = (() => {
    const ref = getString(bodyParam, "$ref");
    if (ref) return resolveRef(spec, ref);
    return bodyParam;
  })();
  if (!isRecord(resolved)) return null;

  const required = getBoolean(resolved, "required") ?? false;
  const schema = simplifySchema(spec, resolved["schema"], 7);

  // Swagger 2 doesn't have content negotiation in requestBody; use consumes if available.
  const consumes = asStringArray(operation["consumes"]) ?? undefined;
  const content = (consumes ?? ["application/json"]).map((mediaType) =>
    schema !== undefined ? { mediaType, schema } : { mediaType },
  );
  return { required, content };
}

function extractResponsesOpenApi3(spec: unknown, operation: Record<string, unknown>) {
  const responsesRecord = getRecord(operation, "responses");
  if (!responsesRecord) return [];
  const out: IntegrationJson["endpoints"][number]["responses"] = [];

  for (const [status, responseValue] of Object.entries(responsesRecord)) {
    const resolved = (() => {
      if (isRecord(responseValue)) {
        const ref = getString(responseValue, "$ref");
        if (ref) return resolveRef(spec, ref);
      }
      return responseValue;
    })();
    if (!isRecord(resolved)) continue;

    const description = getString(resolved, "description");
    const contentRecord = getRecord(resolved, "content");
    const content: Array<{ mediaType: string; schema?: SchemaSummary }> = [];
    if (contentRecord) {
      for (const [mediaType, mediaValue] of Object.entries(contentRecord)) {
        if (!isRecord(mediaValue)) continue;
        const schema = simplifySchema(spec, mediaValue["schema"], 7);
        content.push(schema !== undefined ? { mediaType, schema } : { mediaType });
      }
    }
    out.push(description !== undefined ? { status, description, content } : { status, content });
  }
  return out;
}

function extractResponsesSwagger2(spec: unknown, operation: Record<string, unknown>) {
  const responsesRecord = getRecord(operation, "responses");
  if (!responsesRecord) return [];
  const out: IntegrationJson["endpoints"][number]["responses"] = [];

  const produces = asStringArray(operation["produces"]) ?? ["application/json"];

  for (const [status, responseValue] of Object.entries(responsesRecord)) {
    const resolved = (() => {
      if (isRecord(responseValue)) {
        const ref = getString(responseValue, "$ref");
        if (ref) return resolveRef(spec, ref);
      }
      return responseValue;
    })();
    if (!isRecord(resolved)) continue;

    const description = getString(resolved, "description");
    const schema = simplifySchema(spec, resolved["schema"], 7);
    const content = produces.map((mediaType) => (schema !== undefined ? { mediaType, schema } : { mediaType }));
    out.push(description !== undefined ? { status, description, content } : { status, content });
  }
  return out;
}

function extractComponentsSchemas(spec: Record<string, unknown>, flavor: SwaggerFlavor): Record<string, SchemaSummary> {
  const schemasRoot =
    flavor === "openapi3"
      ? getRecord(getRecord(spec, "components") ?? {}, "schemas")
      : getRecord(spec, "definitions");

  if (!schemasRoot) return {};
  const out: Record<string, SchemaSummary> = {};
  for (const [name, schema] of Object.entries(schemasRoot)) {
    out[name] = simplifySchema(spec, schema, 8) ?? EMPTY_SCHEMA;
  }
  return out;
}

function isOpenApi3(spec: Record<string, unknown>): boolean {
  const v = getString(spec, "openapi");
  return typeof v === "string" && v.length > 0;
}

function isSwagger2(spec: Record<string, unknown>): boolean {
  return getString(spec, "swagger") === "2.0";
}

export function buildIntegrationJson(params: {
  jsonUrl: string;
  fetchedAt: string;
  httpStatus: number;
  contentType: string | null;
  username?: string;
  password?: string;
  spec: unknown;
}): IntegrationJson {
  if (!isRecord(params.spec)) {
    throw new Error("Swagger/OpenAPI JSON must be an object.");
  }

  const spec = params.spec;
  const flavor: SwaggerFlavor = isOpenApi3(spec) ? "openapi3" : isSwagger2(spec) ? "swagger2" : "openapi3";
  const openapiVersion = flavor === "openapi3" ? (getString(spec, "openapi") ?? "3.x") : "2.0";

  const servers = flavor === "openapi3" ? extractOpenApiServers(spec) : extractSwagger2Servers(spec);
  const info = getRecord(spec, "info");
  const title = info ? getString(info, "title") : undefined;
  const version = info ? getString(info, "version") : undefined;
  const description = info ? getString(info, "description") : undefined;

  const paths = getRecord(spec, "paths") ?? {};
  const endpoints: IntegrationJson["endpoints"] = [];

  for (const [path, pathItemValue] of Object.entries(paths)) {
    if (!isRecord(pathItemValue)) continue;
    const pathItem = pathItemValue;

    for (const method of HTTP_METHODS) {
      const operationValue = pathItem[method];
      if (!isRecord(operationValue)) continue;
      const operation = operationValue;

      const tags = asStringArray(operation["tags"]) ?? [];
      const security = (() => {
        const sec = operation["security"];
        if (sec === undefined) return null;
        if (!Array.isArray(sec)) return null;
        const out: Array<Record<string, string[]>> = [];
        for (const entry of sec) {
          if (!isRecord(entry)) continue;
          const normalized: Record<string, string[]> = {};
          for (const [k, v] of Object.entries(entry)) normalized[k] = asStringArray(v) ?? [];
          out.push(normalized);
        }
        return out;
      })();

      const endpoint: IntegrationJson["endpoints"][number] = {
        path,
        method: method.toUpperCase() as Uppercase<HttpMethod>,
        tags,
        security,
        parameters: collectParameters(spec, pathItem, operation, flavor),
        requestBody:
          flavor === "openapi3"
            ? extractRequestBodyOpenApi3(spec, operation)
            : extractRequestBodySwagger2(spec, operation),
        responses: flavor === "openapi3" ? extractResponsesOpenApi3(spec, operation) : extractResponsesSwagger2(spec, operation),
      };

      const operationId = getString(operation, "operationId");
      const summary = getString(operation, "summary");
      const description = getString(operation, "description");
      const deprecated = getBoolean(operation, "deprecated");

      if (operationId !== undefined) endpoint.operationId = operationId;
      if (summary !== undefined) endpoint.summary = summary;
      if (description !== undefined) endpoint.description = description;
      if (deprecated !== undefined) endpoint.deprecated = deprecated;

      endpoints.push(endpoint);
    }
  }

  const authSchemes = flavor === "openapi3" ? extractOpenApiSecuritySchemes(spec) : extractSwagger2SecuritySchemes(spec);

  const usernameProvided = typeof params.username === "string" && params.username.length > 0;
  const passwordProvided = typeof params.password === "string" && params.password.length > 0;

  const out: IntegrationJson = {
    source: {
      jsonUrl: params.jsonUrl,
      fetchedAt: params.fetchedAt,
      http: { status: params.httpStatus, contentType: params.contentType },
      auth: usernameProvided || passwordProvided ? { type: "basic", usernameProvided, passwordProvided } : { type: "none" },
    },
    spec: {
      flavor,
      openapi: openapiVersion,
      servers,
      tags: extractTags(spec),
    },
    auth: {
      schemes: authSchemes,
      globalSecurity: extractGlobalSecurity(spec),
    },
    endpoints,
    components: {
      schemas: extractComponentsSchemas(spec, flavor),
    },
  };

  if (title !== undefined) out.spec.title = title;
  if (version !== undefined) out.spec.version = version;
  if (description !== undefined) out.spec.description = description;

  return out;
}
