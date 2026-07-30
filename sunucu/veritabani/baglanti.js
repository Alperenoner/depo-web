// ============================================================
//  Veritabani baglantisi (Neon Postgres)
//  Tek bir havuz (pool) tutar, butun sunucu bunu paylasir.
// ============================================================

const { Pool } = require('pg');

// .env dosyasini elle oku - dis paket kullanmiyoruz (dotenv gerekmez).
// Node 20+ zaten --env-file destekler ama Railway ortam degiskenlerini
// dogrudan verecek, o yuzden ikisi de calissin diye boyle yaziyoruz.
function envYukle() {
  const fs = require('fs');
  const path = require('path');
  const yol = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(yol)) return; // Railway'de dosya yok, degiskenler hazir gelir

  const metin = fs.readFileSync(yol, 'utf8').replace(/^﻿/, '');
  for (const satir of metin.split(/\r?\n/)) {
    const temiz = satir.trim();
    if (!temiz || temiz.startsWith('#')) continue;
    const esittir = temiz.indexOf('=');
    if (esittir === -1) continue;
    const anahtar = temiz.slice(0, esittir).trim();
    let deger = temiz.slice(esittir + 1).trim();
    // Tirnak icindeyse tirnaklari at
    if (
      (deger.startsWith('"') && deger.endsWith('"')) ||
      (deger.startsWith("'") && deger.endsWith("'"))
    ) {
      deger = deger.slice(1, -1);
    }
    // Ortam degiskeni zaten varsa uzerine YAZMA (Railway kazanir)
    if (process.env[anahtar] === undefined) process.env[anahtar] = deger;
  }
}

envYukle();

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL tanimli degil. .env dosyasini kontrol et ' +
      '(ornegi icin .env.ornek dosyasina bak).'
  );
}

// SSL ayari baglanti adresindeki `sslmode=verify-full` ile gelir:
// sertifika DOGRULANIR (ortadaki adam saldirisina kapali). Neon'un
// sertifikasi gecerli oldugu icin ek ayar gerekmez.
const havuz = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5, // Neon ucretsiz katmani icin yeterli
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

havuz.on('error', (hata) => {
  console.error('[veritabani] bekleyen baglantida hata:', hata.message);
});

/** Tek sorgu calistirir. Ornek: sorgu('select * from kutular where id=$1', [id]) */
async function sorgu(metin, degerler = []) {
  return havuz.query(metin, degerler);
}

/** Birden fazla sorguyu tek islem (transaction) icinde calistirir. */
async function islem(isFonksiyonu) {
  const baglanti = await havuz.connect();
  try {
    await baglanti.query('BEGIN');
    const sonuc = await isFonksiyonu(baglanti);
    await baglanti.query('COMMIT');
    return sonuc;
  } catch (hata) {
    await baglanti.query('ROLLBACK');
    throw hata;
  } finally {
    baglanti.release();
  }
}

module.exports = { havuz, sorgu, islem };
