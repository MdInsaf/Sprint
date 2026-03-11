-- Improve team member uniqueness errors so the client does not receive raw
-- Postgres constraint messages for common create/update failures.

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
  normalized_username TEXT := lower(btrim(coalesce(p_username, '')));
  normalized_email TEXT := lower(btrim(coalesce(p_email, '')));
BEGIN
  IF normalized_username = '' THEN
    RAISE EXCEPTION 'Username is required';
  END IF;

  IF normalized_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM team_members
    WHERE lower(username) = normalized_username
  ) THEN
    RAISE EXCEPTION 'Username already exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM team_members
    WHERE lower(email) = normalized_email
  ) THEN
    RAISE EXCEPTION 'Email already exists';
  END IF;

  INSERT INTO team_members (name, username, email, password_hash, role, avatar, team, leave_dates)
  VALUES (
    p_name,
    normalized_username,
    normalized_email,
    crypt(p_password, gen_salt('bf', 10)),
    p_role,
    p_avatar,
    p_team,
    p_leave_dates
  )
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
    FROM team_members
    WHERE id = new_id
  );
EXCEPTION
  WHEN unique_violation THEN
    IF POSITION('team_members_username_key' IN SQLERRM) > 0 THEN
      RAISE EXCEPTION 'Username already exists';
    END IF;
    IF POSITION('team_members_email_key' IN SQLERRM) > 0 THEN
      RAISE EXCEPTION 'Email already exists';
    END IF;
    RAISE;
END;
$$;

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
DECLARE
  normalized_email TEXT := lower(btrim(coalesce(p_email, '')));
BEGIN
  IF normalized_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM team_members
    WHERE id = p_id
  ) THEN
    RAISE EXCEPTION 'Team member not found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM team_members
    WHERE lower(email) = normalized_email
      AND id <> p_id
  ) THEN
    RAISE EXCEPTION 'Email already exists';
  END IF;

  IF p_new_password IS NOT NULL AND p_new_password <> '' THEN
    UPDATE team_members
    SET name = p_name,
        email = normalized_email,
        role = p_role,
        avatar = p_avatar,
        team = p_team,
        leave_dates = p_leave_dates,
        password_hash = crypt(p_new_password, gen_salt('bf', 10))
    WHERE id = p_id;
  ELSE
    UPDATE team_members
    SET name = p_name,
        email = normalized_email,
        role = p_role,
        avatar = p_avatar,
        team = p_team,
        leave_dates = p_leave_dates
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
    FROM team_members
    WHERE id = p_id
  );
EXCEPTION
  WHEN unique_violation THEN
    IF POSITION('team_members_email_key' IN SQLERRM) > 0 THEN
      RAISE EXCEPTION 'Email already exists';
    END IF;
    RAISE;
END;
$$;
