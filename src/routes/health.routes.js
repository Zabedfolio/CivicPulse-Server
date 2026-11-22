const express = require("express");
const ApiResponse = require("../utils/apiResponse");

const router = express.Router();

router.get("/health", (req, res) => {
  const healthData = {
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    status: "healthy",
    environment: process.env.NODE_ENV || "development",
  };

  return new ApiResponse(200, healthData, "CivicPulse API is operational").send(res);
});

module.exports = router;
