// ============================================================================
//  DOGRULAMA TESTLERI  -  `npm test`  (FAZ 3c)
//
//  Sunucu tarayiciya guvenmez, gelen her seyi kendisi dogrular. Buradaki
//  testlerin derdi asil su: DOGRULAMA ILE MOTOR AYRISMASIN.
//
//  Gercekten olmus hata: strateji id listesi dogrula.js'te elle yazilmisti;
//  FAZ 3a'da strateji sayisi 5'ten 3'e dusurulunce liste eskidi ve kullanici
//  'optimum' secip plan kaydettiginde sunucu bunu sessizce 'akilli' yapip
//  kaydediyordu. Plan geri yuklenince dizilis degisiyordu - hata mesaji yok,
//  uyari yok. Bu testler o sinifin tekrarini yakalar.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');

const dogrula = require('../sunucu/dogrula.js');
const Yerlesim = require('../motor/yerlesim.js');

/** Gecerli en yalin plan tarifi */
function planTarifi(ekle) {
  return Object.assign({
    ad: 'Deneme planı',
    arac: { ad: 'Dorse', uzunluk: 14000, genislik: 2480, yukseklik: 2700, maksAgirlik: 0 },
    kalemler: [{ kutuId: 'kutu-a', maks: true }],
    strateji: 'optimum',
    ayarlar: { pay: 0 },
  }, ekle || {});
}

// ============================================================================
//  1. STRATEJI LISTESI MOTORLA AYNI KALMALI
// ============================================================================

test('Gecerli strateji id listesi motordaki STRATEJILER ile birebir ayni', () => {
  const motordan = Yerlesim.STRATEJILER.map((s) => s.id);
  assert.deepEqual(dogrula.STRATEJI_IDLERI, motordan);
});

test('Motordaki HER strateji plan dogrulamasindan gecer', () => {
  for (const s of Yerlesim.STRATEJILER) {
    const sonuc = dogrula.plan(planTarifi({ strateji: s.id }));
    assert.ok(!sonuc.hata, s.id + ' reddedildi: ' + sonuc.hata);
    assert.equal(
      sonuc.deger.strateji, s.id,
      s.id + ' kaydedilirken degistirildi -> ' + sonuc.deger.strateji
    );
  }
});

test('Varsayilan strateji motorda gercekten var olan bir id', () => {
  const motordan = Yerlesim.STRATEJILER.map((s) => s.id);
  assert.ok(
    motordan.includes(dogrula.VARSAYILAN_STRATEJI),
    'varsayilan (' + dogrula.VARSAYILAN_STRATEJI + ') motorda yok'
  );
});

test('Bilinmeyen strateji varsayilana duser', () => {
  const sonuc = dogrula.plan(planTarifi({ strateji: 'akilli' })); // eski id
  assert.ok(!sonuc.hata);
  assert.equal(sonuc.deger.strateji, dogrula.VARSAYILAN_STRATEJI);
});

// ============================================================================
//  2. PLAN TARIFI: SONUC DEGIL TARIF SAKLANIR
// ============================================================================

test('Plan tarifi arac olculerini ve kalemleri saklar, blok saklamaz', () => {
  const sonuc = dogrula.plan(planTarifi());
  assert.ok(!sonuc.hata, sonuc.hata);

  const p = sonuc.deger;
  assert.equal(p.arac.uzunluk, 14000);
  assert.deepEqual(p.kalemler, [{ kutuId: 'kutu-a', adet: 0, maks: true }]);
  assert.equal(p.bloklar, undefined, 'yerlesim sonucu saklanmamali');
  assert.ok(p.id, 'id uretilmeli');
});

test('Adi bos plan reddedilir', () => {
  assert.ok(dogrula.plan(planTarifi({ ad: '   ' })).hata);
});

test('Kalemi olmayan plan reddedilir', () => {
  assert.ok(dogrula.plan(planTarifi({ kalemler: [] })).hata);
});

test('Ne adedi ne sonsuzu olan kalem atilir', () => {
  const sonuc = dogrula.plan(planTarifi({
    kalemler: [
      { kutuId: 'kutu-a', adet: 0, maks: false }, // anlamsiz - atilmali
      { kutuId: 'kutu-b', adet: 5, maks: false },
    ],
  }));
  assert.ok(!sonuc.hata, sonuc.hata);
  assert.deepEqual(sonuc.deger.kalemler, [{ kutuId: 'kutu-b', adet: 5, maks: false }]);
});

test('Kalem sayisi ust sinira kirpilir', () => {
  const cok = [];
  for (let i = 0; i < dogrula.SINIR.kalemAzami + 25; i++) {
    cok.push({ kutuId: 'kutu-' + i, maks: true });
  }
  const sonuc = dogrula.plan(planTarifi({ kalemler: cok }));
  assert.ok(!sonuc.hata, sonuc.hata);
  assert.equal(sonuc.deger.kalemler.length, dogrula.SINIR.kalemAzami);
});

test('Gecersiz kutuId iceren kalem atilir (yol gezinmesi denemesi dahil)', () => {
  const sonuc = dogrula.plan(planTarifi({
    kalemler: [
      { kutuId: '../../etc/passwd', maks: true },
      { kutuId: 'kutu-saglam', maks: true },
    ],
  }));
  assert.ok(!sonuc.hata, sonuc.hata);
  assert.deepEqual(sonuc.deger.kalemler.map((k) => k.kutuId), ['kutu-saglam']);
});

// ============================================================================
//  3. ARAYUZUN GONDERDIGI SEKIL SUNUCUDAN GECIYOR MU
//
//  Arayuz agirligi kaldirdi ve maksAgirlik:0 / agirlik:0 gonderiyor. Sunucu
//  bunlari zorunlu tuttugu icin 0'in gecerli sayilmasi SART - yoksa arayuz
//  hicbir sey kaydedemez.
// ============================================================================

test('Agirligi 0 olan kutu kabul edilir (arayuz agirligi kaldirdi)', () => {
  const sonuc = dogrula.kutu({
    ad: 'Koli', uzunluk: 575, genislik: 450, yukseklik: 242, agirlik: 0,
  });
  assert.ok(!sonuc.hata, sonuc.hata);
  assert.equal(sonuc.deger.agirlik, 0);
});

test('maksAgirlik 0 olan arac kabul edilir', () => {
  const sonuc = dogrula.arac({
    ad: 'Dorse', uzunluk: 14000, genislik: 2480, yukseklik: 2700, maksAgirlik: 0,
  });
  assert.ok(!sonuc.hata, sonuc.hata);
  assert.equal(sonuc.deger.maksAgirlik, 0);
});

test('Gecersiz renk varsayilana cevrilir, gecerli renk kucuk harfe iner', () => {
  assert.equal(dogrula.renk('kirmizi'), dogrula.VARSAYILAN_RENK);
  assert.equal(dogrula.renk('#E03131'), '#e03131');
});

test('Kutu olculeri sinir disina tasarsa kirpilir, reddedilmez', () => {
  const ust = dogrula.SINIR.kutuKenar[1];
  const sonuc = dogrula.kutu({
    ad: 'Kocaman', uzunluk: ust + 5000, genislik: 100, yukseklik: 100, agirlik: 0,
  });
  assert.ok(!sonuc.hata, sonuc.hata);
  assert.equal(sonuc.deger.uzunluk, ust);
});
