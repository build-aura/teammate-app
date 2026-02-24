import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import { createOpenClawAgent } from '@/lib/openclaw/sync';
import type { Agent, CreateAgentRequest } from '@/lib/types';

// GET /api/agents - List all agents
export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    
    let agents: Agent[];
    if (workspaceId) {
      agents = await queryAll<Agent>(`
        SELECT * FROM agents WHERE workspace_id = $1 ORDER BY is_master DESC, name ASC
      `, [workspaceId]);
    } else {
      agents = await queryAll<Agent>(`
        SELECT * FROM agents ORDER BY is_master DESC, name ASC
      `);
    }
    return NextResponse.json(agents);
  } catch (error) {
    console.error('Failed to fetch agents:', error);
    return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 });
  }
}

// Generate a URL-safe slug from a name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'agent';
}

// POST /api/agents - Create a new agent
export async function POST(request: NextRequest) {
  try {
    const body: CreateAgentRequest = await request.json();

    if (!body.name || !body.role) {
      return NextResponse.json({ error: 'Name and role are required' }, { status: 400 });
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const slug = body.slug || generateSlug(body.name);
    const framework = body.framework || 'plain';
    const characterClass = body.character_class || 'scout';
    const syncToOpenClaw = body.sync_to_openclaw ?? false;

    // Insert agent with deploy_status based on whether we'll sync
    const deployStatus = syncToOpenClaw ? 'deploying' : 'active';

    await run(
      `INSERT INTO agents (id, name, role, description, avatar_emoji, is_master, workspace_id,
        soul_md, user_md, agents_md, model, slug, framework, character_class, system_prompt,
        deploy_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        id,
        body.name,
        body.role,
        body.description || null,
        body.avatar_emoji || '🤖',
        body.is_master ? true : false,
        (body as { workspace_id?: string }).workspace_id || 'default',
        body.soul_md || null,
        body.user_md || null,
        body.agents_md || null,
        body.model || null,
        slug,
        framework,
        characterClass,
        body.system_prompt || null,
        deployStatus,
        now,
        now,
      ]
    );

    // Sync to OpenClaw if requested
    if (syncToOpenClaw) {
      const syncResult = await createOpenClawAgent({
        slug,
        name: body.name,
        model: body.model,
        systemPrompt: body.system_prompt,
        framework,
        description: body.description,
      });

      if (syncResult.success) {
        await run(
          `UPDATE agents SET deploy_status = 'active', gateway_agent_id = $1, deployed_at = NOW() WHERE id = $2`,
          [syncResult.gatewayAgentId || slug, id]
        );
      } else {
        await run(
          `UPDATE agents SET deploy_status = 'error', last_error = $1 WHERE id = $2`,
          [syncResult.error || 'Unknown sync error', id]
        );
      }
    }

    // Log event
    await run(
      `INSERT INTO events (id, type, agent_id, message, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), 'agent_joined', id, `${body.name} joined the team`, now]
    );

    const agent = await queryOne<Agent>('SELECT * FROM agents WHERE id = $1', [id]);
    return NextResponse.json(agent, { status: 201 });
  } catch (error) {
    console.error('Failed to create agent:', error);
    return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
  }
}
