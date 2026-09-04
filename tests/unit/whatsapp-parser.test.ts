import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  isCancelCommand,
  isEditProfileCommand,
  isHelpCommand,
  isListStudentsCommand,
  isSelfRegistrationCommand,
  normalizeSelfCommand,
  parseBillingPaymentCommand,
  parseBillingResponsibleCommand,
  parseConfigureManualReminderGroupCommand,
  parseCreateBillingDefinitionCommand,
  parseDeleteBillingDefinitionCommand,
  parseIssueCustomBillingCommand,
  parseManualGroupBillingReminderCommand,
  parseManualBillingReminderCommand,
  parsePaymentChannelCommand,
  parseSelfProfileFieldChoice,
  parseSetBillingReminderCommand,
  parseSetBillingNominalCommand,
  isListBillingDefinitionsCommand,
} from '../../src/integrations/whatsapp/message.ts';

describe('WhatsApp parser helpers', () => {
  it('normalizes self commands with prefixes and aliases', () => {
    assert.equal(normalizeSelfCommand('!PING'), 'ping');
    assert.equal(normalizeSelfCommand('/help'), 'help');
    assert.equal(normalizeSelfCommand('BOT cek profil'), 'cek profil');
    assert.equal(normalizeSelfCommand('MIFABOT: data santri'), 'data santri');
    assert.equal(normalizeSelfCommand('mifabot add pj SPP @john'), 'add pj spp @john');
    assert.equal(normalizeSelfCommand('bot'), 'bot');
  });

  it('recognizes every help command alias', () => {
    for (const command of ['help', 'bot', 'panduan', 'info', '!INFO']) {
      assert.equal(isHelpCommand(command), true);
    }

    assert.equal(isHelpCommand('cek profil'), false);
  });

  it("recognizes the student list command and its aliases", () => {
    assert.equal(isListStudentsCommand("list santri"), true);
    assert.equal(isListStudentsCommand("/daftar santri"), true);
    assert.equal(isListStudentsCommand("MIFABOT: lihat santri"), true);
    assert.equal(isListStudentsCommand("data santri"), false);
    assert.equal(isListStudentsCommand("list admin"), false);
  });

  it("keeps the self-registration command distinct from the student list", () => {
    assert.equal(isSelfRegistrationCommand("Daftar"), true);
    assert.equal(isSelfRegistrationCommand("!DAFTAR"), true);
    assert.equal(isSelfRegistrationCommand("MIFABOT: daftar"), true);
    assert.equal(isSelfRegistrationCommand("Daftar santri"), false);
    assert.equal(isSelfRegistrationCommand("pendaftaran"), false);
  });

  it("parses self-profile edit entry, cancellation, and field selection", () => {
    assert.equal(isEditProfileCommand("Edit profile"), true);
    assert.equal(isEditProfileCommand("/edit profil"), true);
    assert.equal(isEditProfileCommand("Edit profil saya"), false);
    assert.equal(isCancelCommand("MIFABOT: Batal"), true);
    assert.equal(isCancelCommand("batalkan"), false);

    assert.equal(parseSelfProfileFieldChoice("1"), "fullName");
    assert.equal(parseSelfProfileFieldChoice("Nama lengkap"), "fullName");
    assert.equal(parseSelfProfileFieldChoice("2"), "username");
    assert.equal(parseSelfProfileFieldChoice("3"), "phoneNumber");
    assert.equal(parseSelfProfileFieldChoice("Nomor WA"), "phoneNumber");
    assert.equal(parseSelfProfileFieldChoice("4"), "gender");
    assert.equal(parseSelfProfileFieldChoice("alamat"), null);
  });

  it("parses dynamic billing-definition commands with multi-word names", () => {
    assert.deepEqual(
      parseCreateBillingDefinitionCommand(
        'Buat tagihan "Iuran Makan" Rp25.000 mingguan',
      ),
      {
        name: 'Iuran Makan',
        nominal: 25000,
        interval: 'WEEKLY',
      },
    );

    assert.deepEqual(
      parseCreateBillingDefinitionCommand('!buat tagihan SPP 100000 bulanan'),
      {
        name: 'SPP',
        nominal: 100000,
        interval: 'MONTHLY',
      },
    );
  });

  it("recognizes billing-definition administration commands", () => {
    assert.equal(isListBillingDefinitionsCommand("Daftar Tagihan"), true);
    assert.equal(isListBillingDefinitionsCommand("!daftar tagihan"), true);
    assert.equal(isListBillingDefinitionsCommand("Daftar"), false);

    assert.deepEqual(
      parseDeleteBillingDefinitionCommand('Hapus tagihan "Iuran Makan"'),
      { billingName: "Iuran Makan" },
    );
    assert.deepEqual(parseDeleteBillingDefinitionCommand("!hapus tagihan SPP"), {
      billingName: "SPP",
    });
    assert.equal(parseDeleteBillingDefinitionCommand("Hapus tagihan"), null);
  });

  it("parses add and delete PJ commands", () => {
    assert.deepEqual(
      parseBillingResponsibleCommand('Add PJ "Iuran Makan" @bendahara'),
      {
        action: 'ADD',
        billingName: 'Iuran Makan',
        identifier: '@bendahara',
      },
    );
    assert.deepEqual(
      parseBillingResponsibleCommand('del pj SPP 628123456789'),
      {
        action: 'DELETE',
        billingName: 'SPP',
        identifier: '628123456789',
      },
    );
  });

  it("parses payment-channel commands and their displayed positions", () => {
    assert.deepEqual(
      parsePaymentChannelCommand('Tambah metode "Iuran Makan" @bendahara'),
      {
        action: "ADD",
        billingName: "Iuran Makan",
        ownerIdentifier: "@bendahara",
      },
    );
    assert.deepEqual(parsePaymentChannelCommand("Lihat metode SPP"), {
      action: "LIST",
      billingName: "SPP",
    });
    assert.deepEqual(parsePaymentChannelCommand("Ubah metode SPP 2"), {
      action: "EDIT",
      billingName: "SPP",
      position: 2,
    });
    assert.deepEqual(parsePaymentChannelCommand("Nonaktifkan metode SPP 3"), {
      action: "DEACTIVATE",
      billingName: "SPP",
      position: 3,
    });
    assert.equal(parsePaymentChannelCommand("Ubah metode SPP 0"), null);
  });

  it("parses per-student and all-student nominal commands", () => {
    assert.deepEqual(
      parseSetBillingNominalCommand(
        'MIFABOT: Set nominal "Iuran Makan" Rp30.000\nahmad\n628123456789',
      ),
      {
        billingName: 'Iuran Makan',
        nominal: 30000,
        targets: ['ahmad', '628123456789'],
        allStudents: false,
      },
    );
    assert.deepEqual(
      parseSetBillingNominalCommand('Set nominal SPP 100000\nSemua'),
      {
        billingName: 'SPP',
        nominal: 100000,
        targets: ['Semua'],
        allStudents: true,
      },
    );
  });

  it("parses manual custom billing periods", () => {
    assert.deepEqual(
      parseIssueCustomBillingCommand(
        'Terbitkan tagihan "Iuran Kegiatan" 2026-09-10 2026-09-16 2026-09-14',
      ),
      {
        billingName: 'Iuran Kegiatan',
        periodeMulai: '2026-09-10',
        periodeSelesai: '2026-09-16',
        jatuhTempo: '2026-09-14',
      },
    );
  });

  it("parses generic payments and retains an omitted nominal for guidance", () => {
    assert.deepEqual(
      parseBillingPaymentCommand('Bayar "Iuran Makan" Rp25.000'),
      { billingName: 'Iuran Makan', nominal: 25000, isFullPayment: false },
    );
    assert.deepEqual(parseBillingPaymentCommand('Bayar SPP'), {
      billingName: 'SPP',
      nominal: null,
      isFullPayment: false,
    });
  });

  it("parses automatic reminder offsets relative to the due date", () => {
    assert.deepEqual(
      parseSetBillingReminderCommand(
        'MIFABOT: Set reminder "Iuran Makan" H-7 H-3 H-0 H+3',
      ),
      {
        billingName: 'Iuran Makan',
        offsets: [-7, -3, 0, 3],
        disabled: false,
      },
    );
    assert.deepEqual(parseSetBillingReminderCommand('!Set reminder SPP off'), {
      billingName: 'SPP',
      offsets: [],
      disabled: true,
    });
    assert.equal(parseSetBillingReminderCommand('Set reminder SPP H-3 besok'), null);
  });

  it("parses manual reminders and preserves a missing name for guidance", () => {
    assert.deepEqual(parseManualBillingReminderCommand('Reminder "Iuran Makan"'), {
      billingName: 'Iuran Makan',
    });
    assert.deepEqual(parseManualBillingReminderCommand('Bot reminder'), {
      billingName: null,
    });
    assert.equal(parseManualBillingReminderCommand('Reminder grup Syahriah'), null);
    assert.deepEqual(parseManualGroupBillingReminderCommand('Reminder grup Syahriah'), {
      billingName: 'Syahriah',
    });
    assert.deepEqual(parseManualGroupBillingReminderCommand('Reminder grup'), {
      billingName: null,
    });
    assert.deepEqual(
      parseConfigureManualReminderGroupCommand(
        'Hubungkan grup reminder 120363000000000000@g.us',
      ),
      { groupJid: '120363000000000000@g.us' },
    );
    assert.equal(parseManualBillingReminderCommand('ingatkan SPP'), null);
  });
});
