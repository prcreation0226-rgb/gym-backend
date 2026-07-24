import { pool } from "../../config/db.js";
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

// ==========================================
// PUBLIC ATTENDANCE HANDLERS (VIA QR URL)
// ==========================================

export const publicMemberCheckIn = async (req, res, next) => {
  try {
    const { phone, adminId, branchId } = req.body;
    if (!phone || !adminId) return res.status(400).json({ success: false, message: 'Phone and Admin ID required' });
    
    // Find member by phone and adminId
    const [[member]] = await pool.query('SELECT * FROM member WHERE phone = ? AND adminId = ?', [phone, adminId]);
    if (!member) return res.status(404).json({ success: false, message: 'Member not found with this phone number' });

    const r = await memberCheckInService(member.id, branchId || member.branchId);
    res.json({ success: true, attendance: r });
  } catch (err) {
    next(err);
  }
};

export const publicMemberCheckOut = async (req, res, next) => {
  try {
    const { phone, adminId } = req.body;
    if (!phone || !adminId) return res.status(400).json({ success: false, message: 'Phone and Admin ID required' });
    
    const [[member]] = await pool.query('SELECT * FROM member WHERE phone = ? AND adminId = ?', [phone, adminId]);
    if (!member) return res.status(404).json({ success: false, message: 'Member not found with this phone number' });

    const r = await memberCheckOutService(member.id);
    res.json({ success: true, attendance: r });
  } catch (err) {
    next(err);
  }
};

export const publicStaffCheckIn = async (req, res, next) => {
  try {
    const { phone, adminId, branchId } = req.body;
    if (!phone || !adminId) return res.status(400).json({ success: false, message: 'Phone and Admin ID required' });
    
    // Find staff by phone and adminId
    const [[staff]] = await pool.query('SELECT * FROM staff WHERE phone = ? AND adminId = ?', [phone, adminId]);
    if (!staff) return res.status(404).json({ success: false, message: 'Staff not found with this phone number' });

    const r = await staffCheckInService(staff.id, branchId || staff.branchId);
    res.json({ success: true, attendance: r });
  } catch (err) {
    next(err);
  }
};

export const publicStaffCheckOut = async (req, res, next) => {
  try {
    const { phone, adminId } = req.body;
    if (!phone || !adminId) return res.status(400).json({ success: false, message: 'Phone and Admin ID required' });
    
    const [[staff]] = await pool.query('SELECT * FROM staff WHERE phone = ? AND adminId = ?', [phone, adminId]);
    if (!staff) return res.status(404).json({ success: false, message: 'Staff not found with this phone number' });

    const r = await staffCheckOutService(staff.id);
    res.json({ success: true, attendance: r });
  } catch (err) {
    next(err);
  }
};
