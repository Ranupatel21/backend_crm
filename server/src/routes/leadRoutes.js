import express from "express";
import multer from "multer";
import {
  createLead, getLeads, getLeadById, updateLead, updateLeadStatus,
  assignLead, deleteLead, getLeadActivities, addLeadNote,
} from "../controllers/leadController.js";
import { previewExcel, commitExcelImport } from "../controllers/excelController.js";
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(protect);

router.post("/import/preview", authorize("super_admin", "manager"), upload.single("file"), previewExcel);
router.post("/import/commit", authorize("super_admin", "manager"), upload.single("file"), commitExcelImport);

router.get("/", getLeads);
router.post("/", createLead);

router.get("/:id", getLeadById);
router.put("/:id", updateLead);
router.delete("/:id", authorize("super_admin", "manager"), deleteLead);

router.patch("/:id/status", updateLeadStatus);
router.patch("/:id/assign", authorize("super_admin", "manager"), assignLead);

router.get("/:id/activities", getLeadActivities);
router.post("/:id/notes", addLeadNote);

export default router;
