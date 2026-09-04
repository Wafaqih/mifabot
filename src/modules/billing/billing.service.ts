import { databasePool, withTransaction } from "../../core/database/pool.js";
import type { PoolClient } from "pg";
import {
  activateBillingDefinition,
  addBillingResponsible,
  closeActiveOverrides,
  countActiveBillingResponsibles,
  deactivateBillingDefinition as deactivateBillingDefinitionRecord,
  deactivateBillingResponsible,
  definitionCodeExists,
  findActiveUsersForDefinition,
  findArrears,
  findBillingDefinitionById,
  findBillingDefinitionByName,
  findCurrentBills,
  findRateForPeriod,
  insertBill,
  insertBillingDefinition,
  isActiveBillingResponsible,
  listActiveBillingDefinitions,
  listBillingDefinitionsWithCurrentRate,
  listActiveStudentsByIds,
  listActiveUsersByIds,
  listBillingResponsibles,
  listCurrentIssuedBillPeriods,
  listEffectiveRatesForUser,
  promoteUserToAdmin,
  upsertBaseRate,
  upsertStudentOverride,
} from "./billing.repository.js";
import type {
  AddBillingResponsibleInput,
  Bill,
  BillFilter,
  BillPeriod,
  BillingDefinition,
  BillingInterval,
  BillingRate,
  CreateBillInput,
  CreateBillingDefinitionInput,
  GenerateBillsInput,
  RemoveBillingResponsibleInput,
  SetBillingNominalInput,
} from "./billing.types.js";

export interface ArrearsSummary {
  billingDefinitionId: string;
  billingName: string;
  jumlahBill: number;
  totalSisa: number;
}

function validatePeriod(input: BillPeriod): void {
  parseDate(input.periodeMulai);
  parseDate(input.periodeSelesai);
  parseDate(input.jatuhTempo);
  if (input.periodeMulai > input.periodeSelesai) {
    throw new Error("Periode tagihan tidak valid.");
  }
  if (input.jatuhTempo < input.periodeMulai) {
    throw new Error("Jatuh tempo tidak boleh sebelum awal periode.");
  }
}

export function validateBillingNominal(nominal: number): void {
  if (!Number.isSafeInteger(nominal) || nominal <= 0) {
    throw new Error("Nominal tagihan harus berupa bilangan bulat positif.");
  }
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Tanggal harus menggunakan format YYYY-MM-DD.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Tanggal tidak valid.");
  }
  return parsed;
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Nominal baru never rewrites a bill already issued. For recurring schedules
 * it starts at the next complete period; CUSTOM uses the day after the change
 * because its future period is chosen manually by an operator.
 */
export function nextNominalEffectiveDate(
  interval: BillingInterval,
  asOf: string,
): string {
  const date = parseDate(asOf);
  if (interval === "CUSTOM") return toDateString(addDays(date, 1));

  if (interval === "WEEKLY") {
    const day = date.getUTCDay();
    const daysUntilNextMonday = day === 0 ? 1 : 8 - day;
    return toDateString(addDays(date, daysUntilNextMonday));
  }

  if (interval === "MONTHLY") {
    return `${date.getUTCFullYear() + (date.getUTCMonth() === 11 ? 1 : 0)}-${String((date.getUTCMonth() + 1) % 12 + 1).padStart(2, "0")}-01`;
  }

  return `${date.getUTCFullYear() + 1}-01-01`;
}

/**
 * The first nominal of a recurring definition applies to its whole current
 * period. Later nominal changes still use nextNominalEffectiveDate so they
 * cannot rewrite bills that have already been issued.
 */
export function initialBillingRateEffectiveDate(
  interval: BillingInterval,
  asOf: string,
): string {
  parseDate(asOf);
  return currentRecurringPeriodForDate(interval, asOf)?.periodeMulai ?? asOf;
}

function makeCodeBase(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 50) || "tagihan";
}

async function uniqueDefinitionCode(name: string): Promise<string> {
  const base = makeCodeBase(name);
  let candidate = base;
  let suffix = 2;
  while (await definitionCodeExists(databasePool, candidate)) {
    candidate = `${base.slice(0, Math.max(1, 50 - String(suffix).length - 1))}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export async function getCurrentBills(filter: BillFilter): Promise<Bill[]> {
  return findCurrentBills(databasePool, filter);
}

export async function getArrears(filter: BillFilter): Promise<Bill[]> {
  return findArrears(databasePool, filter);
}

export async function getArrearsSummary(
  filter: BillFilter,
): Promise<ArrearsSummary[]> {
  return summarizeArrears(await getArrears(filter));
}

export function summarizeArrears(bills: Bill[]): ArrearsSummary[] {
  const summary = new Map<string, ArrearsSummary>();
  for (const bill of bills) {
    const current = summary.get(bill.billingDefinitionId);
    if (current) {
      current.jumlahBill += 1;
      current.totalSisa += bill.sisa;
      continue;
    }
    summary.set(bill.billingDefinitionId, {
      billingDefinitionId: bill.billingDefinitionId,
      billingName: bill.billingName,
      jumlahBill: 1,
      totalSisa: bill.sisa,
    });
  }
  return [...summary.values()];
}

export async function findDefinitionByName(
  name: string,
): Promise<BillingDefinition | null> {
  return findBillingDefinitionByName(databasePool, name);
}

export async function listActiveDefinitions(): Promise<BillingDefinition[]> {
  return listActiveBillingDefinitions(databasePool);
}

/** Lists active and retired definitions for Super Admin administration. */
export async function listDefinitionsForAdmin(
  asOf = new Date().toISOString().slice(0, 10),
): Promise<Array<{ definition: BillingDefinition; nominal: number | null }>> {
  return listBillingDefinitionsWithCurrentRate(databasePool, asOf);
}

export async function getEffectiveRatesForUser(
  userId: string,
  asOf: string,
): Promise<Array<{ definition: BillingDefinition; nominal: number }>> {
  return listEffectiveRatesForUser(databasePool, userId, asOf);
}

export async function createBillingDefinition(
  input: CreateBillingDefinitionInput,
): Promise<BillingDefinition> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 100) {
    throw new Error("Nama tagihan harus terdiri dari 3 sampai 100 karakter.");
  }
  validateBillingNominal(input.nominal);
  const code = await uniqueDefinitionCode(name);
  const asOf = input.effectiveDate ?? new Date().toISOString().slice(0, 10);
  const rateEffectiveDate = initialBillingRateEffectiveDate(input.interval, asOf);

  return withTransaction(async (client) => {
    const existing = await findBillingDefinitionByName(client, name);
    if (existing) throw new Error("Nama tagihan sudah digunakan.");
    const definition = await insertBillingDefinition(client, {
      code,
      name,
      interval: input.interval,
      createdBy: input.createdBy ?? null,
    });
    await upsertBaseRate(client, {
      billingDefinitionId: definition.id,
      nominal: input.nominal,
      effectiveDate: rateEffectiveDate,
      createdBy: input.createdBy ?? null,
    });
    return definition;
  });
}

/**
 * A definition is retired instead of physically deleted because bills,
 * payments, rates, and responsible-party history all reference it.
 */
export async function deactivateDefinition(
  billingDefinitionId: string,
): Promise<boolean> {
  return withTransaction(async (client) => {
    const definition = await findBillingDefinitionById(client, billingDefinitionId);
    if (!definition) throw new Error("Definisi tagihan tidak ditemukan.");
    return deactivateBillingDefinitionRecord(client, billingDefinitionId);
  });
}

export async function createBill(input: CreateBillInput): Promise<Bill> {
  validatePeriod(input);
  return withTransaction(async (client) => {
    const definition = await findBillingDefinitionById(
      client,
      input.billingDefinitionId,
    );
    if (!definition?.isActive) throw new Error("Definisi tagihan tidak aktif atau tidak ditemukan.");
    const rate = await findRateForPeriod(
      client,
      input.billingDefinitionId,
      input.userId,
      input.periodeMulai,
    );
    if (!rate) throw new Error("Nominal aktif tidak ditemukan untuk periode tagihan.");
    return insertBill(client, input, definition, rate);
  });
}

export async function generateBillsForPeriod(
  input: GenerateBillsInput,
): Promise<Bill[]> {
  validatePeriod(input);
  return withTransaction((client) => generateBillsForPeriodInTransaction(client, input));
}

async function generateBillsForPeriodInTransaction(
  client: PoolClient,
  input: GenerateBillsInput,
): Promise<Bill[]> {
  const definition = await findBillingDefinitionById(
    client,
    input.billingDefinitionId,
  );
  if (!definition?.isActive) throw new Error("Definisi tagihan tidak aktif atau tidak ditemukan.");

  const userIds = await findActiveUsersForDefinition(client, input);
  const bills: Bill[] = [];
  for (const userId of userIds) {
    const rate = await findRateForPeriod(
      client,
      input.billingDefinitionId,
      userId,
      input.periodeMulai,
    );
    if (!rate) {
      throw new Error(
        `Nominal aktif untuk tagihan ${definition.name} tidak ditemukan.`,
      );
    }
    bills.push(
      await insertBill(
        client,
        {
          userId,
          billingDefinitionId: input.billingDefinitionId,
          periodeMulai: input.periodeMulai,
          periodeSelesai: input.periodeSelesai,
          jatuhTempo: input.jatuhTempo,
          dibuatOleh: input.dibuatOleh ?? null,
        },
        definition,
        rate,
      ),
    );
  }
  return bills;
}

/** Issue a CUSTOM definition for the exact period chosen by the operator. */
export async function generateCustomBillsForPeriod(
  input: GenerateBillsInput,
): Promise<Bill[]> {
  const definition = await findBillingDefinitionById(
    databasePool,
    input.billingDefinitionId,
  );
  if (!definition?.isActive) {
    throw new Error("Definisi tagihan tidak aktif atau tidak ditemukan.");
  }
  if (definition.interval !== "CUSTOM") {
    throw new Error("Penerbitan manual hanya dapat digunakan untuk tagihan custom.");
  }
  return generateBillsForPeriod(input);
}

export function scheduledPeriodForDate(
  interval: BillingInterval,
  asOf: string,
): { periodeMulai: string; periodeSelesai: string; jatuhTempo: string } | null {
  const date = parseDate(asOf);
  const dayOfWeek = date.getUTCDay();

  if (interval === "WEEKLY") {
    if (dayOfWeek !== 1) return null;
    const start = date;
    return {
      periodeMulai: toDateString(start),
      periodeSelesai: toDateString(addDays(start, 6)),
      jatuhTempo: toDateString(addDays(start, 4)),
    };
  }

  if (interval === "MONTHLY") {
    if (date.getUTCDate() !== 1) return null;
    const end = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    );
    return {
      periodeMulai: toDateString(date),
      periodeSelesai: toDateString(end),
      jatuhTempo: toDateString(addDays(date, 4)),
    };
  }

  if (interval === "YEARLY") {
    if (date.getUTCMonth() !== 0 || date.getUTCDate() !== 1) return null;
    return {
      periodeMulai: toDateString(date),
      periodeSelesai: `${date.getUTCFullYear()}-12-31`,
      jatuhTempo: toDateString(addDays(date, 4)),
    };
  }

  return null;
}

/**
 * Returns the currently-running recurring period.  Unlike the legacy
 * scheduler helper, this is available on every day of the period so a
 * restart after its first day can safely recreate any missing bills.
 */
export function currentRecurringPeriodForDate(
  interval: BillingInterval,
  asOf: string,
): { periodeMulai: string; periodeSelesai: string; jatuhTempo: string } | null {
  const date = parseDate(asOf);

  if (interval === "WEEKLY") {
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    const start = addDays(date, -daysSinceMonday);
    return {
      periodeMulai: toDateString(start),
      periodeSelesai: toDateString(addDays(start, 6)),
      jatuhTempo: toDateString(addDays(start, 4)),
    };
  }

  if (interval === "MONTHLY") {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
    return {
      periodeMulai: toDateString(start),
      periodeSelesai: toDateString(end),
      jatuhTempo: toDateString(addDays(start, 4)),
    };
  }

  if (interval === "YEARLY") {
    const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return {
      periodeMulai: toDateString(start),
      periodeSelesai: `${date.getUTCFullYear()}-12-31`,
      jatuhTempo: toDateString(addDays(start, 4)),
    };
  }

  return null;
}

/** Generate only recurring definitions whose period starts on the supplied day. */
export async function generateScheduledBillsForDate(
  asOf: string,
): Promise<Bill[]> {
  const definitions = await listActiveDefinitions();
  const results: Bill[] = [];
  for (const definition of definitions) {
    const period = scheduledPeriodForDate(definition.interval, asOf);
    if (!period) continue;
    const bills = await generateBillsForPeriod({
      billingDefinitionId: definition.id,
      ...period,
    });
    results.push(...bills);
  }
  return results;
}

/**
 * Backfills the current weekly/monthly/yearly period idempotently.  This
 * makes bill generation resilient when the bot is offline at the exact start
 * of a period (for example, the bot starts on the 2nd of a month).
 */
export async function ensureCurrentRecurringBillsForDate(
  asOf: string,
): Promise<Bill[]> {
  const definitions = await listActiveDefinitions();
  const results: Bill[] = [];
  for (const definition of definitions) {
    const period = currentRecurringPeriodForDate(definition.interval, asOf);
    if (!period) continue;
    const bills = await generateBillsForPeriod({
      billingDefinitionId: definition.id,
      ...period,
    });
    results.push(...bills);
  }
  return results;
}

/**
 * Issue every currently-active bill for one newly active student.  Recurring
 * definitions use their calendar period; CUSTOM definitions copy an existing
 * current period that an operator has already issued.
 */
export async function ensureCurrentBillsForUserInTransaction(
  client: PoolClient,
  input: { userId: string; asOf: string },
): Promise<Bill[]> {
  const definitions = await listActiveBillingDefinitions(client);
  const results: Bill[] = [];
  for (const definition of definitions) {
    const recurringPeriod = currentRecurringPeriodForDate(
      definition.interval,
      input.asOf,
    );
    const periods = recurringPeriod
      ? [recurringPeriod]
      : await listCurrentIssuedBillPeriods(client, definition.id, input.asOf);

    for (const period of periods) {
      validatePeriod(period);
      results.push(
        ...(await generateBillsForPeriodInTransaction(client, {
          billingDefinitionId: definition.id,
          userId: input.userId,
          ...period,
        })),
      );
    }
  }
  return results;
}

export async function ensureCurrentBillsForUser(input: {
  userId: string;
  asOf: string;
}): Promise<Bill[]> {
  return withTransaction((client) =>
    ensureCurrentBillsForUserInTransaction(client, input),
  );
}

export async function setBillingNominal(
  input: SetBillingNominalInput,
): Promise<string> {
  validateBillingNominal(input.nominal);
  const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);
  parseDate(asOf);
  return withTransaction(async (client) => {
    const definition = await findBillingDefinitionById(
      client,
      input.billingDefinitionId,
    );
    if (!definition?.isActive) throw new Error("Definisi tagihan tidak aktif atau tidak ditemukan.");
    const effectiveDate = nextNominalEffectiveDate(definition.interval, asOf);

    const userIds = [...new Set(input.userIds ?? [])];
    if (userIds.length === 0) {
      await upsertBaseRate(client, {
        billingDefinitionId: input.billingDefinitionId,
        nominal: input.nominal,
        effectiveDate,
        createdBy: input.createdBy ?? null,
      });
      // "Semua" means all students must use the new global nominal.
      await closeActiveOverrides(
        client,
        input.billingDefinitionId,
        effectiveDate,
      );
      return effectiveDate;
    }

    const activeStudents = await listActiveStudentsByIds(client, userIds);
    if (activeStudents.length !== userIds.length) {
      throw new Error("Semua penerima nominal khusus harus merupakan santri aktif.");
    }
    for (const userId of userIds) {
      await upsertStudentOverride(client, {
        billingDefinitionId: input.billingDefinitionId,
        userId,
        nominal: input.nominal,
        effectiveDate,
        createdBy: input.createdBy ?? null,
      });
    }
    return effectiveDate;
  });
}

export async function addDefinitionResponsible(
  input: AddBillingResponsibleInput,
): Promise<void> {
  return withTransaction(async (client) => {
    const definition = await findBillingDefinitionById(
      client,
      input.billingDefinitionId,
    );
    if (!definition) throw new Error("Definisi tagihan tidak ditemukan.");
    const activeUsers = await listActiveUsersByIds(client, [input.userId]);
    if (activeUsers.length !== 1) throw new Error("Penanggung jawab harus user aktif.");
    // Agreed product behaviour: a PJ is promoted to ADMIN by the command.
    await promoteUserToAdmin(client, input.userId);
    await addBillingResponsible(client, input.billingDefinitionId, input.userId);
    // A newly-created definition starts inactive. Its first PJ makes it
    // operational and immediately applies the current recurring period to
    // every active santri; bill inserts are idempotent.
    if (!definition.isActive) {
      await activateBillingDefinition(client, input.billingDefinitionId);
      const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);
      const period = currentRecurringPeriodForDate(definition.interval, asOf);
      if (period) {
        await generateBillsForPeriodInTransaction(client, {
          billingDefinitionId: definition.id,
          ...period,
        });
      }
    }
  });
}

export async function removeDefinitionResponsible(
  input: RemoveBillingResponsibleInput,
): Promise<void> {
  return withTransaction(async (client) => {
    const definition = await findBillingDefinitionById(
      client,
      input.billingDefinitionId,
    );
    if (!definition) throw new Error("Definisi tagihan tidak ditemukan.");
    const total = await countActiveBillingResponsibles(
      client,
      input.billingDefinitionId,
    );
    if (definition.isActive && total <= 1) {
      throw new Error("Tagihan aktif harus memiliki minimal satu penanggung jawab.");
    }
    const removed = await deactivateBillingResponsible(
      client,
      input.billingDefinitionId,
      input.userId,
    );
    if (!removed) throw new Error("User bukan penanggung jawab aktif tagihan ini.");
  });
}

export async function getDefinitionResponsibles(
  billingDefinitionId: string,
) {
  return listBillingResponsibles(databasePool, billingDefinitionId);
}

/** Used by command adapters to authorize PJ-scoped operations. */
export async function isDefinitionResponsible(input: {
  billingDefinitionId: string;
  userId: string;
}): Promise<boolean> {
  return isActiveBillingResponsible(
    databasePool,
    input.billingDefinitionId,
    input.userId,
  );
}

export type { BillingDefinition, BillingInterval, Bill, BillingRate };
