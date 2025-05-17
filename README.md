# 🚀 NTE-Pharos

Skrip otomatisasi interaksi smart contract Ethereum dengan dukungan terminal UI dan proxy, dikembangkan oleh [Svz1404](https://github.com/Svz1404).

> 📺 Tutorial & Update: [https://t.me/NTExhaust](https://t.me/NTExhaust)

---

## 🧰 Fitur

- Antarmuka terminal dinamis (TUI) dengan `blessed` + `chalk`
- Interaksi langsung dengan smart contract via `ethers.js`
- Mendukung HTTP dan SOCKS Proxy
- Multiple wallet support (via `pk.txt` dan `wallet.txt`)

---

## ⚙️ Instalasi

```bash
git clone https://github.com/Svz1404/NTE-Pharos.git
cd NTE-Pharos
npm install
```

> 📝 Pastikan Anda menggunakan Node.js v16 atau lebih tinggi.

---

## 📁 Struktur File

- `index.js` - Skrip utama
- `config.json` - Konfigurasi jaringan dan kontrak
- `pk.txt` - Daftar private key
- `wallet.txt` - Daftar alamat wallet
- `package.json` - Metadata proyek

---

## 🔧 Konfigurasi


### 1. `pk.txt`

```
0xYourPrivateKey1
0xYourPrivateKey2
```
---

## ▶️ Menjalankan

```bash
node index.js
```

Program akan memulai proses interaksi otomatis berdasarkan konfigurasi yang diberikan.

---

## ⚠️ Catatan Penting

- Jangan membagikan `pk.txt` ke siapa pun!
- Periksa ulang konfigurasi gas dan proxy sebelum dijalankan.
- Disarankan untuk testing di testnet terlebih dahulu.

---

## 📬 Kontak & Bantuan

Gabung komunitas untuk update dan bantuan:
[https://t.me/NTExhaust](https://t.me/NTExhaust)

---
