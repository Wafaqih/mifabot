export type ScheduleType = "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM";
export type ScheduleStatus = "ACTIVE" | "PAUSED" | "ARCHIVED";
export type CustomScheduleMode = "INTERVAL" | "DATES";
export type CustomIntervalUnit = "DAYS" | "WEEKS" | "MONTHS";
export type ReminderTarget = "GROUP" | "USER";

export interface ScheduleMember {
  userId: string;
  username: string;
  phoneNumber: string;
  weekday: number | null;
}

export interface ActivitySchedule {
  id: string;
  name: string;
  type: ScheduleType;
  status: ScheduleStatus;
  timezone: string;
  startDate: string;
  startTime: string;
  intervalValue: number;
  weeklyDays: number[];
  monthlyDays: number[];
  customMode: CustomScheduleMode | null;
  customUnit: CustomIntervalUnit | null;
  groupJid: string | null;
  reminderOffsetsMinutes: number[];
  members: ScheduleMember[];
  customDates: Array<{ date: string; time: string }>;
}

export interface CreateActivityScheduleInput {
  name: string;
  type: ScheduleType;
  startDate: string;
  startTime: string;
  intervalValue?: number;
  weeklyDays?: number[];
  monthlyDays?: number[];
  customMode?: CustomScheduleMode | null;
  customUnit?: CustomIntervalUnit | null;
  customDates?: Array<{ date: string; time: string }>;
  groupJid?: string | null;
  reminderOffsetsMinutes?: number[];
  members: Array<{ userId: string; weekday?: number | null }>;
  createdBy?: string | null;
}

export interface ScheduleOccurrence {
  schedule: ActivitySchedule;
  date: string;
  time: string;
  members: ScheduleMember[];
}

export interface ReminderDispatchSummary {
  occurrenceCount: number;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
}

