import express from "express";
import {
  createFollowUp, getFollowUps, updateFollowUpStatus, updateFollowUp, deleteFollowUp,
} from "../controllers/followUpController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();
router.use(protect);

router.get("/", getFollowUps);
router.post("/", createFollowUp);
router.put("/:id", updateFollowUp);
router.patch("/:id/status", updateFollowUpStatus);
router.delete("/:id", deleteFollowUp);

export default router;
