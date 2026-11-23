const mongoose = require("mongoose");
const User = require("../models/User");
const ApiError = require("../utils/apiError");
const asyncHandler = require("../utils/asyncHandler");

/**
 * Protect middleware: validates Better Auth session token
 * Accepts cookie `better-auth.session_token` or `Authorization: Bearer <token>`
 */
const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.cookies && req.cookies["better-auth.session_token"]) {
    token = req.cookies["better-auth.session_token"];
  } else if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    throw new ApiError(401, "Authentication required. Please sign in.");
  }

  const db = mongoose.connection.db;
  if (!db) {
    throw new ApiError(500, "Database connection is not ready.");
  }

  // Lookup active session in Better Auth session collection
  const session = await db.collection("session").findOne({
    token: token,
    expiresAt: { $gt: new Date() },
  });

  if (!session) {
    throw new ApiError(401, "Session is invalid or has expired. Please sign in again.");
  }

  // Find user by userId
  let user = null;
  if (mongoose.Types.ObjectId.isValid(session.userId)) {
    user = await User.findById(session.userId);
  }
  if (!user) {
    user = await User.findOne({ _id: session.userId });
  }

  if (!user) {
    throw new ApiError(401, "The user account for this session no longer exists.");
  }

  if (!user.isActive) {
    throw new ApiError(403, "Account has been deactivated. Please contact an administrator.");
  }

  req.user = user;
  req.session = session;
  next();
});

/**
 * Optional Auth middleware:
 * Populates req.user if a valid Better Auth session token or cookie is supplied,
 * but allows the request to proceed if unauthenticated.
 */
const optionalAuth = asyncHandler(async (req, res, next) => {
  let token;

  if (req.cookies && req.cookies["better-auth.session_token"]) {
    token = req.cookies["better-auth.session_token"];
  } else if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return next();
  }

  try {
    const db = mongoose.connection.db;
    if (!db) return next();

    const session = await db.collection("session").findOne({
      token: token,
      expiresAt: { $gt: new Date() },
    });

    if (!session) return next();

    let user = null;
    if (mongoose.Types.ObjectId.isValid(session.userId)) {
      user = await User.findById(session.userId);
    }
    if (!user) {
      user = await User.findOne({ _id: session.userId });
    }

    if (user && user.isActive) {
      req.user = user;
      req.session = session;
    }
  } catch (err) {
    // Continue without user if session lookup fails
  }

  next();
});

module.exports = { protect, optionalAuth };
