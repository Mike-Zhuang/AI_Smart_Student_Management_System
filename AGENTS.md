每次做出更改都需要维护这个文件，需要有时间戳标记和更改内容

## 2026-04-16 19:28:47 +0800

- 初始化前后端分离工程结构：`apps/backend`、`apps/frontend`、`deploy`、`docs`。
- 后端完成 Node.js + Express + TypeScript 主体实现：
	- SQLite 数据层与自动建表/演示数据初始化。
	- 账号认证（JWT）、邀请码注册、RBAC 角色权限。
	- 四大业务模块 API：家校沟通、生涯选课、学业成长、教学教研。
	- 智谱模型网关与模型列表接口（GLM-4.7-Flash / GLM-4.1V-Thinking-Flash / GLM-4.6V-Flash）。
	- 数据导入接口与模板（学生、成绩）。
- 前端完成 React + TypeScript + Vite 主体实现：
	- 登录/注册、角色化导航与多页面模块视图。
	- 四大系统功能页面与交互（消息、请假、选科推荐、成长趋势、教研任务）。
	- 智谱 API Key 输入与模型切换调用界面。
	- 数据导入页面（面向后期真实数据替换）。
	- 按 `DESIGN.md` 落地暖色视觉主题、排版层级与响应式样式。
- 完成项目交付文档与治理：
	- 完善 `README.md`。
	- 新增 `GUIDE.md`（前端功能详细说明）。
	- 新增 `LICENSE`（双许可证，署名 Zhuang Chengbo，禁商用）。
	- 新增 `.gitignore`。
	- 新增评比与 AI 标识文档：`docs/evaluation-checklist.md`、`docs/ai-generated-content-policy.md`。
	- 新增裸机部署示例：`deploy/nginx.conf.example`、`deploy/backend.service.example`、`deploy/deploy.sh`。

## 2026-04-16 19:37:33 +0800

- 修复构建阶段 TypeScript 问题：
	- 新增 `@types/better-sqlite3` 以消除数据库模块类型缺失。
	- 调整家校沟通路由中的角色判断写法以满足类型约束。
- 完成工程级验证：
	- `npm install` 成功。
	- `npm run build`（后端+前端）成功。
	- 后端启动并通过健康检查 `GET /health`。

## 2026-04-16 20:09:18 +0800

- 增强工程化与本地调试能力：
	- 新增 `.vscode/launch.json`、`.vscode/tasks.json`、`.vscode/extensions.json`、`.vscode/settings.json`，支持本地全栈调试且不自动启动浏览器。
	- 新增 `pnpm-workspace.yaml`，并更新根 `package.json` 与 `deploy/deploy.sh` 以实现 npm/pnpm 双支持。
	- 移除 `.npmrc` 中与 npm 不兼容的配置，避免 npm 构建阶段告警干扰。
- 后端新增“导出与审计”能力并补全业务审计：
	- 新增 `audit_logs` 表与工具：`apps/backend/src/utils/audit.ts`、`apps/backend/src/utils/export.ts`。
	- `apps/backend/src/routes/admin.ts` 新增审计查询、按模块导出、评比证据包导出接口。
	- 在认证、家校、选课、教研、导入、AI 路由补充关键操作审计埋点。
	- 新增班主任工作台接口：`GET /api/teaching/head-teacher/workbench`。
- 后端新增预置提示词模板系统：
	- 新增 `apps/backend/src/config/promptTemplates.ts`。
	- `apps/backend/src/routes/ai.ts` 新增模板列表与模板调用接口（`/prompt-templates`、`/chat-with-template`）。
- 前端补齐深层业务流程与导出入口：
	- 新增班主任工作台组件 `apps/frontend/src/components/HeadTeacherPanel.tsx`。
	- 生涯选课页新增可解释面板（维度分、证据链、反事实）与推荐导出。
	- 家校沟通页新增已读回执操作与消息/请假导出。
	- 教研页、总览页新增任务/审计/证据包导出。
	- AI 实验室新增场景模板选择、变量 JSON 输入、模板说明展示。
- 文档交付完善：
	- 新增 `docs/defense-demo-script.md`（8分钟答辩讲稿 + 操作清单 + 证据导出清单）。
	- 更新 `README.md` 与 `GUIDE.md`，同步记录新能力与接口。
- 验证结果：
	- 执行 `npm run build`，后端 TypeScript 与前端 Vite 构建通过。