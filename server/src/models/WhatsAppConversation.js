import mongoose from "mongoose";

const whatsAppConversationSchema = new mongoose.Schema(
  {
    // Kis user's WhatsApp account se conversation belong karti hai
    whatsappUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      default: null,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    lastMessageAt: {
      type: Date,
      default: Date.now,
    },

    lastMessagePreview: {
      type: String,
      default: "",
    },
    contactName: {
  type: String,
  default: "",
  trim: true,
},
  },
  { timestamps: true }
);

whatsAppConversationSchema.index({
  whatsappUser: 1,
  phone: 1,
});

whatsAppConversationSchema.index({
  assignedTo: 1,
});

whatsAppConversationSchema.index({
  whatsappUser: 1,
  lastMessageAt: -1,
});

export default mongoose.model(
  "WhatsAppConversation",
  whatsAppConversationSchema
);