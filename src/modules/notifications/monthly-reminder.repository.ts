import { databasePool } from "../../core/database/pool.js";

export interface MonthlyReminderRecipient {
  userId: string;
  username: string;
  jenisKelamin: "L" | "P";
  nomorWhatsapp: string;
  billId: string;
  billingName: string;
  sisa: number;
}

interface MonthlyReminderRecipientRow {
  user_id: string;
  username: string;
  jenis_kelamin: "L" | "P";
  nomor_whatsapp: string;
  bill_id: string;
  billing_name: string;
  sisa: string;
}

export async function findMonthlyReminderRecipients(
  asOf: string,
): Promise<MonthlyReminderRecipient[]> {
  const result = await databasePool.query<MonthlyReminderRecipientRow>(
    `SELECT u.id AS user_id, u.username, u.jenis_kelamin, u.nomor_whatsapp,
            b.id AS bill_id,
            COALESCE(b.nama_tagihan_snapshot, d.nama) AS billing_name,
            b.nominal - COALESCE(SUM(pa.nominal_alokasi), 0) AS sisa
    FROM mifabot.users u
    JOIN mifabot.roles role ON role.id = u.role_id
    JOIN mifabot.bills b ON b.user_id = u.id
    JOIN mifabot.billing_definitions d ON d.id = b.billing_definition_id
    LEFT JOIN mifabot.payment_allocations pa ON pa.bill_id = b.id
     WHERE u.status = 'AKTIF'
       AND role.kode = 'USER'
       AND d.interval = 'MONTHLY'::mifabot.billing_interval
       AND b.periode_mulai <= $1::date
       AND b.periode_selesai >= $1::date
     GROUP BY u.id, u.username, u.jenis_kelamin, u.nomor_whatsapp, b.id
     HAVING b.nominal - COALESCE(SUM(pa.nominal_alokasi), 0) > 0
     ORDER BY u.username`,
    [asOf],
  );

  return result.rows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    jenisKelamin: row.jenis_kelamin,
    nomorWhatsapp: row.nomor_whatsapp,
    billId: row.bill_id,
    billingName: row.billing_name,
    sisa: Number(row.sisa),
  }));
}

export async function claimMonthlyReminder(
  recipient: MonthlyReminderRecipient,
  notificationType: string,
  messageBody: string,
): Promise<string | null> {
  const result = await databasePool.query<{ id: string }>(
    `INSERT INTO mifabot.notifications (
       user_id, notification_type, message_body, related_bill_id
     ) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, notification_type, related_bill_id)
     DO UPDATE SET
       status = 'PENDING',
       failure_reason = NULL,
       message_body = EXCLUDED.message_body,
       updated_at = now()
     WHERE notifications.status = 'FAILED'
     RETURNING id`,
    [recipient.userId, notificationType, messageBody, recipient.billId],
  );

  return result.rows[0]?.id ?? null;
}

export async function markMonthlyReminderSent(
  notificationId: string,
): Promise<void> {
  await databasePool.query(
    `UPDATE mifabot.notifications
     SET status = 'SENT', sent_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'PENDING'`,
    [notificationId],
  );
}

export async function markMonthlyReminderFailed(
  notificationId: string,
  reason: string,
): Promise<void> {
  await databasePool.query(
    `UPDATE mifabot.notifications
     SET status = 'FAILED', failure_reason = $2, updated_at = now()
     WHERE id = $1 AND status = 'PENDING'`,
    [notificationId, reason],
  );
}
