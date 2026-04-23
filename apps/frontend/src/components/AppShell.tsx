import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { roleHomeMessageMap, roleLabelMap } from "../lib/labels";
import { storage } from "../lib/storage";
import type { User } from "../lib/types";
import { SiteFooter } from "./SiteFooter";

const NAV_ITEMS = [
    { key: "overview", label: "首页", roles: ["admin", "teacher", "head_teacher", "parent", "student"] },
    { key: "class-space", label: "班级空间", roles: ["admin", "teacher", "head_teacher", "parent", "student"] },
    { key: "home-school", label: "家校沟通", roles: ["admin", "teacher", "head_teacher", "parent", "student"] },
    { key: "career", label: "生涯发展与选科", roles: ["admin", "teacher", "head_teacher", "parent", "student"] },
    { key: "growth", label: "学业成长", roles: ["admin", "teacher", "head_teacher", "parent", "student"] },
    { key: "head-teacher", label: "班级治理中心", roles: ["admin", "head_teacher"] },
    { key: "org-structure", label: "组织架构", roles: ["admin", "teacher", "head_teacher"] },
    { key: "ai-lab", label: "AI助手中心", roles: ["admin", "teacher", "head_teacher", "parent", "student"] },
    { key: "account", label: "我的账号", roles: ["admin", "teacher", "head_teacher", "parent", "student"] },
    { key: "data-import", label: "数据导入", roles: ["admin", "teacher", "head_teacher"] }
];

export const AppShell = ({
    user,
    onLogout,
    children
}: {
    user: User;
    onLogout: () => void;
    children: ReactNode;
}) => {
    const navigate = useNavigate();
    const location = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);

    useEffect(() => {
        setMobileNavOpen(false);
    }, [location.pathname]);

    return (
        <div className={`app-layout ${mobileNavOpen ? "mobile-nav-open" : ""}`}>
            <aside className={`app-sidebar ${mobileNavOpen ? "open" : ""}`}>
                <div className="brand-box">
                    <h1>高中管理协同平台</h1>
                    <p>面向真实校园日常管理与协同</p>
                </div>

                <nav className="nav-list">
                    {NAV_ITEMS.filter((item) => item.roles.includes(user.role)).map((item) => (
                        <NavLink
                            key={item.key}
                            to={`/dashboard/${item.key}`}
                            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                            onClick={() => setMobileNavOpen(false)}
                        >
                            {item.label}
                        </NavLink>
                    ))}
                </nav>

                <div className="sidebar-footer">
                    <p>
                        当前身份: <strong>{roleLabelMap[user.role]}</strong>
                    </p>
                    <button
                        className="secondary-btn"
                        onClick={() => {
                            setMobileNavOpen(false);
                            void (async () => {
                                try {
                                    await apiRequest("/api/auth/logout", { method: "POST" });
                                } catch {
                                    // 忽略退出阶段网络波动，优先清理本地状态
                                } finally {
                                    storage.clearAuth();
                                    onLogout();
                                    navigate("/login");
                                }
                            })();
                        }}
                    >
                        退出登录
                    </button>
                </div>
            </aside>

            <button
                type="button"
                className={`sidebar-backdrop ${mobileNavOpen ? "show" : ""}`}
                aria-hidden={!mobileNavOpen}
                aria-label="关闭导航"
                onClick={() => setMobileNavOpen(false)}
            />

            <main className="app-main">
                <div className="app-main-content">
                    <header className="top-header">
                        <button
                            type="button"
                            className="mobile-nav-toggle"
                            onClick={() => setMobileNavOpen((prev) => !prev)}
                        >
                            {mobileNavOpen ? "关闭菜单" : "打开菜单"}
                        </button>
                        <div>
                            <h2>{user.displayName}</h2>
                            <p>{roleHomeMessageMap[user.role]}</p>
                        </div>
                    </header>
                    {children}
                </div>
                <SiteFooter />
            </main>
        </div>
    );
};
