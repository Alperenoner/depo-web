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

test('Kisa sifre reddedilir (kayit siniri sifreDegistir icin gecerli olandan yuksek)', () => {
  const kisa = 'a'.repeat(dogrula.SINIR.sifreEnAz - 1);
  const sonuc = dogrula.kayit(kayitTarifi({ sifre: kisa, sifreTekrar: kisa }));
  assert.ok(sonuc.hata);
  assert.ok(dogrula.SINIR.sifreEnAz >= 8);
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
