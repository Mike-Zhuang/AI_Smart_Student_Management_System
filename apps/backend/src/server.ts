import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { initDatabase } from "./db.js";
import { simpleRateLimit } from "./middleware/rateLimit.js";
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

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));
app.use(simpleRateLimit);

app.get("/health", (_req, res) => {
  res.json({ success: true, message: "ok", data: { service: "backend", uptime: process.uptime() } });
});

app.use("/api/auth", authRouter);
app.use("/api/ai", aiRouter);
app.use("/api/students", studentsRouter);
app.use("/api/home-school", homeSchoolRouter);
app.use("/api/career", careerRouter);
app.use("/api/class-space", classSpaceRouter);
app.use("/api/growth", growthRouter);
app.use("/api/head-teacher", headTeacherRouter);
app.use("/api/org-structure", orgStructureRouter);
app.use("/api/admin", adminRouter);
app.use("/api/data-import", dataImportRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "服务器内部错误";
  res.status(500).json({ success: false, message });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend running at http://localhost:${port}`);
});
