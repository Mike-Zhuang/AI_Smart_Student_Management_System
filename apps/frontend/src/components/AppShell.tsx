import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { storage } from "../lib/storage";
import type { User } from "../lib/types";

const NAV_ITEMS = [
    { key: "overview", label: "总览", roles: ["admin", "teacher", "head_teacher", "parent", "student"] },
    { key: "home-school", label: "家校沟通", roles: ["admin", "teacher", "head_teacher", "parent", "student"] },
    { key: "career", label: "生涯选课", roles: ["admin", "teacher", "head_teacher", "parent", "student"] },
    { key: "growth", label: "学业成长", roles: ["admin", "teacher", "head_teacher", "parent", "student"] },
    { key: "head-teacher", label: "班主任工作台", roles: ["admin", "head_teacher"] },
    { key: "teaching", label: "教研管理", roles: ["admin", "teacher", "head_teacher"] },
    { key: "ai-lab", label: "智谱模型", roles: ["admin", "teacher", "head_teacher", "parent", "student"] },
    { key: "data-import", label: "数据导入", roles: ["admin", "head_teacher"] }
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

    return (
        <div className="app-layout">
            <aside className="app-sidebar">
                <div className="brand-box">
                    <h1>高中AI管理辅助系统</h1>
                    <p>Management Assistant · Demo</p>
                </div>

                <nav className="nav-list">
                    {NAV_ITEMS.filter((item) => item.roles.includes(user.role)).map((item) => (
                        <NavLink
                            key={item.key}
                            to={`/dashboard/${item.key}`}
                            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                        >
                            {item.label}
                        </NavLink>
                    ))}
                </nav>

                <div className="sidebar-footer">
                    <p>
                        当前角色: <strong>{user.role}</strong>
                    </p>
                    <button
                        className="secondary-btn"
                        onClick={() => {
                            storage.clearAuth();
                            onLogout();
                            navigate("/login");
                        }}
                    >
                        退出登录
                    </button>
                </div>
            </aside>

            <main className="app-main">
                <header className="top-header">
                    <div>
                        <h2>{user.displayName}</h2>
                        <p>欢迎回来，请按模块完成管理与评比演示</p>
                    </div>
                </header>
                {children}
            </main>
        </div>
    );
};
