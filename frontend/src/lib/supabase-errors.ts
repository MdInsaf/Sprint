type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string | null;
};

export function getSupabaseErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const candidate = error as SupabaseErrorLike;
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  const details = typeof candidate.details === 'string' ? candidate.details : '';
  const combined = `${message} ${details}`.toLowerCase();

  if (combined.includes('username already exists')) {
    return 'Username already exists';
  }

  if (combined.includes('email already exists')) {
    return 'Email already exists';
  }

  if (
    candidate.code === '23505'
    || combined.includes('duplicate key value')
    || combined.includes('already exists')
  ) {
    if (combined.includes('team_members_username_key') || combined.includes('key (username)')) {
      return 'Username already exists';
    }
    if (combined.includes('team_members_email_key') || combined.includes('key (email)')) {
      return 'Email already exists';
    }
    return 'This record already exists. Please refresh and try again.';
  }

  return message || fallback;
}
