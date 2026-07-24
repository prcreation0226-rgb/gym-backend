import * as appNotificationService from "./appNotification.service.js";

// Helper to get safe receiver ID and Role from JWT
const getIdentity = (req) => {
  const isSuperAdmin = req.user.roleId === 1;
  const tenantId = isSuperAdmin ? req.user.id : (req.user.adminId || req.user.id);
  
  // Use req.user.memberId if present, otherwise req.user.id
  let receiverId = req.user.memberId ? req.user.memberId : req.user.id;
  
  let receiverRole = req.user.role || (req.user.roleId === 1 ? 'Super Admin' : (req.user.roleId === 2 ? 'Admin' : (req.user.roleId === 4 ? 'Member' : 'Staff')));
  
  return { tenantId, receiverId, receiverRole };
};

export const getUserNotifications = async (req, res, next) => {
  try {
    const { tenantId, receiverId, receiverRole } = getIdentity(req);
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    
    const notifications = await appNotificationService.getUserNotifications(tenantId, receiverId, receiverRole, limit, offset);
    res.json({ success: true, notifications });
  } catch (err) {
    next(err);
  }
};

export const getUnreadCount = async (req, res, next) => {
  try {
    const { tenantId, receiverId, receiverRole } = getIdentity(req);
    const count = await appNotificationService.getUnreadCount(tenantId, receiverId, receiverRole);
    res.json({ success: true, count });
  } catch (err) {
    next(err);
  }
};

export const markAsRead = async (req, res, next) => {
  try {
    const { tenantId, receiverId } = getIdentity(req);
    const { id } = req.params;
    await appNotificationService.markAsRead(id, tenantId, receiverId);
    res.json({ success: true, message: "Marked as read" });
  } catch (err) {
    next(err);
  }
};

export const markAllAsRead = async (req, res, next) => {
  try {
    const { tenantId, receiverId, receiverRole } = getIdentity(req);
    await appNotificationService.markAllAsRead(tenantId, receiverId, receiverRole);
    res.json({ success: true, message: "All notifications marked as read" });
  } catch (err) {
    next(err);
  }
};

export const deleteNotification = async (req, res, next) => {
  try {
    const { tenantId, receiverId } = getIdentity(req);
    const { id } = req.params;
    await appNotificationService.deleteNotification(id, tenantId, receiverId);
    res.json({ success: true, message: "Notification deleted" });
  } catch (err) {
    next(err);
  }
};
