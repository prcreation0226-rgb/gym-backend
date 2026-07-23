import { pool } from "../../config/db.js";
import { startOfMonth, format } from "date-fns";

export const financeReportService = async (branchId) => {
  const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");

  // ---------------- REVENUE ----------------
  const [[{ totalRevenue }]] = await pool.query(
    `SELECT COALESCE(SUM(p.amount),0) AS totalRevenue
     FROM Payment p
     JOIN Member m ON m.id = p.memberId
     WHERE m.branchId = ?`,
    [branchId]
  );

  const [[{ monthlyRevenue }]] = await pool.query(
    `SELECT COALESCE(SUM(p.amount),0) AS monthlyRevenue
     FROM Payment p
     JOIN Member m ON m.id = p.memberId
     WHERE m.branchId = ? AND p.paymentDate >= ?`,
    [branchId, monthStart]
  );

  // ---------------- EXPENSES ----------------
  const [[{ totalExpense }]] = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS totalExpense
     FROM Expense
     WHERE branchId = ?`,
    [branchId]
  );

  const [[{ monthlyExpense }]] = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS monthlyExpense
     FROM Expense
     WHERE branchId = ? AND date >= ?`,
    [branchId, monthStart]
  );

  // ---------------- PROFIT ----------------
  const netProfit = totalRevenue - totalExpense;
  const monthlyProfit = monthlyRevenue - monthlyExpense;

  // ---------------- GRAPH DATA ----------------
  const [revenueGraph] = await pool.query(
    `SELECT DATE_FORMAT(p.paymentDate, '%Y-%m') AS month, SUM(p.amount) AS total
     FROM Payment p
     JOIN Member m ON m.id = p.memberId
     WHERE m.branchId = ?
     GROUP BY DATE_FORMAT(p.paymentDate, '%Y-%m')
     ORDER BY month ASC`,
    [branchId]
  );

  const [expenseGraph] = await pool.query(
    `SELECT DATE_FORMAT(date, '%Y-%m') AS month, SUM(amount) AS total
     FROM Expense
     WHERE branchId = ?
     GROUP BY DATE_FORMAT(date, '%Y-%m')
     ORDER BY month ASC`,
    [branchId]
  );

  return {
    totalRevenue,
    totalExpense,
    netProfit,
    monthlyRevenue,
    monthlyExpense,
    monthlyProfit,
    revenueGraph,
    expenseGraph,
  };
};
