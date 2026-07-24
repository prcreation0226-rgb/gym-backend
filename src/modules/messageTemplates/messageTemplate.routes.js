import express from "express";
import { getAllTemplates, updateTemplate, getTemplateAuditLogs } from "./messageTemplate.controller.js";
import { authenticate } from "../../middlewares/authMiddleware.js";

const router = express.Router();

// Get all message templates (Super Admin)
router.get("/", authenticate, getAllTemplates);

// Update a message template
router.put("/:id", authenticate, updateTemplate);

// Get audit logs for a template
router.get("/:id/audit-logs", authenticate, getTemplateAuditLogs);

export default router;
