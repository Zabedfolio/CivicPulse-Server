const mongoose = require("mongoose");

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.warn("⚠️ MONGO_URI is not defined in environment variables. Database connection skipped.");
    return null;
  }

  try {
    const conn = await mongoose.connect(mongoUri, {
      autoIndex: process.env.NODE_ENV !== "production",
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }
    return null;
  }
};

module.exports = connectDB;
