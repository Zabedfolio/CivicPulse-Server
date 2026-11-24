const mongoose = require("mongoose");

const ISSUE_CATEGORIES = [
  "Road Damage",
  "Streetlight",
  "Drainage",
  "Footpath",
  "Waste Management",
  "Public Infrastructure",
];

const ISSUE_PRIORITIES = ["low", "medium", "high", "critical"];

const ISSUE_STATUSES = [
  "Submitted",
  "Under Review",
  "Assigned",
  "In Progress",
  "Resolved",
  "Closed",
];

const IssueSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 5,
      maxlength: 100,
    },
    description: {
      type: String,
      required: true,
      minlength: 15,
    },
    category: {
      type: String,
      enum: ISSUE_CATEGORIES,
      required: true,
      index: true,
    },
    priority: {
      type: String,
      enum: ISSUE_PRIORITIES,
      default: "medium",
      index: true,
    },
    status: {
      type: String,
      enum: ISSUE_STATUSES,
      default: "Submitted",
      index: true,
    },
    address: {
      type: String,
      required: true,
      trim: true,
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
        required: true,
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
        validate: {
          validator: function (val) {
            return (
              Array.isArray(val) &&
              val.length === 2 &&
              val[0] >= -180 &&
              val[0] <= 180 &&
              val[1] >= -90 &&
              val[1] <= 90
            );
          },
          message: "Coordinates must be [longitude (-180..180), latitude (-90..90)]",
        },
      },
    },
    image: {
      url: {
        type: String,
        default: null,
      },
      publicId: {
        type: String,
        default: null,
      },
    },
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
      index: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    isDuplicate: {
      type: Boolean,
      default: false,
      index: true,
    },
    isDuplicateOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Issue",
      default: null,
      index: true,
    },
    duplicateCount: {
      type: Number,
      default: 0,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    closedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// 2dsphere index for geospatial proximity queries
IssueSchema.index({ location: "2dsphere" });

// Compound index for role-scoped management queries (department, status, creation timestamp)
IssueSchema.index({ department: 1, status: 1, createdAt: -1 });
IssueSchema.index({ category: 1, priority: 1, createdAt: -1 });

module.exports = mongoose.model("Issue", IssueSchema);
module.exports.ISSUE_CATEGORIES = ISSUE_CATEGORIES;
module.exports.ISSUE_PRIORITIES = ISSUE_PRIORITIES;
module.exports.ISSUE_STATUSES = ISSUE_STATUSES;
