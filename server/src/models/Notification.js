import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["new_lead", "missed_call", "whatsapp"], required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

export default mongoose.model("Notification", notificationSchema);
