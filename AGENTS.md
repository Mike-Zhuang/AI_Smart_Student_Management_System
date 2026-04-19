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
