import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { usePrefetchCoreData } from '@/hooks/use-prefetch';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

// Map routes to lazy-loaded page modules for preloading on hover
const routePreloaders: Record<string, () => void> = {
  '/dashboard': () => import('@/pages/Dashboard'),
  '/workspace': () => import('@/pages/MyWorkspace'),
  '/board': () => import('@/pages/SprintBoard'),
  '/test-board': () => import('@/pages/TestBoard'),
  '/test-summary': () => import('@/pages/TestSummary'),
  '/bugs': () => import('@/pages/BugBoard'),
  '/bug-summary': () => import('@/pages/BugSummary'),
  '/tasks': () => import('@/pages/TaskManagement'),
  '/backlog-summary': () => import('@/pages/BacklogSummary'),
  '/additional-work': () => import('@/pages/AdditionalWork'),
  '/blockers': () => import('@/pages/Blockers'),
  '/users': () => import('@/pages/Users'),
  '/workload': () => import('@/pages/TeamWorkload'),
  '/summary': () => import('@/pages/SprintSummary'),
  '/audit-logs': () => import('@/pages/AuditLogs'),
  '/account': () => import('@/pages/Account'),
};
import {
  LayoutDashboard,
  Kanban,
  AlertTriangle,
  Users,
  FileText,
  LogOut,
  ClipboardPlus,
  UserCog,
  Bug,
  KeyRound,
  ClipboardCheck,
  ListTodo,
  Sun,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const THEME_STORAGE_KEY = 'sprintflow-theme';

const managerNavItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/workspace', label: 'My Workspace', icon: LayoutDashboard },
  { to: '/board', label: 'Sprint Board', icon: Kanban },
  { to: '/test-board', label: 'Test Board', icon: ClipboardCheck },
  { to: '/test-summary', label: 'Test Summary', icon: FileText },
  { to: '/bugs', label: 'Bugs Board', icon: Bug },
  { to: '/bug-summary', label: 'Bugs Summary', icon: FileText },
  { to: '/tasks', label: 'Tasks', icon: ListTodo },
  { to: '/backlog-summary', label: 'Backlog Summary', icon: FileText },
  { to: '/additional-work', label: 'Additional Work', icon: ClipboardPlus },
  { to: '/blockers', label: 'Blockers', icon: AlertTriangle },
  { to: '/users', label: 'Team & Roles', icon: UserCog },
  { to: '/workload', label: 'Team Workload', icon: Users },
  { to: '/summary', label: 'Sprint Summary', icon: FileText },
  { to: '/audit-logs', label: 'Audit Logs', icon: FileText },
  { to: '/account', label: 'Change Password', icon: KeyRound },
];

const developerNavItems = [
  { to: '/workspace', label: 'My Workspace', icon: LayoutDashboard },
  { to: '/board', label: 'Sprint Board', icon: Kanban },
  { to: '/test-board', label: 'Test Board', icon: ClipboardCheck },
  { to: '/bugs', label: 'Bugs Board', icon: Bug },
  { to: '/tasks', label: 'My Tasks', icon: ListTodo },
  { to: '/blockers', label: 'Blockers', icon: AlertTriangle },
  { to: '/account', label: 'Change Password', icon: KeyRound },
];

const qaNavItems = [
  { to: '/workspace', label: 'My Workspace', icon: LayoutDashboard },
  { to: '/board', label: 'Sprint Board', icon: Kanban },
  { to: '/test-board', label: 'Test Board', icon: ClipboardCheck },
  { to: '/test-summary', label: 'Test Summary', icon: FileText },
  { to: '/bugs', label: 'Bugs Board', icon: Bug },
  { to: '/bug-summary', label: 'Bugs Summary', icon: FileText },
  { to: '/tasks', label: 'My Tasks', icon: ListTodo },
  { to: '/blockers', label: 'Blockers', icon: AlertTriangle },
  { to: '/account', label: 'Change Password', icon: KeyRound },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout, isManager, isQA } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  usePrefetchCoreData();

  const isSuperAdmin = (user?.role || '').toLowerCase() === 'super admin';
  const isGrcRestricted = (user?.team || '') === 'GRC' && !isSuperAdmin;
  const restrictedRoutes = new Set(['/bugs', '/bug-summary', '/test-board', '/test-summary']);
  const baseNavItems = isManager ? managerNavItems : isQA ? qaNavItems : developerNavItems;
  const navItems = isGrcRestricted
    ? baseNavItems.filter((item) => !restrictedRoutes.has(item.to))
    : baseNavItems;
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark';
  });

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    const favicon = document.querySelector("link[rel~='icon']");
    if (favicon) {
      favicon.setAttribute('href', isDark ? '/owl.png' : '/favicon.png');
    }
  }, [isDark]);

  const handleThemeToggle = () => {
    setIsDark((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next ? 'dark' : 'light');
      } catch {
        // Ignore storage failures (private mode, blocked, etc.)
      }
      return next;
    });
  };

  return (
    <div className="flex min-h-screen bg-transparent">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-sidebar flex flex-col">
        <div className="p-4 border-b border-sidebar-border flex items-center justify-between gap-3">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full overflow-hidden",
                isDark ? "bg-black" : "bg-white"
              )}
            >
              <img
                src={isDark ? "/witch.png" : "/favicon.png"}
                alt="SprintFlow"
                className="h-10 w-10 object-contain"
              />
            </div>
            <span className="font-semibold tracking-wide text-sidebar-foreground">SprintFlow</span>
          </Link>
          <button
            type="button"
            onClick={handleThemeToggle}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-sidebar-border bg-black/15 text-sidebar-foreground/80 transition hover:bg-black/25 hover:text-sidebar-accent-foreground dark:bg-black/35 dark:hover:bg-black/45"
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {isDark ? (
              <Sun className="h-4 w-4" />
            ) : (
              <img src="/wand.png" alt="" className="h-8 w-8 object-contain" aria-hidden="true" />
            )}
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                onMouseEnter={() => routePreloaders[item.to]?.()}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
              {user?.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">{user?.name}</p>
              <p className="text-xs text-muted-foreground">{user?.role}</p>
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleLogout}
            className="w-full justify-start text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
