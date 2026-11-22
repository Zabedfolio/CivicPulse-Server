const express = require("express");
const { protect } = require("../middleware/auth");
const ApiResponse = require("../utils/apiResponse");

const router = express.Router();

/**
 * GET /api/v1/auth/me
 * Retrieves current authenticated user profile
 */
router.get("/me", protect, (req, res) => {
  return new ApiResponse(
    200,
    { user: req.user },
    "User profile retrieved successfully"
  ).send(res);
});

module.exports = router;
