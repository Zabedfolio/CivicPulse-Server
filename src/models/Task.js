const mongoose = require("mongoose");

const TASK_STATUSES = ["Pending", "In Progress", "Completed", "Cancelled"];
const TASK_PRIORITIES = ["low", "medium", "high", "critical"];

const TaskSchema = new mongoose.Schema(
  {
    issue: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Issue",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    instructions: {
      type: String,
      trim: true,
      default: "",
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: true,
      index: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: TASK_STATUSES,
      default: "Pending",
      index: true,
    },
    priority: {
      type: String,
      enum: TASK_PRIORITIES,
      default: "medium",
    },
    dueDate: {
      type: Date,
      default: null,
    },
    progressReports: [
      {
        note: {
          type: String,
          required: true,
          trim: true,
        },
        by: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    completionPhotos: [
      {
        url: {
          type: String,
          required: true,
        },
        publicId: {
          type: String,
          default: null,
        },
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for workload, status, and role-scoped queries
TaskSchema.index({ department: 1, status: 1, createdAt: -1 });
TaskSchema.index({ assignedTo: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Task", TaskSchema);
module.exports.TASK_STATUSES = TASK_STATUSES;
module.exports.TASK_PRIORITIES = TASK_PRIORITIES;
