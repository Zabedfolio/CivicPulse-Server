const express = require("express");
const mongoose = require("mongoose");
const Task = require("../models/Task");
const Issue = require("../models/Issue");
const User = require("../models/User");
const Department = require("../models/Department");
const ActivityLog = require("../models/ActivityLog");
const IssueStatusHistory = require("../models/IssueStatusHistory");
const Notification = require("../models/Notification");
const { protect } = require("../middleware/auth");
const { authorize } = require("../middleware/roleCheck");
const { transitionIssueStatus } = require("../services/issueWorkflow");
const ApiResponse = require("../utils/apiResponse");
const ApiError = require("../utils/apiError");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// All task routes require authentication
router.use(protect);

/**
 * POST /api/v1/tasks
 * Create and dispatch a maintenance task for a verified issue to a field technician
 */
router.post(
  "/",
  authorize("manager", "admin"),
  asyncHandler(async (req, res) => {
    const { issueId, assignedTo, instructions, dueDate, priority, title } = req.body;

    if (!issueId) {
      throw new ApiError(400, "issueId is required to create a task.");
    }
    if (!assignedTo) {
      throw new ApiError(400, "assignedTo (staff user ID) is required.");
    }

    const [issue, staffUser] = await Promise.all([
      Issue.findById(issueId),
      User.findById(assignedTo),
    ]);

    if (!issue) {
      throw new ApiError(404, "Issue not found.");
    }
    if (!staffUser) {
      throw new ApiError(404, "Assigned staff technician not found.");
    }

    if (staffUser.role !== "staff") {
      throw new ApiError(400, "Tasks can only be assigned to users with the 'staff' role.");
    }

    if (!staffUser.isActive) {
      throw new ApiError(400, "Cannot assign tasks to a deactivated staff account.");
    }

    // Role-specific department guard for managers
    if (req.user.role === "manager") {
      if (
        req.user.department &&
        issue.department &&
        !issue.department.equals(req.user.department)
      ) {
        throw new ApiError(
          403,
          "Forbidden: You can only assign tasks for issues belonging to your department."
        );
      }
      if (
        req.user.department &&
        staffUser.department &&
        !staffUser.department.equals(req.user.department)
      ) {
        throw new ApiError(
          403,
          "Forbidden: You can only assign tasks to technicians in your own department."
        );
      }
    }

    const taskTitle = title?.trim() || `Maintenance: ${issue.title}`;
    const taskPriority = priority || issue.priority || "medium";
    const departmentId = issue.department || req.user.department;

    if (!departmentId) {
      throw new ApiError(400, "Issue has no associated department for task dispatch.");
    }

    const task = await Task.create({
      issue: issue._id,
      title: taskTitle,
      instructions: instructions?.trim() || "",
      department: departmentId,
      assignedTo: staffUser._id,
      assignedBy: req.user._id,
      status: "Pending",
      priority: taskPriority,
      dueDate: dueDate ? new Date(dueDate) : null,
    });

    // Update Issue assignment & transition status to "Assigned"
    issue.assignedTo = staffUser._id;
    await issue.save();

    if (issue.status === "Submitted" || issue.status === "Under Review") {
      try {
        await transitionIssueStatus(issue._id, "Assigned", req.user, {
          note: `Work order dispatched to ${staffUser.name}`,
        });
      } catch (workflowErr) {
        // Fallback status save if already at Assigned or direct update
        issue.status = "Assigned";
        await issue.save();
      }
    }

    // Activity log
    await ActivityLog.create({
      user: req.user._id,
      action: "TASK_CREATED",
      entityType: "Task",
      entityId: task._id,
      details: {
        issueId: issue._id,
        assignedTo: staffUser._id,
        technicianName: staffUser.name,
        dueDate: task.dueDate,
        priority: task.priority,
      },
    });

    // 1. In-app Notification to assigned Field Technician
    try {
      await Notification.create({
        user: staffUser._id,
        title: `New Work Order: "${taskTitle}"`,
        message: `You have been assigned to resolve ticket #${issue._id.toString().slice(-4)}. Due: ${
          task.dueDate ? task.dueDate.toLocaleDateString() : "ASAP"
        }`,
        type: "task_assigned",
        issue: issue._id,
      });
    } catch (notifErr) {
      console.warn("Staff notification notice:", notifErr.message);
    }

    // 2. In-app Notification to Citizen Reporter
    if (issue.reporter && (!req.user._id || !issue.reporter.equals(req.user._id))) {
      try {
        await Notification.create({
          user: issue.reporter,
          title: `Field Team Dispatched: "${issue.title}"`,
          message: `A municipal field engineering crew has been assigned to inspect and resolve your report.`,
          type: "status_change",
          issue: issue._id,
        });
      } catch (notifErr) {
        console.warn("Citizen notification notice:", notifErr.message);
      }
    }

    const populatedTask = await Task.findById(task._id)
      .populate("issue", "title category address priority status image location")
      .populate("assignedTo", "name email image role phone")
      .populate("assignedBy", "name email role")
      .populate("department", "name code")
      .lean();

    return new ApiResponse(
      201,
      { task: populatedTask },
      `Work order successfully dispatched to ${staffUser.name}`
    ).send(res);
  })
);

/**
 * GET /api/v1/tasks/workload
 * Real-time technician workload aggregation for the department
 */
router.get(
  "/workload",
  authorize("manager", "admin"),
  asyncHandler(async (req, res) => {
    let departmentFilter = {};

    if (req.user.role === "manager") {
      departmentFilter.department = req.user.department;
    } else if (req.query.departmentId && mongoose.Types.ObjectId.isValid(req.query.departmentId)) {
      departmentFilter.department = req.query.departmentId;
    }

    // 1. Fetch active technicians for the department
    const staffMembers = await User.find({
      role: "staff",
      isActive: true,
      ...departmentFilter,
    })
      .select("name email image phone department")
      .populate("department", "name code")
      .lean();

    if (staffMembers.length === 0) {
      return new ApiResponse(
        200,
        { staff: [], summary: { totalStaff: 0, availableCount: 0, busyCount: 0, overloadedCount: 0 } },
        "No staff members found for this department"
      ).send(res);
    }

    const staffIds = staffMembers.map((s) => s._id);

    // 2. Aggregate active and completed task counts per technician
    const taskCounts = await Task.aggregate([
      { $match: { assignedTo: { $in: staffIds } } },
      {
        $group: {
          _id: "$assignedTo",
          activeCount: {
            $sum: {
              $cond: [{ $in: ["$status", ["Pending", "In Progress"]] }, 1, 0],
            },
          },
          completedCount: {
            $sum: {
              $cond: [{ $eq: ["$status", "Completed"] }, 1, 0],
            },
          },
        },
      },
    ]);

    const countMap = new Map();
    taskCounts.forEach((c) => {
      countMap.set(c._id.toString(), {
        activeCount: c.activeCount || 0,
        completedCount: c.completedCount || 0,
      });
    });

    let availableCount = 0;
    let busyCount = 0;
    let overloadedCount = 0;

    const staffWithWorkload = staffMembers.map((staff) => {
      const counts = countMap.get(staff._id.toString()) || { activeCount: 0, completedCount: 0 };
      const active = counts.activeCount;

      let tier = "available";
      if (active >= 6) {
        tier = "overloaded";
        overloadedCount++;
      } else if (active >= 3) {
        tier = "busy";
        busyCount++;
      } else {
        tier = "available";
        availableCount++;
      }

      return {
        ...staff,
        activeCount: active,
        completedCount: counts.completedCount,
        tier,
      };
    });

    // Sort technicians with lowest active workload first
    staffWithWorkload.sort((a, b) => a.activeCount - b.activeCount);

    return new ApiResponse(
      200,
      {
        staff: staffWithWorkload,
        summary: {
          totalStaff: staffMembers.length,
          availableCount,
          busyCount,
          overloadedCount,
        },
      },
      "Technician workload aggregated successfully"
    ).send(res);
  })
);

/**
 * GET /api/v1/tasks/staff
 * Simple roster list of department technicians for assignment dropdowns
 */
router.get(
  "/staff",
  authorize("manager", "admin"),
  asyncHandler(async (req, res) => {
    let departmentFilter = {};
    if (req.user.role === "manager") {
      departmentFilter.department = req.user.department;
    } else if (req.query.departmentId && mongoose.Types.ObjectId.isValid(req.query.departmentId)) {
      departmentFilter.department = req.query.departmentId;
    }

    const staff = await User.find({
      role: "staff",
      isActive: true,
      ...departmentFilter,
    })
      .select("name email image phone department")
      .populate("department", "name code")
      .lean();

    return new ApiResponse(200, { staff }, "Staff roster retrieved successfully").send(res);
  })
);

/**
 * GET /api/v1/tasks
 * Fetch role-scoped list of tasks with filtering and pagination
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status, priority, page = 1, limit = 20, assignedTo } = req.query;

    const filter = {};

    // Role-scoping
    if (req.user.role === "staff") {
      filter.assignedTo = req.user._id;
    } else if (req.user.role === "manager") {
      if (req.user.department) filter.department = req.user.department;
      if (assignedTo && mongoose.Types.ObjectId.isValid(assignedTo)) {
        filter.assignedTo = assignedTo;
      }
    } else if (req.user.role === "admin") {
      if (req.query.departmentId && mongoose.Types.ObjectId.isValid(req.query.departmentId)) {
        filter.department = req.query.departmentId;
      }
      if (assignedTo && mongoose.Types.ObjectId.isValid(assignedTo)) {
        filter.assignedTo = assignedTo;
      }
    } else {
      throw new ApiError(403, "Citizens cannot view internal maintenance task rosters.");
    }

    if (status && status !== "all" && Task.TASK_STATUSES.includes(status)) {
      filter.status = status;
    }
    if (priority && priority !== "all" && Task.TASK_PRIORITIES.includes(priority)) {
      filter.priority = priority;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [tasks, total] = await Promise.all([
      Task.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("issue", "title category address priority status image location")
        .populate("assignedTo", "name email image role phone")
        .populate("assignedBy", "name email role")
        .populate("department", "name code")
        .lean(),
      Task.countDocuments(filter),
    ]);

    return new ApiResponse(
      200,
      {
        tasks,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum) || 1,
        },
      },
      "Tasks retrieved successfully"
    ).send(res);
  })
);

/**
 * GET /api/v1/tasks/:id
 * Retrieve specific task details
 */
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const task = await Task.findById(req.params.id)
      .populate("issue", "title description category address priority status image location reporter")
      .populate("assignedTo", "name email image role phone department")
      .populate("assignedBy", "name email role")
      .populate("department", "name code contactEmail contactPhone")
      .lean();

    if (!task) {
      throw new ApiError(404, "Task not found.");
    }

    // Role security check
    if (req.user.role === "staff") {
      if (!task.assignedTo || !task.assignedTo._id.equals(req.user._id)) {
        throw new ApiError(403, "Forbidden: You can only view tasks assigned to you.");
      }
    } else if (req.user.role === "manager") {
      if (
        req.user.department &&
        task.department &&
        !task.department._id.equals(req.user.department)
      ) {
        throw new ApiError(403, "Forbidden: You can only view tasks within your department.");
      }
    }

    return new ApiResponse(200, { task }, "Task details retrieved successfully").send(res);
  })
);

module.exports = router;
