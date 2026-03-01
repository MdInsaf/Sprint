/**
 * Sprint Flow — CSV → Supabase Migration Script
 *
 * Reads exported Django CSV files from the /tables folder and imports
 * them into Supabase. No database connection to the old DB needed.
 *
 * Usage:
 *   cd scripts
 *   npm install
 *   node migrate-from-csv.js
 *
 * Required env vars (in scripts/.env):
 *   SUPABASE_URL        — Your Supabase project URL
 *   SUPABASE_SERVICE_KEY — service_role key (bypasses RLS)
 *   TEMP_PASSWORD       — Temporary password for all users (default: password123)
 *
 * Place all CSV files in the /tables folder at the project root.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TABLES_DIR = path.resolve(__dirname, '../tables');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TEMP_PASSWORD = process.env.TEMP_PASSWORD || 'password123';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function readCsv(tableName) {
  const files = fs.readdirSync(TABLES_DIR)
    .filter(f => f.startsWith(tableName + '_') && f.endsWith('.csv'));
  if (files.length === 0) {
    throw new Error(`No CSV found for table: ${tableName} (looked in ${TABLES_DIR})`);
  }
  const filePath = path.join(TABLES_DIR, files[0]);
  log(`  Reading ${files[0]} ...`);
  const content = fs.readFileSync(filePath, 'utf8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    cast: false,
    trim: true,
  });
}

function parseJson(val, fallback = []) {
  if (!val || val === '' || val === 'None' || val === 'null') return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

function nullIfEmpty(val) {
  if (val === '' || val === 'None' || val === 'NULL' || val == null) return null;
  return val;
}

function toFloat(val, fallback = 0) {
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

function toInt(val, fallback = 0) {
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

function toBool(val) {
  if (typeof val === 'boolean') return val;
  return val === 'true' || val === 't' || val === '1' || val === 'True';
}

// ── Step 1: Team Members (merge auth_user + member_profiles) ──────────────────

async function migrateTeamMembers() {
  log('Migrating team members...');

  const users = readCsv('auth_user');
  const profiles = readCsv('member_profiles');

  // Build profile lookup by user_id
  const profileMap = {};
  for (const p of profiles) {
    profileMap[String(p.user_id)] = p;
  }

  // Django int id → Supabase UUID
  const userIdMap = {};

  for (const user of users) {
    const profile = profileMap[String(user.id)] || {};
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username;
    const email = user.email || `${user.username}@migration.local`;

    const { data, error } = await supabase.rpc('add_team_member_with_password', {
      p_name: name,
      p_username: user.username,
      p_email: email,
      p_password: TEMP_PASSWORD,
      p_role: profile.role || 'Developer',
      p_avatar: nullIfEmpty(profile.avatar),
      p_team: profile.team || 'Developers',
      p_leave_dates: parseJson(profile.leave_dates, []),
    });

    if (error) {
      console.error(`  ❌  ${user.username}: ${error.message}`);
      continue;
    }

    userIdMap[String(user.id)] = data.id;
    log(`  ✓  ${name} (${user.username}) → ${data.id}`);
  }

  log(`  Done. ${Object.keys(userIdMap).length} / ${users.length} members migrated.`);
  return userIdMap;
}

// ── Step 2: Sprints ───────────────────────────────────────────────────────────

async function migrateSprints() {
  log('Migrating sprints...');
  const rows = readCsv('sprints');

  if (rows.length === 0) { log('  No sprints found.'); return; }

  const sprintRows = rows.map(r => ({
    id: r.id,
    sprint_name: r.sprint_name,
    start_date: r.start_date,
    end_date: r.end_date,
    sprint_goal: nullIfEmpty(r.sprint_goal),
    holiday_dates: parseJson(r.holiday_dates, []),
    is_active: toBool(r.is_active),
    team: r.team || 'Developers',
  }));

  const { error } = await supabase.from('sprints').insert(sprintRows);
  if (error) console.error('  ❌  Sprints:', error.message);
  else log(`  ✓  ${sprintRows.length} sprints migrated.`);
}

// ── Step 3: Tasks ─────────────────────────────────────────────────────────────

async function migrateTasks(userIdMap) {
  log('Migrating tasks...');
  const rows = readCsv('tasks');

  if (rows.length === 0) { log('  No tasks found.'); return; }

  const TYPE_MAP = {
    sprint: 'Sprint', Sprint: 'Sprint',
    additional: 'Additional', Additional: 'Additional',
    backlog: 'Backlog', Backlog: 'Backlog',
    bug: 'Bug', Bug: 'Bug',
    change: 'Change', Change: 'Change',
  };

  const taskRows = rows.map(r => ({
    id: r.id,
    title: r.title,
    type: TYPE_MAP[r.type] || 'Sprint',
    sprint_id: nullIfEmpty(r.sprint_id),
    qa_sprint_id: nullIfEmpty(r.qa_sprint_id),
    module: nullIfEmpty(r.module),
    owner_id: r.owner_id ? (userIdMap[String(r.owner_id)] || null) : null,
    priority: nullIfEmpty(r.priority),
    status: r.status || 'To Do',
    qa_status: nullIfEmpty(r.qa_status),
    qa_in_progress_date: nullIfEmpty(r.qa_in_progress_date),
    qa_actual_hours: toFloat(r.qa_actual_hours),
    qa_fixing_in_progress_date: nullIfEmpty(r.qa_fixing_in_progress_date),
    qa_fixing_hours: toFloat(r.qa_fixing_hours),
    estimated_hours: toFloat(r.estimated_hours),
    actual_hours: toFloat(r.actual_hours),
    blocked_hours: toFloat(r.blocked_hours),
    blocker: nullIfEmpty(r.blocker),
    steps_to_reproduce: nullIfEmpty(r.steps_to_reproduce),
    test_reproduced: toInt(r.test_reproduced),
    blocker_date: nullIfEmpty(r.blocker_date),
    in_progress_date: nullIfEmpty(r.in_progress_date),
    created_date: nullIfEmpty(r.created_date) || new Date().toISOString(),
    closed_date: nullIfEmpty(r.closed_date),
    description: nullIfEmpty(r.description),
  }));

  const BATCH = 100;
  for (let i = 0; i < taskRows.length; i += BATCH) {
    const batch = taskRows.slice(i, i + BATCH);
    const { error } = await supabase.from('tasks').insert(batch);
    if (error) console.error(`  ❌  Tasks batch ${i}–${i + BATCH}: ${error.message}`);
    else log(`  ✓  Tasks ${i + 1}–${Math.min(i + BATCH, taskRows.length)} inserted.`);
  }
}

// ── Step 4: Approvals ─────────────────────────────────────────────────────────

async function migrateApprovals(userIdMap) {
  log('Migrating approvals...');
  const rows = readCsv('approvals');

  if (rows.length === 0) { log('  No approvals found.'); return; }

  const approvalRows = rows.map(r => ({
    task_id: r.task_id,
    reason: nullIfEmpty(r.reason),
    approved_by: r.approved_by ? (userIdMap[String(r.approved_by)] || null) : null,
    impact: nullIfEmpty(r.impact),
    approved: toBool(r.approved),
  }));

  const { error } = await supabase.from('approvals').insert(approvalRows);
  if (error) console.error('  ❌  Approvals:', error.message);
  else log(`  ✓  ${approvalRows.length} approvals migrated.`);
}

// ── Step 5: Sprint Summaries ──────────────────────────────────────────────────

async function migrateSprintSummaries() {
  log('Migrating sprint summaries...');
  const rows = readCsv('sprint_summaries');

  if (rows.length === 0) { log('  No sprint summaries found.'); return; }

  const summaryRows = rows.map(r => ({
    sprint_id: r.sprint_id,
    planned_tasks: toInt(r.planned_tasks),
    completed_tasks: toInt(r.completed_tasks),
    carry_forward: toInt(r.carry_forward),
    additional_tasks: toInt(r.additional_tasks),
    bugs: toInt(r.bugs),
    success_percentage: toFloat(r.success_percentage),
    what_went_well: nullIfEmpty(r.what_went_well),
    issues: nullIfEmpty(r.issues),
    improvements: nullIfEmpty(r.improvements),
    completed_date: nullIfEmpty(r.completed_date),
  }));

  const { error } = await supabase.from('sprint_summaries').insert(summaryRows);
  if (error) console.error('  ❌  Sprint summaries:', error.message);
  else log(`  ✓  ${summaryRows.length} sprint summaries migrated.`);
}

// ── Step 6: Task Comments ─────────────────────────────────────────────────────

async function migrateTaskComments(userIdMap) {
  log('Migrating task comments...');
  const rows = readCsv('task_comments');

  if (rows.length === 0) { log('  No comments found.'); return; }

  const commentRows = rows.map(r => ({
    id: r.id,
    task_id: r.task_id,
    author_id: r.author_id ? (userIdMap[String(r.author_id)] || null) : null,
    content: r.content,
    created_date: nullIfEmpty(r.created_date) || new Date().toISOString(),
  }));

  const BATCH = 200;
  for (let i = 0; i < commentRows.length; i += BATCH) {
    const batch = commentRows.slice(i, i + BATCH);
    const { error } = await supabase.from('task_comments').insert(batch);
    if (error) console.error(`  ❌  Comments batch: ${error.message}`);
    else log(`  ✓  Comments ${i + 1}–${Math.min(i + BATCH, commentRows.length)} inserted.`);
  }
}

// ── Step 7: Task Attachments ──────────────────────────────────────────────────

async function migrateTaskAttachments(userIdMap) {
  log('Migrating task attachments...');
  log('  ⚠️  File contents are NOT transferred — only metadata records.');
  log('  ⚠️  storage_path records the original S3 key for reference.');

  const rows = readCsv('task_attachments');

  if (rows.length === 0) { log('  No attachments found.'); return; }

  const attachmentRows = rows.map(r => ({
    id: r.id,
    task_id: r.task_id,
    uploaded_by: r.uploaded_by ? (userIdMap[String(r.uploaded_by)] || null) : null,
    file_name: r.file_name,
    file_size: toInt(r.file_size),
    content_type: nullIfEmpty(r.content_type),
    storage_path: `s3-migration/${r.s3_bucket}/${r.s3_key}`,
    created_date: nullIfEmpty(r.created_date) || new Date().toISOString(),
  }));

  const { error } = await supabase.from('task_attachments').insert(attachmentRows);
  if (error) console.error('  ❌  Attachments:', error.message);
  else log(`  ✓  ${attachmentRows.length} attachment records migrated.`);
}

// ── Step 8: Audit Logs ────────────────────────────────────────────────────────

async function migrateAuditLogs(userIdMap) {
  log('Migrating audit logs...');
  const rows = readCsv('audit_logs');

  if (rows.length === 0) { log('  No audit logs found.'); return; }

  const logRows = rows.map(r => ({
    id: r.id,
    user_id: r.user_id ? (userIdMap[String(r.user_id)] || null) : null,
    action: r.action,
    entity_type: nullIfEmpty(r.entity_type),
    entity_id: nullIfEmpty(r.entity_id),
    path: r.path,
    method: r.method,
    status_code: toInt(r.status_code, 200),
    ip_address: nullIfEmpty(r.ip_address),
    user_agent: nullIfEmpty(r.user_agent),
    metadata: parseJson(r.metadata, {}),
    created_date: nullIfEmpty(r.created_date) || new Date().toISOString(),
  }));

  const BATCH = 500;
  for (let i = 0; i < logRows.length; i += BATCH) {
    const batch = logRows.slice(i, i + BATCH);
    const { error } = await supabase.from('audit_logs').insert(batch);
    if (error) console.error(`  ❌  Audit logs batch: ${error.message}`);
    else log(`  ✓  Audit logs ${i + 1}–${Math.min(i + BATCH, logRows.length)} inserted.`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Sprint Flow — CSV → Supabase           ║');
  console.log('║   Data Migration Script                  ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  log(`Tables directory: ${TABLES_DIR}`);
  log(`Temp password for all users: "${TEMP_PASSWORD}"`);
  console.log('');

  const userIdMap = await migrateTeamMembers();
  await migrateSprints();
  await migrateTasks(userIdMap);
  await migrateApprovals(userIdMap);
  await migrateSprintSummaries();
  await migrateTaskComments(userIdMap);
  await migrateTaskAttachments(userIdMap);
  await migrateAuditLogs(userIdMap);

  console.log('');
  console.log('✅  Migration complete!');
  console.log('');
  console.log('Next steps:');
  console.log(`  1. All users have temporary password: "${TEMP_PASSWORD}"`);
  console.log('  2. Users must change their password via the Account page.');
  console.log('  3. S3 file attachments need to be manually copied to Supabase Storage.');
  console.log('');
}

main().catch(err => {
  console.error('');
  console.error('❌  Migration failed:', err.message);
  process.exit(1);
});
