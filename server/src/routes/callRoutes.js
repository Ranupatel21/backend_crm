import express from "express";
import { getMyCalls, logCall } from "../controllers/callController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();
router.use(protect);
router.get("/", getMyCalls);
router.post("/", logCall);

export default router;
