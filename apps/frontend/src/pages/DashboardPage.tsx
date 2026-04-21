import { useMemo } from "react";
import { Navigate, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { AccountPanel } from "../components/AccountPanel";
import { AiLabPanel } from "../components/AiLabPanel";
import { CareerPanel } from "../components/CareerPanel";
import { DataImportPanel } from "../components/DataImportPanel";
import { GrowthPanel } from "../components/GrowthPanel";
import { HeadTeacherPanel } from "../components/HeadTeacherPanel";
import { HomeSchoolPanel } from "../components/HomeSchoolPanel";
import { OverviewPanel } from "../components/OverviewPanel";
import { TeachingPanel } from "../components/TeachingPanel";
import { useAuth } from "../App";
import type { User } from "../lib/types";

const ALLOWED = ["overview", "home-school", "career", "growth", "head-teacher", "teaching", "ai-lab", "account", "data-import"];

const SECTION_ROLES: Record<string, User["role"][]> = {
    overview: ["admin", "teacher", "head_teacher", "parent", "student"],
    "home-school": ["admin", "teacher", "head_teacher", "parent", "student"],
    career: ["admin", "teacher", "head_teacher", "parent", "student"],
    growth: ["admin", "teacher", "head_teacher", "parent", "student"],
    "head-teacher": ["admin", "head_teacher"],
    teaching: ["admin", "teacher", "head_teacher"],
    "ai-lab": ["admin", "teacher", "head_teacher", "parent", "student"],
    account: ["admin", "teacher", "head_teacher", "parent", "student"],
    "data-import": ["admin", "teacher", "head_teacher"]
};

export const DashboardPage = () => {
    const { user, setUser } = useAuth();
    const params = useParams<{ section?: string }>();
    const section = params.section ?? "overview";

    const content = useMemo(() => {
        switch (section) {
            case "home-school":
                return <HomeSchoolPanel user={user!} />;
            case "career":
                return <CareerPanel user={user!} />;
            case "growth":
                return <GrowthPanel user={user!} />;
            case "head-teacher":
                return <HeadTeacherPanel />;
            case "teaching":
                return <TeachingPanel user={user!} />;
            case "ai-lab":
                return <AiLabPanel />;
            case "account":
                return <AccountPanel />;
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

    const allowedSectionsForRole = ALLOWED.filter((item) => SECTION_ROLES[item]?.includes(user.role));
    if (!allowedSectionsForRole.includes(section)) {
        const fallback = allowedSectionsForRole[0] ?? "overview";
        return <Navigate to={`/dashboard/${fallback}`} replace />;
    }

    return (
        <AppShell user={user} onLogout={() => setUser(null)}>
            {content}
        </AppShell>
    );
};
