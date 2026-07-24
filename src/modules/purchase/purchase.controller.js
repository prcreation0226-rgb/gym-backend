import { createPurchaseService, getAllPurchasesService, modifyPurchaseStatus} from "./purchase.service.js";
import { pool } from "../../config/db.js";
import { uploadToCloudinary } from "../../config/cloudinary.js";
import bcrypt from "bcryptjs";
import { sendTemplatedNotification } from "../messageTemplates/messageTemplate.service.js";

export const createPurchase = async (req, res) => {
  try {
    const data = req.body;   // selectedPlan, companyName, email, billingDuration, startDate, password

    if (!data.billingDuration && data.selectedPlan) {
      const [planRecords] = await pool.query("SELECT duration FROM plan WHERE name = ? LIMIT 1", [data.selectedPlan]);
      if (planRecords && planRecords.length > 0) {
        data.billingDuration = planRecords[0].duration;
      } else {
        data.billingDuration = "Monthly";
      }
    }

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
        
        await sendTemplatedNotification({
          eventKey: data.isUpgrade ? 'PLAN_UPGRADE_REQUEST' : 'PLAN_PURCHASED',
          tenantId: superAdmin.id,
          receiverId: superAdmin.id,
          receiverRole: 'Super Admin',
          receiverEmail: superAdmin.email,
          receiverPhone: superAdmin.phone,
          variables: data.isUpgrade ? {
            AdminName: purchase.fullName || purchase.companyName || "Admin",
            GymName: purchase.companyName || "Gym",
            CurrentPlan: "Current Plan", // Optionally map from DB if available, else generic
            RequestedPlan: purchase.selectedPlan || "N/A",
            DateTime: dateStr
          } : {
            Name: purchase.fullName || purchase.companyName || "Admin",
            PlanName: purchase.selectedPlan || "N/A"
          },
          referenceType: 'SUBSCRIPTION',
          referenceId: purchase.id?.toString(),
          actionUrl: '/admin/subscription'
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
        // 0. Fetch the actual Plan from the database to strictly enforce duration
        const [planRecords] = await pool.query(
          "SELECT * FROM plan WHERE name = ? LIMIT 1",
          [data.selectedPlan]
        );

        let planDurationDays = 30; // default safe fallback
        let actualPlanDuration = "Monthly";
        if (planRecords && planRecords.length > 0) {
          actualPlanDuration = planRecords[0].duration;
          if (actualPlanDuration.toLowerCase().includes("year")) {
            planDurationDays = 365;
          } else if (actualPlanDuration.toLowerCase().includes("quarter")) {
            planDurationDays = 90;
          } else if (actualPlanDuration.toLowerCase().includes("7 day")) {
            planDurationDays = 7;
          }
        } else if (data.selectedPlan && data.selectedPlan.toLowerCase().includes("trial")) {
           planDurationDays = 7;
           actualPlanDuration = "7 Days";
        }

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

          const newExpiryDate = new Date(baseDate);
          newExpiryDate.setDate(newExpiryDate.getDate() + planDurationDays);

          // Update user table
          await pool.query(
            `UPDATE user 
             SET planName = ?, price = ?, duration = ?, licenseExpiryDate = ?, trialStatus = 'None', isTrial = 0
             WHERE id = ?`,
            [data.selectedPlan, data.amount || 0, actualPlanDuration, newExpiryDate, existingUser.id]
          );

          // APP NOTIFICATION
          await sendTemplatedNotification({
            eventKey: 'PLAN_UPGRADED',
            tenantId: existingUser.adminId || existingUser.id,
            receiverId: existingUser.id,
            receiverRole: 'Admin',
            receiverEmail: data.email,
            receiverPhone: data.phone,
            variables: {
              Name: data.adminName || data.companyName || "Admin",
              PlanName: data.selectedPlan || "N/A"
            },
            referenceType: 'SUBSCRIPTION',
            referenceId: id.toString(),
            actionUrl: '/admin/subscription'
          });

        } else {
          // USER DOES NOT EXIST: Create New Admin Account
          const tempPassword = data.password || data.visiblePassword || req.body.password || `Gym@${Math.floor(1000 + Math.random() * 9000)}`;
          const hash = await bcrypt.hash(tempPassword, 10);

          const startDate = new Date(); // Start Date is strictly Approval Date
          const expiryDate = new Date(startDate);
          expiryDate.setDate(expiryDate.getDate() + planDurationDays);

          let trialStatus = "None";
          let trialStartDate = null;
          let trialEndDate = null;

          if (data.selectedPlan && (data.selectedPlan.toLowerCase().includes("trial") || data.selectedPlan.toLowerCase().includes("free") || data.amount == 0)) {
            trialStatus = "Active";
            trialStartDate = startDate;
            trialEndDate = expiryDate;
          }

          let subPlan = "Basic";
          if (data.selectedPlan) {
            const lowPlan = data.selectedPlan.toLowerCase();
            if (lowPlan.includes("trial") || lowPlan.includes("free") || (data.amount == 0)) subPlan = "7-Day Trial";
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
            actualPlanDuration,
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
          const newAdminId = newUserId;
          // APP NOTIFICATION
          await sendTemplatedNotification({
            eventKey: 'SUBSCRIPTION_ACTIVATED',
            tenantId: newAdminId,
            receiverId: newAdminId,
            receiverRole: 'Admin',
            receiverEmail: data.email,
            receiverPhone: data.phone,
            variables: {
              Name: data.adminName || data.companyName || "Admin",
              PlanName: data.selectedPlan || "N/A",
              Password: tempPassword,
              LoginUrl: 'http://localhost:5173/login',
              Amount: data.amount || 0
            },
            referenceType: 'SUBSCRIPTION',
            referenceId: id.toString(),
            actionUrl: '/'
          });
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

