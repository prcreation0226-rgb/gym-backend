import { createPurchaseService, getAllPurchasesService, modifyPurchaseStatus} from "./purchase.service.js";
import { pool } from "../../config/db.js";
import { dispatchNotification } from "../../utils/notificationDispatcher.js";
import { uploadToCloudinary } from "../../config/cloudinary.js";
import bcrypt from "bcryptjs";
import { notifySuperAdmin } from "../notifications/notif.service.js";

export const createPurchase = async (req, res) => {
  try {
    const data = req.body;   // selectedPlan, companyName, email, billingDuration, startDate, password

    // Check if user already exists (only for guest registration, not for dashboard upgrades)
    if (!data.isUpgrade) {
      const [existingUsers] = await pool.query(
        "SELECT id FROM user WHERE email = ?",
        [data.email]
      );
      if (existingUsers && existingUsers.length > 0) {
        return res.status(400).json({
          success: false,
          message: "An account with this email address already exists. Please use a different email or log in."
        });
      }
    }

    // Upload profile image if uploaded from landing page
    let imageUrl = null;
    if (req.files?.profileImage) {
      imageUrl = await uploadToCloudinary(
        req.files.profileImage,
        "users/profile"
      );
    }
    data.profileImage = imageUrl;
    data.visiblePassword = data.password || null;

    const purchase = await createPurchaseService(data);

    // Notify Super Admin real-time
    notifySuperAdmin(`New Purchase Request: ${data.companyName || 'Gym'} - Plan: ${data.selectedPlan} (Rs.${data.amount || 0})`, 'IN-APP');

    // If this is a demo payment, auto-approve and activate/create the account instantly!
    if (data.isDemoPaid) {
      // 1. Set purchase request status as approved
      await pool.query("UPDATE purchase SET status = 'approved' WHERE id = ?", [purchase.id]);

      // 2. Fetch user to check if upgrade or new registration
      const [users] = await pool.query(
        "SELECT id, licenseExpiryDate FROM user WHERE email = ?",
        [data.email]
      );

      if (users && users.length > 0) {
        const existingUser = users[0];
        let baseDate = new Date();
        if (existingUser.licenseExpiryDate && new Date(existingUser.licenseExpiryDate) > new Date()) {
          baseDate = new Date(existingUser.licenseExpiryDate);
        }

        let durationDays = 30; // default monthly
        if (data.billingDuration && data.billingDuration.toLowerCase().includes("year")) {
          durationDays = 365;
        }

        const newExpiryDate = new Date(baseDate);
        newExpiryDate.setDate(newExpiryDate.getDate() + durationDays);

        // Update user record to activate new plan
        await pool.query(
          `UPDATE user 
           SET planName = ?, price = ?, duration = ?, licenseExpiryDate = ?, trialStatus = 'None', isTrial = 0
           WHERE id = ?`,
          [data.selectedPlan, data.amount || 0, data.billingDuration || "Monthly", newExpiryDate, existingUser.id]
        );

        // Dispatch Upgrade Invoice Notification
        const invoiceUrl = `http://localhost:5000/api/v1/purchases/invoice/pdf/${purchase.id}`;
        const invoiceMsg = `Hi ${data.companyName || "Gym Owner"}, \n\nThank you for upgrading to the ${data.selectedPlan} plan. We have received your payment of Rs.${data.amount || 0}.\n\nYour new subscription is active.\n\nDownload Tax Invoice PDF: ${invoiceUrl}\nTransaction ID: ${purchase.transactionId || 'N/A'}\n\nRegards,\nSpeed Fitness Team`;
        await dispatchNotification({
          category: "invoice",
          toEmail: data.email,
          toPhone: data.phone,
          toUserId: existingUser.id,
          subject: `Plan Upgrade Receipt - ${data.selectedPlan}`,
          message: invoiceMsg,
        }).catch(err => console.error("Error dispatching upgrade invoice notification:", err.message));
      } else {
        // USER DOES NOT EXIST: Create New Admin Account (Paid Onboarding)
        const hash = await bcrypt.hash(data.password || "Gym@123456", 10);

        let durationDays = 30; // default monthly
        if (data.billingDuration && data.billingDuration.toLowerCase().includes("year")) {
          durationDays = 365;
        } else if (data.selectedPlan && data.selectedPlan.toLowerCase().includes("trial")) {
          durationDays = 7;
        }

        const startDate = data.startDate ? new Date(data.startDate) : new Date();
        const expiryDate = new Date(startDate);
        expiryDate.setDate(expiryDate.getDate() + durationDays);

        let subPlan = "Basic";
        if (data.selectedPlan) {
          const lowPlan = data.selectedPlan.toLowerCase();
          if (lowPlan.includes("trial")) subPlan = "Trial";
          else if (lowPlan.includes("premium") || lowPlan.includes("pro")) subPlan = "Premium";
          else if (lowPlan.includes("growth")) subPlan = "Growth";
        }

        // Insert new admin user
        const sql = `
          INSERT INTO user (
            fullName, email, password, phone, roleId, 
            gymName, planName, price, duration, status, 
            trialStartDate, trialEndDate, trialStatus, licenseExpiryDate, isTrial,
            visiblePassword, tax, subscriptionPlan, gstNumber, address_city, profileImage
          ) 
          VALUES (?, ?, ?, ?, 2, ?, ?, ?, ?, 'Active', null, null, 'None', ?, 0, ?, '18', ?, ?, ?, ?)
        `;

        const [result] = await pool.query(sql, [
          data.adminName || data.companyName || "Gym Owner",
          data.email,
          hash,
          data.phone || null,
          data.companyName || "Gym",
          data.selectedPlan,
          data.amount || 0,
          data.billingDuration || "Monthly",
          expiryDate,
          data.password || "Gym@123456",
          subPlan,
          data.gstNumber || null,
          data.city || null,
          data.profileImage || null
        ]);

        const newUserId = result.insertId;

        // Dispatch onboarding welcome notification
        const messageBody = `🎉 Welcome to Gym Management!
Your Gym Owner account has been created and activated successfully (Paid Plan).

Login Details:
URL: http://localhost:5173/login
Username/Email: ${data.email}
Password: ${data.password || "Gym@123456"}

Please log in and begin managing your gym!`;

        await dispatchNotification({
          category: "welcome_note",
          toEmail: data.email,
          toPhone: data.phone,
          toUserId: newUserId,
          subject: "Your Paid Gym Owner Account is Active!",
          message: messageBody,
        });

        // Dispatch Onboarding Invoice Notification
        const invoiceUrl = `http://localhost:5000/api/v1/purchases/invoice/pdf/${purchase.id}`;
        const invoiceMsg = `Hi ${data.companyName || "Gym Owner"}, \n\nThank you for purchasing the ${data.selectedPlan} plan. We have received your payment of Rs.${data.amount || 0}.\n\nYour Gym Owner account is active.\n\nDownload Tax Invoice PDF: ${invoiceUrl}\nTransaction ID: ${purchase.transactionId || 'N/A'}\n\nRegards,\nSpeed Fitness Team`;
        await dispatchNotification({
          category: "invoice",
          toEmail: data.email,
          toPhone: data.phone,
          toUserId: newUserId,
          subject: `Subscription Invoice - ${data.selectedPlan}`,
          message: invoiceMsg,
        }).catch(err => console.error("Error dispatching onboarding invoice notification:", err.message));
      }

      // Fetch the updated purchase record with generated transaction ID
      const [updatedPurchase] = await pool.query("SELECT * FROM purchase WHERE id = ?", [purchase.id]);

      return res.status(201).json({
        success: true,
        message: "Payment received. Waiting for admin approval.",
        data: updatedPurchase[0] || purchase,
        autoActivated: false
      });
    }

    // If it is a Free Trial, DO NOT auto-approve. Leave as pending for SuperAdmin to review.
    const isTrialPlan = data.selectedPlan && data.selectedPlan.toLowerCase().includes("trial");
    if (isTrialPlan) {
      try {
        await pool.query(
          "UPDATE leads SET status = 'In Progress' WHERE email = ? AND leadType = 'SAAS'",
          [data.email]
        );
      } catch (leadErr) {
        console.error("Failed to update lead status:", leadErr);
      }
    }

    // Fetch Super Admin details for manual paid plan / free trial request notification
    try {
      const [superAdmins] = await pool.query(
        "SELECT id, email, phone FROM user WHERE roleId = 1 LIMIT 1"
      );

      if (superAdmins && superAdmins.length > 0) {
        const superAdmin = superAdmins[0];
        const dateStr = purchase.startDate ? new Date(purchase.startDate).toLocaleDateString('en-GB') : "N/A";
        const message = `🔔 New ${isTrialPlan ? 'Free Trial' : 'Purchase'} Registration Alert!
Gym Name: ${purchase.companyName || "N/A"}
Email: ${purchase.email || "N/A"}
Plan: ${purchase.selectedPlan || "N/A"}
Billing Duration: ${purchase.billingDuration || "N/A"}
Start Date: ${dateStr}`;

        await dispatchNotification({
          category: "free_trial_alert",
          toEmail: superAdmin.email,
          toPhone: superAdmin.phone,
          toUserId: superAdmin.id,
          subject: `New ${isTrialPlan ? 'Free Trial' : 'Purchase'} Registration Request`,
          message: message,
        });
      }
    } catch (notifErr) {
      console.error("Failed to send notification to Super Admin:", notifErr);
    }

    return res.status(201).json({
      success: true,
      message: "Purchase request submitted successfully. Waiting for admin approval.",
      data: purchase,
      autoActivated: false
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getAllPurchases = async (req, res) => {
  try {
    const { email } = req.query;
    const list = await getAllPurchasesService(email);
    return res.status(200).json({
      success: true,
      data: list
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updatePurchaseStatus = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;

    const data = await modifyPurchaseStatus(id, status);

    // If status is approved, trigger activation/upgrade logic
    if (status && status.toLowerCase() === "approved") {
      try {
        // 1. Check if user already exists
        const [users] = await pool.query(
          "SELECT id, licenseExpiryDate FROM user WHERE email = ?",
          [data.email]
        );

        if (users && users.length > 0) {
          // USER EXISTS: Upgrade/Renew plan
          const existingUser = users[0];
          let baseDate = new Date();
          // If current license is still active, extend from it. Otherwise, start from now.
          if (existingUser.licenseExpiryDate && new Date(existingUser.licenseExpiryDate) > new Date()) {
            baseDate = new Date(existingUser.licenseExpiryDate);
          }

          let durationDays = 30; // default monthly
          if (data.billingDuration && data.billingDuration.toLowerCase().includes("year")) {
            durationDays = 365;
          }

          const newExpiryDate = new Date(baseDate);
          newExpiryDate.setDate(newExpiryDate.getDate() + durationDays);

          // Update user table
          await pool.query(
            `UPDATE user 
             SET planName = ?, price = ?, duration = ?, licenseExpiryDate = ?, trialStatus = 'None', isTrial = 0
             WHERE id = ?`,
            [data.selectedPlan, data.amount || 0, data.billingDuration || "Monthly", newExpiryDate, existingUser.id]
          );

          // Notify upgrade approval
          const invoiceUrl = `http://localhost:5000/api/v1/purchases/invoice/pdf/${id}`;
          const messageBody = `🎉 Subscription Approved!
Your request to renew/upgrade your gym plan to "${data.selectedPlan}" has been approved.

Download Tax Invoice PDF: ${invoiceUrl}
New Expiry Date: ${newExpiryDate.toLocaleDateString('en-GB')}
Thank you for staying with us!`;

          await dispatchNotification({
            category: "invoice", // notify using invoice/payment channels
            toEmail: data.email,
            toPhone: data.phone,
            toUserId: existingUser.id,
            subject: "Gym Plan Upgrade Approved",
            message: messageBody,
          });

        } else {
          // USER DOES NOT EXIST: Create New Admin Account
          const tempPassword = data.password || data.visiblePassword || req.body.password || `Gym@${Math.floor(1000 + Math.random() * 9000)}`;
          const hash = await bcrypt.hash(tempPassword, 10);

          let durationDays = 30; // default monthly
          if (data.billingDuration && data.billingDuration.toLowerCase().includes("year")) {
            durationDays = 365;
          } else if (data.selectedPlan && data.selectedPlan.toLowerCase().includes("trial")) {
            durationDays = 7; // default 7 days trial
          }

          const startDate = data.startDate ? new Date(data.startDate) : new Date();
          const expiryDate = new Date(startDate);
          expiryDate.setDate(expiryDate.getDate() + durationDays);

          let trialStatus = "None";
          let trialStartDate = null;
          let trialEndDate = null;

          if (data.selectedPlan && data.selectedPlan.toLowerCase().includes("trial")) {
            trialStatus = "Active";
            trialStartDate = startDate;
            trialEndDate = expiryDate;
          }

          let subPlan = "Basic";
          if (data.selectedPlan) {
            const lowPlan = data.selectedPlan.toLowerCase();
            if (lowPlan.includes("trial")) subPlan = "Trial";
            else if (lowPlan.includes("premium") || lowPlan.includes("pro")) subPlan = "Premium";
            else if (lowPlan.includes("growth")) subPlan = "Growth";
          }

          // Insert new admin user
          const sql = `
            INSERT INTO user (
              fullName, email, password, phone, roleId, 
              gymName, planName, price, duration, status, 
              trialStartDate, trialEndDate, trialStatus, licenseExpiryDate, isTrial,
              visiblePassword, tax, subscriptionPlan, gstNumber, address_city, profileImage
            ) 
            VALUES (?, ?, ?, ?, 2, ?, ?, ?, ?, 'Active', ?, ?, ?, ?, ?, ?, '18', ?, ?, ?, ?)
          `;

          const [result] = await pool.query(sql, [
            data.adminName || data.companyName || "Gym Owner",
            data.email,
            hash,
            data.phone || null,
            data.companyName || "Gym",
            data.selectedPlan,
            data.amount || 0,
            data.billingDuration || "Monthly",
            trialStartDate,
            trialEndDate,
            trialStatus,
            expiryDate,
            trialStatus === "Active" ? 1 : 0,
            tempPassword,
            subPlan,
            data.gstNumber || null,
            data.city || null,
            data.profileImage || null
          ]);

          const newUserId = result.insertId;

          // Dispatch Welcome Credentials Notification
          const messageBody = `🎉 Welcome to Gym Management!
Your Gym Owner account has been created successfully.

Login Details:
URL: http://localhost:5173/login
Username/Email: ${data.email}
Temporary Password: ${tempPassword}

Please log in and change your password immediately under settings.`;

          await dispatchNotification({
            category: "welcome_note",
            toEmail: data.email,
            toPhone: data.phone,
            toUserId: newUserId,
            subject: "Your Gym Owner Account is Active!",
            message: messageBody,
          });

          // Dispatch Subscription Invoice for Paid Plan manually approved
          const isTrial = data.selectedPlan && data.selectedPlan.toLowerCase().includes("trial");
          if (!isTrial) {
            const invoiceMsg = `Hi ${data.companyName || "Gym Owner"}, \n\nThank you for purchasing the ${data.selectedPlan} plan. We have received your payment of Rs.${data.amount || 0}.\n\nYour Gym Owner account is active.\n\nTransaction ID: ${data.transactionId || 'N/A'}\n\nRegards,\nSpeed Fitness Team`;

            await dispatchNotification({
              category: "invoice",
              toEmail: data.email,
              toPhone: data.phone,
              toUserId: newUserId,
              subject: `Subscription Invoice - ${data.selectedPlan}`,
              message: invoiceMsg,
            }).catch(err => console.error("Error dispatching manual approval invoice notification:", err.message));
          }
        }
      } catch (activationErr) {
        console.error("Failed auto-activating user on purchase approval:", activationErr);
      }

      // Auto-convert lead
      try {
        await pool.query(
          "UPDATE leads SET status = 'Converted' WHERE email = ? AND leadType = 'SAAS'",
          [data.email]
        );
      } catch (leadErr) {
        console.error("Failed to auto-convert lead on manual purchase approval:", leadErr);
      }
    } else if (status && status.toLowerCase() === "rejected") {
      // Auto-reject lead
      try {
        await pool.query(
          "UPDATE leads SET status = 'Rejected' WHERE email = ? AND leadType = 'SAAS'",
          [data.email]
        );
      } catch (leadErr) {
        console.error("Failed to auto-reject lead on manual purchase rejection:", leadErr);
      }
    }

    res.json({ success: true, purchase: data });
  } catch (err) {
    next(err);
  }
};

