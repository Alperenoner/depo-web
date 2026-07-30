// ============================================================================
//  CIZIM TESTLERI  -  `npm test`  (FAZ 3b)
//
//  cizim.js'in cizgi ceken kismi tuval istiyor, Node'da calismaz. Ama KATMAN
//  MANTIGI saf hesap: hangi kesitte hangi kutu gorunuyor sorusunun cevabi.
//  Katman kaydiricisi bunun uzerine kurulu, o yuzden burada kanitlaniyor.
//
//  Bir kesit yanlis hesaplanirsa kullanici yuku eksik gorur ve fark etmez -
//  ekranda "bos" gorunen yer aslinda dolu olur. Sessiz hata, teste deger.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');

const Yerlesim = require('../motor/yerlesim.js');
const Cizim = require('../public/cizim.js');
const { ARAC_14M, KUTULAR } = require('./ornek-kutular.js');

// ============================================================================
//  1. KATMAN LISTESI
// ============================================================================

test('Marlboro Koli 6 kat -> 6 katman, tabanlar 0/450/900/1350/1800/2250', () => {
  const p = Yerlesim.planla(ARAC_14M, [{ kutu: KUTULAR.marlboroKoli, maks: true }]);
  const k = Cizim.katmanlar(p.bloklar);

  // Blok 24 x 10 x 6, kutu yuksekligi 450 mm (yan yatik durus)
  assert.deepEqual(k, [0, 450, 900, 1350, 1800, 2250]);
});

test('Bos plan -> katman yok', () => {
  assert.deepEqual(Cizim.katmanlar([]), []);
  assert.deepEqual(Cizim.katmanlar(null), []);
});

test('Katmanlar artan sirada ve tekrarsiz doner', () => {
  // Iki farkli kutu -> bloklar farkli yuksekliklerde baslar
  const p = Yerlesim.planla(ARAC_14M, [
    { kutu: KUTULAR.koliOrta, adet: 200 },
    { kutu: KUTULAR.koliKucuk, maks: true },
  ]);
  const k = Cizim.katmanlar(p.bloklar);

  assert.ok(k.length > 1, 'birden fazla katman bekleniyor');
  for (let i = 1; i < k.length; i++) {
    assert.ok(k[i] > k[i - 1], 'sirali ve tekrarsiz olmali: ' + k.join(','));
  }
});

// ============================================================================
//  2. KESIT HANGI KATI GOSTERIYOR
// ============================================================================

test('katmanKati her kati dogru bulur', () => {
  const b = { z: 0, adimY: 450, ky: 450, nz: 6 };

  assert.equal(Cizim.katmanKati(b, 0), 0);
  assert.equal(Cizim.katmanKati(b, 449), 0); // hala 1. kat
  assert.equal(Cizim.katmanKati(b, 450), 1);
  assert.equal(Cizim.katmanKati(b, 2250), 5); // son kat
});

test('Kesit blogun altinda ya da ustunde kalirsa kutu yok (-1)', () => {
  const b = { z: 1000, adimY: 400, ky: 400, nz: 2 }; // 1000..1800 arasi dolu

  assert.equal(Cizim.katmanKati(b, 0), -1, 'blogun altinda');
  assert.equal(Cizim.katmanKati(b, 999), -1, 'blogun hemen altinda');
  assert.equal(Cizim.katmanKati(b, 1000), 0);
  assert.equal(Cizim.katmanKati(b, 1799), 1);
  assert.equal(Cizim.katmanKati(b, 1800), -1, 'blogun ustunde');
});

test('Kesit kutular arasi PAYA denk gelirse o katta kutu yok', () => {
  // adimY (500) kutudan (400) buyuk -> her katin ustunde 100 mm pay var.
  // Kesit paya denk geliyorsa orada kutu YOK; blogu cizmemek gerekir.
  const b = { z: 0, adimY: 500, ky: 400, nz: 3 };

  assert.equal(Cizim.katmanKati(b, 0), 0);
  assert.equal(Cizim.katmanKati(b, 399), 0);
  assert.equal(Cizim.katmanKati(b, 400), -1, 'pay boslugu - kutu yok');
  assert.equal(Cizim.katmanKati(b, 499), -1, 'pay boslugu - kutu yok');
  assert.equal(Cizim.katmanKati(b, 500), 1, 'ikinci kat basliyor');
});

// ============================================================================
//  3. KAPSAMA: HICBIR KUTU GORUNMEZ KALMAZ
//
//  Asil garanti bu. Katman kaydiricisini bastan sona gezdiren kullanici yukun
//  TAMAMINI gormus olmali - hicbir kat hicbir kesitte disarda kalmamali.
//  Aksi halde ekranda "bos" gorunen yer aslinda dolu olur, sessiz hata.
//
//  DIKKAT - katmanlar bir BOLUMLEME DEGIL, KESIT DUZLEMIDIR:
//  farkli boyda kutular varsa bir kutu birden fazla kesiti keser ve hepsinde
//  gorunur. Bu dogru davranis; 450 mm'lik bir kutu 300 mm'deki kesitte de
//  fiziksel olarak oradadir. O yuzden "toplam adede esit" diye bir kural yok.
// ============================================================================

test('Karisik yukte her blogun her kati bir kesitte gorunur', () => {
  const p = Yerlesim.planla(ARAC_14M, [
    { kutu: KUTULAR.marlboroKoli, adet: 500 },
    { kutu: KUTULAR.koliKucuk, maks: true },
  ]);
  const katmanlar = Cizim.katmanlar(p.bloklar);
  assert.ok(p.bloklar.length > 1, 'karisik yuk bekleniyor');

  for (const b of p.bloklar) {
    for (let k = 0; k < b.nz; k++) {
      const bulundu = katmanlar.some((z) => Cizim.katmanKati(b, z) === k);
      assert.ok(bulundu, 'kat ' + k + ' hicbir kesitte gorunmuyor (z=' + b.z + ')');
    }
  }
});

test('Tek cesit kutuda katmanlar tam bolumleme yapar - toplam adede esit', () => {
  // Butun kutular ayni yukseklikte oldugunda kesitler cakismaz; o zaman
  // katmanlarin toplami plandaki adedin TAM kendisi olmali.
  const p = Yerlesim.planla(ARAC_14M, [{ kutu: KUTULAR.marlboroKoli, maks: true }]);
  const katmanlar = Cizim.katmanlar(p.bloklar);

  let sayilan = 0;
  for (const z of katmanlar) {
    for (const b of p.bloklar) {
      // Bu kesitte blogun bir kati varsa o katin tamami (nx * ny) gorunur
      if (Cizim.katmanKati(b, z) >= 0) sayilan += b.nx * b.ny;
    }
  }

  assert.equal(
    sayilan, p.ozet.toplamAdet,
    'katmanlarin toplami ' + sayilan + ', plandaki adet ' + p.ozet.toplamAdet
  );
});

test('Farkli boyda kutu bir kesiti keserse orada da gorunur (bolumleme yok)', () => {
  // 450 boyunda blok z=0'da, 300 boyunda blok z=0'da: 300 kesitinde
  // ikincinin 2. kati basliyor, ilkinin 1. kati HALA orada.
  const uzun = { z: 0, adimY: 450, ky: 450, nz: 2 };
  const kisa = { z: 0, adimY: 300, ky: 300, nz: 3 };

  assert.equal(Cizim.katmanKati(uzun, 300), 0, 'uzun kutu 300 kesitinde duruyor');
  assert.equal(Cizim.katmanKati(kisa, 300), 1, 'kisa kutunun 2. kati');
});

// ============================================================================
//  4. BIRIM YAZIMI  (arayuzde gorunen metin)
// ============================================================================

test('cmYaz mm -> cm, gereksiz sifir yazmaz', () => {
  assert.equal(Cizim.cmYaz(2480), '248');
  assert.equal(Cizim.cmYaz(242), '24,2');
  assert.equal(Cizim.cmYaz(0), '0');
});

test('metreYaz mm -> iki basamakli metre', () => {
  assert.equal(Cizim.metreYaz(14000), '14,00 m');
  assert.equal(Cizim.metreYaz(1380), '1,38 m');
  assert.equal(Cizim.metreYaz(0), '0,00 m');
});
