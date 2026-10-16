import Lead from "../models/Lead.js";
import LeadActivity from "../models/LeadActivity.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const logActivity = async (leadId, userId, type, description, meta = {}) => {
  await LeadActivity.create({ lead: leadId, user: userId, type, description, meta });
};

// Restrict a query to what the requesting user is allowed to see
const applyScope = (filter, user) => {
  if (user.role === "sales_employee") {
    filter.assignedTo = user._id;
  }
  // managers & super_admin see everything (team / overall) for now
  return filter;
};

// @desc  Create a lead
// @route POST /api/leads
export const createLead = asyncHandler(async (req, res) => {
const payload = {
  ...req.body,
  createdBy: req.user._id,
};

if (!payload.assignedTo) {
  payload.assignedTo = null;
}

  // Assignment is a permissioned action, not a field the client may spoof.
  if (req.user.role === "sales_employee") {
    if (payload.assignedTo && String(payload.assignedTo) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "You cannot assign a lead to another user" });
    }
    payload.assignedTo = req.user._id;
  } else if (payload.assignedTo) {
    const assignee = await User.findOne({ _id: payload.assignedTo, role: "sales_employee", isActive: true });
    if (!assignee) {
      return res.status(400).json({ success: false, message: "Assigned user must be an active sales employee" });
    }
  }

  const lead = await Lead.create(payload);

  await logActivity(lead._id, req.user._id, "Lead Created", `Lead created by ${req.user.name}`);

  if (lead.assignedTo) {
    await logActivity(lead._id, req.user._id, "Lead Assigned", `Assigned to a sales employee`);
    await Notification.create({
      recipient: lead.assignedTo,
      type: "new_lead",
      title: "New Lead",
      message: `A new lead (${lead.name || lead.phone || "Unnamed"}) has been assigned to you`,
      lead: lead._id,
    });
  }

  res.status(201).json({ success: true, lead });
});

// @desc  Get leads with search, filters & pagination
// @route GET /api/leads
export const getLeads = asyncHandler(async (req, res) => {
  const {
    search, status, leadSource, state, priority, assignedTo, product,
    dateFrom, dateTo, view, page = 1, limit = 20, sortBy = "createdAt", sortDir = "desc",
  } = req.query;

  let filter = {};
  applyScope(filter, req.user);

  if (view === "my") filter.assignedTo = req.user._id;
  if (view === "active") filter.status = { $nin: ["Won", "Lost"] };
  if (view === "unassigned") filter.assignedTo = null;

  if (status) filter.status = status;
  if (leadSource) filter.leadSource = leadSource;
  if (state) filter.state = state;
  if (priority) filter.priority = priority;
  if (product) filter.product = product;
  if (assignedTo) filter.assignedTo = assignedTo;

  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }

  if (search) {
    const regex = { $regex: search, $options: "i" };
    filter.$or = [
      { name: regex },
      { phone: regex },
      { alternativePhone: regex },
      { email: regex },
    ];
  }

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const skip = (pageNum - 1) * limitNum;
  const sort = { [sortBy]: sortDir === "asc" ? 1 : -1 };

  const [leads, total] = await Promise.all([
    Lead.find(filter).populate("assignedTo", "name email role avatarColor").sort(sort).skip(skip).limit(limitNum),
    Lead.countDocuments(filter),
  ]);

  res.json({
    success: true,
    leads,
    pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
  });
});

// @desc  Get single lead by id
// @route GET /api/leads/:id
export const getLeadById = asyncHandler(async (req, res) => {
  const filter = applyScope({ _id: req.params.id }, req.user);
  const lead = await Lead.findOne(filter).populate("assignedTo", "name email role avatarColor").populate("createdBy", "name email");

  if (!lead) return res.status(404).json({ success: false, message: "Lead not found or access denied" });
  res.json({ success: true, lead });
});

// @desc  Update lead fields
// @route PUT /api/leads/:id
export const updateLead = asyncHandler(async (req, res) => {
  const filter = applyScope({ _id: req.params.id }, req.user);
  const lead = await Lead.findOne(filter);
  if (!lead) return res.status(404).json({ success: false, message: "Lead not found or access denied" });

  const editableFields = [
    "name", "phone", "alternativePhone", "email", "leadSource", "state",
    "product", "quantity", "address", "city", "pincode", "priority", "notes",
  ];
  editableFields.forEach((f) => {
    if (req.body[f] !== undefined) lead[f] = req.body[f];
  });

  await lead.save();
  await logActivity(lead._id, req.user._id, "Lead Updated", `Lead details updated by ${req.user.name}`);

  res.json({ success: true, lead });
});

// @desc  Change lead status
// @route PATCH /api/leads/:id/status
export const updateLeadStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const validStatuses = ["New", "Contacted", "Interested", "Follow Up", "Won", "Lost"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status value" });
  }

  const filter = applyScope({ _id: req.params.id }, req.user);
  const lead = await Lead.findOne(filter);
  if (!lead) return res.status(404).json({ success: false, message: "Lead not found or access denied" });

  const oldStatus = lead.status;
  lead.status = status;
  await lead.save();

  await logActivity(lead._id, req.user._id, "Status Changed", `Status changed: ${oldStatus} → ${status}`, { from: oldStatus, to: status });

  res.json({ success: true, lead });
});

// @desc  Assign / reassign a lead
// @route PATCH /api/leads/:id/assign
export const assignLead = asyncHandler(async (req, res) => {
  const { assignedTo } = req.body;

  if (req.user.role === "sales_employee") {
    return res.status(403).json({ success: false, message: "You are not permitted to assign leads" });
  }

  const lead = await Lead.findById(req.params.id);
  if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

  if (assignedTo) {
    const targetUser = await User.findOne({ _id: assignedTo, role: "sales_employee", isActive: true });
    if (!targetUser) {
      return res.status(400).json({ success: false, message: "Selected user must be an active sales employee" });
    }
  }

  const wasAssigned = !!lead.assignedTo;
  lead.assignedTo = assignedTo || null;
  await lead.save();

  await logActivity(
    lead._id, req.user._id,
    wasAssigned ? "Lead Reassigned" : "Lead Assigned",
    assignedTo ? `Lead assigned by ${req.user.name}` : `Lead unassigned by ${req.user.name}`
  );

  const populated = await lead.populate("assignedTo", "name email role avatarColor");
  res.json({ success: true, lead: populated });
});

// @desc  Delete a lead
// @route DELETE /api/leads/:id
export const deleteLead = asyncHandler(async (req, res) => {
  if (req.user.role === "sales_employee") {
    return res.status(403).json({ success: false, message: "You are not permitted to delete leads" });
  }
  const lead = await Lead.findByIdAndDelete(req.params.id);
  if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
  res.json({ success: true, message: "Lead deleted successfully" });
});

// @desc  Get lead activity timeline
// @route GET /api/leads/:id/activities
export const getLeadActivities = asyncHandler(async (req, res) => {
  const filter = applyScope({ _id: req.params.id }, req.user);
  const lead = await Lead.findOne(filter);
  if (!lead) return res.status(404).json({ success: false, message: "Lead not found or access denied" });

  const activities = await LeadActivity.find({ lead: lead._id }).populate("user", "name role").sort({ createdAt: -1 });
  res.json({ success: true, activities });
});

// @desc  Add a manual note (also logged as activity)
// @route POST /api/leads/:id/notes
export const addLeadNote = asyncHandler(async (req, res) => {
  const { note } = req.body;
  if (!note || !note.trim()) return res.status(400).json({ success: false, message: "Note text is required" });

  const filter = applyScope({ _id: req.params.id }, req.user);
  const lead = await Lead.findOne(filter);
  if (!lead) return res.status(404).json({ success: false, message: "Lead not found or access denied" });

  lead.notes = lead.notes ? `${lead.notes}\n${note}` : note;
  await lead.save();

  await logActivity(lead._id, req.user._id, "Note Added", note);

  res.json({ success: true, lead });
});
