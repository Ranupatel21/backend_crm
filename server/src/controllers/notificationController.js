import Notification from "../models/Notification.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

// @desc  Get my notifications
// @route GET /api/notifications
export const getNotifications = asyncHandler(async (req, res) => {
  const { unreadOnly } = req.query;
  const filter = { recipient: req.user._id };
  if (unreadOnly === "true") filter.isRead = false;

  const notifications = await Notification.find(filter).populate("lead", "name phone").sort({ createdAt: -1 }).limit(50);
  const unreadCount = await Notification.countDocuments({ recipient: req.user._id, isRead: false });

  res.json({ success: true, notifications, unreadCount });
});

// @desc  Mark one notification as read
// @route PATCH /api/notifications/:id/read
export const markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOne({ _id: req.params.id, recipient: req.user._id });
  if (!notification) return res.status(404).json({ success: false, message: "Notification not found" });

  notification.isRead = true;
  await notification.save();
  res.json({ success: true, notification });
});

// @desc  Mark all as read
// @route PATCH /api/notifications/read-all
export const markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ recipient: req.user._id, isRead: false }, { isRead: true });
  res.json({ success: true, message: "All notifications marked as read" });
});

// @desc  Create a missed-call notification (internal / webhook use)
// @route POST /api/notifications/missed-call
export const createMissedCallNotification = asyncHandler(async (req, res) => {
  const { phone, recipient, leadId } = req.body;
  if (!phone || !recipient) {
    return res.status(400).json({ success: false, message: "phone and recipient are required" });
  }

  const notification = await Notification.create({
    recipient,
    type: "missed_call",
    title: "Missed Call",
    message: `Missed call from ${phone}`,
    lead: leadId || null,
  });

  res.status(201).json({ success: true, notification });
});
