import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { isProduction, securityConfig } from "./config/security.js";
import { initDatabase, runDeferredDatabaseMaintenance } from "./db.js";
import { aiRateLimit, authRouteRateLimit, globalRequestRateLimit, uploadRateLimit } from "./middleware/rateLimit.js";
import { adminRouter } from "./routes/admin.js";
import { aiRouter } from "./routes/ai.js";
import { authRouter } from "./routes/auth.js";
import { careerRouter } from "./routes/career.js";
import { classSpaceRouter } from "./routes/classSpace.js";
import { dataImportRouter } from "./routes/dataImport.js";
import { growthRouter } from "./routes/growth.js";
import { headTeacherRouter } from "./routes/headTeacher.js";
import { homeSchoolRouter } from "./routes/homeSchool.js";
import { orgStructureRouter } from "./routes/orgStructure.js";
import { studentsRouter } from "./routes/students.js";

dotenv.config();
initDatabase();

const app = express();
const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || "0.0.0.0";
app.set("trust proxy", securityConfig.trustProxy);
app.disable("x-powered-by");

app.use(
  helmet({
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-origin" },
    contentSecurityPolicy: false
  })
);
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (securityConfig.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      if (!isProduction) {
        callback(null, true);
        return;
      }

      callback(new Error("当前来源未被允许访问"));
    }
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));
app.use(morgan("dev"));
app.use(globalRequestRateLimit);

app.get("/health", (_req, res) => {
  res.json({ success: true, message: "ok", data: { service: "backend", uptime: process.uptime() } });
});

app.use("/api/auth", authRouteRateLimit, authRouter);
app.use("/api/ai", aiRateLimit, aiRouter);
app.use("/api/students", studentsRouter);
app.use("/api/home-school", homeSchoolRouter);
app.use("/api/career", careerRouter);
app.use("/api/class-space", classSpaceRouter);
app.use("/api/growth", growthRouter);
app.use("/api/head-teacher", headTeacherRouter);
app.use("/api/org-structure", orgStructureRouter);
app.use("/api/admin", adminRouter);
app.use("/api/data-import", uploadRateLimit, dataImportRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "服务器内部错误";
  const publicMessage = /允许访问|频繁|不合法|失败|失效|过期|重新登录/.test(message) ? message : "服务器内部错误";
  res.status(500).json({ success: false, message: publicMessage });
});

const server = app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend running at http://${host}:${port}`);
  // eslint-disable-next-line no-console
  console.log(`Demo seed enabled: ${process.env.ENABLE_DEMO_SEED === "true" || process.env.NODE_ENV !== "production" ? "yes" : "no"}`);
  runDeferredDatabaseMaintenance();
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    // eslint-disable-next-line no-console
    console.error(`后端启动失败：${host}:${port} 已被占用。请先停止旧进程，或使用 PORT=其他端口 重新启动。`);
    process.exit(1);
    return;
  }

  // eslint-disable-next-line no-console
  console.error("后端启动失败：", error);
  process.exit(1);
});
