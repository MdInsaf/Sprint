-- ============================================================
-- Sprint Flow — Supabase Initial Migration
-- Replaces Django backend (PostgreSQL + DRF)
-- Auth: Custom RPC with pgcrypto bcrypt (no Supabase Auth)
-- Storage: Supabase Storage (replaces AWS S3)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLES
-- ============================================================

-- Team Members (merges Django auth_user + member_profiles)
CREATE TABLE IF NOT EXISTS team_members (
  id            UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  name          TEXT    NOT NULL,
  username      TEXT    NOT NULL UNIQUE,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'Developer',
  avatar        TEXT,
  team          TEXT    NOT NULL DEFAULT 'Developers',
  leave_dates   JSONB   NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Sprints
CREATE TABLE IF NOT EXISTS sprints (
  id            TEXT    PRIMARY KEY,
  sprint_name   TEXT    NOT NULL,
  start_date    TEXT    NOT NULL,
  end_date      TEXT    NOT NULL,
  sprint_goal   TEXT,
  holiday_dates JSONB   NOT NULL DEFAULT '[]',
  is_active     BOOLEAN NOT NULL DEFAULT FALSE,
  team          TEXT    NOT NULL DEFAULT 'Developers',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id                        TEXT    PRIMARY KEY,
  title                     TEXT    NOT NULL,
  type                      TEXT    NOT NULL CHECK (type IN ('Sprint','Additional','Backlog','Bug','Change')),
  sprint_id                 TEXT    REFERENCES sprints(id) ON DELETE SET NULL,
  qa_sprint_id              TEXT    REFERENCES sprints(id) ON DELETE SET NULL,
  module                    TEXT,
  owner_id                  UUID    REFERENCES team_members(id) ON DELETE SET NULL,
  priority                  TEXT    CHECK (priority IN ('Blocker','High','Medium','Low')),
  status                    TEXT    NOT NULL DEFAULT 'To Do'
                                    CHECK (status IN ('To Do','In Progress','Blocked','Done','Fixed','Closed','Reopen')),
  qa_status                 TEXT    CHECK (qa_status IN ('Ready to Test','Testing','Rework','Fixing','Ready to Stage')),
  qa_in_progress_date       TEXT,
  qa_actual_hours           FLOAT   NOT NULL DEFAULT 0,
  qa_fixing_in_progress_date TEXT,
  qa_fixing_hours           FLOAT   NOT NULL DEFAULT 0,
  estimated_hours           FLOAT   NOT NULL DEFAULT 0,
  actual_hours              FLOAT   NOT NULL DEFAULT 0,
  blocked_hours             FLOAT   NOT NULL DEFAULT 0,
  blocker                   TEXT,
  steps_to_reproduce        TEXT,
  test_reproduced           INTEGER NOT NULL DEFAULT 0,
  blocker_date              TEXT,
  in_progress_date          TEXT,
  created_date              TEXT    NOT NULL,
  closed_date               TEXT,
  description               TEXT,
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

-- Approvals (Additional Work)
CREATE TABLE IF NOT EXISTS approvals (
  task_id     TEXT    PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  reason      TEXT,
  approved_by UUID    REFERENCES team_members(id) ON DELETE SET NULL,
  impact      TEXT    CHECK (impact IN ('Low','Medium','High')),
  approved    BOOLEAN NOT NULL DEFAULT FALSE
);

-- Sprint Summaries (Retrospectives)
CREATE TABLE IF NOT EXISTS sprint_summaries (
  sprint_id         TEXT    PRIMARY KEY REFERENCES sprints(id) ON DELETE CASCADE,
  planned_tasks     INTEGER NOT NULL DEFAULT 0,
  completed_tasks   INTEGER NOT NULL DEFAULT 0,
  carry_forward     INTEGER NOT NULL DEFAULT 0,
  additional_tasks  INTEGER NOT NULL DEFAULT 0,
  bugs              INTEGER NOT NULL DEFAULT 0,
  success_percentage FLOAT  NOT NULL DEFAULT 0,
  what_went_well    TEXT,
  issues            TEXT,
  improvements      TEXT,
  completed_date    TEXT
);

-- Task Comments
CREATE TABLE IF NOT EXISTS task_comments (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id    UUID REFERENCES team_members(id) ON DELETE SET NULL,
  content      TEXT NOT NULL,
  created_date TEXT NOT NULL
);

-- Task Attachments (Supabase Storage replaces AWS S3)
CREATE TABLE IF NOT EXISTS task_attachments (
  id           TEXT   PRIMARY KEY,
  task_id      TEXT   NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by  UUID   REFERENCES team_members(id) ON DELETE SET NULL,
  file_name    TEXT   NOT NULL,
  file_size    BIGINT NOT NULL DEFAULT 0,
  content_type TEXT,
  storage_path TEXT   NOT NULL,
  created_date TEXT   NOT NULL
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT    PRIMARY KEY,
  user_id     UUID    REFERENCES team_members(id) ON DELETE SET NULL,
  action      TEXT    NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  path        TEXT    NOT NULL,
  method      TEXT    NOT NULL,
  status_code INTEGER NOT NULL DEFAULT 200,
  ip_address  TEXT,
  user_agent  TEXT,
  metadata    JSONB   NOT NULL DEFAULT '{}',
  created_date TEXT   NOT NULL
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_sprints_team       ON sprints(team);
CREATE INDEX IF NOT EXISTS idx_sprints_is_active  ON sprints(is_active);
CREATE INDEX IF NOT EXISTS idx_tasks_sprint_id    ON tasks(sprint_id);
CREATE INDEX IF NOT EXISTS idx_tasks_qa_sprint_id ON tasks(qa_sprint_id);
CREATE INDEX IF NOT EXISTS idx_tasks_owner_id     ON tasks(owner_id);
CREATE INDEX IF NOT EXISTS idx_tasks_type         ON tasks(type);
CREATE INDEX IF NOT EXISTS idx_tasks_status       ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_attach_task   ON task_attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user    ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_date    ON audit_logs(created_date DESC);

-- ============================================================
-- SEQUENCES (for task ID generation)
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS task_seq_sp  START 1;
CREATE SEQUENCE IF NOT EXISTS task_seq_add START 1;
CREATE SEQUENCE IF NOT EXISTS task_seq_blg START 1;
CREATE SEQUENCE IF NOT EXISTS task_seq_bug START 1;
CREATE SEQUENCE IF NOT EXISTS task_seq_chg START 1;

-- ============================================================
-- RPC FUNCTIONS
-- ============================================================

-- generate_task_id: Returns next task ID string (e.g., "SP-001")
CREATE OR REPLACE FUNCTION generate_task_id(p_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  prefix   TEXT;
  seq_name TEXT;
  next_num BIGINT;
  digits   INTEGER;
BEGIN
  CASE p_type
    WHEN 'Sprint'     THEN prefix := 'SP';  seq_name := 'task_seq_sp';
    WHEN 'Additional' THEN prefix := 'ADD'; seq_name := 'task_seq_add';
    WHEN 'Backlog'    THEN prefix := 'BLG'; seq_name := 'task_seq_blg';
    WHEN 'Bug'        THEN prefix := 'BUG'; seq_name := 'task_seq_bug';
    WHEN 'Change'     THEN prefix := 'CHG'; seq_name := 'task_seq_chg';
    ELSE RAISE EXCEPTION 'Unknown task type: %', p_type;
  END CASE;

  EXECUTE format('SELECT nextval(%L)', seq_name) INTO next_num;
  digits := GREATEST(3, LENGTH(next_num::TEXT));
  RETURN prefix || '-' || LPAD(next_num::TEXT, digits, '0');
END;
$$;

-- login: Verifies bcrypt password and returns sanitized member (no hash)
CREATE OR REPLACE FUNCTION login(p_username TEXT, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec team_members%ROWTYPE;
BEGIN
  SELECT * INTO rec FROM team_members WHERE username = p_username;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid credentials';
  END IF;

  IF NOT (rec.password_hash = crypt(p_password, rec.password_hash)) THEN
    RAISE EXCEPTION 'Invalid credentials';
  END IF;

  RETURN json_build_object(
    'id',          rec.id,
    'name',        rec.name,
    'username',    rec.username,
    'email',       rec.email,
    'role',        rec.role,
    'avatar',      rec.avatar,
    'team',        rec.team,
    'leave_dates', rec.leave_dates
  );
END;
$$;

-- add_team_member_with_password: Hashes password server-side on insert
CREATE OR REPLACE FUNCTION add_team_member_with_password(
  p_name        TEXT,
  p_username    TEXT,
  p_email       TEXT,
  p_password    TEXT,
  p_role        TEXT    DEFAULT 'Developer',
  p_avatar      TEXT    DEFAULT NULL,
  p_team        TEXT    DEFAULT 'Developers',
  p_leave_dates JSONB   DEFAULT '[]'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_id UUID;
BEGIN
  INSERT INTO team_members (name, username, email, password_hash, role, avatar, team, leave_dates)
  VALUES (p_name, p_username, p_email, crypt(p_password, gen_salt('bf', 10)), p_role, p_avatar, p_team, p_leave_dates)
  RETURNING id INTO new_id;

  RETURN (
    SELECT json_build_object(
      'id',          id,
      'name',        name,
      'username',    username,
      'email',       email,
      'role',        role,
      'avatar',      avatar,
      'team',        team,
      'leave_dates', leave_dates
    )
    FROM team_members WHERE id = new_id
  );
END;
$$;

-- update_team_member_with_password: Re-hashes only when new password provided
CREATE OR REPLACE FUNCTION update_team_member_with_password(
  p_id          UUID,
  p_name        TEXT,
  p_email       TEXT,
  p_role        TEXT,
  p_avatar      TEXT    DEFAULT NULL,
  p_team        TEXT    DEFAULT 'Developers',
  p_leave_dates JSONB   DEFAULT '[]',
  p_new_password TEXT   DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_new_password IS NOT NULL AND p_new_password <> '' THEN
    UPDATE team_members
    SET name = p_name, email = p_email, role = p_role, avatar = p_avatar,
        team = p_team, leave_dates = p_leave_dates,
        password_hash = crypt(p_new_password, gen_salt('bf', 10))
    WHERE id = p_id;
  ELSE
    UPDATE team_members
    SET name = p_name, email = p_email, role = p_role, avatar = p_avatar,
        team = p_team, leave_dates = p_leave_dates
    WHERE id = p_id;
  END IF;

  RETURN (
    SELECT json_build_object(
      'id',          id,
      'name',        name,
      'username',    username,
      'email',       email,
      'role',        role,
      'avatar',      avatar,
      'team',        team,
      'leave_dates', leave_dates
    )
    FROM team_members WHERE id = p_id
  );
END;
$$;

-- change_password: Verifies current password then sets new one
CREATE OR REPLACE FUNCTION change_password(
  p_member_id       UUID,
  p_current_password TEXT,
  p_new_password     TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cur_hash TEXT;
BEGIN
  SELECT password_hash INTO cur_hash FROM team_members WHERE id = p_member_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  IF NOT (cur_hash = crypt(p_current_password, cur_hash)) THEN
    RAISE EXCEPTION 'Current password is incorrect';
  END IF;

  UPDATE team_members
  SET password_hash = crypt(p_new_password, gen_salt('bf', 10))
  WHERE id = p_member_id;

  RETURN TRUE;
END;
$$;

-- set_active_sprint: Atomically sets exactly one sprint active per team
CREATE OR REPLACE FUNCTION set_active_sprint(p_sprint_id TEXT, p_team TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE sprints SET is_active = FALSE WHERE team = p_team;
  UPDATE sprints SET is_active = TRUE  WHERE id = p_sprint_id AND team = p_team;
  RETURN TRUE;
END;
$$;

-- ============================================================
-- PERMISSIONS
-- Grant anon role access (RLS disabled; auth enforced at app level)
-- Note: password_hash is never exposed via SELECT in application code;
--       login/add/update RPCs run as SECURITY DEFINER.
-- ============================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  team_members, sprints, tasks, approvals, sprint_summaries,
  task_comments, task_attachments, audit_logs
TO anon, authenticated;

GRANT USAGE, SELECT ON SEQUENCE
  task_seq_sp, task_seq_add, task_seq_blg, task_seq_bug, task_seq_chg
TO anon, authenticated;

GRANT EXECUTE ON FUNCTION
  generate_task_id(TEXT),
  login(TEXT, TEXT),
  add_team_member_with_password(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB),
  update_team_member_with_password(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT),
  change_password(UUID, TEXT, TEXT),
  set_active_sprint(TEXT, TEXT)
TO anon, authenticated;
