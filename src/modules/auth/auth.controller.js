import { uploadToCloudinary } from "../../config/cloudinary.js";
import { registerUser, loginUser , fetchUserById,
  modifyUser,
  removeUser, fetchAdmins, fetchDashboardStats, loginMemberService,changeUserPassword, getAdminDashboardData} from "./auth.service.js";



export const register = async (req, res, next) => {
  try {
    // ⚠️ Abhi ke liye adminId body se aa raha hai
    // Frontend se bhejna hoga:
    // { ..., adminId: 1 }

    // Agar baad me token lagaoge to aise kar sakte ho:
    // if (req.user) {
    //   req.body.adminId = req.user.id;   // jis admin ne create kiya
    // }
    
    let imageUrl = null;
    if (req.files?.profileImage) {
      imageUrl = await uploadToCloudinary(
        req.files.profileImage,
        "users/profile"
      );
    }

    const payload = { profileImage: imageUrl };
    console.log(payload)

    const user = await registerUser(req.body,payload)
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
};



export const getUserById = async (req, res, next) => {
  try {
    const data = await fetchUserById(Number(req.params.id));
    res.json({ success: true, user: data });
  } catch (err) {
    next(err);
  }
};


export const getAdmins = async (req, res, next) => {
  try {
    const data = await fetchAdmins(); // service se fetch

    res.json({
      success: true,
      admins: data
    });
  } catch (err) {
    next(err);
  }
};



export const updateUser = async (req, res, next) => {
  try {
    const data = await modifyUser(Number(req.params.id), req.body,req.files);
    res.json({ success: true, user: data });
  } catch (err) {
    next(err);
  }
};

export const deleteUser = async (req, res, next) => {
  try {
    const data = await removeUser(Number(req.params.id));
    res.json({ success: true, message: "User deleted" });
  } catch (err) {
    next(err);
  }
};

export const getDashboardStats = async (req, res, next) => {
  try {
    const data = await fetchDashboardStats(); // service se fetch

    res.json({
      success: true,
      dashboard: data
    });
  } catch (err) {
    next(err);
  }
};




// ✅ controller
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const { token, user } = await loginUser({ email, password });

    res.json({
      success: true,
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
        staffId: user.staffId,
        memberId: user.memberId,   // ✅ ADD THIS LINE

        razorpayKeyId: user.razorpayKeyId,

        profileImage: user.profileImage,
        permissions: user.permissions
      }
    });
  } catch (err) {
    next(err);
  }
};








export const loginMember = async (req, res, next) => {
  try {
    const data = await loginMemberService(req.body);
    res.json({
      success: true,
      token: data.token,
      member: {
        id: data.member.id,
        fullName: data.member.fullName,
        email: data.member.email,
        phone: data.member.phone,
        branchId: data.member.branchId,
        branchName: data.member.branch?.name || null,
      },
    });
  } catch (err) {
    next(err);
  }
};


export const changePasswordController = async (req, res, next) => {
  try {
    // const id = req.user.id; // from JWT middleware
    const { oldPassword, newPassword,id } = req.body;

    if (!oldPassword || !newPassword || !id) {
      return res.status(400).json({ success: false, message: "Old & new password required & id" });
    }

    const result = await changeUserPassword(id, oldPassword, newPassword);

    res.json({ success: true, ...result });

  } catch (err) {
    next(err);
  }
};


// export const getAdminDashboard = async (req, res, next) => {
//   try {
//     const data = await getAdminDashboardData();

//     res.json({
//       success: true,
//       message: "Dashboard data fetched successfully",
//       data,
//     });
//   } catch (err) {
//     next(err);
//   }
// };


export const getAdminDashboard = async (req, res, next) => {
  try {
    const adminId = req.params.id; // or req.user.adminId
    const branchId = req.query.branchId; // Get branchId from query parameters
    const month = req.query.month; // e.g., '2026-07'
    const chartPeriod = req.query.chartPeriod ? parseInt(req.query.chartPeriod) : 6;

    const data = await getAdminDashboardData(adminId, branchId, month, chartPeriod);

    res.json({
      success: true,
      message: "Dashboard data fetched successfully",
      data,
    });
  } catch (err) {
    next(err);
  }
};
