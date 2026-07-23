import { pool } from "../config/db.js";
import nodemailer from "nodemailer";

/**
 * Build styled HTML email
 */
const buildEmailHtml = (subject, message) => {
  const lines = message.split("\n").map(l => `<p style="margin:6px 0;color:#374151;font-size:15px;">${l}</p>`).join("");
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px 32px;">
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">💪 Speed Fitness</h1>
            <p style="margin:4px 0 0;color:#e0e7ff;font-size:13px;">Your Fitness Partner</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 16px;color:#1e1b4b;font-size:18px;">${subject}</h2>
            ${lines}
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:20px 32px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#9ca3af;font-size:12px;">This is an automated message from Speed Fitness Gym Management. Please do not reply.</p>
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
 * Uses admin's custom token if available, falls back to global .env credentials
 */
const sendWhatsAppViaMetaApi = async (phone, message, customToken = null, customPhoneId = null) => {
  const token = customToken || process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = customPhoneId || process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    console.warn("⚠️ WhatsApp: No API credentials configured. Skipping.");
    return false;
  }

  const cleanPhone = phone.toString().replace(/\D/g, "");
  if (!cleanPhone || cleanPhone.length < 10) {
    console.warn("⚠️ WhatsApp: Invalid phone number:", phone);
    return false;
  }

  try {
    const response = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
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
      console.error(`❌ WhatsApp Meta API Error for ${cleanPhone}:`, JSON.stringify(data));
      return false;
    }
    console.log(`✅ WhatsApp sent to ${cleanPhone} via Meta Cloud API`);
    return true;
  } catch (err) {
    console.error("❌ WhatsApp API fetch error:", err.message);
    return false;
  }
};

/**
 * Get active channels for a notification category from global_settings table
 */
export const getGlobalNotificationChannels = async (category) => {
  try {
    const keyName = category + "_channel";
    const [rows] = await pool.query(
      "SELECT value_data FROM global_settings WHERE key_name = ?",
      [keyName]
    );
    if (rows.length === 0) return ["EMAIL"];
    return JSON.parse(rows[0].value_data);
  } catch (err) {
    console.error("Error reading global notification settings for " + category + ":", err.message);
    return ["EMAIL"];
  }
};

/**
 * Smart Notification Dispatcher
 * Handles EMAIL (SendGrid), WHATSAPP (Meta Cloud API), IN_APP/APP_PUSH (Bell Icon)
 */
export const dispatchNotification = async ({
  category,
  toEmail,
  toPhone,
  toUserId,
  memberId,
  subject = "Speed Fitness — Gym Notification",
  message,
  customChannels,
  adminIdForCredits = null,
}) => {
  if (!message) {
    console.warn("⚠️ Notification Dispatcher: Message is empty. Skipping.");
    return { success: false, reason: "Message is empty" };
  }

  const activeChannels = customChannels || await getGlobalNotificationChannels(category);
  console.log(`📣 Dispatching '${category}' via channels:`, activeChannels);

  const results = { category, channels: activeChannels, email: null, whatsapp: null, inApp: null };

  // ── Resolve Admin ID for custom credentials ──
  let adminId = adminIdForCredits;
  if (!adminId && memberId) {
    const [memRows] = await pool.query("SELECT adminId FROM member WHERE id = ?", [memberId]);
    if (memRows.length > 0) adminId = memRows[0].adminId;
  }
  if (!adminId && toUserId) {
    const [uRows] = await pool.query("SELECT adminId, roleId, id FROM user WHERE id = ?", [toUserId]);
    if (uRows.length > 0) {
      adminId = uRows[0].roleId === 2 ? uRows[0].id : uRows[0].adminId;
    }
  }

  // ── Load admin's custom SMTP + WhatsApp credentials (if set) ──
  let adminCreds = null;
  if (adminId) {
    const [rows] = await pool.query(
      "SELECT smtpHost, smtpPort, smtpUser, smtpPass, whatsappAccessToken, whatsappPhoneNumberId, whatsappCredits FROM user WHERE id = ?",
      [adminId]
    );
    if (rows.length > 0) adminCreds = rows[0];
  }

  // ════════════════════════════════════════════
  // 1.  EMAIL  →  SendGrid (or admin custom SMTP)
  // ════════════════════════════════════════════
  if (activeChannels.includes("EMAIL") && toEmail) {
    try {
      const smtpHost = adminCreds?.smtpHost || process.env.SMTP_HOST;
      const smtpPort = adminCreds?.smtpPort || Number(process.env.SMTP_PORT) || 587;
      const smtpUser = adminCreds?.smtpUser || process.env.SMTP_USER;
      const smtpPass = adminCreds?.smtpPass || process.env.SMTP_PASS;

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: false, // STARTTLS on port 587
        auth: { user: smtpUser, pass: smtpPass },
        tls: { rejectUnauthorized: false },
        logger: false,
        debug: false,
      });

      await transporter.sendMail({
        from: process.env.MAIL_FROM || "Speed Fitness <noreply@gymsoftware.space>",
        to: toEmail,
        subject,
        text: message,
        html: buildEmailHtml(subject, message),
      });

      await pool.query(
        "INSERT INTO notificationLog (type, `to`, message, memberId, status) VALUES (?, ?, ?, ?, ?)",
        ["EMAIL", toEmail, message, memberId || null, "SENT"]
      );
      results.email = { success: true };
      console.log(`✉️ Email sent to ${toEmail}`);
    } catch (err) {
      console.error(`❌ Email failed for ${toEmail}:`, err.message);
      results.email = { success: false, error: err.message };
      await pool.query(
        "INSERT INTO notificationLog (type, `to`, message, memberId, status) VALUES (?, ?, ?, ?, ?)",
        ["EMAIL", toEmail, message, memberId || null, "FAILED"]
      ).catch(() => {});
    }
  }

  // ════════════════════════════════════════════
  // 2.  WHATSAPP  →  Meta Cloud API
  // ════════════════════════════════════════════
  let fallbackToAppPush = false;

  if (activeChannels.includes("WHATSAPP") && toPhone) {
    try {
      const customToken = adminCreds?.whatsappAccessToken || null;
      const customPhoneId = adminCreds?.whatsappPhoneNumberId || null;
      let credits = adminCreds?.whatsappCredits ?? 999; // treat missing as unlimited

      if (adminId) {
        // Credit-based flow (if admin has credits configured)
        const [creditRows] = await pool.query("SELECT whatsappCredits FROM user WHERE id = ?", [adminId]);
        credits = creditRows[0]?.whatsappCredits ?? 999;
      }

      if (credits > 0 || credits === 999) {
        const cleanPhone = toPhone.trim().replace(/\D/g, "");
        const isSent = await sendWhatsAppViaMetaApi(cleanPhone, message, customToken, customPhoneId);

        if (isSent && adminId && credits !== 999) {
          // Deduct credit
          await pool.query("UPDATE user SET whatsappCredits = whatsappCredits - 1 WHERE id = ?", [adminId]);
          credits -= 1;

          // Log credit usage
          await pool.query(
            "INSERT INTO whatsapp_credit_transactions (userId, creditsUsed, transactionType, description) VALUES (?, 1, 'USAGE', ?)",
            [adminId, "Sent WhatsApp to " + cleanPhone]
          ).catch(() => {});

          // Low credit alert
          const [autoRows] = await pool.query("SELECT lowCreditThreshold FROM automation_settings LIMIT 1").catch(() => [[{}]]);
          const threshold = autoRows[0]?.lowCreditThreshold || 50;
          if (credits <= threshold) {
            await pool.query(
              "INSERT INTO notificationLog (type, `to`, message, status) VALUES (?, ?, ?, ?)",
              ["IN-APP", adminId.toString(), `⚠️ Low WhatsApp Credits: Only ${credits} remaining. Please recharge.`, "UNREAD"]
            ).catch(() => {});
          }
        }

        await pool.query(
          "INSERT INTO notificationLog (type, `to`, message, memberId, status) VALUES (?, ?, ?, ?, ?)",
          ["WHATSAPP", toPhone, message, memberId || null, isSent ? "SENT" : "FAILED"]
        );
        results.whatsapp = { success: isSent };
      } else {
        console.warn(`⚠️ WhatsApp credits exhausted for Admin ${adminId}. Falling back to App Push.`);
        fallbackToAppPush = true;
        results.whatsapp = { success: false, reason: "Insufficient Credits" };
      }
    } catch (err) {
      console.error(`❌ WhatsApp dispatch failed for ${toPhone}:`, err.message);
      results.whatsapp = { success: false, error: err.message };
    }
  }

  // ════════════════════════════════════════════
  // 3.  IN_APP / APP_PUSH  →  Bell Icon
  // ════════════════════════════════════════════
  const needsInApp =
    activeChannels.includes("APP_PUSH") ||
    activeChannels.includes("IN_APP") ||
    activeChannels.includes("IN-APP") ||
    fallbackToAppPush;

  if (needsInApp && toUserId) {
    try {
      const [result] = await pool.query(
        "INSERT INTO notificationLog (type, `to`, message, memberId, status, is_read) VALUES (?, ?, ?, ?, ?, ?)",
        ["IN-APP", toUserId.toString(), message, memberId || null, "UNREAD", 0]
      );
      results.inApp = { success: true };
      console.log(`🔔 IN_APP notification saved for User ID ${toUserId}`);

      import("../config/socket.js").then(({ getIO, emitToUser }) => {
        const io = getIO();
        if (io) {
          emitToUser(toUserId.toString(), "new_notification", {
            id: result.insertId,
            type: "IN-APP",
            to: toUserId.toString(),
            message: message,
            is_read: 0,
            createdAt: new Date().toISOString()
          });
        }
      });
    } catch (err) {
      console.error(`❌ IN_APP notification failed for User ID ${toUserId}:`, err.message);
      results.inApp = { success: false, error: err.message };
    }
  }

  return { success: true, results };
};
