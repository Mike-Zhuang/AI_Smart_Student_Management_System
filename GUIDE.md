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

### 1.3 快速演示路径（建议）

1. 总览看学生规模与系统状态
2. 家校沟通发一条通知并查看回执
3. 生涯选课生成一次推荐并看可解释面板
4. 学业成长查看趋势图与预警
5. 教研管理新增任务并查看统计
6. AI 助手中心用模板发起一次场景分析
7. 导出审计日志或证据包

## 2. 角色说明

### 2.1 管理员 admin

- 全部模块可见
- 可查看审计日志并导出证据包

### 2.2 教师 teacher

- 家校沟通、生涯选课、学业成长、教研管理、AI 助手中心

### 2.3 班主任 head_teacher

- 教师权限 + 班主任工作台 + 更完整班级治理视图

### 2.4 家长 parent

- 家校沟通、学业成长（关联学生）、AI 助手中心

### 2.5 学生 student

- 个人相关学习视图与 AI 助手功能

## 3. 页面与导航

左侧菜单默认包含：

1. 总览
2. 家校沟通
3. 生涯选课
4. 学业成长
5. 班主任工作台（仅管理员/班主任）
6. 教研管理（教师相关角色）
7. AI 助手中心
8. 数据导入（管理员/班主任）

## 4. 模块操作指南

## 4.1 总览

你会看到：

- 当前角色与欢迎信息
- 学生规模与关键统计
- 管理员可见导出入口（审计/证据包）

常用接口：

- GET /api/admin/system-overview
- GET /api/students

## 4.2 家校沟通

推荐操作顺序：

1. 发送消息
2. 查看消息列表
3. 标记已读回执
4. 查看或审批请假
5. 导出消息与请假记录

常用接口：

- GET /api/home-school/messages
- POST /api/home-school/messages
- PATCH /api/home-school/messages/:id/read
- GET /api/home-school/leave-requests
- PATCH /api/home-school/leave-requests/:id/review

## 4.3 生涯选课

推荐操作顺序：

1. 选择学生
2. 选择模型并填写 API Key
3. 点击生成建议
4. 查看推荐历史
5. 查看可解释面板（维度分、证据链、反事实）
6. 导出推荐记录

常用接口：

- POST /api/career/recommendations/generate
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

## 4.5 教学教研管理

推荐操作顺序：

1. 新建任务（备课/教研/沟通/培训）
2. 查看任务状态与截止时间
3. 查看教研成果与绩效统计
4. 导出任务记录用于评比材料

常用接口：

- GET /api/teaching/tasks
- POST /api/teaching/tasks
- GET /api/teaching/research
- GET /api/teaching/analytics

## 4.6 班主任工作台

推荐操作顺序：

1. 选择班级
2. 查看待办漏斗（请假、预警、回执、任务）
3. 查看风险学生清单
4. 查看最近审计轨迹
5. 导出证据包

常用接口：

- GET /api/teaching/head-teacher/workbench
- GET /api/admin/export/evidence-report

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

1. 下载模板并按字段整理数据
2. 先导入 10 条以内验证格式
3. 再执行批量导入
4. 导入后抽样核对页面显示

模板文件：

- apps/backend/templates/students-template.csv
- apps/backend/templates/exam-results-template.csv
- apps/backend/templates/teachers-template.csv

常用接口：

- POST /api/data-import/students
- POST /api/data-import/exam-results
- POST /api/data-import/teachers

## 5. 评比演示建议

推荐在 8 分钟内演示以下闭环：

1. 登录并展示角色化导航
2. 业务数据查询与 AI 辅助决策
3. 管理动作（审批、任务、预警）
4. 审计日志与证据导出

详细脚本见 docs/defense-demo-script.md。

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

## 7. 附录：关键接口清单

认证与用户：

- POST /api/auth/login
- POST /api/auth/register
- GET /api/auth/demo-accounts

导出与审计：

- GET /api/admin/audit-logs
- GET /api/admin/export/audit-logs
- GET /api/admin/export/module/:module
- GET /api/admin/export/evidence-report
