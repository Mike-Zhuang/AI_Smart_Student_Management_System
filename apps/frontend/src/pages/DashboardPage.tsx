import { useMemo } from "react";
import { Navigate, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { AiLabPanel } from "../components/AiLabPanel";
import { CareerPanel } from "../components/CareerPanel";
import { DataImportPanel } from "../components/DataImportPanel";
import { GrowthPanel } from "../components/GrowthPanel";
import { HomeSchoolPanel } from "../components/HomeSchoolPanel";
import { OverviewPanel } from "../components/OverviewPanel";
import { TeachingPanel } from "../components/TeachingPanel";
import { useAuth } from "../App";

const ALLOWED = ["overview", "home-school", "career", "growth", "teaching", "ai-lab", "data-import"];

export const DashboardPage = () => {
  const { user, setUser } = useAuth();
  const params = useParams<{ section?: string }>();
  const section = params.section ?? "overview";

  const content = useMemo(() => {
    switch (section) {
      case "home-school":
        return <HomeSchoolPanel />;
      case "career":
        return <CareerPanel />;
      case "growth":
        return <GrowthPanel user={user!} />;
      case "teaching":
        return <TeachingPanel />;
      case "ai-lab":
        return <AiLabPanel />;
      case "data-import":
        return <DataImportPanel />;
      default:
        return <OverviewPanel user={user!} />;
    }
  }, [section, user]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!ALLOWED.includes(section)) {
    return <Navigate to="/dashboard/overview" replace />;
  }

  return (
    <AppShell user={user} onLogout={() => setUser(null)}>
      {content}
    </AppShell>
  );
};
