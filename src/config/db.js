import mysql from "mysql2";
import dotenv from "dotenv";
dotenv.config();

// db.js: Updated to trigger nodemon restart
// Create a **Promise Pool directly**
export const pool = mysql
  .createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "",
    database: process.env.DB_NAME || "gym_db",
    port: parseInt(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  })
  .promise(); // 🔥 THIS MAKES pool.query() RETURN A PROMISE

// Test MySQL connection
pool
  .getConnection()
  .then(async (connection) => {
    console.log("✅ MySQL connected successfully!");
    try {
      await connection.query("ALTER TABLE session ADD COLUMN capacity INT NOT NULL DEFAULT 20");
    } catch (e) {
      // Column already exists or error can be safely ignored
    }
    
    try {
      const sql = `
        CREATE TABLE IF NOT EXISTS app_notification (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL,
          senderId INT NULL,
          receiverId INT NOT NULL,
          receiverRole VARCHAR(50) NOT NULL,
          type VARCHAR(100) NOT NULL,
          title VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          referenceType VARCHAR(100) NULL,
          referenceId VARCHAR(100) NULL,
          actionUrl VARCHAR(255) NULL,
          metadata JSON NULL,
          isRead BOOLEAN DEFAULT FALSE,
          readAt DATETIME NULL,
          priority VARCHAR(50) DEFAULT 'NORMAL',
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_tenantId (tenantId),
          INDEX idx_receiverId (receiverId),
          INDEX idx_receiverRole (receiverRole),
          INDEX idx_createdAt (createdAt),
          INDEX idx_isRead (isRead)
        );
      `;
      await connection.query(sql);
      console.log("✅ Table app_notification created or verified.");
    } catch (e) {
      console.error("❌ Failed to create app_notification table:", e.message);
    }
    
    try {
      // Recreate message_templates to match new schema if old one existed
      await connection.query(`
        CREATE TABLE IF NOT EXISTS message_templates_new (
          id INT AUTO_INCREMENT PRIMARY KEY,
          eventKey VARCHAR(100) NOT NULL UNIQUE,
          name VARCHAR(255) NOT NULL,
          subject VARCHAR(255),
          message TEXT NOT NULL,
          channel VARCHAR(100) DEFAULT 'EMAIL',
          isActive BOOLEAN DEFAULT TRUE,
          variables JSON,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );
      `);
      
      // If the old one exists with templateType, we drop it and rename
      const [cols] = await connection.query("SHOW COLUMNS FROM message_templates LIKE 'templateType'");
      if (cols.length > 0) {
        await connection.query("DROP TABLE message_templates");
        await connection.query("RENAME TABLE message_templates_new TO message_templates");
      } else {
        await connection.query("CREATE TABLE IF NOT EXISTS message_templates LIKE message_templates_new");
        await connection.query("DROP TABLE message_templates_new");
      }

      await connection.query(`
        CREATE TABLE IF NOT EXISTS template_audit_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          templateId INT NOT NULL,
          adminId INT,
          ipAddress VARCHAR(45),
          oldSubject VARCHAR(255),
          newSubject VARCHAR(255),
          oldMessage TEXT,
          newMessage TEXT,
          changedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log("✅ Tables message_templates and template_audit_logs created or verified.");

      // Seed Data
      const defaultTemplates = [
        { key: 'WELCOME_TRIAL', name: 'Welcome Trial', subject: 'Welcome to our Gym!', message: 'Hi {Name}, your trial has started.', vars: '["Name"]' },
        { key: 'EXPIRY_REMINDER_DAILY', name: 'Expiry Reminder', subject: 'Plan Expiring Soon', message: 'Hi {Name}, your plan {PlanName} expires in {Days} days.', vars: '["Name", "PlanName", "Days"]' },
        { key: 'TRIAL_EXPIRED_FINAL', name: 'Trial Expired', subject: 'Trial Expired', message: 'Hi {Name}, your trial has expired.', vars: '["Name"]' },
        { key: 'SUBSCRIPTION_ACTIVATED', name: 'Subscription Activated', subject: 'Subscription Activated', message: 'Hi {Name}, your {PlanName} is active.', vars: '["Name", "PlanName"]' },
        { key: 'PLAN_PURCHASED', name: 'Plan Purchased', subject: 'Plan Purchased', message: 'Hi {Name}, you purchased {PlanName}.', vars: '["Name", "PlanName"]' },
        { key: 'PLAN_UPGRADE_REQUEST', name: 'Plan Upgrade Request', subject: 'Upgrade Request', message: 'Hi {Name}, upgrade requested for {PlanName}.', vars: '["Name", "PlanName"]' },
        { key: 'PLAN_UPGRADED', name: 'Plan Upgraded', subject: 'Plan Upgraded', message: 'Hi {Name}, your plan was upgraded to {PlanName}.', vars: '["Name", "PlanName"]' },
        { key: 'MEMBER_CREATED', name: 'Member Created', subject: 'Welcome!', message: 'Hi {Name}, your account is created.', vars: '["Name"]' },
        { key: 'MEMBER_PLAN_ASSIGNED', name: 'Plan Assigned', subject: 'Plan Assigned', message: 'Hi {Name}, {PlanName} has been assigned to you.', vars: '["Name", "PlanName"]' },
        { key: 'PAYMENT_SUCCESS', name: 'Payment Success', subject: 'Payment Successful', message: 'Hi {Name}, your payment of {Amount} was successful.', vars: '["Name", "Amount"]' },
        { key: 'PAYMENT_FAILED', name: 'Payment Failed', subject: 'Payment Failed', message: 'Hi {Name}, your payment of {Amount} failed.', vars: '["Name", "Amount"]' },
        { key: 'ANNOUNCEMENT', name: 'Announcement', subject: 'Gym Announcement', message: 'Dear {Name}, {Message}', vars: '["Name", "Message"]' },
        { key: 'MEMBER_EXPIRED', name: 'Member Expired', subject: 'Membership Expired', message: 'Hi {Name}, your membership has expired.', vars: '["Name"]' },
        { key: 'MEMBER_RENEWED', name: 'Member Renewed', subject: 'Membership Renewed', message: 'Hi {Name}, your membership is renewed.', vars: '["Name"]' },
        { key: 'PASSWORD_RESET', name: 'Password Reset', subject: 'Password Reset', message: 'Hi {Name}, your password reset link is {Link}', vars: '["Name", "Link"]' },
        { key: 'LOGIN_ALERT', name: 'Login Alert', subject: 'New Login', message: 'Hi {Name}, a new login was detected from {IP}.', vars: '["Name", "IP"]' },
        { key: 'EMAIL_VERIFICATION', name: 'Email Verification', subject: 'Verify Email', message: 'Hi {Name}, please verify your email: {Link}', vars: '["Name", "Link"]' },
      ];

      for (const t of defaultTemplates) {
        await connection.query(
          "INSERT IGNORE INTO message_templates (eventKey, name, subject, message, variables) VALUES (?, ?, ?, ?, ?)",
          [t.key, t.name, t.subject, t.message, t.vars]
        );
      }
      console.log("✅ Default message templates seeded.");

    } catch (e) {
      console.error("❌ Failed to create message_templates tables:", e.message);
    }
    
    connection.release();
  })
  .catch((err) => {
    console.error("❌ MySQL connection failed:", err.message);
  });

// // live database
// import mysql from "mysql2";
// import dotenv from "dotenv";
// dotenv.config();

// // Create a **Promise Pool directly**
// export const pool = mysql
//   .createPool({
//     host: "switchback.proxy.rlwy.net",
//     user: "root",
//     password: "LYEPuGdFNazTUxSFwrZilcKIAOlztDYo",
//     database: "railway",
//     port: 35602,
//     waitForConnections: true,
//     connectionLimit: 10,
//     queueLimit: 0,
//   })
//   .promise(); // 🔥 THIS MAKES pool.query() RETURN A PROMISE

// // Test MySQL connection
// pool
//   .getConnection()
//   .then((connection) => {
//     console.log("✅ MySQL connected successfully!");
//     connection.release();
//   })
//   .catch((err) => {
//     console.error("❌ MySQL connection failed:", err.message);
//   });
