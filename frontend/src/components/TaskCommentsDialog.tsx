import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Task, TaskAttachment, TaskComment } from '@/types';
import { deleteAttachment } from '@/lib/store';
import { useTeamMembers, useTaskComments, useCreateTaskComment, useUpdateTask } from '@/hooks';
import { useAuth } from '@/context/AuthContext';
import { MessageSquare, Paperclip, Send, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { toHours } from '@/lib/time';
import { formatLocalDateTime } from '@/lib/utils';

interface TaskCommentsDialogProps {
  task: Task;
  onCommentAdded?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showDetails?: boolean;
}

export function TaskCommentsDialog({ task, onCommentAdded, open, onOpenChange, showDetails = false }: TaskCommentsDialogProps) {
  const { user, isManager, isQA } = useAuth();
  const [internalOpen, setInternalOpen] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState<null | { id?: string; url?: string; file_name: string }>(null);
  const [attachmentItems, setAttachmentItems] = useState<TaskAttachment[]>(task.attachments || []);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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

  const dialogOpen = open ?? internalOpen;
  const setDialogOpen = onOpenChange ?? setInternalOpen;

  const { data: comments = [] } = useTaskComments(task.id);
  const { data: teamMembers = [] } = useTeamMembers();
  const createCommentMutation = useCreateTaskComment();
  const updateTaskMutation = useUpdateTask();
  const commentCount = comments.length;
  const attachments = attachmentItems;

  useEffect(() => {
    setAttachmentItems(task.attachments || []);
  }, [task.attachments, task.id]);

  const handleSubmit = () => {
    if (!newComment.trim() || !user) return;

    const comment: TaskComment = {
      id: `comment-${crypto.randomUUID()}`,
      task_id: task.id,
      author_id: user.id,
      content: newComment.trim(),
      created_date: new Date().toISOString(),
    };

    createCommentMutation.mutate(comment, {
      onSuccess: () => {
        setNewComment('');
        onCommentAdded?.();
      },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const getAuthorName = (authorId: string) => {
    const authorKey = authorId == null ? '' : String(authorId);
    return teamMembers.find(m => String(m.id) === authorKey)?.name || 'Unknown';
  };

  const ownerName = useMemo(
    () => teamMembers.find((m) => m.id === task.owner_id)?.name || 'Unassigned',
    [teamMembers, task.owner_id]
  );

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '0 KB';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${Math.round(size * 10) / 10} ${units[unitIndex]}`;
  };

  const handleAttachmentUpload = async () => {
    if (pendingFiles.length === 0) return;
    setIsUploading(true);
    try {
      updateTaskMutation.mutate({ ...task, attachments: pendingFiles } as Task & { attachments?: File[] });
      setPendingFiles([]);
      onCommentAdded?.();
      toast.success('Attachments uploaded');
    } catch (error) {
      toast.error('Failed to upload attachments');
    } finally {
      setIsUploading(false);
    }
  };

  const handleAttachmentAction = (file: { id?: string; url?: string; file_name: string }) => {
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

  const canDeleteAttachment = (file: TaskAttachment) => {
    if (!user) return false;
    if (isManager || isQA) return true;
    if (file.uploaded_by && String(file.uploaded_by) === String(user.id)) return true;
    return String(task.owner_id) === String(user.id);
  };

  const handleAttachmentDelete = async (file: TaskAttachment) => {
    if (!file.id) return;
    const confirmed = window.confirm(`Delete ${file.file_name}?`);
    if (!confirmed) return;
    setDeletingId(file.id);
    try {
      await deleteAttachment(task.id, file.id);
      setAttachmentItems((prev) => prev.filter((item) => item.id !== file.id));
      if (previewFile?.id === file.id) {
        setPreviewFile(null);
      }
      onCommentAdded?.();
      toast.success('Attachment deleted');
    } catch (error) {
      toast.error('Failed to delete attachment');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <button 
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          <MessageSquare className="h-3 w-3" />
          {commentCount > 0 && <span>{commentCount}</span>}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-xl" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="text-base">Comments: {task.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {showDetails && (
            <div className="rounded-lg border bg-secondary/40 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="font-medium">{task.module}</span>
                <span className="text-muted-foreground">{task.type}</span>
              </div>
              <div className="flex flex-wrap gap-3 text-muted-foreground">
                <span>Status: {task.status}</span>
                <span>Owner: {ownerName}</span>
                <span>Priority: {task.priority}</span>
                <span>
                  Hours: {toHours(task.actual_hours || 0)}h/{toHours(task.estimated_hours || 0)}h
                </span>
              </div>
              {task.blocker && (
                <div className="text-destructive text-xs">Blocker: {task.blocker}</div>
              )}
              {task.description && (
                <div className="text-xs text-muted-foreground">Notes: {task.description}</div>
              )}
            </div>
          )}

          {attachments.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Attachments
              </div>
              <div className="space-y-2">
                {attachments.map((file) => (
                  <div key={file.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleAttachmentAction(file)}
                      className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs hover:bg-secondary/60 break-words"
                      disabled={!file.url}
                      title={file.url ? 'Preview or download' : 'No preview available'}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="break-words">{file.file_name}</span>
                      </div>
                      <span className="text-muted-foreground shrink-0">{formatFileSize(file.file_size)}</span>
                    </button>
                    {canDeleteAttachment(file) && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAttachmentDelete(file);
                        }}
                        className="rounded-md border p-2 text-muted-foreground hover:text-destructive disabled:cursor-not-allowed"
                        title="Delete attachment"
                        disabled={deletingId === file.id}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Add Attachments
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="file"
                multiple
                onChange={(e) => setPendingFiles(Array.from(e.target.files || []))}
              />
              <Button
                size="sm"
                onClick={handleAttachmentUpload}
                disabled={pendingFiles.length === 0 || isUploading}
              >
                Upload
              </Button>
            </div>
            {pendingFiles.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {pendingFiles.length} file{pendingFiles.length === 1 ? '' : 's'} selected
              </p>
            )}
          </div>

          {/* Comments List */}
          <ScrollArea className="h-64 pr-4">
            {comments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No comments yet. Start the conversation!
              </p>
            ) : (
              <div className="space-y-3">
                {comments.map(comment => (
                  <div key={comment.id} className="p-3 rounded-lg bg-secondary/50 break-words">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">
                        {getAuthorName(comment.author_id)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatLocalDateTime(comment.created_date)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                      {comment.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Add Comment */}
          <div className="flex gap-2">
            <Textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add a comment..."
              className="min-h-10 text-sm resize-none"
              rows={2}
            />
            <Button 
              size="icon" 
              onClick={handleSubmit}
              disabled={!newComment.trim()}
            >
              <Send className="h-4 w-4" />
            </Button>
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