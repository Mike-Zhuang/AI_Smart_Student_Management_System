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