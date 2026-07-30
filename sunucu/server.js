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
const MOTOR_DOSYALARI = new Map([['/yerlesim.js', path.join(MOTOR, 'yerlesim.js')]]);

// Giris yapmadan erisilebilecek YOLLAR (baska hicbir sey acik degil)
const ACIK_YOLLAR = new Set([
  '/giris',
  '/giris.html',
  '/giris.css',
  '/giris.js',
  '/api/durum',
  '/api/giris',
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

function guvenlikBasliklari(ekstra) {
  return Object.assign(
    {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
    },
    ekstra || {}
  );
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

  // HTML her zaman taze okunur; digerleri kisa sure onbelleklenir
  const onbellek =
    uzanti === '.html' ? 'no-store' : 'public, max-age=3600';

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

async function apiIsle(istek, cevap, yol, girisli) {
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

    const yonetici = await veri.yoneticiOku();
    if (!yonetici) {
      return hataYaz(cevap, 500, 'Yönetici hesabı kurulmamış. `npm run db:kur` çalıştır.');
    }

    const kullaniciDogru = kullanici === yonetici.kullanici;
    // Kullanici adi yanlis olsa da sifre hesabi YAPILIR: boylece cevap suresi
    // "kullanici var mi" bilgisini sizdirmaz.
    const sifreOk = await guvenlik.sifreDogru(sifre, yonetici.tuz, yonetici.ozet);

    if (!kullaniciDogru || !sifreOk) {
      const kayit = guvenlik.hataEkle(ip);
      console.warn(
        '[giris] BASARISIZ  ip=' + ip + '  kullanici=' + JSON.stringify(kullanici) +
          (kayit.kilitBitis ? '  -> 10 DAKIKA KILITLENDI' : '')
      );
      return hataYaz(cevap, 401, 'Kullanıcı adı veya şifre hatalı.');
    }

    guvenlik.hatalariTemizle(ip);
    const jeton = await guvenlik.oturumAc(ip);
    console.log('[giris] basarili  ip=' + ip);

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

  // ---- Veri okuma -------------------------------------------------------

  if (yol === '/api/veri' && yontem === 'GET') {
    const pano = await veri.panoVerisi();
    return jsonYaz(cevap, 200, Object.assign({ girisli: true }, pano));
  }

  // ---- ARAC -------------------------------------------------------------

  if (yol === '/api/arac' && yontem === 'POST') {
    const govde = await govdeOku(istek);
    const sonuc = dogrula.arac(govde);
    if (sonuc.hata) return hataYaz(cevap, 400, sonuc.hata);

    await veri.yedekAl('arac kaydet: ' + sonuc.deger.ad);
    // Kaydedilen arac her zaman aktif olur (kullanici onunla plan yapiyor)
    const kayit = await veri.aracKaydet(sonuc.deger, true);
    return jsonYaz(cevap, 200, { arac: kayit });
  }

  if (yol.startsWith('/api/arac/') && yontem === 'DELETE') {
    const id = dogrula.kimlik(yol.slice('/api/arac/'.length));
    if (!id) return hataYaz(cevap, 400, 'Geçersiz kimlik.');
    await veri.yedekAl('arac sil: ' + id);
    const silindi = await veri.aracSil(id);
    if (!silindi) return hataYaz(cevap, 404, 'Araç bulunamadı.');
    return jsonYaz(cevap, 200, { silindi: true });
  }

  if (yol.startsWith('/api/arac-aktif/') && yontem === 'POST') {
    const id = dogrula.kimlik(yol.slice('/api/arac-aktif/'.length));
    if (!id) return hataYaz(cevap, 400, 'Geçersiz kimlik.');
    const oldu = await veri.aracAktifYap(id);
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
      const sayi = await veri.kutuSayisi();
      if (sayi >= dogrula.SINIR.katalogAzami) {
        return hataYaz(
          cevap,
          400,
          'Katalog en fazla ' + dogrula.SINIR.katalogAzami + ' çeşit tutabilir.'
        );
      }
    }

    await veri.yedekAl('kutu kaydet: ' + sonuc.deger.ad);
    const kayit = await veri.kutuKaydet(sonuc.deger);
    return jsonYaz(cevap, 200, { kutu: kayit });
  }

  if (yol.startsWith('/api/kutu/') && yontem === 'DELETE') {
    const id = dogrula.kimlik(yol.slice('/api/kutu/'.length));
    if (!id) return hataYaz(cevap, 400, 'Geçersiz kimlik.');
    await veri.yedekAl('kutu sil: ' + id);
    const silindi = await veri.kutuSil(id);
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
      const sayi = await veri.planSayisi();
      if (sayi >= dogrula.SINIR.planAzami) {
        return hataYaz(
          cevap,
          400,
          'En fazla ' + dogrula.SINIR.planAzami + ' plan tutulabilir. Eskilerden birini sil.'
        );
      }
    }

    await veri.yedekAl('plan kaydet: ' + sonuc.deger.ad);
    const kayit = await veri.planKaydet(sonuc.deger);
    return jsonYaz(cevap, 200, { plan: kayit });
  }

  if (yol.startsWith('/api/plan/') && yontem === 'DELETE') {
    const id = dogrula.kimlik(yol.slice('/api/plan/'.length));
    if (!id) return hataYaz(cevap, 400, 'Geçersiz kimlik.');
    await veri.yedekAl('plan sil: ' + id);
    const silindi = await veri.planSil(id);
    if (!silindi) return hataYaz(cevap, 404, 'Plan bulunamadı.');
    return jsonYaz(cevap, 200, { silindi: true });
  }

  // ---- AYARLAR ----------------------------------------------------------

  if (yol === '/api/ayarlar' && yontem === 'POST') {
    const govde = await govdeOku(istek);
    const sonuc = dogrula.ayarlar(govde);
    await veri.ayarlariYaz(sonuc.deger);
    return jsonYaz(cevap, 200, { ayarlar: sonuc.deger });
  }

  // ---- SIFRE ------------------------------------------------------------

  if (yol === '/api/sifre' && yontem === 'POST') {
    const govde = await govdeOku(istek);
    const sonuc = dogrula.sifreDegistir(govde);
    if (sonuc.hata) return hataYaz(cevap, 400, sonuc.hata);

    const yonetici = await veri.yoneticiOku();
    if (!yonetici) return hataYaz(cevap, 500, 'Yönetici hesabı bulunamadı.');

    const eskiDogru = await guvenlik.sifreDogru(
      sonuc.deger.eski,
      yonetici.tuz,
      yonetici.ozet
    );
    if (!eskiDogru) return hataYaz(cevap, 401, 'Mevcut şifre hatalı.');

    const { tuz, ozet } = await guvenlik.sifreOzetle(sonuc.deger.yeni);
    await veri.yoneticiYaz({
      // Kullanici adi bos gelirse AYNI KALIR
      kullanici: sonuc.deger.kullanici || yonetici.kullanici,
      tuz,
      ozet,
      ad: yonetici.ad,
    });

    console.log('[sifre] degistirildi');
    return jsonYaz(cevap, 200, {
      tamam: true,
      kullanici: sonuc.deger.kullanici || yonetici.kullanici,
    });
  }

  // ---- YEDEKLER ---------------------------------------------------------

  if (yol === '/api/yedekler' && yontem === 'GET') {
    return jsonYaz(cevap, 200, { yedekler: await veri.yedekleriListele() });
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
    const girisli = await guvenlik.oturumGecerliMi(jeton);

    if (yol.startsWith('/api/')) {
      return await apiIsle(istek, cevap, yol, girisli);
    }

    if (istek.method !== 'GET' && istek.method !== 'HEAD') {
      return hataYaz(cevap, 405, 'Bu yöntem desteklenmiyor.');
    }

    // SITENIN TAMAMI GIRIS ARKASINDA: girisli degilse giris sayfasina yolla
    if (!girisli && !ACIK_YOLLAR.has(yol)) {
      cevap.writeHead(302, guvenlikBasliklari({ Location: '/giris' }));
      return cevap.end();
    }

    // Girisliyken /giris istenirse ana sayfaya dondur
    if (girisli && (yol === '/giris' || yol === '/giris.html')) {
      cevap.writeHead(302, guvenlikBasliklari({ Location: '/' }));
      return cevap.end();
    }

    const dosyaYolu = yol === '/giris' ? '/giris.html' : yol;
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

async function baslat() {
  // Yonetici hesabi var mi?
  let yonetici = null;
  try {
    yonetici = await veri.yoneticiOku();
  } catch (hata) {
    console.error('\nVERITABANINA ULASILAMADI:', hata.message);
    console.error('  Once `npm run db:dene` ile baglantiyi kontrol et.\n');
    process.exit(1);
  }

  if (!yonetici) {
    console.error('\nYonetici hesabi yok. Once kurulumu calistir:\n  npm run db:kur\n');
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
    console.log('  Kullanici : ' + yonetici.kullanici);
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
