import mongoose from "mongoose";

const callActivitySchema = new mongoose.Schema(
  {
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    direction: { type: String, enum: ["outbound", "inbound"], default: "outbound" },
    outcome: {
      type: String,
      enum: ["Connected", "No Answer", "Busy", "Wrong Number", "Failed"],
      required: true,
    },
    durationSeconds: { type: Number, min: 0, default: 0 },
    notes: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

callActivitySchema.index({ user: 1, createdAt: -1 });
callActivitySchema.index({ lead: 1, createdAt: -1 });

export default mongoose.model("CallActivity", callActivitySchema);
