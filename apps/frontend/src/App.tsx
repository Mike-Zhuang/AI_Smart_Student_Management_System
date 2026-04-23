import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { bootstrapAuthSession } from "./lib/api";
import type { User } from "./lib/types";
import { storage } from "./lib/storage";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";

type AuthContextValue = {
  user: User | null;
  setUser: (user: User | null) => void;
};

const authContext = createContext<AuthContextValue>({
  user: null,
  setUser: () => undefined
});

export const useAuth = () => useContext(authContext);

const AuthProvider = ({ children, value }: { children: ReactNode; value: AuthContextValue }) => {
  return <authContext.Provider value={value}>{children}</authContext.Provider>;
};

function App() {
  const [user, setUserState] = useState<User | null>(storage.getUser());
  const [initializing, setInitializing] = useState(true);

  const setUser = (next: User | null): void => {
    setUserState(next);
    if (next) {
      storage.setUser(next);
    } else {
      storage.clearAuth();
    }
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      const nextUser = await bootstrapAuthSession();
      if (!active) {
        return;
      }
      setUserState(nextUser);
      setInitializing(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(() => ({ user, setUser }), [user]);

  if (initializing) {
    return <div className="auth-page"><div className="auth-card"><h1>正在校验登录状态</h1><p>请稍候，系统正在恢复安全会话。</p></div></div>;
  }

  return (
    <AuthProvider value={value}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/dashboard/:section?"
          element={user ? <DashboardPage /> : <Navigate to="/login" replace />}
        />
        <Route path="*" element={<Navigate to={user ? "/dashboard" : "/login"} replace />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
