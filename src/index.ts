import { env } from "./config/env.js";
import { logger } from "./core/logger/logger.js";
import { startWhatsAppBot } from "./integrations/whatsapp/baileys-bot.js";
import { startActivityScheduleReminderJob } from "./jobs/activity-schedule-reminder.job.js";
import { startBillingGenerationJob } from "./jobs/billing-generation.job.js";
import { startBillingReminderJob } from "./jobs/billing-reminder.job.js";

logger.info(
  { environment: env.nodeEnv, timezone: env.timezone },
  "Menyalakan MIFABOT.",
);

startWhatsAppBot().catch((error: unknown) => {
  logger.fatal({ error }, "MIFABOT gagal dinyalakan.");
  process.exitCode = 1;
});

startBillingGenerationJob();
startBillingReminderJob();
startActivityScheduleReminderJob();
