import XLSX from "xlsx";
import crypto from "crypto";
import Lead from "../models/Lead.js";
import LeadActivity from "../models/LeadActivity.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

// @desc  Parse an uploaded Excel file and return sheet names + preview rows
// @route POST /api/leads/import/preview
export const previewExcel = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "No file uploaded",
    });
  }

  const workbook = XLSX.read(req.file.buffer, { type: "buffer" });

  const sheets = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    const columns = rows.length ? Object.keys(rows[0]) : [];

    return {
      sheetName,
      columns,
      preview: rows.slice(0, 5),
      rowCount: rows.length,
    };
  });

  res.json({
    success: true,
    fileName: req.file.originalname,
    sheets,
  });
});

const CRM_FIELDS = [
  "name",
  "phone",
  "alternativePhone",
  "email",
  "leadSource",
  "state",
  "product",
  "quantity",
  "address",
  "city",
  "pincode",
  "priority",
  "notes",
];

const normalizePhone = (value = "") =>
  String(value).replace(/\D/g, "");

// @desc  Commit the import: map columns -> CRM fields, dedupe, create leads
// @route POST /api/leads/import/commit
export const commitExcelImport = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "No file uploaded",
    });
  }

  const {
    sheetName,
    mapping,
    defaultLeadSource,
  } = req.body;

  const columnMap =
    typeof mapping === "string"
      ? JSON.parse(mapping)
      : mapping;

  if (!sheetName || !columnMap) {
    return res.status(400).json({
      success: false,
      message: "sheetName and mapping are required",
    });
  }

  const workbook = XLSX.read(req.file.buffer, {
    type: "buffer",
  });

  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    return res.status(400).json({
      success: false,
      message: `Sheet "${sheetName}" not found in file`,
    });
  }

  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: "",
  });

  if (!rows.length) {
    return res.status(400).json({
      success: false,
      message: "Selected Excel sheet contains no data",
    });
  }

  // ---------------------------------------------------------
  // ACTIVE SALES EMPLOYEES
  // ---------------------------------------------------------
  // Excel assignedTo is intentionally ignored.
  // Leads will always be distributed automatically.
  const salesEmployees = await User.find({
    role: "sales_employee",
    isActive: true,
  })
    .select("_id name email")
    .sort({ createdAt: 1 })
    .lean();

  if (!salesEmployees.length) {
    return res.status(400).json({
      success: false,
      message: "No active sales employees available for lead distribution",
    });
  }

  const importBatchId = crypto.randomUUID();

  // ---------------------------------------------------------
  // EXISTING PHONE DUPLICATE CHECK
  // ---------------------------------------------------------

  const rawPhones = rows
    .map((row) =>
      columnMap.phone
        ? String(row[columnMap.phone]).trim()
        : ""
    )
    .filter(Boolean);

  const phoneCandidates = rawPhones
    .map(normalizePhone)
    .filter(Boolean);

  const existingPhoneValues = phoneCandidates.length
    ? await Lead.find({
        $or: [
          {
            phoneNormalized: {
              $in: phoneCandidates,
            },
          },
          {
            phone: {
              $in: rawPhones,
            },
          },
        ],
      })
        .select("phone phoneNormalized")
        .lean()
    : [];

  const existingPhones = new Set(
    existingPhoneValues
      .map((lead) =>
        normalizePhone(
          lead.phoneNormalized || lead.phone
        )
      )
      .filter(Boolean)
  );

  // Prevent duplicates inside the same Excel file.
  const importedPhones = new Set();

  let created = 0;
  let skippedDuplicates = 0;
  let failed = 0;

  const createdLeads = [];

  // ---------------------------------------------------------
  // STEP 1: CREATE LEADS WITHOUT ASSIGNMENT
  // ---------------------------------------------------------

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const leadData = {
      importSource: {
        fileName: req.file.originalname,
        sheetName,
        rowNumber: i + 2,
        importBatchId,
      },
    };

    // Existing mapping logic preserved.
    CRM_FIELDS.forEach((field) => {
      const excelCol = columnMap[field];

      if (
        excelCol &&
        row[excelCol] !== undefined &&
        row[excelCol] !== ""
      ) {
        leadData[field] = String(
          row[excelCol]
        ).trim();
      }
    });

    if (!leadData.leadSource) {
      leadData.leadSource =
        defaultLeadSource || "Excel Import";
    }

    // Excel assignedTo is intentionally NOT used.
    leadData.assignedTo = null;

    leadData.createdBy = req.user._id;

    // -------------------------------------------------------
    // DUPLICATE CHECK
    // -------------------------------------------------------

    const normalizedPhone =
      normalizePhone(leadData.phone);

    if (normalizedPhone) {
      if (
        existingPhones.has(normalizedPhone) ||
        importedPhones.has(normalizedPhone)
      ) {
        skippedDuplicates++;
        continue;
      }
    }

    try {
      const lead = await Lead.create(leadData);

      created++;

      createdLeads.push(lead);

      if (normalizedPhone) {
        importedPhones.add(normalizedPhone);
      }

      // Lead created activity
      await LeadActivity.create({
        lead: lead._id,
        user: req.user._id,
        type: "Lead Created",
        description: `Imported from Excel — Sheet: ${sheetName}`,
        meta: {
          importBatchId,
          fileName: req.file.originalname,
          sheetName,
          rowNumber: i + 2,
        },
      });
    } catch (err) {
      console.error(
        "[Excel Import] Lead creation failed:",
        err.message
      );

      failed++;
    }
  }

  // ---------------------------------------------------------
  // STEP 2: EVEN LEAD DISTRIBUTION
  // ---------------------------------------------------------

  if (createdLeads.length > 0) {
    const employeeCount = salesEmployees.length;

    for (
      let index = 0;
      index < createdLeads.length;
      index++
    ) {
      const lead = createdLeads[index];

      // Round-robin distribution gives the required
      // maximum difference of 1 lead between employees.
      const employee =
        salesEmployees[index % employeeCount];

      lead.assignedTo = employee._id;

      await lead.save();

      // Assignment activity
      await LeadActivity.create({
        lead: lead._id,
        user: req.user._id,
        type: "Lead Assigned",
        description: `Lead automatically assigned to ${employee.name}`,
        meta: {
          assignmentType: "excel_auto_distribution",
          importBatchId,
          assignedTo: employee._id,
        },
      });
    }

    // -------------------------------------------------------
    // STEP 3: NOTIFY EACH EMPLOYEE
    // -------------------------------------------------------

    const notificationCounts = new Map();

    for (let index = 0; index < createdLeads.length; index++) {
      const employee =
        salesEmployees[index % salesEmployees.length];

      const employeeId = String(employee._id);

      notificationCounts.set(
        employeeId,
        (notificationCounts.get(employeeId) || 0) + 1
      );
    }

    await Promise.all(
      salesEmployees.map(async (employee) => {
        const count =
          notificationCounts.get(
            String(employee._id)
          ) || 0;

        if (!count) return;

        await Notification.create({
          recipient: employee._id,
          type: "new_lead",
          title: "New Leads Assigned",
          message: `${count} new lead${
            count > 1 ? "s" : ""
          } assigned to you from Excel import - ${sheetName}`,
        });
      })
    );
  } else {
    // -------------------------------------------------------
    // NO SUCCESSFULLY CREATED LEADS
    // -------------------------------------------------------

    const notifyUsers = await User.find({
      role: {
        $in: ["manager", "super_admin"],
      },
      isActive: true,
    });

    await Promise.all(
      notifyUsers.map((user) =>
        Notification.create({
          recipient: user._id,
          type: "new_lead",
          title: "Excel Import Completed",
          message: `No new leads were created from Excel - ${sheetName}. All rows may be duplicates or failed.`,
        })
      )
    );
  }

  // ---------------------------------------------------------
  // DISTRIBUTION SUMMARY
  // ---------------------------------------------------------

  const distribution = salesEmployees
    .map((employee) => {
      const count = createdLeads.filter(
        (lead, index) =>
          String(
            salesEmployees[
              index % salesEmployees.length
            ]._id
          ) === String(employee._id)
      ).length;

      return {
        employeeId: employee._id,
        name: employee.name,
        email: employee.email,
        leadCount: count,
      };
    })
    .filter((employee) => employee.leadCount > 0);

  // ---------------------------------------------------------
  // RESPONSE
  // ---------------------------------------------------------

  res.json({
    success: true,

    summary: {
      totalRows: rows.length,
      created,
      skippedDuplicates,
      failed,
      importBatchId,

      distributed: createdLeads.length > 0,

      distribution,
    },
  });
});