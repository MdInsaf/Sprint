import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useTeamMembers, useCreateTeamMember, useUpdateTeamMember, useDeleteTeamMember } from '@/hooks';
import { useTeamSelection } from '@/hooks/use-team-selection';
import { TeamMember, UserRole } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { CalendarDays, ShieldCheck, Trash2, UserPlus2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const DEFAULT_TEAM = 'Developers';
const ASSOCIATE_TEAMS = new Set(['R&D', 'GRC', 'Ascenders']);
const SECURITY_TEAMS = new Set(['GRC', 'Ascenders']);

export default function Users() {
  const { user } = useAuth();
  const { teams: teamOptions } = useTeamSelection(user?.team);
  const { data: members = [], isLoading: membersLoading } = useTeamMembers();
  const createMemberMutation = useCreateTeamMember();
  const updateMemberMutation = useUpdateTeamMember();
  const deleteMemberMutation = useDeleteTeamMember();
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('Developer');
  const [newTeam, setNewTeam] = useState(teamOptions[0] || DEFAULT_TEAM);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveMember, setLeaveMember] = useState<TeamMember | null>(null);
  const [leaveDates, setLeaveDates] = useState<Date[]>([]);

  const isManagerRole = (role: UserRole) => role === 'Manager' || role === 'Super Admin';
  const isAssociateRole = (role: UserRole) => role === 'Associate';
  const isSecurityRole = (role: UserRole) => role === 'Security';
  const isSuperAdmin = (user?.role || '').toLowerCase() === 'super admin';
  const managerCount = useMemo(
    () => members.filter((m) => isManagerRole(m.role)).length,
    [members]
  );

  // React Query handles data refresh automatically via cache invalidation

  useEffect(() => {
    if (!teamOptions.includes(newTeam)) {
      setNewTeam(teamOptions[0] || DEFAULT_TEAM);
    }
  }, [teamOptions, newTeam]);

  useEffect(() => {
    if (newRole === 'Associate' && !ASSOCIATE_TEAMS.has(newTeam)) {
      setNewRole('Developer');
      toast.error('Associate role is only allowed for R&D, GRC, or Ascenders teams.');
    }
  }, [newRole, newTeam]);

  useEffect(() => {
    if (newRole === 'Security' && !SECURITY_TEAMS.has(newTeam)) {
      setNewRole('Developer');
      toast.error('Security role is only allowed for GRC or Ascenders teams.');
    }
  }, [newRole, newTeam]);

  const parseLeaveDates = (dates?: string[]) =>
    (dates || [])
      .map((value) => new Date(`${value}T00:00:00`))
      .filter((date) => !Number.isNaN(date.getTime()));

  const formatLeaveDates = (dates: Date[]) =>
    Array.from(new Set(dates.map((date) => format(date, 'yyyy-MM-dd')))).sort();

  const resetNewMemberForm = () => {
    setNewName('');
    setNewEmail('');
    setNewUsername('');
    setNewPassword('');
    setNewTeam(teamOptions[0] || DEFAULT_TEAM);
  };

  const openLeaveEditor = (member: TeamMember) => {
    setLeaveMember(member);
    setLeaveDates(parseLeaveDates(member.leave_dates));
    setLeaveOpen(true);
  };

  const handleLeaveSave = () => {
    if (!leaveMember) return;
    const updated = {
      ...leaveMember,
      leave_dates: formatLeaveDates(leaveDates),
    };
    updateMemberMutation.mutate(updated);
    setLeaveOpen(false);
    setLeaveMember(null);
  };

  const handleAdd = () => {
    const trimmed = newName.trim();
    const trimmedEmail = newEmail.trim().toLowerCase();
    const trimmedUsername = newUsername.trim().toLowerCase();
    const trimmedPassword = newPassword.trim();
    if (!trimmed) {
      toast.error('Please enter a name');
      return;
    }
    if (!trimmedEmail) {
      toast.error('Please enter an email');
      return;
    }
    if (!trimmedUsername) {
      toast.error('Please enter a username');
      return;
    }
    if (!trimmedPassword) {
      toast.error('Please enter a password');
      return;
    }
    if (newRole === 'Super Admin' && !isSuperAdmin) {
      toast.error('Only a Super Admin can grant Super Admin role.');
      return;
    }
    if (newRole === 'Associate' && !ASSOCIATE_TEAMS.has(newTeam)) {
      toast.error('Associate role is only allowed for R&D, GRC, or Ascenders teams.');
      return;
    }
    if (newRole === 'Security' && !SECURITY_TEAMS.has(newTeam)) {
      toast.error('Security role is only allowed for GRC or Ascenders teams.');
      return;
    }

    const member: TeamMember = {
      id: `member-${crypto.randomUUID()}`,
      name: trimmed,
      username: trimmedUsername,
      email: trimmedEmail,
      role: newRole,
      team: newTeam || DEFAULT_TEAM,
    };

    createMemberMutation.mutate(
      { ...member, password: trimmedPassword },
      {
        onSuccess: () => {
          resetNewMemberForm();
        },
      }
    );
  };

  const handleRoleChange = (memberId: string, role: UserRole) => {
    const member = members.find((m) => m.id === memberId);
    if (!member) return;

    if (isManagerRole(member.role) && !isManagerRole(role) && managerCount <= 1) {
      toast.error('You need at least one manager or super admin.');
      return;
    }
    if (role === 'Super Admin' && !isSuperAdmin) {
      toast.error('Only a Super Admin can grant Super Admin role.');
      return;
    }
    if (isAssociateRole(role) && !ASSOCIATE_TEAMS.has(member.team || DEFAULT_TEAM)) {
      toast.error('Associate role is only allowed for R&D, GRC, or Ascenders teams.');
      return;
    }
    if (isSecurityRole(role) && !SECURITY_TEAMS.has(member.team || DEFAULT_TEAM)) {
      toast.error('Security role is only allowed for GRC or Ascenders teams.');
      return;
    }

    updateMemberMutation.mutate({ ...member, role });
  };

  const handleTeamChange = (memberId: string, team: string) => {
    const member = members.find((m) => m.id === memberId);
    if (!member) return;
    if (isAssociateRole(member.role) && !ASSOCIATE_TEAMS.has(team)) {
      toast.error('Associate role is only allowed for R&D, GRC, or Ascenders teams.');
      return;
    }
    if (isSecurityRole(member.role) && !SECURITY_TEAMS.has(team)) {
      toast.error('Security role is only allowed for GRC or Ascenders teams.');
      return;
    }
    updateMemberMutation.mutate({ ...member, team });
  };

  const handleDelete = (memberId: string) => {
    const member = members.find((m) => m.id === memberId);
    if (!member) return;

    if (isManagerRole(member.role) && managerCount <= 1) {
      toast.error('You need at least one manager or super admin.');
      return;
    }

    const confirmed = window.confirm(`Remove ${member.name}?`);
    if (!confirmed) return;

    deleteMemberMutation.mutate(memberId);
  };

  if (membersLoading) return null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Team & Roles</h1>
          <p className="text-muted-foreground">Add, edit, or remove people on the team.</p>
        </div>
        <Badge variant="outline" className="gap-1">
          <ShieldCheck className="h-3 w-3" />
          {managerCount} manager/admin{managerCount === 1 ? '' : 's'}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add team member</CardTitle>
          <CardDescription>Create a new account and choose their role.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr,1.2fr,1fr,1fr,0.9fr,0.9fr,auto] items-start">
          <Input
            placeholder="Full name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full"
          />
          <Input
            placeholder="Email"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="w-full"
          />
          <Input
            placeholder="Username"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value.toLowerCase())}
            className="w-full"
          />
          <Input
            placeholder="Password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full"
          />
          <Select value={newRole} onValueChange={(v) => setNewRole(v as UserRole)}>
            <SelectTrigger className="w-full md:w-44">
              <SelectValue />
            </SelectTrigger>
          <SelectContent>
            <SelectItem value="Manager">Manager</SelectItem>
            {isSuperAdmin && <SelectItem value="Super Admin">Super Admin</SelectItem>}
            <SelectItem value="Developer">Developer</SelectItem>
            {ASSOCIATE_TEAMS.has(newTeam) && (
              <SelectItem value="Associate">Associate</SelectItem>
            )}
            {SECURITY_TEAMS.has(newTeam) && (
              <SelectItem value="Security">Security</SelectItem>
            )}
            <SelectItem value="QA">QA</SelectItem>
          </SelectContent>
          </Select>
          <Select value={newTeam} onValueChange={setNewTeam}>
            <SelectTrigger className="w-full md:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {teamOptions.map((team) => (
                <SelectItem key={team} value={team}>
                  {team}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleAdd} className="md:w-auto w-full">
            <UserPlus2 className="h-4 w-4 mr-2" />
            Add user
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team members</CardTitle>
          <CardDescription>Update roles or remove access.</CardDescription>
        </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
          <Table className="w-full table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30%]">Name</TableHead>
                <TableHead className="w-[25%]">Email</TableHead>
                <TableHead className="w-[20%]">Role</TableHead>
                <TableHead className="w-[15%]">Team</TableHead>
                <TableHead className="w-[10%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="font-medium">{member.name}</div>
                  </TableCell>
                  <TableCell>
                    <div className="truncate text-sm text-muted-foreground">{member.email}</div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={member.role}
                      onValueChange={(v) => handleRoleChange(member.id, v as UserRole)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Manager">Manager</SelectItem>
                        {isSuperAdmin && <SelectItem value="Super Admin">Super Admin</SelectItem>}
                        <SelectItem value="Developer">Developer</SelectItem>
                        {(ASSOCIATE_TEAMS.has(member.team || DEFAULT_TEAM) || member.role === 'Associate') && (
                          <SelectItem value="Associate">Associate</SelectItem>
                        )}
                        {(SECURITY_TEAMS.has(member.team || DEFAULT_TEAM) || member.role === 'Security') && (
                          <SelectItem value="Security">Security</SelectItem>
                        )}
                        <SelectItem value="QA">QA</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={member.team || DEFAULT_TEAM}
                      onValueChange={(value) => handleTeamChange(member.id, value)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {teamOptions.map((team) => (
                          <SelectItem key={team} value={team}>
                            {team}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2 flex-wrap">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openLeaveEditor(member)}
                        title="Edit leave dates"
                      >
                        <CalendarDays className="h-4 w-4" />
                        <span className="sr-only">Edit leave dates</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(member.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Delete</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No team members yet. Add your first user above.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={leaveOpen}
        onOpenChange={(open) => {
          setLeaveOpen(open);
          if (!open) {
            setLeaveMember(null);
            setLeaveDates([]);
          }
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              Leave Dates {leaveMember ? `: ${leaveMember.name}` : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Calendar
              mode="multiple"
              selected={leaveDates}
              onSelect={(dates) => setLeaveDates(dates ?? [])}
              className="p-3 pointer-events-auto"
            />
            {leaveDates.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {leaveDates
                  .slice()
                  .sort((a, b) => a.getTime() - b.getTime())
                  .map((date) => format(date, 'MMM d, yyyy'))
                  .join(', ')}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">No leave dates selected.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleLeaveSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
