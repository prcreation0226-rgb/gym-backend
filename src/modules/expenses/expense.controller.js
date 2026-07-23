import {
  addExpenseService,
  listExpensesService,
  monthlyExpenseSummaryService,
} from "./expense.service.js";

export const addExpense = async (req, res, next) => {
  try {
    const expense = await addExpenseService(req.body);
    res.json({ success: true, expense });
  } catch (err) {
    next(err);
  }
};

export const listExpenses = async (req, res, next) => {
  try {
    const branchId = parseInt(req.params.branchId);
    const { from, to } = req.query;

    const startDate = from ? new Date(from) : new Date("2000-01-01");
    const endDate = to ? new Date(to) : new Date();

    const list = await listExpensesService(branchId, startDate, endDate);
    res.json({ success: true, expenses: list });
  } catch (err) {
    next(err);
  }
};

export const expenseSummary = async (req, res, next) => {
  try {
    const branchId = parseInt(req.params.branchId);
    const summary = await monthlyExpenseSummaryService(branchId);
    res.json({ success: true, summary });
  } catch (err) {
    next(err);
  }
};
