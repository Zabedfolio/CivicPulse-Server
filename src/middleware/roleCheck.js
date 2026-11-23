const ApiError = require("../utils/apiError");

/**
 * Restrict endpoint access to specified roles
 * @param  {...string} roles - e.g. 'admin', 'manager', 'staff', 'citizen'
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, "Authentication required. Please sign in."));
    }

    if (!roles.includes(req.user.role)) {
      return next(
        new ApiError(
          403,
          `Forbidden: Role '${req.user.role}' is not authorized to access this resource.`
        )
      );
    }

    next();
  };
};

module.exports = { authorize };
