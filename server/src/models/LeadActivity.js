import mongoose from "mongoose";

const leadActivitySchema = new mongoose.Schema(
  {
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    type: {
      type: String,
      enum: [
        "Lead Created", "Lead Assigned", "Lead Reassigned", "Status Changed",
        "Follow-up Added", "Follow-up Completed", "Note Added", "WhatsApp Message",
        "Lead Updated", "Call Logged",
      ],
      required: true,
    },
    description: { type: String, default: "" },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

leadActivitySchema.index({ lead: 1, createdAt: -1 });

export default mongoose.model("LeadActivity", leadActivitySchema);
