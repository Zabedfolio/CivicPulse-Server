const express = require("express");
const Notification = require("../models/Notification");
const { protect } = require("../middleware/auth");
const ApiResponse = require("../utils/apiResponse");
const ApiError = require("../utils/apiError");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// All notification endpoints require authenticated user
router.use(protect);

/**
 * GET /api/v1/notifications
 * Fetch notifications for authenticated user with optional filter & pagination
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { isRead, page = 1, limit = 20 } = req.query;

    const filter = { user: req.user._id };
    if (isRead !== undefined) {
      filter.isRead = isRead === "true";
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .populate("issue", "title status category priority")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Notification.countDocuments(filter),
    ]);

    return new ApiResponse(
      200,
      {
        notifications,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum) || 1,
        },
      },
      "Notifications retrieved successfully"
    ).send(res);
  })
);

/**
 * GET /api/v1/notifications/unread-count
 * Quick count of unread notifications for badge counters
 */
router.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    const unreadCount = await Notification.countDocuments({
      user: req.user._id,
      isRead: false,
    });

    return new ApiResponse(
      200,
      { unreadCount },
      "Unread count retrieved successfully"
    ).send(res);
  })
);

/**
 * PATCH /api/v1/notifications/:id/read
 * Mark a single notification as read
 */
router.patch(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      throw new ApiError(404, "Notification not found or unauthorized.");
    }

    return new ApiResponse(
      200,
      { notification },
      "Notification marked as read"
    ).send(res);
  })
);

/**
 * PATCH /api/v1/notifications/mark-all-read
 * Mark all unread notifications as read for current user
 */
router.patch(
  "/mark-all-read",
  asyncHandler(async (req, res) => {
    const result = await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { $set: { isRead: true } }
    );

    return new ApiResponse(
      200,
      { modifiedCount: result.modifiedCount },
      "All notifications marked as read"
    ).send(res);
  })
);

module.exports = router;
