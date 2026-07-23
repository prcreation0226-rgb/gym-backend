import express from "express";
import { verifyToken } from "../../middlewares/auth.js";
import { getGlobalSettings, updateGlobalSettings } from "./globalSetting.controller.js";

const router = express.Router();

router.get("/", verifyToken(["Superadmin"]), getGlobalSettings);
router.put("/", verifyToken(["Superadmin"]), updateGlobalSettings);

export default router;
