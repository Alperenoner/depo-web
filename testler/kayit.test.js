// ============================================================================
//  KAYIT OLMA + DAVET KODU TESTLERI  -  `npm test`
//
//  Siteye artik disaridan kayit olunuyor: kapiyi tutan tek sey davet
//  (referans) numarasi. O yuzden buradaki testlerin derdi iki sey:
//
//    1. KOD ALFABESI BOZULMASIN. Alfabe TAM 32 karakter olmali - kodu ureten
//       `bayt % 32` yapiyor ve 32'den farkli bir uzunlukta bazi karakterler
//       otekilerden sik cikar, yani kod tahmin edilebilirlesir. Alfabeye bir
//       harf eklendiginde bu testler patlar.
//    2. KAYIT FORMU GEVSEMESIN. Eksik/bozuk alan sunucudan donmeli; tarayici
//       tarafindaki kontroller yalnizca kolaylik.
//
//  Bu dosya VERITABANINA DOKUNMAZ - dogrula.js saf bir modul, testler onu
//  dogrudan yukleyebiliyor.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');

const dogrula = require('../sunucu/dogrula.js');

/** guvenlik.davetKoduUret ile ayni is - ama veritabani gerektirmeden. */
function ornekKod(govde) {
  return dogrula.DAVET_ON_EK + '-' + govde.slice(0, 4) + '-' + govde.slice(4);
}

// ============================================================================
//  1. KOD ALFABESI
// ============================================================================

test('Davet alfabesi TAM 32 karakter (esit olasilik icin sart)', () => {
  assert.equal(dogrula.DAVET_ALFABE.length, 32);
});

test('Alfabede tekrar eden karakter yok', () => {
  const benzersiz = new Set(dogrula.DAVET_ALFABE);
  assert.equal(benzersiz.size, dogrula.DAVET_ALFABE.length);
});

test('Karistirilan karakterler alfabede yok (0/O, 1/I)', () => {
  for (const karakter of ['0', 'O', '1', 'I']) {
    assert.equal(
      dogrula.DAVET_ALFABE.includes(karakter),
      false,
      karakter + ' alfabede olmamali - telefonda okunurken karisiyor'
    );
  }
});

// ============================================================================
//  2. KODU OKUMA - kullanici nasil yazarsa yazsin
// ============================================================================

test('Kod bicimi ne olursa olsun ayni sonuca cozulur', () => {
  const kod = ornekKod('7K4M92XQ');
  const yazimlar = [
    kod,
    kod.toLowerCase(),
    kod.replace(/-/g, ''),
    kod.replace(/-/g, ' '),
    '  ' + kod + '  ',
    '7K4M92XQ', // on ek olmadan
    '7k4m 92xq',
  ];
  for (const yazim of yazimlar) {
    assert.equal(dogrula.davetKodu(yazim), kod, JSON.stringify(yazim));
  }
});

test('Alfabede olmayan karakter iceren kod reddedilir', () => {
  // O ve 0 alfabede yok - kullanici yanlis okumus demektir
  assert.equal(dogrula.davetKodu(ornekKod('7K4M92XO')), null);
  assert.equal(dogrula.davetKodu(ornekKod('0K4M92XQ')), null);
});

test('Yanlis uzunluk / yanlis on ek reddedilir', () => {
  assert.equal(dogrula.davetKodu('7K4M92X'), null); // 7 karakter
  assert.equal(dogrula.davetKodu('7K4M92XQZ'), null); // 9 karakter
  assert.equal(dogrula.davetKodu('DEPX-7K4M-92XQ'), null); // on ek bozuk
  assert.equal(dogrula.davetKodu(''), null);
  assert.equal(dogrula.davetKodu(null), null);
  assert.equal(dogrula.davetKodu(undefined), null);
});

// ============================================================================
//  3. E-POSTA VE TELEFON
// ============================================================================

test('E-posta kucuk harfe indirilir, bicim tutmuyorsa null', () => {
  assert.equal(dogrula.eposta('  Ali@Ornek.COM '), 'ali@ornek.com');
  assert.equal(dogrula.eposta('ali@ornek'), null); // uzanti yok
  assert.equal(dogrula.eposta('ali ornek.com'), null); // @ yok
  assert.equal(dogrula.eposta(''), null);
});

test('Telefon rakamlara indirilir, ulke kodundaki + korunur', () => {
  assert.equal(dogrula.telefon('0532 111 22 33'), '05321112233');
  assert.equal(dogrula.telefon('(0532) 111-22-33'), '05321112233');
  assert.equal(dogrula.telefon('+90 532 111 22 33'), '+905321112233');
  assert.equal(dogrula.telefon('123'), null); // cok kisa
  assert.equal(dogrula.telefon('1'.repeat(20)), null); // cok uzun
});

// ============================================================================
//  4. KAYIT FORMU
// ============================================================================

const KOD = ornekKod('7K4M92XQ');

function kayitTarifi(ekle) {
  return Object.assign({
    adSoyad: 'Ahmet Yılmaz',
    eposta: 'ahmet@ornek.com',
    telefon: '0532 111 22 33',
    sifre: 'gizlisifre',
    sifreTekrar: 'gizlisifre',
    davetKodu: KOD,
  }, ekle || {});
}

test('Eksiksiz form gecer ve degerler temizlenmis doner', () => {
  const sonuc = dogrula.kayit(kayitTarifi());
  assert.equal(sonuc.hata, undefined);
  assert.deepEqual(sonuc.deger, {
    adSoyad: 'Ahmet Yılmaz',
    eposta: 'ahmet@ornek.com',
    telefon: '05321112233',
    sifre: 'gizlisifre',
    davetKodu: KOD,
  });
});

test('Soyadsiz ad reddedilir', () => {
  assert.ok(dogrula.kayit(kayitTarifi({ adSoyad: 'Ahmet' })).hata);
});

test('Kisa sifre reddedilir', () => {
  const kisa = 'a'.repeat(dogrula.SINIR.sifreEnAz - 1);
  assert.ok(dogrula.kayit(kayitTarifi({ sifre: kisa, sifreTekrar: kisa })).hata);
});

test('Birbirini tutmayan sifreler reddedilir', () => {
  assert.ok(dogrula.kayit(kayitTarifi({ sifreTekrar: 'baskasifre' })).hata);
});

test('Gecersiz e-posta / telefon / kod tek tek reddedilir', () => {
  assert.ok(dogrula.kayit(kayitTarifi({ eposta: 'bozuk' })).hata);
  assert.ok(dogrula.kayit(kayitTarifi({ telefon: '12' })).hata);
  assert.ok(dogrula.kayit(kayitTarifi({ davetKodu: 'DEPO-XXXX' })).hata);
});

test('Kod olmadan kayit olunamaz - kapiyi tutan tek sey bu', () => {
  assert.ok(dogrula.kayit(kayitTarifi({ davetKodu: '' })).hata);
  const eksik = kayitTarifi();
  delete eksik.davetKodu;
  assert.ok(dogrula.kayit(eksik).hata);
});

test('Bos/bozuk govde cokmez, hata doner', () => {
  assert.ok(dogrula.kayit({}).hata);
  assert.ok(dogrula.kayit(null).hata);
  assert.ok(dogrula.kayit(undefined).hata);
});

// ============================================================================
//  5. SIFRE SIFIRLAMA KODU
//
//  Davet koduyla AYNI alfabeyi kullaniyor ama ON EKI FARKLI. Sebep: kullanici
//  sifirlama kodunu kayit formuna (ya da tersi) yapistirdiginda "bu o kod
//  degil" diyebilelim. Bu ayrim bozulursa iki kod turu birbirine karisir.
// ============================================================================

test('Davet ve sifirlama on ekleri FARKLI', () => {
  assert.notEqual(dogrula.DAVET_ON_EK, dogrula.SIFIRLAMA_ON_EK);
});

test('Sifirlama kodu bicimi ne olursa olsun cozulur', () => {
  const kod = dogrula.SIFIRLAMA_ON_EK + '-7K4M-92XQ';
  for (const yazim of [kod, kod.toLowerCase(), kod.replace(/-/g, ''), '7K4M92XQ']) {
    assert.equal(dogrula.sifirlamaKodu(yazim), kod, JSON.stringify(yazim));
  }
});

test('Davet kodu sifirlama kodu yerine gecmez (ve tersi)', () => {
  const davet = dogrula.DAVET_ON_EK + '-7K4M-92XQ';
  const sifirlama = dogrula.SIFIRLAMA_ON_EK + '-7K4M-92XQ';

  // On ekiyle birlikte yazilmis kod, YANLIS turde reddedilmeli
  assert.equal(dogrula.sifirlamaKodu(davet), null);
  assert.equal(dogrula.davetKodu(sifirlama), null);
});

// ============================================================================
//  6. SIFRE ALT SINIRI TEK KAYNAKTAN
//
//  Uc yerde uc ayri sayi vardi (kayit 8, sifre degistirme 6, arayuz 10):
//  8 karakterle kayit olan biri sifresini degistiremiyordu. Hepsi
//  SINIR.sifreEnAz'a baglandi.
// ============================================================================

test('Sifre alt siniri en az 10', () => {
  assert.ok(dogrula.SINIR.sifreEnAz >= 10);
});

test('Kayit ve sifre degistirme AYNI siniri uyguluyor', () => {
  const kisa = 'a'.repeat(dogrula.SINIR.sifreEnAz - 1);
  const tam = 'a'.repeat(dogrula.SINIR.sifreEnAz);

  assert.ok(dogrula.kayit(kayitTarifi({ sifre: kisa, sifreTekrar: kisa })).hata);
  assert.equal(dogrula.kayit(kayitTarifi({ sifre: tam, sifreTekrar: tam })).hata, undefined);

  assert.ok(dogrula.sifreDegistir({ eski: 'x', yeni: kisa, yeniTekrar: kisa }).hata);
  assert.equal(
    dogrula.sifreDegistir({ eski: 'x', yeni: tam, yeniTekrar: tam }).hata, undefined
  );
});

// ============================================================================
//  7. SIFRE SIFIRLAMA FORMU
// ============================================================================

const SIFIRLAMA_KOD = dogrula.SIFIRLAMA_ON_EK + '-7K4M-92XQ';

test('Eksiksiz sifirlama formu gecer', () => {
  const sonuc = dogrula.sifreSifirla({
    kod: SIFIRLAMA_KOD, yeni: 'yenisifre123', yeniTekrar: 'yenisifre123',
  });
  assert.equal(sonuc.hata, undefined);
  assert.deepEqual(sonuc.deger, { kod: SIFIRLAMA_KOD, yeni: 'yenisifre123' });
});

test('Sifirlamada gecersiz kod / kisa sifre / uyusmayan tekrar reddedilir', () => {
  const t = (ekle) => dogrula.sifreSifirla(Object.assign({
    kod: SIFIRLAMA_KOD, yeni: 'yenisifre123', yeniTekrar: 'yenisifre123',
  }, ekle));

  assert.ok(t({ kod: 'SIFRE-XXXX' }).hata);
  assert.ok(t({ kod: '' }).hata);
  assert.ok(t({ yeni: 'kisa', yeniTekrar: 'kisa' }).hata);
  assert.ok(t({ yeniTekrar: 'baskasifre1' }).hata);
  assert.ok(dogrula.sifreSifirla({}).hata);
  assert.ok(dogrula.sifreSifirla(null).hata);
});
