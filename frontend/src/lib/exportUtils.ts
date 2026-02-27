import { Sprint, Task, SprintSummary, TeamMember } from '@/types';

const isPlannedType = (type?: string) => type === 'Sprint' || type === 'Backlog';

type SprintExportInput = {
  sprint: Sprint;
  tasks: Task[];
  teamMembers: TeamMember[];
  summary?: SprintSummary | null;
  moduleLabel?: string;
};

export function exportSprintToCSV({
  sprint,
  tasks,
  teamMembers,
  summary,
  moduleLabel = 'Module',
}: SprintExportInput) {
  const sprintSummary =
    summary && summary.sprint_id === sprint.id ? summary : null;
  const sprintTasks = tasks.filter((task) => task.sprint_id === sprint.id);

  // Create tasks CSV
  const taskHeaders = ['Title', 'Type', moduleLabel, 'Owner', 'Priority', 'Status', 'Story Points (days)', 'Actual Days', 'Blocker'];
  const taskRows = sprintTasks.map(task => {
    const owner = teamMembers.find(m => m.id === task.owner_id)?.name || 'Unassigned';
    return [
      `"${task.title.replace(/"/g, '""')}"`,
      task.type,
      task.module,
      owner,
      task.priority,
      task.status,
      task.estimated_hours,
      task.actual_hours,
      task.blocker ? `"${task.blocker.replace(/"/g, '""')}"` : ''
    ].join(',');
  });

  // Create summary section
  const plannedTasks = sprintTasks.filter(t => isPlannedType(t.type));
  const completedTasks = sprintTasks.filter(t => t.status === 'Done' && isPlannedType(t.type));
  const successRate = plannedTasks.length > 0
    ? Math.round((completedTasks.length / plannedTasks.length) * 100)
    : 0;

  const summaryData = [
    '',
    'SPRINT SUMMARY',
    `Sprint Name,${sprint.sprint_name}`,
    `Start Date,${sprint.start_date}`,
    `End Date,${sprint.end_date}`,
    `Sprint Goal,"${sprint.sprint_goal.replace(/"/g, '""')}"`,
    `Success Rate,${sprintSummary?.success_percentage || successRate}%`,
    `Planned Tasks,${plannedTasks.length}`,
    `Completed Tasks,${completedTasks.length}`,
    `Additional Tasks,${sprintTasks.filter(t => t.type === 'Additional').length}`,
    `Bugs,${sprintTasks.filter(t => t.type === 'Bug').length}`,
    `Carry Forward,${sprintTasks.filter(t => t.status !== 'Done').length}`,
  ];

  if (sprintSummary) {
    summaryData.push('');
    summaryData.push('RETROSPECTIVE NOTES');
    if (sprintSummary.what_went_well) {
      summaryData.push(`What Went Well,"${sprintSummary.what_went_well.replace(/"/g, '""')}"`);
    }
    if (sprintSummary.issues) {
      summaryData.push(`Issues,"${sprintSummary.issues.replace(/"/g, '""')}"`);
    }
    if (sprintSummary.improvements) {
      summaryData.push(`Improvements,"${sprintSummary.improvements.replace(/"/g, '""')}"`);
    }
  }

  const csvContent = [
    ...summaryData,
    '',
    'TASKS',
    taskHeaders.join(','),
    ...taskRows
  ].join('\n');

  downloadFile(csvContent, `${sprint.sprint_name.replace(/\s+/g, '_')}_Report.csv`, 'text/csv');
}

export function exportSprintToPDF({
  sprint,
  tasks,
  teamMembers,
  summary,
}: SprintExportInput) {
  const sprintSummary =
    summary && summary.sprint_id === sprint.id ? summary : null;
  const sprintTasks = tasks.filter((task) => task.sprint_id === sprint.id);

  // Calculate stats
  const plannedTasks = sprintTasks.filter(t => isPlannedType(t.type));
  const completedTasks = sprintTasks.filter(t => t.status === 'Done' && isPlannedType(t.type));
  const successRate = sprintSummary?.success_percentage || (plannedTasks.length > 0
    ? Math.round((completedTasks.length / plannedTasks.length) * 100)
    : 0);

  const getOwnerName = (ownerId: string) => 
    teamMembers.find(m => m.id === ownerId)?.name || 'Unassigned';

  const tasksByStatus = {
    'Done': sprintTasks.filter(t => t.status === 'Done'),
    'In Progress': sprintTasks.filter(t => t.status === 'In Progress'),
    'Blocked': sprintTasks.filter(t => t.status === 'Blocked'),
    'To Do': sprintTasks.filter(t => t.status === 'To Do'),
  };

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${sprint.sprint_name} Report</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; color: #1a1a1a; }
        h1 { font-size: 24px; margin-bottom: 8px; }
        h2 { font-size: 18px; margin: 24px 0 12px; border-bottom: 2px solid #e5e5e5; padding-bottom: 8px; }
        h3 { font-size: 14px; margin: 16px 0 8px; color: #666; }
        .meta { color: #666; font-size: 14px; margin-bottom: 4px; }
        .goal { background: #f5f5f5; padding: 12px; border-radius: 6px; margin: 16px 0; }
        .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 16px 0; }
        .stat { background: #f5f5f5; padding: 16px; border-radius: 6px; text-align: center; }
        .stat-value { font-size: 28px; font-weight: 700; }
        .stat-label { font-size: 12px; color: #666; margin-top: 4px; }
        .success { color: #16a34a; }
        .warning { color: #d97706; }
        .danger { color: #dc2626; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 8px 0; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid #e5e5e5; }
        th { background: #f5f5f5; font-weight: 600; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 500; }
        .badge-high { background: #fee2e2; color: #dc2626; }
        .badge-medium { background: #fef3c7; color: #d97706; }
        .badge-low { background: #e0f2fe; color: #0284c7; }
        .notes { margin-top: 24px; }
        .note { background: #f5f5f5; padding: 12px; border-radius: 6px; margin: 8px 0; }
        .note-title { font-weight: 600; font-size: 12px; margin-bottom: 4px; }
        .note-content { font-size: 13px; color: #444; }
        @media print { body { padding: 20px; } }
      </style>
    </head>
    <body>
      <h1>${sprint.sprint_name}</h1>
      <p class="meta">${sprint.start_date} — ${sprint.end_date}</p>
      
      <div class="goal">
        <strong>Sprint Goal:</strong> ${sprint.sprint_goal}
      </div>

      <div class="stats">
        <div class="stat">
          <div class="stat-value ${successRate >= 80 ? 'success' : successRate >= 60 ? 'warning' : 'danger'}">${successRate}%</div>
          <div class="stat-label">Success Rate</div>
        </div>
        <div class="stat">
          <div class="stat-value">${completedTasks.length}</div>
          <div class="stat-label">Completed</div>
        </div>
        <div class="stat">
          <div class="stat-value">${sprintTasks.filter(t => t.type === 'Additional').length}</div>
          <div class="stat-label">Additional Work</div>
        </div>
        <div class="stat">
          <div class="stat-value">${sprintTasks.filter(t => t.type === 'Bug').length}</div>
          <div class="stat-label">Bugs Fixed</div>
        </div>
      </div>

      <h2>Tasks by Status</h2>
      ${Object.entries(tasksByStatus).map(([status, statusTasks]) => statusTasks.length > 0 ? `
        <h3>${status} (${statusTasks.length})</h3>
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Type</th>
              <th>Owner</th>
              <th>Priority</th>
              <th>Days</th>
            </tr>
          </thead>
          <tbody>
            ${statusTasks.map(task => `
              <tr>
                <td>${task.title}</td>
                <td>${task.type}</td>
                <td>${getOwnerName(task.owner_id)}</td>
                <td><span class="badge badge-${task.priority.toLowerCase()}">${task.priority}</span></td>
                <td>${task.actual_hours}/${task.estimated_hours}d</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '').join('')}

      ${sprintSummary && (sprintSummary.what_went_well || sprintSummary.issues || sprintSummary.improvements) ? `
        <h2>Retrospective Notes</h2>
        <div class="notes">
          ${sprintSummary.what_went_well ? `
            <div class="note">
              <div class="note-title success">What Went Well</div>
              <div class="note-content">${sprintSummary.what_went_well}</div>
            </div>
          ` : ''}
          ${sprintSummary.issues ? `
            <div class="note">
              <div class="note-title danger">Issues Encountered</div>
              <div class="note-content">${sprintSummary.issues}</div>
            </div>
          ` : ''}
          ${sprintSummary.improvements ? `
            <div class="note">
              <div class="note-title">Improvements for Next Sprint</div>
              <div class="note-content">${sprintSummary.improvements}</div>
            </div>
          ` : ''}
        </div>
      ` : ''}

      <p style="margin-top: 32px; font-size: 11px; color: #999; text-align: center;">
        Generated by SprintFlow on ${new Date().toLocaleDateString()}
      </p>
    </body>
    </html>
  `;

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.print();
    };
  }
}

export function exportBugsToCSV({
  bugs,
  teamMembers,
  moduleLabel = 'Module',
}: {
  bugs: Task[];
  teamMembers: TeamMember[];
  moduleLabel?: string;
}) {
  const format = (value: string | number | null | undefined) => {
    const safe = String(value ?? '').replace(/"/g, '""');
    return `"${safe}"`;
  };

  const headers = [
    'ID',
    'Title',
    'Type',
    moduleLabel,
    'Assignee',
    'Priority',
    'Status',
    'Created Date',
    'Closed Date',
    'Steps to Reproduce',
    'Description',
  ];

  const rows = bugs.map((bug) => {
    const owner = teamMembers.find((m) => m.id === bug.owner_id)?.name || 'Unassigned';
    return [
      format(bug.id),
      format(bug.title),
      format(bug.type),
      format(bug.module || ''),
      format(owner),
      format(bug.priority),
      format(bug.status),
      format(bug.created_date || ''),
      format(bug.closed_date || ''),
      format(bug.steps_to_reproduce || ''),
      format(bug.description || ''),
    ].join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\n');
  const date = new Date().toISOString().split('T')[0];
  downloadFile(csvContent, `bugs_${date}.csv`, 'text/csv');
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
