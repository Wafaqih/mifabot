import { env } from "../config/env.js";
import { logger } from "../core/logger/logger.js";
import { ensureCurrentRecurringBillsForDate } from "../modules/billing/billing.service.js";

interface LocalTime {
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

function getLocalTime(date: Date): LocalTime {
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
 * Creates current recurring bills independently from reminders. It runs once
 * on startup to backfill a missed period and every day shortly after midnight.
 */
export function startBillingGenerationJob(): NodeJS.Timeout {
  let generatedForDate: string | undefined;
  let runningDate: string | undefined;

  const generate = async (date: string): Promise<void> => {
    if (generatedForDate === date || runningDate === date) return;
    runningDate = date;
    try {
      const bills = await ensureCurrentRecurringBillsForDate(date);
      generatedForDate = date;
      logger.info(
        { date, generatedBillCount: bills.length },
        "Pemrosesan tagihan berkala selesai.",
      );
    } catch (error) {
      logger.error(
        { error, date },
        "Pemrosesan tagihan berkala gagal.",
      );
    } finally {
      runningDate = undefined;
    }
  };

  const current = getLocalTime(new Date());
  void generate(toDateString(current.year, current.month, current.day));

  const tick = (): void => {
    const time = getLocalTime(new Date());
    if (time.hour !== 0 || time.minute > 4) return;
    void generate(toDateString(time.year, time.month, time.day));
  };

  tick();
  return setInterval(tick, 30_000);
}
