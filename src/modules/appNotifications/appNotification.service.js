import { pool } from "../../config/db.js";
import { emitToUser } from "../../config/socket.js";

/**
 * Creates a new application notification, saves it to the database, and emits it via Socket.io.
 */
export const createAppNotification = async ({
  tenantId,
  senderId = null,
  receiverId,
  receiverRole,
  type,
  title,
  message,
  referenceType = null,
  referenceId = null,
  actionUrl = null,
  metadata = null,
  priority = "NORMAL",
}) => {
  if (!tenantId || !receiverId || !receiverRole || !type || !title || !message) {
    throw new Error("Missing required fields for app notification");
  }

  const sql = `
    INSERT INTO app_notification (
      tenantId, senderId, receiverId, receiverRole, type, title, message,
      referenceType, referenceId, actionUrl, metadata, priority
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const metaStr = metadata ? JSON.stringify(metadata) : null;

  try {
    const [result] = await pool.query(sql, [
      tenantId, senderId, receiverId, receiverRole, type, title, message,
      referenceType, referenceId, actionUrl, metaStr, priority
    ]);

    const newNotification = {
      id: result.insertId,
      tenantId,
      senderId,
      receiverId,
      receiverRole,
      type,
      title,
      message,
      referenceType,
      referenceId,
      actionUrl,
      metadata,
      priority,
      isRead: false,
      readAt: null,
      createdAt: new Date().toISOString()
    };

    // Emit real-time notification
    // We emit to the receiverId string to match frontend join room logic
    emitToUser(receiverId.toString(), "new_notification", newNotification);

    return newNotification;
  } catch (error) {
    console.error("Failed to create app notification:", error);
    throw new Error("Could not create notification");
  }
};

/**
 * Fetch paginated user notifications, safely scoped by tenant and receiver ID/Role.
 */
export const getUserNotifications = async (tenantId, receiverId, receiverRole, limit = 20, offset = 0) => {
  const sql = `
    SELECT * FROM app_notification
    WHERE tenantId = ? AND receiverId = ? AND receiverRole = ?
    ORDER BY createdAt DESC
    LIMIT ? OFFSET ?
  `;
  const [rows] = await pool.query(sql, [tenantId, receiverId, receiverRole, parseInt(limit), parseInt(offset)]);
  return rows.map(r => ({
    ...r,
    metadata: r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : null
  }));
};

/**
 * Get unread count for a user.
 */
export const getUnreadCount = async (tenantId, receiverId, receiverRole) => {
  const sql = `
    SELECT COUNT(*) as count FROM app_notification
    WHERE tenantId = ? AND receiverId = ? AND receiverRole = ? AND isRead = FALSE
  `;
  const [rows] = await pool.query(sql, [tenantId, receiverId, receiverRole]);
  return rows[0].count;
};

/**
 * Mark a specific notification as read.
 */
export const markAsRead = async (id, tenantId, receiverId) => {
  const sql = `
    UPDATE app_notification 
    SET isRead = TRUE, readAt = NOW() 
    WHERE id = ? AND tenantId = ? AND receiverId = ?
  `;
  const [result] = await pool.query(sql, [id, tenantId, receiverId]);
  
  if (result.affectedRows > 0) {
    emitToUser(receiverId.toString(), "notification_read", { id: parseInt(id) });
  }
  return result.affectedRows > 0;
};

/**
 * Mark all notifications as read for a user.
 */
export const markAllAsRead = async (tenantId, receiverId, receiverRole) => {
  const sql = `
    UPDATE app_notification 
    SET isRead = TRUE, readAt = NOW() 
    WHERE tenantId = ? AND receiverId = ? AND receiverRole = ? AND isRead = FALSE
  `;
  const [result] = await pool.query(sql, [tenantId, receiverId, receiverRole]);
  
  if (result.affectedRows > 0) {
    emitToUser(receiverId.toString(), "all_notifications_read", {});
  }
  return result.affectedRows;
};

/**
 * Delete a notification.
 */
export const deleteNotification = async (id, tenantId, receiverId) => {
  const sql = `
    DELETE FROM app_notification 
    WHERE id = ? AND tenantId = ? AND receiverId = ?
  `;
  const [result] = await pool.query(sql, [id, tenantId, receiverId]);
  return result.affectedRows > 0;
};
