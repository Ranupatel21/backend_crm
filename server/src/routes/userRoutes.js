import express from "express";
import {
  createUser, getUsers, getUserById, updateUser, setUserStatus, resetPassword,
} from "../controllers/userController.js";
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";

const router = express.Router();

router.use(protect);

router.get("/", getUsers); // all roles can view (used for assignment dropdowns)
router.get("/:id", getUserById);

router.post("/", authorize("super_admin"), createUser);
router.put("/:id", authorize("super_admin"), updateUser);
router.patch("/:id/status", authorize("super_admin"), setUserStatus);
router.patch("/:id/reset-password", authorize("super_admin"), resetPassword);

export default router;
