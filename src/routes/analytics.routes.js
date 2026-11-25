const express = require("express");
const mongoose = require("mongoose");
const Issue = require("../models/Issue");
const Task = require("../models/Task");
const Department = require("../models/Department");
const Feedback = require("../models/Feedback");
const User = require("../models/User");
const ApiResponse = require("../utils/apiResponse");
const ApiError = require("../utils/apiError");
const asyncHandler = require("../utils/asyncHandler");
const { protect } = require("../middleware/auth");
const { authorize } = require("../middleware/roleCheck");

const router = express.Router();

const SLA_HOURS_BY_PRIORITY = {
  critical: 24,
  high: 48,
  medium: 72,
  low: 120,
};

const ALL_STATUSES = [
  "Submitted",
  "Under Review",
  "Assigned",
  "In Progress",
  "Resolved",
  "Closed",
];

const ALL_CATEGORIES = [
  "Road Damage",
  "Streetlight",
  "Drainage",
  "Footpath",
  "Waste Management",
  "Public Infrastructure",
];

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Resolves the department filter based on user role and optional query param.
 * Managers are strictly scoped to their assigned department.
 */
function resolveDepartmentScope(req) {
  if (req.user.role === "manager") {
    if (!req.user.department) {
      throw new ApiError(403, "Manager account has no assigned department.");
    }
    return new mongoose.Types.ObjectId(req.user.department);
  }

  const { department } = req.query;
  if (department && department !== "all") {
    if (!mongoose.Types.ObjectId.isValid(department)) {
      throw new ApiError(400, "Invalid department ID filter.");
    }
    return new mongoose.Types.ObjectId(department);
  }

  return null;
}

// All analytics routes require authenticated Admin or Manager
router.use(protect, authorize("admin", "manager"));

/**
 * GET /api/v1/analytics/overview
 * City-wide or department-scoped KPI metrics, status counts, SLA compliance, and citizen rating.
 */
router.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const deptId = resolveDepartmentScope(req);
    const issueMatch = deptId ? { department: deptId } : {};
    const taskMatch = deptId
      ? { department: deptId, status: { $in: ["Pending", "In Progress"] } }
      : { status: { $in: ["Pending", "In Progress"] } };
    const feedbackMatch = deptId ? { department: deptId } : {};

    const [statusAgg, resolutionAgg, activeTasks, feedbackAgg] = await Promise.all([
      Issue.aggregate([
        { $match: issueMatch },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Issue.aggregate([
        {
          $match: {
            ...issueMatch,
            status: { $in: ["Resolved", "Closed"] },
            resolvedAt: { $ne: null },
          },
        },
        {
          $project: {
            priority: 1,
            hoursToResolve: {
              $divide: [{ $subtract: ["$resolvedAt", "$createdAt"] }, 3600000],
            },
          },
        },
      ]),
      Task.countDocuments(taskMatch),
      Feedback.aggregate([
        { $match: feedbackMatch },
        {
          $group: {
            _id: null,
            avgRating: { $avg: "$rating" },
            totalReviews: { $sum: 1 },
          },
        },
      ]),
    ]);

    const statusCounts = ALL_STATUSES.reduce((acc, s) => {
      acc[s] = 0;
      return acc;
    }, {});

    let totalIssues = 0;
    for (const item of statusAgg) {
      if (item._id && statusCounts[item._id] !== undefined) {
        statusCounts[item._id] = item.count;
      }
      totalIssues += item.count;
    }

    const pendingTriage = statusCounts["Submitted"] + statusCounts["Under Review"];
    const activeRepairs = statusCounts["Assigned"] + statusCounts["In Progress"];
    const resolvedComplaints = statusCounts["Resolved"] + statusCounts["Closed"];
    const resolutionRate =
      totalIssues > 0 ? Number(((resolvedComplaints / totalIssues) * 100).toFixed(1)) : 0;

    let avgResolutionHours = 0;
    let slaComplianceRate = 0;
    if (resolutionAgg.length > 0) {
      let totalHours = 0;
      let slaMetCount = 0;
      for (const r of resolutionAgg) {
        const hrs = Math.max(0, r.hoursToResolve || 0);
        totalHours += hrs;
        const target = SLA_HOURS_BY_PRIORITY[r.priority] || 72;
        if (hrs <= target) slaMetCount += 1;
      }
      avgResolutionHours = Number((totalHours / resolutionAgg.length).toFixed(1));
      slaComplianceRate = Number(((slaMetCount / resolutionAgg.length) * 100).toFixed(1));
    }

    const citizenSatisfaction =
      feedbackAgg.length > 0
        ? {
            avgRating: Number((feedbackAgg[0].avgRating || 0).toFixed(2)),
            totalReviews: feedbackAgg[0].totalReviews || 0,
          }
        : { avgRating: 0, totalReviews: 0 };

    return new ApiResponse(
      200,
      {
        overview: {
          totalIssues,
          pendingTriage,
          activeRepairs,
          resolvedComplaints,
          resolutionRate,
          activeTasks,
          avgResolutionHours,
          slaComplianceRate,
          citizenSatisfaction,
          statusCounts,
        },
      },
      "Executive analytics overview retrieved successfully"
    ).send(res);
  })
);

/**
 * GET /api/v1/analytics/monthly-trends
 * Compares monthly reported vs resolved issues over the last N months (default 6).
 */
router.get(
  "/monthly-trends",
  asyncHandler(async (req, res) => {
    const deptId = resolveDepartmentScope(req);
    const monthsCount = Math.min(12, Math.max(3, parseInt(req.query.months, 10) || 6));

    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - (monthsCount - 1), 1);
    const baseMatch = deptId ? { department: deptId } : {};

    const [reportedAgg, resolvedAgg] = await Promise.all([
      Issue.aggregate([
        { $match: { ...baseMatch, createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
      ]),
      Issue.aggregate([
        {
          $match: {
            ...baseMatch,
            resolvedAt: { $gte: startDate, $ne: null },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$resolvedAt" },
              month: { $month: "$resolvedAt" },
            },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const reportedMap = new Map();
    for (const r of reportedAgg) {
      reportedMap.set(`${r._id.year}-${r._id.month}`, r.count);
    }

    const resolvedMap = new Map();
    for (const r of resolvedAgg) {
      resolvedMap.set(`${r._id.year}-${r._id.month}`, r.count);
    }

    const trends = [];
    for (let i = monthsCount - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const monthNum = d.getMonth() + 1;
      const key = `${year}-${monthNum}`;
      const shortMonth = MONTH_NAMES[d.getMonth()];
      trends.push({
        month: `${shortMonth} ${year}`,
        shortMonth,
        reported: reportedMap.get(key) || 0,
        resolved: resolvedMap.get(key) || 0,
      });
    }

    return new ApiResponse(
      200,
      { trends },
      "Monthly incident trends retrieved successfully"
    ).send(res);
  })
);

/**
 * GET /api/v1/analytics/category-distribution
 * Aggregates issue counts and resolved proportions across the 6 municipal categories.
 */
router.get(
  "/category-distribution",
  asyncHandler(async (req, res) => {
    const deptId = resolveDepartmentScope(req);
    const matchStage = deptId ? { department: deptId } : {};

    const agg = await Issue.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
          resolved: {
            $sum: {
              $cond: [{ $in: ["$status", ["Resolved", "Closed"]] }, 1, 0],
            },
          },
        },
      },
    ]);

    const aggMap = new Map();
    let total = 0;
    for (const row of agg) {
      aggMap.set(row._id, row);
      total += row.count;
    }

    const distribution = ALL_CATEGORIES.map((category) => {
      const row = aggMap.get(category) || { count: 0, resolved: 0 };
      return {
        category,
        count: row.count,
        resolved: row.resolved,
        active: row.count - row.resolved,
        percentage: total > 0 ? Number(((row.count / total) * 100).toFixed(1)) : 0,
      };
    }).sort((a, b) => b.count - a.count);

    return new ApiResponse(
      200,
      { distribution, total },
      "Category distribution retrieved successfully"
    ).send(res);
  })
);

/**
 * GET /api/v1/analytics/department-performance
 * Comparative leaderboard across municipal departments (Admin sees all; Manager sees own).
 */
router.get(
  "/department-performance",
  asyncHandler(async (req, res) => {
    const deptFilter =
      req.user.role === "manager" && req.user.department
        ? { _id: req.user.department }
        : { status: { $ne: "inactive" } };

    const departments = await Department.find(deptFilter).sort({ name: 1 }).lean();

    const performance = await Promise.all(
      departments.map(async (dept) => {
        const [issueStats, resolvedDocs, feedbackStats, staffCount] = await Promise.all([
          Issue.aggregate([
            { $match: { department: dept._id } },
            {
              $group: {
                _id: null,
                totalAssigned: { $sum: 1 },
                resolved: {
                  $sum: {
                    $cond: [{ $in: ["$status", ["Resolved", "Closed"]] }, 1, 0],
                  },
                },
                active: {
                  $sum: {
                    $cond: [
                      { $in: ["$status", ["Submitted", "Under Review", "Assigned", "In Progress"]] },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ]),
          Issue.find({
            department: dept._id,
            status: { $in: ["Resolved", "Closed"] },
            resolvedAt: { $ne: null },
          })
            .select("createdAt resolvedAt")
            .lean(),
          Feedback.aggregate([
            { $match: { department: dept._id } },
            {
              $group: {
                _id: null,
                avgRating: { $avg: "$rating" },
                reviewsCount: { $sum: 1 },
              },
            },
          ]),
          User.countDocuments({ department: dept._id, role: "staff", isActive: true }),
        ]);

        const totalAssigned = issueStats[0]?.totalAssigned || 0;
        const resolved = issueStats[0]?.resolved || 0;
        const active = issueStats[0]?.active || 0;
        const resolutionRate =
          totalAssigned > 0 ? Number(((resolved / totalAssigned) * 100).toFixed(1)) : 0;

        let avgResolutionHours = 0;
        if (resolvedDocs.length > 0) {
          const sumHours = resolvedDocs.reduce((acc, doc) => {
            const diff = (new Date(doc.resolvedAt) - new Date(doc.createdAt)) / 3600000;
            return acc + Math.max(0, diff);
          }, 0);
          avgResolutionHours = Number((sumHours / resolvedDocs.length).toFixed(1));
        }

        const citizenRating = feedbackStats[0]?.avgRating
          ? Number(feedbackStats[0].avgRating.toFixed(2))
          : 0;

        return {
          _id: dept._id,
          name: dept.name,
          code: dept.code,
          totalAssigned,
          resolved,
          active,
          resolutionRate,
          avgResolutionHours,
          citizenRating,
          reviewsCount: feedbackStats[0]?.reviewsCount || 0,
          staffCount,
        };
      })
    );

    performance.sort((a, b) => b.resolutionRate - a.resolutionRate || b.totalAssigned - a.totalAssigned);

    return new ApiResponse(
      200,
      { departments: performance },
      "Department performance leaderboard retrieved successfully"
    ).send(res);
  })
);

module.exports = router;
