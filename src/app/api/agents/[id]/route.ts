import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, run } from '@/lib/db';
import type { Agent, UpdateAgentRequest } from '@/lib/types';

// GET /api/agents/[id] - Get a single agent
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const agent = await queryOne<Agent>('SELECT * FROM agents WHERE id = $1', [id]);

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json(agent);
  } catch (error) {
    console.error('Failed to fetch agent:', error);
    return NextResponse.json({ error: 'Failed to fetch agent' }, { status: 500 });
  }
}

// PATCH /api/agents/[id] - Update an agent
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: UpdateAgentRequest = await request.json();

    const existing = await queryOne<Agent>('SELECT * FROM agents WHERE id = $1', [id]);
    if (!existing) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (body.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(body.name);
    }
    if (body.role !== undefined) {
      updates.push(`role = $${paramIndex++}`);
      values.push(body.role);
    }
    if (body.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(body.description);
    }
    if (body.avatar_emoji !== undefined) {
      updates.push(`avatar_emoji = $${paramIndex++}`);
      values.push(body.avatar_emoji);
    }
    if (body.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(body.status);

      // Log status change event
      const now = new Date().toISOString();
      await run(
        `INSERT INTO events (id, type, agent_id, message, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv4(), 'agent_status_changed', id, `${existing.name} is now ${body.status}`, now]
      );
    }
    if (body.is_master !== undefined) {
      updates.push(`is_master = $${paramIndex++}`);
      values.push(body.is_master ? true : false);
    }
    if (body.soul_md !== undefined) {
      updates.push(`soul_md = $${paramIndex++}`);
      values.push(body.soul_md);
    }
    if (body.user_md !== undefined) {
      updates.push(`user_md = $${paramIndex++}`);
      values.push(body.user_md);
    }
    if (body.agents_md !== undefined) {
      updates.push(`agents_md = $${paramIndex++}`);
      values.push(body.agents_md);
    }
    if (body.model !== undefined) {
      updates.push(`model = $${paramIndex++}`);
      values.push(body.model);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    const now = new Date().toISOString();
    updates.push(`updated_at = $${paramIndex++}`);
    values.push(now);
    values.push(id);

    await run(`UPDATE agents SET ${updates.join(', ')} WHERE id = $${paramIndex}`, values);

    const agent = await queryOne<Agent>('SELECT * FROM agents WHERE id = $1', [id]);
    return NextResponse.json(agent);
  } catch (error) {
    console.error('Failed to update agent:', error);
    return NextResponse.json({ error: 'Failed to update agent' }, { status: 500 });
  }
}

// DELETE /api/agents/[id] - Delete an agent
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await queryOne<Agent>('SELECT * FROM agents WHERE id = $1', [id]);

    if (!existing) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Delete or nullify related records first (foreign key constraints)
    await run('DELETE FROM openclaw_sessions WHERE agent_id = $1', [id]);
    await run('DELETE FROM events WHERE agent_id = $1', [id]);
    await run('DELETE FROM messages WHERE sender_agent_id = $1', [id]);
    await run('DELETE FROM conversation_participants WHERE agent_id = $1', [id]);
    await run('UPDATE tasks SET assigned_agent_id = NULL WHERE assigned_agent_id = $1', [id]);
    await run('UPDATE tasks SET created_by_agent_id = NULL WHERE created_by_agent_id = $1', [id]);
    await run('UPDATE task_activities SET agent_id = NULL WHERE agent_id = $1', [id]);

    // Now delete the agent
    await run('DELETE FROM agents WHERE id = $1', [id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete agent:', error);
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 });
  }
}
