import cron from "node-cron";
import { pool } from "../config/db.js";
import { dispatchNotification } from "../utils/notificationDispatcher.js";

export const initTrialCronJobs = () => {
  // Run every day at 00:00 (Midnight)
  cron.schedule("0 0 * * *", async () => {
    console.log("Running Daily Trial & Subscription Automation Job...");

    try {
      const today = new Date();

      // 1. Send Daily Expiry Reminders (For users whose trial is expiring today or is in Grace Period)
      const [expiringUsers] = await pool.query(`
        SELECT id, fullName, email, phone, trialEndDate, gracePeriodEndDate, trialStatus 
        FROM user 
        WHERE roleId = 2 
          AND trialStatus IN ('Active', 'Expired')
          AND trialEndDate IS NOT NULL
          AND gracePeriodEndDate >= NOW()
          AND DATE(trialEndDate) <= DATE(NOW())
      `);

      if (expiringUsers.length > 0) {
        const [templates] = await pool.query("SELECT * FROM message_templates WHERE templateType = 'EXPIRY_REMINDER_DAILY'");
        const reminderTemplate = templates.length > 0 ? templates[0] : null;

        for (const user of expiringUsers) {
          // If trial was Active but now end date passed, update to Expired
          if (user.trialStatus === 'Active' && new Date(user.trialEndDate) < today) {
            await pool.query("UPDATE user SET trialStatus = 'Expired' WHERE id = ?", [user.id]);
          }

          if (reminderTemplate) {
            let msgBody = reminderTemplate.messageBody
              .replace('{Name}', user.fullName)
              .replace('{Date}', new Date(user.trialEndDate).toLocaleDateString());

            console.log(`[AUTOMATION - REMINDER] Dispatched to: ${user.email}`);
            dispatchNotification({
              category: "saas_renewal_channel",
              toEmail: user.email,
              toPhone: user.phone,
              toUserId: user.id,
              subject: reminderTemplate.subject || "Trial Expiry Reminder",
              message: msgBody,
            }).catch(err => console.error("Error dispatching daily expiry reminder:", err.message));
          }
        }
      }

      // 2. Automatic Account Deactivation (Grace period ended without conversion)
      const [expiredGracePeriodUsers] = await pool.query(`
        SELECT id, fullName, email 
        FROM user 
        WHERE roleId = 2 
          AND trialStatus = 'Expired'
          AND gracePeriodEndDate < NOW()
          AND status != 'Inactive'
      `);

      if (expiredGracePeriodUsers.length > 0) {
        const [templates] = await pool.query("SELECT * FROM message_templates WHERE templateType = 'TRIAL_EXPIRED_FINAL'");
        const finalTemplate = templates.length > 0 ? templates[0] : null;

        for (const user of expiredGracePeriodUsers) {
          await pool.query("UPDATE user SET status = 'Inactive' WHERE id = ?", [user.id]);

          if (finalTemplate) {
            let msgBody = finalTemplate.messageBody.replace('{Name}', user.fullName);

            console.log(`[AUTOMATION - DEACTIVATED] Dispatched to: ${user.email}`);
            dispatchNotification({
              category: "saas_renewal_channel",
              toEmail: user.email,
              toPhone: user.phone,
              toUserId: user.id,
              subject: finalTemplate.subject || "Trial Expired Notice",
              message: msgBody,
            }).catch(err => console.error("Error dispatching final trial deactivation notice:", err.message));
          }
        }
      }

    } catch (error) {
      console.error("Error running Daily Trial Automation Job:", error);
    }
  });

  console.log("Trial & Subscription Cron Jobs initialized.");
};
