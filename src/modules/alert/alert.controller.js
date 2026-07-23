import { pool } from "../../config/db.js";

export const getAlerts = async (req, res, next) => {
  try {
    let sql = `SELECT * FROM alert`;
    const params = [];

    if (req.user.role !== "Superadmin") {
      sql += ` WHERE branchId = ?`;
      params.push(req.user.branchId);
    }

    sql += ` ORDER BY id DESC LIMIT 50`;

    const [alerts] = await pool.query(sql, params);

    res.json({ success: true, alerts });
  } catch (err) {
    console.error("Error fetching alerts:", err);
    next({ status: 500, message: "Failed to fetch alerts" });
  }
};

export const getVulnerableMembers = async (req, res, next) => {
  try {
    const userRole = (req.user && req.user.role || "").toUpperCase();
    const isSuper = userRole === "SUPERADMIN";
    const isAdmin = userRole === "ADMIN";

    const adminId = isSuper ? null : (isAdmin ? req.user?.id : req.user?.adminId);
    const branchId = isSuper ? null : req.user?.branchId;
    
    // Calculate attendance over the last 30 days
    let sql = `
      SELECT m.id, m.fullName, m.email, m.phone, m.branchId, m.profileImage,
             COALESCE(
               DATEDIFF(CURDATE(), (SELECT MAX(checkIn) FROM memberattendance WHERE memberId = m.id)),
               16
             ) AS daysAbsent,
             COUNT(a.id) AS totalAttendanceIn30Days
      FROM member m
      LEFT JOIN memberattendance a ON m.id = a.memberId AND a.checkIn >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      WHERE UPPER(m.status) = 'ACTIVE'
    `;
    
    const params = [];
    
    if (adminId && adminId !== 0) {
      sql += ` AND (m.adminId = ? OR m.adminId IS NULL OR m.adminId = 0)`;
      params.push(adminId);
    }
    
    if (branchId && branchId !== 0) {
      sql += ` AND (m.branchId = ? OR m.branchId IS NULL OR m.branchId = 0)`;
      params.push(branchId);
    }
    
    sql += ` GROUP BY m.id`;

    const [rows] = await pool.query(sql, params);

    // Calculate badges
    const members = rows.map(m => {
      // Assuming 26 working days in a month.
      let attendancePercentage = (m.totalAttendanceIn30Days / 26) * 100;
      if (attendancePercentage > 100) attendancePercentage = 100;

      let badge = 'Green';
      // Red: < 40% attendance or absent for 15+ days (including dummy members never checked in)
      if (attendancePercentage < 40 || m.daysAbsent >= 15) {
        badge = 'Red';
      } 
      // Yellow: 40-75% attendance or absent for 7+ days
      else if (attendancePercentage <= 75 || m.daysAbsent >= 7) {
        badge = 'Yellow';
      }
      // Blue: < 90% attendance or absent for 3+ days
      else if (attendancePercentage < 90 || m.daysAbsent >= 3) {
        badge = 'Blue';
      }

      return { 
        ...m, 
        attendancePercentage: Math.round(attendancePercentage), 
        badge 
      };
    });

    res.json({ success: true, members });
  } catch (err) {
    console.error("Error fetching vulnerable members:", err);
    next({ status: 500, message: "Failed to fetch vulnerable members" });
  }
};
