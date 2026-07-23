import { pool } from "../../config/db.js";

// Ensure table exists safely
const ensureExpenseTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS expense (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branchId INT NULL,
        title VARCHAR(191) DEFAULT 'Expense',
        category VARCHAR(100) DEFAULT 'Miscellaneous',
        description VARCHAR(255) NULL,
        amount DECIMAL(10,2) DEFAULT 0,
        date DATE,
        paymentMode VARCHAR(50) DEFAULT 'Cash',
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ensure columns exist if table schema differs
    await pool.query(`ALTER TABLE expense ADD COLUMN description VARCHAR(255) NULL`).catch(() => {});
    await pool.query(`ALTER TABLE expense ADD COLUMN title VARCHAR(191) DEFAULT 'Expense'`).catch(() => {});
    await pool.query(`ALTER TABLE expense ADD COLUMN category VARCHAR(100) DEFAULT 'Miscellaneous'`).catch(() => {});
    await pool.query(`ALTER TABLE expense ADD COLUMN paymentMode VARCHAR(50) DEFAULT 'Cash'`).catch(() => {});
  } catch (err) {
    console.error("ensureExpenseTable error:", err.message);
  }
};

// Resolve valid branch ID to prevent foreign key errors
const resolveBranchId = async (branchId) => {
  if (branchId && Number(branchId) > 0) {
    const [exists] = await pool.query(`SELECT id FROM branch WHERE id = ?`, [branchId]);
    if (exists.length > 0) return Number(branchId);
  }
  const [defaultBranch] = await pool.query(`SELECT id FROM branch ORDER BY id DESC LIMIT 1`);
  return defaultBranch.length > 0 ? defaultBranch[0].id : null;
};

// ----- ADD EXPENSE -----
export const addExpenseService = async (data) => {
  await ensureExpenseTable();
  const validBranchId = await resolveBranchId(data.branchId);
  const { category = "Miscellaneous", description = "", amount = 0, date = new Date(), paymentMode = "Cash" } = data;
  const titleText = description || category || "Operating Expense";
  const sql = `
    INSERT INTO expense (branchId, title, description, category, amount, date, paymentMode)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  const [result] = await pool.query(sql, [validBranchId, titleText, description, category, amount, date, paymentMode]);

  const [expense] = await pool.query(
    `SELECT e.*, IFNULL(e.description, e.title) AS description, IFNULL(b.name, 'Main Branch') AS branchName 
     FROM expense e 
     LEFT JOIN branch b ON e.branchId = b.id 
     WHERE e.id = ?`,
    [result.insertId]
  );

  return expense[0];
};

// ----- LIST EXPENSES (Including Auto Salaries) -----
export const listExpensesService = async (branchId, startDate, endDate) => {
  await ensureExpenseTable();
  const sql = `
    SELECT e.*, IFNULL(e.description, e.title) AS description, IFNULL(b.name, 'Main Branch') AS branchName
    FROM expense e
    LEFT JOIN branch b ON e.branchId = b.id
    WHERE (? = 0 OR e.branchId = ? OR e.branchId IS NULL) AND e.date BETWEEN ? AND ?
    ORDER BY e.date DESC, e.id DESC
  `;
  const [expenses] = await pool.query(sql, [branchId || 0, branchId || 0, startDate, endDate]);

  // Also fetch Staff Salaries within this period as automatic expense entries
  const [salaries] = await pool.query(
    `SELECT 
       id,
       staffId,
       role,
       periodStart,
       periodEnd AS date,
       netPay AS amount,
       'Staff Salary' AS category,
       CONCAT('Auto Salary: ', role, ' (Staff ID #', staffId, ')') AS description,
       'Bank/Payroll' AS paymentMode,
       'AUTO_SALARY' AS source
     FROM salary
     WHERE periodEnd BETWEEN ? AND ?`,
    [startDate, endDate]
  ).catch(() => [[]]);

  const combined = [
    ...expenses.map((e) => ({ ...e, source: "MANUAL", description: e.description || e.title || e.category })),
    ...(salaries || []).map((s) => ({ ...s, branchName: "All Staff" })),
  ];

  combined.sort((a, b) => new Date(b.date) - new Date(a.date));
  return combined;
};

// ----- MONTHLY EXPENSE SUMMARY -----
export const monthlyExpenseSummaryService = async (branchId) => {
  await ensureExpenseTable();
  const sql = `
    SELECT DATE_FORMAT(date, '%Y-%m') AS month, SUM(amount) AS total
    FROM expense
    WHERE (? = 0 OR branchId = ?)
    GROUP BY DATE_FORMAT(date, '%Y-%m')
    ORDER BY month DESC
  `;
  const [summary] = await pool.query(sql, [branchId || 0, branchId || 0]);
  return summary;
};
