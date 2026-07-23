import { pool } from "../../config/db.js"; // make sure it's a mysql2/promise pool
import nodemailer from "nodemailer";
import { dispatchNotification } from "../../utils/notificationDispatcher.js";
import { emitToUser } from "../../config/socket.js";

/**
 * Build a styled HTML email body
 */
const buildEmailHtml = (message) => {
  const lines = message.split("\n").map(l => `<p style="margin:4px 0;color:#374151;">${l}</p>`).join("");
  return `
  <!DOCTYPE html>
  <html>
  <head><meta charset="UTF-8"/></head>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:30px 0;">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">💪 Speed Fitness</h1>
              <p style="margin:4px 0 0;color:#e0e7ff;font-size:13px;">Your Fitness Partner</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              ${lines}
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;padding:20px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">This is an automated message from Speed Fitness Gym Management System.</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
  </html>`;
};

/**
 * Send WhatsApp via Meta Cloud API
 */
const sendWhatsAppViaApi = async (phone, message, token, phoneNumberId) => {
  const activeToken = token || process.env.WHATSAPP_ACCESS_TOKEN;
  const activePhoneId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!activeToken || !activePhoneId) {
    console.warn("⚠️ WhatsApp API credentials not set. Skipping WhatsApp send.");
    return false;
  }

  const cleanPhone = phone.toString().replace(/\D/g, "");
  if (!cleanPhone) return false;

  const apiUrl = `https://graph.facebook.com/v19.0/${activePhoneId}/messages`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${activeToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: cleanPhone,
      type: "text",
      text: { preview_url: false, body: message },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error("❌ WhatsApp Meta API Error:", JSON.stringify(data));
    return false;
  }
  console.log(`✅ WhatsApp sent to ${cleanPhone} via Meta Cloud API`);
  return true;
};

/**
 * Send notification using MySQL pool
 * @param {Object} params
 * @param {"EMAIL"|"WHATSAPP"|"IN_APP"|"IN-APP"|"APP_PUSH"} params.type
 * @param {string} params.to  - email address / phone / userId string
 * @param {string} params.message
 * @param {number} [params.memberId]
 * @param {string} [params.subject]
 */
export const sendNotificationService = async ({ type, to, message, memberId, subject }) => {
  // Validate memberId exists in member table to prevent FK constraint failures
  let validMemberId = null;
  if (memberId) {
    try {
      const [mCheck] = await pool.query(`SELECT id FROM member WHERE id = ? LIMIT 1`, [memberId]);
      if (mCheck.length > 0) {
        validMemberId = memberId;
      }
    } catch (e) {
      validMemberId = null;
    }
  }

  // Log with PENDING status first
  const [logResult] = await pool.query(
    `INSERT INTO notificationLog (type, \`to\`, message, memberId, status) VALUES (?, ?, ?, ?, ?)`,
    [type, to, message, validMemberId, "PENDING"]
  );
  const logId = logResult.insertId;

  try {
    // ────────────────────────────────────────────
    // 1. EMAIL  →  SendGrid SMTP
    // ────────────────────────────────────────────
    if (type === "EMAIL") {
      if (!to || !to.includes("@")) {
        await pool.query(`UPDATE notificationLog SET status = 'FAILED' WHERE id = ?`, [logId]);
        return { success: false, reason: "Invalid email address: " + to };
      }

      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        tls: { rejectUnauthorized: false }
      });

      await transporter.sendMail({
        from: process.env.MAIL_FROM || "Speed Fitness <noreply@gymsoftware.space>",
        to,
        subject: subject || "Speed Fitness — Gym Notification",
        text: message,
        html: buildEmailHtml(message),
      });

      await pool.query(`UPDATE notificationLog SET status = 'SENT' WHERE id = ?`, [logId]);
      console.log(`✉️ Email sent to ${to}`);
      return { success: true };
    }

    // ────────────────────────────────────────────
    // 2. WHATSAPP  →  Meta Cloud API (backend)
    // ────────────────────────────────────────────
    else if (type === "WHATSAPP") {
      const isSent = await sendWhatsAppViaApi(to, message, null, null);
      const status = isSent ? "SENT" : "FAILED";
      await pool.query(`UPDATE notificationLog SET status = ? WHERE id = ?`, [status, logId]);
      return { success: isSent, status };
    }

    // ────────────────────────────────────────────
    // 3. IN_APP  →  Bell Icon (notificationlog UNREAD)
    // ────────────────────────────────────────────
    else if (type === "IN_APP" || type === "IN-APP" || type === "APP_PUSH") {
      await pool.query(
        `UPDATE notificationLog SET type = 'IN_APP', status = 'UNREAD' WHERE id = ?`,
        [logId]
      );
      // Real-time socket push if userId is numeric
      const numericId = parseInt(to);
      if (!isNaN(numericId)) {
        emitToUser(numericId, "new_notification", {
          id: logId,
          type: "IN_APP",
          to,
          message,
          status: "UNREAD",
          createdAt: new Date().toISOString(),
        });
      }
      console.log(`🔔 IN_APP notification logged for user: ${to}`);
    }

    return { id: logId, type, to, message, memberId, status: "SENT" };
  } catch (err) {
    await pool.query(
      `UPDATE notificationLog SET status = 'FAILED', error = ? WHERE id = ?`,
      [err.message, logId]
    );
    console.error(`❌ Notification FAILED [${type}] to ${to}:`, err.message);
    throw new Error("Notification sending failed: " + err.message);
  }
};

import { formatISTDate } from "../../utils/dateHelper.js";

export const getUserNotificationsService = async (userId) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM notificationlog 
       WHERE (\`to\` = ? OR \`to\` = 'all' OR \`to\` = 'staff') 
         AND status IN ('UNREAD', 'PENDING')
       ORDER BY createdAt DESC LIMIT 20`,
      [userId.toString()]
    );
    return rows.map(r => ({
      ...r,
      ...(formatISTDate ? formatISTDate(r.createdAt) : {})
    }));
  } catch (err) {
    console.error("getUserNotificationsService error:", err.message);
    return [];
  }
};

export const getAllUserNotificationsService = async (userId) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM notificationlog 
       WHERE (\`to\` = ? OR \`to\` = 'all' OR \`to\` = 'staff')
       ORDER BY createdAt DESC LIMIT 100`,
      [userId.toString()]
    );
    return rows.map(r => ({
      ...r,
      ...(formatISTDate ? formatISTDate(r.createdAt) : {})
    }));
  } catch (err) {
    console.error("getAllUserNotificationsService error:", err.message);
    return [];
  }
};

export const markAsReadService = async (id) => {
  const [rows] = await pool.query(`SELECT \`to\` FROM notificationlog WHERE id = ?`, [id]);
  
  await pool.query(
    `UPDATE notificationlog SET status = 'READ' WHERE id = ?`,
    [id]
  );
  
  if (rows.length > 0) {
    const userId = rows[0].to;
    import("../../config/socket.js").then(({ getIO, emitToUser }) => {
      const io = getIO();
      if (io) {
        emitToUser(userId, "notification_read", { id });
      }
    });
  }
  return true;
};

export const markAllAsReadService = async (userId) => {
  await pool.query(
    `UPDATE notificationlog SET status = 'READ', is_read = TRUE WHERE \`to\` = ? AND (status != 'READ' OR is_read = FALSE)`,
    [userId.toString()]
  );
  
  import("../../config/socket.js").then(({ getIO, emitToUser }) => {
    const io = getIO();
    if (io) {
      emitToUser(userId.toString(), "all_notifications_read", {});
    }
  });
  return true;
};

// --- Broadcast Services for Super Admin ---

export const broadcastAnnouncementService = async ({
  subject,
  message,
  channels,
  targetRoles,
  sentBy,
  imageUrl
}) => {
  // 1. Fetch target users who are active and match target roles
  const [users] = await pool.query(
    `SELECT id, fullName, email, phone 
     FROM user 
     WHERE roleId IN (?) AND status = 'Active'`,
    [targetRoles]
  );

  console.log(`📣 Broadcasting announcement to ${users.length} target users...`);

  // 2. Save announcement to history table
  await pool.query(
    `INSERT INTO announcement (subject, message, channels, targetRoles, sentBy, imageUrl) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      subject,
      message,
      JSON.stringify(channels),
      JSON.stringify(targetRoles),
      sentBy || null,
      imageUrl || null
    ]
  );

  let successCount = 0;
  let failCount = 0;

  // 3. Dispatch notifications asynchronously for each target user
  for (const user of users) {
    try {
      dispatchNotification({
        category: "announcement",
        toEmail: user.email,
        toPhone: user.phone,
        toUserId: user.id,
        subject,
        message: imageUrl ? `${message}\n\n📎 Attachment: ${imageUrl}` : message,
        customChannels: channels
      }).catch(err => console.error(`❌ Async dispatch error for user ${user.id}:`, err.message));
      
      successCount++;
    } catch (err) {
      console.error(`❌ Failed to initiate broadcast for user ${user.id}:`, err.message);
      failCount++;
    }
  }

  return {
    totalTargeted: users.length,
    successCount,
    failCount
  };
};

export const getBroadcastHistoryService = async () => {
  const [rows] = await pool.query(
    `SELECT a.*, u.fullName AS senderName 
     FROM announcement a
     LEFT JOIN user u ON u.id = a.sentBy
     ORDER BY a.id DESC`
  );
  
  return rows.map(r => ({
    ...r,
    channels: JSON.parse(r.channels),
    targetRoles: JSON.parse(r.targetRoles)
  }));
};

// --- Broadcast Services for Admin ---

export const adminBroadcastAnnouncementService = async ({
  subject,
  message,
  channels,
  targetAudience, // ["MEMBERS", "STAFF"]
  sentBy,
  branchId,
  adminId,
  imageUrl
}) => {
  let targetUsers = [];

  if (targetAudience.includes("MEMBERS")) {
    const query = `SELECT id, userId, fullName, email, phone FROM member WHERE status = 'Active' AND adminId = ?`;
    const params = [adminId];

    const [members] = await pool.query(query, params);
    // map to standard user structure, mapping id to userId so notification target is correct
    targetUsers = [...targetUsers, ...members.map(m => ({ ...m, id: m.userId, role: "MEMBER" }))];
  }

  if (targetAudience.includes("STAFF")) {
    const query = `SELECT id, fullName, email, phone FROM user WHERE status = 'Active' AND adminId = ? AND roleId NOT IN (1, 2, 9)`;
    const params = [adminId];

    const [staff] = await pool.query(query, params);
    targetUsers = [...targetUsers, ...staff.map(s => ({ ...s, role: "STAFF" }))];
  }

  console.log(`📣 Broadcasting admin announcement to ${targetUsers.length} users in branch ${branchId || 'All'}...`);

  // Save announcement to history
  await pool.query(
    `INSERT INTO announcement (subject, message, channels, targetRoles, sentBy, branchId, adminId, imageUrl) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      subject,
      message,
      JSON.stringify(channels),
      JSON.stringify(targetAudience),
      sentBy || null,
      branchId || null,
      adminId,
      imageUrl || null
    ]
  );

  let successCount = 0;
  let failCount = 0;

  for (const user of targetUsers) {
    try {
      dispatchNotification({
        category: "announcement",
        toEmail: user.email,
        toPhone: user.phone,
        toUserId: user.id,
        subject,
        message: imageUrl ? `${message}\n\n📎 Attachment: ${imageUrl}` : message,
        customChannels: channels
      }).catch(err => console.error(`❌ Async dispatch error:`, err.message));
      
      successCount++;
    } catch (err) {
      failCount++;
    }
  }

  return { totalTargeted: targetUsers.length, successCount, failCount };
};

export const getAdminBroadcastHistoryService = async (adminId) => {
  const [rows] = await pool.query(
    `SELECT a.*, u.fullName AS senderName 
     FROM announcement a
     LEFT JOIN user u ON u.id = a.sentBy
     WHERE a.adminId = ?
     ORDER BY a.id DESC`,
    [adminId]
  );
  
  return rows.map(r => {
    let parsedRoles = [];
    try {
      parsedRoles = r.targetRoles ? JSON.parse(r.targetRoles) : [];
    } catch (e) {
      parsedRoles = [];
    }
    return {
      ...r,
      channels: JSON.parse(r.channels),
      targetRoles: parsedRoles
    };
  });
};

export const getUserAnnouncementsService = async (adminId, branchId, roleGroup) => {
  let query = "";
  let params = [];
  
  if (roleGroup === 'ADMIN') {
    // Admins see their own announcements AND system-wide superadmin announcements
    query = `
       SELECT a.*, u.fullName AS senderName 
       FROM announcement a
       LEFT JOIN user u ON u.id = a.sentBy
       WHERE a.adminId = ? OR (a.adminId IS NULL AND a.sentBy IN (SELECT id FROM user WHERE roleId = 1))
       ORDER BY a.createdAt DESC
    `;
    params = [adminId];
  } else {
    // Members and staff see only their own gym's announcements
    query = `
       SELECT a.*, u.fullName AS senderName 
       FROM announcement a
       LEFT JOIN user u ON u.id = a.sentBy
       WHERE a.adminId = ?
       ORDER BY a.createdAt DESC
    `;
    params = [adminId];
  }

  const [rows] = await pool.query(query, params);
  
  const announcements = rows.map(r => {
    let parsedRoles = [];
    try {
      parsedRoles = r.targetRoles ? JSON.parse(r.targetRoles) : [];
    } catch (e) {
      parsedRoles = [];
    }
    return {
      ...r,
      channels: JSON.parse(r.channels),
      targetRoles: parsedRoles
    };
  });

  if (roleGroup === 'ADMIN') {
    // Filter to own announcements OR superadmin announcements targeting Admins (roleId 2)
    return announcements.filter(a => a.adminId === adminId || a.targetRoles.includes(2) || a.targetRoles.includes("2"));
  } else {
    // Filter to roleGroup (MEMBERS or STAFF)
    return announcements.filter(a => a.targetRoles.includes(roleGroup));
  }
};

// ─────────────────────────────────────────────────────────
// Personal Notification: Admin → Individual Member
// ─────────────────────────────────────────────────────────
export const sendPersonalNotificationService = async ({ memberId, memberUserId, category, message, sentBy }) => {
  // 1. Save to notificationlog (this is what the Bell Icon reads)
  const notifMessage = `[${category}] ${message}`;
  
  // Get member info for email/whatsapp (optional future use)
  const [memberRows] = await pool.query(
    `SELECT id, fullName, email, phone FROM member WHERE id = ?`, 
    [memberId]
  );

  if (!memberRows.length) {
    throw new Error("Member not found");
  }

  // 2. Insert into notificationlog for Bell Icon
  await pool.query(
    `INSERT INTO notificationlog (type, \`to\`, message, memberId, status, createdAt)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    ["APP_PUSH", memberRows[0].email || "member", notifMessage, memberId, "SENT"]
  );

  // 3. Also log in personal_notifications table for history
  await pool.query(
    `INSERT INTO personal_notification (memberId, category, message, sentBy, createdAt)
     VALUES (?, ?, ?, ?, NOW())`,
    [memberId, category, message, sentBy]
  );

  return {
    success: true,
    memberName: memberRows[0].fullName,
    category,
    message
  };
};

export const getPersonalNotifHistoryService = async (adminId) => {
  try {
    const [rows] = await pool.query(
      `SELECT pn.*, m.fullName AS memberName
       FROM personal_notification pn
       LEFT JOIN member m ON m.id = pn.memberId
       WHERE pn.sentBy IN (SELECT id FROM user WHERE adminId = ? OR id = ?) OR pn.sentBy IS NULL
       ORDER BY pn.createdAt DESC
       LIMIT 50`,
      [adminId, adminId]
    );
    return rows;
  } catch (err) {
    console.warn("Notice in getPersonalNotifHistoryService:", err.message);
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS personal_notification (
          id INT AUTO_INCREMENT PRIMARY KEY,
          memberId INT NOT NULL,
          category VARCHAR(100) DEFAULT 'General',
          message TEXT NOT NULL,
          sentBy INT NULL,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      );
      const [rows] = await pool.query(
        `SELECT pn.*, m.fullName AS memberName
         FROM personal_notification pn
         LEFT JOIN member m ON m.id = pn.memberId
         WHERE pn.sentBy IN (SELECT id FROM user WHERE adminId = ? OR id = ?) OR pn.sentBy IS NULL
         ORDER BY pn.createdAt DESC
         LIMIT 50`,
        [adminId, adminId]
      );
      return rows;
    } catch (e) {
      return [];
    }
  }
};
export const deleteAnnouncementService = async (id, adminId) => {
  if (adminId) {
    const [existing] = await pool.query(
      "SELECT id FROM announcement WHERE id = ? AND adminId = ?",
      [id, adminId]
    );
    if (!existing.length) {
      throw { status: 403, message: "Unauthorized to delete this announcement or announcement not found." };
    }
  }

  await pool.query("DELETE FROM announcement WHERE id = ?", [id]);
  return true;
};

// ─────────────────────────────────────────────────────────
// Real-time Notification for Super Admin
// ─────────────────────────────────────────────────────────
export const notifySuperAdmin = async (message, type = "SYSTEM_ALERT") => {
  try {
    // Find superadmin (roleId = 1) and sub-admins (roleId = 9)
    const [superAdmins] = await pool.query(`SELECT id FROM user WHERE roleId IN (1, 9) AND status = 'Active'`);
    
    if (superAdmins.length === 0) return; // No superadmin found

    for (const sa of superAdmins) {
      const superAdminId = sa.id;
      
      // Save in notificationlog
      const [logResult] = await pool.query(
        `INSERT INTO notificationlog (type, \`to\`, message, status, createdAt)
         VALUES (?, ?, ?, ?, NOW())`,
        [type, superAdminId.toString(), message, "UNREAD"]
      );

      const notifData = {
        id: logResult.insertId,
        type,
        to: superAdminId.toString(),
        message,
        status: "UNREAD",
        createdAt: new Date().toISOString()
      };

      // Emit real-time via Socket.io
      emitToUser(superAdminId, "new_notification", notifData);
    }
  } catch (err) {
    console.error("❌ Failed to notify SuperAdmin:", err.message);
  }
};
