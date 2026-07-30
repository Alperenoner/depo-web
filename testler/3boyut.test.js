// ============================================================================
//  3B TESTLERI  -  `npm test`  (FAZ 4)
//
//  3boyut.js'in sahne kuran kismi WebGL istiyor, Node'da calismaz. Ama iki
//  karar SAF HESAP ve ikisi de rehberde "burada hata cikti" diye isaretli:
//
//    1. kipSec       -> 30.000 esiginde tek tek / blok kipi
//    2. yuzTekrarlari-> izgara dokusunun her yuzde kac kez tekrarlanacagi
//
//  Ikincisi ozellikle sessiz: yanlis tekrar sayisi dokuyu kutu izgarasindan
//  kaydirir, ekranda "bir sey ters" demez ama gosterilen izgara gercek kutu
//  bolunmesini tutmaz. Rehber 8.7 uc yuzu ayri ayri yaziyor, test de oyle.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');

const Uc = require('../public/3boyut.js');
const Yerlesim = require('../motor/yerlesim.js');
const { ARAC_14M, KUTULAR } = require('./ornek-kutular.js');

// ============================================================================
//  1. KIP SECIMI  (rehber 8.7: <=30.000 tek tek, >30.000 blok)
// ============================================================================

test('Esik 30.000 ve sinirda tek tek kip secilir', () => {
  assert.equal(Uc.TEK_TEK_SINIR, 30000);
  assert.equal(Uc.kipSec(0), 'tek');
  assert.equal(Uc.kipSec(1), 'tek');
  assert.equal(Uc.kipSec(29999), 'tek');
  assert.equal(Uc.kipSec(30000), 'tek', 'tam sinirda hala tek tek');
  assert.equal(Uc.kipSec(30001), 'blok', 'sinirin bir ustunde blok');
});

test('Marlboro Koli tek tek, Marlboro Paket blok kipine duser', () => {
  const koli = Yerlesim.planla(ARAC_14M, [{ kutu: KUTULAR.marlboroKoli, maks: true }]);
  const paket = Yerlesim.planla(ARAC_14M, [{ kutu: KUTULAR.marlboroPaket, maks: true }]);

  assert.equal(koli.ozet.toplamAdet, 1440);
  assert.equal(Uc.kipSec(koli.ozet.toplamAdet), 'tek');

  assert.ok(paket.ozet.toplamAdet > 900000, 'paket 900.000 ustu olmali');
  assert.equal(Uc.kipSec(paket.ozet.toplamAdet), 'blok');
});

// ============================================================================
//  2. IZGARA DOKUSUNUN YUZ TEKRARLARI
//
//  three.js BoxGeometry malzeme sirasi: [+x, -x, +y, -y, +z, -z]
//  Eksen cevrimi: three.y = yukseklik (nz), three.z = genislik (ny)
// ============================================================================

test('Yuz tekrarlari rehberdeki uc kurala uyar', () => {
  const b = { nx: 24, ny: 10, nz: 6 };
  const t = Uc.yuzTekrarlari(b);

  assert.equal(t.length, 6, 'kutunun 6 yuzu var');
  assert.deepEqual(t[0], [10, 6], '+x yuzu ny x nz');
  assert.deepEqual(t[1], [10, 6], '-x yuzu ny x nz');
  assert.deepEqual(t[2], [24, 10], '+y (ust) yuzu nx x ny');
  assert.deepEqual(t[3], [24, 10], '-y (alt) yuzu nx x ny');
  assert.deepEqual(t[4], [24, 6], '+z yuzu nx x nz');
  assert.deepEqual(t[5], [24, 6], '-z yuzu nx x nz');
});

test('Karsi yuzler ayni tekrari alir', () => {
  const t = Uc.yuzTekrarlari({ nx: 7, ny: 3, nz: 5 });
  assert.deepEqual(t[0], t[1], '+x ile -x');
  assert.deepEqual(t[2], t[3], 'ust ile alt');
  assert.deepEqual(t[4], t[5], '+z ile -z');
});

test('Her yuzun tekrari o yuzun GERCEK kutu sayisini verir', () => {
  // Yuzdeki hucre sayisi = tekrarU * tekrarV; bu, o yuzden gorunen kutu sayisi
  const b = { nx: 24, ny: 10, nz: 6 };
  const t = Uc.yuzTekrarlari(b);
  assert.equal(t[0][0] * t[0][1], b.ny * b.nz, 'yandan bakinca ny*nz kutu gorunur');
  assert.equal(t[2][0] * t[2][1], b.nx * b.ny, 'ustten bakinca nx*ny kutu gorunur');
  assert.equal(t[4][0] * t[4][1], b.nx * b.nz, 'onden bakinca nx*nz kutu gorunur');
});

test('Tek katli/tek sirali blokta tekrar 1 olur, 0 olmaz', () => {
  // 0 tekrar dokuyu tamamen bozar (bolme sifir gibi davranir)
  const t = Uc.yuzTekrarlari({ nx: 1, ny: 1, nz: 1 });
  for (const [u, v] of t) {
    assert.ok(u >= 1 && v >= 1, 'tekrar en az 1 olmali, bulunan: ' + u + 'x' + v);
  }
});

test('Bozuk/eksik blok verisinde de tekrar en az 1', () => {
  for (const bozuk of [{}, { nx: 0, ny: 0, nz: 0 }, { nx: -5, ny: NaN, nz: undefined }]) {
    for (const [u, v] of Uc.yuzTekrarlari(bozuk)) {
      assert.ok(u >= 1 && v >= 1, 'tekrar 1 altina dusmemeli: ' + u + 'x' + v);
    }
  }
});

test('Gercek plandaki her blok icin tekrarlar tutarli', () => {
  const p = Yerlesim.planla(ARAC_14M, [
    { kutu: KUTULAR.koliOrta, adet: 137 }, // izgaraya denk gelmeyen adet
    { kutu: KUTULAR.koliKucuk, maks: true },
  ]);
  assert.ok(p.bloklar.length > 1, 'birden fazla blok bekleniyor');

  for (const b of p.bloklar) {
    const t = Uc.yuzTekrarlari(b);
    assert.equal(t[0][0] * t[0][1], b.ny * b.nz);
    assert.equal(t[2][0] * t[2][1], b.nx * b.ny);
    assert.equal(t[4][0] * t[4][1], b.nx * b.nz);
  }
});

// ============================================================================
//  3. RENK OYNAMASI  (komsu kutular ayirt edilsin)
// ============================================================================

test('Renk oynamasi 1 civarinda kalir - kutu rengini bozmaz', () => {
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 12; j++) {
      for (let k = 0; k < 12; k++) {
        const c = Uc.renkOynamasi(i, j, k);
        assert.ok(c >= 0.9 && c <= 1.1, 'carpan 0.9-1.1 arasinda olmali: ' + c);
      }
    }
  }
});

test('Renk oynamasi konuma bagli, rastgele DEGIL', () => {
  // Ayni plan her cizimde ayni gorunmeli; rastgele olsa her yenilemede
  // kutular titrer.
  assert.equal(Uc.renkOynamasi(3, 4, 5), Uc.renkOynamasi(3, 4, 5));
});

test('Komsu kutular farkli ton alir', () => {
  // Ayni tonu alan iki komsu birbirinden ayirt edilemez - amac buydu
  assert.notEqual(Uc.renkOynamasi(0, 0, 0), Uc.renkOynamasi(1, 0, 0));
  assert.notEqual(Uc.renkOynamasi(0, 0, 0), Uc.renkOynamasi(0, 1, 0));
  assert.notEqual(Uc.renkOynamasi(0, 0, 0), Uc.renkOynamasi(0, 0, 1));
});

// ============================================================================
//  4. THREE.JS OLMADAN YUKLENEBILMELI
//
//  Bu dosya Node'da require edilebiliyor olmasi zaten bunu kanitliyor: modul
//  govdesinde THREE'ye dokunulmuyor. Asagidaki test niyeti kayda geciriyor -
//  ileride tepeye `new THREE.X()` eklenirse burasi kirilir.
// ============================================================================

test('Modul three.js olmadan yuklenir ve saf yardimcilar calisir', () => {
  assert.equal(typeof THREE, 'undefined', 'testte three.js yuklu olmamali');
  assert.equal(typeof Uc.kipSec, 'function');
  assert.equal(typeof Uc.yuzTekrarlari, 'function');
  assert.equal(Uc.destekliyorMu(), false, 'three yokken destek yok demeli');
});

// ============================================================================
//  5. SIRA NUMARALARI  (FAZ 9)
//
//  Numaralar 3boyut.js'te URETILMEZ, motordan (Yerlesim.yuklemeSirasi)
//  gelir - 📋 Yukleme Listesi'ndeki "Sira" ile ayni sayi olmak zorunda.
//  Buradaki testler tam da o esitligi ve sinirin (NUMARA_SINIR) kirpma
//  davranisini kilitliyor.
//
//  Bu fonksiyon three.js istemiyor: sprite kurmuyor, sadece hangi bloga
//  hangi sayinin dustugunu soyluyor. O yuzden Node'da calisabiliyor.
// ============================================================================

test('Numara sirasi Yukleme Listesi ile BIREBIR ayni', () => {
  const p = Yerlesim.planla(ARAC_14M, [
    { kutu: KUTULAR.koliOrta, adet: 137 },
    { kutu: KUTULAR.koliKucuk, maks: true },
  ]);
  assert.ok(p.bloklar.length > 1, 'birden fazla blok bekleniyor');

  // Yukleme Listesi'nin yaptigi is: motordan sirayi al, 1'den numaralandir
  const liste = Yerlesim.yuklemeSirasi(p.bloklar);
  const etiketler = Uc.numaraListesi(p.bloklar);

  assert.equal(etiketler.length, liste.length);
  etiketler.forEach((e, i) => {
    assert.equal(e.numara, i + 1, 'numaralar 1"den baslayip artmali');
    assert.equal(e.blok, liste[i], 'listedeki ' + (i + 1) + '. blok ile ayni olmali');
  });
});

test('Numara sinirini asan planda ilk NUMARA_SINIR blok numaralanir', () => {
  assert.equal(Uc.NUMARA_SINIR, 400);

  const cok = [];
  for (let i = 0; i < Uc.NUMARA_SINIR + 25; i++) cok.push({ x: i, y: 0, z: 0 });

  const etiketler = Uc.numaraListesi(cok);
  assert.equal(etiketler.length, Uc.NUMARA_SINIR, 'sinirda kesilmeli');
  assert.equal(etiketler[0].numara, 1);
  assert.equal(etiketler[Uc.NUMARA_SINIR - 1].numara, Uc.NUMARA_SINIR);
  // Kesilenler SONDAKILER olmali - arac onundeki bloklar numarasiz kalmasin
  assert.equal(etiketler[0].blok.x, 0);
  assert.equal(etiketler[Uc.NUMARA_SINIR - 1].blok.x, Uc.NUMARA_SINIR - 1);
});

test('Numara listesi bos/eksik girdide cokmez', () => {
  assert.deepEqual(Uc.numaraListesi([]), []);
  assert.deepEqual(Uc.numaraListesi(null), []);
});
