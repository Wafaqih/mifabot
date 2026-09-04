# Sistem Tagihan dan Tunggakan MIFABOT

**Status:** Diimplementasikan dengan migration 005–007  
**Terakhir diperbarui:** 31 Agustus 2026

## Prinsip

- Tagihan adalah definisi data, bukan empat jenis tetap. Contoh: SPP, iuran
  makan, daftar ulang, atau tagihan lain yang dibuat operator.
- Definisi baru memperoleh nominal global awal, tetapi tidak aktif sampai PJ
  pertama ditambahkan.
- Definisi aktif diterbitkan untuk seluruh santri berstatus `AKTIF` dan
  ber-role `USER`.
- Override nominal berlaku hanya pada santri target. Bill yang sudah terbit
  menyimpan snapshot dan tidak berubah saat rate atau nama konfigurasi berubah.
- Tunggakan adalah bill dengan `periode_selesai` sebelum tanggal acuan dan
  sisa pembayaran masih positif.

## Konfigurasi tagihan

```text
Buat tagihan <nama> <nominal> <mingguan|bulanan|tahunan|custom>
Daftar Tagihan
Hapus tagihan <nama tagihan>
Add PJ <nama tagihan> <username/nomor_whatsapp>
Del PJ <nama tagihan> <username/nomor_whatsapp>
```

`Add PJ` dan `Del PJ` adalah command Super Admin. User target dipromosikan ke
`ADMIN` bila sebelumnya `USER`; Admin dan Super Admin yang sudah ada tidak
didemosi. Tagihan aktif harus selalu menyisakan sedikitnya satu PJ aktif.

`Daftar Tagihan` dan `Hapus tagihan` juga hanya tersedia bagi Super Admin.
Penghapusan menonaktifkan tagihan agar tagihan, pembayaran, dan audit lama
tetap tersimpan; tagihan yang nonaktif tidak lagi diterbitkan.

## Nominal

```text
Set nominal <nama tagihan> <nominal>
Semua
```

atau gunakan satu username/nomor WhatsApp per baris untuk override santri
tertentu. Semua perubahan berlaku pada periode berikutnya:

| Interval | Tanggal efektif |
| --- | --- |
| Mingguan | Senin berikutnya |
| Bulanan | Tanggal 1 bulan berikutnya |
| Tahunan | 1 Januari tahun berikutnya |
| Custom | Hari berikutnya, sebelum periode custom dipilih operator |

`Semua` mengubah global rate dan membatalkan override yang terjadwal mulai
tanggal efektif. Operasi target bersifat atomik: bila satu target bukan santri
aktif atau tidak ditemukan, tidak ada perubahan disimpan.

## Penerbitan bill

| Interval | Otomatis | Periode | Jatuh tempo |
| --- | --- | --- | --- |
| Mingguan | Senin sekitar 05.00 | Senin–Minggu | 4 hari setelah mulai |
| Bulanan | Tanggal 1 sekitar 05.00 | Tanggal 1–akhir bulan | Tanggal 5 |
| Tahunan | 1 Januari sekitar 05.00 | 1 Januari–31 Desember | 5 Januari |
| Custom | Tidak | Ditentukan operator | Ditentukan operator |

Scheduler memakai `APP_TIMEZONE` dan penerbitan idempoten per santri,
definisi, dan periode.

Untuk `custom`:

```text
Terbitkan tagihan <nama custom> <periode_mulai> <periode_selesai> <jatuh_tempo>
```

Ketiga tanggal harus berformat `YYYY-MM-DD` dan hanya Super Admin yang dapat
menjalankan command ini.

## Pembayaran

```text
Bayar <nama tagihan> <nominal>
```

Bot mencari bill berjalan dengan sisa positif, menampilkan channel pembayaran
yang pemiliknya PJ aktif tagihan itu, lalu meminta bukti untuk channel non-cash.
Cicilan diperbolehkan dan nominal tidak boleh melebihi sisa bill.

## Reminder

Reminder otomatis diatur per tagihan, bukan per interval `MONTHLY`. Aturannya
berupa offset dari `jatuh_tempo` setiap bill, sehingga juga mendukung bill
`CUSTOM`.

```text
Set reminder <nama tagihan> H-7 H-3 H-0
Set reminder <nama tagihan> off
```

`H-7` berarti tujuh hari sebelum jatuh tempo, `H-0` tepat pada jatuh tempo,
dan `H+3` tiga hari sesudahnya. Hanya Super Admin yang dapat mengatur aturan
ini. Command tersebut mengganti seluruh rule aktif untuk tagihan; `off`
menonaktifkan semuanya.

Scheduler memeriksa rule setiap hari pada `APP_TIMEZONE` dan hanya mengirim
untuk bill dengan sisa positif. Kombinasi rule otomatis dan bill dideduplikasi:
ia hanya dapat membuat satu delivery, sementara kegagalan dicoba kembali pada
delivery yang sama. Tagihan baru tidak diberi rule default. Definisi bridge
`Bulanan` memperoleh `H-4 H-2 H-0` agar perilaku tanggal 1, 3, dan 5 tetap
berjalan setelah cutover.

```text
Reminder <nama tagihan>
```

PJ aktif tagihan dan Super Admin dapat memakai command manual tersebut melalui
chat pribadi. Bot mengirim segera kepada seluruh santri yang memiliki bill
tagihan bersisa, termasuk tunggakan. Command manual dapat diulang dan setiap
eksekusi dicatat sebagai batch audit tersendiri.

## Riwayat dan bridge legacy

`bills` dan `payments` baru menyimpan `billing_definition_id` serta snapshot
nama. Enum `jenis_tagihan`, tabel `tariffs`, dan `admin_assignments` lama masih
ada sebagai bridge riwayat; kode baru tidak menggunakannya untuk membuat atau
merutekan tagihan baru.

Rincian command: [docs/commands.md](docs/commands.md). Rincian skema:
[SKEMA DATABASE MIFABOT v1.md](SKEMA%20DATABASE%20MIFABOT%20v1.md).
