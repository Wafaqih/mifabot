import { logger } from "../core/logger/logger.js";
import {
  isWhatsAppConnected,
  sendWhatsAppGroupMessage,
  sendWhatsAppMessage,
} from "../integrations/whatsapp/baileys-bot.js";
import { dispatchAutomaticScheduleReminders } from "../modules/schedules/schedule.service.js";

/**
 * Schedule reminders use minute offsets instead of the billing job's daily
 * cadence.  The service's delivery keys make the 30-second poll safe across
 * retries and process restarts.
 */
export function startActivityScheduleReminderJob(): NodeJS.Timeout {
  let running = false;
  const tick = (): void => {
    if (running || !isWhatsAppConnected()) return;
    running = true;
    void dispatchAutomaticScheduleReminders({
      sendMessage: sendWhatsAppMessage,
      sendGroupMessage: sendWhatsAppGroupMessage,
    })
      .then((summary) => {
        if (summary.occurrenceCount > 0 || summary.failedCount > 0) {
          logger.info(summary, "Pemrosesan reminder jadwal selesai.");
        }
      })
      .catch((error: unknown) => {
        logger.error({ error }, "Pemrosesan reminder jadwal gagal.");
      })
      .finally(() => {
        running = false;
      });
  };

  tick();
  return setInterval(tick, 30_000);
}
