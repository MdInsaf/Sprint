import { supabase } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/store';

type AuditAction = 'create' | 'update' | 'delete';

type AuditLogInput = {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  path: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  statusCode?: number;
  metadata?: Record<string, unknown>;
};

export async function writeAuditLog({
  action,
  entityType,
  entityId = null,
  path,
  method,
  statusCode = 200,
  metadata = {},
}: AuditLogInput): Promise<void> {
  try {
    const currentUser = getCurrentUser();
    const baseMetadata: Record<string, unknown> = {
      user_name: currentUser?.name || null,
      username: currentUser?.username || null,
      user_email: currentUser?.email || null,
      user_role: currentUser?.role || null,
      user_team: currentUser?.team || null,
    };
    const { error } = await supabase.from('audit_logs').insert({
      id: `audit-${crypto.randomUUID()}`,
      user_id: currentUser?.id ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId,
      path,
      method,
      status_code: statusCode,
      ip_address: null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      metadata: {
        ...baseMetadata,
        ...metadata,
      },
      created_date: new Date().toISOString(),
    });

    if (error) {
      console.error('Failed to write audit log', error);
    }
  } catch (error) {
    console.error('Failed to write audit log', error);
  }
}
