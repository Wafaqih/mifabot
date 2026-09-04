import { env } from "../config/env.js";
import { logger } from "../core/logger/logger.js";
import {
  isWhatsAppConnected,
  sendWhatsAppMessage,
} from "../integrations/whatsapp/baileys-bot.js";
import { dispatchAutomaticBillingReminders } from "../modules/notifications/reminder.service.js";

interface JakartaTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: env.timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function getLocalTime(date: Date): JakartaTime {
  const parts = Object.fromEntries(
    timeFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function toDateString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Runs once per local day after the recurring bills have been issued.  The
 * service evaluates each active rule as `jatuh_tempo + offset_days = today`;
 * it therefore supports every interval, not only monthly bills.
 */
export function startBillingReminderJob(): NodeJS.Timeout {
  let lastReminderRunKey: string | undefined;
  let runningKey: string | undefined;

  const tick = (): void => {
    const time = getLocalTime(new Date());
    if (time.hour !== 5 || time.minute > 4) {
      return;
    }

    const runKey = toDateString(time.year, time.month, time.day);
    if (runKey === lastReminderRunKey || runKey === runningKey) {
      return;
    }

    runningKey = runKey;
    void (async () => {
      if (!isWhatsAppConnected()) {
        logger.warn(
          { date: runKey },
          "Reminder tagihan menunggu koneksi WhatsApp.",
        );
        return;
      }

      const summary = await dispatchAutomaticBillingReminders({
        asOf: runKey,
        sendMessage: sendWhatsAppMessage,
      });
      // A FAILED row is safely re-claimed (the delivery table deduplicates by
      // rule and bill), so keep trying during this scheduler window instead
      // of silently dropping a transient WhatsApp/database failure.
      if (summary.failedCount === 0) {
        lastReminderRunKey = runKey;
      }
      logger.info(
        {
          date: runKey,
          recipientCount: summary.recipientCount,
          sentCount: summary.sentCount,
          failedCount: summary.failedCount,
          retryPending: summary.failedCount > 0,
        },
        "Pemrosesan tagihan dan reminder otomatis selesai.",
      );
    })()
      .catch((error: unknown) => {
        logger.error(
          { error, date: runKey },
          "Pemrosesan tagihan dan reminder otomatis gagal.",
        );
      })
      .finally(() => {
        runningKey = undefined;
      });
  };

  tick();
  return setInterval(tick, 30_000);
}
