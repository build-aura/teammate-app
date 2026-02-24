/**
 * OpenClaw Agent Sync Service
 *
 * Syncs agents between the Teammate.so database (management plane) and
 * OpenClaw Gateway (execution plane) via WebSocket RPC.
 *
 * No CLI, no shared filesystem — pure network communication.
 */

import { getOpenClawClient } from './client';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

export interface SyncAgentConfig {
  slug: string;
  name: string;
  model?: string;
  systemPrompt?: string;
  framework?: string;
  description?: string;
}

export interface SyncResult {
  success: boolean;
  gatewayAgentId?: string;
  error?: string;
}

/**
 * Ensure the OpenClaw client is connected, connecting if needed.
 * Returns the connected client or throws.
 */
async function ensureConnected() {
  const client = getOpenClawClient();
  if (!client.isConnected()) {
    await client.connect();
  }
  return client;
}

/**
 * Creates an OpenClaw routed agent via WebSocket RPC + seeds workspace files.
 *
 * This is called after inserting the agent into Postgres.
 * If it fails, the caller should handle rollback or set deploy_status = 'error'.
 */
export async function createOpenClawAgent(config: SyncAgentConfig): Promise<SyncResult> {
  if (!SLUG_PATTERN.test(config.slug)) {
    return { success: false, error: `Invalid slug: must be 3-50 chars, lowercase alphanumeric and hyphens` };
  }

  try {
    const client = await ensureConnected();

    // 1. Create routed agent via RPC
    const result = await client.call<{ id?: string }>('agents.add', {
      slug: config.slug,
      model: config.model || 'anthropic/claude-sonnet-4-20250514',
    });

    const gatewayAgentId = result?.id || config.slug;

    // 2. Write workspace files via RPC
    const soulMd = [
      `# ${config.name}`,
      '',
      config.systemPrompt || 'You are a helpful assistant.',
      '',
    ].join('\n');

    const agentsMd = [
      `# ${config.name} — Operating Instructions`,
      '',
      `Framework: ${config.framework || 'plain'}`,
      `Managed by: Teammate.so`,
      '',
      config.description || '',
      '',
    ].join('\n');

    const memoryMd = `# ${config.name} — Memory\n\nNo memories yet.\n`;

    // Write files in parallel — each is independent
    await Promise.allSettled([
      client.call('agents.files.set', { agent: config.slug, path: 'SOUL.md', content: soulMd }),
      client.call('agents.files.set', { agent: config.slug, path: 'AGENTS.md', content: agentsMd }),
      client.call('agents.files.set', { agent: config.slug, path: 'MEMORY.md', content: memoryMd }),
    ]);

    return { success: true, gatewayAgentId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sync error';
    console.error('[OpenClaw Sync] Failed to create agent:', message);
    return { success: false, error: message };
  }
}

/**
 * Updates an existing agent's workspace files via RPC.
 */
export async function updateOpenClawAgent(config: SyncAgentConfig): Promise<SyncResult> {
  if (!SLUG_PATTERN.test(config.slug)) {
    return { success: false, error: 'Invalid slug format' };
  }

  try {
    const client = await ensureConnected();

    const soulMd = [
      `# ${config.name}`,
      '',
      config.systemPrompt || 'You are a helpful assistant.',
      '',
    ].join('\n');

    await client.call('agents.files.set', {
      agent: config.slug,
      path: 'SOUL.md',
      content: soulMd,
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sync error';
    console.error('[OpenClaw Sync] Failed to update agent:', message);
    return { success: false, error: message };
  }
}

/**
 * Removes an OpenClaw routed agent via RPC.
 */
export async function removeOpenClawAgent(slug: string): Promise<SyncResult> {
  if (!SLUG_PATTERN.test(slug)) {
    return { success: false, error: 'Invalid slug format' };
  }

  try {
    const client = await ensureConnected();
    await client.call('agents.delete', { slug });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sync error';
    console.error('[OpenClaw Sync] Failed to remove agent:', message);
    return { success: false, error: message };
  }
}
