import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

// @desc  Create a user (super_admin only)
// @route POST /api/users
export const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, phone, role } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: "Name, email and password are required" });
  }

  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) {
    return res.status(409).json({ success: false, message: "A user with this email already exists" });
  }

  const palette = ["#1E2A4A", "#E8A33D", "#1F9D55", "#2F3D66", "#B45309", "#6D28D9"];
  const avatarColor = palette[Math.floor(Math.random() * palette.length)];

  const user = await User.create({
    name, email: email.toLowerCase(), password, phone,
    role: role || "sales_employee", avatarColor,
  });

  res.status(201).json({
    success: true,
    user: { id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone, isActive: user.isActive, avatarColor: user.avatarColor },
  });
});

// @desc  List users (for assignment dropdowns / management)
// @route GET /api/users
export const getUsers = asyncHandler(async (req, res) => {
  const { role, isActive, search } = req.query;
  const filter = {};
  if (role) filter.role = role;
  if (isActive !== undefined) filter.isActive = isActive === "true";
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  // Sales employees can only fetch a minimal active-user list for context, not manage
  const users = await User.find(filter).select("-password").sort({ name: 1 });
  res.json({ success: true, users });
});

// @desc  Get single user
// @route GET /api/users/:id
export const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select("-password");
  if (!user) return res.status(404).json({ success: false, message: "User not found" });
  res.json({ success: true, user });
});

// @desc  Update user (name, phone, role)
// @route PUT /api/users/:id
export const updateUser = asyncHandler(async (req, res) => {
  const { name, phone, role } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: "User not found" });

  if (name !== undefined) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (role !== undefined) user.role = role;
  await user.save();

  res.json({ success: true, user: { id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone, isActive: user.isActive } });
});

// @desc  Activate / deactivate a user
// @route PATCH /api/users/:id/status
export const setUserStatus = asyncHandler(async (req, res) => {
  const { isActive } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: "User not found" });

  user.isActive = !!isActive;
  await user.save();
  res.json({ success: true, message: `User ${user.isActive ? "activated" : "deactivated"} successfully` });
});

// @desc  Reset a user's password (admin)
// @route PATCH /api/users/:id/reset-password

export const resetPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      message: "New password must be at least 6 characters",
    });
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  user.password = newPassword;
  await user.save();

  res.json({
    success: true,
    message: "Password reset successfully",
    temporaryPassword: newPassword,
  });
});
