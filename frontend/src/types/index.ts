export type UserRole = 'Manager' | 'Super Admin' | 'Developer' | 'Associate' | 'Security' | 'QA';

export type TaskType = 'Sprint' | 'Additional' | 'Backlog' | 'Bug' | 'Change';

export type TaskPriority = 'Blocker' | 'High' | 'Medium' | 'Low';

export type TaskStatus =
  | 'To Do'
  | 'In Progress'
  | 'Blocked'
  | 'Done'
  | 'Fixed'
  | 'Closed'
  | 'Reopen';

export type ImpactLevel = 'Low' | 'Medium' | 'High';

export type SprintHealth = 'Healthy' | 'At Risk' | 'Critical';

export type QaStatus = 'Ready to Test' | 'Testing' | 'Rework' | 'Fixing' | 'Ready to Stage';

export interface TeamMember {
  id: string;
  name: string;
  username: string;
  email: string;
  role: UserRole;
  avatar?: string;
  team?: string;
  leave_dates?: string[];
}

export interface Sprint {
  id: string;
  sprint_name: string;
  start_date: string;
  end_date: string;
  sprint_goal: string;
  holiday_dates?: string[];
  is_active: boolean;
  team?: string;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  uploaded_by?: string | null;
  file_name: string;
  file_size: number;
  content_type?: string | null;
  storage_path: string;
  url?: string;
  created_date: string;
}

export interface Task {
  id: string;
  title: string;
  type: TaskType;
  sprint_id: string | null;
  qa_sprint_id?: string | null;
  module: string;
  owner_id: string;
  priority: TaskPriority;
  status: TaskStatus;
  qa_status?: QaStatus | null;
  estimated_hours: number;
  actual_hours: number;
  qa_actual_hours?: number;
  qa_fixing_hours?: number;
  blocked_hours?: number;
  blocker?: string;
  blocker_date?: string;
  in_progress_date?: string;
  created_date: string;
  closed_date?: string;
  description?: string;
  steps_to_reproduce?: string;
  attachments?: TaskAttachment[];
}

export interface AdditionalWorkApproval {
  task_id: string;
  reason: string;
  approved_by?: string;
  impact: ImpactLevel;
  approved: boolean;
}

export interface SprintSummary {
  sprint_id: string;
  planned_tasks: number;
  completed_tasks: number;
  carry_forward: number;
  additional_tasks: number;
  bugs: number;
  success_percentage: number;
  what_went_well: string;
  issues: string;
  improvements: string;
  completed_date?: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string;
  content: string;
  created_date: string;
}

export interface AuditLog {
  id: string;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  path: string;
  method: string;
  status_code: number;
  ip_address?: string | null;
  user_agent?: string | null;
  metadata?: Record<string, unknown>;
  created_date: string;
  user?: TeamMember | null;
}
