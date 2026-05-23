import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { usePrefetchCoreData } from '@/hooks/use-prefetch';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

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
  Menu,
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
  const isGrcRestricted = ['GRC', 'Ascenders'].includes(user?.team || '') && !isSuperAdmin;
  const restrictedRoutes = new Set(['/bugs', '/bug-summary', '/test-board', '/test-summary']);
  const baseNavItems = isManager ? managerNavItems : isQA ? qaNavItems : developerNavItems;
  const navItems = isGrcRestricted
    ? baseNavItems.filter((item) => !restrictedRoutes.has(item.to))
    : baseNavItems;

  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark';
  });

  // Controls the mobile slide-in navigation drawer
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
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

  // Close mobile drawer automatically when the route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Close mobile drawer if the viewport expands past the md breakpoint (768px).
  // Prevents a stale open Sheet + visible overlay when resizing from mobile to desktop.
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)');
    const closeOnDesktop = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileOpen(false);
    };
    mql.addEventListener('change', closeOnDesktop);
    return () => mql.removeEventListener('change', closeOnDesktop);
  }, []);

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

  // Renders nav links for both the desktop sidebar and the mobile Sheet.
  // onItemClick is passed only for the mobile Sheet so each tap closes the drawer.
  const renderNavLinks = (onItemClick?: () => void) =>
    navItems.map((item) => {
      const Icon = item.icon;
      const isActive = location.pathname === item.to;
      return (
        <Link
          key={item.to}
          to={item.to}
          onClick={onItemClick}
          onMouseEnter={() => routePreloaders[item.to]?.()}
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 md:py-2 rounded-lg text-sm font-medium transition-colors',
            isActive
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {item.label}
        </Link>
      );
    });

  // Shared user info + sign-out footer for both sidebar and mobile Sheet.
  // Rendered as a JSX expression (no hooks) so it is safe to reuse at two DOM positions.
  const userFooter = (
    <div className="p-3 border-t border-sidebar-border">
      <div className="flex items-center gap-3 px-3 py-2.5 md:py-2 mb-2">
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary shrink-0">
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
  );

  // Shared theme toggle button — appears in the desktop sidebar header and the mobile top bar.
  const themeToggleBtn = (
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
  );

  return (
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
      {/*
       * Outer div:
       *   mobile  → flex-col  : [mobile header] stacks above [main content]
       *   desktop → md:flex-row: [sidebar] sits left of [main content]  ← identical to original
       */}
      <div className="flex flex-col md:flex-row min-h-screen bg-transparent">

        {/* ── Mobile top header — visible only below md breakpoint ─────── */}
        <header className="md:hidden sticky top-0 z-40 flex items-center justify-between px-4 h-14 border-b border-sidebar-border bg-sidebar shrink-0">
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Open navigation menu"
              aria-expanded={mobileOpen}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-sidebar-border bg-black/15 text-sidebar-foreground transition hover:bg-black/25 dark:bg-black/35 dark:hover:bg-black/45"
            >
              <Menu className="h-5 w-5" />
            </button>
          </SheetTrigger>

          <Link to="/dashboard" className="flex items-center gap-2">
            <div
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full overflow-hidden',
                isDark ? 'bg-black' : 'bg-white'
              )}
            >
              <img
                src={isDark ? '/witch.png' : '/favicon.png'}
                alt="SprintFlow"
                className="h-7 w-7 object-contain"
              />
            </div>
            <span className="font-semibold tracking-wide text-sidebar-foreground">SprintFlow</span>
          </Link>

          {themeToggleBtn}
        </header>

        {/* ── Desktop sidebar — hidden on mobile, full sidebar on md+ ──── */}
        {/*
         * Original: className="w-64 border-r border-border bg-sidebar flex flex-col"
         * Change  : added "hidden md:flex" — desktop display is identical (flex flex-col)
         */}
        <aside className="hidden md:flex w-64 flex-col border-r border-border bg-sidebar">
          <div className="p-4 border-b border-sidebar-border flex items-center justify-between gap-3">
            <Link to="/dashboard" className="flex items-center gap-2">
              <div
                className={cn(
                  'flex h-12 w-12 items-center justify-center rounded-full overflow-hidden',
                  isDark ? 'bg-black' : 'bg-white'
                )}
              >
                <img
                  src={isDark ? '/witch.png' : '/favicon.png'}
                  alt="SprintFlow"
                  className="h-10 w-10 object-contain"
                />
              </div>
              <span className="font-semibold tracking-wide text-sidebar-foreground">SprintFlow</span>
            </Link>
            {themeToggleBtn}
          </div>

          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            {renderNavLinks()}
          </nav>

          {userFooter}
        </aside>

        {/* ── Mobile navigation Sheet (slide-in drawer from left) ────────
         *  Overrides from shadcn defaults:
         *    p-0     → removes default p-6 padding (we control it ourselves)
         *    gap-0   → removes default gap-4 between children
         *    w-72    → 288px fixed width instead of the default w-3/4
         *    bg-sidebar → matches desktop sidebar background
         *    border-sidebar-border → matches desktop sidebar border color
         *    flex flex-col → structures brand header / nav / footer vertically
         */}
        <SheetContent
          side="left"
          aria-describedby={undefined}
          className="p-0 gap-0 w-72 bg-sidebar border-sidebar-border flex flex-col"
        >
          {/* Required by Radix Dialog for screen-reader accessibility */}
          <SheetTitle className="sr-only">Navigation Menu</SheetTitle>

          {/* Brand header — h-14 matches the mobile top bar height */}
          <div className="h-14 px-4 flex items-center border-b border-sidebar-border shrink-0">
            <Link
              to="/dashboard"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-2"
            >
              <div
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full overflow-hidden',
                  isDark ? 'bg-black' : 'bg-white'
                )}
              >
                <img
                  src={isDark ? '/witch.png' : '/favicon.png'}
                  alt="SprintFlow"
                  className="h-7 w-7 object-contain"
                />
              </div>
              <span className="font-semibold text-sm tracking-wide text-sidebar-foreground">
                SprintFlow
              </span>
            </Link>
          </div>

          {/* Scrollable nav list — passes close callback so tapping a link shuts the drawer */}
          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            {renderNavLinks(() => setMobileOpen(false))}
          </nav>

          {userFooter}
        </SheetContent>

        {/* ── Main content ─────────────────────────────────────────────────
         *  p-3 sm:p-4 md:p-6 — at md+ this is identical to the original p-6
         */}
        <main className="flex-1 md:overflow-auto">
          <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </Sheet>
  );
}
