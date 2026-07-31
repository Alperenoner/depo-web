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

// Sifre sifirlama kodu - davetten cok daha kisa omurlu
const SIFIRLAMA_GECERLILIK_SAAT = 24;

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

// --- Kaba kuvvet koruması (VERITABANINDA) ----------------------------------
//
//  31 Tem 2026'ya kadar bellekteki bir Map'ti ve "sunucu yeniden baslarsa
//  sifirlanir, kabul edilebilir bir odun" diye yazilmisti. Kayit ucu disari
//  acilinca odun kabul edilemez hale geldi:
//
//  Render ucretsiz katmani 15 dakika trafik almazsa UYUYOR. Yani sayac
//  neredeyse her saat sifirlaniyordu - koruma var saniliyordu ama barindirma
//  bicimi onu surekli siliyordu. Artik `ip_sayaclari` tablosunda.
//
//  Iki tur var:
//    'giris' -> HATALI deneme sayilir, esigi asinca kilit
//    'kayit' -> BASARILI kayit sayilir, saatlik tavan
//
//  Sayac tutmak ugruna giris akisini bozmuyoruz: bu fonksiyonlar hata
//  firlatirsa cagiran taraf akisi surdurur (bkz. server.js). Veritabani
//  gecici olarak cevap vermiyorsa kimse kapida kalmasin.

const TUR_GIRIS = 'giris';
const TUR_KAYIT = 'kayit';

/** Kilit sürüyorsa kalan saniye, degilse 0. */
async function kilitliMi(ip) {
  const { rows } = await sorgu(
    'select kilit_bitis from ip_sayaclari where ip = $1 and tur = $2',
    [ip, TUR_GIRIS]
  );
  if (rows.length === 0 || !rows[0].kilit_bitis) return 0;
  const kalan = new Date(rows[0].kilit_bitis).getTime() - Date.now();
  return kalan > 0 ? Math.ceil(kalan / 1000) : 0;
}

/**
 * Hatali denemeyi isler. Esik asilirsa kilidi kurar.
 * @returns {Promise<{sayi:number, kilitBitis:Date|null}>}
 */
async function hataEkle(ip) {
  // Tek cumlede oku-artir-yaz: iki istek ayni anda gelirse sayaç kaybolmasin.
  // Kilit suresi gecmisse sayaç sifirdan baslar (`case` icindeki kontrol).
  const { rows } = await sorgu(
    `insert into ip_sayaclari (ip, tur, sayi, guncellendi)
     values ($1, $2, 1, now())
     on conflict (ip, tur) do update set
       sayi = case
                when ip_sayaclari.kilit_bitis is not null
                 and ip_sayaclari.kilit_bitis < now() then 1
                else ip_sayaclari.sayi + 1
              end,
       kilit_bitis = case
                       when ip_sayaclari.kilit_bitis is not null
                        and ip_sayaclari.kilit_bitis < now() then null
                       else ip_sayaclari.kilit_bitis
                     end,
       guncellendi = now()
     returning sayi`,
    [ip, TUR_GIRIS]
  );

  const sayi = rows[0].sayi;
  if (sayi < AZAMI_HATA) return { sayi, kilitBitis: null };

  // Esik doldu: kilidi kur ve sayaci sifirla (kilit bitince sifirdan saysin)
  const bitis = new Date(Date.now() + KILIT_SURESI_MS);
  await sorgu(
    `update ip_sayaclari set sayi = 0, kilit_bitis = $3, guncellendi = now()
      where ip = $1 and tur = $2`,
    [ip, TUR_GIRIS, bitis]
  );
  return { sayi, kilitBitis: bitis };
}

/** Basarili giristen sonra sayaci temizler. */
async function hatalariTemizle(ip) {
  await sorgu('delete from ip_sayaclari where ip = $1 and tur = $2', [ip, TUR_GIRIS]);
}

// --- Kayit sikligi ---------------------------------------------------------
//  Gecerli bir davet kodu ele gecse bile ayni yerden seri hesap acilmasin.
//  Kaba kuvvet sayacindan AYRI: biri hatali denemeyi, digeri BASARILI kaydi
//  sayiyor.

/** Bu IP bir hesap daha acabilir mi? */
async function kayitHakkiVarMi(ip) {
  const { rows } = await sorgu(
    'select sayi, pencere_bitis from ip_sayaclari where ip = $1 and tur = $2',
    [ip, TUR_KAYIT]
  );
  if (rows.length === 0) return true;
  const bitis = rows[0].pencere_bitis;
  if (!bitis || new Date(bitis).getTime() < Date.now()) return true; // pencere kapandi
  return rows[0].sayi < KAYIT_SAATLIK_AZAMI;
}

/** Basarili kaydi sayar (saatlik pencere). */
async function kayitSay(ip) {
  await sorgu(
    `insert into ip_sayaclari (ip, tur, sayi, pencere_bitis, guncellendi)
     values ($1, $2, 1, now() + interval '1 hour', now())
     on conflict (ip, tur) do update set
       sayi = case
                when ip_sayaclari.pencere_bitis is null
                  or ip_sayaclari.pencere_bitis < now() then 1
                else ip_sayaclari.sayi + 1
              end,
       pencere_bitis = case
                         when ip_sayaclari.pencere_bitis is null
                           or ip_sayaclari.pencere_bitis < now()
                         then now() + interval '1 hour'
                         else ip_sayaclari.pencere_bitis
                       end,
       guncellendi = now()`,
    [ip, TUR_KAYIT]
  );
}

/** Isi bitmis sayac satirlarini siler. Oturum temizligiyle ayni saatte calisir. */
async function eskiSayaclariSil() {
  const { rowCount } = await sorgu(
    `delete from ip_sayaclari
      where guncellendi < now() - interval '1 day'
        and (kilit_bitis   is null or kilit_bitis   < now())
        and (pencere_bitis is null or pencere_bitis < now())`
  );
  return rowCount;
}

// --- Davet (referans) kodu -------------------------------------------------

// Alfabe dogrula.js'te (tek kaynak; kodu ureten de okuyan da ayni diziyi
// kullansin). Uzunlugu TAM 32 olmali: 256 % 32 == 0 oldugu icin `bayt % 32`
// her karakteri ESIT olasilikla secer. 32'den farkli bir uzunlukta bazi
// karakterler digerlerinden sik cikar ve kod tahmin edilebilirlesir.
const {
  DAVET_ALFABE, DAVET_ON_EK, SIFIRLAMA_ON_EK, DAVET_GOVDE_UZUNLUK,
} = require('./dogrula');

/** Ornek: DEPO-7K4M-92XQ  (8 karakter x 32 secenek = 40 bit) */
function koduUret(onEk) {
  const bayt = crypto.randomBytes(DAVET_GOVDE_UZUNLUK);
  let harfler = '';
  for (const b of bayt) harfler += DAVET_ALFABE[b % DAVET_ALFABE.length];
  return onEk + '-' + harfler.slice(0, 4) + '-' + harfler.slice(4);
}

/** Hesap acan referans numarasi. */
function davetKoduUret() {
  return koduUret(DAVET_ON_EK);
}

/** Var olan hesabin sifresini degistiren kod - AYRI on ek, karismasin. */
function sifirlamaKoduUret() {
  return koduUret(SIFIRLAMA_ON_EK);
}

/** Davet kodunun son kullanma tarihi (uretim ani + DAVET_GECERLILIK_GUN). */
function davetSonKullanma() {
  return new Date(Date.now() + DAVET_GECERLILIK_GUN * 24 * 60 * 60 * 1000);
}

/**
 * Sifirlama kodunun son kullanma tarihi.
 * Davetten cok daha kisa: davet "bir ara hesap ac" demek, sifirlama ise
 * su an yasanan bir sorunu cozuyor - elde uzun sure beklememeli.
 */
function sifirlamaSonKullanma() {
  return new Date(Date.now() + SIFIRLAMA_GECERLILIK_SAAT * 60 * 60 * 1000);
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
  SIFIRLAMA_GECERLILIK_SAAT,
  KAYIT_SAATLIK_AZAMI,
  sifreOzetle,
  sifreDogru,
  kilitliMi,
  hataEkle,
  hatalariTemizle,
  kayitHakkiVarMi,
  kayitSay,
  eskiSayaclariSil,
  davetKoduUret,
  sifirlamaKoduUret,
  davetSonKullanma,
  sifirlamaSonKullanma,
  oturumAc,
  oturumGecerliMi,
  oturumKapat,
  eskiOturumlariSil,
  cerezOku,
  cerezKur,
  cerezSil,
};
