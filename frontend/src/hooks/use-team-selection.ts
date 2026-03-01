import { useEffect, useMemo, useState } from 'react';
import { useTeamMembers } from '@/hooks/use-team-members';
import { useSprints } from '@/hooks/use-sprints';
import { useAuth } from '@/context/AuthContext';

const DEFAULT_TEAMS = ['Developers', 'R&D', 'GRC', 'Ascenders'];
const DEFAULT_TEAM = DEFAULT_TEAMS[0];

export function useTeamSelection(preferredTeam?: string) {
  const { user } = useAuth();
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: sprints = [] } = useSprints();

  const normalizedRole = (user?.role || '').toLowerCase();
  const isSuperAdmin = normalizedRole === 'super admin';

  const teams = useMemo(() => {
    if (!isSuperAdmin) {
      return [user?.team || DEFAULT_TEAM];
    }
    const names = new Set(DEFAULT_TEAMS);
    teamMembers.forEach((member) => {
      names.add(member.team || DEFAULT_TEAM);
    });
    sprints.forEach((sprint) => {
      names.add(sprint.team || DEFAULT_TEAM);
    });
    if (user?.team) {
      names.add(user.team);
    }
    return Array.from(names);
  }, [isSuperAdmin, user?.team, teamMembers, sprints]);

  const fallbackTeam = preferredTeam || DEFAULT_TEAM;
  const [selectedTeam, setSelectedTeam] = useState(fallbackTeam);

  useEffect(() => {
    if (!selectedTeam || !teams.includes(selectedTeam)) {
      const next = teams.includes(fallbackTeam) ? fallbackTeam : teams[0] || DEFAULT_TEAM;
      if (next !== selectedTeam) {
        setSelectedTeam(next);
      }
    }
  }, [selectedTeam, teams, fallbackTeam]);

  return { teams, selectedTeam, setSelectedTeam };
}
