# Skema Database MIFABOT

**Database:** PostgreSQL 14+  
**Schema aplikasi:** `mifabot`  
**Status:** Sesuai migration 001–007; migration harus dijalankan pada deployment agar model dinamis aktif  
**Terakhir diperbarui:** 31 Agustus 2026

Seluruh nominal Rupiah disimpan sebagai `bigint` tanpa pecahan. Primary key memakai UUID dengan default `gen_random_uuid()`.

## Migration yang berlaku

Runner membaca `database/migrations` secara leksikografis, menerapkan file yang belum ada dalam `public.schema_migrations`, lalu mencatat nama file tersebut.

| File | Perubahan utama |
| --- | --- |
| `001_initial_schema.sql` | Schema inti legacy: user, role, tarif per-user, bill, payment, alokasi, notifikasi, audit, enum, indeks, dan trigger. |
| `002_receiver_based_payment_confirmation.sql` | Payment channel, pilihan tunggakan, bukti opsional untuk cash, serta validasi routing payment user. |
| `003_monthly_reminder_deduplication.sql` | Constraint unik reminder per user, tipe notifikasi, dan bill. |
| `003_payment_submission_model.sql` | `submission_type` payment dan `unit_kode` penugasan admin. |
| `004_fix_admin_assignment_trigger_schema.sql` | Validasi role pada penugasan admin. |
| `005_dynamic_billing_definitions.sql` | Definisi tagihan dinamis, riwayat nominal global/override, banyak PJ, bridge data legacy, dan routing payment berbasis PJ. |
| `006_harden_dynamic_billing_responsible_trigger.sql` | Menonaktifkan definisi tanpa PJ aktif serta memastikan PJ aktif atau yang diaktifkan kembali tetap ber-role `ADMIN`/`SUPER_ADMIN`. |
| `007_dynamic_billing_reminders.sql` | Aturan reminder per definisi, delivery otomatis yang dideduplikasi, dan batch audit reminder manual. |

## Tabel tagihan dinamis

### `billing_definitions`

```text
id, kode, nama, interval, is_active, created_by, created_at, updated_at
```

| Kolom | Aturan |
| --- | --- |
| `kode` | Wajib, unik, dan tidak kosong. Ini adalah identitas stabil definisi. |
| `nama` | Wajib dan unik tanpa membedakan kapitalisasi atau spasi tepi (`lower(btrim(nama))`). Dipakai command untuk menemukan definisi secara deterministik. |
| `interval` | Enum `billing_interval`: `WEEKLY`, `MONTHLY`, `YEARLY`, atau `CUSTOM`. Command WhatsApp menerima label Indonesia `mingguan`, `bulanan`, dan `tahunan`. |
| `is_active` | Menandai definisi masih dapat dipakai tanpa menghapus bill/payment historis. Service membuat definisi baru tidak aktif lalu mengaktifkannya saat PJ pertama berhasil ditambahkan. |
| `created_by` | Referensi user pembuat; dapat menjadi `NULL` jika user sumber dihapus sesuai aturan FK. |

### `billing_definition_rates`

```text
id, billing_definition_id, nominal, berlaku_mulai, berlaku_sampai,
created_by, created_at, updated_at
```

Menyimpan nominal global. `nominal` harus positif dan rentang tanggal valid. Constraint exclusion PostgreSQL melarang rentang nominal global yang tumpang tindih untuk definisi yang sama. Pencarian efektif diindeks oleh `(billing_definition_id, berlaku_mulai DESC)`.

### `student_billing_overrides`

```text
id, billing_definition_id, user_id, nominal, berlaku_mulai, berlaku_sampai,
created_by, legacy_tariff_id, created_at, updated_at
```

Menyimpan nominal pengecualian bagi satu santri. `nominal` harus positif dan rentang efektif tidak boleh tumpang tindih untuk kombinasi definisi–user.

`legacy_tariff_id` bersifat unik dan hanya jembatan ke `tariffs` lama. Kode baru tidak boleh menjadikannya sumber kebenaran; trigger bridge dapat membuat/memperbarui override ketika tarif legacy berubah.

### `billing_definition_responsibles`

```text
id, billing_definition_id, user_id, is_active,
legacy_admin_assignment_id, created_at, updated_at
```

Relasi many-to-many antara definisi dan PJ. Indeks parsial menjamin satu pasangan definisi–user hanya mempunyai satu relasi aktif. Trigger hanya menerima user dengan role `ADMIN` atau `SUPER_ADMIN` ketika relasi aktif dibuat atau diaktifkan kembali.

`legacy_admin_assignment_id` mengidentifikasi row yang dibuat dari penugasan unit lama. Saat penugasan legacy berubah/nonaktif, hanya row PJ bridge tersebut yang ditutup; PJ modern yang dibuat langsung tidak ikut dihapus.

### `billing_reminder_rules`

```text
id, billing_definition_id, offset_days, is_active, configured_by,
deactivated_by, deactivated_at, created_at, updated_at
```

Menyimpan aturan reminder otomatis per definisi. `offset_days` menyatakan jarak
hari dari `bills.jatuh_tempo`: `-7` untuk `H-7`, `0` untuk `H-0`, dan `3`
untuk `H+3`. Indeks parsial membatasi satu offset aktif per definisi. Aturan
yang dinonaktifkan dipertahankan sebagai histori dan tidak dapat diaktifkan
kembali; konfigurasi baru membuat row aturan baru.

### `billing_reminder_manual_batches`

```text
id, billing_definition_id, requested_by, as_of_date, requested_at, created_at
```

Mencatat satu eksekusi command reminder manual. `requested_by` boleh `NULL`
untuk Super Admin yang terotorisasi oleh nomor konfigurasi namun tidak memiliki
row user. Command manual yang diulang sengaja membuat batch baru.

### `billing_reminder_deliveries`

```text
id, billing_reminder_rule_id, billing_reminder_manual_batch_id, bill_id,
user_id, scheduled_for, message_body, status, sent_at, failure_reason,
attempt_count, last_attempt_at, created_at, updated_at
```

Setiap delivery berasal dari **tepat satu** aturan otomatis atau batch manual.
Untuk otomatis, `scheduled_for` harus sama dengan `jatuh_tempo + offset_days`
dan satu pasangan rule–bill hanya dapat memiliki satu delivery. Untuk manual,
`scheduled_for` sama dengan `as_of_date` batch dan satu pasangan batch–bill
hanya dapat memiliki satu delivery. Status memakai enum notifikasi `PENDING`,
`SENT`, atau `FAILED`; retry mengubah delivery yang sama agar deduplikasi dan
audit tetap utuh.

### `legacy_billing_definition_mappings`

```text
jenis_tagihan, billing_definition_id, created_at
```

Tabel bridge yang memetakan enum lama menjadi definisi seed:

| Enum legacy | Definisi seed | Interval |
| --- | --- | --- |
| `BULANAN` | `Bulanan` | `MONTHLY` |
| `TAHUNAN` | `Tahunan` | `YEARLY` |
| `PENDIDIKAN` | `Pendidikan` | `CUSTOM` |
| `KESEJAHTERAAN` | `Kesejahteraan` | `CUSTOM` |

Pemetaan ini tidak membatasi definisi baru dan bukan konfigurasi produk yang harus dipertahankan.

## Perubahan pada bill dan payment

### `bills`

Kolom dinamis yang ditambahkan:

```text
billing_definition_id, nama_tagihan_snapshot
```

- `billing_definition_id` mengarah ke `billing_definitions`; trigger memastikan bill baru memiliki definisi.
- `nama_tagihan_snapshot` wajib dan diisi dari definisi jika pemanggil tidak menyediakannya.
- `jenis_tagihan` legacy kini boleh `NULL`, tetapi bill harus memiliki minimal `billing_definition_id` atau `jenis_tagihan` untuk kompatibilitas.
- Satu user, definisi, awal periode, dan akhir periode hanya boleh mempunyai satu bill. Constraint exclusion juga melarang periode tumpang tindih untuk definisi tersebut.
- `nominal`, `periode_mulai`, `periode_selesai`, `jatuh_tempo`, dan `status` tetap berlaku seperti skema sebelumnya.

### `payments`

Kolom dinamis yang ditambahkan:

```text
billing_definition_id, nama_tagihan_snapshot
```

- Trigger memastikan payment baru memiliki definisi dan snapshot nama yang tidak kosong.
- Untuk `CURRENT_BILL`, definisi payment harus sama dengan definisi bill target, user harus sama, tanggal harus berada dalam periode bill, dan nominal tidak boleh melebihi sisa.
- Untuk `USER_SELF`, channel harus aktif, dimiliki `routed_to_admin_id`, dan pemiliknya harus PJ aktif definisi tersebut.
- Untuk `ADMIN_SELF` dan `ADMIN_FOR_USER`, pengaju harus `ADMIN`/`SUPER_ADMIN` sekaligus PJ aktif definisi. Payment langsung `APPROVED` dan dirutekan kembali kepada pengaju.
- Alokasi payment hanya boleh untuk bill user dan definisi yang sama.

## Bridge dan migrasi data

Migration 005 bersifat aditif dan tidak menghapus enum maupun tabel legacy.

1. Empat definisi legacy dibuat dan dipetakan satu kali.
2. Bill lama mendapat `billing_definition_id` dan snapshot nama.
3. Payment lama menggunakan definisi bill target bila ada, atau pemetaan enum legacy bila tidak ada bill target.
4. Setiap tarif per-user lama disalin sebagai `student_billing_override`; langkah ini menghindari hilangnya nominal historis yang berbeda antar-santri.
5. Satu rate global aktif per definisi legacy dipilih dari nominal paling umum saat migration berjalan. Override per-santri tetap menang.
6. Penugasan admin legacy disalin menjadi PJ sesuai pemetaan bidang lama; gender tidak dibawa karena PJ dinamis tidak berbasis gender.

Kolom enum dan tabel legacy dipertahankan agar record lama dapat dibaca dan integrasi yang belum cutover tidak rusak. Pembersihan hanya boleh dilakukan melalui migration terpisah setelah tidak ada runtime yang bergantung padanya.

## Tabel akses dan pengguna

### `roles`, `permissions`, dan `role_permissions`

```text
roles
  id, kode (unik), nama, deskripsi, created_at, updated_at

permissions
  id, kode (unik), nama, deskripsi, created_at, updated_at

role_permissions
  role_id, permission_id, created_at
```

Seed menyediakan `SUPER_ADMIN`, `ADMIN`, dan `USER`. Permission disimpan untuk model otorisasi, tetapi runtime lama belum mengevaluasi `role_permissions` per command.

### `users`

```text
id, role_id, nama_lengkap, username, jenis_kelamin,
nomor_whatsapp, status, created_at, updated_at
```

`username` unik dan sesuai pola `^[a-zA-Z0-9._-]{3,60}$`. `nomor_whatsapp` unik, berformat digit internasional tanpa `+`, panjang 8–15 digit. Bot hanya me-resolve user `AKTIF`.

### `admin_assignments` dan `tariffs` (legacy)

```text
admin_assignments
  id, user_id, jenis_penugasan, jenis_kelamin, unit_kode,
  is_active, created_at, updated_at

tariffs
  id, user_id, jenis_tagihan, nominal, berlaku_mulai, berlaku_sampai,
  dibuat_oleh, created_at, updated_at
```

Kedua tabel tetap ada untuk kompatibilitas. `admin_assignments` menyinkronkan PJ bridge dan `tariffs` menyinkronkan override bridge. Tagihan baru harus memakai tabel dinamis, bukan menambahkan jenis/nominal pada struktur ini.

## Tabel pembayaran dan operasional lainnya

### `payment_channels`

```text
id, admin_user_id, nama, metode, nomor_rekening, nama_pemilik,
urutan, is_active, created_at, updated_at
```

Metode `DANA`, `BANK_TRANSFER`, atau `CASH`. Rekening wajib untuk metode non-cash dan harus kosong untuk cash.

### `payment_arrears_selections`

```text
payment_id, bill_id, nominal_wajib, created_at
```

Hanya berlaku bagi `ARREARS`. Bill harus milik user dan definisi yang sama dengan payment serta masih menjadi tunggakan; `nominal_wajib` harus sama dengan sisa bill.

### `payment_allocations`

```text
id, payment_id, bill_id, nominal_alokasi, created_at
```

Hanya payment `APPROVED` yang dapat dialokasikan. Satu payment hanya dapat satu alokasi per bill; alokasi tidak boleh melampaui payment atau bill. Constraint trigger tertunda mewajibkan payment `APPROVED` teralokasi penuh sebelum commit.

### `notifications` dan `audit_logs`

```text
notifications
  id, user_id, notification_type, message_body, status,
  related_bill_id, related_payment_id, sent_at, failure_reason,
  created_at, updated_at

audit_logs
  id, actor_user_id, action, entity_type, entity_id,
  old_data, new_data, request_id, created_at
```

`notifications` memakai status `PENDING`, `SENT`, atau `FAILED` dan tetap ada
untuk lifecycle notifikasi legacy/umum. Reminder dinamis menggunakan
`billing_reminder_rules`, `billing_reminder_manual_batches`, dan
`billing_reminder_deliveries` sebagai sumber audit serta deduplikasi. `audit_logs`
tersedia tetapi belum ditulis oleh repository/service/adapter aplikasi.

## Enum utama

```text
billing_interval                WEEKLY | MONTHLY | YEARLY | CUSTOM
status_user                     AKTIF | NONAKTIF
jenis_kelamin                   L | P
jenis_tagihan (legacy)          BULANAN | TAHUNAN | PENDIDIKAN | KESEJAHTERAAN
status_tagihan                  BELUM_BAYAR | CICIL | LUNAS
status_pembayaran               PENDING | APPROVED | REJECTED | CANCELLED
ruang_lingkup_pembayaran        CURRENT_BILL | ARREARS
jenis_penugasan_admin (legacy)  BENDAHARA | PENDIDIKAN | KESEJAHTERAAN
jenis_metode_pembayaran         DANA | BANK_TRANSFER | CASH
submission_type_pembayaran      USER_SELF | ADMIN_SELF | ADMIN_FOR_USER
status_notifikasi               PENDING | SENT | FAILED
```

Lihat [ERD](ERD%20MIFABOT%20v1.md) untuk relasi dan [ADR-003](docs/architecture/003-tagihan-dinamis.md) untuk keputusan produk.
