import { pool } from "../config/db.js";
import { getIO, emitToUser } from "../config/socket.js";
import { formatISTDate } from "./dateHelper.js";

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

    const [result] = await pool.query(
      `INSERT INTO notificationlog 
      (type, \`to\`, message, status, title, receiver_role, sender_id, sender_role, reference_type, reference_id, is_read) 
      VALUES ('IN-APP', ?, ?, 'UNREAD', ?, ?, ?, ?, ?, ?, FALSE)`,
      [
        to.toString(), 
        message, 
        title, 
        receiver_role, 
        sender_id, 
        sender_role, 
        reference_type, 
        reference_id
      ]
    );
    
    const io = getIO();
    if (io) {
      const createdAt = new Date().toISOString();
      const payload = {
        id: result.insertId,
        type: "IN-APP",
        to: to.toString(),
        message: message,
        title,
        receiver_role,
        sender_id,
        sender_role,
        reference_type,
        reference_id,
        is_read: 0,
        createdAt: createdAt,
        ...formatISTDate(createdAt)
      };
      
      if (to === "all") {
        io.emit("new_notification", payload);
      } else {
        emitToUser(to, "new_notification", payload);
      }
    }
  } catch (err) {
    console.error("Failed to send app notification:", err);
  }
};
