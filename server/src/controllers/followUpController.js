import FollowUp from "../models/FollowUp.js";
import Lead from "../models/Lead.js";
import LeadActivity from "../models/LeadActivity.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const scopedLeadFilter = (leadId, user) => {
  const filter = { _id: leadId };
  if (user.role === "sales_employee") filter.assignedTo = user._id;
  return filter;
};

// @desc  Create follow-up for a lead
// @route POST /api/followups
export const createFollowUp = asyncHandler(async (req, res) => {
  const { lead, assignedTo, followUpDate, followUpTime, type, notes } = req.body;
  if (!lead || !followUpDate) {
    return res.status(400).json({ success: false, message: "Lead and follow-up date are required" });
  }

  const leadDoc = await Lead.findOne(scopedLeadFilter(lead, req.user));
  if (!leadDoc) return res.status(404).json({ success: false, message: "Lead not found or access denied" });

  const followUp = await FollowUp.create({
    lead, assignedTo: assignedTo || leadDoc.assignedTo || req.user._id,
    followUpDate, followUpTime, type, notes, createdBy: req.user._id,
  });

  await LeadActivity.create({
    lead, user: req.user._id, type: "Follow-up Added",
    description: `Follow-up scheduled for ${new Date(followUpDate).toLocaleDateString()}`,
  });

  res.status(201).json({ success: true, followUp });
});

// @desc  Get follow-ups (filterable by lead, assignedTo, status)
// @route GET /api/followups
export const getFollowUps = asyncHandler(async (req, res) => {
  const { lead, status, assignedTo, upcoming } = req.query;
  const filter = {};

  if (req.user.role === "sales_employee") filter.assignedTo = req.user._id;
  else if (assignedTo) filter.assignedTo = assignedTo;

  if (lead) filter.lead = lead;
  if (status) filter.status = status;
  if (upcoming === "true") filter.followUpDate = { $gte: new Date() };

  const followUps = await FollowUp.find(filter)
    .populate("lead", "name phone status")
    .populate("assignedTo", "name")
    .sort({ followUpDate: 1 });

  // A lead may be moved to the Follow Up pipeline stage before a date/time is
  // chosen. Keep those leads visible as an actionable queue instead of making
  // the dashboard count disagree with the Follow-ups screen.
  let needsScheduling = [];
  if (!status || status === "Pending") {
    const leadFilter = { status: "Follow Up" };
    if (req.user.role === "sales_employee") leadFilter.assignedTo = req.user._id;
    else if (assignedTo) leadFilter.assignedTo = assignedTo;
    if (lead) leadFilter._id = lead;

    const scheduledLeadIds = await FollowUp.distinct("lead", { status: "Pending" });
    const queueFilter = { ...leadFilter };
    queueFilter._id = lead
      ? { $eq: lead, $nin: scheduledLeadIds }
      : { $nin: scheduledLeadIds };
    needsScheduling = await Lead.find(queueFilter)
      .select("name phone priority assignedTo status")
      .populate("assignedTo", "name")
      .sort({ updatedAt: -1 });
  }

  res.json({ success: true, followUps, needsScheduling });
});

// @desc  Update follow-up status
// @route PATCH /api/followups/:id/status
export const updateFollowUpStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!["Pending", "Completed", "Missed"].includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status" });
  }

  const followUp = await FollowUp.findById(req.params.id);
  if (!followUp) return res.status(404).json({ success: false, message: "Follow-up not found" });

  if (req.user.role === "sales_employee" && String(followUp.assignedTo) !== String(req.user._id)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  followUp.status = status;
  await followUp.save();

  if (status === "Completed") {
    await LeadActivity.create({
      lead: followUp.lead, user: req.user._id, type: "Follow-up Completed",
      description: "Follow-up marked as completed",
    });
  }

  res.json({ success: true, followUp });
});

// @desc  Update a follow-up's details
// @route PUT /api/followups/:id
export const updateFollowUp = asyncHandler(async (req, res) => {
  const followUp = await FollowUp.findById(req.params.id);
  if (!followUp) return res.status(404).json({ success: false, message: "Follow-up not found" });

  if (req.user.role === "sales_employee" && String(followUp.assignedTo) !== String(req.user._id)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  ["followUpDate", "followUpTime", "type", "notes", "assignedTo"].forEach((f) => {
    if (req.body[f] !== undefined) followUp[f] = req.body[f];
  });
  await followUp.save();
  res.json({ success: true, followUp });
});

// @desc  Delete a follow-up
// @route DELETE /api/followups/:id
export const deleteFollowUp = asyncHandler(async (req, res) => {
  const followUp = await FollowUp.findById(req.params.id);
  if (!followUp) return res.status(404).json({ success: false, message: "Follow-up not found" });

  if (req.user.role === "sales_employee" && String(followUp.assignedTo) !== String(req.user._id)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }
  await followUp.deleteOne();
  res.json({ success: true, message: "Follow-up deleted" });
});
