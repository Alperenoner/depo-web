// ============================================================================
//  GIRDI DOGRULAMA
//  Gelen verinin HICBIRINE guvenilmez:
//    - her sayi alt/ust sinira kirpilir
//    - her metin kisaltilir
//    - renk #rrggbb kalibina uymuyorsa varsayilana cevrilir
//  Bu dosya asla hata ATMAZ; her zaman guvenli bir deger dondurur.
//  (Zorunlu alan eksikse cagiran taraf kontrol eder.)
// ============================================================================

'use strict';

// --- Sinirlar ---------------------------------------------------------------

const SINIR = {
  // Arac ic olculeri (mm) - 40 metreye kadar izin veriyoruz, fazlasi anlamsiz
  aracUzunluk: [1, 40000],
  aracGenislik: [1, 6000],
  aracYukseklik: [1, 6000],
  aracAgirlik: [0, 200000], // kg

  // Kutu olculeri (mm)
  kutuKenar: [1, 40000],
  kutuAgirlik: [0, 100000], // kg
  maksIstif: [0, 500],

  pay: [0, 500], // kutular arasi pay (mm)

  metinKisa: 80, // ad, grup, kullanici
  metinUzun: 500, // icerik, aciklama

  katalogAzami: 300, // en fazla kac kutu cesidi
  planAzami: 200, // en fazla kac kayitli plan
  kalemAzami: 60, // bir planda en fazla kac kalem
  govdeAzami: 2 * 1024 * 1024, // 2 MB
};

const RENK_KALIBI = /^#[0-9a-fA-F]{6}$/;
const VARSAYILAN_RENK = '#868e96';

// Gecerli strateji id'leri MOTORDAN turetilir, burada elle yazilmaz.
//
// Onceki hali elle yazilmis bir listeydi ('akilli','adet','boyuna','enine',
// 'dik') ve FAZ 3a'da strateji sayisi 5'ten 3'e dusurulunce ayristi: kullanici
// 'optimum' secip plan kaydetse sunucu bunu sessizce 'akilli'ye cevirip
// kaydediyordu, plan geri yuklenince dizilis degisiyordu. Sessiz veri kaybi.
//
// Motoru buraya bagliyoruz cunku motor zaten tek kaynak: tarayici da ayni
// dosyayi /yerlesim.js olarak aliyor (bkz. server.js MOTOR_DOSYALARI).
const STRATEJI_IDLERI = require('../motor/yerlesim').STRATEJILER.map((s) => s.id);

// Bilinmeyen strateji gelirse dusulecek deger - arayuzun varsayilaniyla ayni
const VARSAYILAN_STRATEJI = STRATEJI_IDLERI.includes('optimum')
  ? 'optimum'
  : STRATEJI_IDLERI[0];

// Kutu FORMAT secenekleri. TEK KAYNAK burasi: arayuzun acilir listesi bu
// diziden uretiliyor (panoVerisi -> formatlar), elle yazilmiyor. Strateji
// listesindeki ayrisma hatasi (yukarida) burada tekrarlanmasin diye.
//
// Bos deger de gecerli: format girmek zorunlu degil.
const FORMATLAR = ['KSRCSSLI_v2', 'KSDSPSSL_v2', 'KSBOSSTD_v2'];

/** Format listede yoksa bos donen surum - sunucu tarayiciya guvenmez. */
function format(deger) {
  const m = metin(deger, SINIR.metinKisa);
  return FORMATLAR.includes(m) ? m : '';
}

// --- Temel cevirmenler -----------------------------------------------------

/** Sayiyi tam sayiya cevirip [alt, ust] arasina kirpar. Gecersizse null. */
function tamSayi(deger, [alt, ust]) {
  const n = Number(deger);
  if (!Number.isFinite(n)) return null;
  return Math.min(ust, Math.max(alt, Math.round(n)));
}

/** Ondalikli sayi (agirlik icin). Gecersizse null. */
function ondalik(deger, [alt, ust], basamak = 4) {
  const n = Number(deger);
  if (!Number.isFinite(n)) return null;
  const kirpilmis = Math.min(ust, Math.max(alt, n));
  return Number(kirpilmis.toFixed(basamak));
}

/** Metni temizler ve kisaltir. */
function metin(deger, azami) {
  if (deger === null || deger === undefined) return '';
  return String(deger)
    // Kontrol karakterlerini (satir sonu, sekme, gorunmez isaretler) at
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ") // birden fazla boslugu teke indir
    .trim()
    .slice(0, azami);
}

function renk(deger) {
  const m = metin(deger, 7);
  return RENK_KALIBI.test(m) ? m.toLowerCase() : VARSAYILAN_RENK;
}

function mantik(deger, varsayilan) {
  if (deger === true || deger === 'true' || deger === 1 || deger === '1') return true;
  if (deger === false || deger === 'false' || deger === 0 || deger === '0') return false;
  return varsayilan;
}

/** Kimlik (id) uretir: slug + rastgele son ek. */
function kimlikUret(onEk, ad) {
  const slug = metin(ad, 30)
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const son = Math.random().toString(36).slice(2, 8);
  return (onEk + '-' + (slug || 'kayit') + '-' + son).slice(0, 60);
}

/** Gelen id'yi temizler (yalnizca guvenli karakterler). Gecersizse null. */
function kimlik(deger) {
  const m = metin(deger, 60).toLowerCase();
  return /^[a-z0-9._-]+$/.test(m) ? m : null;
}

// --- Nesne dogrulayicilar --------------------------------------------------

/**
 * Arac. Zorunlu alanlar eksik/gecersizse {hata} doner.
 * HAZIR OLCU YOKTUR - butun degerler kullanicidan gelir.
 */
function arac(gelen) {
  const g = gelen || {};

  const ad = metin(g.ad, SINIR.metinKisa);
  const uzunluk = tamSayi(g.uzunluk, SINIR.aracUzunluk);
  const genislik = tamSayi(g.genislik, SINIR.aracGenislik);
  const yukseklik = tamSayi(g.yukseklik, SINIR.aracYukseklik);
  const maksAgirlik = tamSayi(g.maksAgirlik, SINIR.aracAgirlik);

  const eksik = [];
  if (!ad) eksik.push('ad');
  if (uzunluk === null) eksik.push('uzunluk');
  if (genislik === null) eksik.push('genislik');
  if (yukseklik === null) eksik.push('yukseklik');
  if (maksAgirlik === null) eksik.push('maksAgirlik');

  if (eksik.length) {
    return { hata: 'Şu alanlar eksik veya geçersiz: ' + eksik.join(', ') };
  }

  return {
    deger: {
      id: kimlik(g.id) || kimlikUret('arac', ad),
      ad,
      uzunluk,
      genislik,
      yukseklik,
      maksAgirlik,
      sablon: mantik(g.sablon, false),
    },
  };
}

/** Kutu. HAZIR OLCU YOKTUR. */
function kutu(gelen) {
  const g = gelen || {};

  const ad = metin(g.ad, SINIR.metinKisa);
  const uzunluk = tamSayi(g.uzunluk, SINIR.kutuKenar);
  const genislik = tamSayi(g.genislik, SINIR.kutuKenar);
  const yukseklik = tamSayi(g.yukseklik, SINIR.kutuKenar);
  const agirlik = ondalik(g.agirlik, SINIR.kutuAgirlik);

  const eksik = [];
  if (!ad) eksik.push('ad');
  if (uzunluk === null) eksik.push('uzunluk');
  if (genislik === null) eksik.push('genislik');
  if (yukseklik === null) eksik.push('yukseklik');
  if (agirlik === null) eksik.push('agirlik');

  if (eksik.length) {
    return { hata: 'Şu alanlar eksik veya geçersiz: ' + eksik.join(', ') };
  }

  return {
    deger: {
      id: kimlik(g.id) || kimlikUret('kutu', ad),
      ad,
      grup: metin(g.grup, SINIR.metinKisa),
      uzunluk,
      genislik,
      yukseklik,
      agirlik,
      renk: renk(g.renk),
      yatirilabilir: mantik(g.yatirilabilir, true),
      maksIstif: tamSayi(g.maksIstif, SINIR.maksIstif) ?? 0,
      icerik: metin(g.icerik, SINIR.metinUzun),
      aciklama: metin(g.aciklama ?? g.not, SINIR.metinUzun),
      // Material serbest metin, format ise sabit listeden (bkz. FORMATLAR).
      // Ikisi de ZORUNLU DEGIL - bos gecilebilir.
      material: metin(g.material, SINIR.metinKisa),
      format: format(g.format),
    },
  };
}

/** Plan TARIFI (sonuc degil). */
function plan(gelen) {
  const g = gelen || {};

  const ad = metin(g.ad, SINIR.metinKisa);
  if (!ad) return { hata: 'Plan adı boş olamaz.' };

  const aracSonuc = arac(g.arac);
  if (aracSonuc.hata) return { hata: 'Araç ölçüleri geçersiz: ' + aracSonuc.hata };

  const gelenKalemler = Array.isArray(g.kalemler) ? g.kalemler : [];
  const kalemler = [];
  for (const k of gelenKalemler.slice(0, SINIR.kalemAzami)) {
    const kid = kimlik(k && k.kutuId);
    if (!kid) continue;
    const maks = mantik(k.maks, false);
    const adet = tamSayi(k.adet, [0, 100000000]) ?? 0;
    if (!maks && adet === 0) continue; // ne adet ne sonsuz -> anlamsiz
    kalemler.push({ kutuId: kid, adet, maks });
  }
  if (kalemler.length === 0) return { hata: 'Planda en az bir yük kalemi olmalı.' };

  const strateji = STRATEJI_IDLERI.includes(g.strateji)
    ? g.strateji
    : VARSAYILAN_STRATEJI;

  const ayarlar = {
    pay: tamSayi((g.ayarlar || {}).pay, SINIR.pay) ?? 0,
    agirlikSiniri: mantik((g.ayarlar || {}).agirlikSiniri, true),
  };

  // ozet sadece listede gostermek icin; sayilari kirpiyoruz
  const gelenOzet = g.ozet || {};
  const ozet = {
    adet: tamSayi(gelenOzet.adet, [0, 1e12]) ?? 0,
    doluluk: ondalik(gelenOzet.doluluk, [0, 100], 2) ?? 0,
    agirlik: ondalik(gelenOzet.agirlik, [0, 1e9], 2) ?? 0,
  };

  return {
    deger: {
      id: kimlik(g.id) || kimlikUret('plan', ad),
      ad,
      arac: aracSonuc.deger,
      strateji,
      kalemler,
      ayarlar,
      ozet,
      aciklama: metin(g.aciklama ?? g.not, SINIR.metinUzun),
    },
  };
}

function ayarlar(gelen) {
  const g = gelen || {};
  return {
    deger: {
      baslik: metin(g.baslik, SINIR.metinKisa) || 'DEPOLAMA',
      altBaslik: metin(g.altBaslik, SINIR.metinKisa) || 'Tır Yükleme Planlayıcı',
    },
  };
}

/** Sifre degistirme istegi. */
function sifreDegistir(gelen) {
  const g = gelen || {};
  const eski = String(g.eski ?? '');
  const yeni = String(g.yeni ?? '');
  const yeniTekrar = String(g.yeniTekrar ?? g.yeni2 ?? '');
  const kullanici = metin(g.kullanici, SINIR.metinKisa);

  if (!eski) return { hata: 'Mevcut şifreyi girmelisin.' };
  if (yeni.length < 6) return { hata: 'Yeni şifre en az 6 karakter olmalı.' };
  if (yeni !== yeniTekrar) return { hata: 'Yeni şifreler birbirini tutmuyor.' };
  if (yeni === eski) return { hata: 'Yeni şifre eskisiyle aynı olamaz.' };
  if (kullanici && !/^[\wğüşıöçĞÜŞİÖÇ.@-]{3,}$/.test(kullanici)) {
    return { hata: 'Kullanıcı adı en az 3 karakter ve geçerli olmalı.' };
  }

  return { deger: { eski, yeni, kullanici } };
}

module.exports = {
  SINIR,
  VARSAYILAN_RENK,
  STRATEJI_IDLERI,
  VARSAYILAN_STRATEJI,
  FORMATLAR,
  tamSayi,
  ondalik,
  metin,
  renk,
  format,
  mantik,
  kimlik,
  kimlikUret,
  arac,
  kutu,
  plan,
  ayarlar,
  sifreDegistir,
};
