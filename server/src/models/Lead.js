import mongoose from "mongoose";

const leadSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    // Internal lookup key; the original phone stays untouched for display.
    phoneNormalized: { type: String, default: "", select: false },
    alternativePhone: { type: String, trim: true, default: "" },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
      validate: {
        validator: function (v) {
          if (!v) return true; // optional
          return /^\S+@\S+\.\S+$/.test(v);
        },
        message: "Please enter a valid email",
      },
    },
    leadSource: {
      type: String,
      enum: [
        "WhatsApp", "Facebook", "Website", "Excel Import",
        "Referral", "Instagram", "Other",
      ],
      default: "Other",
    },
    state: { type: String, trim: true, default: "" },
    product: { type: String, default: "HYCO Fabric Whitener" },
    quantity: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    pincode: {
      type: String,
      trim: true,
      default: "",
      validate: {
        validator: function (v) {
          if (!v) return true;
          return /^\d{4,8}$/.test(v);
        },
        message: "Pincode must be numeric (4-8 digits)",
      },
    },
    priority: { type: String, enum: ["Low", "Medium", "High"], default: "Medium" },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    status: {
      type: String,
      enum: ["New", "Contacted", "Interested", "Follow Up", "Won", "Lost"],
      default: "New",
    },
    notes: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Excel import source tracking
    importSource: {
      fileName: { type: String, default: "" },
      sheetName: { type: String, default: "" },
      rowNumber: { type: Number, default: null },
      importBatchId: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

leadSchema.pre("validate", function (next) {
  this.phoneNormalized = String(this.phone || "").replace(/\D/g, "");
  next();
});

leadSchema.index({ name: "text", phone: "text", alternativePhone: "text", email: "text" });
leadSchema.index({ status: 1 });
leadSchema.index({ assignedTo: 1 });
leadSchema.index({ leadSource: 1 });
leadSchema.index({ state: 1 });
leadSchema.index({ priority: 1 });
leadSchema.index({ createdAt: -1 });
leadSchema.index({ phone: 1 });
leadSchema.index({ phoneNormalized: 1 });

export default mongoose.model("Lead", leadSchema);
