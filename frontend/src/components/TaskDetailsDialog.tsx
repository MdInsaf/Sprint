import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { deleteAttachment } from '@/lib/store';
import { useSprints, useTask, useTeamMembers } from '@/hooks';
import { Task, TaskAttachment } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { Paperclip, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { toHours } from '@/lib/time';
import { formatLocalDate } from '@/lib/utils';

interface TaskDetailsDialogProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatText(value?: string | null) {
  return value && value.trim() ? value : '-';
}

function formatDate(value?: string | null) {
  return formatLocalDate(value);
}

function formatHours(value?: number | null) {
  if (value === null || value === undefined) return '-';
  return String(toHours(value));
}

function formatFileSize(bytes: number) {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${Math.round(size * 10) / 10} ${units[unitIndex]}`;
}

function DetailGroup({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: string }[];
}) {
  return (
    <div className="rounded-lg border bg-secondary/40 p-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="space-y-1 text-sm">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{item.label}</span>
            <span className="font-medium text-right">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AttachmentItem({
  file,
  onAction,
  onDelete,
  canDelete,
  isDeleting,
}: {
  file: TaskAttachment;
  onAction: (file: TaskAttachment) => void;
  onDelete?: (file: TaskAttachment) => void;
  canDelete?: boolean;
  isDeleting?: boolean;
}) {
  const content = (
    <>
      <div className="flex items-center gap-2 truncate">
        <Paperclip className="h-3 w-3 text-muted-foreground" />
        <span className="truncate">{file.file_name}</span>
      </div>
      <span className="text-muted-foreground">{formatFileSize(file.file_size)}</span>
    </>
  );

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onAction(file)}
        className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-xs hover:bg-secondary/60"
        disabled={!file.url}
        title={file.url ? 'Preview or download' : 'No preview available'}
      >
        {content}
      </button>
      {canDelete && onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(file);
          }}
          className="rounded-md border p-2 text-muted-foreground hover:text-destructive disabled:cursor-not-allowed"
          title="Delete attachment"
          disabled={isDeleting}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export function TaskDetailsDialog({ task, open, onOpenChange }: TaskDetailsDialogProps) {
  const { user, isManager, isQA } = useAuth();
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: sprints = [] } = useSprints();
  const taskId = task?.id || '';
  const { data: fullTask } = useTask(taskId, open && !!taskId);
  const currentTask = fullTask || task;
  const [previewFile, setPreviewFile] = useState<TaskAttachment | null>(null);
  const [attachmentItems, setAttachmentItems] = useState<TaskAttachment[]>(currentTask?.attachments || []);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setAttachmentItems(currentTask?.attachments || []);
  }, [currentTask?.attachments, currentTask?.id]);

  const previewUrl = previewFile?.url || '';
  const previewName = previewFile?.file_name || '';
  const previewExt = useMemo(() => {
    const source = previewName || previewUrl;
    const match = source.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
    return match ? match[1].toLowerCase() : '';
  }, [previewName, previewUrl]);
  const isImagePreview = useMemo(
    () => ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(previewExt),
    [previewExt]
  );
  const isVideoPreview = useMemo(
    () => ['mp4', 'webm', 'ogg', 'mov'].includes(previewExt),
    [previewExt]
  );
  const canPreviewInline = isImagePreview || isVideoPreview;

  if (!currentTask) return null;
  const ownerName = teamMembers.find((m) => m.id === currentTask.owner_id)?.name || 'Unassigned';
  const taskSprint = currentTask.sprint_id ? sprints.find((s) => s.id === currentTask.sprint_id) : null;
  const sprintName = taskSprint?.sprint_name || (currentTask.sprint_id || 'None');
  const taskTeam = taskSprint?.team || user?.team || '';
  const moduleLabel = ['GRC', 'Ascenders'].includes(taskTeam) ? 'Client' : 'Module';
  const attachments = attachmentItems;
  const canDeleteAttachment = (file: TaskAttachment) => {
    if (!user) return false;
    if (isManager || isQA) return true;
    if (file.uploaded_by && String(file.uploaded_by) === String(user.id)) return true;
    return String(currentTask.owner_id) === String(user.id);
  };

  const overviewItems = [
    { label: 'Task ID', value: formatText(currentTask.id) },
    { label: moduleLabel, value: formatText(currentTask.module) },
    { label: 'Owner', value: ownerName },
    { label: 'Priority', value: formatText(currentTask.priority) },
    { label: 'Sprint', value: sprintName },
  ];

  const statusItems = [
    { label: 'Status', value: formatText(currentTask.status) },
    { label: 'QA Status', value: formatText(currentTask.qa_status) },
    { label: 'Created', value: formatDate(currentTask.created_date) },
    { label: 'In Progress', value: formatDate(currentTask.in_progress_date) },
    { label: 'Closed', value: formatDate(currentTask.closed_date) },
  ];

  const hoursItems = [
    { label: 'Estimated Hours', value: formatHours(currentTask.estimated_hours) },
    { label: 'Actual Hours', value: formatHours(currentTask.actual_hours) },
    { label: 'Blocked Hours', value: formatHours(currentTask.blocked_hours) },
    { label: 'QA Testing Hours', value: formatHours(currentTask.qa_actual_hours) },
    { label: 'QA Fixing Hours', value: formatHours(currentTask.qa_fixing_hours) },
  ];

  const blockerItems = [
    { label: 'Blocker', value: formatText(currentTask.blocker) },
    { label: 'Blocker Date', value: formatDate(currentTask.blocker_date) },
  ];

  const handleAttachmentAction = (file: TaskAttachment) => {
    if (!file.url) return;
    const match = file.file_name.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
    const ext = match ? match[1].toLowerCase() : '';
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
    const isVideo = ['mp4', 'webm', 'ogg', 'mov'].includes(ext);
    if (isImage || isVideo) {
      setPreviewFile(file);
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = file.url;
    anchor.download = file.file_name;
    anchor.rel = 'noreferrer';
    anchor.click();
  };

  const handleAttachmentDelete = async (file: TaskAttachment) => {
    if (!file.id) return;
    const confirmed = window.confirm(`Delete ${file.file_name}?`);
    if (!confirmed) return;
    setDeletingId(file.id);
    try {
      await deleteAttachment(currentTask.id, file.id);
      setAttachmentItems((prev) => prev.filter((item) => item.id !== file.id));
      if (previewFile?.id === file.id) {
        setPreviewFile(null);
      }
      toast.success('Attachment deleted');
    } catch (error) {
      toast.error('Failed to delete attachment');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Task Details</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="text-xs uppercase text-muted-foreground">Title</div>
                <p className="text-lg font-semibold">{formatText(currentTask.title)}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge variant="outline">{currentTask.type}</Badge>
                <Badge variant="secondary">{currentTask.status}</Badge>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">ID: {formatText(currentTask.id)}</div>
          </div>

          <Separator />

          <div className="grid gap-3 sm:grid-cols-2">
            <DetailGroup title="Overview" items={overviewItems} />
            <DetailGroup title="Status & Dates" items={statusItems} />
            <DetailGroup title="Hours" items={hoursItems} />
            <DetailGroup title="Blocker" items={blockerItems} />
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border bg-secondary/30 p-3 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Description
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {formatText(currentTask.description)}
              </p>
            </div>

            <div className="rounded-lg border bg-secondary/30 p-3 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Steps to Reproduce
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {formatText(currentTask.steps_to_reproduce)}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Attachments
            </div>
            {attachments.length === 0 ? (
              <div className="text-sm text-muted-foreground">No attachments</div>
            ) : (
              <div className="space-y-2">
                {attachments.map((file) => (
                  <AttachmentItem
                    key={file.id}
                    file={file}
                    onAction={handleAttachmentAction}
                    onDelete={handleAttachmentDelete}
                    canDelete={canDeleteAttachment(file)}
                    isDeleting={deletingId === file.id}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>

      <Dialog open={Boolean(previewFile)} onOpenChange={(isOpen) => !isOpen && setPreviewFile(null)}>
        <DialogContent className="max-w-4xl h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>{previewFile?.file_name || 'Attachment Preview'}</DialogTitle>
          </DialogHeader>
          {previewFile?.url && canPreviewInline ? (
            isImagePreview ? (
              <div className="flex h-full w-full items-center justify-center overflow-auto rounded-md border bg-black/5 p-2">
                <img
                  src={previewFile.url}
                  alt={previewFile.file_name}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : (
              <video controls className="h-full w-full rounded-md border bg-black/5">
                <source src={previewFile.url} />
                Your browser does not support video playback.
              </video>
            )
          ) : (
            <div className="text-sm text-muted-foreground">No preview available for this file.</div>
          )}
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}