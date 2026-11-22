require("dotenv").config();
const http = require("http");
const app = require("./src/app");
const connectDB = require("./src/config/db");

const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`🚀 CivicPulse Server running on port ${PORT} [${process.env.NODE_ENV || "development"}]`);
});

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log("🔒 HTTP server closed.");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("⚠️ Forcefully shutting down due to timeout.");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
