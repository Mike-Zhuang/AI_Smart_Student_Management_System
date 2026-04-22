# GUIDE

本文件是面向使用者的操作手册。

如果你是第一次使用，建议先按第 1 节到第 3 节走一遍，再进入对应模块。

## 1. 首次使用（5 分钟）

### 1.1 访问系统

线上地址：

- http://47.116.199.144:8082

本地开发地址：

- 前端：http://localhost:3000
- 后端：http://localhost:4000

### 1.2 登录账号

推荐先使用管理员账号完整体验：

- admin / admin123

首次进入登录页说明：

- 默认不再自动填充账号密码
- 支持密码显示/隐藏切换
- 不开放公开注册，账号由后台统一发放
- 若是通过导入生成的新账号，可在“我的账号 → 账号发放台账”查看登录账号、历史批次与未改密账号的再次下载入口

### 1.3 快速体验路径（建议）

1. 首页查看当前角色待办与学生规模
2. 家校沟通发一条通知并查看回执
3. 生涯发展与选科生成一次建议并查看可解释面板
4. 学业成长查看趋势图与预警
5. 班级治理中心记录班级日志或小组积分
6. 班级空间查看课程表、座位表、班委会与班级风采
7. 组织架构查看班级、班主任、科任教师与花名册
8. AI 助手中心用模板发起一次场景分析
9. 数据导入页面查看导入结果并演示批量删除

## 2. 角色说明

### 2.1 管理员 admin

- 全部模块可见
- 可查看审计日志并导出证据包

### 2.2 教师 teacher

- 家校沟通、生涯发展与选科、学业成长、组织架构、AI 助手中心

### 2.3 班主任 head_teacher

- 教师权限 + 班级治理中心 + 请假审批 + 更完整班级治理视图 + 组织架构

### 2.4 家长 parent

- 家校沟通、学业成长（关联学生）、班级空间、AI 助手中心

### 2.5 学生 student

- 个人相关学习视图、班级空间与 AI 助手功能

## 3. 页面与导航

左侧菜单默认包含：

1. 首页
2. 家校沟通
3. 生涯发展与选科
4. 学业成长
5. 班级空间
6. 班级治理中心（仅管理员/班主任）
7. 组织架构（管理员/班主任/教师）
8. AI 助手中心
9. 我的账号
10. 数据导入（管理员/班主任/教师）

页面行为说明：

- 桌面端为“左侧固定导航 + 右侧内容滚动”。
- 顶部欢迎信息会跟随页面滚动，不会悬浮遮挡正文。
- 移动端导航为抽屉式，点击遮罩或切换路由会自动关闭。

## 4. 模块操作指南

## 4.1 首页

你会看到：

- 当前角色的欢迎信息与待办提示
- 学生规模、请假待办与最近学生摘要
- 管理员可见全校运行统计

常用接口：

- GET /api/admin/system-overview
- GET /api/students

## 4.2 家校沟通

推荐操作顺序：

1. 发送消息
2. 查看消息列表
3. 标记已读回执
4. 按“学生填报 → 家长确认 → 班主任审批 → 返校销假”查看请假流程
5. 导出消息与请假记录
6. 班主任或管理员按需批量删除错误请假数据

常用接口：

- GET /api/home-school/messages
- POST /api/home-school/messages
- PATCH /api/home-school/messages/:id/read
- GET /api/home-school/leave-requests
- PATCH /api/home-school/leave-requests/:id/parent-confirm
- PATCH /api/home-school/leave-requests/:id/review
- PATCH /api/home-school/leave-requests/:id/complete
- POST /api/home-school/leave-requests/batch-delete

## 4.3 生涯发展与选科

推荐操作顺序：

1. 选择学生
2. 选择模型并填写 API Key
3. 补充自由背景信息并点击生成建议
4. 查看推荐历史
5. 查看可解释面板（维度分、证据链、反事实）
6. 保存选科确认并导出推荐记录

界面说明：

- 左侧是学生、模型、API Key、当前选科确认与操作按钮
- 右侧是“自由补充信息”重点输入卡片，适合补充家庭期望、兴趣变化、老师观察、竞赛经历、身体情况等背景
- 生成过程会分成“连接中 / 流式生成中 / 整理结果中”三个阶段提示
- 即使模型只有最终结果、几乎没有中间增量，系统也会尽量完成落库并刷新建议历史

常用接口：

- POST /api/career/recommendations/generate
- POST /api/career/recommendations/generate-stream
- GET /api/career/recommendations/:studentId
- GET /api/career/public-data/major-requirements

## 4.4 学业成长

推荐操作顺序：

1. 选择学生
2. 查看成长画像与风险等级
3. 查看考试趋势图
4. 查看预警记录
5. 需要时跳转 AI 助手做诊断

常用接口：

- GET /api/growth/students/:studentId/profile
- GET /api/growth/students/:studentId/trends
- GET /api/growth/students/:studentId/alerts

## 4.5 班级治理中心

推荐操作顺序：

1. 查看当前班级待办漏斗与重点关注学生
2. 新增成长记录 / 班级日志
3. 发布心灵驿站内容并支持附件上传与删除
4. 记录小组积分并查看排行榜
5. 上传班级风采照片或资料并维护班级简介

班级简介编辑说明：

- `课程表`：可先选择行列数，再自动生成表格逐格填写
- `座位表`：可先生成表格，再按花名册一键随机排座，随后继续手动微调
- `班委会`：若历史内容是 JSON，系统会自动解析成“职务 / 姓名”表格，不再直接暴露原始 JSON

常用接口：

- GET /api/head-teacher/workbench
- GET/PATCH /api/head-teacher/class-profile
- GET/POST/DELETE /api/head-teacher/class-logs
- GET/POST/DELETE /api/head-teacher/wellbeing-posts
- GET/POST/DELETE /api/head-teacher/group-score-records
- GET/POST/DELETE /api/head-teacher/gallery

## 4.6 班级空间

适用角色：学生、家长、教师、班主任、管理员

可查看内容：

- 班风、班训、口号、班级公约
- 课程表
- 座位表
- 班委会
- 班级花名册
- 心灵驿站
- 班级风采

使用说明：

- 学生默认查看自己所在班级
- 家长默认查看已绑定学生所在班级；若绑定多个孩子，可切换班级
- 教师、班主任、管理员可切换查看自己有权限访问的班级
- 班级空间是只读页面，编辑仍在“班级治理中心”中完成

常用接口：

- GET /api/class-space/overview
- GET /api/class-space/detail?className=...

## 4.7 AI 助手中心

推荐操作顺序：

1. 输入 API Key（仅本地浏览器保存）
2. 选择模型
3. 选择业务场景模板
4. 填写模板变量或自定义提示词
5. 发送后在同一会话继续追问
6. 结构化输出会自动转成易读字段

说明：

- 模板模式会根据输出类型自动筛选兼容模型
- 若模型返回思考链，可在界面折叠查看

常用接口：

- GET /api/ai/models
- GET /api/ai/prompt-templates
- GET /api/ai/conversations
- POST /api/ai/chat
- POST /api/ai/chat-with-template

## 4.8 数据导入

建议先做小样本导入再全量导入。

操作建议：

1. 下载对应 XLSX 模板（学生/成绩/教师班级）
2. 在模板中按列填写数据并保存为 XLSX；如有需要也可继续上传 CSV
3. 在页面选择 XLSX / CSV 文件并点击“上传导入”
4. 查看导入汇总（总行数、新增、更新、失败）
5. 若系统自动发放了新账号，立即下载账号发放单
6. 若本次错过下载，可跳转到“我的账号”查看本次发放批次并再次下载未改密账号
7. 若存在失败行，按行号与字段提示修正后重传
8. 若导入有误，可在同页批量删除学生、成绩、教师关系，或直接执行整班级联删除

模板文件：

- apps/backend/templates/students-template.csv
- apps/backend/templates/exam-results-template.csv
- apps/backend/templates/teachers-template.csv

常用接口：

- POST /api/data-import/students（`multipart/form-data`，字段名 `file`）
- POST /api/data-import/exam-results（`multipart/form-data`，字段名 `file`）
- POST /api/data-import/teachers（`multipart/form-data`，字段名 `file`）
- GET /api/data-import/exam-results/manage
- POST /api/data-import/exam-results/batch-delete
- GET /api/data-import/teachers/manage
- POST /api/data-import/teachers/batch-delete
- POST /api/students/batch-delete
- POST /api/students/classes/batch-delete

说明：

- 导入页面默认不展示 JSON 编辑框，避免手工转换成本。
- 重复导入同一批数据会按业务键做更新，不会表现为“点了没反应”。
- 系统兼容 UTF-8 / GBK / GB18030 CSV 与 XLSX。
- 学生导入会自动同步学生账号并生成主家长账号；教师导入会自动同步教师账号。
- 学生、教师导入以及手动重置密码都会进入账号发放批次记录，便于后续追溯。
- 已自行修改密码的账号会自动从再次下载名单中剔除，避免旧密码继续流转。
- 所有删除入口都必须先确认，避免误触。

## 4.9 组织架构

适用角色：管理员、班主任、教师

你可以看到：

- 全校班级总数、教师总数、班主任人数、学生总数
- 按班级视图查看每个班的班主任、科任教师、学生花名册
- 按教师视图查看某位老师所教的全部班级，以及是否兼任班主任

推荐操作顺序：

1. 先展开年级，再逐层展开班级查看学生名单
2. 使用“展开本年级全部学生”快速核对一个年级的花名册
3. 再切到“按教师看”确认老师是否跨多个班任教
4. 若发现“待完善”，回到数据导入或班级治理补齐主数据

## 4.10 我的账号

适用角色：全部角色（其中账号发放管理仅管理员 / 班主任 / 教师可见）

你可以做什么：

- 查看自己的登录账号、登录入口和角色资料
- 修改个人资料与密码
- 查看账号发放台账、批次记录与未改密账号下载
- 补齐尚未生成主家长账号的学生
- 为同一学生继续追加第 2、第 3 个家长账号
- 重置密码后直接在弹层中下载新密码，无需滚动到页面底部寻找

常用接口：

- GET /api/auth/me
- PATCH /api/auth/me/profile
- PATCH /api/auth/me/password
- GET /api/auth/accounts
- GET /api/auth/account-issuance-batches
- GET /api/auth/account-issuance-batches/:batchId
- POST /api/auth/account-issuance-batches/:batchId/download
- POST /api/auth/account-issuance-items/download
- POST /api/auth/accounts/:id/reset-password
- POST /api/auth/parent-accounts
- POST /api/auth/parent-accounts/batch-generate

## 5. 校内汇报建议

推荐向学校汇报以下闭环：

1. 登录并展示角色化导航与首页待办
2. 家校通知与真实请假流转
3. 选科建议的流式生成与可解释结果
4. 班级治理内容维护与数据导入回滚
5. 班级空间与学生/家长共享查看

## 6. 常见问题与排障

### 6.1 登录失败：无法连接服务器

请按顺序检查：

1. 是否访问正确地址 http://47.116.199.144:8082
2. 浏览器请求是否指向 /api（而非 localhost:4000）
3. 后端健康检查是否返回 success

### 6.2 控制台提示 runtime.connect 错误

一般是浏览器扩展引发，与系统后端无关。处理方式：

1. 用无痕模式重试
2. 暂时禁用扩展重试

### 6.3 页面提示 The string did not match the expected pattern

通常是浏览器对输入格式或跨域请求触发的底层报错，请优先检查：

1. 登录页是否已更新为最新版本
2. 前端是否仍缓存旧 JS
3. 网络请求是否返回了非 JSON 异常页

### 6.4 AI 调用失败

请检查：

1. API Key 是否有效
2. 模型是否支持当前模板输出类型
3. 网络是否可访问智谱服务

### 6.5 数据导入失败

请按顺序检查：

1. 当前账号是否为 admin 或 head_teacher
2. 上传文件是否为 CSV，且列名与模板一致
3. 错误提示中的行号和字段是否已修正
4. 先用 1-3 行小样本上传验证，再导入全量数据

### 6.6 成绩列表或考试名称出现乱码

当前系统已经对导入和查询统一做了编码修复，但若你仍看到 `锟斤拷`、`�`、异常学年名称，请按下面顺序排查：

1. 优先使用系统提供的 XLSX 模板重新导入
2. 若必须使用 CSV，确认源文件编码为 UTF-8、GBK 或 GB18030 之一
3. 回到“数据导入 -> 成绩数据清理”刷新列表，确认是否已被系统自动修复
4. 若仍异常，再导出少量样本定位具体源文件问题

## 7. 附录：关键接口清单

认证与用户：

- POST /api/auth/login
- POST /api/auth/register
- GET /api/auth/accounts
- POST /api/auth/accounts/:id/reset-password
- POST /api/auth/parent-accounts
- POST /api/auth/parent-accounts/batch-generate

导出与审计：

- GET /api/admin/audit-logs
- GET /api/admin/export/audit-logs
- GET /api/admin/export/module/:module
- GET /api/admin/export/evidence-report
