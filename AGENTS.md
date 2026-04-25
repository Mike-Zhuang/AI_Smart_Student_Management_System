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
  - 新增 `LICENSE`（双许可证，署名 Sun Jiantong，禁商用）。
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

## 2026-04-16 21:23:42 +0800

- 后端 AI 与权限能力强化：
  - `apps/backend/src/services/zhipu.ts` 支持 `systemPrompt`，统一采用 system+user 消息结构。
  - `apps/backend/src/config/promptTemplates.ts` 增加模板系统指令与变量元信息，覆盖生涯/成长/家校/教研场景。
  - `apps/backend/src/routes/ai.ts` 增加模板变量缺失校验并透传 `systemPrompt`。
  - `apps/backend/src/routes/career.ts` 生涯推荐改为必须真实 AI 生成（无 API Key 不可调用），并加入结构化结果解析。
  - `apps/backend/src/middleware/auth.ts` 与 `apps/backend/src/routes/students.ts` 基于 `parent_student_links`、`teacher_class_links` 落实按关系的数据访问控制。
  - `apps/backend/src/routes/homeSchool.ts`、`apps/backend/src/routes/growth.ts`、`apps/backend/src/routes/teaching.ts` 分别新增 AI 回复草稿、AI 诊断、AI 执行计划接口。
- 后端数据与导入能力扩展：
  - `apps/backend/src/db.ts` 新增关系表并重构 seed，扩充到约 1000 学生规模，完善家长一对多绑定与考试波动趋势数据。
  - `apps/backend/src/routes/dataImport.ts` 新增模板文件下载接口，支持 students/exam-results/teachers。
  - 新增 `apps/backend/templates/teachers-template.csv` 教师班级映射模板。
- 前端交互与角色体验优化：
  - `apps/frontend/src/components/AiLabPanel.tsx` 改为表单化变量输入，支持 API Key 快速复用及图片/文档 URL 多模态输入。
  - `apps/frontend/src/components/CareerPanel.tsx`、`apps/frontend/src/components/GrowthPanel.tsx`、`apps/frontend/src/components/HomeSchoolPanel.tsx`、`apps/frontend/src/components/TeachingPanel.tsx` 增加真实 AI 操作入口并按角色收敛可见能力。
  - `apps/frontend/src/components/DataImportPanel.tsx` 增加三类模板一键下载按钮。
  - `apps/frontend/src/components/AppShell.tsx` 导航命名调整为“AI助手中心”。
  - `apps/frontend/src/lib/export.ts` 新增通用鉴权文件下载工具 `downloadFile`。
- 验证结果：
  - 执行 `npm run build`（后端 `tsc` + 前端 `tsc -b && vite build`）通过。

## 2026-04-17 10:37:12 +0800

- 后端 AI 能力升级与统一：
  - `apps/backend/src/constants.ts` 扩展模型元数据，新增免费/收费标记、结构化输出能力标记、默认模型（免费）与查询函数。
  - `apps/backend/src/services/zhipu.ts` 支持 `response_format`、历史上下文拼装，并补充可读错误分类（鉴权/模型/超时/网络/上游错误）。
  - `apps/backend/src/config/promptTemplates.ts` 新增 `userGuide` 与 `outputFormat`，为模板调用自动匹配文本/结构化输出模式。
  - `apps/backend/src/routes/ai.ts` 重构为会话化路由：
    - 新增会话接口：`GET /api/ai/conversations`、`GET /api/ai/conversations/:id/messages`、`POST /api/ai/conversations`。
    - `POST /api/ai/chat` 与 `POST /api/ai/chat-with-template` 支持 `conversationId` 续聊与历史上下文。
    - 模板列表接口脱敏，不再返回 `systemPrompt` 原文。
  - `apps/backend/src/db.ts` 新增 `chat_sessions`、`chat_messages` 表及索引，并加入 7 天历史自动清理。
  - `apps/backend/src/routes/career.ts`、`apps/backend/src/routes/growth.ts`、`apps/backend/src/routes/homeSchool.ts`、`apps/backend/src/routes/teaching.ts` 改为模型元数据驱动，按模板输出格式自动启用结构化模式并做兼容校验。
- 前端 AI 体验升级：
  - `apps/frontend/src/components/AiLabPanel.tsx` 改造成聊天窗口形态（会话历史 + 消息流 + 输入区），支持上下文续聊与场景切换。
  - 模板说明改为用户友好文案，不展示 `systemPrompt`。
  - AI 输出支持结构化字段渲染，避免向普通用户展示原始 JSON。
  - `apps/frontend/src/components/CareerPanel.tsx`、`apps/frontend/src/components/GrowthPanel.tsx`、`apps/frontend/src/components/HomeSchoolPanel.tsx`、`apps/frontend/src/components/TeachingPanel.tsx` 新增“进入AI聊天”业务入口。
- 输入框越界治理：
  - `apps/frontend/src/styles.css` 全局约束 `textarea` 仅垂直拖拽，限制最小尺寸与最大宽度，修复左右拖出容器的问题。
  - 新增 AI 聊天窗口相关样式，适配桌面与移动端。
- 验证结果：
  - 执行 `npm run build`（后端 + 前端）通过。
  - 使用最小真调用验证：
    - 免费模型 `glm-4.7-flash` 调用成功。
    - 收费模型 `glm-5.1` 调用成功。
    - 模板结构化接口 `chat-with-template` 调用成功并返回 JSON 字符串内容。

## 2026-04-17 10:39:37 +0800

- 模型计费标记修正：
  - `apps/backend/src/constants.ts` 将以下模型统一标记为免费：
    - `glm-4.7-flash`
    - `glm-4.6v-flash`
    - `glm-4.1v-thinking-flash`
    - `glm-4-flash-250414`
    - `glm-4v-flash`
  - 同步补充了原模型列表中缺失的 `glm-4-flash-250414` 与 `glm-4v-flash`，前端模型下拉将可直接获取与展示。

## 2026-04-17 11:00:13 +0800

- 聊天体验与可读性修复：
  - `apps/frontend/src/components/AiLabPanel.tsx` 增加模板后“继续对话”输入区，支持在同一会话内自由追问，不再受模板模式限制。
  - 结构化输出渲染新增字段中文映射（如 `selectedCombination`、`dimensionScores`、`evidenceChain` 等），显著提升用户可读性。
  - 模板说明改为用户友好内容，输出规范 JSON 改为可折叠“高级格式规范”。
  - 新增思考模式开关；若模型返回思考链，前端以小字折叠块“查看思考过程”展示。
  - 模板为结构化输出时，前端自动过滤不支持 JSON 模式的模型，避免用户选到不兼容模型再报错。
  - 修复聊天区对齐：会话列表与消息流统一高度、头部操作区独立布局，解决“新建会话/暂无会话/加载文案”错位问题。
- 后端调用稳定性与思考链透传：
  - `apps/backend/src/services/zhipu.ts` 从仅返回字符串升级为返回 `content + reasoning`，补齐对数组/对象型 `content` 的兼容解析。
  - 增加对思考字段的提取与透传（`reasoning_content/reasoning/thinking`），并优化“仅有思考无最终文本”场景的兜底提示。
  - 按模型与思考模式动态延长超时（GLM-5 + thinking 最高 120s），缓解 `glm-5.1` 超时问题。
  - `apps/backend/src/routes/ai.ts` 将思考链写入会话消息并在会话消息接口回传。
  - `apps/backend/src/db.ts` 为 `chat_messages` 增加 `reasoning_content` 字段，并在初始化阶段对已有库执行平滑迁移。
- 业务路由兼容更新：
  - `apps/backend/src/routes/career.ts`、`apps/backend/src/routes/growth.ts`、`apps/backend/src/routes/homeSchool.ts`、`apps/backend/src/routes/teaching.ts` 适配新网关返回结构。
- 验证结果：
  - `npm run build`（后端 + 前端）通过。
  - 最小真调用回归通过：
    - `glm-4.7-flash` 调用成功，且返回思考链字段。
    - `glm-5.1` 调用成功，且返回思考链字段。
    - 模板接口返回 `requiresJsonMode=true`，前端可据此做模型过滤。

## 2026-04-18 13:16:47 +0800

- 新增 AI 工程方法文档：`docs/how-to-build-with-ai-from-zero.md`。
- 文档内容聚焦“如何从 0 到 1 指挥 AI 生成完整项目”，覆盖：
  - 聊天式 AI 与工程式 AI 的能力差异。
  - Ask/Plan/Agent 模式分工与 Plan 模式实操流程。
  - 需求结构化输入、BigModel 官方文档约束、防幻觉策略。
  - 前端设计规范先行（基于 `DESIGN.md`）与避免模板化审美。
  - 前后端分离与 API 契约先行。
  - GitHub 里程碑提交与私有仓库策略。
  - 可复用的 Plan 输入模板与“指挥 AI 干活”执行清单。

## 2026-04-18 14:18:59 +0800

- 完成服务器 `47.116.199.144` 的 `management-system` 部署主链路（目标端口 `8082`）：
  - 从 `gh-proxy` 拉取公开仓库 `AI_Smart_Student_Management_System` 到 `/opt/management-system`。
  - 服务器端执行 `npm ci` 与 `npm run build`，生成前后端构建产物。
  - 前端静态资源发布到 `/var/www/management-system/frontend/dist`。
- 新增后端系统服务：
  - 创建并启用 `management-system-backend.service`，运行目录 `/opt/management-system/apps/backend`，目标端口 `8002`。
  - 初始化后端环境文件 `/opt/management-system/apps/backend/.env`（含 `PORT=8002` 与 `JWT_SECRET`）。
- 新增 Nginx 站点配置：
  - 写入 `/www/server/panel/vhost/nginx/management-system.conf`，监听 `8082`。
  - 配置 `/api` 反向代理到 `127.0.0.1:8002`，其余请求回退 `index.html`。
- 新增宝塔“网站”记录：
  - 在宝塔 `sites` 中登记 `management-system`，路径 `/var/www/management-system/frontend/dist`。
- 新增宝塔“计划任务”自动同步：
  - 下发 `/usr/local/bin/management-system-sync-deploy.sh`（先验证可用 gitproxy，再拉取/构建/发布/重启）。
  - 增加任务 `ManagementSystem-自动同步部署`（`minute-n` 每 10 分钟，启用 `flock` 防并发）。
- 验收结果：
  - `8080/8081` 现有站点监听保持正常。
  - `8082` 前端页面可访问。
  - 后端 `8002` 处于初始化建库阶段，短时仍可能出现健康检查未就绪。

## 2026-04-18 14:22:16 +0800

- 完成部署终态验收收敛：
  - 后端 `8002` 已开始监听，`GET /health` 返回 `success=true`。
  - 通过公网验证 `http://47.116.199.144:8082` 可访问前端页面。
  - 通过宝塔数据表核验：网站记录 `management-system` 与计划任务 `ManagementSystem-自动同步部署` 均已存在。

## 2026-04-18 14:31:57 +0800

- 登录体验与安全性修复：
  - `apps/frontend/src/pages/LoginPage.tsx` 取消默认预填的 `admin/admin123`，改为首次进入空表单。
  - 登录页与注册页新增密码“显示/隐藏”切换按钮，并补充浏览器自动填充语义（`autoComplete`）。
  - `apps/frontend/src/styles.css` 新增密码输入区与切换按钮样式，兼容现有主题。
- API 请求稳定性增强：
  - `apps/frontend/src/lib/api.ts` 增加 URL 规范化拼接，自动规避 `VITE_API_BASE_URL=/api` 与路径 `/api/...` 叠加导致的双 `/api/api/...` 问题。
  - 增加非 JSON 响应兜底报错，避免前端抛出不友好的底层异常。
- 服务器数据与账号核验：
  - 核验 `47.116.199.144` 的 `app.db`：`students` 当前为 `1001` 条，演示账号（含 `admin`、`teacher_zhang` 等）存在。
  - 通过内网与公网入口分别调用 `POST /api/auth/login`，`admin/admin123` 登录成功。
- 验证结果：
  - 执行 `npm run build -w @ms/frontend` 通过。

## 2026-04-18 14:33:13 +0800

- 线上发布与回归：
  - 将本地最新前端构建产物同步到服务器 `/var/www/management-system/frontend/dist`。
  - 公网验收 `http://47.116.199.144:8082` 返回 `200 OK`。
  - 经公网入口调用 `POST /api/auth/login`，`admin/admin123` 登录成功，确认前后端链路可用。

## 2026-04-18 14:36:14 +0800

- 登录失败紧急修复（线上 CORS / 目标地址错误）：
  - `apps/frontend/src/lib/api.ts` 默认 API 基址从 `http://localhost:4000` 改为同源 `/api`，避免线上浏览器误请求本机 localhost。
  - `apps/frontend/vite.config.ts` 新增本地开发 `/api -> http://localhost:4000` 代理，兼容开发体验。
  - `apps/frontend/src/lib/export.ts` 同步改为同源 `/api` + URL 规范化拼接，避免导出下载接口触发同类跨域错误。
- 验证结果：
  - 本地构建产物中已清除 `localhost:4000` 字符串。
  - 前端产物已重新发布到 `/var/www/management-system/frontend/dist`。
  - 公网回归 `POST http://47.116.199.144:8082/api/auth/login` 返回登录成功。

## 2026-04-18 14:41:18 +0800

- 文档用户体验重构：
  - 重写 `README.md`，以“3分钟快速上手 + 角色说明 + 常见问题”为主线，补充最新部署与登录修复后的使用指引。
  - 重写 `GUIDE.md`，按“首次使用 -> 角色 -> 模块操作 -> 排障”组织，增加可直接执行的步骤与接口对照。
- 重点优化：
  - 强化用户友好性，降低首次使用门槛，避免读者在大量技术细节中迷失。
  - 增加登录/CORS/浏览器扩展报错等高频问题排障路径，提升自助解决效率。

## 2026-04-18 14:43:40 +0800

- 仓库收尾清理与版本同步：
  - 清理本地临时导出文件 `README.pdf`、`GUIDE.pdf`，避免无效产物进入版本库。
  - 将 `docs/how-to-build-with-ai-from-zero.md` 与 `docs/how-to-build-with-ai-from-zero.docx` 纳入版本管理。
  - 统一提交后推送至远程 `main`，确保本地工作区与远端分支状态一致。

## 2026-04-18 23:23:02 +0800

- 启动“14项系统问题”第一批实现（交互止血 + 布局修复）：
  - `apps/backend/src/routes/ai.ts`：模板会话写入从仅记录 `[模板:xxx]` 升级为可追溯摘要，新增模板ID、模板名、模型与变量摘要入库内容，提升会话审计可读性。
  - `apps/frontend/src/components/AiLabPanel.tsx`：拆分“首发提交”和“续聊提交”状态，避免共享 loading 导致交互错乱；新增“无会话禁止续聊”的明确引导提示。
  - `apps/frontend/src/components/HomeSchoolPanel.tsx`：为发送消息、标记已读、请假审核、AI草稿生成补齐 loading 与防重复点击；重构消息卡片层级（标题/状态/正文/动作/时间）。
  - `apps/frontend/src/components/AppShell.tsx`：新增移动端导航开关与遮罩，路由切换后自动关闭抽屉；退出登录时同步收口移动端导航状态。
  - `apps/frontend/src/styles.css`：
    - 桌面端改为“左侧边栏固定 + 右侧主区独立滚动”。
    - 移动端导航改为抽屉式，避免首屏被侧栏占满。
    - 修复聊天续聊区按钮拉伸问题（追问表单改为按钮不拉伸）。
    - 新增家校消息状态胶囊、动作区与元信息样式，提升可读层级。
- 验证结果：
  - 已执行 `npm run build`（后端 `tsc` + 前端 `tsc -b && vite build`）并通过。

## 2026-04-18 23:34:20 +0800

- 完成“14项系统问题”第二批到第四批实现（规则落库 + 账号中心 + AI流式）：
  - `apps/backend/src/utils/subjectRules.ts`：新增黑龙江 3+1+2 规则工具，统一学段、组合合法性、默认学段与组合构建逻辑。
  - `apps/backend/src/db.ts`：
    - 学生表新增 `academic_stage`、`subject_selection_status`、`first_selected_subject`、`second_selected_subject`、`third_selected_subject`。
    - 用户表新增 `phone`、`email`。
    - 教师班级关联表新增 `subject_name`。
    - 初始化流程新增平滑迁移与历史数据归一化，自动修正旧库学段/选课字段。
  - `apps/backend/src/routes/students.ts`：
    - 新增 `GET /api/students/subject-rules`。
    - 学生列表返回学段与选课结构字段。
    - 新增 `PATCH /api/students/:id/subject-selection`，后端强校验学段与3+1+2合法性并审计。
  - `apps/backend/src/routes/career.ts`：
    - 生涯推荐新增学段约束（高一上禁止生成选科推荐）。
    - AI返回组合入库前新增合法性校验与回退策略，避免非法组合落库。
  - `apps/backend/src/routes/auth.ts`：新增账号中心接口
    - `GET /api/auth/me`
    - `PATCH /api/auth/me/profile`
    - `PATCH /api/auth/me/password`
    - 支持角色化资料返回（学生/家长/教师班级信息）并保留审计。
  - `apps/backend/src/services/zhipu.ts`：
    - 新增 reasoning-only 自动降级重试（自动关闭思考模式重试一次）。
    - 新增流式解析能力 `streamZhipu`。
    - 统一错误映射与兜底提示。
  - `apps/backend/src/routes/ai.ts`：新增 SSE 流式接口
    - `POST /api/ai/chat-stream`
    - `POST /api/ai/chat-with-template-stream`
    - 支持会话写入、流式增量事件、完成事件、错误事件和审计记录。
- 前端功能落地：
  - 新增账号中心页面 `apps/frontend/src/components/AccountPanel.tsx`，支持资料编辑、改密、角色化资料展示。
  - `apps/frontend/src/components/AppShell.tsx` 与 `apps/frontend/src/pages/DashboardPage.tsx` 新增“我的账号”导航与路由。
  - `apps/frontend/src/components/CareerPanel.tsx`：新增学段与3+1+2结构化录入、规则拉取与保存接口接入。
  - `apps/frontend/src/components/AiLabPanel.tsx`：新增流式输出开关与SSE增量渲染，支持普通问答和模板问答流式体验。
  - `apps/frontend/src/lib/api.ts`：导出 `resolveApiUrl` 供流式请求复用。
  - `apps/frontend/src/lib/types.ts`：扩展 `User` 类型支持联系方式字段。
- 验证结果：
  - 已执行 `npm run build`（后端 `tsc` + 前端 `tsc -b && vite build`）并通过。

## 2026-04-19 20:41:58 +0800

- 数据导入主流程重构为 CSV 直传（无需手工 JSON 转换）：
  - `apps/backend/src/routes/dataImport.ts` 新增 `multipart/form-data` 上传能力（字段 `file`），支持学生、成绩、教师三类 CSV 导入。
  - 学生/成绩/教师导入统一返回结构化汇总：`total`、`imported`、`updated`、`ignored`、`failed`、`errors`（含行号/字段/原因）。
  - 新增教师导入接口 `POST /api/data-import/teachers`，补齐“三模板下载=三导入入口”的能力一致性。
  - 学生与成绩导入增加重复数据更新策略，不再出现“重复导入看起来没反应”的体验问题。
- 前端导入体验改造：
  - `apps/frontend/src/components/DataImportPanel.tsx` 改为三卡片上传流程（下载模板 -> 选择 CSV -> 上传导入），移除主流程 JSON 大文本输入。
  - 新增上传中防重复点击、单模块独立反馈、错误明细前 8 条可视展示。
  - `apps/frontend/src/lib/api.ts` 调整为自动识别 `FormData`，文件上传不再错误设置 `Content-Type: application/json`。
- 模板与交互样式同步：
  - `apps/backend/templates/teachers-template.csv` 增加 `subjectName` 列并提供示例值。
  - `apps/frontend/src/styles.css` 新增文件上传区样式并修复顶部欢迎栏悬浮遮挡问题（取消 sticky，随页面滚动）。
  - `apps/frontend/src/pages/DashboardPage.tsx` 增加基于角色的路由守卫，防止 URL 直达无权限页面。
- 文档与演示口径同步：
  - 更新 `README.md` 与 `GUIDE.md`：导入流程改为 CSV 直传、补充失败行排障、修正导航项。
  - 更新 `docs/defense-demo-script.md`：修正 pnpm 启动命令为 `pnpm run dev:pnpm`。
- 验证结果：
  - 执行 `npm run build`（后端 `tsc` + 前端 `tsc -b && vite build`）通过。
  - 执行 `pnpm --config.package-manager-strict=false --filter @ms/backend run build` 通过。
  - 执行 `pnpm --config.package-manager-strict=false --filter @ms/frontend run build` 通过。

## 2026-04-19 22:01:51 +0800

- 新导入学生可见性修复（避免“上传成功但下拉看不到”）：
  - `apps/frontend/src/components/CareerPanel.tsx` 取消学生列表 `slice(0, 80)` 截断，改为展示完整列表并按 `id` 倒序（最新导入优先）。
  - `apps/frontend/src/components/GrowthPanel.tsx` 取消学生列表 `slice(0, 60)` 截断，改为展示完整列表并按 `id` 倒序。
- 验证结果：
  - 执行 `npm run build -w @ms/frontend` 通过。

## 2026-04-22 09:56:28 +0800

- 竞赛提交打包准备：
  - 新建 `submit/` 目录并按现有仓库结构复制项目文件，保留前后端源码、部署脚本与说明文档（`README.md`、`GUIDE.md`、`DESIGN.md`、`docs/`、`official_doc/`）。
  - 打包副本中排除非必要提交内容：`.git/`、`AGENTS.md`、`node_modules/`、各类构建产物目录（`dist/build/coverage/.vite`）、本地环境文件（`.env*`）与后端运行时数据库/上传目录。
  - 更新根 `.gitignore`，新增 `submit/` 忽略规则，避免提交过程将打包副本再次纳入版本管理。
- 验证结果：
  - 已检查 `submit/` 中关键文档完整存在且 `AGENTS.md`、`node_modules/` 不存在。

## 2026-04-22 20:12:36 +0800

- 完成 P0 级乱码治理与删除链路止血：
  - `apps/backend/src/utils/text.ts` 重构为统一编码修复流水线，补充 UTF-8 / GBK / GB18030 多候选解码、误解码回推、中文可读性评分、考试名称专项规范化与更多乱码特征识别。
  - `apps/backend/src/routes/dataImport.ts` 将 CSV / XLSX 解析后的列名、单元格、记录值统一接入 `repairText / repairRecordStrings`，成绩数据清理查询也改为走考试名称修复链路。
  - `apps/backend/src/routes/auth.ts`、`apps/backend/src/routes/admin.ts`、相关查询出口补齐乱码修复与系统审计账号过滤，降低历史脏数据直接上屏概率。
- 修复整班级联删除 `FOREIGN KEY constraint failed`：
  - `apps/backend/src/utils/accountMaintenance.ts` 新增系统审计保留账号，删除用户前自动接管 `account_issuance_batches.operator_user_id` 历史引用。
  - `apps/backend/src/routes/students.ts` 调整整班删除统计与事务顺序，新增“保留的历史账号发放批次数”摘要，避免大批量删班时因审计引用导致失败。
- 收口请假流程与全站状态汉化：
  - `apps/backend/src/routes/homeSchool.ts` 将“家长代提交请假”时间线改为直接进入班主任审批，不再显示无意义的待家长确认节点。
  - `apps/frontend/src/lib/labels.ts` 增补通用状态中文映射；`HomeSchoolPanel`、`OverviewPanel`、`AccountPanel` 等页面去除英文状态/角色 fallback。
- 收紧 AI 助手展示边界并优化提示词：
  - `apps/backend/src/routes/ai.ts` 的模板列表接口不再返回 `systemPrompt`、`outputSpec`、`outputFormat` 等内部规则正文，只保留用户说明、变量说明与结构化能力标记。
  - `apps/backend/src/config/promptTemplates.ts` 优化选科、成长、家校等系统提示词，强化结构化输出约束与教师场景表达。
  - `apps/frontend/src/components/AiLabPanel.tsx` 同步改为只依据 `requiresJsonMode` 做模型筛选，不再依赖展示内部格式规范。
- 文档与真实模型联调同步：
  - 更新 `README.md`、`GUIDE.md`，补充乱码治理、整班删除审计保留、家长代提交请假与 AI 提示词隐藏说明。
  - 本地使用一次性智谱 Key 做最小真实联调：`glm-5.1`、`glm-5-turbo` 流式正文/思考/完成事件正常；`glm-4.7-flash` 当前更易触发上游限流。
- 验证结果：
  - 已执行 `npm run build -w @ms/backend` 与 `npm run build -w @ms/frontend` 通过，待文档更新后一并做全量 `npm run build` 复核。

## 2026-04-22 20:26:30 +0800

- 线上登录 P0 紧急修复：
  - 定位公网 `http://47.116.199.144:8082/api/auth/login` 失败原因为 Nginx 到后端的反代链路异常，而非账号密码错误。
  - 排查发现后端服务启动阶段被重维护逻辑拖慢，且 Node 进程仅监听 IPv6，导致 Nginx 代理到 `127.0.0.1:8002` 时出现 `502 Bad Gateway`。
  - `apps/backend/src/db.ts` 将数据库文本修复改为“启动后后台执行 + 版本标记只跑一次”，避免在 `initDatabase()` 阶段阻塞服务端口监听。
  - `apps/backend/src/server.ts` 增加 `HOST` 配置并默认监听 `0.0.0.0`，确保线上 IPv4 反代链路稳定可用。
  - 已重新构建后端、同步 `dist/` 到服务器并重启 `management-system-backend.service`。
- 验证结果：
  - 公网 `POST /api/auth/login` 使用 `admin / admin123` 已返回登录成功。

## 2026-04-22 20:57:26 +0800

- 完成生产数据隔离与 AI 结构化流式修复：
  - `apps/backend/src/db.ts` 新增生产环境演示种子硬禁逻辑，仅在显式 `ENABLE_DEMO_SEED=true` 或非生产环境下允许 `seedDemoData()` 执行。
  - `apps/backend/src/server.ts` 启动日志增加 demo seed 状态输出，便于区分开发环境与生产环境数据策略。
  - `apps/backend/src/services/zhipu.ts` 为所有适用的结构化/长输出模型统一提升 `max_tokens` 策略，不再只针对个别模型单独放宽输出上限。
- 修复选科 AI 暴露 JSON 与流式中断体验：
  - `apps/backend/src/routes/career.ts` 重构选科流式协议，流式阶段改为输出面向老师的友好正文提示，不再直接透传原始 JSON 片段。
  - `apps/backend/src/utils/structuredOutput.ts` 增加结构化错误分类，能区分 `TRUNCATED_OUTPUT`、`INVALID_JSON`、`EMPTY_FINAL_CONTENT`。
  - `apps/frontend/src/components/CareerPanel.tsx` 增加 JSON 外观拦截，完成后优先展示中文结果卡片内容，不再把结构化原文显示给用户。
- 补齐进入模型前的隐式乱码治理：
  - `apps/backend/src/utils/text.ts` 扩展乱码模式识别，并新增 `sanitizeModelInputText` 与内部 `MOJIBAKE_SYSTEM_HINT`，用于模型输入净化和提示词兜底。
  - `apps/backend/src/routes/career.ts`、`apps/backend/src/routes/growth.ts`、`apps/backend/src/routes/homeSchool.ts` 在构造模型输入时统一修复姓名、班级、兴趣、目标、考试名称、学科名与补充信息；若仍疑似乱码，降级为“暂无有效信息”而不再把脏文本直接送给模型。
  - `apps/backend/src/routes/students.ts` 学生列表接口补齐 `repairRecordStrings`，降低前端与 AI 输入继续读取脏文本的概率。
- 文档同步：
  - 更新 `README.md` 与 `GUIDE.md`，补充“同步脚本不覆盖线上数据库、生产环境禁 demo seed、选科流式不再显示 JSON、AI 思考链乱码治理”的说明。

## 2026-04-22 19:57:12 +0800

- 全局 AI 流式调用链路重构：
  - `apps/backend/src/constants.ts` 重建模型能力矩阵，统一使用小写 `model` 字段，并补齐收费/免费、流式、结构化、视觉、思考等能力标签。
  - `apps/backend/src/services/zhipu.ts` 增强 SSE 解析，统一提取 `delta.content`、`delta.reasoning_content`、`usage`、`finish_reason`，并保留 reasoning-only 自动降级重试。
  - `apps/backend/src/routes/ai.ts` 为通用聊天与模板聊天流补齐 `usage` 事件，新增图片上传流式接口 `POST /api/ai/upload-image-chat-stream`，图片仅走内存中转为 data URL，不做永久存储。
- 结构化输出与选科建议稳定性修复：
  - 新增 `apps/backend/src/utils/structuredOutput.ts`，支持 fenced JSON / 裸 JSON / 轻量字段修复，避免半截 JSON 直接导致整条链路报废。
  - `apps/backend/src/routes/career.ts` 改为“边流式展示、边服务端累积、完成后校验并落库”，并兼容 `summary/reasoning`、`majorSuggestions` 等常见模型返回差异。
  - `apps/backend/src/config/promptTemplates.ts` 收紧选科模板输出要求，明确禁止 markdown 包裹和自然语言前后缀。
- 前端 AI 体验统一升级：
  - 新增 `apps/frontend/src/lib/ai.ts` 与 `apps/frontend/src/lib/sse.ts`，统一模型能力类型和共享 SSE 解析器，覆盖多 `data:`、`[DONE]`、reasoning/content 双流及异常兜底。
  - 重写 `apps/frontend/src/components/AiLabPanel.tsx`：默认全流式、模板结构化模型过滤、模型能力中文标签、图片本地上传、聊天区空状态高度修复。
  - `apps/frontend/src/components/CareerPanel.tsx`、`apps/frontend/src/components/GrowthPanel.tsx`、`apps/frontend/src/components/HomeSchoolPanel.tsx` 全部切换为流式展示正文与思考过程。
  - `apps/frontend/src/styles.css` 补充流式聊天区与追问输入区约束，修复空会话时输入框被异常拉长的问题。
- 验证结果：
  - 已执行 `npm run build`（后端 `tsc` + 前端 `tsc -b && vite build`）通过。

## 2026-04-22 18:58:03 +0800

- 完成“真实数据优先”的二轮修复与体验重构：
  - `apps/backend/src/routes/career.ts`、`apps/backend/src/services/zhipu.ts`、`apps/frontend/src/components/CareerPanel.tsx`：
    - 加固选科建议 SSE 流式解析与收尾逻辑，兼容多 `data:` 行、`\r\n`、尾部缓冲与“仅最终结果无 complete”场景。
    - 选科页顶部改为“配置区 + 自由补充信息卡片”双栏工作区，补充生成状态分阶段提示。
  - `apps/backend/src/routes/classSpace.ts`、`apps/frontend/src/components/ClassSpacePanel.tsx`、`apps/frontend/src/components/OrgStructurePanel.tsx`、`apps/frontend/src/pages/DashboardPage.tsx`、`apps/frontend/src/components/AppShell.tsx`：
    - 新增学生/家长/教师/班主任/管理员可见的只读“班级空间”。
    - 组织架构升级为按“年级 -> 班级 -> 学生”逐层折叠，并保留按教师查看跨班任教关系。
    - `/dashboard` 默认重定向到 `/dashboard/overview`，首次进入即可高亮首页导航。
  - `apps/frontend/src/lib/classProfile.ts`、`apps/frontend/src/components/HeadTeacherPanel.tsx`：
    - 班委会、课程表、座位表改为结构化编辑与展示，兼容旧文本数据。
    - 座位表支持按花名册随机排座，班委会不再直接裸露 JSON。
  - `apps/frontend/src/components/ConfirmActionButton.tsx`、`apps/frontend/src/components/DataImportPanel.tsx`、`apps/frontend/src/components/HomeSchoolPanel.tsx`：
    - 全部数据清理入口统一接入二次确认。
    - 新增整班级联删除入口，删除结果按班级维度汇总返回。
  - `apps/backend/src/routes/auth.ts`、`apps/backend/src/routes/dataImport.ts`、`apps/backend/src/routes/students.ts`、`apps/backend/src/utils/accountMaintenance.ts`、`apps/frontend/src/components/AccountPanel.tsx`：
    - 学生导入自动生成主家长账号并写入发放批次。
    - 新增补齐主家长账号与手动追加家长账号能力。
    - 重置密码后前端直接弹出批次下载浮层，不再要求滚动到页面底部寻找。
    - 学生/班级删除链路补齐账号发放记录清理与孤儿家长/教师账号回收。
  - `apps/backend/src/utils/text.ts`、`apps/backend/src/routes/dataImport.ts`：
    - 编码修复升级为多候选解码 + 打分选优，并把考试名称查询纳入乱码清洗与学年规范化。
- 验证结果：
  - 执行 `npm run build` 通过（后端 `tsc` + 前端 `tsc -b && vite build`）。

## 2026-04-22 19:03:04 +0800

- 同步更新用户文档：
  - `README.md`：
    - 补充整班级联删除、班级空间、家长账号自动发放、删除前二次确认、流式选科兜底说明。
    - 更新角色权限描述，明确学生/家长可查看班级空间。
  - `GUIDE.md`：
    - 新增“班级空间”“我的账号”章节，补齐家长账号管理、账号发放批次、重置密码即时下载说明。
    - 更新生涯选科、班级治理、数据导入、组织架构的最新操作路径与界面变化。
    - 补充成绩乱码排障与整班级联删除接口说明。
- 验证结果：
  - 再次执行 `npm run build` 通过（后端 `tsc` + 前端 `tsc -b && vite build`）。

## 2026-04-22 16:53:39 +0800

- 完成“真实校园场景化”重构第一阶段落地：
  - 后端删除教研模块路由与模板，新增 `apps/backend/src/routes/headTeacher.ts` 班级治理接口并在 `server.ts` 挂载 `/api/head-teacher/*`。
  - `apps/backend/src/db.ts` 重构请假流程字段，移除 `teaching_tasks` / `teaching_research`，新增班级日志、心灵驿站、小组评比、班级风采、班级简介等数据表，并加入历史数据库平滑迁移。
  - `apps/backend/src/routes/homeSchool.ts` 改为真实高中请假流程：学生填报、家长确认、班主任审批、返校销假，并补齐批量删除。
  - `apps/backend/src/routes/career.ts` 改为支持 `supplementalContext` 的选科建议生成与 SSE 流式输出；`apps/backend/src/utils/subjectRules.ts` 放开高一上直接选科。
  - `apps/backend/src/routes/dataImport.ts`、`apps/backend/src/utils/text.ts` 完成导入乱码修复、考试名称规范化、成绩/教师关系管理与批量删除接口。
- 前端页面与文案重构：
  - 新增 `apps/frontend/src/lib/labels.ts` 统一中文标签映射，`AppShell.tsx`、`OverviewPanel.tsx` 改成按角色呈现真实首页信息，移除教研导航。
  - `apps/frontend/src/components/HomeSchoolPanel.tsx` 新增真实请假时间线、按角色操作与请假批量删除。
  - `apps/frontend/src/components/CareerPanel.tsx` 改为“生涯发展与选科建议”，支持流式生成、自由补充信息、免费/收费模型标记与高一选科保存。
  - `apps/frontend/src/components/DataImportPanel.tsx` 改为“导入 + 管理 + 清理”，补齐学生、成绩、教师关系的批量删除能力。
  - `apps/frontend/src/components/HeadTeacherPanel.tsx` 升级为“班级治理中心”，新增班级日志、心灵驿站、小组评比、班级风采、班级简介等管理入口，并支持上传内容删除。
  - `apps/frontend/src/components/GrowthPanel.tsx` 修复无成绩时的异常占位，改为明确提示“暂无成绩数据，请先导入成绩”。
- 文档与工程清理：
  - 删除 `apps/frontend/src/components/TeachingPanel.tsx` 与 `apps/backend/src/routes/teaching.ts`。
  - 更新 `README.md`、`GUIDE.md`、`docs/defense-demo-script.md` 的模块口径，改为真实校园使用场景。
- 验证结果：
  - 执行 `npm run build`（后端 `tsc` + 前端 `tsc -b && vite build`）通过。

## 2026-04-22 17:31:09 +0800

- 完成账号发放留存与组织架构能力补齐：
  - 后端新增 `apps/backend/src/utils/accountIssuance.ts`，实现一次性密码加密留存、发放批次创建、未改密账号筛选下载与 Excel 导出。
  - `apps/backend/src/db.ts` 新增 `account_issuance_batches`、`account_issuance_items` 表及索引；`apps/backend/src/utils/text.ts` 将账号发放批次纳入乱码修复覆盖范围。
  - `apps/backend/src/routes/auth.ts` 新增账号发放批次查询/明细/整批下载/按勾选下载接口，并在“修改密码”“重置密码”链路中自动失效旧一次性密码或生成新批次。
  - `apps/backend/src/routes/dataImport.ts` 在学生导入、教师导入后自动写入账号发放批次，返回 `issuanceBatchId` 供前端跳转台账。
  - 新增 `apps/backend/src/routes/orgStructure.ts` 并在 `server.ts` 挂载 `/api/org-structure/*`，支持按班级/按教师查看全校组织关系。
- 前端交互与文档同步：
  - `apps/frontend/src/components/AccountPanel.tsx` 重构为“登录说明 + 账号发放台账 + 批次记录 + 批次明细”组合页，支持筛选待改密账号、批量下载未改密账号、查看单次重置批次。
  - 新增 `apps/frontend/src/components/OrgStructurePanel.tsx`，并在 `AppShell.tsx`、`DashboardPage.tsx` 增加“组织架构”导航与路由。
  - `apps/frontend/src/components/DataImportPanel.tsx` 补充“查看本次发放批次”入口；`apps/frontend/src/lib/export.ts` 新增 POST 下载能力，支持读取下载文件名与跳过数量。
  - 更新 `apps/frontend/src/styles.css`、`README.md`、`GUIDE.md`、`docs/defense-demo-script.md`，同步组织架构与账号发放批次的真实使用说明。

## 2026-04-23 20:41:36 +0800

- 生产级安全基线加固第一轮落地：
  - 后端认证升级为短时 access token + HttpOnly refresh cookie + `auth_sessions` 会话表，新增 `POST /api/auth/refresh`、`POST /api/auth/logout`、`POST /api/auth/logout-all`、`GET /api/auth/session-status`。
  - `apps/backend/src/db.ts` 为 `users` 增加登录风控字段（失败次数、锁定时间、最近登录信息），新增 `risk_challenges` 表并补齐平滑迁移。
  - `apps/backend/src/middleware/auth.ts` 改为会话感知鉴权，校验账号启停、密码重置后旧会话失效，并回写 `last_used_at`。
  - `apps/backend/src/middleware/rateLimit.ts` 重构为分场景限流，覆盖读 / 写 / AI / 上传 / 认证，并增加登录 IP 与 username+IP 双维失败追踪。
  - `apps/backend/src/routes/auth.ts` 新增风险挑战、登录失败锁定、会话轮换、登出、生产环境禁用 `demo-accounts`，同时在改密/重置密码时自动吊销旧会话。
- 文本与上传安全收口：
  - 新增 `apps/backend/src/config/security.ts`、`apps/backend/src/config/sensitiveWords.ts`、`apps/backend/src/utils/contentSafety.ts`、`apps/backend/src/utils/fileSecurity.ts`、`apps/backend/src/utils/sessionAuth.ts`。
  - `apps/backend/src/routes/homeSchool.ts`、`apps/backend/src/routes/headTeacher.ts`、`apps/backend/src/routes/ai.ts`、`apps/backend/src/routes/dataImport.ts` 接入敏感词拦截、输入规范化、上传文件白名单与文件头校验、导入行数/列长限制。
  - `apps/backend/src/routes/admin.ts` 收紧审计查询 `limit` 上限，降低数据枚举滥用风险。
- 前端登录态与安全体验升级：
  - `apps/frontend/src/lib/storage.ts` 将 access token 改为 `sessionStorage` 保存。
  - `apps/frontend/src/lib/api.ts` 重写为统一 `fetchWithAuth` 封装，支持 `401 -> refresh -> 重试 -> 失败清空本地态并跳转登录页`。
  - `apps/frontend/src/lib/export.ts`、`apps/frontend/src/lib/sse.ts` 改为复用统一鉴权链路，下载与 SSE 也支持会话自动恢复。
  - `apps/frontend/src/App.tsx` 启动时先做安全会话恢复；`apps/frontend/src/pages/LoginPage.tsx` 增加风险挑战、蜜罐字段、最短提交耗时与强密码提示；`apps/frontend/src/components/AppShell.tsx` 退出登录改为调用后端登出接口。
  - `apps/frontend/src/components/AccountPanel.tsx` 新增强密码提示；`apps/frontend/index.html` 补充 CSP、Referrer-Policy、Permissions-Policy、X-Frame-Options、COOP 等前端安全头元信息。
- 部署与文档同步：
  - 重写 `apps/backend/.env.example`，补充生产环境所需安全环境变量。
  - 更新 `deploy/nginx.conf.example` 与 `deploy/backend.service.example`，增加 HTTPS 反代、安全响应头、限流示例、代理头与生产环境变量。
  - 更新 `README.md` 与 `GUIDE.md`，补充自动刷新会话、风险挑战、强密码要求与导入安全说明。
- 验证结果：
  - 执行 `npm run build -w @ms/backend` 通过。
  - 执行 `npm run build -w @ms/frontend` 通过。

## 2026-04-23 20:48:31 +0800

- 修复本地调试与开发态白屏问题：
  - 移除 `apps/frontend/index.html` 中通过 `meta` 注入的 CSP、X-Frame-Options、COOP 等安全头，避免开发环境下 Vite 内联样式与资源加载被误拦截；生产安全头继续由后端与 Nginx 通过响应头下发。
  - `apps/backend/src/server.ts` 为端口监听增加显式错误处理，`EADDRINUSE` 时输出中文可读提示，帮助快速定位本地已有旧进程占用 `4000` 端口的问题。
  - `apps/backend/src/routes/auth.ts` 的 `/api/auth/refresh` 增加 refresh token 预校验与异常兜底，避免浏览器残留旧 cookie 或畸形 token 直接打成 500。

## 2026-04-23 21:02:23 +0800

- 修复线上生产环境配置缺失导致的登录 P0 故障，并补齐防再发保护：
  - 远程服务器 `/opt/management-system/apps/backend/.env` 补齐 `ACCESS_TOKEN_SECRET`、`REFRESH_TOKEN_SECRET`、`ACCOUNT_ARCHIVE_SECRET`、`ALLOWED_ORIGINS`、`COOKIE_SECURE` 等关键生产配置，重启 `management-system-backend.service` 后，公网 `admin/admin123` 登录与 `/api/auth/refresh` 实测恢复成功。
  - `apps/backend/src/config/security.ts` 新增生产环境安全配置校验：缺少关键密钥或 `ALLOWED_ORIGINS` 时直接拒绝启动，并对 `COOKIE_SECURE=false` 输出警告，避免服务“看似启动成功、实际登录全废”。
  - `apps/backend/src/server.ts` 启动前接入安全配置校验；`apps/backend/.env.example` 与 `README.md` 同步补充 `http://IP:端口` 场景下 `ALLOWED_ORIGINS` 与 `COOKIE_SECURE` 的正确写法。

## 2026-04-25 15:27:10 +0800

- 修复教师班级关系清理 500 问题：
  - `apps/backend/src/utils/accountMaintenance.ts` 删除教师账号前同步清理 `auth_sessions`、`chat_sessions`，并把 `audit_logs` 与账号发放批次的历史引用转交给“系统审计保留”账号。
  - `apps/backend/src/routes/dataImport.ts` 教师关系批量删除改为按实际命中数量返回，并对外键异常给出中文可读提示。
  - 教师关系管理列表返回前统一执行文本修复，避免历史乱码姓名继续上屏。
- 加强中文乱码修复：
  - `apps/backend/src/utils/text.ts` 增强 UTF-8 被 GBK/GB18030 误读的短姓名识别，覆盖 `鐜嬭开 -> 王迪`，并收紧正常中文的重解码条件。
  - `apps/backend/src/db.ts` 文本维护版本升级到 `2026-04-25-encoding-v3`，线上服务重启后会自动后台重跑历史库文本修复。
  - 新增 `apps/backend/src/utils/text-repair-check.ts` 与 `npm run check:text -w @ms/backend`，覆盖乱码姓名与正常中文不误修的最小校验。
- 修复班级空间图片上传后无法展示：
  - 后端新增 `sharp`，心灵驿站与班级风采图片上传后压缩为 WebP 展示图，最长边 1920px，数据库只保留压缩图路径。
  - `apps/backend/src/routes/classSpace.ts` 新增受权限保护的媒体读取接口，按班级访问权限返回心灵驿站附件和班级风采图片。
  - 前端新增 `AuthenticatedImage` 鉴权图片组件，`ClassSpacePanel` 与 `HeadTeacherPanel` 改为真实图片预览和班级风采缩略图卡片。
  - `README.md`、`GUIDE.md` 同步补充教师关系删除、历史乱码自动维护和图片压缩展示策略。
- 验证结果：
  - 执行 `npm run check:text -w @ms/backend` 通过。
  - 执行 `npm run build -w @ms/backend` 通过。
  - 执行 `npm run build -w @ms/frontend` 通过。

## 2026-04-25 15:38:07 +0800

- 继续收敛 UTF-8 被 GBK/GB18030 误读的短姓名修复：
  - `apps/backend/src/utils/text.ts` 新增 `寮犳垐 -> 张戈`、`寮犱笁 -> 张三` 同类模式识别，并把 UTF-8-as-GBK 误读特征集中到独立规则列表。
  - 收紧候选选择条件：恢复候选必须至少包含 2 个中文字符，且长度不能异常缩短，避免 `寮犱笁` 被错误选成单字候选。
  - `apps/backend/src/db.ts` 文本维护版本升级到 `2026-04-25-encoding-v4`，线上重启后会再次后台修复历史库文本。
  - `apps/backend/src/utils/text-repair-check.ts` 增加 `张戈`、`寮犳垐`、`寮犱笁` 回归样例。
  - `README.md`、`GUIDE.md` 同步补充 `寮犳垐` 乱码示例。
- 验证结果：
  - 执行 `npm run check:text -w @ms/backend` 通过。
  - 执行 `npm run build -w @ms/backend` 通过。
