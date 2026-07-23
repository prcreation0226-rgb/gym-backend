import { pool } from "../../config/db.js";
import { dispatchNotification } from "../../utils/notificationDispatcher.js";

// ----- CREATE DIET PLAN -----
export const createDietPlanService = async ({ title, notes, branchId, createdBy, meals, dietType }) => {
  if (!title) throw { status: 400, message: "Diet plan title is required" };

  // Insert diet plan
  const [planResult] = await pool.query(
    "INSERT INTO dietplan (title, notes, branchId, createdBy, dietType) VALUES (?, ?, ?, ?, ?)",
    [title, notes || "", branchId || 0, createdBy || 0, dietType || 'Any']
  );
  const dietPlanId = planResult.insertId;

  // Insert meals if provided
  if (meals && meals.length) {
    const mealValues = meals.map(m => [dietPlanId, m.time || "", m.food || ""]);
    await pool.query(
      "INSERT INTO dietmeal (dietPlanId, time, food) VALUES ?",
      [mealValues]
    );
  }

  return getDietPlanByIdService(dietPlanId);
};

// ----- GET ALL DIET PLANS (FOR TRAINER/ADMIN) -----
export const getAllDietPlansService = async (branchId, createdBy) => {
  let query = "SELECT * FROM dietplan ORDER BY id DESC";
  let params = [];
  
  if (branchId) {
    query = "SELECT * FROM dietplan WHERE branchId = ? ORDER BY id DESC";
    params = [branchId];
  }

  const [plans] = await pool.query(query, params);

  if (plans.length === 0) return [];

  const planIds = plans.map(p => p.id);
  const [meals] = await pool.query(
    "SELECT * FROM dietmeal WHERE dietPlanId IN (?)",
    [planIds]
  );

  return plans.map(plan => ({
    ...plan,
    meals: meals.filter(m => m.dietPlanId === plan.id)
  }));
};

// ----- GET DIET PLAN BY ID -----
export const getDietPlanByIdService = async (id) => {
  const [planRows] = await pool.query("SELECT * FROM dietplan WHERE id = ?", [id]);
  if (planRows.length === 0) throw { status: 404, message: "Diet plan not found" };

  const [meals] = await pool.query("SELECT * FROM dietmeal WHERE dietPlanId = ?", [id]);
  return { ...planRows[0], meals };
};

// ----- UPDATE DIET PLAN -----
export const updateDietPlanService = async (id, { title, notes, meals, dietType }) => {
  const [existing] = await pool.query("SELECT * FROM dietplan WHERE id = ?", [id]);
  if (existing.length === 0) throw { status: 404, message: "Diet plan not found" };

  if (title !== undefined || notes !== undefined || dietType !== undefined) {
    await pool.query(
      "UPDATE dietplan SET title = COALESCE(?, title), notes = COALESCE(?, notes), dietType = COALESCE(?, dietType) WHERE id = ?",
      [title, notes, dietType, id]
    );
  }

  if (meals && Array.isArray(meals)) {
    await pool.query("DELETE FROM dietmeal WHERE dietPlanId = ?", [id]);
    
    if (meals.length > 0) {
      const mealValues = meals.map(m => [id, m.time || "", m.food || ""]);
      await pool.query(
        "INSERT INTO dietmeal (dietPlanId, time, food) VALUES ?",
        [mealValues]
      );
    }
  }

  return getDietPlanByIdService(id);
};

// ----- DELETE DIET PLAN -----
export const deleteDietPlanService = async (id) => {
  await pool.query("DELETE FROM dietplanassignment WHERE dietPlanId = ?", [id]);
  await pool.query("DELETE FROM dietmeal WHERE dietPlanId = ?", [id]);
  const [result] = await pool.query("DELETE FROM dietplan WHERE id = ?", [id]);
  if (result.affectedRows === 0) throw { status: 404, message: "Diet plan not found" };
  return true;
};

// ----- ASSIGN DIET PLAN TO MEMBER -----
export const assignDietPlanService = async (memberId, dietPlanId) => {
  const [existing] = await pool.query(
    "SELECT * FROM dietplanassignment WHERE memberId = ? AND dietPlanId = ?",
    [memberId, dietPlanId]
  );
  if (existing.length) throw { status: 400, message: "Diet plan already assigned to member" };

  await pool.query(
    "INSERT INTO dietplanassignment (memberId, dietPlanId) VALUES (?, ?)",
    [memberId, dietPlanId]
  );

  // Fetch member & diet plan details to dispatch notifications
  try {
    const [memberRows] = await pool.query(
      "SELECT m.id, m.fullName, m.email, m.phone, m.userId FROM member m WHERE m.id = ?",
      [memberId]
    );
    const member = memberRows[0];

    const [planRows] = await pool.query(
      "SELECT title FROM dietplan WHERE id = ?",
      [dietPlanId]
    );
    const planTitle = planRows[0]?.title || "Diet Plan";

    if (member) {
      const messageText = `Hi ${member.fullName},\n\nA new diet plan "${planTitle}" has been assigned to you. Please check your dashboard to view the details.\n\nRegards,\nGym Management`;
      
      dispatchNotification({
        category: "templates",
        toEmail: member.email,
        toPhone: member.phone,
        toUserId: member.userId,
        memberId: member.id,
        subject: "New Diet Plan Assigned",
        message: messageText,
      }).catch((err) =>
        console.error("Failed to dispatch diet plan assignment notification:", err.message)
      );
    }
  } catch (err) {
    console.error("Error fetching notification details for diet assignment:", err.message);
  }

  return getDietPlanByIdService(dietPlanId);
};

// ----- GET MEMBER DIET PLANS -----
export const getMemberDietPlanService = async (memberIdParam) => {
  const memberId = parseInt(memberIdParam, 10);
  if (!memberId) return [];

  // 1. Resolve realMemberId & member details
  let realMemberId = memberId;
  let branchId = null;

  try {
    const [mRows] = await pool.query(
      `SELECT id, branchId, goal FROM member WHERE id = ? OR userId = ? LIMIT 1`,
      [memberId, memberId]
    );
    if (mRows.length) {
      realMemberId = mRows[0].id;
      branchId = mRows[0].branchId;
    }
  } catch (e) {
    console.error("Error looking up member for diet:", e);
  }

  // 2. Query direct assignments in dietplanassignment
  const [assignments] = await pool.query(
    `SELECT a.id AS assignmentId, a.assignedAt, d.id AS dietPlanId, d.title, d.notes, d.dietType,
            m.id AS mealId, m.time AS mealTime, m.food AS mealFood
     FROM dietplanassignment a
     JOIN dietplan d ON a.dietPlanId = d.id
     LEFT JOIN dietmeal m ON d.id = m.dietPlanId
     WHERE a.memberId = ? OR a.memberId = ?
     ORDER BY a.id DESC`,
    [realMemberId, memberId]
  );

  const plansMap = {};
  if (assignments.length > 0) {
    assignments.forEach(a => {
      if (!plansMap[a.dietPlanId]) {
        plansMap[a.dietPlanId] = { 
          id: a.dietPlanId, 
          assignmentId: a.assignmentId,
          assignedAt: a.assignedAt,
          title: a.title, 
          notes: a.notes, 
          dietType: a.dietType || 'Any',
          meals: [] 
        };
      }
      if (a.mealId) {
        plansMap[a.dietPlanId].meals.push({
          id: a.mealId,
          time: a.mealTime,
          food: a.mealFood
        });
      }
    });
    return Object.values(plansMap);
  }

  // 3. Fallback: If no direct assignment exists, fetch available diet plans for branch or general system diet plans
  let fallbackSql = `
    SELECT d.id AS dietPlanId, d.title, d.notes, d.dietType, d.createdAt AS assignedAt,
           m.id AS mealId, m.time AS mealTime, m.food AS mealFood
    FROM dietplan d
    LEFT JOIN dietmeal m ON d.id = m.dietPlanId
  `;
  const fallbackParams = [];

  if (branchId && parseInt(branchId, 10) > 0) {
    fallbackSql += ` WHERE (d.branchId = ? OR d.branchId = 0 OR d.branchId IS NULL)`;
    fallbackParams.push(parseInt(branchId, 10));
  }

  fallbackSql += ` ORDER BY d.id DESC`;

  const [fallbackRows] = await pool.query(fallbackSql, fallbackParams);

  fallbackRows.forEach(r => {
    if (!plansMap[r.dietPlanId]) {
      plansMap[r.dietPlanId] = { 
        id: r.dietPlanId, 
        assignmentId: 0,
        assignedAt: r.assignedAt,
        title: r.title, 
        notes: r.notes, 
        dietType: r.dietType || 'Any',
        meals: [] 
      };
    }
    if (r.mealId) {
      plansMap[r.dietPlanId].meals.push({
        id: r.mealId,
        time: r.mealTime,
        food: r.mealFood
      });
    }
  });

  return Object.values(plansMap);
};
