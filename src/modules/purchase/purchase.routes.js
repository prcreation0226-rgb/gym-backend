import express from "express";
import {updatePurchaseStatus, createPurchase, getAllPurchases } from "./purchase.controller.js";
import { generateSaasInvoicePdf } from "./saasInvoice.controller.js";

const router = express.Router();

router.post("/", createPurchase);
router.get("/", getAllPurchases);
router.put("/purchase/status/:id", updatePurchaseStatus);
router.get("/invoice/pdf/:id", generateSaasInvoicePdf);

export default router;

