// ============================================================================
//  VERITABANI KURULUMU  -  `npm run db:kur`
//
//  1. sema.sql dosyasini calistirir (tablolari olusturur, varsa dokunmaz)
//  2. Yonetici hesabi yoksa .env'deki bilgilerle olusturur
//
//  Tekrar calistirmak GUVENLIDIR: var olan veriyi silmez, yonetici sifresini
//  degistirmez. Sifre degistirmek icin arayuzdeki "Şifre Değiştir" kullanilir.
// ============================================================================

'use strict';

const fs = require('fs');
const path = require('path');

const { sorgu, havuz } = require('./baglanti');
const guvenlik = require('../guvenlik');
const veri = require('../veri');

async function kur() {
  console.log('Veritabani kurulumu basliyor...\n');

  // ---- 1. Semayi calistir ----------------------------------------------
  const semaYolu = path.join(__dirname, 'sema.sql');
  const sema = fs.readFileSync(semaYolu, 'utf8');
  await sorgu(sema);
  console.log('  [1/3] Tablolar hazir (sema.sql calistirildi)');

  // ---- 2. Tablolari listele --------------------------------------------
  const { rows: tablolar } = await sorgu(
    `select table_name from information_schema.tables
      where table_schema = 'public' order by table_name`
  );
  console.log(
    '        ' + tablolar.map((t) => t.table_name).join(', ')
  );

  // ---- 3. Yonetici hesabi ----------------------------------------------
  // Artik birden fazla hesap olabiliyor; buradaki is yalnizca ILK hesabi
  // kurmak. Sonrakiler `npm run db:kullanici` ile ekleniyor.
  const hesapSayisi = await veri.yoneticiSayisi();

  if (hesapSayisi > 0) {
    const liste = await veri.yoneticiListesi();
    console.log('  [2/3] Hesap zaten var (' + hesapSayisi + '): ' +
                liste.map((h) => h.kullanici).join(', '));
    console.log('        (sifreler degistirilmedi - arayuzden degistirilebilir)');
  } else {
    const kullanici = (process.env.YONETICI_KULLANICI || 'admin').trim();
    const sifre = process.env.YONETICI_SIFRE || '';

    if (!sifre) {
      console.error(
        '\n  HATA: YONETICI_SIFRE tanimli degil. .env dosyasina yaz ve tekrar dene.'
      );
      process.exitCode = 1;
      return;
    }
    if (sifre.length < 6) {
      console.error('\n  HATA: YONETICI_SIFRE en az 6 karakter olmali.');
      process.exitCode = 1;
      return;
    }

    const { tuz, ozet } = await guvenlik.sifreOzetle(sifre);
    // ILK hesap kurucudur: davet (referans) kodu uretme yetkisi onda.
    await veri.yoneticiEkle({ kullanici, tuz, ozet, ad: '', kurucu: true });

    console.log('  [2/3] Yonetici hesabi olusturuldu: ' + kullanici + '  (kurucu)');
    console.log('        Duz metin sifre veritabaninda TUTULMUYOR (scrypt ozeti).');
  }

  // ---- 4. Durum ozeti ---------------------------------------------------
  // Sayimlar BUTUN hesaplarin toplami. veri.js'teki sayaclar tek hesabi
  // sorar (her hesabin kendi verisi var), buradaki amac ise genel durum.
  const say = (tablo) =>
    sorgu('select count(*)::int as n from ' + tablo).then((r) => r.rows[0].n);

  const [aracSayisi, kutuSayisi, planSayisi] = await Promise.all([
    say('araclar'),
    say('kutular'),
    say('planlar'),
  ]);

  console.log('  [3/3] Mevcut veri (tum hesaplar):');
  console.log('        Arac  : ' + aracSayisi + (aracSayisi === 0 ? '  (bos - dogru, kullanici olusturacak)' : ''));
  console.log('        Kutu  : ' + kutuSayisi + (kutuSayisi === 0 ? '  (bos - dogru, hazir olcu yok)' : ''));
  console.log('        Plan  : ' + planSayisi);

  console.log('\nKurulum tamam. Sunucuyu baslatmak icin: npm start');
}

kur()
  .catch((hata) => {
    console.error('\nKURULUM BASARISIZ');
    console.error('  ' + hata.message);
    process.exitCode = 1;
  })
  .finally(() => havuz.end());
