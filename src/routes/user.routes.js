const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { z } = require("zod");
const User = require("../models/User");
const Department = require("../models/Department");
const Task = require("../models/Task");
const ActivityLog = require("../models/ActivityLog");
const { protect } = require("../middleware/auth");
const { authorize } = require("../middleware/roleCheck");
const ApiResponse = require("../utils/apiResponse");
const ApiError = require("../utils/apiError");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// Profile validation schema
const updateProfileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100).optional(),
  phone: z.string().max(25).optional().nullable(),
  image: z.string().url("Image must be a valid URL").optional().nullable(),
});

// Password change schema
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

/**
 * Helper to verify password against either bcrypt or scrypt hashes
 */
async function verifyStoredPassword(providedPassword, storedHash) {
  if (!storedHash) return false;

  // 1. Try bcrypt
  if (
    storedHash.startsWith("$2a$") ||
    storedHash.startsWith("$2b$") ||
    storedHash.startsWith("$2y$")
  ) {
    try {
      return await bcrypt.compare(providedPassword, storedHash);
    } catch {
      return false;
    }
  }

  // 2. Try scrypt format: salt:key
  if (storedHash.includes(":")) {
    try {
      const parts = storedHash.split(":");
      if (parts.length === 2) {
        const [salt, key] = parts;
        const keyBuffer = Buffer.from(key, "hex");
        const derivedKey = crypto.scryptSync(providedPassword, salt, keyBuffer.length);
        return crypto.timingSafeEqual(keyBuffer, derivedKey);
      }
    } catch {
      return false;
    }
  }

  // 3. Direct compare as fallback
  return providedPassword === storedHash;
}

/**
 * Helper to hash password with bcrypt
 */
async function hashPassword(plainPassword) {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(plainPassword, salt);
}

/**
 * PATCH /api/v1/users/me
 * Update authenticated user's name, phone, or avatar image
 */
router.patch(
  "/me",
  protect,
  asyncHandler(async (req, res) => {
    const validation = updateProfileSchema.safeParse(req.body);
    if (!validation.success) {
      throw new ApiError(400, "Validation failed", validation.error.errors);
    }

    const { name, phone, image } = validation.data;
    const updateFields = {};
    if (name !== undefined) updateFields.name = name;
    if (phone !== undefined) updateFields.phone = phone;
    if (image !== undefined) updateFields.image = image;

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      throw new ApiError(404, "User not found");
    }

    return new ApiResponse(
      200,
      { user: updatedUser },
      "Profile updated successfully"
    ).send(res);
  })
);

/**
 * PATCH /api/v1/users/me/password
 * Change password after validating current password
 */
router.patch(
  "/me/password",
  protect,
  asyncHandler(async (req, res) => {
    const validation = changePasswordSchema.safeParse(req.body);
    if (!validation.success) {
      throw new ApiError(400, "Validation failed", validation.error.errors);
    }

    const { currentPassword, newPassword } = validation.data;

    if (currentPassword === newPassword) {
      throw new ApiError(400, "New password must be different from current password");
    }

    const db = mongoose.connection.db;
    if (!db) {
      throw new ApiError(500, "Database connection is not ready");
    }

    // Lookup Better Auth account for user
    const userIdStr = req.user._id.toString();
    const account = await db.collection("account").findOne({
      $or: [{ userId: userIdStr }, { userId: req.user._id }],
    });

    if (!account || !account.password) {
      throw new ApiError(400, "Account does not have a credential password configured");
    }

    const isMatch = await verifyStoredPassword(currentPassword, account.password);
    if (!isMatch) {
      throw new ApiError(400, "Incorrect current password");
    }

    const newHashedPassword = await hashPassword(newPassword);

    await db.collection("account").updateOne(
      { _id: account._id },
      { $set: { password: newHashedPassword, updatedAt: new Date() } }
    );

    return new ApiResponse(200, null, "Password updated successfully").send(res);
  })
);

/**
 * GET /api/v1/users/staff
 * Retrieve staff technicians and department personnel
 * Scoped to department for managers, global for admins
 */
router.get(
  "/staff",
  protect,
  authorize("admin", "manager"),
  asyncHandler(async (req, res) => {
    const { search, department, status, role, page = 1, limit = 50 } = req.query;

    const filter = {
      role: { $in: ["staff", "manager"] },
    };

    if (role && ["staff", "manager"].includes(role)) {
      filter.role = role;
    }

    // Role-based department scoping
    if (req.user.role === "manager") {
      if (!req.user.department) {
        throw new ApiError(403, "Manager account has no assigned municipal department.");
      }
      filter.department = req.user.department;
    } else if (req.user.role === "admin") {
      if (department && department !== "all") {
        filter.department = department;
      }
    }

    // Active status filter
    if (status === "active") {
      filter.isActive = true;
    } else if (status === "inactive") {
      filter.isActive = false;
    }

    // Search query
    if (search && search.trim()) {
      const q = search.trim();
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [staffList, total] = await Promise.all([
      User.find(filter)
        .sort({ name: 1 })
        .skip(skip)
        .limit(limitNum)
        .populate("department", "name code")
        .lean(),
      User.countDocuments(filter),
    ]);

    // Augment staff with real-time active task loads
    const enrichedStaff = await Promise.all(
      staffList.map(async (member) => {
        const activeTasks = await Task.countDocuments({
          assignedTo: member._id,
          status: { $in: ["Pending", "In Progress"] },
        });

        const completedTasks = await Task.countDocuments({
          assignedTo: member._id,
          status: "Completed",
        });

        let capacityTier = "available";
        if (activeTasks >= 6) {
          capacityTier = "overloaded";
        } else if (activeTasks >= 3) {
          capacityTier = "busy";
        }

        return {
          ...member,
          activeTasks,
          completedTasks,
          capacityTier,
        };
      })
    );

    return new ApiResponse(
      200,
      {
        staff: enrichedStaff,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum) || 1,
        },
      },
      "Staff directory retrieved successfully"
    ).send(res);
  })
);

/**
 * POST /api/v1/users/staff
 * Onboard/Register a new staff member or technician
 */
router.post(
  "/staff",
  protect,
  authorize("admin", "manager"),
  asyncHandler(async (req, res) => {
    const { name, email, password, phone, department, role = "staff" } = req.body;

    if (!name || !name.trim()) {
      throw new ApiError(400, "Full name is required");
    }
    if (!email || !email.trim()) {
      throw new ApiError(400, "Valid email address is required");
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      throw new ApiError(409, `User with email '${normalizedEmail}' already exists`);
    }

    // Role assignment & department validation
    let targetRole = "staff";
    let targetDept = null;

    if (req.user.role === "manager") {
      // Manager can only onboard staff for their own department
      if (!req.user.department) {
        throw new ApiError(403, "Manager account has no assigned municipal department.");
      }
      targetDept = req.user.department;
      targetRole = "staff";
    } else if (req.user.role === "admin") {
      targetRole = ["staff", "manager"].includes(role) ? role : "staff";
      if (department) {
        if (!mongoose.Types.ObjectId.isValid(department)) {
          throw new ApiError(400, "Invalid department ID format");
        }
        const deptExists = await Department.findById(department);
        if (!deptExists) {
          throw new ApiError(404, "Target department not found");
        }
        targetDept = deptExists._id;
      }
    }

    const newUser = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      emailVerified: true,
      role: targetRole,
      department: targetDept,
      phone: phone ? phone.trim() : null,
      isActive: true,
    });

    // Create Better Auth credential account
    const initialPassword = password && password.length >= 8 ? password : "CivicPulse2026!";
    const hashedPassword = await hashPassword(initialPassword);

    const db = mongoose.connection.db;
    if (db) {
      await db.collection("account").insertOne({
        userId: newUser._id.toString(),
        accountId: newUser._id.toString(),
        providerId: "credential",
        password: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Activity log
    await ActivityLog.create({
      user: req.user._id,
      action: "STAFF_ONBOARDED",
      entityType: "User",
      entityId: newUser._id,
      details: {
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        department: targetDept,
      },
    });

    const populatedUser = await User.findById(newUser._id)
      .populate("department", "name code")
      .lean();

    return new ApiResponse(
      201,
      { user: populatedUser },
      "Staff member onboarded successfully"
    ).send(res);
  })
);

/**
 * PATCH /api/v1/users/staff/:id
 * Update staff details, account status, or department assignment
 */
router.patch(
  "/staff/:id",
  protect,
  authorize("admin", "manager"),
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new ApiError(400, "Invalid staff user ID format");
    }

    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      throw new ApiError(404, "Staff user not found");
    }

    // Scoping guards
    if (req.user.role === "manager") {
      if (
        !targetUser.department ||
        targetUser.department.toString() !== req.user.department?.toString()
      ) {
        throw new ApiError(
          403,
          "Department managers can only manage staff belonging to their assigned department."
        );
      }
    }

    const { name, phone, isActive, department, role } = req.body;

    if (name !== undefined) targetUser.name = name.trim();
    if (phone !== undefined) targetUser.phone = phone ? phone.trim() : null;
    if (isActive !== undefined) targetUser.isActive = Boolean(isActive);

    // Department & Role changes restricted to Admin
    if (req.user.role === "admin") {
      if (department !== undefined) {
        if (department === null || department === "") {
          targetUser.department = null;
        } else {
          if (!mongoose.Types.ObjectId.isValid(department)) {
            throw new ApiError(400, "Invalid department ID format");
          }
          const dept = await Department.findById(department);
          if (!dept) {
            throw new ApiError(404, "Specified department does not exist");
          }
          targetUser.department = dept._id;
        }
      }

      if (role && ["staff", "manager", "citizen", "admin"].includes(role)) {
        targetUser.role = role;
      }
    }

    await targetUser.save();

    // Activity log
    await ActivityLog.create({
      user: req.user._id,
      action: "STAFF_UPDATED",
      entityType: "User",
      entityId: targetUser._id,
      details: {
        name: targetUser.name,
        role: targetUser.role,
        isActive: targetUser.isActive,
        department: targetUser.department,
      },
    });

    const updated = await User.findById(targetUser._id)
      .populate("department", "name code")
      .lean();

    return new ApiResponse(200, { user: updated }, "Staff record updated successfully").send(res);
  })
);

/**
 * GET /api/v1/users/staff/:id/tasks
 * Retrieve tasks assigned to a specific staff member
 */
router.get(
  "/staff/:id/tasks",
  protect,
  authorize("admin", "manager"),
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new ApiError(400, "Invalid staff user ID format");
    }

    const tasks = await Task.find({ assignedTo: req.params.id })
      .sort({ createdAt: -1 })
      .populate("issue", "title category priority status location address")
      .populate("department", "name code")
      .lean();

    return new ApiResponse(200, { tasks }, "Staff task history retrieved successfully").send(res);
  })
);

module.exports = router;
