import React, { createContext, useContext, useState, useEffect } from 'react';
import { TeamMember } from '@/types';
import { fetchCurrentUser, loginWithCredentials, logoutCurrentUser } from '@/lib/store';

interface AuthContextType {
  user: TeamMember | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  isManager: boolean;
  isQA: boolean;
  ready: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<TeamMember | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const me = await fetchCurrentUser();
        if (me) {
          setUser(me);
        }
      } finally {
        setReady(true);
      }
    };
    bootstrap();
  }, []);

  const login = async (email: string, password: string) => {
    setReady(false);
    const authedUser = await loginWithCredentials(email, password);
    setUser(authedUser);
    setReady(true);
  };

  const logout = async () => {
    await logoutCurrentUser();
    setUser(null);
    setReady(true);
  };

  const refreshUser = async () => {
    const me = await fetchCurrentUser();
    if (me) {
      setUser(me);
    }
  };

  const normalizedRole = (user?.role || '').toLowerCase();
  const isManager = normalizedRole === 'manager' || normalizedRole === 'super admin';
  const isQA = normalizedRole === 'qa';

  return (
    <AuthContext.Provider value={{ user, login, logout, refreshUser, isManager, isQA, ready }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
