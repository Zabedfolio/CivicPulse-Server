const express = require("express");
const { z } = require("zod");
const Issue = require("../models/Issue");
const Department = require("../models/Department");
const Feedback = require("../models/Feedback");
const IssueStatusHistory = require("../models/IssueStatusHistory");
const ActivityLog = require("../models/ActivityLog");
const { protect, optionalAuth } = require("../middleware/auth");
const { authorize } = require("../middleware/roleCheck");
const { transitionIssueStatus } = require("../services/issueWorkflow");
const upload = require("../middleware/upload");
const { uploadToCloudinary } = require("../config/cloudinary");
const ApiResponse = require("../utils/apiResponse");
const ApiError = require("../utils/apiError");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// Department category mapping
const CATEGORY_DEPARTMENT_MAP = {
  "Road Damage": { name: "Road Maintenance & Engineering", code: "ROAD" },
  Streetlight: { name: "Electrical & Public Lighting Division", code: "ELEC" },
  Drainage: { name: "Water & Sewerage Authority (WASA)", code: "WASA" },
  Footpath: { name: "Civil Works & Sidewalk Division", code: "CIVIL" },
  "Waste Management": { name: "Waste & Sanitation Division", code: "WASTE" },
  "Public Infrastructure": { name: "Municipal Urban Development", code: "URBAN" },
};

// Zod Schema for Issue Creation
const createIssueSchema = z.object({
  title: z
    .string()
    .trim()
    .min(5, "Title must be at least 5 characters")
    .max(100, "Title must not exceed 100 characters"),
  description: z
    .string()
    .trim()
    .min(15, "Description must be at least 15 characters"),
  category: z.enum(Issue.ISSUE_CATEGORIES, {
    errorMap: () => ({
      message: `Category must be one of: ${Issue.ISSUE_CATEGORIES.join(", ")}`,
    }),
  }),
  priority: z.enum(Issue.ISSUE_PRIORITIES).optional().default("medium"),
  address: z.string().trim().min(5, "Address must be at least 5 characters"),
  latitude: z.coerce
    .number()
    .min(-90, "Latitude must be between -90 and 90")
    .max(90, "Latitude must be between -90 and 90"),
  longitude: z.coerce
    .number()
    .min(-180, "Longitude must be between -180 and 180")
    .max(180, "Longitude must be between -180 and 180"),
});

/**
 * Helper to resolve or find department by issue category
 */
async function resolveDepartmentForCategory(category) {
  const deptInfo = CATEGORY_DEPARTMENT_MAP[category] || CATEGORY_DEPARTMENT_MAP["Public Infrastructure"];
  let dept = await Department.findOne({ code: deptInfo.code });
  if (!dept) {
    dept = await Department.create({
      name: deptInfo.name,
      code: deptInfo.code,
      description: `Default department handling ${category} public works`,
    });
  }
  return dept._id;
}

/**
 * POST /api/v1/issues
 * Create a new public works issue report with optional image upload
 */
router.post(
  "/",
  protect,
  upload.single("image"),
  asyncHandler(async (req, res) => {
    // 1. Validate incoming form fields
    const validation = createIssueSchema.safeParse(req.body);
    if (!validation.success) {
      throw new ApiError(400, "Validation failed", validation.error.errors);
    }

    const { title, description, category, priority, address, latitude, longitude } =
      validation.data;

    // 2. Upload image to Cloudinary (or fallback)
    let imageData = { url: null, publicId: null };
    if (req.file) {
      imageData = await uploadToCloudinary(
        req.file.buffer,
        "civicpulse/issues",
        req.file.originalname
      );
    }

    // 3. Resolve department based on category
    const departmentId = await resolveDepartmentForCategory(category);

    // 4. Create Issue document
    const issue = await Issue.create({
      title,
      description,
      category,
      priority,
      status: "Submitted",
      address,
      location: {
        type: "Point",
        coordinates: [longitude, latitude], // GeoJSON order: [lng, lat]
      },
      image: imageData,
      reporter: req.user._id,
      department: departmentId,
    });

    // 5. Create initial IssueStatusHistory audit log
    await IssueStatusHistory.create({
      issue: issue._id,
      fromStatus: null,
      toStatus: "Submitted",
      changedBy: req.user._id,
      note: "Issue reported by citizen via mobile/web portal",
    });

    // 6. Record ActivityLog
    await ActivityLog.create({
      user: req.user._id,
      action: "ISSUE_REPORTED",
      entityType: "Issue",
      entityId: issue._id,
      details: {
        title: issue.title,
        category: issue.category,
        priority: issue.priority,
        address: issue.address,
      },
    });

    return new ApiResponse(
      201,
      { issue },
      "Public infrastructure issue reported successfully"
    ).send(res);
  })
);

/**
 * GET /api/v1/issues
 * List issues with role-scoping, search query, multi-criteria filtering, dynamic sorting, and pagination
 */
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const {
      status,
      category,
      priority,
      department,
      reporter,
      search,
      q,
      startDate,
      endDate,
      sortBy = "createdAt",
      sortOrder = "desc",
      page = 1,
      limit = 20,
    } = req.query;

    const filter = {};

    // 1. Role-based scoping:
    // If authenticated user is a 'manager', strictly restrict query to their department
    if (req.user && req.user.role === "manager") {
      if (req.user.department) {
        filter.department = req.user.department;
      }
    } else if (department && department !== "all") {
      // Admins (or public) can filter by a specific department
      filter.department = department;
    }

    // 2. Standard Filters
    if (status && status !== "all") {
      if (status.includes(",")) {
        filter.status = { $in: status.split(",").map((s) => s.trim()) };
      } else {
        filter.status = status;
      }
    }
    if (category && category !== "all") filter.category = category;
    if (priority && priority !== "all") filter.priority = priority;
    if (reporter) filter.reporter = reporter;

    // 3. Search query: case-insensitive match on title and address
    const searchQuery = (search || q || "").trim();
    if (searchQuery) {
      // Sanitize regex special characters
      const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { title: { $regex: escapedQuery, $options: "i" } },
        { address: { $regex: escapedQuery, $options: "i" } },
      ];
    }

    // 4. Date range filter
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    // 5. Pagination & Sorting
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    // Validate and sanitize sort field and order
    const allowedSortFields = ["createdAt", "updatedAt", "priority", "status", "title", "category"];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";
    const sortDirection = sortOrder === "asc" || sortOrder === "1" ? 1 : -1;
    const sortObj = { [sortField]: sortDirection };

    const [issues, total] = await Promise.all([
      Issue.find(filter)
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .populate("reporter", "name email image role")
        .populate("department", "name code")
        .populate("assignedTo", "name email image")
        .populate("verifiedBy", "name email role")
        .lean(),
      Issue.countDocuments(filter),
    ]);

    const pagination = {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    };

    return new ApiResponse(200, { issues }, "Issues retrieved successfully", pagination).send(
      res
    );
  })
);

/**
 * GET /api/v1/issues/mine
 * List issues reported by the currently authenticated user
 */
router.get(
  "/mine",
  protect,
  asyncHandler(async (req, res) => {
    const { status, category, priority, page = 1, limit = 20 } = req.query;
    const filter = { reporter: req.user._id };

    if (status && status !== "all") filter.status = status;
    if (category && category !== "all") filter.category = category;
    if (priority) filter.priority = priority;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [issues, total] = await Promise.all([
      Issue.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("reporter", "name email image role")
        .populate("department", "name code")
        .populate("assignedTo", "name email")
        .populate("feedback")
        .lean(),
      Issue.countDocuments(filter),
    ]);

    const pagination = {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    };

    return new ApiResponse(
      200,
      { issues },
      "Citizen issues retrieved successfully",
      pagination
    ).send(res);
  })
);

/**
 * GET /api/v1/issues/nearby
 * Detect proximity duplicate issues within a spherical radius (default: 50m)
 */
router.get(
  "/nearby",
  asyncHandler(async (req, res) => {
    const { lat, lng, radius = 50, category, excludeId } = req.query;

    if (lat === undefined || lng === undefined) {
      throw new ApiError(400, "Latitude (lat) and Longitude (lng) are required.");
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    if (
      isNaN(latitude) ||
      isNaN(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new ApiError(400, "Invalid coordinates provided.");
    }

    const radiusMeters = Math.max(1, Math.min(2000, parseFloat(radius) || 50));
    const earthRadiusMeters = 6378100;
    const radians = radiusMeters / earthRadiusMeters;

    const filter = {
      location: {
        $geoWithin: {
          $centerSphere: [[longitude, latitude], radians],
        },
      },
      isDuplicate: false,
    };

    if (category && category !== "all" && Issue.ISSUE_CATEGORIES.includes(category)) {
      filter.category = category;
    }

    const mongoose = require("mongoose");
    if (excludeId && mongoose.Types.ObjectId.isValid(excludeId)) {
      filter._id = { $ne: excludeId };
    }

    const nearbyIssues = await Issue.find(filter)
      .populate("reporter", "name email image role")
      .populate("department", "name code")
      .populate("assignedTo", "name email image")
      .lean();

    // Calculate exact distance in meters using Haversine formula
    const haversineMeters = (lat1, lon1, lat2, lon2) => {
      const R = 6378100;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return Math.round(R * c);
    };

    const issuesWithDistance = nearbyIssues.map((item) => {
      const itemLng = item.location?.coordinates?.[0];
      const itemLat = item.location?.coordinates?.[1];
      const distanceMeters =
        itemLat !== undefined && itemLng !== undefined
          ? haversineMeters(latitude, longitude, itemLat, itemLng)
          : null;
      return {
        ...item,
        distanceMeters,
      };
    });

    // Sort closest first
    issuesWithDistance.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));

    return new ApiResponse(
      200,
      {
        issues: issuesWithDistance,
        count: issuesWithDistance.length,
        radiusMeters,
      },
      "Nearby issues retrieved successfully"
    ).send(res);
  })
);

/**
 * GET /api/v1/issues/:id
 * Retrieve issue details along with status transition history
 */
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const issue = await Issue.findById(req.params.id)
      .populate("reporter", "name email image role phone")
      .populate("department", "name code contactEmail contactPhone")
      .populate("assignedTo", "name email phone image")
      .populate("verifiedBy", "name email role")
      .populate("feedback")
      .lean();

    if (!issue) {
      throw new ApiError(404, "Issue not found");
    }

    const history = await IssueStatusHistory.find({ issue: req.params.id })
      .sort({ createdAt: 1 })
      .populate("changedBy", "name role image")
      .lean();

    return new ApiResponse(
      200,
      { issue, history },
      "Issue details retrieved successfully"
    ).send(res);
  })
);

/**
 * GET /api/v1/issues/:id/history
 * Retrieve chronological status transitions for a specific issue
 */
router.get(
  "/:id/history",
  asyncHandler(async (req, res) => {
    const issue = await Issue.findById(req.params.id).select("_id title status").lean();
    if (!issue) {
      throw new ApiError(404, "Issue not found");
    }

    const history = await IssueStatusHistory.find({ issue: req.params.id })
      .sort({ createdAt: 1 })
      .populate("changedBy", "name role image")
      .lean();

    return new ApiResponse(
      200,
      { issueId: issue._id, history },
      "Issue history retrieved successfully"
    ).send(res);
  })
);

/**
 * PATCH /api/v1/issues/:id/verify
 * Formally verify an issue report, setting verifiedBy and moving status to Under Review
 */
router.patch(
  "/:id/verify",
  protect,
  authorize("manager", "admin"),
  asyncHandler(async (req, res) => {
    const issue = await Issue.findById(req.params.id);
    if (!issue) {
      throw new ApiError(404, "Issue not found");
    }

    // Role check: Department manager can only verify issues within their assigned department
    if (req.user.role === "manager") {
      if (
        req.user.department &&
        issue.department &&
        !issue.department.equals(req.user.department)
      ) {
        throw new ApiError(
          403,
          "Forbidden: You can only manage and verify issues within your assigned department."
        );
      }
    }

    const previousStatus = issue.status;
    issue.verifiedBy = req.user._id;

    // Optional priority update during verification
    if (req.body.priority && Issue.ISSUE_PRIORITIES.includes(req.body.priority)) {
      issue.priority = req.body.priority;
    }

    await issue.save();

    const note = req.body.note?.trim() || "Issue inspected and verified by municipal manager";

    // Transition Submitted issues to Under Review using workflow engine
    let populatedIssue;
    if (issue.status === "Submitted") {
      populatedIssue = await transitionIssueStatus(issue._id, "Under Review", req.user, {
        note,
      });
    } else {
      // If already Under Review or beyond, write audit log
      await IssueStatusHistory.create({
        issue: issue._id,
        fromStatus: previousStatus,
        toStatus: issue.status,
        changedBy: req.user._id,
        note,
      });

      await ActivityLog.create({
        user: req.user._id,
        action: "ISSUE_VERIFIED",
        entityType: "Issue",
        entityId: issue._id,
        details: {
          previousStatus,
          newStatus: issue.status,
          priority: issue.priority,
          note,
        },
      });

      populatedIssue = await Issue.findById(issue._id)
        .populate("reporter", "name email image role")
        .populate("department", "name code")
        .populate("verifiedBy", "name email role")
        .lean();
    }

    return new ApiResponse(
      200,
      { issue: populatedIssue },
      "Issue verified successfully"
    ).send(res);
  })
);

/**
 * PATCH /api/v1/issues/:id/priority
 * Update severity priority of an issue
 */
router.patch(
  "/:id/priority",
  protect,
  authorize("manager", "admin"),
  asyncHandler(async (req, res) => {
    const { priority, note } = req.body;

    if (!priority || !Issue.ISSUE_PRIORITIES.includes(priority)) {
      throw new ApiError(
        400,
        `Priority must be one of: ${Issue.ISSUE_PRIORITIES.join(", ")}`
      );
    }

    const issue = await Issue.findById(req.params.id);
    if (!issue) {
      throw new ApiError(404, "Issue not found");
    }

    if (req.user.role === "manager") {
      if (
        req.user.department &&
        issue.department &&
        !issue.department.equals(req.user.department)
      ) {
        throw new ApiError(
          403,
          "Forbidden: You can only alter priority for issues within your assigned department."
        );
      }
    }

    const oldPriority = issue.priority;
    issue.priority = priority;
    await issue.save();

    await ActivityLog.create({
      user: req.user._id,
      action: "ISSUE_PRIORITY_UPDATED",
      entityType: "Issue",
      entityId: issue._id,
      details: {
        oldPriority,
        newPriority: priority,
        note: note?.trim() || "",
      },
    });

    return new ApiResponse(
      200,
      { issue },
      `Issue priority updated from ${oldPriority} to ${priority}`
    ).send(res);
  })
);

/**
 * PATCH /api/v1/issues/:id/reroute
 * Re-route a miscategorized issue to a different municipal department
 */
router.patch(
  "/:id/reroute",
  protect,
  authorize("manager", "admin"),
  asyncHandler(async (req, res) => {
    const { departmentId, category, note } = req.body;

    if (!departmentId) {
      throw new ApiError(400, "departmentId is required for department re-routing.");
    }

    const targetDept = await Department.findById(departmentId);
    if (!targetDept) {
      throw new ApiError(400, "Target department not found.");
    }

    const issue = await Issue.findById(req.params.id);
    if (!issue) {
      throw new ApiError(404, "Issue not found");
    }

    if (req.user.role === "manager") {
      if (
        req.user.department &&
        issue.department &&
        !issue.department.equals(req.user.department)
      ) {
        throw new ApiError(
          403,
          "Forbidden: You can only re-route issues originating from your assigned department."
        );
      }
    }

    const previousDeptId = issue.department;
    issue.department = targetDept._id;

    if (category && Issue.ISSUE_CATEGORIES.includes(category)) {
      issue.category = category;
    }

    await issue.save();

    const transferNote =
      note?.trim() || `Issue re-routed to ${targetDept.name} (${targetDept.code})`;

    // Record transition history noting department change
    await IssueStatusHistory.create({
      issue: issue._id,
      fromStatus: issue.status,
      toStatus: issue.status,
      changedBy: req.user._id,
      note: transferNote,
    });

    await ActivityLog.create({
      user: req.user._id,
      action: "ISSUE_REROUTED",
      entityType: "Issue",
      entityId: issue._id,
      details: {
        previousDepartment: previousDeptId,
        newDepartment: targetDept._id,
        departmentName: targetDept.name,
        category: issue.category,
        note: transferNote,
      },
    });

    const populatedIssue = await Issue.findById(issue._id)
      .populate("reporter", "name email image role")
      .populate("department", "name code")
      .populate("verifiedBy", "name email role")
      .lean();

    return new ApiResponse(
      200,
      { issue: populatedIssue },
      `Issue successfully re-routed to ${targetDept.name}`
    ).send(res);
  })
);

/**
 * PATCH /api/v1/issues/:id/status
 * Perform deterministic status transition using issueWorkflow state engine
 */
router.patch(
  "/:id/status",
  protect,
  authorize("staff", "manager", "admin"),
  asyncHandler(async (req, res) => {
    const { status, note, metadata } = req.body;

    if (!status) {
      throw new ApiError(400, "status is required to transition issue.");
    }

    const updatedIssue = await transitionIssueStatus(
      req.params.id,
      status,
      req.user,
      { note, metadata }
    );

    return new ApiResponse(
      200,
      { issue: updatedIssue },
      `Issue status successfully updated to '${status}'`
    ).send(res);
  })
);

/**
 * PATCH /api/v1/issues/:id/mark-duplicate
 * Flag an issue as duplicate of a parent issue, link them, transition child to Closed, and notify citizen
 */
router.patch(
  "/:id/mark-duplicate",
  protect,
  authorize("manager", "admin"),
  asyncHandler(async (req, res) => {
    const { parentIssueId, note } = req.body;

    if (!parentIssueId) {
      throw new ApiError(400, "parentIssueId is required to mark issue as duplicate.");
    }

    if (req.params.id === parentIssueId) {
      throw new ApiError(400, "An issue cannot be marked as a duplicate of itself.");
    }

    const [childIssue, parentIssue] = await Promise.all([
      Issue.findById(req.params.id),
      Issue.findById(parentIssueId),
    ]);

    if (!childIssue) {
      throw new ApiError(404, "Child issue not found.");
    }
    if (!parentIssue) {
      throw new ApiError(404, "Parent issue not found.");
    }

    if (parentIssue.isDuplicate) {
      throw new ApiError(
        400,
        "Cannot link to a parent issue that is already flagged as a duplicate."
      );
    }

    if (req.user.role === "manager") {
      if (
        req.user.department &&
        childIssue.department &&
        !childIssue.department.equals(req.user.department)
      ) {
        throw new ApiError(
          403,
          "Forbidden: You can only mark duplicates for issues within your assigned department."
        );
      }
    }

    const previousStatus = childIssue.status;
    const previousDuplicateOf = childIssue.isDuplicateOf;

    // Link duplicate and transition child to Closed
    childIssue.isDuplicate = true;
    childIssue.isDuplicateOf = parentIssue._id;
    childIssue.status = "Closed";
    childIssue.closedAt = new Date();
    await childIssue.save();

    // Increment parent issue duplicateCount if not already linked
    if (!previousDuplicateOf || !previousDuplicateOf.equals(parentIssue._id)) {
      await Issue.findByIdAndUpdate(parentIssue._id, { $inc: { duplicateCount: 1 } });
    }

    const duplicateNote =
      note?.trim() ||
      `Marked as duplicate of ticket "${parentIssue.title}" (#${parentIssue._id.toString().slice(-6)})`;

    // Record transition history
    await IssueStatusHistory.create({
      issue: childIssue._id,
      fromStatus: previousStatus,
      toStatus: "Closed",
      changedBy: req.user._id,
      note: duplicateNote,
    });

    // Record ActivityLog
    await ActivityLog.create({
      user: req.user._id,
      action: "ISSUE_MARKED_DUPLICATE",
      entityType: "Issue",
      entityId: childIssue._id,
      details: {
        childIssueId: childIssue._id,
        parentIssueId: parentIssue._id,
        parentTitle: parentIssue.title,
        previousStatus,
        note: duplicateNote,
      },
    });

    // Dispatch notification to reporting citizen
    if (childIssue.reporter && (!req.user._id || !childIssue.reporter.equals(req.user._id))) {
      try {
        const Notification = require("../models/Notification");
        await Notification.create({
          user: childIssue.reporter,
          title: `Report Linked as Duplicate: "${childIssue.title}"`,
          message: `Your public works report has been linked to existing active ticket "${parentIssue.title}". You will continue to receive municipal resolution updates.`,
          type: "status_change",
          issue: parentIssue._id,
        });
      } catch (err) {
        console.warn("Notification dispatch notice:", err.message);
      }
    }

    const populatedChild = await Issue.findById(childIssue._id)
      .populate("reporter", "name email image role")
      .populate("department", "name code")
      .populate("isDuplicateOf", "title status category priority")
      .lean();

    return new ApiResponse(
      200,
      { issue: populatedChild, parentIssue: { _id: parentIssue._id, title: parentIssue.title } },
      "Issue marked as duplicate successfully"
    ).send(res);
  })
);

/**
 * PATCH /api/v1/issues/:id/unmark-duplicate
 * Remove duplicate status and revert issue back to Under Review
 */
router.patch(
  "/:id/unmark-duplicate",
  protect,
  authorize("manager", "admin"),
  asyncHandler(async (req, res) => {
    const issue = await Issue.findById(req.params.id);
    if (!issue) {
      throw new ApiError(404, "Issue not found.");
    }

    if (!issue.isDuplicate) {
      throw new ApiError(400, "Issue is not currently marked as a duplicate.");
    }

    if (req.user.role === "manager") {
      if (
        req.user.department &&
        issue.department &&
        !issue.department.equals(req.user.department)
      ) {
        throw new ApiError(
          403,
          "Forbidden: You can only modify issues within your assigned department."
        );
      }
    }

    const parentId = issue.isDuplicateOf;
    issue.isDuplicate = false;
    issue.isDuplicateOf = null;
    issue.status = "Under Review";
    issue.closedAt = null;
    await issue.save();

    if (parentId) {
      await Issue.findByIdAndUpdate(parentId, {
        $inc: { duplicateCount: -1 },
      });
    }

    const revertNote = req.body.note?.trim() || "Duplicate flag removed, reverted to Under Review";

    await IssueStatusHistory.create({
      issue: issue._id,
      fromStatus: "Closed",
      toStatus: "Under Review",
      changedBy: req.user._id,
      note: revertNote,
    });

    await ActivityLog.create({
      user: req.user._id,
      action: "ISSUE_UNMARKED_DUPLICATE",
      entityType: "Issue",
      entityId: issue._id,
      details: {
        previousParentId: parentId,
        note: revertNote,
      },
    });

    const populatedIssue = await Issue.findById(issue._id)
      .populate("reporter", "name email image role")
      .populate("department", "name code")
      .lean();

    return new ApiResponse(
      200,
      { issue: populatedIssue },
      "Duplicate flag removed successfully"
    ).send(res);
  })
);

/**
 * POST /api/v1/issues/:id/feedback
 * Submit citizen satisfaction rating (1-5 stars) and comment on a resolved/closed issue
 */
router.post(
  "/:id/feedback",
  protect,
  asyncHandler(async (req, res) => {
    const { rating, comment } = req.body;

    const numRating = parseInt(rating, 10);
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
      throw new ApiError(400, "Rating must be an integer between 1 and 5 stars.");
    }

    const issue = await Issue.findById(req.params.id);
    if (!issue) {
      throw new ApiError(404, "Issue not found.");
    }

    // 1. Ownership Guard: Original reporter only
    if (!issue.reporter || !issue.reporter.equals(req.user._id)) {
      throw new ApiError(
        403,
        "Forbidden: You can only submit feedback for public issues you personally reported."
      );
    }

    // 2. Status Guard: Must be Resolved or Closed
    if (issue.status !== "Resolved" && issue.status !== "Closed") {
      throw new ApiError(
        400,
        `Citizen feedback can only be submitted once the issue has been marked Resolved. Current status: '${issue.status}'`
      );
    }

    // 3. Single Review Constraint
    const existingFeedback = await Feedback.findOne({ issue: issue._id });
    if (existingFeedback) {
      throw new ApiError(
        409,
        "Feedback has already been recorded for this issue. Duplicate submissions are not permitted."
      );
    }

    // 4. Create Feedback document
    const feedback = await Feedback.create({
      issue: issue._id,
      citizen: req.user._id,
      department: issue.department || null,
      rating: numRating,
      comment: comment?.trim() || "",
    });

    // 5. Link feedback to issue
    issue.feedback = feedback._id;
    await issue.save();

    // 6. Record ActivityLog
    await ActivityLog.create({
      user: req.user._id,
      action: "FEEDBACK_SUBMITTED",
      entityType: "Issue",
      entityId: issue._id,
      details: {
        rating: numRating,
        comment: feedback.comment,
      },
    });

    // 7. Dispatch in-app notification to assigned technician if exists
    if (issue.assignedTo) {
      try {
        const Notification = require("../models/Notification");
        await Notification.create({
          user: issue.assignedTo,
          title: `Citizen Review Received: ${numRating} Stars`,
          message: `The reporting citizen left a ${numRating}-star review for "${issue.title}": "${feedback.comment || "No comment"}"`,
          type: "feedback_received",
          issue: issue._id,
        });
      } catch (err) {
        console.warn("Feedback notification notice:", err.message);
      }
    }

    const populatedFeedback = await Feedback.findById(feedback._id)
      .populate("citizen", "name email image")
      .populate("department", "name code")
      .lean();

    return new ApiResponse(
      201,
      { feedback: populatedFeedback },
      "Citizen feedback submitted successfully"
    ).send(res);
  })
);

/**
 * GET /api/v1/issues/:id/feedback
 * Retrieve citizen feedback for a specific issue
 */
router.get(
  "/:id/feedback",
  asyncHandler(async (req, res) => {
    const feedback = await Feedback.findOne({ issue: req.params.id })
      .populate("citizen", "name email image role")
      .populate("department", "name code")
      .lean();

    if (!feedback) {
      return new ApiResponse(200, { feedback: null }, "No feedback recorded for this issue").send(res);
    }

    return new ApiResponse(200, { feedback }, "Issue feedback retrieved successfully").send(res);
  })
);

module.exports = router;
