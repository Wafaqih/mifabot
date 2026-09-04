# ADR-003 — Tagihan Dinamis

**Status:** Diimplementasikan  
**Terakhir diverifikasi:** 1 September 2026

MIFABOT tidak lagi memakai empat kategori tagihan tetap sebagai sumber
kebenaran. Tagihan seperti SPP, iuran makan, daftar ulang, pendidikan, atau
jenis lain adalah data yang dibuat operator.

## Keputusan

1. Satu tagihan direpresentasikan oleh `billing_definitions`, dengan nama,
   kode stabil, interval, nominal global, dan banyak PJ.
2. Definisi baru dibuat **belum aktif**. Definisi aktif otomatis ketika PJ
   pertama ditambahkan, sehingga sistem tidak menerbitkan tagihan yang belum
   memiliki jalur pembayaran.
3. Definisi aktif ditujukan kepada semua santri berstatus `AKTIF` dan ber-role
   `USER`. Admin/PJ tidak ikut menjadi sasaran scheduler hanya karena akunnya
   aktif.
4. Nominal global berlaku untuk semua santri; override per santri menang saat
   bill diterbitkan.
5. Perubahan nominal hanya berlaku pada periode berikutnya. Bill yang telah
   terbit menyimpan snapshot nama dan nominal sehingga tidak berubah.
6. Satu atau lebih PJ dapat menangani satu definisi. Payment channel hanya
   dapat dipakai bila pemilik channel adalah PJ aktif definisi tersebut.
7. Reminder otomatis merupakan aturan per definisi dan memakai offset hari
   terhadap jatuh tempo bill; ia tidak lagi bergantung pada interval `MONTHLY`.
   Reminder manual adalah pengiriman segera per definisi dengan batch audit
   tersendiri.

## Model data

```text
billing_definitions
├── kode, nama, interval, is_active
├── billing_definition_rates     (riwayat nominal global)
├── student_billing_overrides    (nominal khusus per santri)
└── billing_definition_responsibles (banyak PJ)

bills
├── billing_definition_id
├── nama_tagihan_snapshot
├── nominal snapshot
└── periode dan jatuh tempo

payments
├── billing_definition_id
└── nama_tagihan_snapshot
```

Nilai internal interval adalah `WEEKLY`, `MONTHLY`, `YEARLY`, dan `CUSTOM`.
Command WhatsApp menerima kata `mingguan`, `bulanan`, `tahunan`, dan `custom`.

## Nominal

Urutan pemilihan nominal saat bill diterbitkan:

```text
override aktif santri → nominal global aktif → penerbitan ditolak
```

`Set nominal` selalu menentukan tanggal efektif sendiri, bukan menerima
tanggal dari command:

| Interval | Berlaku mulai |
| --- | --- |
| `WEEKLY` | Senin berikutnya |
| `MONTHLY` | Tanggal 1 bulan berikutnya |
| `YEARLY` | 1 Januari tahun berikutnya |
| `CUSTOM` | Hari berikutnya; operator kemudian memilih periode saat menerbitkan bill |

`Semua` mengganti nominal global dan menutup/menghapus override yang terjadwal
mulai tanggal efektif itu. Target individual harus santri aktif; bila satu
target tidak valid, transaksi dibatalkan seluruhnya.

## PJ

```text
Add PJ <nama tagihan> <username/nomor_whatsapp>
Del PJ <nama tagihan> <username/nomor_whatsapp>
```

Keduanya hanya untuk Super Admin. `Add PJ` menaikkan target ber-role `USER`
menjadi `ADMIN`; `ADMIN` dan `SUPER_ADMIN` yang sudah ada tidak diubah.
Menghapus PJ tidak menurunkan role. Tagihan aktif tidak boleh kehilangan PJ
aktif terakhir.

## Penerbitan bill

Scheduler berjalan sekali per hari sekitar pukul 05.00 pada zona waktu
`APP_TIMEZONE`:

| Interval | Saat diterbitkan | Periode | Jatuh tempo default |
| --- | --- | --- | --- |
| `WEEKLY` | Setiap Senin | Senin–Minggu | 4 hari setelah awal periode |
| `MONTHLY` | Tanggal 1 | Tanggal 1–akhir bulan | Tanggal 5 |
| `YEARLY` | 1 Januari | 1 Januari–31 Desember | 5 Januari |
| `CUSTOM` | Tidak otomatis | Dipilih operator | Dipilih operator |

Penerbitan bersifat idempoten untuk kombinasi santri, definisi, awal, dan akhir
periode. Custom diterbitkan manual dengan:

```text
Terbitkan tagihan <nama custom> <YYYY-MM-DD> <YYYY-MM-DD> <YYYY-MM-DD>
```

Command tersebut hanya menerima definisi `CUSTOM` dan saat ini hanya dapat
dijalankan Super Admin.

## Pembayaran

Pengguna mengajukan pembayaran bill berjalan dengan:

```text
Bayar <nama tagihan> <nominal>
```

Bot memilih bill berjalan yang masih bersisa, menampilkan channel milik PJ
aktif, dan meminta bukti untuk channel non-cash. Cicilan diperbolehkan;
nominal tidak boleh melebihi sisa bill. Pengguna juga dapat memulai pembayaran
tunggakan dengan `Bayar tunggakan <nama tagihan>`, memilih periode tunggakan
secara penuh, lalu memilih channel. PJ penerima channel melihat pengajuan
dengan `List pengajuan` dan memutuskan melalui `Setujui <nomor>` atau
`Tolak <nomor> <alasan>`. PJ aktif juga dapat mencatat pembayaran bill
berjalan santri dengan `Catat bayar <nama tagihan> <santri> <nominal>` atau
memilih tunggakan melalui `Catat tunggakan <nama tagihan> <santri>`; keduanya
langsung disetujui dan dialokasikan ke bill terkait.

## Reminder

Aturan reminder otomatis disimpan per definisi tagihan. Nilai offset mengikuti
notasi berikut:

| Notasi | Makna |
| --- | --- |
| `H-7` | Tujuh hari sebelum `jatuh_tempo`. |
| `H-0` | Tepat pada `jatuh_tempo`. |
| `H+3` | Tiga hari setelah `jatuh_tempo`. |

Super Admin mengubah seluruh aturan aktif definisi melalui:

```text
Set reminder <nama tagihan> H-7 H-3 H-0
Set reminder <nama tagihan> off
```

Aturan berlaku untuk semua interval, termasuk `CUSTOM`, sebab setiap bill
memiliki jatuh tempo. Scheduler mengevaluasi pengiriman setiap hari pada zona
waktu `APP_TIMEZONE`, hanya untuk bill dengan sisa positif. Satu aturan
otomatis menghasilkan paling banyak satu delivery per bill. Jika pengiriman
gagal, delivery yang sama dapat dicoba kembali sehingga tidak ada notifikasi
baru yang duplikat.

Tidak ada aturan otomatis bawaan untuk definisi baru. Migration 007 memberi
definisi bridge legacy `Bulanan` aturan `H-4`, `H-2`, dan `H-0`; dengan jatuh
tempo tanggal 5, ini mempertahankan pengiriman pada tanggal 1, 3, dan 5.

PJ aktif definisi tersebut atau Super Admin dapat mengirim reminder segera:

```text
Reminder <nama tagihan>
```

Command manual mengirim kepada setiap pemilik bill definisi itu yang masih
memiliki sisa, termasuk tunggakan. Command boleh diulangi dengan sengaja;
masing-masing command membuat batch audit baru, sedangkan satu bill tidak dapat
menerima dua delivery dari batch manual yang sama.

## Transisi legacy

Migration 005 mempertahankan enum, `tariffs`, dan `admin_assignments` lama
sebagai bridge audit/kompatibilitas. Empat nilai legacy dipetakan menjadi
definisi seed, data tarif lama menjadi override, dan penugasan lama menjadi
PJ bridge. Kode baru tidak menggunakan struktur legacy sebagai sumber
kebenaran. Migration 006 menonaktifkan definisi tanpa PJ aktif dan
memperkeras validasi agar PJ aktif atau yang diaktifkan kembali selalu
ber-role `ADMIN` atau `SUPER_ADMIN`. Migration 007 memindahkan deduplikasi
reminder ke rule dan delivery dinamis, sekaligus memberi definisi bridge
`Bulanan` aturan awal yang setara jadwal legacy.
