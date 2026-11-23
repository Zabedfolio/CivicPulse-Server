const express = require("express");
const Department = require("../models/Department");
const ApiResponse = require("../utils/apiResponse");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

/**
 * GET /api/v1/departments
 * List active municipal departments
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const departments = await Department.find({}).sort({ name: 1 }).lean();
    return new ApiResponse(200, { departments }, "Departments retrieved successfully").send(res);
  })
);

module.exports = router;
