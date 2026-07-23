// src/modules/member/memberDashboard.service.js
import { pool } from "../../config/db.js";

export const getMemberDashboardService = async (memberId) => {
  /* 1️⃣ MEMBER */
  const [[member]] = await pool.query(
    `
    SELECT 
      m.id,
      m.fullName,
      m.membershipFrom,
      m.membershipTo,
      mp.name AS planName
    FROM member m
    LEFT JOIN memberplan mp ON mp.id = m.planId
    WHERE m.id = ?
    `,
    [memberId]
  );

  if (!member) throw { status: 404, message: "Member not found" };

  /* MEMBERSHIP STATUS */
  let membershipStatus = "No Plan";
  if (member.membershipFrom && member.membershipTo) {
    membershipStatus =
      new Date(member.membershipTo) < new Date()
        ? "Expired"
        : "Active";
  }

  /* 2️⃣ WORKOUT PROGRESS */
  const [attendanceRows] = await pool.query(
    `
    SELECT DATE(checkIn) AS date, COUNT(*) AS count
    FROM memberattendance
    WHERE memberId = ?
      AND checkIn >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
    GROUP BY DATE(checkIn)
    `,
    [memberId]
  );

  const days = [];
  const today = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);

    const found = attendanceRows.find(
      (r) => r.date.toISOString().slice(0, 10) === key
    );

    days.push({
      date: key,
      dayLabel: d.toLocaleDateString("en-US", { weekday: "short" }),
      checkIns: found ? found.count : 0,
    });
  }

  /* 3️⃣ CLASSES THIS WEEK */
  const [[classesRow]] = await pool.query(
    `
    SELECT COUNT(*) AS total
    FROM classschedule
    WHERE date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
      AND status = 'Active'
    `
  );

  /* 4️⃣ NEXT SESSION */
  const [[nextSessionRow]] = await pool.query(
    `
    SELECT id, sessionName, date, time, duration
    FROM session
    WHERE status = 'Upcoming'
      AND date >= NOW()
    ORDER BY date, time
    LIMIT 1
    `
  );

  return {
    member: {
      id: member.id,
      fullName: member.fullName,
      planName: member.planName,
    },
    membership: {
      status: membershipStatus,
      expiresOn: member.membershipTo,
    },
    workoutProgress: {
      period: "week",
      days,
    },
    classesThisWeek: {
      count: classesRow.total,
      message:
        classesRow.total > 0
          ? `${classesRow.total} classes this week`
          : "No classes this week",
    },
    nextSession: nextSessionRow
      ? {
          id: nextSessionRow.id,
          name: nextSessionRow.sessionName,
          date: nextSessionRow.date,
          time: nextSessionRow.time,
          duration: nextSessionRow.duration,
        }
      : null,
  };
};

