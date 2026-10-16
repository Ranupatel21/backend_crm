import mongoose from "mongoose";

const whatsAppMessageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "WhatsAppConversation", required: true },
    direction: { type: String, enum: ["in", "out"], required: true },
    body: { type: String, default: "" },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    status: { type: String, enum: ["sent", "delivered", "read", "failed"], default: "sent" },
    whatsappMessageId: {
  type: String,
  default: null,
},
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

whatsAppMessageSchema.index({ conversation: 1, timestamp: 1 });

export default mongoose.model("WhatsAppMessage", whatsAppMessageSchema);
