import { pool } from "../config/db.js";
import { getIO, emitToUser } from "../config/socket.js";
import { formatISTDate } from "./dateHelper.js";
import { createAppNotification } from "../modules/appNotifications/appNotification.service.js";

export const sendAppNotification = async (to, message, options = {}) => {
  try {
    const {
      title = null,
      receiver_role = null,
      sender_id = null,
      sender_role = null,
      reference_type = null,
      reference_id = null
    } = options;

    if (to === "all") {
      // Just emit via socket for now if it's a global broadcast to all without persistence
      const io = getIO();
      if (io) {
        io.emit("new_notification", { type: "IN-APP", message, title, createdAt: new Date().toISOString() });
      }
      return;
    }

    // Lookup user to get tenantId and precise role
    const [[user]] = await pool.query("SELECT id, roleId, adminId FROM user WHERE id = ?", [to]);
    if (user) {
      let roleName = 'Member';
      if (user.roleId === 1) roleName = 'Super Admin';
      else if (user.roleId === 2) roleName = 'Admin';
      else if (user.roleId === 3) roleName = 'Trainer';
      else if (user.roleId === 4) roleName = 'Staff';

      const tenantId = user.roleId === 1 ? user.id : (user.adminId || user.id);

      await createAppNotification({
        tenantId,
        senderId: sender_id,
        receiverId: user.id,
        receiverRole: receiver_role || roleName,
        type: title || 'SYSTEM',
        title: title || 'Notification',
        message: message,
        referenceType: reference_type,
        referenceId: reference_id ? reference_id.toString() : null
      });
    }

  } catch (err) {
    console.error("Failed to send app notification:", err);
  }
};
