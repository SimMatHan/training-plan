// MCP-serveren på /mcp/<slug> (Streamable HTTP, stateless via agents' createMcpHandler).
// OAuthResourceServer står foran og har allerede afvist kald uden et gyldigt token til netop
// denne ressource (/mcp/<slug>). Her tjekkes det igen, at tokenets atlet er stiens atlet, og
// adgangen slås op live, så en fjernet trænerrolle virker fra næste kald.
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import type { z } from 'zod';
import type { Env } from '../env';
import { getAthleteBySlug, getRole } from '../services/athletes';
import { callTool, serverInfo, TOOLS, type ToolContext } from './tools';

/** Det OAuth-grant'en bærer (sat på /authorize). */
export interface McpProps {
  userId: number;
  athleteId: number;
  athleteSlug: string;
}

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

export function buildMcpServer(ctx: Omit<ToolContext, 'now'>): McpServer {
  const info = serverInfo(ctx.athlete, ctx.role);
  const server = new McpServer({ name: info.name, title: info.name, version: '2.0.0' }, { instructions: info.instructions });
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
        const r = await callTool({ ...ctx, now: new Date() }, t.name, args);
        return { content: [{ type: 'text' as const, text: r.text }], ...(r.ok ? {} : { isError: true }) };
      }) as never,
    );
  }
  return server;
}

const deny = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** Atletens slug fra /mcp/<slug>[/…]. */
export const slugFromMcpPath = (pathname: string) => pathname.match(/^\/mcp\/([^/]+)/)?.[1] ?? null;

/** Fetch-handler bag OAuthResourceServer. Ny server pr. kald (stateless). */
export const mcpApiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext & { props?: McpProps }): Promise<Response> {
    const props = ctx.props;
    const slug = slugFromMcpPath(new URL(request.url).pathname);
    // Tokenet er udstedt til netop denne atlet. Audience-tjekket har allerede sikret det; tjek alligevel.
    if (!props || !slug || props.athleteSlug !== slug) return deny(403, 'Tokenet gælder ikke denne atlet');
    const athlete = await getAthleteBySlug(env.DB, slug);
    if (!athlete || athlete.id !== props.athleteId) return deny(403, 'Tokenet gælder ikke denne atlet');
    const role = await getRole(env.DB, props.userId, athlete.id);
    if (!role) return deny(403, 'Adgangen til atleten er trukket tilbage');

    // Browser-Origins: claude.ai og vores eget domæne (plus localhost til MCP Inspector).
    // Kald uden Origin (claude.ai's servere) er altid gyldige; tokenet er den egentlige adgangskontrol.
    const allowedOriginHostnames = ['claude.ai', 'claude.com', 'localhost', '127.0.0.1', new URL(request.url).hostname];
    return createMcpHandler(() => buildMcpServer({ db: env.DB, athlete, userId: props.userId, role }), {
      route: `/mcp/${slug}`,
      allowedOriginHostnames,
      corsOptions: false,
    })(request, env, ctx);
  },
};
