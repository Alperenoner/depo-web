// ============================================================================
//  GUVENLIK
//  - Sifre saklama : scrypt (Node'un icinde, bellek-zorlu, sifre icin dogru arac)
//  - Oturum        : rastgele jeton, veritabaninda, HttpOnly cerezde
//  - Kaba kuvvet   : ayni IP'den 8 hatali denemeden sonra 10 dakika kilit
//
//  Duz metin sifre HICBIR YERDE saklanmaz.
// ============================================================================

'use strict';

const crypto = require('crypto');
const { sorgu } = require('./veritabani/baglanti');

// --- Ayarlar ---------------------------------------------------------------

const SCRYPT_UZUNLUK = 64;
const SCRYPT_AYAR = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const OTURUM_SURESI_MS = 12 * 60 * 60 * 1000; // 12 saat
const CEREZ_ADI = 'depo_oturum';

const AZAMI_HATA = 8;
const KILIT_SURESI_MS = 10 * 60 * 1000; // 10 dakika

// Davet (referans) kodu
const DAVET_GECERLILIK_GUN = 14;
const KAYIT_SAATLIK_AZAMI = 3; // ayni IP'den saatte en fazla 3 hesap

// --- Sifre ozeti -----------------------------------------------------------

function scryptSozu(sifre, tuz) {
  return new Promise((coz, reddet) => {
    crypto.scrypt(sifre, tuz, SCRYPT_UZUNLUK, SCRYPT_AYAR, (hata, anahtar) => {
      if (hata) reddet(hata);
      else coz(anahtar.toString('hex'));
    });
  });
}

/** Yeni sifre icin tuz + ozet uretir. */
async function sifreOzetle(sifre) {
  const tuz = crypto.randomBytes(24).toString('hex');
  const ozet = await scryptSozu(sifre, tuz);
  return { tuz, ozet };
}

/**
 * Sifreyi dogrular. Karsilastirma SABIT SUREDE yapilir
 * (timingSafeEqual) - boylece sifre harf harf tahmin edilemez.
 */
async function sifreDogru(sifre, tuz, beklenenOzet) {
  const ozet = await scryptSozu(sifre, tuz);
  const a = Buffer.from(ozet, 'hex');
  const b = Buffer.from(beklenenOzet, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// --- Kaba kuvvet koruması (bellekte) ---------------------------------------
//  Sunucu yeniden baslarsa sifirlanir; kabul edilebilir bir odun.

const hatalar = new Map(); // ip -> {sayi, ilkDeneme, kilitBitis}

function kilitliMi(ip) {
  const kayit = hatalar.get(ip);
  if (!kayit || !kayit.kilitBitis) return 0;
  const kalan = kayit.kilitBitis - Date.now();
  if (kalan <= 0) {
    hatalar.delete(ip);
    return 0;
  }
  return Math.ceil(kalan / 1000); // kalan saniye
}

function hataEkle(ip) {
  const kayit = hatalar.get(ip) || { sayi: 0, ilkDeneme: Date.now() };
  kayit.sayi += 1;
  if (kayit.sayi >= AZAMI_HATA) {
    kayit.kilitBitis = Date.now() + KILIT_SURESI_MS;
    kayit.sayi = 0; // kilit bitince sifirdan sayilsin
  }
  hatalar.set(ip, kayit);
  return kayit;
}

function hatalariTemizle(ip) {
  hatalar.delete(ip);
}

// --- Kayit sikligi (bellekte) ----------------------------------------------
//  Gecerli bir davet kodu ele gecse bile ayni yerden seri hesap acilmasin.
//  Kaba kuvvet sayacindan AYRI tutuluyor: biri hatali denemeyi, digeri
//  BASARILI kaydi sayiyor.

const kayitlar = new Map(); // ip -> {sayi, pencereBitis}

/** Bu IP bir hesap daha acabilir mi? */
function kayitHakkiVarMi(ip) {
  const kayit = kayitlar.get(ip);
  if (!kayit || Date.now() > kayit.pencereBitis) return true;
  return kayit.sayi < KAYIT_SAATLIK_AZAMI;
}

function kayitSay(ip) {
  const kayit = kayitlar.get(ip);
  if (!kayit || Date.now() > kayit.pencereBitis) {
    kayitlar.set(ip, { sayi: 1, pencereBitis: Date.now() + 60 * 60 * 1000 });
    return;
  }
  kayit.sayi += 1;
}

// --- Davet (referans) kodu -------------------------------------------------

// Alfabe dogrula.js'te (tek kaynak; kodu ureten de okuyan da ayni diziyi
// kullansin). Uzunlugu TAM 32 olmali: 256 % 32 == 0 oldugu icin `bayt % 32`
// her karakteri ESIT olasilikla secer. 32'den farkli bir uzunlukta bazi
// karakterler digerlerinden sik cikar ve kod tahmin edilebilirlesir.
const { DAVET_ALFABE, DAVET_ON_EK, DAVET_GOVDE_UZUNLUK } = require('./dogrula');

/** Ornek: DEPO-7K4M-92XQ  (8 karakter x 32 secenek = 40 bit) */
function davetKoduUret() {
  const bayt = crypto.randomBytes(DAVET_GOVDE_UZUNLUK);
  let harfler = '';
  for (const b of bayt) harfler += DAVET_ALFABE[b % DAVET_ALFABE.length];
  return DAVET_ON_EK + '-' + harfler.slice(0, 4) + '-' + harfler.slice(4);
}

/** Kodun son kullanma tarihi (uretim ani + DAVET_GECERLILIK_GUN). */
function davetSonKullanma() {
  return new Date(Date.now() + DAVET_GECERLILIK_GUN * 24 * 60 * 60 * 1000);
}

// --- Oturum ----------------------------------------------------------------

async function oturumAc(ip, kullaniciId) {
  const jeton = crypto.randomBytes(36).toString('base64url'); // 48 karakter
  await sorgu(
    'insert into oturumlar (jeton, ip, kullanici_id) values ($1, $2, $3)',
    [jeton, String(ip || '').slice(0, 64), kullaniciId ?? null]
  );
  return jeton;
}

/**
 * Oturum gecerliyse KIMIN oturumu oldugunu dondurur, degilse null.
 *
 * Eskiden true/false donuyordu; birden fazla hesap olunca "kim girdi"
 * bilgisi gerekli oldu (sifre degistirme kendi hesabini degistirmeli).
 * Cagiran taraf `!== null` diye bakiyor.
 *
 * @returns {Promise<{kullaniciId: number}|null>}
 */
async function oturumGecerliMi(jeton) {
  if (!jeton) return null;
  const { rows } = await sorgu(
    'select olusturuldu, kullanici_id from oturumlar where jeton = $1',
    [jeton]
  );
  if (rows.length === 0) return null;

  const yas = Date.now() - new Date(rows[0].olusturuldu).getTime();
  if (yas > OTURUM_SURESI_MS) {
    await oturumKapat(jeton);
    return null;
  }

  // Son gorulme zamanini guncelle (istatistik icin, sureyi uzatmaz)
  await sorgu('update oturumlar set son_gorulme = now() where jeton = $1', [jeton]);

  // kullanici_id null olabilir: cok kullanici gelmeden ONCE acilmis oturumlar.
  //
  // 31 Tem 2026'ya kadar bunlar gecerli sayiliyordu (kimse disari atilmasin
  // diye). Artik HER KAYIT bir hesaba ait: sahibi belirsiz bir oturuma hangi
  // veriyi gosterecegimizi bilemeyiz. Oturum kapatilir, yeniden giris istenir.
  if (rows[0].kullanici_id == null) {
    await oturumKapat(jeton);
    return null;
  }

  return { kullaniciId: rows[0].kullanici_id };
}

async function oturumKapat(jeton) {
  if (!jeton) return;
  await sorgu('delete from oturumlar where jeton = $1', [jeton]);
}

/** Suresi gecmis oturumlari siler. Sunucu acilisinda ve saatte bir calisir. */
async function eskiOturumlariSil() {
  const { rowCount } = await sorgu(
    "delete from oturumlar where olusturuldu < now() - interval '12 hours'"
  );
  return rowCount;
}

// --- Cerez ----------------------------------------------------------------

function cerezOku(cerezBasligi, ad) {
  if (!cerezBasligi) return null;
  for (const parca of cerezBasligi.split(';')) {
    const esittir = parca.indexOf('=');
    if (esittir === -1) continue;
    if (parca.slice(0, esittir).trim() === ad) {
      return decodeURIComponent(parca.slice(esittir + 1).trim());
    }
  }
  return null;
}

/**
 * @param {boolean} guvenli  HTTPS uzerindeysek true -> Secure isareti eklenir
 */
function cerezKur(jeton, guvenli) {
  const parcalar = [
    CEREZ_ADI + '=' + encodeURIComponent(jeton),
    'Path=/',
    'HttpOnly', // JavaScript okuyamaz -> XSS ile jeton calinamaz
    'SameSite=Lax', // baska siteden gelen isteklerde gonderilmez
    'Max-Age=' + Math.floor(OTURUM_SURESI_MS / 1000),
  ];
  if (guvenli) parcalar.push('Secure');
  return parcalar.join('; ');
}

function cerezSil(guvenli) {
  const parcalar = [CEREZ_ADI + '=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (guvenli) parcalar.push('Secure');
  return parcalar.join('; ');
}

module.exports = {
  CEREZ_ADI,
  AZAMI_HATA,
  OTURUM_SURESI_MS,
  DAVET_GECERLILIK_GUN,
  KAYIT_SAATLIK_AZAMI,
  sifreOzetle,
  sifreDogru,
  kilitliMi,
  hataEkle,
  hatalariTemizle,
  kayitHakkiVarMi,
  kayitSay,
  davetKoduUret,
  davetSonKullanma,
  oturumAc,
  oturumGecerliMi,
  oturumKapat,
  eskiOturumlariSil,
  cerezOku,
  cerezKur,
  cerezSil,
};
