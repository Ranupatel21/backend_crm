import express from "express";
import {
  getNotifications, markAsRead, markAllAsRead, createMissedCallNotification,
} from "../controllers/notificationController.js";
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";

const router = express.Router();
router.use(protect);

router.get("/", getNotifications);
router.patch("/read-all", markAllAsRead);
router.patch("/:id/read", markAsRead);
router.post("/missed-call", authorize("super_admin", "manager"), createMissedCallNotification);

export default router;
