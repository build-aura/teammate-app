/**
 * Database Migrations System (Postgres)
 *
 * Handles schema changes in a production-safe way:
 * 1. Tracks which migrations have been applied
 * 2. Runs new migrations automatically on startup
 * 3. Never runs the same migration twice
 */

import { Pool } from 'pg';

interface Migration {
  id: string;
  name: string;
  up: (pool: Pool) => Promise<void>;
}

// Helper: check if a column exists on a table (replaces SQLite PRAGMA table_info)
async function columnExists(pool: Pool, table: string, column: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return result.rows.length > 0;
}

// All migrations in order - NEVER remove or reorder existing migrations
const migrations: Migration[] = [
  {
    id: '001',
    name: 'initial_schema',
    up: async () => {
      // Core tables are created in schema.ts on fresh databases
      // This migration exists to mark the baseline for existing databases
      console.log('[Migration 001] Baseline schema marker');
    }
  },
  {
    id: '002',
    name: 'add_workspaces',
    up: async (pool) => {
      console.log('[Migration 002] Adding workspaces table and columns...');

      await pool.query(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          description TEXT,
          icon TEXT DEFAULT '📁',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);

      // Insert default workspace if not exists
      await pool.query(`
        INSERT INTO workspaces (id, name, slug, description, icon)
        VALUES ('default', 'Default Workspace', 'default', 'Default workspace', '🏠')
        ON CONFLICT DO NOTHING
      `);

      // Add workspace_id to tasks if not exists
      if (!(await columnExists(pool, 'tasks', 'workspace_id'))) {
        await pool.query(`ALTER TABLE tasks ADD COLUMN workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id)`);
        console.log('[Migration 002] Added workspace_id to tasks');
      }

      // Add workspace_id to agents if not exists
      if (!(await columnExists(pool, 'agents', 'workspace_id'))) {
        await pool.query(`ALTER TABLE agents ADD COLUMN workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id)`);
        console.log('[Migration 002] Added workspace_id to agents');
      }
    }
  },
  {
    id: '003',
    name: 'add_planning_tables',
    up: async (pool) => {
      console.log('[Migration 003] Adding planning tables...');

      await pool.query(`
        CREATE TABLE IF NOT EXISTS planning_questions (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          question TEXT NOT NULL,
          question_type TEXT DEFAULT 'multiple_choice' CHECK (question_type IN ('multiple_choice', 'text', 'yes_no')),
          options TEXT,
          answer TEXT,
          answered_at TEXT,
          sort_order INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS planning_specs (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
          spec_markdown TEXT NOT NULL,
          locked_at TIMESTAMP NOT NULL,
          locked_by TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await pool.query(`CREATE INDEX IF NOT EXISTS idx_planning_questions_task ON planning_questions(task_id, sort_order)`);
    }
  },
  {
    id: '004',
    name: 'add_planning_session_columns',
    up: async (pool) => {
      console.log('[Migration 004] Adding planning session columns to tasks...');

      if (!(await columnExists(pool, 'tasks', 'planning_session_key'))) {
        await pool.query(`ALTER TABLE tasks ADD COLUMN planning_session_key TEXT`);
        console.log('[Migration 004] Added planning_session_key');
      }
      if (!(await columnExists(pool, 'tasks', 'planning_messages'))) {
        await pool.query(`ALTER TABLE tasks ADD COLUMN planning_messages TEXT`);
        console.log('[Migration 004] Added planning_messages');
      }
      if (!(await columnExists(pool, 'tasks', 'planning_complete'))) {
        await pool.query(`ALTER TABLE tasks ADD COLUMN planning_complete BOOLEAN DEFAULT false`);
        console.log('[Migration 004] Added planning_complete');
      }
      if (!(await columnExists(pool, 'tasks', 'planning_spec'))) {
        await pool.query(`ALTER TABLE tasks ADD COLUMN planning_spec TEXT`);
        console.log('[Migration 004] Added planning_spec');
      }
      if (!(await columnExists(pool, 'tasks', 'planning_agents'))) {
        await pool.query(`ALTER TABLE tasks ADD COLUMN planning_agents TEXT`);
        console.log('[Migration 004] Added planning_agents');
      }
    }
  },
  {
    id: '005',
    name: 'add_agent_model_field',
    up: async (pool) => {
      console.log('[Migration 005] Adding model field to agents...');

      if (!(await columnExists(pool, 'agents', 'model'))) {
        await pool.query(`ALTER TABLE agents ADD COLUMN model TEXT`);
        console.log('[Migration 005] Added model to agents');
      }
    }
  },
  {
    id: '006',
    name: 'add_planning_dispatch_error_column',
    up: async (pool) => {
      console.log('[Migration 006] Adding planning_dispatch_error column to tasks...');

      if (!(await columnExists(pool, 'tasks', 'planning_dispatch_error'))) {
        await pool.query(`ALTER TABLE tasks ADD COLUMN planning_dispatch_error TEXT`);
        console.log('[Migration 006] Added planning_dispatch_error to tasks');
      }
    }
  },
  {
    id: '007',
    name: 'add_agent_source_and_gateway_id',
    up: async (pool) => {
      console.log('[Migration 007] Adding source and gateway_agent_id to agents...');

      if (!(await columnExists(pool, 'agents', 'source'))) {
        await pool.query(`ALTER TABLE agents ADD COLUMN source TEXT DEFAULT 'local'`);
        console.log('[Migration 007] Added source to agents');
      }
      if (!(await columnExists(pool, 'agents', 'gateway_agent_id'))) {
        await pool.query(`ALTER TABLE agents ADD COLUMN gateway_agent_id TEXT`);
        console.log('[Migration 007] Added gateway_agent_id to agents');
      }
    }
  },
  {
    id: '100',
    name: 'teammate_extensions',
    up: async (pool) => {
      console.log('[Migration 100] Adding Teammate.so extensions...');

      // --- Extend agents table with Teammate.so fields ---

      // Agent slug for URL-friendly names (e.g., /v1/agents/my-cs-bot/message)
      if (!(await columnExists(pool, 'agents', 'slug'))) {
        await pool.query(`ALTER TABLE agents ADD COLUMN slug TEXT UNIQUE`);
        console.log('[Migration 100] Added slug to agents');
      }

      // Framework: plain (Scout), crewai (Commander), letta (Sage), langgraph (Architect)
      if (!(await columnExists(pool, 'agents', 'framework'))) {
        await pool.query(`ALTER TABLE agents ADD COLUMN framework TEXT DEFAULT 'plain'`);
        console.log('[Migration 100] Added framework to agents');
      }

      // Character class for game UI: scout, commander, sage, architect, wildcard
      if (!(await columnExists(pool, 'agents', 'character_class'))) {
        await pool.query(`ALTER TABLE agents ADD COLUMN character_class TEXT DEFAULT 'scout'`);
        console.log('[Migration 100] Added character_class to agents');
      }

      // System prompt (separate from soul_md which is OpenClaw-specific)
      if (!(await columnExists(pool, 'agents', 'system_prompt'))) {
        await pool.query(`ALTER TABLE agents ADD COLUMN system_prompt TEXT`);
        console.log('[Migration 100] Added system_prompt to agents');
      }

      // Messaging style: natural (delays, typing indicators), instant, custom
      if (!(await columnExists(pool, 'agents', 'messaging_style'))) {
        await pool.query(`ALTER TABLE agents ADD COLUMN messaging_style TEXT DEFAULT 'natural'`);
        console.log('[Migration 100] Added messaging_style to agents');
      }

      // Per-agent messaging config (JSONB — Postgres validates JSON + enables querying)
      if (!(await columnExists(pool, 'agents', 'messaging_config'))) {
        await pool.query(`ALTER TABLE agents ADD COLUMN messaging_config JSONB`);
        console.log('[Migration 100] Added messaging_config to agents');
      }

      // Which template was used to create this agent
      if (!(await columnExists(pool, 'agents', 'template_id'))) {
        await pool.query(`ALTER TABLE agents ADD COLUMN template_id TEXT`);
        console.log('[Migration 100] Added template_id to agents');
      }

      // Deployment status (separate from operational status which uses 'status' column)
      // 'active' = deployed and running, 'deploying' = in progress, 'error' = deploy failed, 'inactive' = stopped
      if (!(await columnExists(pool, 'agents', 'deploy_status'))) {
        await pool.query(`ALTER TABLE agents ADD COLUMN deploy_status TEXT DEFAULT 'active' CHECK (deploy_status IN ('active', 'inactive', 'error', 'deploying'))`);
        console.log('[Migration 100] Added deploy_status to agents');
      }

      // Last error message (for deploy_status = 'error')
      if (!(await columnExists(pool, 'agents', 'last_error'))) {
        await pool.query(`ALTER TABLE agents ADD COLUMN last_error TEXT`);
        console.log('[Migration 100] Added last_error to agents');
      }

      // When the agent was deployed to OpenClaw
      if (!(await columnExists(pool, 'agents', 'deployed_at'))) {
        await pool.query(`ALTER TABLE agents ADD COLUMN deployed_at TIMESTAMP`);
        console.log('[Migration 100] Added deployed_at to agents');
      }

      // --- New tables ---

      // API keys — keys stored as SHA-256 hash, never plaintext
      await pool.query(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          key_hash TEXT NOT NULL UNIQUE,
          key_prefix TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT 'default',
          active BOOLEAN NOT NULL DEFAULT true,
          rate_limit_rpm INTEGER DEFAULT 60,
          last_used_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_agent ON api_keys(agent_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)`);

      // Message log (for agent stats, billing, battle log in game UI)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS message_log (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
          content TEXT,
          channel TEXT,
          session_id TEXT,
          latency_ms INTEGER,
          error TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_message_log_agent_created ON message_log(agent_id, created_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_message_log_agent_direction ON message_log(agent_id, direction)`);

      // Agent templates registry (one-click deploy configs)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS agent_templates (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          framework TEXT NOT NULL,
          character_class TEXT NOT NULL,
          version TEXT NOT NULL DEFAULT '1.0.0',
          config JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_agent_templates_framework ON agent_templates(framework)`);

      console.log('[Migration 100] Teammate.so extensions complete');
    }
  }
];

/**
 * Run all pending migrations
 */
export async function runMigrations(pool: Pool): Promise<void> {
  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Get already applied migrations
  const { rows } = await pool.query('SELECT id FROM _migrations');
  const applied = new Set(rows.map((m: { id: string }) => m.id));

  // Run pending migrations in order
  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }

    console.log(`[DB] Running migration ${migration.id}: ${migration.name}`);

    // Run migration in a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await migration.up(pool);
      await client.query('INSERT INTO _migrations (id, name) VALUES ($1, $2)', [migration.id, migration.name]);
      await client.query('COMMIT');
      console.log(`[DB] Migration ${migration.id} completed`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`[DB] Migration ${migration.id} failed:`, error);
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * Get migration status
 */
export async function getMigrationStatus(pool: Pool): Promise<{ applied: string[]; pending: string[] }> {
  const { rows } = await pool.query('SELECT id FROM _migrations ORDER BY id');
  const applied = rows.map((m: { id: string }) => m.id);
  const pending = migrations.filter(m => !applied.includes(m.id)).map(m => m.id);
  return { applied, pending };
}
