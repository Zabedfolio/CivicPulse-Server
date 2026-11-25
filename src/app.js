const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const errorHandler = require("./middleware/errorHandler");
const healthRouter = require("./routes/health.routes");
const authRouter = require("./routes/auth.routes");
const userRouter = require("./routes/user.routes");
const issueRouter = require("./routes/issue.routes");
const departmentRouter = require("./routes/department.routes");
const notificationRouter = require("./routes/notification.routes");
const taskRouter = require("./routes/task.routes");
const analyticsRouter = require("./routes/analytics.routes");
const ApiError = require("./utils/apiError");

const app = express();

// Security HTTP headers
app.use(helmet());

// CORS configuration
const allowedOrigins = [
  process.env.CLIENT_URL || "http://localhost:3000",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. server-to-server, curl, Postman)
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new ApiError(403, `CORS blocked origin: ${origin}`));
    },
    credentials: true,
  })
);

// Logging middleware
if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

// Request parsers
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Base API v1 Routes
app.use("/api/v1", healthRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/users", userRouter);
app.use("/api/v1/issues", issueRouter);
app.use("/api/v1/departments", departmentRouter);
app.use("/api/v1/notifications", notificationRouter);
app.use("/api/v1/tasks", taskRouter);
app.use("/api/v1/analytics", analyticsRouter);

// Root route
app.get("/", (req, res) => {
  res.json({
    name: "CivicPulse API",
    version: "1.0.0",
    tagline: "Smarter Cities, Faster Fixes",
    documentation: "/api/v1/health",
  });
});

// 404 Route Catch-all
app.use((req, res, next) => {
  next(new ApiError(404, `Endpoint not found: ${req.method} ${req.originalUrl}`));
});

// Global Centralized Error Handler
app.use(errorHandler);

module.exports = app;
