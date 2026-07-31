// ============================================================================
//  SUNUCU
//  Node'un YERLESIK http modulu - Express yok, tek bagimlilik pg.
//
//  Iki isi var:
//    1. public/ klasorundeki dosyalari servis etmek
//    2. /api/* uclarini karsilamak
//
//  Butun HESAP TARAYICIDA yapilir; sunucu sadece veri saklar. Bu yuzden
//  olcu degistirdiginde sunucuya hic gidilmez ve arayuz aninda cevap verir.
//
//  ONEMLI: SITENIN TAMAMI GIRIS ARKASINDADIR. Adresi bilen bile giris
//  yapmadan hicbir sey goremez.
// ============================================================================

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const { havuz } = require('./veritabani/baglanti');
const guvenlik = require('./guvenlik');
const dogrula = require('./dogrula');
const veri = require('./veri');

const PORT = Number(process.env.PORT) || 5180;
const PUBLIC = path.join(__dirname, '..', 'public');
const MOTOR = path.join(__dirname, '..', 'motor');

// Motor dosyalari public/ disinda durur (Node testleri de ayni dosyayi kullanir).
// Kopyalamak yerine buradan servis ediyoruz - tek kaynak, ayrisma riski yok.
// Kullanici adi bulunamayinca sifre karsilastirmasinin YINE DE yapilmasi
// icin sabit bir sahte kayit. Amac cevap suresini esitlemek: atlanirsa
// "bu kullanici adi yok" bilgisi olcum yoluyla sizar.
// Rastgele uretilmis, hicbir sifrenin ozeti degil - eslesmesi imkansiz.
const SAHTE_TUZ = 'a3f1c9d2e5b74806a1c3d5e7f9081a2b';
const SAHTE_OZET = '3b'.repeat(64); // 64 bayt = 128 hex, gercek ozetle ayni uzunluk

const MOTOR_DOSYALARI = new Map([['/yerlesim.js', path.join(MOTOR, 'yerlesim.js')]]);

// Giris yapmadan erisilebilecek YOLLAR (baska hicbir sey acik degil)
const ACIK_YOLLAR = new Set([
  '/giris',
  '/giris.html',
  '/giris.css',
  '/giris.js',
  // Kayit sayfasi da acik olmak ZORUNDA: hesabi olmayan kisi buraya
  // gelecek. Kapiyi tutan sey giris degil, DAVET KODU.
  '/kayit',
  '/kayit.html',
  '/kayit.js',
  '/api/durum',
  '/api/giris',
  '/api/kayit',
  '/api/cikis',
]);

const ICERIK_TURLERI = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

// ---------------------------------------------------------------------------
//  Yardimcilar
// ---------------------------------------------------------------------------

function istekIp(istek) {
  // Railway / Cloudflare arkasinda gercek IP bu baslikta gelir
  const iletilen = istek.headers['x-forwarded-for'];
  if (iletilen) return String(iletilen).split(',')[0].trim();
  return istek.socket.remoteAddress || '';
}

/** HTTPS uzerinden mi geliyor? (Secure cerez isareti icin) */
function guvenliMi(istek) {
  if (istek.headers['x-forwarded-proto'] === 'https') return true;
  return Boolean(istek.socket.encrypted);
}

// HSTS (tarayiciya "bu siteye artik hep https ile gel" demek) yalnizca
// URETIM ortaminda gonderilir. Karar ISTEK BASINA degil ORTAM basina:
//
// Localhost'ta http ile calisiyoruz ve tarayici bir kez HSTS gorurse o ana
// bilgisayar adi icin http'yi KALICI olarak reddediyor - localhost'a HSTS
// gondermek gelistirmeyi kilitler, geri almak da zor (chrome://net-internals).
//
// Render ortama RENDER degiskenini kendisi koyuyor; elle acmak icin HSTS=1.
const HSTS = process.env.HSTS === '1' || Boolean(process.env.RENDER);

function guvenlikBasliklari(ekstra) {
  const basliklar = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  };
  if (HSTS) basliklar['Strict-Transport-Security'] = 'max-age=15552000'; // 180 gun
  return Object.assign(basliklar, ekstra || {});
}

function jsonYaz(cevap, kod, govde, ekBasliklar) {
  const metin = JSON.stringify(govde);
  cevap.writeHead(
    kod,
    guvenlikBasliklari(
      Object.assign(
        {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(metin),
          'Cache-Control': 'no-store',
        },
        ekBasliklar || {}
      )
    )
  );
  cevap.end(metin);
}

function hataYaz(cevap, kod, mesaj) {
  jsonYaz(cevap, kod, { hata: mesaj });
}

/** Istek govdesini JSON olarak okur. 2 MB'i gecerse reddeder. */
function govdeOku(istek) {
  return new Promise((coz, reddet) => {
    let boyut = 0;
    const parcalar = [];

    istek.on('data', (parca) => {
      boyut += parca.length;
      if (boyut > dogrula.SINIR.govdeAzami) {
        reddet(Object.assign(new Error('İstek gövdesi çok büyük.'), { kod: 413 }));
        istek.destroy();
        return;
      }
      parcalar.push(parca);
    });

    istek.on('end', () => {
      if (parcalar.length === 0) return coz({});
      try {
        coz(JSON.parse(Buffer.concat(parcalar).toString('utf8')));
      } catch (e) {
        reddet(Object.assign(new Error('Geçersiz JSON.'), { kod: 400 }));
      }
    });

    istek.on('error', reddet);
  });
}

// ---------------------------------------------------------------------------
//  Statik dosya servisi
//  Dizin disina cikma (/../server.js) engellenir.
// ---------------------------------------------------------------------------

async function statikSun(cevap, istenenYol) {
  // 1) URL'yi coz, sorgu dizesini at
  let temiz;
  try {
    temiz = decodeURIComponent(istenenYol.split('?')[0]);
  } catch (e) {
    return hataYaz(cevap, 400, 'Geçersiz adres.');
  }

  if (temiz === '/') temiz = '/index.html';

  let tamYol;

  if (MOTOR_DOSYALARI.has(temiz)) {
    // Motor dosyasi - sabit listede, kullanici girdisi yolu belirlemiyor
    tamYol = MOTOR_DOSYALARI.get(temiz);
  } else {
    // 2) DIZIN DISINA CIKMA KORUMASI
    //    path.join ile birlestirip sonucun hala PUBLIC icinde oldugunu dogrula.
    tamYol = path.join(PUBLIC, temiz);
    const kok = PUBLIC + path.sep;
    if (tamYol !== PUBLIC && !tamYol.startsWith(kok)) {
      return hataYaz(cevap, 403, 'Erişim yok.');
    }
  }

  let bilgi;
  try {
    bilgi = await fs.promises.stat(tamYol);
  } catch (e) {
    return hataYaz(cevap, 404, 'Dosya bulunamadı.');
  }
  if (!bilgi.isFile()) return hataYaz(cevap, 404, 'Dosya bulunamadı.');

  const uzanti = path.extname(tamYol).toLowerCase();
  const tur = ICERIK_TURLERI[uzanti] || 'application/octet-stream';

  // Onbellek: KENDI dosyalarimiz (html/css/js) hic onbelleklenmez.
  // Yoksa arayuzu degistirdikten sonra tarayici eski dosyayi calistirmaya
  // devam ediyor ve "az once vardi, simdi yok" gibi hayalet hatalar cikiyor.
  // vendor/ altindaki kutuphaneler degismedigi icin uzun sure onbelleklenir
  // (three.min.js 589 KB - her aciliste yeniden indirmek anlamsiz).
  const vendorMi = tamYol.includes(path.sep + 'vendor' + path.sep);
  const onbellek = vendorMi
    ? 'public, max-age=31536000, immutable'
    : 'no-store';

  cevap.writeHead(
    200,
    guvenlikBasliklari({
      'Content-Type': tur,
      'Content-Length': bilgi.size,
      'Cache-Control': onbellek,
    })
  );
  fs.createReadStream(tamYol).pipe(cevap);
}

// ---------------------------------------------------------------------------
//  API
// ---------------------------------------------------------------------------

async function apiIsle(istek, cevap, yol, girisli, oturum) {
  const yontem = istek.method;

  // ---- ACIK UCLAR -------------------------------------------------------

  if (yol === '/api/durum' && yontem === 'GET') {
    return jsonYaz(cevap, 200, { girisli });
  }

  if (yol === '/api/giris' && yontem === 'POST') {
    const ip = istekIp(istek);

    const kalanKilit = guvenlik.kilitliMi(ip);
    if (kalanKilit > 0) {
      return jsonYaz(cevap, 429, {
        hata:
          'Çok fazla hatalı deneme. ' +
          Math.ceil(kalanKilit / 60) +
          ' dakika sonra tekrar dene.',
        kalanSaniye: kalanKilit,
      });
    }

    const govde = await govdeOku(istek);
    const kullanici = dogrula.metin(govde.kullanici, 80);
    const sifre = String(govde.sifre ?? '');

    const hesap = await veri.yoneticiOku(kullanici);

    // Kullanici BULUNAMASA DA sifre hesabi yapilir: scrypt pahali bir islem,
    // atlanirsa cevap gozle gorulur sekilde hizlanir ve "bu kullanici adi
    // var mi" bilgisi sizar. Bulunamayinca sahte tuz/ozet ile ayni is yapilir.
    const sifreOk = hesap
      ? await guvenlik.sifreDogru(sifre, hesap.tuz, hesap.ozet)
      : await guvenlik.sifreDogru(sifre, SAHTE_TUZ, SAHTE_OZET);

    if (!hesap || !sifreOk) {
      const kayit = guvenlik.hataEkle(ip);
      console.warn(
        '[giris] BASARISIZ  ip=' + ip + '  kullanici=' + JSON.stringify(kullanici) +
          (kayit.kilitBitis ? '  -> 10 DAKIKA KILITLENDI' : '')
      );
      return hataYaz(cevap, 401, 'Kullanıcı adı veya şifre hatalı.');
    }

    guvenlik.hatalariTemizle(ip);
    const jeton = await guvenlik.oturumAc(ip, hesap.id);
    console.log('[giris] basarili  ip=' + ip);

    return jsonYaz(cevap, 200, { girisli: true }, {
      'Set-Cookie': guvenlik.cerezKur(jeton, guvenliMi(istek)),
    });
  }

  // KAYIT OLMA - siteye ACIK uc.
  //
  // Kapiyi tutan sey davet (referans) kodu: kod yoksa hesap acilmaz. Kod
  // tek kullanimlik ve sureli, uretmeye yalnizca kurucu yetkili.
  //
  // Iki ayri fren var:
  //   - hatali deneme  -> giris ile ORTAK IP kilidi (8 hata = 10 dakika)
  //   - basarili kayit -> ayni IP'den saatte en fazla KAYIT_SAATLIK_AZAMI
  // Ilki kodu deneme yanilmayla bulmayi, ikincisi eline gecerli bir kod
  // gecen birinin seri hesap acmasini engelliyor.
  if (yol === '/api/kayit' && yontem === 'POST') {
    const ip = istekIp(istek);

    const kalanKilit = guvenlik.kilitliMi(ip);
    if (kalanKilit > 0) {
      return jsonYaz(cevap, 429, {
        hata:
          'Çok fazla hatalı deneme. ' +
          Math.ceil(kalanKilit / 60) +
          ' dakika sonra tekrar dene.',
        kalanSaniye: kalanKilit,
      });
    }

    if (!guvenlik.kayitHakkiVarMi(ip)) {
      return jsonYaz(cevap, 429, {
        hata: 'Bu bağlantıdan çok fazla hesap açıldı. Bir saat sonra tekrar dene.',
      });
    }

    const govde = await govdeOku(istek);
    const sonuc = dogrula.kayit(govde);
    if (sonuc.hata) return hataYaz(cevap, 400, sonuc.hata);

    const { tuz, ozet } = await guvenlik.sifreOzetle(sonuc.deger.sifre);
    const cikti = await veri.kayitOlustur({
      adSoyad: sonuc.deger.adSoyad,
      eposta: sonuc.deger.eposta,
      telefon: sonuc.deger.telefon,
      davetKodu: sonuc.deger.davetKodu,
      tuz,
      ozet,
    });

    if (cikti.hata) {
      if (cikti.hata === 'eposta') {
        return hataYaz(cevap, 409, 'Bu e-posta adresiyle bir hesap zaten var.');
      }
      // Kod hatasi kaba kuvvet sayacina yazilir
      const kayit = guvenlik.hataEkle(ip);
      console.warn(
        '[kayit] BASARISIZ  ip=' + ip + '  sebep=' + cikti.hata +
          (kayit.kilitBitis ? '  -> 10 DAKIKA KILITLENDI' : '')
      );
      return hataYaz(
        cevap,
        400,
        cikti.hata === 'sure'
          ? 'Referans numarasının süresi dolmuş. Yeni numara iste.'
          : 'Referans numarası geçersiz veya daha önce kullanılmış.'
      );
    }

    // Hesap acildi - kullaniciyi dogrudan iceri al, bir de giris yapmasin
    guvenlik.hatalariTemizle(ip);
    guvenlik.kayitSay(ip);
    const jeton = await guvenlik.oturumAc(ip, cikti.hesap.id);
    console.log('[kayit] yeni hesap  id=' + cikti.hesap.id + '  ip=' + ip);

    return jsonYaz(cevap, 200, { girisli: true }, {
      'Set-Cookie': guvenlik.cerezKur(jeton, guvenliMi(istek)),
    });
  }

  if (yol === '/api/cikis' && yontem === 'POST') {
    const jeton = guvenlik.cerezOku(istek.headers.cookie, guvenlik.CEREZ_ADI);
    await guvenlik.oturumKapat(jeton);
    return jsonYaz(cevap, 200, { girisli: false }, {
      'Set-Cookie': guvenlik.cerezSil(guvenliMi(istek)),
    });
  }

  // ---- BURADAN SONRASI GIRIS ISTER --------------------------------------

  if (!girisli) return hataYaz(cevap, 401, 'Giriş gerekli.');

  // Buradan asagisi VERIYE dokunuyor ve her kayit bir hesaba ait (31 Tem
  // 2026). Oturumun kime ait oldugu belirsizse hangi veriyi gosterecegimizi
  // bilemeyiz - yeniden giris istenir. Uygulamada bu oturumlar sema
  // hizalanirken zaten siliniyor, buradaki kontrol son emniyet kemeri.
  const benId = oturum && oturum.kullaniciId != null ? oturum.kullaniciId : null;
  if (benId === null) {
    return hataYaz(cevap, 401, 'Oturum hangi hesaba ait bilinmiyor. Çıkış yapıp tekrar gir.');
  }

  // ---- Veri okuma -------------------------------------------------------

  if (yol === '/api/veri' && yontem === 'GET') {
    const pano = await veri.panoVerisi(benId);
    return jsonYaz(cevap, 200, Object.assign({ girisli: true }, pano));
  }

  // ---- ARAC -------------------------------------------------------------

  if (yol === '/api/arac' && yontem === 'POST') {
    const govde = await govdeOku(istek);
    const sonuc = dogrula.arac(govde);
    if (sonuc.hata) return hataYaz(cevap, 400, sonuc.hata);

    await veri.yedekAl(benId, 'arac kaydet: ' + sonuc.deger.ad);
    // Kaydedilen arac her zaman aktif olur (kullanici onunla plan yapiyor)
    const kayit = await veri.aracKaydet(benId, sonuc.deger, true);
    // null = gonderilen id BASKASININ araci. Var olmayan kayittan ayirmiyoruz:
    // "bu id baskasinda var" bilgisi bile sizmasin.
    if (!kayit) return hataYaz(cevap, 404, 'Araç bulunamadı.');
    return jsonYaz(cevap, 200, { arac: kayit });
  }

  if (yol.startsWith('/api/arac/') && yontem === 'DELETE') {
    const id = dogrula.kimlik(yol.slice('/api/arac/'.length));
    if (!id) return hataYaz(cevap, 400, 'Geçersiz kimlik.');
    await veri.yedekAl(benId, 'arac sil: ' + id);
    const silindi = await veri.aracSil(benId, id);
    if (!silindi) return hataYaz(cevap, 404, 'Araç bulunamadı.');
    return jsonYaz(cevap, 200, { silindi: true });
  }

  if (yol.startsWith('/api/arac-aktif/') && yontem === 'POST') {
    const id = dogrula.kimlik(yol.slice('/api/arac-aktif/'.length));
    if (!id) return hataYaz(cevap, 400, 'Geçersiz kimlik.');
    const oldu = await veri.aracAktifYap(benId, id);
    if (!oldu) return hataYaz(cevap, 404, 'Araç bulunamadı.');
    return jsonYaz(cevap, 200, { aktif: id });
  }

  // ---- KUTU -------------------------------------------------------------

  if (yol === '/api/kutu' && yontem === 'POST') {
    const govde = await govdeOku(istek);
    const sonuc = dogrula.kutu(govde);
    if (sonuc.hata) return hataYaz(cevap, 400, sonuc.hata);

    // Yeni kutu ise katalog sinirini kontrol et
    const yeni = !dogrula.kimlik(govde.id);
    if (yeni) {
      const sayi = await veri.kutuSayisi(benId);
      if (sayi >= dogrula.SINIR.katalogAzami) {
        return hataYaz(
          cevap,
          400,
          'Katalog en fazla ' + dogrula.SINIR.katalogAzami + ' çeşit tutabilir.'
        );
      }
    }

    await veri.yedekAl(benId, 'kutu kaydet: ' + sonuc.deger.ad);
    const kayit = await veri.kutuKaydet(benId, sonuc.deger);
    if (!kayit) return hataYaz(cevap, 404, 'Kutu bulunamadı.');
    return jsonYaz(cevap, 200, { kutu: kayit });
  }

  if (yol.startsWith('/api/kutu/') && yontem === 'DELETE') {
    const id = dogrula.kimlik(yol.slice('/api/kutu/'.length));
    if (!id) return hataYaz(cevap, 400, 'Geçersiz kimlik.');
    await veri.yedekAl(benId, 'kutu sil: ' + id);
    const silindi = await veri.kutuSil(benId, id);
    if (!silindi) return hataYaz(cevap, 404, 'Kutu bulunamadı.');
    return jsonYaz(cevap, 200, { silindi: true });
  }

  // ---- PLAN -------------------------------------------------------------

  if (yol === '/api/plan' && yontem === 'POST') {
    const govde = await govdeOku(istek);
    const sonuc = dogrula.plan(govde);
    if (sonuc.hata) return hataYaz(cevap, 400, sonuc.hata);

    const yeni = !dogrula.kimlik(govde.id);
    if (yeni) {
      const sayi = await veri.planSayisi(benId);
      if (sayi >= dogrula.SINIR.planAzami) {
        return hataYaz(
          cevap,
          400,
          'En fazla ' + dogrula.SINIR.planAzami + ' plan tutulabilir. Eskilerden birini sil.'
        );
      }
    }

    await veri.yedekAl(benId, 'plan kaydet: ' + sonuc.deger.ad);
    const kayit = await veri.planKaydet(benId, sonuc.deger);
    if (!kayit) return hataYaz(cevap, 404, 'Plan bulunamadı.');
    return jsonYaz(cevap, 200, { plan: kayit });
  }

  if (yol.startsWith('/api/plan/') && yontem === 'DELETE') {
    const id = dogrula.kimlik(yol.slice('/api/plan/'.length));
    if (!id) return hataYaz(cevap, 400, 'Geçersiz kimlik.');
    await veri.yedekAl(benId, 'plan sil: ' + id);
    const silindi = await veri.planSil(benId, id);
    if (!silindi) return hataYaz(cevap, 404, 'Plan bulunamadı.');
    return jsonYaz(cevap, 200, { silindi: true });
  }

  // ---- AYARLAR ----------------------------------------------------------

  if (yol === '/api/ayarlar' && yontem === 'POST') {
    const govde = await govdeOku(istek);
    const sonuc = dogrula.ayarlar(govde);
    await veri.ayarlariYaz(benId, sonuc.deger);
    return jsonYaz(cevap, 200, { ayarlar: sonuc.deger });
  }

  // ---- SIFRE ------------------------------------------------------------

  if (yol === '/api/sifre' && yontem === 'POST') {
    const govde = await govdeOku(istek);
    const sonuc = dogrula.sifreDegistir(govde);
    if (sonuc.hata) return hataYaz(cevap, 400, sonuc.hata);

    // Artik birden fazla hesap var: "yoneticinin sifresi" diye tek bir sey
    // yok, giris yapan KENDI sifresini degistiriyor. (Oturumun sahibi
    // yukarida, butun veri uclarindan once dogrulaniyor.)
    const hesap = await veri.yoneticiOkuId(benId);
    if (!hesap) return hataYaz(cevap, 401, 'Hesap bulunamadı. Tekrar giriş yap.');

    const eskiDogru = await guvenlik.sifreDogru(
      sonuc.deger.eski,
      hesap.tuz,
      hesap.ozet
    );
    if (!eskiDogru) return hataYaz(cevap, 401, 'Mevcut şifre hatalı.');

    const yeniKullanici = sonuc.deger.kullanici || hesap.kullanici;

    // Kullanici adi degisiyorsa BASKASI kullaniyor olabilir
    if (yeniKullanici.toLowerCase() !== hesap.kullanici.toLowerCase()) {
      const cakisan = await veri.yoneticiOku(yeniKullanici);
      if (cakisan) {
        return hataYaz(cevap, 409, 'Bu kullanıcı adı zaten kullanılıyor.');
      }
    }

    const { tuz, ozet } = await guvenlik.sifreOzetle(sonuc.deger.yeni);
    await veri.yoneticiGuncelle(hesap.id, { kullanici: yeniKullanici, tuz, ozet });

    console.log('[sifre] degistirildi  hesap=' + hesap.id);
    return jsonYaz(cevap, 200, { tamam: true, kullanici: yeniKullanici });
  }

  // ---- DAVET KODLARI ----------------------------------------------------
  //  Yalnizca KURUCU. Rol sistemi bundan ibaret: kayit olan kullanicilar
  //  kendi verilerinin tam sahibi ama baskasini davet edemez - yoksa kod
  //  zinciri kontrolden cikar, siteye kimin girdigini takip edemem.
  if (yol === '/api/davetler' || yol.startsWith('/api/davet')) {
    const hesap = await veri.yoneticiOkuId(benId);
    if (!hesap || hesap.kurucu !== true) {
      return hataYaz(cevap, 403, 'Bu işlem için yetkin yok.');
    }

    if (yol === '/api/davetler' && yontem === 'GET') {
      return jsonYaz(cevap, 200, {
        davetler: await veri.davetleriListele(),
        gecerlilikGun: guvenlik.DAVET_GECERLILIK_GUN,
      });
    }

    if (yol === '/api/davet' && yontem === 'POST') {
      const govde = await govdeOku(istek);
      const etiket = dogrula.metin(govde.etiket, dogrula.SINIR.metinKisa);
      const davet = await veri.davetEkle({
        kod: guvenlik.davetKoduUret(),
        etiket,
        olusturanId: benId,
        sonKullanma: guvenlik.davetSonKullanma(),
      });
      console.log('[davet] uretildi  kod=' + davet.kod + '  etiket=' + JSON.stringify(etiket));
      return jsonYaz(cevap, 200, { davet });
    }

    if (yol.startsWith('/api/davet/') && yontem === 'DELETE') {
      const kod = dogrula.davetKodu(yol.slice('/api/davet/'.length));
      if (!kod) return hataYaz(cevap, 400, 'Geçersiz referans numarası.');
      const silindi = await veri.davetSil(kod);
      // Kullanilmis kod silinmez: kimin hangi kodla girdigi kayitli kalsin
      if (!silindi) {
        return hataYaz(cevap, 404, 'Numara bulunamadı ya da zaten kullanılmış.');
      }
      return jsonYaz(cevap, 200, { silindi: true });
    }

    return hataYaz(cevap, 404, 'Böyle bir API ucu yok.');
  }

  // ---- YEDEKLER ---------------------------------------------------------

  if (yol === '/api/yedekler' && yontem === 'GET') {
    return jsonYaz(cevap, 200, { yedekler: await veri.yedekleriListele(benId) });
  }

  return hataYaz(cevap, 404, 'Böyle bir API ucu yok.');
}

// ---------------------------------------------------------------------------
//  Ana yonlendirici
// ---------------------------------------------------------------------------

const sunucu = http.createServer(async (istek, cevap) => {
  const yol = (istek.url || '/').split('?')[0];

  try {
    // Oturum kontrolu
    const jeton = guvenlik.cerezOku(istek.headers.cookie, guvenlik.CEREZ_ADI);
    // oturumGecerliMi artik true/false degil, {kullaniciId} ya da null
    // donduruyor - hangi hesabin girdigini sifre degistirme kullaniyor.
    const oturum = await guvenlik.oturumGecerliMi(jeton);
    const girisli = oturum !== null;

    if (yol.startsWith('/api/')) {
      return await apiIsle(istek, cevap, yol, girisli, oturum);
    }

    if (istek.method !== 'GET' && istek.method !== 'HEAD') {
      return hataYaz(cevap, 405, 'Bu yöntem desteklenmiyor.');
    }

    // SITENIN TAMAMI GIRIS ARKASINDA: girisli degilse giris sayfasina yolla
    if (!girisli && !ACIK_YOLLAR.has(yol)) {
      cevap.writeHead(302, guvenlikBasliklari({ Location: '/giris' }));
      return cevap.end();
    }

    // Girisliyken giris/kayit sayfasi istenirse ana sayfaya dondur
    if (
      girisli &&
      (yol === '/giris' || yol === '/giris.html' ||
       yol === '/kayit' || yol === '/kayit.html')
    ) {
      cevap.writeHead(302, guvenlikBasliklari({ Location: '/' }));
      return cevap.end();
    }

    // Uzantisiz adresler (/giris, /kayit) ilgili html dosyasina baglanir
    const UZANTISIZ = { '/giris': '/giris.html', '/kayit': '/kayit.html' };
    const dosyaYolu = UZANTISIZ[yol] || yol;
    return await statikSun(cevap, dosyaYolu);
  } catch (hata) {
    const kod = hata && hata.kod ? hata.kod : 500;
    if (kod === 500) console.error('[sunucu] hata:', hata);
    if (!cevap.headersSent) {
      hataYaz(cevap, kod, kod === 500 ? 'Sunucu hatası.' : hata.message);
    } else {
      cevap.end();
    }
  }
});

// ---------------------------------------------------------------------------
//  Baslat
// ---------------------------------------------------------------------------

/**
 * Semayi her aciliste calistirir.
 *
 * NEDEN GEREKLI: Render'in baslatma komutu `npm start`, yani yalnizca bu
 * dosya. `npm run db:kur` dagitimda HIC calismiyor. Semaya yeni bir kolon
 * eklendiginde (30 Tem 2026: kutular.material / kutular.format) canli
 * veritabani eski semada kalir ve ilk kayitta "column does not exist" ile
 * 500 doner. Kullanicidan her seferinde elle komut calistirmasini beklemek
 * yerine sunucu kendi semasini kendisi hizaliyor.
 *
 * GUVENLI: sema.sql'in tamami `create table if not exists` ve
 * `alter table ... add column if not exists` - var olan veriye dokunmaz,
 * tekrar tekrar calistirilabilir. Yonetici hesabi burada DEGIL kur.js'te
 * olusturuluyor, yani sifre tarafina hic karismiyor.
 */
async function semayiHizala() {
  const yol = path.join(__dirname, 'veritabani', 'sema.sql');
  const sema = fs.readFileSync(yol, 'utf8');
  const { sorgu } = require('./veritabani/baglanti');
  await sorgu(sema);
}

async function baslat() {
  // Sema once: eksik kolon varsa uygulama acilmadan tamamlansin
  try {
    await semayiHizala();
  } catch (hata) {
    // Semayi hizalayamadiysak devam etmenin anlami yok - yeni kolonu
    // bekleyen kod ilk yazmada patlar, sebebi de anlasilmaz olur.
    console.error('\nSEMA HIZALANAMADI:', hata.message);
    console.error('  `npm run db:kur` ile elle deneyebilirsin.\n');
    process.exit(1);
  }

  // Hic hesap var mi?
  let hesapSayisi = 0;
  try {
    hesapSayisi = await veri.yoneticiSayisi();
  } catch (hata) {
    console.error('\nVERITABANINA ULASILAMADI:', hata.message);
    console.error('  Once `npm run db:dene` ile baglantiyi kontrol et.\n');
    process.exit(1);
  }

  if (hesapSayisi === 0) {
    console.error('\nHic hesap yok. Once kurulumu calistir:\n  npm run db:kur\n');
    process.exit(1);
  }

  await guvenlik.eskiOturumlariSil();
  // Saatte bir suresi gecmis oturumlari temizle
  setInterval(() => {
    guvenlik.eskiOturumlariSil().catch(() => {});
  }, 60 * 60 * 1000).unref();

  sunucu.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  DEPO WEB - Tir Yukleme Planlayici');
    console.log('  ---------------------------------');
    console.log('  Adres     : http://localhost:' + PORT);
    console.log('  Hesap     : ' + hesapSayisi + ' kullanici');
    console.log('  Erisim    : SITENIN TAMAMI giris arkasinda');
    console.log('');

    // Zayif sifre uyarisi - online'a cikmadan once degistirilmesi lazim
    if (process.env.YONETICI_SIFRE && process.env.YONETICI_SIFRE.length < 10) {
      console.warn(
        '  UYARI: Yonetici sifresi kisa/zayif gorunuyor.\n' +
          '         Internete acmadan (FAZ 8) once mutlaka degistir.\n'
      );
    }
  });
}

// Duzgun kapanma
for (const sinyal of ['SIGINT', 'SIGTERM']) {
  process.on(sinyal, () => {
    console.log('\nKapaniyor...');
    sunucu.close(() => {
      havuz.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

if (require.main === module) baslat();

module.exports = { sunucu, baslat };
