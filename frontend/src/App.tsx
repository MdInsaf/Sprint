import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AnnouncerProvider } from "@/context/AnnouncerContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LongWaitIndicator } from "@/components/LongWaitIndicator";
import { queryClient } from "@/lib/query-client";
import AppLayout from "@/components/layout/AppLayout";

// Eagerly load auth pages (needed immediately)
import Login from "@/pages/Login";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import NotFound from "@/pages/NotFound";

// Lazy load all other pages — each becomes a separate chunk
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const SprintBoard = lazy(() => import("@/pages/SprintBoard"));
const TaskManagement = lazy(() => import("@/pages/TaskManagement"));
const AdditionalWork = lazy(() => import("@/pages/AdditionalWork"));
const Blockers = lazy(() => import("@/pages/Blockers"));
const TeamWorkload = lazy(() => import("@/pages/TeamWorkload"));
const SprintSummary = lazy(() => import("@/pages/SprintSummary"));
const Users = lazy(() => import("@/pages/Users"));
const BugBoard = lazy(() => import("@/pages/BugBoard"));
const BugSummary = lazy(() => import("@/pages/BugSummary"));
const Account = lazy(() => import("@/pages/Account"));
const TestBoard = lazy(() => import("@/pages/TestBoard"));
const TestSummary = lazy(() => import("@/pages/TestSummary"));
const MyWorkspace = lazy(() => import("@/pages/MyWorkspace"));
const BacklogSummary = lazy(() => import("@/pages/BacklogSummary"));
const AuditLogs = lazy(() => import("@/pages/AuditLogs"));

const isSuperAdmin = (role?: string) => (role || '').toLowerCase() === 'super admin';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();

  if (!ready) {
    return null;
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  return <AppLayout>{children}</AppLayout>;
}

function GrcRestrictedRoute({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();

  if (!ready) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const isGrcUser = (user.team || '') === 'GRC';
  if (isGrcUser && !isSuperAdmin(user.role)) {
    return <Navigate to="/board" replace />;
  }

  return <AppLayout>{children}</AppLayout>;
}

function ManagerRoute({ children }: { children: React.ReactNode }) {
  const { user, isManager, ready } = useAuth();

  if (!ready) {
    return null;
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  if (!isManager) {
    return <Navigate to="/board" replace />;
  }
  
  return <AppLayout>{children}</AppLayout>;
}

function QaRoute({ children }: { children: React.ReactNode }) {
  const { user, isManager, isQA, ready } = useAuth();

  if (!ready) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isQA && !isManager) {
    return <Navigate to="/board" replace />;
  }

  return <AppLayout>{children}</AppLayout>;
}

function GrcQaRoute({ children }: { children: React.ReactNode }) {
  const { user, isManager, isQA, ready } = useAuth();

  if (!ready) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const isGrcUser = (user.team || '') === 'GRC';
  if (isGrcUser && !isSuperAdmin(user.role)) {
    return <Navigate to="/board" replace />;
  }

  if (!isQA && !isManager) {
    return <Navigate to="/board" replace />;
  }

  return <AppLayout>{children}</AppLayout>;
}

function AppRoutes() {
  const { user } = useAuth();

  return (
    <Suspense fallback={null}>
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password/:uid/:token" element={<ResetPassword />} />
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/dashboard" element={<ManagerRoute><Dashboard /></ManagerRoute>} />
      <Route path="/board" element={<ProtectedRoute><SprintBoard /></ProtectedRoute>} />
      <Route path="/tasks" element={<ProtectedRoute><TaskManagement /></ProtectedRoute>} />
      <Route path="/bugs" element={<GrcRestrictedRoute><BugBoard /></GrcRestrictedRoute>} />
      <Route path="/test-board" element={<GrcRestrictedRoute><TestBoard /></GrcRestrictedRoute>} />
      <Route path="/test-summary" element={<GrcQaRoute><TestSummary /></GrcQaRoute>} />
      <Route path="/bug-summary" element={<GrcQaRoute><BugSummary /></GrcQaRoute>} />
      <Route path="/account" element={<ProtectedRoute><Account /></ProtectedRoute>} />
      <Route path="/workspace" element={<ProtectedRoute><MyWorkspace /></ProtectedRoute>} />
      <Route path="/backlog-summary" element={<ManagerRoute><BacklogSummary /></ManagerRoute>} />
      <Route path="/additional-work" element={<ManagerRoute><AdditionalWork /></ManagerRoute>} />
      <Route path="/blockers" element={<ProtectedRoute><Blockers /></ProtectedRoute>} />
      <Route path="/workload" element={<ManagerRoute><TeamWorkload /></ManagerRoute>} />
      <Route path="/users" element={<ManagerRoute><Users /></ManagerRoute>} />
      <Route path="/audit-logs" element={<ManagerRoute><AuditLogs /></ManagerRoute>} />
      <Route path="/summary" element={<ManagerRoute><SprintSummary /></ManagerRoute>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  );
}

function RouteAwareLongWaitIndicator() {
  const location = useLocation();
  const resetKey = `${location.pathname}${location.search}${location.hash}`;
  const pathname = location.pathname;
  const statusLabel = pathname.startsWith('/tasks')
    ? 'Summoning tasks...'
    : pathname.startsWith('/bugs')
      ? 'Spawning bugs...'
      : pathname.startsWith('/workload')
        ? 'Crafting workload...'
        : 'Loading data...';
  return <LongWaitIndicator resetKey={resetKey} statusLabel={statusLabel} />;
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AnnouncerProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <RouteAwareLongWaitIndicator />
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </AnnouncerProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
