const Issue = require("../models/Issue");
const IssueStatusHistory = require("../models/IssueStatusHistory");
const ActivityLog = require("../models/ActivityLog");
const Notification = require("../models/Notification");
const ApiError = require("../utils/apiError");

/**
 * Authoritative Finite State Machine Transition Rules
 */
const TRANSITION_RULES = {
  Submitted: {
    next: ["Under Review", "Closed"],
    allowedRoles: ["manager", "admin"],
  },
  "Under Review": {
    next: ["Assigned", "Closed"],
    allowedRoles: ["manager", "admin"],
  },
  Assigned: {
    next: ["In Progress", "Under Review", "Closed"],
    allowedRoles: ["staff", "manager", "admin"],
  },
  "In Progress": {
    next: ["Resolved", "Assigned", "Closed"],
    allowedRoles: ["staff", "manager", "admin"],
  },
  Resolved: {
    next: ["Closed", "In Progress"],
    allowedRoles: ["manager", "admin"],
  },
  Closed: {
    next: ["Under Review"], // Super Admin re-open override
    allowedRoles: ["admin"],
  },
};

/**
 * Transition issue status with strict deterministic validation, audit history, and notification
 * @param {string|ObjectId} issueId - Target issue ID
 * @param {string} toStatus - Desired destination status
 * @param {Object} user - Authenticated user executing the transition (req.user)
 * @param {Object} options - Optional { note, metadata }
 * @returns {Promise<Object>} Updated and populated issue document
 */
async function transitionIssueStatus(issueId, toStatus, user, { note, metadata } = {}) {
  if (!user) {
    throw new ApiError(401, "Authentication required to perform status transition.");
  }

  const issue = await Issue.findById(issueId);
  if (!issue) {
    throw new ApiError(404, "Issue not found.");
  }

  const fromStatus = issue.status;

  // Idempotent: if already in the target status, return cleanly
  if (fromStatus === toStatus) {
    return issue;
  }

  // 1. Validate status step against Finite State Machine
  const rule = TRANSITION_RULES[fromStatus];
  if (!rule || !rule.next.includes(toStatus)) {
    const allowed = rule ? rule.next.join(", ") : "none";
    throw new ApiError(
      400,
      `Illegal status transition: cannot move issue from '${fromStatus}' to '${toStatus}'. Allowed next steps: ${allowed}`
    );
  }

  // 2. Validate role authorization for this transition
  if (!rule.allowedRoles.includes(user.role)) {
    throw new ApiError(
      403,
      `Forbidden: Role '${user.role}' is not authorized to transition issue from '${fromStatus}' to '${toStatus}'. Required role: ${rule.allowedRoles.join(" or ")}`
    );
  }

  // 3. Role-specific department guard for Managers
  if (user.role === "manager") {
    if (user.department && issue.department && !issue.department.equals(user.department)) {
      throw new ApiError(
        403,
        "Forbidden: You can only transition issues belonging to your assigned department."
      );
    }
  }

  // 4. Role-specific assignment guard for Field Staff
  if (user.role === "staff") {
    if (issue.assignedTo && !issue.assignedTo.equals(user._id)) {
      throw new ApiError(
        403,
        "Forbidden: You can only transition issues explicitly assigned to your workload."
      );
    }
  }

  // 5. Apply status change and timestamps
  issue.status = toStatus;

  if (toStatus === "Resolved") {
    issue.resolvedAt = new Date();
  } else if (toStatus === "Closed") {
    issue.closedAt = new Date();
  } else if (toStatus === "Under Review") {
    issue.verifiedBy = user._id;
  }

  await issue.save();

  const transitionNote = note?.trim() || `Status moved from ${fromStatus} to ${toStatus}`;

  // 6. Record immutable IssueStatusHistory audit log
  await IssueStatusHistory.create({
    issue: issue._id,
    fromStatus,
    toStatus,
    changedBy: user._id,
    note: transitionNote,
  });

  // 7. Record system ActivityLog
  await ActivityLog.create({
    user: user._id,
    action: "STATUS_TRANSITION",
    entityType: "Issue",
    entityId: issue._id,
    details: {
      fromStatus,
      toStatus,
      note: transitionNote,
      metadata: metadata || {},
    },
  });

  // 8. Dispatch in-app Notification to the reporting citizen
  if (issue.reporter && (!user._id || !issue.reporter.equals(user._id))) {
    try {
      await Notification.create({
        user: issue.reporter,
        title: `Issue ${toStatus}: "${issue.title}"`,
        message: `Your reported public works ticket has transitioned to "${toStatus}". ${transitionNote}`,
        type: "status_change",
        issue: issue._id,
      });
    } catch (notifErr) {
      console.warn("Notification dispatch notice:", notifErr.message);
    }
  }

  // Return populated issue document
  return Issue.findById(issue._id)
    .populate("reporter", "name email image role")
    .populate("department", "name code")
    .populate("assignedTo", "name email image")
    .populate("verifiedBy", "name email role")
    .lean();
}

module.exports = {
  TRANSITION_RULES,
  transitionIssueStatus,
};
