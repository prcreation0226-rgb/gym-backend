import express from "express";
import {
  getIntegrations,
  updateRazorpay,
  updateBrevo,
  testRazorpay,
  testBrevo
} from "./integrations.controller.js";
import { authMiddleware } from "../../middlewares/auth.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/", getIntegrations);

router.put("/razorpay", updateRazorpay);
router.post("/razorpay/test", testRazorpay);

router.put("/brevo", updateBrevo);
router.post("/brevo/test", testBrevo);

export default router;
