import CallActivity from "../models/CallActivity.js";
import Lead from "../models/Lead.js";
import LeadActivity from "../models/LeadActivity.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const accessibleLead = (leadId, user) => {
  const filter = { _id: leadId };
  if (user.role === "sales_employee") filter.assignedTo = user._id;
  return filter;
};

// @desc Get the current user's logged calls, optionally for one lead.
// @route GET /api/calls
export const getMyCalls = asyncHandler(async (req, res) => {
  const filter = { user: req.user._id };
  if (req.query.lead) filter.lead = req.query.lead;

  const calls = await CallActivity.find(filter)
    .populate("lead", "name phone status assignedTo")
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(Number(req.query.limit) || 50, 1), 100));

  res.json({ success: true, calls });
});

// @desc Add a manual call result after using the device/desktop dialler.
// @route POST /api/calls
export const logCall = asyncHandler(async (req, res) => {
  const { lead, outcome, durationSeconds = 0, notes = "" } = req.body;
  const allowedOutcomes = ["Connected", "No Answer", "Busy", "Wrong Number", "Failed"];
  if (!lead || !allowedOutcomes.includes(outcome)) {
    return res.status(400).json({ success: false, message: "Lead and a valid call outcome are required" });
  }

  const leadDoc = await Lead.findOne(accessibleLead(lead, req.user));
  if (!leadDoc) return res.status(404).json({ success: false, message: "Lead not found or access denied" });

  const parsedDuration = Number(durationSeconds);
  if (!Number.isFinite(parsedDuration) || parsedDuration < 0) {
    return res.status(400).json({ success: false, message: "Duration must be a positive number" });
  }

  const call = await CallActivity.create({
    lead: leadDoc._id,
    user: req.user._id,
    outcome,
    durationSeconds: Math.floor(parsedDuration),
    notes,
  });

  await LeadActivity.create({
    lead: leadDoc._id,
    user: req.user._id,
    type: "Call Logged",
    description: `Call ${outcome.toLowerCase()}${parsedDuration ? ` · ${Math.floor(parsedDuration)} sec` : ""}${notes ? ` · ${notes}` : ""}`,
    meta: { outcome, durationSeconds: Math.floor(parsedDuration) },
  });

  res.status(201).json({ success: true, call });
});
