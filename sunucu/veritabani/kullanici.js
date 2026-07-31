// ============================================================================
//  KULLANICI YONETIMI  -  `npm run db:kullanici`
//
//  Kullanim:
//    npm run db:kullanici -- liste
//    npm run db:kullanici -- ekle <kullaniciAdi> <sifre>
//    npm run db:kullanici -- sifre <kullaniciAdi> <yeniSifre>
//    npm run db:kullanici -- sil <kullaniciAdi>
//
//  Neden ayri bir komut: 30 Tem 2026'ya kadar tek hesap vardi ve kur.js
//  onu kuruyordu. Ikinci hesap gerekince buraya tasindi - kur.js yalnizca
//  ILK hesabi kurar, sonrakiler buradan.
//
//  SIFRE KOMUT SATIRINDA GECER. Kabuk gecmisine yazilir; hassassa once
//  bos sifreyle ekleyip arayuzdeki  🔑 Şifre  penceresinden degistirin.
//  Duz metin sifre veritabaninda TUTULMAZ (scrypt ozeti saklanir).
// ============================================================================

'use strict';

const { havuz } = require('./baglanti');
const guvenlik = require('../guvenlik');
const veri = require('../veri');

const EN_KISA_SIFRE = 6;

function kullanimYaz() {
  console.log(`
Kullanim:
  npm run db:kullanici -- liste
  npm run db:kullanici -- ekle  <kullaniciAdi> <sifre>
  npm run db:kullanici -- sifre <kullaniciAdi> <yeniSifre>
  npm run db:kullanici -- sil   <kullaniciAdi>
`);
}

async function liste() {
  const hesaplar = await veri.yoneticiListesi();
  if (hesaplar.length === 0) {
    console.log('Hic hesap yok. Once `npm run db:kur` calistir.');
    return;
  }
  console.log('Kayitli hesaplar (' + hesaplar.length + '):');
  for (const h of hesaplar) {
    console.log(
      '  id=' + String(h.id).padEnd(4) +
      h.kullanici.padEnd(32) +
      (h.kurucu ? 'KURUCU' : '')
    );
  }
  console.log('\nHer hesabin KENDI verisi var (arac, kutu, plan ayri).');
  console.log('Tek yetki farki: davet kodunu yalnizca KURUCU uretebilir.');
}

async function ekle(kullanici, sifre) {
  if (!kullanici || !sifre) return kullanimYaz();
  if (sifre.length < EN_KISA_SIFRE) {
    console.error('HATA: sifre en az ' + EN_KISA_SIFRE + ' karakter olmali.');
    process.exitCode = 1;
    return;
  }

  const varOlan = await veri.yoneticiOku(kullanici);
  if (varOlan) {
    console.error('HATA: "' + kullanici + '" zaten var (id=' + varOlan.id + ').');
    console.error('      Sifresini degistirmek icin: sifre ' + kullanici + ' <yeniSifre>');
    process.exitCode = 1;
    return;
  }

  const { tuz, ozet } = await guvenlik.sifreOzetle(sifre);
  const yeni = await veri.yoneticiEkle({ kullanici, tuz, ozet, ad: '' });
  console.log('Hesap olusturuldu: ' + yeni.kullanici + '  (id=' + yeni.id + ')');
  console.log('Duz metin sifre veritabaninda TUTULMUYOR (scrypt ozeti).');
  if (sifre.length < 10) {
    console.warn('\nUYARI: sifre kisa. Site internete acik - ilk firsatta');
    console.warn('       arayuzdeki  Şifre  penceresinden degistirin.');
  }
}

async function sifreDegistir(kullanici, yeniSifre) {
  if (!kullanici || !yeniSifre) return kullanimYaz();
  if (yeniSifre.length < EN_KISA_SIFRE) {
    console.error('HATA: sifre en az ' + EN_KISA_SIFRE + ' karakter olmali.');
    process.exitCode = 1;
    return;
  }

  const hesap = await veri.yoneticiOku(kullanici);
  if (!hesap) {
    console.error('HATA: "' + kullanici + '" bulunamadi.');
    process.exitCode = 1;
    return;
  }

  const { tuz, ozet } = await guvenlik.sifreOzetle(yeniSifre);
  await veri.yoneticiGuncelle(hesap.id, { kullanici: hesap.kullanici, tuz, ozet });
  console.log('Sifre degistirildi: ' + hesap.kullanici);
}

async function sil(kullanici) {
  if (!kullanici) return kullanimYaz();

  const hesap = await veri.yoneticiOku(kullanici);
  if (!hesap) {
    console.error('HATA: "' + kullanici + '" bulunamadi.');
    process.exitCode = 1;
    return;
  }

  // SON hesabi silmek siteyi kilitler - kimse giremez
  const sayi = await veri.yoneticiSayisi();
  if (sayi <= 1) {
    console.error('HATA: son hesap silinemez - siteye kimse giremez hale gelir.');
    process.exitCode = 1;
    return;
  }

  // 31 Tem 2026'dan beri her hesabin KENDI verisi var ve veritabani kisiti
  // (on delete cascade) hesapla birlikte araclarini, kutularini, planlarini
  // ve yedeklerini de siler. Geri donusu yok.
  const { rows } = await havuz.query(
    `select (select count(*) from araclar where kullanici_id = $1)::int arac,
            (select count(*) from kutular where kullanici_id = $1)::int kutu,
            (select count(*) from planlar where kullanici_id = $1)::int plan`,
    [hesap.id]
  );
  const v = rows[0];

  await veri.yoneticiSil(hesap.id);
  console.log('Hesap silindi: ' + hesap.kullanici);
  console.log(
    '  Verisi de silindi: ' + v.arac + ' arac, ' + v.kutu + ' kutu, ' + v.plan + ' plan.'
  );
}

async function calistir() {
  const [komut, a, b] = process.argv.slice(2);
  switch (komut) {
    case 'liste': await liste(); break;
    case 'ekle': await ekle(a, b); break;
    case 'sifre': await sifreDegistir(a, b); break;
    case 'sil': await sil(a); break;
    default: kullanimYaz();
  }
}

calistir()
  .catch((hata) => {
    console.error('\nHATA:', hata.message);
    process.exitCode = 1;
  })
  .finally(() => havuz.end());
