import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { User } from "./lib/types";
import { storage } from "./lib/storage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
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

  const setUser = (next: User | null): void => {
    setUserState(next);
    if (next) {
      storage.setUser(next);
    } else {
      storage.clearAuth();
    }
  };

  const value = useMemo(() => ({ user, setUser }), [user]);

  return (
    <AuthProvider value={value}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
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
