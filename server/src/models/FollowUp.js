import mongoose from "mongoose";

const followUpSchema = new mongoose.Schema(
  {
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    followUpDate: { type: Date, required: true },
    followUpTime: { type: String, default: "" }, // e.g. "14:30"
    type: { type: String, enum: ["Call", "WhatsApp", "Meeting", "Other"], default: "Call" },
    notes: { type: String, default: "" },
    status: { type: String, enum: ["Pending", "Completed", "Missed"], default: "Pending" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

followUpSchema.index({ lead: 1 });
followUpSchema.index({ assignedTo: 1, status: 1 });
followUpSchema.index({ followUpDate: 1 });

export default mongoose.model("FollowUp", followUpSchema);
