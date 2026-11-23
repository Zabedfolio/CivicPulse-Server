const express = require("express");
const { z } = require("zod");
const Issue = require("../models/Issue");
const Department = require("../models/Department");
const IssueStatusHistory = require("../models/IssueStatusHistory");
const ActivityLog = require("../models/ActivityLog");
const { protect, optionalAuth } = require("../middleware/auth");
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

module.exports = router;
