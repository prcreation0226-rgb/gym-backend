import express from "express";
// import auth from "../middleware/auth.js"; // login middleware

import {
  createTask,
  getAllTasks,
  getTaskById,
  updateTask,
  updateTaskStatus,
  deleteTask,
  getTaskByBranchID,
  getTaskAsignedTo,
  getTasksByAdminId,
} from "./housekeepingtask.controller.js";

const router = express.Router();

router.post("/create", createTask);
router.get("/all", getAllTasks);
router.get("/:id", getTaskById);
router.get("/branch/:branchId", getTaskByBranchID);
router.get("/tasks/admin/:adminId", getTasksByAdminId);
router.get("/asignedto/:asignedtoID", getTaskAsignedTo);
router.put("/:id", updateTask);
router.put("/status/:id", updateTaskStatus);
router.delete("/:id", deleteTask);

export default router;
