# ADR-002 — Kebijakan Tagihan dan Pembayaran Legacy

**Status:** Arsip perilaku sebelum cutover; digantikan oleh [ADR-003 — Tagihan Dinamis](003-tagihan-dinamis.md)  
**Terakhir diperbarui:** 1 September 2026

Dokumen ini mencatat perilaku tagihan tetap **sebelum** cutover dinamis. Ia bukan deskripsi runtime saat ini dan bukan sumber desain tagihan baru. Tagihan baru memakai `billing_definitions`, rate, override, dan PJ dinamis sebagaimana diatur ADR-003.

## Perilaku legacy historis yang dipertahankan sebagai bridge

| Area | Perilaku runtime lama |
| --- | --- |
| Identitas tagihan | Enum `BULANAN`, `TAHUNAN`, `PENDIDIKAN`, dan `KESEJAHTERAAN`. |
| Scheduler aktif | Hanya `BULANAN`; job berjalan tanggal 1, 3, dan 5 sekitar pukul 05.00 sesuai `APP_TIMEZONE`. |
| Periode bulanan | Tanggal 1 hingga hari terakhir bulan; jatuh tempo tanggal 5. |
| Reminder | Hanya untuk bill `BULANAN` legacy yang masih bersisa. |
| Tarif | `tariffs` menyimpan tarif per user dan jenis tetap. |
| Routing | Unit `BENDAHARA`/`PENDIDIKAN`/`KESEJAHTERAAN` dipakai untuk menentukan admin tujuan. |
| Command user | `Bayar bulanan <nominal>` adalah satu-satunya command pembayaran user lama yang aktif sebelum generic payment dinamis tersedia. |

Migration dinamis mempertahankan struktur ini sebagai bridge data agar histori tidak hilang. Struktur legacy tidak boleh dipakai untuk membuat kategori produk baru.

## Kebijakan pembayaran yang tetap berlaku lintas model

- Nominal pembayaran harus bilangan bulat positif dan tidak boleh melebihi sisa bill target.
- Cicilan bill berjalan diperbolehkan.
- Payment `APPROVED` harus teralokasi penuh ke bill yang sesuai.
- Status bill diturunkan dari alokasi: `BELUM_BAYAR`, `CICIL`, atau `LUNAS`.
- Kelebihan pembayaran ditolak; tidak ada saldo kredit.
- Reversal, koreksi, dan pembatalan payment `APPROVED` belum tersedia melalui alur normal.
- Tunggakan adalah bill dengan periode berakhir dan masih bersisa, bukan entitas tersendiri.

## Pembayaran legacy melalui WhatsApp

Sebelum generic payment dinamis tersedia, alur legacy bekerja sebagai berikut:

1. User aktif mengirim `Bayar bulanan <nominal>` melalui chat pribadi.
2. Bot memilih bill bulanan legacy periode berjalan yang masih bersisa.
3. User memilih payment channel.
4. Channel non-cash memerlukan foto bukti JPG, PNG, atau WebP maksimal 5 MB; cash tidak memerlukan bukti.
5. Bot menyimpan pengajuan sebagai `PENDING`.

Alur tersebut tidak berarti semua tagihan baru harus diberi nama atau jenis `BULANAN`. Setelah cutover, bentuk target command adalah `Bayar <nama tagihan> <nominal>` dan sumber tagihannya adalah definisi dinamis.

## Batasan legacy yang tidak boleh dibawa ke desain baru

- Tidak ada pemetaan permanen “bulanan/tahunan → bendahara” atau “pendidikan/kesejahteraan → unit tertentu”. Routing harus memakai PJ aktif definisi.
- Tidak ada batas empat jenis tagihan.
- Tidak ada asumsi setiap tagihan bulanan memiliki jatuh tempo tanggal 5.
- Tidak ada asumsi semua tarif disimpan per user; model baru memakai nominal global dengan override terbatas bila diperlukan.

## Status implementasi saat ini

Scheduler dinamis, reminder dinamis per jatuh tempo, command penerbitan
`CUSTOM`, pengelolaan channel, pembayaran tunggakan, dan keputusan
approval/rejection oleh PJ, dan pencatatan pembayaran langsung oleh PJ kini
tersedia. Laporan, export, audit log, dan reversal tetap belum tersedia melalui
WhatsApp. Lihat [referensi command](../commands.md) untuk command aktual.
