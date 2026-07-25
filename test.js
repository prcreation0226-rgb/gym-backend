import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const p = mysql.createPool(process.env.DATABASE_URL);
  const [r] = await p.query('SELECT id, fullName, trainerId, trainerType FROM member ORDER BY id DESC LIMIT 5');
  console.log(r);
  process.exit(0);
}
run();
