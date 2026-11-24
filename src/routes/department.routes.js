const express = require("express");
const mongoose = require("mongoose");
const Department = require("../models/Department");
const User = require("../models/User");
const Issue = require("../models/Issue");
const ActivityLog = require("../models/ActivityLog");
const ApiResponse = require("../utils/apiResponse");
const ApiError = require("../utils/apiError");
const asyncHandler = require("../utils/asyncHandler");
const { protect } = require("../middleware/auth");
const { authorize } = require("../middleware/roleCheck");

const router = express.Router();

/**
 * GET /api/v1/departments
 * List active municipal departments
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const departments = await Department.find({ status: { $ne: "inactive" } })
      .populate("manager", "name email image role phone")
      .sort({ name: 1 })
      .lean();
    return new ApiResponse(200, { departments }, "Departments retrieved successfully").send(res);
  })
);

/**
 * GET /api/v1/departments/all
 * Admin route: List all departments (active and inactive) with metrics
 */
router.get(
  "/all",
  protect,
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const departments = await Department.find({})
      .populate("manager", "name email image role phone")
      .sort({ name: 1 })
      .lean();

    // Augment with staff and issues metrics
    const enrichedDepartments = await Promise.all(
      departments.map(async (dept) => {
        const [staffCount, activeIssuesCount, totalIssuesCount] = await Promise.all([
          User.countDocuments({ department: dept._id }),
          Issue.countDocuments({
            department: dept._id,
            status: { $in: ["Submitted", "Under Review", "Assigned", "In Progress"] },
          }),
          Issue.countDocuments({ department: dept._id }),
        ]);

        return {
          ...dept,
          metrics: {
            staffCount,
            activeIssuesCount,
            totalIssuesCount,
          },
        };
      })
    );

    return new ApiResponse(
      200,
      { departments: enrichedDepartments },
      "All departments and statistics retrieved successfully"
    ).send(res);
  })
);

/**
 * GET /api/v1/departments/managers/candidates
 * Admin route: Retrieve candidates eligible to be assigned as department managers
 */
router.get(
  "/managers/candidates",
  protect,
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const candidates = await User.find({
      role: { $in: ["manager", "admin"] },
      isActive: true,
    })
      .select("name email role image department phone")
      .populate("department", "name code")
      .sort({ name: 1 })
      .lean();

    return new ApiResponse(
      200,
      { candidates },
      "Manager candidates retrieved successfully"
    ).send(res);
  })
);

/**
 * GET /api/v1/departments/:id
 * Retrieve a specific department by ID
 */
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new ApiError(400, "Invalid department ID format");
    }

    const dept = await Department.findById(req.params.id)
      .populate("manager", "name email image role phone")
      .lean();

    if (!dept) {
      throw new ApiError(404, "Department not found");
    }

    const [staffCount, activeIssuesCount, totalIssuesCount] = await Promise.all([
      User.countDocuments({ department: dept._id }),
      Issue.countDocuments({
        department: dept._id,
        status: { $in: ["Submitted", "Under Review", "Assigned", "In Progress"] },
      }),
      Issue.countDocuments({ department: dept._id }),
    ]);

    return new ApiResponse(
      200,
      {
        department: {
          ...dept,
          metrics: {
            staffCount,
            activeIssuesCount,
            totalIssuesCount,
          },
        },
      },
      "Department details retrieved successfully"
    ).send(res);
  })
);

/**
 * POST /api/v1/departments
 * Admin route: Create a new municipal department
 */
router.post(
  "/",
  protect,
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const {
      name,
      code,
      description = "",
      contactEmail = null,
      contactPhone = null,
      manager = null,
      categories = [],
      status = "active",
    } = req.body;

    if (!name || !name.trim()) {
      throw new ApiError(400, "Department name is required");
    }
    if (!code || !code.trim()) {
      throw new ApiError(400, "Department code is required");
    }

    const formattedCode = code.trim().toUpperCase();
    const trimmedName = name.trim();

    // Check uniqueness
    const existing = await Department.findOne({
      $or: [{ name: trimmedName }, { code: formattedCode }],
    });

    if (existing) {
      if (existing.code === formattedCode) {
        throw new ApiError(409, `Department code '${formattedCode}' already exists`);
      }
      throw new ApiError(409, `Department name '${trimmedName}' already exists`);
    }

    // Validate manager candidate if provided
    let managerUser = null;
    if (manager) {
      if (!mongoose.Types.ObjectId.isValid(manager)) {
        throw new ApiError(400, "Invalid manager user ID format");
      }
      managerUser = await User.findById(manager);
      if (!managerUser) {
        throw new ApiError(404, "Assigned manager user not found");
      }
      if (!["manager", "admin"].includes(managerUser.role)) {
        throw new ApiError(
          400,
          `Cannot assign user with role '${managerUser.role}' as department head. Must be 'manager' or 'admin'.`
        );
      }
    }

    const newDept = await Department.create({
      name: trimmedName,
      code: formattedCode,
      description: description.trim(),
      contactEmail: contactEmail ? contactEmail.trim().toLowerCase() : null,
      contactPhone: contactPhone ? contactPhone.trim() : null,
      manager: managerUser ? managerUser._id : null,
      categories: Array.isArray(categories) ? categories : [],
      status: ["active", "inactive"].includes(status) ? status : "active",
    });

    // If manager was assigned, link department back to user
    if (managerUser) {
      await User.findByIdAndUpdate(managerUser._id, { department: newDept._id });
    }

    // Activity log
    await ActivityLog.create({
      user: req.user._id,
      action: "DEPARTMENT_CREATED",
      entityType: "Department",
      entityId: newDept._id,
      details: {
        name: newDept.name,
        code: newDept.code,
        manager: managerUser ? managerUser.name : "Unassigned",
      },
    });

    const populatedDept = await Department.findById(newDept._id)
      .populate("manager", "name email image role phone")
      .lean();

    return new ApiResponse(201, { department: populatedDept }, "Department created successfully").send(res);
  })
);

/**
 * PATCH /api/v1/departments/:id
 * Admin route: Update municipal department details or manager assignment
 */
router.patch(
  "/:id",
  protect,
  authorize("admin"),
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new ApiError(400, "Invalid department ID format");
    }

    const dept = await Department.findById(req.params.id);
    if (!dept) {
      throw new ApiError(404, "Department not found");
    }

    const {
      name,
      code,
      description,
      contactEmail,
      contactPhone,
      manager,
      categories,
      status,
    } = req.body;

    // Check code/name conflicts if updated
    if (code && code.trim().toUpperCase() !== dept.code) {
      const conflict = await Department.findOne({
        code: code.trim().toUpperCase(),
        _id: { $ne: dept._id },
      });
      if (conflict) {
        throw new ApiError(409, `Department code '${code.trim().toUpperCase()}' is already in use`);
      }
      dept.code = code.trim().toUpperCase();
    }

    if (name && name.trim() !== dept.name) {
      const conflict = await Department.findOne({
        name: name.trim(),
        _id: { $ne: dept._id },
      });
      if (conflict) {
        throw new ApiError(409, `Department name '${name.trim()}' is already in use`);
      }
      dept.name = name.trim();
    }

    if (description !== undefined) dept.description = description.trim();
    if (contactEmail !== undefined) {
      dept.contactEmail = contactEmail ? contactEmail.trim().toLowerCase() : null;
    }
    if (contactPhone !== undefined) {
      dept.contactPhone = contactPhone ? contactPhone.trim() : null;
    }
    if (categories !== undefined && Array.isArray(categories)) {
      dept.categories = categories;
    }
    if (status && ["active", "inactive"].includes(status)) {
      dept.status = status;
    }

    // Manager assignment update
    if (manager !== undefined) {
      if (manager === null || manager === "") {
        dept.manager = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(manager)) {
          throw new ApiError(400, "Invalid manager user ID format");
        }
        const managerUser = await User.findById(manager);
        if (!managerUser) {
          throw new ApiError(404, "Assigned manager user not found");
        }
        if (!["manager", "admin"].includes(managerUser.role)) {
          throw new ApiError(
            400,
            `Cannot assign user with role '${managerUser.role}' as department head. Must be 'manager' or 'admin'.`
          );
        }
        dept.manager = managerUser._id;
        // Sync department back to user
        await User.findByIdAndUpdate(managerUser._id, { department: dept._id });
      }
    }

    await dept.save();

    // Activity log
    await ActivityLog.create({
      user: req.user._id,
      action: "DEPARTMENT_UPDATED",
      entityType: "Department",
      entityId: dept._id,
      details: {
        name: dept.name,
        code: dept.code,
        status: dept.status,
      },
    });

    const updatedDept = await Department.findById(dept._id)
      .populate("manager", "name email image role phone")
      .lean();

    return new ApiResponse(200, { department: updatedDept }, "Department updated successfully").send(res);
  })
);

/**
 * DELETE /api/v1/departments/:id
 * Admin route: Deactivate or delete department
 */
router.delete(
  "/:id",
  protect,
  authorize("admin"),
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new ApiError(400, "Invalid department ID format");
    }

    const dept = await Department.findById(req.params.id);
    if (!dept) {
      throw new ApiError(404, "Department not found");
    }

    // Check if there are active issues assigned
    const activeIssuesCount = await Issue.countDocuments({
      department: dept._id,
      status: { $in: ["Submitted", "Under Review", "Assigned", "In Progress"] },
    });

    if (activeIssuesCount > 0) {
      throw new ApiError(
        400,
        `Cannot delete department with ${activeIssuesCount} active issues. Please reassign or resolve issues before deletion, or set status to 'inactive'.`
      );
    }

    // If force query is not set or there are legacy issues, soft-delete to inactive
    const totalIssues = await Issue.countDocuments({ department: dept._id });
    if (totalIssues > 0 && req.query.force !== "true") {
      dept.status = "inactive";
      await dept.save();

      return new ApiResponse(
        200,
        { department: dept, softDeleted: true },
        "Department has archived historical issues and was set to inactive"
      ).send(res);
    }

    await Department.findByIdAndDelete(dept._id);

    // Activity log
    await ActivityLog.create({
      user: req.user._id,
      action: "DEPARTMENT_DELETED",
      entityType: "Department",
      entityId: dept._id,
      details: {
        name: dept.name,
        code: dept.code,
      },
    });

    return new ApiResponse(200, { departmentId: dept._id }, "Department deleted permanently").send(res);
  })
);

module.exports = router;
