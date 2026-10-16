import Lead from "../models/Lead.js";
import User from "../models/User.js";
import FollowUp from "../models/FollowUp.js";
import Notification from "../models/Notification.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const statusCounts = async (filter) => {
  const results = await Lead.aggregate([
    { $match: filter },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const map = { New: 0, Contacted: 0, Interested: 0, "Follow Up": 0, Won: 0, Lost: 0 };
  results.forEach((r) => { map[r._id] = r.count; });
  return map;
};

// @desc  Get role-aware dashboard stats
// @route GET /api/dashboard
export const getDashboard = asyncHandler(async (req, res) => {
  const { role, _id } = req.user;

  if (role === "sales_employee") {
    const filter = { assignedTo: _id };
    const [counts, total, recentLeads, upcomingFollowUps, unreadNotifications] = await Promise.all([
      statusCounts(filter),
      Lead.countDocuments(filter),
      Lead.find(filter).sort({ createdAt: -1 }).limit(6),
      FollowUp.find({ assignedTo: _id, status: "Pending" }).sort({ followUpDate: 1 }).limit(6).populate("lead", "name phone"),
      Notification.countDocuments({ recipient: _id, isRead: false }),
    ]);

    return res.json({
      success: true,
      role,
      stats: { total, ...counts },
      recentLeads,
      upcomingFollowUps,
      unreadNotifications,
    });
  }

  if (role === "manager") {
    const [counts, total, byEmployee, upcomingFollowUps] = await Promise.all([
      statusCounts({}),
      Lead.countDocuments({}),
      Lead.aggregate([
        { $match: { assignedTo: { $ne: null } } },
        { $group: { _id: "$assignedTo", count: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ["$status", "Won"] }, 1, 0] } } } },
        { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
        { $unwind: "$user" },
        { $project: { name: "$user.name", count: 1, won: 1 } },
        { $sort: { count: -1 } },
      ]),
      FollowUp.find({ status: "Pending" }).sort({ followUpDate: 1 }).limit(8).populate("lead", "name phone").populate("assignedTo", "name"),
    ]);

    return res.json({ success: true, role, stats: { total, ...counts }, byEmployee, upcomingFollowUps });
  }

  // super_admin
  const [counts, total, bySource, byEmployee, missedCallCount, whatsappCount, activeUsers] = await Promise.all([
    statusCounts({}),
    Lead.countDocuments({}),
    Lead.aggregate([{ $group: { _id: "$leadSource", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    Lead.aggregate([
      { $match: { assignedTo: { $ne: null } } },
      { $group: { _id: "$assignedTo", count: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ["$status", "Won"] }, 1, 0] } } } },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
      { $unwind: "$user" },
      { $project: { name: "$user.name", count: 1, won: 1 } },
      { $sort: { count: -1 } },
    ]),
    Notification.countDocuments({ type: "missed_call" }),
    Notification.countDocuments({ type: "whatsapp" }),
    User.countDocuments({ isActive: true }),
  ]);

  res.json({
    success: true,
    role,
    stats: { total, ...counts },
    bySource,
    byEmployee,
    missedCallCount,
    whatsappCount,
    activeUsers,
  });
});
