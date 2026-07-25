import { pool } from "../../config/db.js";

// ----- CREATE WORKOUT PLAN -----
export const createWorkoutPlanService = async ({ title, notes, branchId, createdBy, exercises }) => {
  if (!title) throw { status: 400, message: "Workout plan title is required" };
  // branchId is optional — admins without a branch can still create workout plans

  // Insert workout plan
  const [planResult] = await pool.query(
    "INSERT INTO workoutplan (title, notes, branchId, createdBy) VALUES (?, ?, ?, ?)",
    [title, notes || "", branchId, createdBy || null]
  );
  const workoutPlanId = planResult.insertId;

  // Insert exercises
  if (exercises && exercises.length) {
    const exerciseValues = exercises.map(e => [workoutPlanId, e.name, e.reps || null, e.sets || null, e.duration || null]);
    await pool.query(
      "INSERT INTO workoutexercise (workoutPlanId, name, reps, sets, duration) VALUES ?",
      [exerciseValues]
    );
  }

  // Return plan with exercises
  const [createdPlan] = await pool.query(
    "SELECT * FROM workoutplan WHERE id = ?",
    [workoutPlanId]
  );

  const [planExercises] = await pool.query(
    "SELECT * FROM workoutexercise WHERE workoutPlanId = ?",
    [workoutPlanId]
  );

  return { ...createdPlan[0], exercises: planExercises };
};

// ----- ASSIGN WORKOUT PLAN TO MEMBER -----
export const assignWorkoutPlanService = async (memberId, workoutPlanId) => {
  const [existing] = await pool.query(
    "SELECT * FROM workoutplanassignment WHERE memberId = ? AND workoutPlanId = ?",
    [memberId, workoutPlanId]
  );
  if (existing.length) throw { status: 400, message: "Workout plan already assigned" };

  await pool.query(
    "INSERT INTO workoutplanassignment (memberId, workoutPlanId) VALUES (?, ?)",
    [memberId, workoutPlanId]
  );

  // Return assigned plan with exercises
  const [assignedPlan] = await pool.query(
    `SELECT w.*, e.id AS exerciseId, e.name AS exerciseName, e.reps, e.sets, e.duration
     FROM workoutplan w
     LEFT JOIN workoutexercise e ON w.id = e.workoutPlanId
     WHERE w.id = ?`,
    [workoutPlanId]
  );

  return assignedPlan;
};

// ----- GET MEMBER WORKOUT PLANS -----
export const getMemberWorkoutPlanService = async (memberIdParam) => {
  const memberId = parseInt(memberIdParam, 10);
  if (!memberId) return [];

  // 1. Resolve realMemberId & branchId
  let realMemberId = memberId;
  let branchId = null;

  try {
    const [mRows] = await pool.query(
      `SELECT id, branchId FROM member WHERE id = ? LIMIT 1`,
      [memberId]
    );
    if (mRows.length) {
      realMemberId = mRows[0].id;
      branchId = mRows[0].branchId;
    }
  } catch (e) {
    console.error("Error looking up member for workout:", e);
  }

  // 2. Query direct assignments in workoutplanassignment
  const [assignments] = await pool.query(
    `SELECT a.id AS assignmentId, w.id AS workoutPlanId, w.title, w.notes,
            e.id AS exerciseId, e.name AS exerciseName, e.reps, e.sets, e.duration
     FROM workoutplanassignment a
     JOIN workoutplan w ON a.workoutPlanId = w.id
     LEFT JOIN workoutexercise e ON w.id = e.workoutPlanId
     WHERE a.memberId = ?
     ORDER BY a.id DESC`,
    [realMemberId]
  );

  const plansMap = {};
  if (assignments.length > 0) {
    assignments.forEach(a => {
      if (!plansMap[a.workoutPlanId]) {
        plansMap[a.workoutPlanId] = { id: a.workoutPlanId, title: a.title, notes: a.notes, exercises: [] };
      }
      if (a.exerciseId) {
        plansMap[a.workoutPlanId].exercises.push({
          id: a.exerciseId,
          name: a.exerciseName,
          reps: a.reps,
          sets: a.sets,
          duration: a.duration
        });
      }
    });
    return Object.values(plansMap);
  }

  return Object.values(plansMap);
};
