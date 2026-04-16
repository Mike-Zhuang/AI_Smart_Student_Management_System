# 高中AI管理辅助系统（评比演示版 + 深度功能版）

本项目面向中国大陆高中场景，围绕以下四大系统一次性提供完整实现：

1. 家校沟通系统
2. 生涯规划与选课系统
3. 学生学业成长追踪管理系统
4. 教师教学教研管理系统

并支持国产大模型智谱接入（前端可填 API Key + 模型切换）。

## 1. 项目定位

- 目标场景：创AI案例评比与小范围预览
- 架构形态：前后端分离
- 部署策略：轻量裸机部署（非 Docker）
- 数据策略：公开教育数据 + 高可信模拟数据 + 后期真实数据模板导入

## 2. 技术架构

### 前端

- React 18 + TypeScript + Vite
- Recharts 可视化
- 设计风格严格参考 DESIGN.md（暖色纸张感、Serif 标题、Ring Shadow）

### 后端

- Node.js + Express + TypeScript
- SQLite（better-sqlite3）
- JWT 认证 + RBAC 角色权限
- 邀请码注册机制

### 智谱模型接入

- GLM-4.7-Flash
- GLM-4.1V-Thinking-Flash
- GLM-4.6V-Flash

后端统一网关代理，前端可选择模型并传入 API Key。

## 3. 目录结构

```text
.
├── apps
│   ├── backend
│   │   ├── src
│   │   │   ├── routes
│   │   │   ├── middleware
│   │   │   ├── services
│   │   │   └── utils
│   │   ├── templates
│   │   └── data
│   └── frontend
│       └── src
│           ├── components
│           ├── pages
│           └── lib
├── deploy
├── docs
├── GUIDE.md
├── LICENSE
└── README.md
```

## 4. 快速启动

### 环境要求

- Node.js >= 20
- npm >= 10

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm run dev
```

默认地址：

- 前端: http://localhost:3000
- 后端: http://localhost:4000

### 单独启动

```bash
npm run dev:backend
npm run dev:frontend
```

## 5. 演示账号

- admin / admin123
- teacher_zhang / teacher123
- head_li / head123
- parent_wang / parent123
- student_001 / student123

## 6. 四大模块说明

### 6.1 家校沟通

- 消息中心与通知推送
- 请假申请与审批闭环
- 家长消息反馈

### 6.2 生涯规划与选课

- 选科推荐生成（3+1+2）
- 公开专业选科要求查询
- 推荐历史追踪

### 6.3 学业成长追踪

- 学生成长画像
- 考试趋势图
- 风险预警列表

### 6.4 教学教研管理

- 教学任务管理
- 教研成果归集
- 绩效分析可视化

## 7. 数据策略

### 当前内置

- 模拟学生档案（120人）
- 多次考试成绩
- 成长画像与预警
- 公开专业选科要求示例

### 真实数据导入

模板文件位于：

- apps/backend/templates/students-template.csv
- apps/backend/templates/exam-results-template.csv

后台接口支持导入：

- /api/data-import/students
- /api/data-import/exam-results

## 8. 裸机部署

参考文件：

- deploy/nginx.conf.example
- deploy/backend.service.example
- deploy/deploy.sh

## 9. 安全说明（评比场景最小集）

- JWT 登录鉴权
- RBAC 角色权限
- 基础限流
- Helmet 安全头
- CORS 控制

本项目为评比与演示用途，不按重生产标准实现高强度安全基建。

## 10. 文档

- GUIDE.md：前端功能详细使用说明与实现路径
- DESIGN.md：前端视觉设计规范
- official_doc/附件3：创AI案例征集指南.md：评比要求来源

## 11. 许可证

本仓库采用双许可证：

- 代码：PolyForm Noncommercial 1.0.0
- 文档与演示材料：CC BY-NC-SA 4.0

版权归属：Zhuang Chengbo
未经授权禁止商用。
