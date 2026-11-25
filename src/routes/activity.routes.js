const express = require("express");
const ActivityLog = require("../models/ActivityLog");
const User = require("../models/User");
const ApiResponse = require("../utils/apiResponse");
const asyncHandler = require("../utils/asyncHandler");
const { protect } = require("../middleware/auth");
const { authorize } = require("../middleware/roleCheck");

const router = express.Router();

// All activity audit routes are strictly Admin-only
router.use(protect, authorize("admin"));

/**
 * GET /api/v1/activity
 * Paginated system-wide chronological activity audit log with entityType and search filters.
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(5, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { entityType, action, search } = req.query;
    const filter = {};

    if (entityType && entityType !== "all") {
      filter.entityType = entityType;
    }

    if (action && action.trim()) {
      filter.action = { $regex: action.trim(), $options: "i" };
    }

    if (search && search.trim()) {
      const q = search.trim();
      const matchingUsers = await User.find({
        $or: [
          { name: { $regex: q, $options: "i" } },
          { email: { $regex: q, $options: "i" } },
        ],
      })
        .select("_id")
        .lean();

      const userIds = matchingUsers.map((u) => u._id);

      filter.$or = [
        { action: { $regex: q, $options: "i" } },
        { entityType: { $regex: q, $options: "i" } },
        ...(userIds.length > 0 ? [{ user: { $in: userIds } }] : []),
      ];
    }

    const [logs, total, entityTypes] = await Promise.all([
      ActivityLog.find(filter)
        .populate("user", "name email role image")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ActivityLog.countDocuments(filter),
      ActivityLog.distinct("entityType"),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return new ApiResponse(
      200,
      {
        logs,
        entityTypes: entityTypes.sort(),
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      },
      "System activity logs retrieved successfully"
    ).send(res);
  })
);

/**
 * GET /api/v1/activity/stats
 * Quick audit stream summary metrics (total events, last 24h, active actors).
 */
router.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [totalEvents, last24hEvents, distinctActors] = await Promise.all([
      ActivityLog.countDocuments({}),
      ActivityLog.countDocuments({ createdAt: { $gte: since24h } }),
      ActivityLog.distinct("user"),
    ]);

    return new ApiResponse(
      200,
      {
        stats: {
          totalEvents,
          last24hEvents,
          activeActors: distinctActors.length,
        },
      },
      "Activity log statistics retrieved successfully"
    ).send(res);
  })
);

module.exports = router;
