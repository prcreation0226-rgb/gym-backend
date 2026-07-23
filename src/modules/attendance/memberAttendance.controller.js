import {
  memberCheckInService,
  memberCheckOutService,
  memberAttendanceListService,
  staffCheckInService,
  staffCheckOutService,
  staffAttendanceListService,
} from "./memberAttendace.service.js";

// export const memberCheckIn = async (req, res, next) => {
//   try {
//     const { memberId, branchId } = req.body;
//     const r = await memberCheckInService(memberId, branchId);
//     res.json({ success: true, attendance: r });
//   } catch (err) {
//     next(err);
//   }
// };

export const memberCheckIn = async (req, res, next) => {
  try {
    const memberId = req.user?.memberId || req.body.memberId;
    const branchId = req.user?.branchId || req.body.branchId;

    const r = await memberCheckInService(memberId, branchId);

    res.json({ success: true, attendance: r });
  } catch (err) {
    next(err);
  }
};

// export const memberCheckOut = async (req, res, next) => {
//   try {
//     const { memberId } = req.body;
//     const r = await memberCheckOutService(memberId);
//     res.json({ success: true, attendance: r });
//   } catch (err) {
//     next(err);
//   }
// };

export const memberCheckOut = async (req, res, next) => {
  try {
    const memberId = req.user?.memberId || req.body.memberId;
    const r = await memberCheckOutService(memberId);
    res.json({ success: true, attendance: r });
  } catch (err) {
    next(err);
  }
};

export const memberAttendanceList = async (req, res, next) => {
  try {
    const memberId = parseInt(req.params.memberId);
    const list = await memberAttendanceListService(memberId);
    res.json({ success: true, list });
  } catch (err) {
    next(err);
  }
};

// STAFF FUNCTIONS
export const staffCheckIn = async (req, res, next) => {
  try {
    const { staffId, branchId } = req.body;
    const r = await staffCheckInService(staffId, branchId);
    res.json({ success: true, attendance: r });
  } catch (err) {
    next(err);
  }
};

export const staffCheckOut = async (req, res, next) => {
  try {
    const { staffId } = req.body;
    const r = await staffCheckOutService(staffId);
    res.json({ success: true, attendance: r });
  } catch (err) {
    next(err);
  }
};

export const staffAttendanceList = async (req, res, next) => {
  try {
    const staffId = parseInt(req.params.staffId);
    const list = await staffAttendanceListService(staffId);
    res.json({ success: true, list });
  } catch (err) {
    next(err);
  }
};
