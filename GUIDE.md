# GUIDE

本文件是前端与评比演示的详细使用说明（区别于 README 的总览）。

## 1. 登录与身份

### 1.1 登录

1. 打开前端地址 `http://localhost:3000`
2. 进入登录页
3. 输入演示账号（见 README）
4. 登录后进入总览页

### 1.2 邀请码注册

1. 点击登录页“邀请码注册”
2. 填写用户名、显示名、密码、邀请码
3. 家长/学生可填写学号绑定（可选）
4. 注册后自动登录

## 2. 系统导航

左侧导航包含以下模块：

1. 总览
2. 家校沟通
3. 生涯选课
4. 学业成长
5. 教研管理
6. 智谱模型
7. 数据导入

## 3. 模块详解

## 3.1 总览

目标：快速展示系统运行状态。

功能：

- 展示当前角色
- 展示学生规模
- 管理员可查看账号角色分布与消息总量

实现来源：

- `/api/admin/system-overview`
- `/api/students`

## 3.2 家校沟通

目标：实现消息传达、请假审批、闭环沟通。

功能：

1. 消息发送
- 选择接收角色（家长/学生/教师/班主任）
- 填写标题与正文并发送

2. 消息查看
- 按角色权限查看最新消息
- 显示发送人和发送时间

3. 请假审批
- 查看请假记录
- 执行同意/驳回

实现来源：

- `GET /api/home-school/messages`
- `POST /api/home-school/messages`
- `GET /api/home-school/leave-requests`
- `PATCH /api/home-school/leave-requests/:id/review`

## 3.3 生涯规划与选课

目标：依据学业数据生成选科建议并映射专业方向。

功能：

1. 选学生
2. 选模型（智谱）
3. 点击生成建议
4. 查看推荐历史
5. 查看公开专业选科要求表

实现来源：

- `GET /api/students`
- `POST /api/career/recommendations/generate`
- `GET /api/career/recommendations/:studentId`
- `GET /api/career/public-data/major-requirements`

## 3.4 学业成长追踪

目标：完成学生画像、趋势分析、风险预警。

功能：

1. 学生切换
2. 成长画像查看（风险等级 + 个性建议）
3. 考试均分趋势图（Recharts）
4. 预警记录查看

实现来源：

- `GET /api/growth/students/:studentId/profile`
- `GET /api/growth/students/:studentId/trends`
- `GET /api/growth/students/:studentId/alerts`

## 3.5 教师教学教研管理

目标：实现任务分配、成果归集、绩效分析。

功能：

1. 创建任务（备课/教研/沟通/培训）
2. 任务列表
3. 教研成果表
4. 统计卡片（状态统计、平均绩效）

实现来源：

- `GET /api/teaching/tasks`
- `POST /api/teaching/tasks`
- `GET /api/teaching/research`
- `GET /api/teaching/analytics`

## 3.6 智谱模型实验室

目标：提供统一模型切换与调用体验。

功能：

1. 填写 API Key（本地存储）
2. 选择模型
- GLM-4.7-Flash（文本思考）
- GLM-4.1V-Thinking-Flash（多模态思考）
- GLM-4.6V-Flash（多模态快速）
3. 输入提示词
4. 查看模型输出

实现来源：

- `GET /api/ai/models`
- `POST /api/ai/chat`

说明：

- API Key 不在后端持久化，仅调用时透传。
- 若请求多模态输入但模型不支持，后端会拒绝并提示。

## 3.7 数据导入

目标：为后期替换真实学校数据提供标准入口。

功能：

1. 学生数据 JSON 导入
2. 成绩数据 JSON 导入
3. 对应 CSV 模板说明

模板文件：

- `apps/backend/templates/students-template.csv`
- `apps/backend/templates/exam-results-template.csv`

实现来源：

- `POST /api/data-import/students`
- `POST /api/data-import/exam-results`

## 4. 前端视觉实现说明（对应 DESIGN.md）

当前已落地：

1. 暖色背景与纸张感层次（parchment + ivory）
2. Serif 标题 + Sans UI 的分工
3. ring shadow 与柔和阴影
4. 大圆角卡片
5. 页面渐进动画
6. 移动端单列响应式

核心实现文件：

- `apps/frontend/src/styles.css`

## 5. 演示脚本建议（8分钟）

1. 1分钟：总览 + 角色切换
2. 2分钟：家校沟通（发通知 + 请假审核）
3. 2分钟：生涯选课（生成推荐 + 专业映射）
4. 2分钟：学业成长（趋势图 + 风险预警）
5. 1分钟：教研管理 + 智谱模型切换

## 6. 评比注意事项

1. 涉及 AI 文本/图像输出需标注“AI生成”
2. 保护学生隐私，不展示真实敏感个人信息
3. 演示中强调真实问题与解决效果
4. 提供可复现步骤与模板

## 7. 常见问题

1. 为什么调用模型失败？
- 检查 API Key
- 检查模型名称是否正确
- 检查网络是否可访问智谱接口

2. 为什么部分模块显示无权限？
- 不同角色默认权限不同
- 可使用管理员账号验证全功能

3. 如何接入真实数据？
- 先按模板整理数据
- 使用数据导入接口写入
- 再做小范围脱敏验证
