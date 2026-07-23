import { pool } from "./src/config/db.js";

async function runMigration() {
  try {
    // 1. Add Trial Columns to User table
    console.log("Adding trial columns to user table...");
    try {
      await pool.query(`ALTER TABLE user 
        ADD COLUMN trialStartDate DATETIME DEFAULT NULL,
        ADD COLUMN trialEndDate DATETIME DEFAULT NULL,
        ADD COLUMN trialStatus ENUM('Active', 'Expired', 'Converted', 'None') DEFAULT 'None',
        ADD COLUMN gracePeriodEndDate DATETIME DEFAULT NULL;
      `);
      console.log("Added trial columns to user table.");
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log("Trial columns already exist in user table.");
      } else {
        throw e;
      }
    }

    // 2. Create Automation Settings Table
    console.log("Creating automation_settings table...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS automation_settings (
        id INT PRIMARY KEY AUTO_INCREMENT,
        trialDurationDays INT DEFAULT 7,
        gracePeriodDays INT DEFAULT 3,
        enableEmailNotif BOOLEAN DEFAULT false,
        enableWhatsappNotif BOOLEAN DEFAULT false,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Insert default settings if empty
    const [settings] = await pool.query("SELECT id FROM automation_settings");
    if (settings.length === 0) {
      await pool.query("INSERT INTO automation_settings (trialDurationDays, gracePeriodDays) VALUES (7, 3)");
    }
    console.log("automation_settings table ready.");

    // 3. Create Message Templates Table
    console.log("Creating message_templates table...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS message_templates (
        id INT PRIMARY KEY AUTO_INCREMENT,
        templateType VARCHAR(50) UNIQUE NOT NULL,
        subject VARCHAR(255) NOT NULL,
        messageBody TEXT NOT NULL,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Insert default templates
    const templates = [
      { type: 'WELCOME_TRIAL', subject: 'Welcome to Your Gym Software Trial!', body: 'Hi {Name}, your {Days}-day free trial has started. Enjoy!' },
      { type: 'EXPIRY_REMINDER_DAILY', subject: 'Your Trial is Expiring Soon', body: 'Hi {Name}, your trial expires on {Date}. Please purchase a subscription to keep access.' },
      { type: 'TRIAL_EXPIRED_FINAL', subject: 'Your Trial Has Expired', body: 'Hi {Name}, your trial has expired. Your account is now inactive. Please upgrade.' },
      { type: 'SUBSCRIPTION_ACTIVATED', subject: 'Welcome Aboard!', body: 'Hi {Name}, thank you for purchasing a subscription. Your account is fully active!' }
    ];

    for (const t of templates) {
      await pool.query(`
        INSERT IGNORE INTO message_templates (templateType, subject, messageBody) 
        VALUES (?, ?, ?)
      `, [t.type, t.subject, t.body]);
    }
    console.log("message_templates table ready.");

    console.log("Migration completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

runMigration();
