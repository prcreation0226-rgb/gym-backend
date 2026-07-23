import { pool } from "../../config/db.js";  // ✅ named import

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { ENV } from "../../config/env.js";
import { notifySuperAdmin } from "../notifications/notif.service.js";
import { uploadToCloudinary } from "../../config/cloudinary.js";
import { dispatchNotification } from "../../utils/notificationDispatcher.js";

/**************************************
 * REGISTER USER (CREATE)
 **************************************/
export const registerUser = async (data,payload) => {
 
  const fullName = data.fullName?.trim();
  const email = data.email?.trim();
  const password = data.password;
  const phone = data.phone?.trim() || null;
  const roleId = data.roleId;
  const branchId = data.branchId || null;
  const gstNumber = data.gstNumber || null;
  const tax = data.tax || '18';
  const gymAddress = data.gymAddress || null;

  // ✅ Subscription & License fields
  const subscriptionPlan = data.subscriptionPlan || 'Basic';
  const licenseExpiryDate = data.licenseExpiryDate || null;

  const gymName = data.gymName || null;
  const address = data.address || null;
  const planName = data.planName || null;
  const price = data.price || null;
  const duration = data.duration || null;
  const description = data.description || null;
  const status = data.status || null;

  // ✅ Jis admin ne ye user create kiya hai
  const adminId = data.adminId || null;

  if (!fullName || !email || !password || !roleId) {
    throw { status: 400, message: "fullName, email, password, roleId required" };
  }

  // Check email
  const [ex] = await pool.query(
    "SELECT id FROM user WHERE email = ?",
    [email]
  );
  if (ex.length > 0) throw { status: 400, message: "Email already exists" };

  const hash = await bcrypt.hash(password, 10);

  

  // const sql = `
  //   INSERT INTO user (
  //     fullName, email, password, phone, roleId, branchId, 
  //     gymName, address, planName, price, duration, description, status, adminId,profileImage
  //   ) 
  //   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  // `;

  // Get Automation Settings to configure Trial (Only for Admin/Superadmin)
  let trialStartDate = null;
  let trialEndDate = null;
  let gracePeriodEndDate = null;
  let trialStatus = 'None';
  let welcomeTemplate = null;

  // Assuming roleId = 2 means Admin (Gym Owner)
  // ONLY apply trial if subscriptionPlan is 'Trial'
  const isTrialSelected = subscriptionPlan === 'Trial' || data.isTrial === true || data.isTrial === 'true' || data.isTrial === 1;

  if ((roleId === 2 || roleId === '2') && isTrialSelected) {
    const [settings] = await pool.query('SELECT * FROM automation_settings LIMIT 1');
    if (settings.length > 0) {
      const trialDays = settings[0].trialDurationDays || 7;
      const graceDays = settings[0].gracePeriodDays || 3;
      
      trialStartDate = new Date();
      trialEndDate = new Date(trialStartDate);
      trialEndDate.setDate(trialEndDate.getDate() + trialDays);
      
      gracePeriodEndDate = new Date(trialEndDate);
      gracePeriodEndDate.setDate(gracePeriodEndDate.getDate() + graceDays);

      trialStatus = 'Active';
    }

    const [templates] = await pool.query("SELECT * FROM message_templates WHERE templateType = 'WELCOME_TRIAL'");
    welcomeTemplate = templates.length > 0 ? templates[0] : null;
  }

  const sql = `
    INSERT INTO user (
      fullName, email, password, phone, roleId, branchId, 
      gymName, address, planName, price, duration, description, status, adminId, profileImage, gstNumber, tax, gymAddress,
      subscriptionPlan, licenseExpiryDate,
      trialStartDate, trialEndDate, trialStatus, gracePeriodEndDate, isTrial
    ) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const [result] = await pool.query(sql, [
    fullName,
    email,
    hash,
    phone,
    roleId,
    branchId,
    gymName,
    address,
    planName,
    price,
    duration,
    description,
    status,
    adminId,
    payload.profileImage || null,
    gstNumber,
    tax,
    gymAddress,
    subscriptionPlan,
    licenseExpiryDate,
    trialStartDate,
    trialEndDate,
    trialStatus,
    gracePeriodEndDate,
    isTrialSelected ? 1 : 0
  ]);

  // ✅ Send real Welcome Email + WhatsApp when Admin registers (Trial or otherwise)
  if (trialStatus === 'Active' && welcomeTemplate) {
    let msgBody = welcomeTemplate.messageBody
      .replace('{Name}', fullName)
      .replace('{Days}', Math.round((trialEndDate - trialStartDate) / (1000 * 60 * 60 * 24)));

    dispatchNotification({
      category: "saas_renewal_channel",
      toEmail: email,
      toPhone: phone || null,
      toUserId: result.insertId,
      subject: welcomeTemplate.subject || "Welcome to Speed Fitness!",
      message: msgBody,
    }).catch(err => console.error("❌ Error sending admin trial welcome notification:", err.message));
  } else if (roleId == 2 || roleId == '2') {
    // Admin registered without trial – still send a welcome email with credentials
    const credMsg = `Hi ${fullName},\n\nYour gym admin account has been created successfully.\n\nLogin Details:\nEmail: ${email}\nPassword: ${data.password}\n\nGym: ${gymName || 'N/A'}\n\nRegards,\nSpeed Fitness Team`;
    dispatchNotification({
      category: "saas_renewal_channel",
      toEmail: email,
      toPhone: phone || null,
      toUserId: result.insertId,
      subject: "Your Gym Admin Account — Speed Fitness",
      message: credMsg,
    }).catch(err => console.error("❌ Error sending admin welcome email:", err.message));
  }

  // Return full user object
  const newUser = {
    id: result.insertId,
    fullName,
    email,
    phone,
    roleId,
    branchId,
    gymName,
    address,
    planName,
    price,
    duration,
    description,
    status,
    adminId,
    profileImage: payload.profileImage || null,
    gstNumber,
    tax,
    gymAddress,
    subscriptionPlan,
    licenseExpiryDate
  };

  if (roleId === 2 || roleId === '2') {
    notifySuperAdmin(`New Admin created: ${fullName} (${email}) for Gym: ${gymName || 'N/A'}`, 'IN-APP');
  }

  return newUser;
};



/**************************************
 * LOGIN USER
 **************************************/
// export const loginUser = async ({ email, password }) => {
//   const sql = `
//     SELECT u.*, r.roleId AS roleName, b.name AS branchName
//     FROM user u
//     LEFT JOIN role r ON r.id = u.roleId
//     LEFT JOIN branch b ON b.id = u.branchId
//     WHERE u.email = ?
//   `;

//   const [rows] = await pool.query(sql, [email]);
//   const user = rows[0];
//   if (!user) throw { status: 400, message: "User not found" };

//   const match = await bcrypt.compare(password, user.password);
//   if (!match) throw { status: 401, message: "Invalid password" };

//   const token = jwt.sign(
//     {
//       id: user.id,
//       role: user.roleId,
//       branchId: user.branchId,
//     },
//     ENV.jwtSecret,
//     { expiresIn: "7d" }
//   );

//   return {
//     token,
//     user: {
//       id: user.id,
//       fullName: user.fullName,
//       email: user.email,
//       phone: user.phone,
//       role: user.roleId,
//       branchId: user.branchId,
//       branchName: user.branchName,
//     }
//   };
// };


// ✅ service
export const loginUser = async ({ email, password }) => {
  /* ===============================
     1️⃣ GET USER + ROLE + BRANCH
  =============================== */
  const sql = `
    SELECT 
      u.id,
      u.fullName,
      u.email,
      u.phone,
      u.password,
      u.roleId,
      u.branchId,
      u.adminId,
      u.profileImage,
      u.permissions,
      u.status,
      u.trialStatus,
      u.isTrial,
      u.licenseExpiryDate,
      u.razorpayKeyId,
      r.name AS roleName,
      b.name AS branchName
    FROM user u
    LEFT JOIN role r ON r.id = u.roleId
    LEFT JOIN branch b ON b.id = u.branchId
    WHERE u.email = ?
    LIMIT 1
  `;

  const [rows] = await pool.query(sql, [email]);
  const user = rows[0];

  if (!user) {
    throw { status: 400, message: "User not found" };
  }

  const normStatus = (user.status || '').toLowerCase().trim();
  if (normStatus === 'inactive') {
    if (user.trialStatus === 'Expired') {
      throw { status: 403, message: "Your trial has expired. Please purchase a subscription to continue." };
    }
    throw { status: 403, message: "Your account is inactive. Please contact support." };
  }

  /* ===============================
     2️⃣ PASSWORD CHECK
  =============================== */
  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    throw { status: 401, message: "Invalid password" };
  }

  /* ===============================
     3️⃣ STAFF CHECK (OPTIONAL)
  =============================== */
  const [staffRows] = await pool.query(
    `SELECT id FROM staff WHERE userId = ? LIMIT 1`,
    [user.id]
  );

  const staffId = staffRows.length ? staffRows[0].id : null;

  /* ===============================
     4️⃣ MEMBER CHECK (ONLY FOR ROLE = MEMBER)
  =============================== */
  let memberId = null;

  if (user.roleName && user.roleName.toUpperCase().includes('MEMBER')) { // MEMBER
    const [memberRows] = await pool.query(
      `SELECT id, status FROM member WHERE userId = ? LIMIT 1`,
      [user.id]
    );

    if (!memberRows.length) {
      throw {
        status: 403,
        message: "Member record not found",
      };
    }

    const member = memberRows[0];
    memberId = member.id;

    // ✅ Check if member has at least ONE active plan with valid dates
    const [activePlans] = await pool.query(
      `SELECT id, membershipTo 
       FROM member_plan_assignment 
       WHERE memberId = ? 
         AND status = 'Active' 
         AND membershipTo >= CURDATE()
       LIMIT 1`,
      [memberId]
    );

    // ❌ No active plan assignment found - check fallback in member table
    if (activePlans.length === 0) {
      const [memDirect] = await pool.query(
        `SELECT id FROM member WHERE id = ? AND (status = 'Active' OR status = 'ACTIVE' OR membershipTo >= CURDATE() OR membershipTo IS NULL) LIMIT 1`,
        [memberId]
      );

      if (memDirect.length === 0) {
        // Update member status to Inactive
        await pool.query(
          `UPDATE member SET status = 'Inactive' WHERE id = ?`,
          [member.id]
        );

        throw {
          status: 403,
          message: "Membership expired. Please renew your plan.",
        };
      }
    }

    // ✅ At least one active plan or direct active membership exists - member can login
  }

  /* ===============================
     5️⃣ JWT TOKEN
  =============================== */
  const token = jwt.sign(
    {
      id: user.id,          // userId (auth)
      role: user.roleName,  // "Superadmin", "Admin", etc.
      roleId: user.roleId,
      branchId: user.branchId,
      adminId: user.adminId,
      staffId: staffId,
      memberId: memberId,   // ✅ DOMAIN ID
    },
    ENV.jwtSecret,
    { expiresIn: "7d" }
  );

  /* ===============================
     6️⃣ FINAL RESPONSE
  =============================== */
  return {
    token,
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,

      roleId: user.roleId,
      roleName: user.roleName,

      branchId: user.branchId,
      branchName: user.branchName,

      adminId: user.adminId,
      staffId: staffId,
      memberId: memberId,   // ✅ NOW GUARANTEED

      razorpayKeyId: user.razorpayKeyId || null,

      profileImage: user.profileImage || null,
      isTrial: user.isTrial || 0,
      trialStatus: user.trialStatus || "None",
      licenseExpiryDate: user.licenseExpiryDate || null,
      permissions: (() => {
        if (!user.permissions) return [];
        try {
          let parsed = JSON.parse(user.permissions);
          if (typeof parsed === "string") {
            parsed = JSON.parse(parsed);
          }
          return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
          return [];
        }
      })(),
    },
  };
};



/**************************************
 * GET USER BY ID
 **************************************/
export const fetchUserById = async (id) => {
  const sql = `
    SELECT u.*, r.name AS roleName, b.name AS branchName
    FROM user u
    LEFT JOIN role r ON r.id = u.roleId
    LEFT JOIN branch b ON b.id = u.branchId
    WHERE u.id = ?
  `;
  const [rows] = await pool.query(sql, [id]);

  if (rows.length === 0) throw { status: 404, message: "User not found" };

  return rows[0];
};


/**************************************
 * UPDATE USER
 **************************************/
// export const modifyUser = async (id, data,files) => {
//     const [rows] = await pool.query("SELECT * FROM user WHERE id = ?", [id]); // <-- added
//   const existingUser = rows[0]; // <-- added
//   if (data.password) {
//     data.password = await bcrypt.hash(data.password, 10);
//   }
// let profileImageUrl = existingUser.profileImage; // Default to existing profile image

//   if (files?.profileImage) {
//     // If a new image is provided in the request files, upload it to Cloudinary
//     profileImageUrl = await uploadToCloudinary(files.profileImage, "users/profile");
//   }
//   const sql = `
//     UPDATE user SET 
//       fullName=?, email=?, phone=?, roleId=?, branchId=?, 
//       gymName=?, address=?, planName=?, price=?, duration=?, 
//       description=?, status=?, password=IFNULL(?, password), profileImage=?
//     WHERE id=?
//   `;

//   await pool.query(sql, [
//     data.fullName,
//     data.email,
//     data.phone,
//     existingUser.roleId,
//     data.branchId,
//     data.gymName,
//     data.address,
//     data.planName,
//     data.price,
//     data.duration,
//     data.description,
//     data.status,
//     data.password || null,
//     profileImageUrl,
//     id
//   ]);

//   return fetchUserById(id);
// };
export const modifyUser = async (id, data = {}, files) => { // Default to empty object if data is undefined
  const [rows] = await pool.query("SELECT * FROM user WHERE id = ?", [id]); // Get existing user
  const existingUser = rows[0]; // Store the existing user

  // Prepare the fields to be updated
  const updatedFields = [];
  
  // Initialize the updated data with existing data (so fields not passed remain unchanged)
  const updatedData = {
    fullName: existingUser.fullName,
    email: existingUser.email,
    phone: existingUser.phone,
    branchId: existingUser.branchId,
    gymName: existingUser.gymName,
    address: existingUser.address,
    planName: existingUser.planName,
    price: existingUser.price,
    duration: existingUser.duration,
    description: existingUser.description,
    status: existingUser.status,
    password: existingUser.password, // Retain current password if not provided
    profileImage: existingUser.profileImage,
    gstNumber: existingUser.gstNumber,
    tax: existingUser.tax,
    gymAddress: existingUser.gymAddress,
    razorpayKeyId: existingUser.razorpayKeyId,
    razorpayKeySecret: existingUser.razorpayKeySecret,
    whatsappAccessToken: existingUser.whatsappAccessToken,
    whatsappPhoneNumberId: existingUser.whatsappPhoneNumberId,
    smtpHost: existingUser.smtpHost,
    smtpPort: existingUser.smtpPort,
    smtpUser: existingUser.smtpUser,
    smtpPass: existingUser.smtpPass
  };

  // Update fields if provided in the data or files (check if data exists before updating)
  if (data?.fullName) {
    updatedData.fullName = data.fullName;
    updatedFields.push('fullName');
  }
  if (data?.email) {
    updatedData.email = data.email;
    updatedFields.push('email');
  }
  if (data?.phone) {
    updatedData.phone = data.phone;
    updatedFields.push('phone');
  }
  if (data?.branchId) {
    updatedData.branchId = data.branchId;
    updatedFields.push('branchId');
  }
  if (data?.gymName) {
    updatedData.gymName = data.gymName;
    updatedFields.push('gymName');
  }
  if (data?.address) {
    updatedData.address = data.address;
    updatedFields.push('address');
  }
  if (data?.planName) {
    updatedData.planName = data.planName;
    updatedFields.push('planName');
  }
  if (data?.price) {
    updatedData.price = data.price;
    updatedFields.push('price');
  }
  if (data?.duration) {
    updatedData.duration = data.duration;
    updatedFields.push('duration');
  }
  if (data?.description) {
    updatedData.description = data.description;
    updatedFields.push('description');
  }
  if (data?.status) {
    updatedData.status = data.status;
    updatedFields.push('status');
  }

  // Only hash password if it's provided
  if (data?.password) {
    updatedData.password = await bcrypt.hash(data.password, 10);
    updatedFields.push('password');
  }

  // Handle profile image update if a new image is provided
  if (files?.profileImage) {
    updatedData.profileImage = await uploadToCloudinary(files.profileImage, "users/profile");
    updatedFields.push('profileImage');
  }

  if (data?.gstNumber) {
  updatedData.gstNumber = data.gstNumber;
  updatedFields.push('gstNumber');
}

if (data?.tax !== undefined) {
  updatedData.tax = data.tax;
  updatedFields.push('tax');
}

if (data?.gymAddress) {
  updatedData.gymAddress = data.gymAddress;
  updatedFields.push('gymAddress');
}

// ✅ Razorpay Keys
if (data?.razorpayKeyId !== undefined) {
  updatedData.razorpayKeyId = data.razorpayKeyId;
  updatedFields.push('razorpayKeyId');
}

if (data?.razorpayKeySecret !== undefined) {
  updatedData.razorpayKeySecret = data.razorpayKeySecret;
  updatedFields.push('razorpayKeySecret');
}

// ✅ WhatsApp Settings
if (data?.whatsappAccessToken !== undefined) {
  updatedData.whatsappAccessToken = data.whatsappAccessToken;
  updatedFields.push('whatsappAccessToken');
}

if (data?.whatsappPhoneNumberId !== undefined) {
  updatedData.whatsappPhoneNumberId = data.whatsappPhoneNumberId;
  updatedFields.push('whatsappPhoneNumberId');
}

// ✅ SMTP Settings
if (data?.smtpHost !== undefined) {
  updatedData.smtpHost = data.smtpHost;
  updatedFields.push('smtpHost');
}

if (data?.smtpPort !== undefined) {
  updatedData.smtpPort = data.smtpPort;
  updatedFields.push('smtpPort');
}

if (data?.smtpUser !== undefined) {
  updatedData.smtpUser = data.smtpUser;
  updatedFields.push('smtpUser');
}

if (data?.smtpPass !== undefined) {
  updatedData.smtpPass = data.smtpPass;
  updatedFields.push('smtpPass');
}

// ✅ Subscription Plan (Basic / Growth / Premium)
if (data?.subscriptionPlan) {
  updatedData.subscriptionPlan = data.subscriptionPlan;
  updatedFields.push('subscriptionPlan');
}

// ✅ License Expiry Date
if (data?.licenseExpiryDate) {
  updatedData.licenseExpiryDate = data.licenseExpiryDate;
  updatedFields.push('licenseExpiryDate');
}

// Convert trial to paid subscription if applicable
if (data?.subscriptionPlan) {
  updatedData.trialStatus = 'Converted';
  updatedFields.push('trialStatus');
  updatedData.status = 'Active'; // Re-activate if it was inactive
  updatedFields.push('status');

  // We should also send "SUBSCRIPTION_ACTIVATED" mock message here
  const [[template]] = await pool.query("SELECT * FROM message_templates WHERE templateType = 'SUBSCRIPTION_ACTIVATED'");
  if (template) {
    const [[user]] = await pool.query("SELECT fullName, email, phone FROM user WHERE id = ?", [id]);
    if (user) {
      let msgBody = template.messageBody.replace('{Name}', user.fullName);
      // ✅ Send real Subscription Activated email + WhatsApp
      dispatchNotification({
        category: "saas_renewal_channel",
        toEmail: user.email,
        toPhone: user.phone || null,
        toUserId: id,
        subject: template.subject || "Subscription Activated — Speed Fitness",
        message: msgBody,
      }).catch(err => console.error("❌ Error sending subscription activation notification:", err.message));
    }
  }
}


  // Dynamically create the SQL query based on updated fields
  const setClause = updatedFields.map(field => `${field} = ?`).join(", ");

  // SQL query to update the user record with only the updated fields
  const sql = `UPDATE user SET ${setClause} WHERE id = ?`;

  // Collect the values for the query in the same order as the updated fields
  const queryValues = updatedFields.map(field => updatedData[field]);
  queryValues.push(id); // Add the user ID to the end of the query

  // Update the user record in the database
  await pool.query(sql, queryValues);

  // Fetch the updated user details and return
  return fetchUserById(id);
};

/**************************************
 * DELETE USER
 **************************************/
export const removeUser = async (id) => {
  const userId = Number(id);

  // ⭐ 1) Delete alerts where user is staff
  await pool.query("DELETE FROM alert WHERE staffId = ?", [userId]); // <-- added

  // ⭐ 2) Delete salary records where user is staff
  await pool.query("DELETE FROM salary WHERE staffId = ?", [userId]); // <-- added
await pool.query(
  `
  DELETE b
  FROM booking b
  INNER JOIN classschedule cs
    ON cs.id = b.scheduleId
  WHERE cs.trainerId = ?
  `,
  [userId]
);
  // ⭐ 3) Delete class schedules where user is trainer
  await pool.query("DELETE FROM classschedule WHERE trainerId = ?", [userId]); // <-- added

  // ⭐ 4) Delete sessions where user is trainer
  await pool.query("DELETE FROM session WHERE trainerId = ?", [userId]); // <-- added

  // ⭐ 5) Delete members where user is assigned
  await pool.query("DELETE FROM member WHERE userId = ?", [userId]); // <-- added

  // ⭐ 6) Set adminId = NULL in memberplan (not delete)
  await pool.query(
    "UPDATE memberplan SET adminId = NULL WHERE adminId = ?",
    [userId]
  ); // <-- added

  // ⭐ 7) Set adminId = NULL in branch (not delete)
  await pool.query(
    "UPDATE branch SET adminId = NULL WHERE adminId = ?",
    [userId]
  ); // <-- added

  // ⭐ 8) Finally delete user
  await pool.query("DELETE FROM user WHERE id = ?", [userId]); // <-- unchanged

  return true;
};



/**************************************
 * GET ADMINS ONLY
 **************************************/
export const fetchAdmins = async () => {
  const sql = `
    SELECT u.*, r.name AS roleName 
    FROM user u
    LEFT JOIN role r ON r.id = u.roleId
    WHERE u.roleId = 2
  `;

  const [rows] = await pool.query(sql);
  return rows;
};


/**************************************
 * DASHBOARD STATS
 **************************************/
export const fetchDashboardStats = async () => {
  const [[{ totalAdmins }]] = await pool.query(
    "SELECT COUNT(*) AS totalAdmins FROM user WHERE roleId = 2"
  );

  const [[{ totalBranches }]] = await pool.query(
    "SELECT COUNT(*) AS totalBranches FROM branch"
  );

  const [[{ newUsersToday }]] = await pool.query(
    "SELECT COUNT(*) AS newUsersToday FROM user WHERE DATE(createdAt) = CURDATE()"
  );

  return { totalAdmins, totalBranches, newUsersToday };
};


/**************************************
 * LOGIN MEMBER (NO BCRYPT)
 **************************************/
export const loginMemberService = async ({ email, password }) => {
  const sql = `
    SELECT m.*, b.name AS branchName
    FROM member m
    LEFT JOIN branch b ON b.id = m.branchId
    WHERE m.email = ?
  `;

  const [rows] = await pool.query(sql, [email]);
  const member = rows[0];

  if (!member) throw { status: 400, message: "Invalid email or password" };

  if (member.status !== "ACTIVE") {
    throw { status: 403, message: "Account disabled" };
  }

  if (member.password !== password) {
    throw { status: 400, message: "Invalid email or password" };
  }

  const token = jwt.sign(
    { id: member.id, role: "MEMBER" },
    ENV.jwtSecret,
    { expiresIn: "7d" }
  );

  return {
    token,
    member: {
      id: member.id,
      fullName: member.fullName,
      email: member.email,
      phone: member.phone,
      branchId: member.branchId,
      branchName: member.branchName,
    }
  };
};

/**************************************
 * CHANGE PASSWORD
 **************************************/
export const changeUserPassword = async (id, oldPassword, newPassword) => {
  // 1. Fetch user first
  const [rows] = await pool.query("SELECT * FROM user WHERE id = ?", [id]);
  const user = rows[0];

  if (!user) {
    throw { status: 404, message: "User not found" };
  }

  // 2. Compare old password
  let match = false;
  try {
    match = await bcrypt.compare(oldPassword, user.password);
  } catch (e) {}

  if (!match && user.password === oldPassword) match = true;
  if (!match && user.visiblePassword === oldPassword) match = true;

  if (!match) {
    throw { status: 400, message: "Old password is incorrect" };
  }

  // 3. Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 10);

  // 4. Update password
  await pool.query(
    "UPDATE user SET password = ?, visiblePassword = ? WHERE id = ?",
    [hashedPassword, newPassword, id]
  );

  return { message: "Password updated successfully" };
};


// export const getAdminDashboardData = async () => {
//   const sql = `
//     SELECT 
//       -- Total Branches
//       (SELECT COUNT(*) FROM branch WHERE status = 'Active') AS totalBranches,

//       -- Total Members (roleId = 4)
//       (SELECT COUNT(*) FROM user WHERE roleId = 4 AND status = 'Active') AS totalMembers,

//       -- Active Staff Count
//       (SELECT COUNT(*) FROM staff WHERE status = 'Active') AS totalStaff,

//       -- Today's Member Check-ins
//       (SELECT COUNT(*) FROM memberattendance 
//        WHERE DATE(checkIn) = CURDATE()) AS todaysMemberCheckins,

//       -- Today's Staff Check-ins
//       (SELECT COUNT(*) FROM staffattendance 
//        WHERE DATE(checkIn) = CURDATE()) AS todaysStaffCheckins
//   `;

//   const [rows] = await pool.query(sql);

//   if (!rows.length) {
//     throw { status: 404, message: "No dashboard data found" };
//   }

//   return rows[0];
// };





// export const getAdminDashboardData = async (adminId) => {
//   // 5 CARDS
//   const statsQuery = `
//     SELECT 
//       -- Branch count
//       (SELECT COUNT(*) FROM branch 
//         WHERE status = 'ACTIVE' AND adminId = ?) AS totalBranches,

//       -- Member count (roleId = 4)
//       (SELECT COUNT(*) FROM user 
//         WHERE roleId = 4 AND status = 'ACTIVE' AND adminId = ?) AS totalMembers,

//       -- Staff count
//       (SELECT COUNT(*) FROM staff 
//         WHERE status = 'Active' AND adminId = ?) AS totalStaff,

//       -- Today's Member Check-ins (JOIN member → user → adminId)
//       (SELECT COUNT(*) FROM memberattendance ma
//         JOIN user u ON ma.memberId = u.id
//         WHERE u.adminId = ?
//         AND DATE(ma.checkIn) = CURDATE()
//       ) AS todaysMemberCheckins,

//       -- Today's Staff Check-ins (JOIN staff → adminId)
//       (SELECT COUNT(*) FROM staffattendance sa
//         JOIN staff s ON sa.staffId = s.id
//         WHERE s.adminId = ?
//         AND DATE(sa.checkIn) = CURDATE()
//       ) AS todaysStaffCheckins
//   `;

//   // MEMBER GROWTH (Admin-wise last 6 months)
//   const memberGrowthQuery = `
//     SELECT 
//       DATE_FORMAT(MIN(createdAt), '%b') AS month,
//       COUNT(*) AS count
//     FROM user
//     WHERE roleId = 4
//       AND adminId = ?
//       AND createdAt >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
//     GROUP BY YEAR(createdAt), MONTH(createdAt)
//     ORDER BY YEAR(createdAt), MONTH(createdAt);
//   `;

//   // recent activity
// const recentActivitiesQuery = `
// (
//   SELECT 
//     CONCAT('New member registration: ', fullName) AS activity,
//     joinDate AS time,
//     'member' AS type
//   FROM member
//   WHERE adminId = ?
// )

// UNION ALL

// (
//   SELECT 
//     CONCAT('Payment received: ₹', amount) AS activity,
//     createdAt AS time,
//     'payment' AS type
//   FROM payment
//   WHERE adminId = ?
// )

// UNION ALL

// (
//   SELECT 
//     CONCAT('Class booking by Member ID ', memberId) AS activity,
//     createdAt AS time,
//     'class_booking' AS type
//   FROM booking_requests
//   WHERE adminId = ?
// )

// UNION ALL

// (
//   SELECT 
//     CONCAT('Staff check-in: Staff ID ', sa.staffId) AS activity,
//     sa.checkIn AS time,
//     'staff_checkin' AS type
//   FROM staffattendance sa
//   JOIN staff s ON sa.staffId = s.id
//   WHERE s.adminId = ?
// )

// ORDER BY time DESC
// LIMIT 5;
// `;
  

// const [recentActivities] = await pool.query(recentActivitiesQuery, [
//   adminId,
//   adminId,
//   adminId,
//   adminId
// ]);

//   const [stats] = await pool.query(statsQuery, [
//     adminId,
//     adminId,
//     adminId,
//     adminId,
//     adminId,
//   ]);

//   const [memberGrowth] = await pool.query(memberGrowthQuery, [adminId]);

//   return {
//     ...stats[0],
//     memberGrowth,
//      recentActivities
//   };
// };


export const getAdminDashboardData = async (adminId, branchId = null, monthStr = null, chartPeriod = 6) => {
  const bId = (branchId === "all" || branchId === "") ? null : branchId;

  // Ensure monthStr is valid (e.g. '2026-07'), default to current month
  let targetMonth = monthStr;
  if (!targetMonth) {
    const today = new Date();
    targetMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  }

  // Determine chart grouping logic
  const isOneMonth = chartPeriod === 1;
  const dateFormatMember = isOneMonth ? "DATE_FORMAT(createdAt, '%d %b')" : "DATE_FORMAT(MIN(createdAt), '%b')";
  const groupByMember = isOneMonth ? "DATE(createdAt)" : "YEAR(createdAt), MONTH(createdAt)";
  const orderByMember = isOneMonth ? "DATE(createdAt)" : "YEAR(createdAt), MONTH(createdAt)";
  
  const dateFormatRevenue = isOneMonth ? "DATE_FORMAT(p.paymentDate, '%d %b')" : "DATE_FORMAT(MIN(p.paymentDate), '%b')";
  const groupByRevenue = isOneMonth ? "DATE(p.paymentDate)" : "YEAR(p.paymentDate), MONTH(p.paymentDate)";
  const orderByRevenue = isOneMonth ? "DATE(p.paymentDate)" : "YEAR(p.paymentDate), MONTH(p.paymentDate)";

  const dateFormatExpense = isOneMonth ? "DATE_FORMAT(e.date, '%d %b')" : "DATE_FORMAT(MIN(e.date), '%b')";
  const groupByExpense = isOneMonth ? "DATE(e.date)" : "YEAR(e.date), MONTH(e.date)";
  const orderByExpense = isOneMonth ? "DATE(e.date)" : "YEAR(e.date), MONTH(e.date)";

  const dateFormatSalary = isOneMonth ? "DATE_FORMAT(s.periodEnd, '%d %b')" : "DATE_FORMAT(MIN(s.periodEnd), '%b')";
  const groupBySalary = isOneMonth ? "DATE(s.periodEnd)" : "YEAR(s.periodEnd), MONTH(s.periodEnd)";
  const orderBySalary = isOneMonth ? "DATE(s.periodEnd)" : "YEAR(s.periodEnd), MONTH(s.periodEnd)";

  // 5 CARDS
  const statsQuery = `
    SELECT 
      -- Member count (roleId = 4)
     (SELECT COUNT(*) 
 FROM member 
 WHERE adminId = ?
   ${bId ? "AND branchId = ?" : ""}
   AND membershipTo IS NOT NULL
   AND DATE(membershipFrom) <= ?
   AND DATEDIFF(membershipTo, ?) > 0
) AS totalMembers,


      -- Staff count
      (SELECT COUNT(*) FROM staff 
        WHERE status = 'Active' AND adminId = ?
        ${bId ? "AND branchId = ?" : ""}
        ) AS totalStaff,

      -- Today's Member Check-ins (JOIN member → user → adminId)
      (SELECT COUNT(*) FROM memberattendance ma
        JOIN member m ON ma.memberId = m.id
        WHERE m.adminId = ?
        ${bId ? "AND m.branchId = ?" : ""}
        AND DATE(CONVERT_TZ(ma.checkIn, '+00:00', '+05:30')) = ?
      ) AS todaysMemberCheckins,

      -- Today's Staff Check-ins (JOIN staff → adminId)
      (SELECT COUNT(*) 
        FROM memberattendance ma
        JOIN staff s ON ma.memberId = s.userId
        WHERE s.adminId = ?
        ${bId ? "AND s.branchId = ?" : ""}
        AND DATE(CONVERT_TZ(ma.checkIn, '+00:00', '+05:30')) = ?
      ) AS todaysStaffCheckins
  `;

  // MEMBER GROWTH (Admin-wise)
  const memberGrowthQuery = `
    SELECT 
      ${dateFormatMember} AS month,
      COUNT(*) AS count
    FROM user
    WHERE roleId = 4
      AND adminId = ?
      ${bId ? "AND branchId = ?" : ""}
      AND createdAt >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
    GROUP BY ${groupByMember}
    ORDER BY ${orderByMember};
  `;

  // recent activity
const recentActivitiesQuery = `
  (
    SELECT 
      CONCAT('New member registration: ', fullName) AS activity,
      joinDate AS time,
      'member' AS type
    FROM member
    WHERE adminId = ?
    ${bId ? "AND branchId = ?" : ""}
  )

  UNION ALL

  (
    SELECT 
      CONCAT('Class booking by Member ID ', memberId) AS activity,
      createdAt AS time,
      'class_booking' AS type
    FROM booking_requests
    WHERE adminId = ?
    -- booking_requests doesn't have branchId directly in schema usually, ignoring filter
  )

  UNION ALL

  (
    SELECT 
      CONCAT('Staff check-in: Staff ID ', sa.staffId) AS activity,
      sa.checkIn AS time,
      'staff_checkin' AS type
    FROM staffattendance sa
    JOIN staff s ON sa.staffId = s.id
    WHERE s.adminId = ?
    ${bId ? "AND s.branchId = ?" : ""}
  )

  ORDER BY time DESC
  LIMIT 5;
  `;

  // REVENUE GROWTH (Admin-wise)
  const revenueGrowthQuery = `
    SELECT 
      ${dateFormatRevenue} AS month,
      MIN(p.paymentDate) AS rawDate,
      SUM(p.amount) AS totalRevenue
    FROM payment p
    JOIN member m ON p.memberId = m.id
    WHERE m.adminId = ?
      ${bId ? "AND (m.branchId = ? OR m.branchId IS NULL)" : ""}
      AND p.paymentDate >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
    GROUP BY ${groupByRevenue}
    ORDER BY ${orderByRevenue};
  `;

  // EXPENSE GROWTH
  const expenseGrowthQuery = `
    SELECT 
      ${dateFormatExpense} AS month,
      MIN(e.date) AS rawDate,
      SUM(e.amount) AS totalExpense
    FROM expense e
    JOIN branch b ON e.branchId = b.id
    WHERE b.adminId = ?
      ${bId ? "AND (e.branchId = ? OR e.branchId IS NULL)" : ""}
      AND e.date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
    GROUP BY ${groupByExpense}
    ORDER BY ${orderByExpense};
  `;

  // SALARY GROWTH
  const salaryGrowthQuery = `
    SELECT 
      ${dateFormatSalary} AS month,
      MIN(s.periodEnd) AS rawDate,
      SUM(s.netPay) AS totalSalary
    FROM salary s
    JOIN staff st ON s.staffId = st.id
    WHERE st.adminId = ?
      ${bId ? "AND (st.branchId = ? OR st.branchId IS NULL)" : ""}
      AND s.periodEnd >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
    GROUP BY ${groupBySalary}
    ORDER BY ${orderBySalary};
  `;

  // RECENT PAYMENTS
  const recentPaymentsQuery = `
    SELECT 
      p.id,
      m.fullName as memberName,
      p.amount,
      p.paymentDate as date,
      p.invoiceNo
    FROM payment p
    JOIN member m ON p.memberId = m.id
    WHERE m.adminId = ?
      ${bId ? "AND (m.branchId = ? OR m.branchId IS NULL)" : ""}
    ORDER BY p.paymentDate DESC
    LIMIT 10;
  `;

  const today = new Date();
  const todayStr = today.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // 'YYYY-MM-DD'

  const statsParams = [];
  // 1. totalMembers
  statsParams.push(adminId); if (bId) statsParams.push(bId);
  statsParams.push(todayStr);
  statsParams.push(todayStr);
  // 2. totalStaff
  statsParams.push(adminId); if (bId) statsParams.push(bId);
  // 3. todaysMemberCheckins
  statsParams.push(adminId); if (bId) statsParams.push(bId);
  statsParams.push(todayStr);
  // 4. todaysStaffCheckins
  statsParams.push(adminId); if (bId) statsParams.push(bId);
  statsParams.push(todayStr);

  const [stats] = await pool.query(statsQuery, statsParams);

  const growthParams = [adminId];
  if (bId) growthParams.push(bId);
  growthParams.push(chartPeriod);
  const [memberGrowth] = await pool.query(memberGrowthQuery, growthParams);

  const recentParams = [];
  recentParams.push(adminId); if (bId) recentParams.push(bId);
  recentParams.push(adminId); // booking_requests
  recentParams.push(adminId); if (bId) recentParams.push(bId);

  const [recentActivities] = await pool.query(recentActivitiesQuery, recentParams);

  const revenueParams = [adminId];
  if (bId) revenueParams.push(bId);
  revenueParams.push(chartPeriod);
  const [revenueGrowth] = await pool.query(revenueGrowthQuery, revenueParams);
  const [expenseGrowth] = await pool.query(expenseGrowthQuery, revenueParams);
  const [salaryGrowth] = await pool.query(salaryGrowthQuery, revenueParams);

  // Calculate profitGrowth
  const profitMap = {};
  revenueGrowth.forEach(r => profitMap[r.month] = { month: r.month, rawDate: r.rawDate, revenue: Number(r.totalRevenue || 0), expense: 0 });
  
  expenseGrowth.forEach(e => {
    if (!profitMap[e.month]) profitMap[e.month] = { month: e.month, rawDate: e.rawDate, revenue: 0, expense: 0 };
    profitMap[e.month].expense += Number(e.totalExpense || 0);
  });
  
  salaryGrowth.forEach(s => {
    if (!profitMap[s.month]) profitMap[s.month] = { month: s.month, rawDate: s.rawDate, revenue: 0, expense: 0 };
    profitMap[s.month].expense += Number(s.totalSalary || 0);
  });

  const profitGrowth = Object.values(profitMap)
    .sort((a, b) => new Date(a.rawDate) - new Date(b.rawDate))
    .map(p => ({ month: p.month, totalProfit: p.revenue - p.expense }));

  const paymentParams = [adminId];
  if (bId) paymentParams.push(bId);
  const [recentPayments] = await pool.query(recentPaymentsQuery, paymentParams);

  // Financial KPIs based on monthStr
  const monthFilter = `${targetMonth}-01`;

  const [[monthRevRow]] = await pool.query(
    `SELECT COALESCE(SUM(p.amount), 0) AS total 
     FROM payment p
     JOIN member m ON p.memberId = m.id
     WHERE m.adminId = ?
       ${bId ? "AND (m.branchId = ? OR m.branchId IS NULL)" : ""}
       AND DATE_FORMAT(p.paymentDate, '%Y-%m') = ?`,
    bId ? [adminId, bId, targetMonth] : [adminId, targetMonth]
  ).catch(() => [[{ total: 0 }]]);

  const monthlyRevenue = Number(monthRevRow?.total || 0);

  const [[monthExpRow]] = await pool.query(
    `SELECT COALESCE(SUM(e.amount), 0) AS total 
     FROM expense e
     JOIN branch b ON e.branchId = b.id
     WHERE b.adminId = ?
       ${bId ? "AND (e.branchId = ? OR e.branchId IS NULL)" : ""}
       AND DATE_FORMAT(e.date, '%Y-%m') = ?`,
    bId ? [adminId, bId, targetMonth] : [adminId, targetMonth]
  ).catch((err) => { console.error(err); return [[{ total: 0 }]]; });

  const [[monthSalRow]] = await pool.query(
    `SELECT COALESCE(SUM(s.netPay), 0) AS total 
     FROM salary s
     JOIN staff st ON s.staffId = st.id
     WHERE st.adminId = ?
       ${bId ? "AND (st.branchId = ? OR st.branchId IS NULL)" : ""}
       AND DATE_FORMAT(s.periodEnd, '%Y-%m') = ?`,
    bId ? [adminId, bId, targetMonth] : [adminId, targetMonth]
  ).catch((err) => { console.error(err); return [[{ total: 0 }]]; });

  const monthlyExpenses = Number(monthExpRow?.total || 0) + Number(monthSalRow?.total || 0);
  const monthlyProfit = monthlyRevenue - monthlyExpenses;

  return {
    ...stats[0],
    memberGrowth,
    recentActivities,
    revenueGrowth,
    profitGrowth,
    recentPayments,
    monthlyRevenue,
    monthlyExpenses,
    monthlyProfit
  };
};


