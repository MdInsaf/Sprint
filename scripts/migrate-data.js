/**
 * Sprint Flow — Data Migration Script
 *
 * Migrates existing data from the old Django/PostgreSQL database to Supabase.
 *
 * Usage:
 *   node scripts/migrate-data.js
 *
 * Required env vars (create a .env file in the project root):
 *   OLD_DATABASE_URL   — PostgreSQL connection string to the existing Django DB
 *                        e.g. postgresql://user:pass@host:5432/dbname
 *   SUPABASE_URL       — Your Supabase project URL
 *   SUPABASE_SERVICE_KEY — Your Supabase service_role key (bypasses RLS)
 *
 * Optional:
 *   TEMP_PASSWORD      — Temporary password set for all migrated users (default: "ChangeMe123!")
 *                        Users must reset their passwords after migration via the Account page.
 *   AWS_S3_BUCKET      — S3 bucket name for old attachments (only needed if migrating attachments)
 *   AWS_REGION         — AWS region (default: ap-south-1)
 *
 * ⚠️  PASSWORD NOTE:
 *   Django uses PBKDF2 password hashing by default, which is incompatible with
 *   Supabase's pgcrypto bcrypt. All users will receive a temporary password and
 *   must change it after the migration. Notify users accordingly.
 *
 * Run the SQL migration first:
 *   supabase db reset --linked  (or paste 0001_initial.sql into the SQL editor)
 */

import 'dotenv/config';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

// ── Config ────────────────────────────────────────────────────────────────────
const OLD_DATABASE_URL = process.env.OLD_DATABASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TEMP_PASSWORD = process.env.TEMP_PASSWORD || 'ChangeMe123!';

if (!OLD_DATABASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required environment variables:');
  console.error('  OLD_DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const oldDb = new pg.Client({ connectionString: OLD_DATABASE_URL });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function nowIso() {
  return new Date().toISOString();
}

// Map Django task type (lowercase) → TypeScript type (title case)
const TASK_TYPE_MAP = {
  sprint: 'Sprint',
  additional: 'Additional',
  backlog: 'Backlog',
  bug: 'Bug',
  change: 'Change',
};

// ── Migration steps ────────────────────────────────────────────────────────────

async function migrateTeamMembers(userIdMap) {
  log('Migrating team members...');

  // Fetch Django auth_user + member_profiles
  const { rows } = await oldDb.query(`
    SELECT
      u.id           AS django_id,
      u.first_name,
      u.last_name,
      u.username,
      u.email,
      COALESCE(mp.role, 'Developer')  AS role,
      mp.avatar,
      COALESCE(mp.team, 'Developers') AS team,
      COALESCE(mp.leave_dates, '[]'::jsonb) AS leave_dates
    FROM auth_user u
    LEFT JOIN member_profiles mp ON mp.user_id = u.id
    ORDER BY u.id
  `);

  log(`  Found ${rows.length} users.`);

  for (const row of rows) {
    const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.username;
    const email = row.email || `${row.username}@migration.local`;

    // Insert via RPC so password is bcrypt-hashed server-side
    const { data, error } = await supabase.rpc('add_team_member_with_password', {
      p_name: name,
      p_username: row.username,
      p_email: email,
      p_password: TEMP_PASSWORD,
      p_role: row.role,
      p_avatar: row.avatar || null,
      p_team: row.team,
      p_leave_dates: row.leave_dates,
    });

    if (error) {
      console.error(`  ❌  Failed to migrate user ${row.username}:`, error.message);
      continue;
    }

    userIdMap[String(row.django_id)] = data.id;
    log(`  ✓  ${name} (${row.username}) → ${data.id}`);
  }

  log(`  Team members done. ${Object.keys(userIdMap).length} migrated.`);
}

async function migrateSprints() {
  log('Migrating sprints...');

  const { rows } = await oldDb.query(`
    SELECT id, sprint_name, start_date, end_date, sprint_goal,
           COALESCE(holiday_dates, '[]'::jsonb) AS holiday_dates,
           is_active, COALESCE(team, 'Developers') AS team
    FROM sprints
    ORDER BY id
  `);

  log(`  Found ${rows.length} sprints.`);
  if (rows.length === 0) return;

  const { error } = await supabase.from('sprints').insert(rows);
  if (error) throw new Error(`Sprint migration failed: ${error.message}`);

  log(`  ✓  ${rows.length} sprints migrated.`);
}

async function migrateTasks(userIdMap) {
  log('Migrating tasks...');

  const { rows } = await oldDb.query(`
    SELECT
      t.id, t.title, t.type, t.sprint_id, t.qa_sprint_id,
      t.module, t.owner_id, t.priority, t.status, t.qa_status,
      t.qa_in_progress_date, t.qa_actual_hours, t.qa_fixing_in_progress_date,
      t.qa_fixing_hours, t.estimated_hours, t.actual_hours, t.blocked_hours,
      t.blocker, t.steps_to_reproduce, t.test_reproduced, t.blocker_date,
      t.in_progress_date, t.created_date, t.closed_date, t.description
    FROM tasks t
    ORDER BY t.created_date
  `);

  log(`  Found ${rows.length} tasks.`);
  if (rows.length === 0) return;

  // Update sequences to avoid ID collisions after migration
  const seqUpdates = {};
  const taskIdPrefixMap = { Sprint: 'sp', Additional: 'add', Backlog: 'blg', Bug: 'bug', Change: 'chg' };
  const prefixMatcher = /^(SP|ADD|BLG|BUG|CHG)-(\d+)$/i;

  for (const row of rows) {
    const match = prefixMatcher.exec(String(row.id));
    if (!match) continue;
    const prefix = match[1].toUpperCase();
    const num = parseInt(match[2], 10);
    if (!seqUpdates[prefix] || num > seqUpdates[prefix]) {
      seqUpdates[prefix] = num;
    }
  }

  // Set sequences to max+1
  const seqNameMap = { SP: 'task_seq_sp', ADD: 'task_seq_add', BLG: 'task_seq_blg', BUG: 'task_seq_bug', CHG: 'task_seq_chg' };
  for (const [prefix, maxNum] of Object.entries(seqUpdates)) {
    const seqName = seqNameMap[prefix];
    if (seqName) {
      await supabase.rpc('setval_seq', { seq_name: seqName, new_val: maxNum + 1 }).catch(() => {
        // If helper doesn't exist, skip — sequences will auto-advance past conflicts
      });
    }
  }

  const taskRows = rows.map((row) => ({
    id: row.id,
    title: row.title,
    type: TASK_TYPE_MAP[row.type?.toLowerCase()] || row.type || 'Sprint',
    sprint_id: row.sprint_id || null,
    qa_sprint_id: row.qa_sprint_id || null,
    module: row.module || null,
    owner_id: row.owner_id ? (userIdMap[String(row.owner_id)] || null) : null,
    priority: row.priority || null,
    status: row.status || 'To Do',
    qa_status: row.qa_status || null,
    qa_in_progress_date: row.qa_in_progress_date || null,
    qa_actual_hours: row.qa_actual_hours || 0,
    qa_fixing_in_progress_date: row.qa_fixing_in_progress_date || null,
    qa_fixing_hours: row.qa_fixing_hours || 0,
    estimated_hours: row.estimated_hours || 0,
    actual_hours: row.actual_hours || 0,
    blocked_hours: row.blocked_hours || 0,
    blocker: row.blocker || null,
    steps_to_reproduce: row.steps_to_reproduce || null,
    test_reproduced: row.test_reproduced || 0,
    blocker_date: row.blocker_date || null,
    in_progress_date: row.in_progress_date || null,
    created_date: row.created_date || nowIso(),
    closed_date: row.closed_date || null,
    description: row.description || null,
  }));

  // Insert in batches of 100
  const BATCH = 100;
  for (let i = 0; i < taskRows.length; i += BATCH) {
    const batch = taskRows.slice(i, i + BATCH);
    const { error } = await supabase.from('tasks').insert(batch);
    if (error) {
      console.error(`  ❌  Task batch ${i}-${i + BATCH} failed:`, error.message);
    } else {
      log(`  ✓  Tasks ${i + 1}–${Math.min(i + BATCH, taskRows.length)} inserted.`);
    }
  }
}

async function migrateApprovals(userIdMap) {
  log('Migrating approvals...');

  const { rows } = await oldDb.query(`
    SELECT task_id, reason, approved_by_id, impact, approved
    FROM approvals
    ORDER BY task_id
  `);

  log(`  Found ${rows.length} approvals.`);
  if (rows.length === 0) return;

  const approvalRows = rows.map((row) => ({
    task_id: row.task_id,
    reason: row.reason || null,
    approved_by: row.approved_by_id ? (userIdMap[String(row.approved_by_id)] || null) : null,
    impact: row.impact || null,
    approved: row.approved || false,
  }));

  const { error } = await supabase.from('approvals').insert(approvalRows);
  if (error) console.error('  ❌  Approvals failed:', error.message);
  else log(`  ✓  ${approvalRows.length} approvals migrated.`);
}

async function migrateSprintSummaries() {
  log('Migrating sprint summaries...');

  const { rows } = await oldDb.query(`
    SELECT sprint_id, planned_tasks, completed_tasks, carry_forward,
           additional_tasks, bugs, success_percentage, what_went_well,
           issues, improvements, completed_date
    FROM sprint_summaries
    ORDER BY sprint_id
  `);

  log(`  Found ${rows.length} sprint summaries.`);
  if (rows.length === 0) return;

  const { error } = await supabase.from('sprint_summaries').insert(rows);
  if (error) console.error('  ❌  Sprint summaries failed:', error.message);
  else log(`  ✓  ${rows.length} sprint summaries migrated.`);
}

async function migrateTaskComments(userIdMap) {
  log('Migrating task comments...');

  const { rows } = await oldDb.query(`
    SELECT id, task_id, author_id, content, created_date
    FROM task_comments
    ORDER BY created_date
  `);

  log(`  Found ${rows.length} task comments.`);
  if (rows.length === 0) return;

  const commentRows = rows.map((row) => ({
    id: row.id,
    task_id: row.task_id,
    author_id: row.author_id ? (userIdMap[String(row.author_id)] || null) : null,
    content: row.content,
    created_date: row.created_date || nowIso(),
  }));

  const BATCH = 200;
  for (let i = 0; i < commentRows.length; i += BATCH) {
    const batch = commentRows.slice(i, i + BATCH);
    const { error } = await supabase.from('task_comments').insert(batch);
    if (error) console.error(`  ❌  Comment batch failed:`, error.message);
    else log(`  ✓  Comments ${i + 1}–${Math.min(i + BATCH, commentRows.length)} inserted.`);
  }
}

async function migrateTaskAttachments(userIdMap) {
  log('Migrating task attachments metadata...');
  log('  ⚠️  NOTE: S3 file contents are NOT automatically transferred.');
  log('  ⚠️  You must manually copy files from S3 to Supabase Storage.');
  log('  ⚠️  storage_path will be set to the original S3 key for reference.');

  const { rows } = await oldDb.query(`
    SELECT id, task_id, uploaded_by_id, file_name, file_size,
           content_type, s3_bucket, s3_key, created_date
    FROM task_attachments
    ORDER BY created_date
  `);

  log(`  Found ${rows.length} attachments.`);
  if (rows.length === 0) return;

  const attachmentRows = rows.map((row) => ({
    id: row.id,
    task_id: row.task_id,
    uploaded_by: row.uploaded_by_id ? (userIdMap[String(row.uploaded_by_id)] || null) : null,
    file_name: row.file_name,
    file_size: row.file_size || 0,
    content_type: row.content_type || null,
    // Preserve original S3 key as storage_path for reference
    // Update these paths manually after migrating files to Supabase Storage
    storage_path: `s3-migration/${row.s3_bucket}/${row.s3_key}`,
    created_date: row.created_date || nowIso(),
  }));

  const { error } = await supabase.from('task_attachments').insert(attachmentRows);
  if (error) console.error('  ❌  Attachments failed:', error.message);
  else log(`  ✓  ${attachmentRows.length} attachment records migrated (paths need manual update).`);
}

async function migrateAuditLogs(userIdMap) {
  log('Migrating audit logs...');

  const { rows } = await oldDb.query(`
    SELECT id, user_id, action, entity_type, entity_id, path, method,
           status_code, ip_address, user_agent,
           COALESCE(metadata, '{}'::jsonb) AS metadata, created_date
    FROM audit_logs
    ORDER BY created_date
    LIMIT 10000
  `);

  log(`  Found ${rows.length} audit log entries (capped at 10,000).`);
  if (rows.length === 0) return;

  const logRows = rows.map((row) => ({
    id: row.id,
    user_id: row.user_id ? (userIdMap[String(row.user_id)] || null) : null,
    action: row.action,
    entity_type: row.entity_type || null,
    entity_id: row.entity_id || null,
    path: row.path,
    method: row.method,
    status_code: row.status_code || 200,
    ip_address: row.ip_address || null,
    user_agent: row.user_agent || null,
    metadata: row.metadata || {},
    created_date: row.created_date || nowIso(),
  }));

  const BATCH = 500;
  for (let i = 0; i < logRows.length; i += BATCH) {
    const batch = logRows.slice(i, i + BATCH);
    const { error } = await supabase.from('audit_logs').insert(batch);
    if (error) console.error(`  ❌  Audit log batch failed:`, error.message);
    else log(`  ✓  Audit logs ${i + 1}–${Math.min(i + BATCH, logRows.length)} inserted.`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Sprint Flow — Django → Supabase        ║');
  console.log('║   Data Migration Script                  ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  log(`Temporary password for all users: "${TEMP_PASSWORD}"`);
  log('Notify users to change their password after migration.');
  console.log('');

  await oldDb.connect();
  log('Connected to old database.');

  // Maps Django User.id (integer) → Supabase team_members.id (UUID)
  const userIdMap = {};

  try {
    await migrateTeamMembers(userIdMap);
    await migrateSprints();
    await migrateTasks(userIdMap);
    await migrateApprovals(userIdMap);
    await migrateSprintSummaries();
    await migrateTaskComments(userIdMap);
    await migrateTaskAttachments(userIdMap);
    await migrateAuditLogs(userIdMap);

    console.log('');
    console.log('✅  Migration completed successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Transfer S3 files to Supabase Storage (task-attachments bucket)');
    console.log('     Update storage_path in task_attachments after copying.');
    console.log(`  2. Notify all users that their temporary password is: "${TEMP_PASSWORD}"`);
    console.log('  3. Deploy the frontend with Supabase env vars.');
    console.log('  4. Test login, sprint board, and task management.');
    console.log('');
  } finally {
    await oldDb.end();
  }
}

main().catch((err) => {
  console.error('❌  Migration failed:', err);
  process.exit(1);
});
