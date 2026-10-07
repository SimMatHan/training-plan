// MCP-serveren på /mcp (Streamable HTTP, stateless via agents' createMcpHandler).
// OAuthProvider står foran og har allerede afvist kald uden gyldigt token, når vi når hertil.
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import type { z } from 'zod';
import type { Env } from '../env';
import { callTool, TOOLS } from './tools';

type StandardJsonProps = { jsonSchema: { input: (o: unknown) => Record<string, unknown>; output: (o: unknown) => Record<string, unknown> } };

/**
 * Viser zod-skemaet som JSON Schema i tools/list, men lader SDK'et sende input uændret videre.
 * Valideringen sker i callTool, så også ugyldige kald kommer i revisionsloggen og får danske fejl.
 */
function advertised(schema: z.ZodObject) {
  const std = schema['~standard'] as unknown as StandardJsonProps;
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'traeningsnav',
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: (o: unknown) => std.jsonSchema.input(o), output: (o: unknown) => std.jsonSchema.output(o) },
    },
  };
}

export function buildMcpServer(db: D1Database): McpServer {
  const server = new McpServer(
    { name: 'traeningsnav', title: 'Træningsnav', version: '1.0.0' },
    {
      instructions:
        'Træningsnav er Simons træningsapp: 14 ugers plan med styrke, løb og rehab for venstre lyske og højre ankel. ' +
        'Start med hent_status. Datoer er YYYY-MM-DD i dansk tid. Ændringer til planen foreslås med foreslaa_planaendring og ' +
        'godkendes af Simon i appen. log_lob og skriv_note bruges kun, når Simon beder om det.',
    },
  );
  for (const t of TOOLS) {
    server.registerTool(
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: advertised(t.input) as never,
        annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: false, idempotentHint: t.readOnly, openWorldHint: false },
      },
      (async (args: unknown) => {
        const r = await callTool(db, t.name, args);
        return { content: [{ type: 'text' as const, text: r.text }], ...(r.ok ? {} : { isError: true }) };
      }) as never,
    );
  }
  return server;
}

/** Fetch-handler til OAuthProvider's apiHandler. Ny server pr. kald (stateless). */
export const mcpApiHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Browser-Origins: claude.ai og vores eget domæne (plus localhost til MCP Inspector).
    // Kald uden Origin (claude.ai's servere) er altid gyldige; tokenet er den egentlige adgangskontrol.
    const allowedOriginHostnames = ['claude.ai', 'claude.com', 'localhost', '127.0.0.1', new URL(request.url).hostname];
    return createMcpHandler(() => buildMcpServer(env.DB), { route: '/mcp', allowedOriginHostnames, corsOptions: false })(request, env, ctx);
  },
};
