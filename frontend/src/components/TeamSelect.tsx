import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface TeamSelectProps {
  teams: string[];
  value: string;
  onChange: (value: string) => void;
  triggerClassName?: string;
  placeholder?: string;
}

export function TeamSelect({
  teams,
  value,
  onChange,
  triggerClassName,
  placeholder = 'Team',
}: TeamSelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={triggerClassName}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {teams.map((team) => (
          <SelectItem key={team} value={team}>
            {team}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
