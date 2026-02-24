import { NextRequest, NextResponse } from 'next/server';
import { queryOne, run } from '@/lib/db';

// GET /api/workspaces/[id] - Get a single workspace
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    // Try to find by ID or slug
    const workspace = await queryOne(
      'SELECT * FROM workspaces WHERE id = $1 OR slug = $2',
      [id, id]
    );
    
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }
    
    return NextResponse.json(workspace);
  } catch (error) {
    console.error('Failed to fetch workspace:', error);
    return NextResponse.json({ error: 'Failed to fetch workspace' }, { status: 500 });
  }
}

// PATCH /api/workspaces/[id] - Update a workspace
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    const body = await request.json();
    const { name, description, icon } = body;
    
    // Check workspace exists
    const existing = await queryOne('SELECT * FROM workspaces WHERE id = $1', [id]);
    if (!existing) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }
    
    // Build update query dynamically
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;
    
    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }
    if (icon !== undefined) {
      updates.push(`icon = $${paramIndex++}`);
      values.push(icon);
    }
    
    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }
    
    updates.push(`updated_at = NOW()`);
    values.push(id);
    
    await run(
      `UPDATE workspaces SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
    
    const workspace = await queryOne('SELECT * FROM workspaces WHERE id = $1', [id]);
    return NextResponse.json(workspace);
  } catch (error) {
    console.error('Failed to update workspace:', error);
    return NextResponse.json({ error: 'Failed to update workspace' }, { status: 500 });
  }
}

// DELETE /api/workspaces/[id] - Delete a workspace
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    // Don't allow deleting the default workspace
    if (id === 'default') {
      return NextResponse.json({ error: 'Cannot delete the default workspace' }, { status: 400 });
    }
    
    // Check workspace exists
    const existing = await queryOne('SELECT * FROM workspaces WHERE id = $1', [id]);
    if (!existing) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }
    
    // Check if workspace has tasks or agents
    const taskCount = await queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM tasks WHERE workspace_id = $1',
      [id]
    );
    
    const agentCount = await queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM agents WHERE workspace_id = $1',
      [id]
    );
    
    if ((taskCount?.count ?? 0) > 0 || (agentCount?.count ?? 0) > 0) {
      return NextResponse.json({ 
        error: 'Cannot delete workspace with existing tasks or agents',
        taskCount: taskCount?.count ?? 0,
        agentCount: agentCount?.count ?? 0
      }, { status: 400 });
    }
    
    await run('DELETE FROM workspaces WHERE id = $1', [id]);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete workspace:', error);
    return NextResponse.json({ error: 'Failed to delete workspace' }, { status: 500 });
  }
}
