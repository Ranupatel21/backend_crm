import mongoose from "mongoose";

export const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI //||// "mongodb://127.0.0.1:27017/hyco_crm";
    await mongoose.connect(uri);
    console.log(`[MongoDB] Connected: ${mongoose.connection.host}`);
  } catch (err) {
    console.error(`[MongoDB] Connection error: ${err.message}`);
    process.exit(1);
  }
};
