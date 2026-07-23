import { financeReportService } from "./finance.service.js";

export const getFinanceReport = async (req, res, next) => {
  try {
    const branchId =
      req.user.role === "Superadmin"
        ? parseInt(req.params.branchId)
        : req.user.branchId;

    const report = await financeReportService(branchId);
    res.json({ success: true, finance: report });
  } catch (err) {
    next(err);
  }
};
