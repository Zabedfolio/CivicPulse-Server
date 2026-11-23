const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { z } = require("zod");
const User = require("../models/User");
const { protect } = require("../middleware/auth");
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

module.exports = router;
