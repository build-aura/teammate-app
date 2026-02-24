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
