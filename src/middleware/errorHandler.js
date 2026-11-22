const ApiError = require("../utils/apiError");

const errorHandler = (err, req, res, next) => {
  let error = err;

  // Handle Mongoose CastError (invalid ObjectId)
  if (err.name === "CastError") {
    const message = `Resource not found with id: ${err.value}`;
    error = new ApiError(404, message);
  }

  // Handle Mongoose duplicate key error (code 11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || "field";
    const message = `Duplicate value entered for ${field}. Please use another value.`;
    error = new ApiError(409, message);
  }

  // Handle Mongoose Validation Error
  if (err.name === "ValidationError") {
    const message = Object.values(err.errors)
      .map((val) => val.message)
      .join(", ");
    error = new ApiError(400, message);
  }

  // Handle JSON parse error from express.json()
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    error = new ApiError(400, "Invalid JSON payload format");
  }

  const statusCode = error.statusCode || 500;
  const message = error.message || "Internal Server Error";
  const errors = error.errors || [];

  return res.status(statusCode).json({
    success: false,
    message,
    ...(errors.length > 0 ? { errors } : {}),
    ...(process.env.NODE_ENV === "development" ? { stack: error.stack } : {}),
  });
};

module.exports = errorHandler;
