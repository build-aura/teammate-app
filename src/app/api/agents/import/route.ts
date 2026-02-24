import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, run, transaction } from '@/lib/db';
import type { Agent } from '@/lib/types';

interface ImportAgentRequest {
  gateway_agent_id: string;
  name: string;
  model?: string;
  workspace_id?: string;
}

interface ImportRequest {
  agents: ImportAgentRequest[];
}

// POST /api/agents/import - Import one or more agents from the OpenClaw Gateway
export async function POST(request: NextRequest) {
  try {
    const body: ImportRequest = await request.json();

    if (!body.agents || !Array.isArray(body.agents) || body.agents.length === 0) {
      return NextResponse.json(
        { error: 'At least one agent is required in the agents array' },
        { status: 400 }
      );
    }

    // Validate each agent
    for (const agentReq of body.agents) {
      if (!agentReq.gateway_agent_id || !agentReq.name) {
        return NextResponse.json(
          { error: 'Each agent must have gateway_agent_id and name' },
          { status: 400 }
        );
      }
    }

    // Check for conflicts (already imported)
    const existingImports = await queryAll<Agent>(
      `SELECT * FROM agents WHERE gateway_agent_id IS NOT NULL`
    );
    const importedGatewayIds = new Set(existingImports.map((a) => a.gateway_agent_id));

    const results: { imported: Agent[]; skipped: { gateway_agent_id: string; reason: string }[] } = {
      imported: [],
      skipped: [],
    };

    await transaction(async (query) => {
      const now = new Date().toISOString();

      for (const agentReq of body.agents) {
        // Skip if already imported
        if (importedGatewayIds.has(agentReq.gateway_agent_id)) {
          results.skipped.push({
            gateway_agent_id: agentReq.gateway_agent_id,
            reason: 'Already imported',
          });
          continue;
        }

        const id = uuidv4();
        const workspaceId = agentReq.workspace_id || 'default';

        await query(
          `INSERT INTO agents (id, name, role, description, avatar_emoji, is_master, workspace_id, model, source, gateway_agent_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            id,
            agentReq.name,
            'Imported Agent',
            `Imported from OpenClaw Gateway (${agentReq.gateway_agent_id})`,
            '🔗',
            false,
            workspaceId,
            agentReq.model || null,
            'gateway',
            agentReq.gateway_agent_id,
            now,
            now,
          ]
        );

        // Log event
        await query(
          `INSERT INTO events (id, type, agent_id, message, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [uuidv4(), 'agent_joined', id, `${agentReq.name} imported from OpenClaw Gateway`, now]
        );

        const agentRows = await query(
          'SELECT * FROM agents WHERE id = $1',
          [id]
        );
        if (agentRows.rows && agentRows.rows.length > 0) {
          results.imported.push(agentRows.rows[0] as Agent);
        }
      }
    });

    return NextResponse.json(results, { status: 201 });
  } catch (error) {
    console.error('Failed to import agents:', error);
    return NextResponse.json(
      { error: 'Failed to import agents' },
      { status: 500 }
    );
  }
}
