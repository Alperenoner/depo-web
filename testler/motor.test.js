// ============================================================================
//  MOTOR TESTLERI  -  `npm test`
//
//  Bu testler rehberdeki (belgeler icindeki MAC-PROJE-REHBERI.md) DOGRULANMIS
//  referans sayilari kanitlar. Hepsi gecmeden sonraki faza gecilmez ve her
//  degisiklikten sonra tekrar calistirilir (regresyon kontrolu).
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');

const Yerlesim = require('../motor/yerlesim.js');
const { ARAC_14M, KUTULAR } = require('./ornek-kutular.js');

/** Kisayol: tek kutuyla "sigdigi kadar" plani */
function doldur(kutu, ayar) {
  return Yerlesim.planla(ARAC_14M, [{ kutu, maks: true }], ayar);
}

// ============================================================================
//  1. REFERANS ADETLER  (rehber, bolum 6.4)
// ============================================================================

test('Marlboro Koli -> 1.440 adet, %96,2 doluluk, 20.160 kg', () => {
  const p = doldur(KUTULAR.marlboroKoli);
  assert.equal(p.ozet.toplamAdet, 1440);
  assert.equal(p.ozet.toplamAgirlik, 1440 * 14); // 20.160 kg
  assert.ok(
    Math.abs(p.ozet.hacimDoluluk - 96.2) < 0.1,
    'doluluk %96,2 olmali, bulunan: ' + p.ozet.hacimDoluluk.toFixed(2)
  );
});

test('Marlboro Koli dizilisi 24 x 10 x 6 (tek blok)', () => {
  const p = doldur(KUTULAR.marlboroKoli);
  assert.equal(p.bloklar.length, 1, 'tek blok bekleniyor');
  const b = p.bloklar[0];
  assert.deepEqual([b.nx, b.ny, b.nz], [24, 10, 6]);
  // 575 x 242 x 450 durusu = "Yan yatık"
  assert.deepEqual([b.ku, b.kg, b.ky], [575, 242, 450]);
});

test('Marlboro Karton -> 74.090 adet (tek durus 73.800, artik boslukla 74.090)', () => {
  const p = doldur(KUTULAR.marlboroKarton);
  assert.equal(p.ozet.toplamAdet, 74090);
  assert.ok(
    Math.abs(p.ozet.toplamAgirlik - 20745) < 1,
    'agirlik ~20.745 kg olmali, bulunan: ' + p.ozet.toplamAgirlik
  );
  assert.ok(
    Math.abs(p.ozet.hacimDoluluk - 99.8) < 0.1,
    'doluluk %99,8 olmali, bulunan: ' + p.ozet.hacimDoluluk.toFixed(2)
  );
});

test('Marlboro Paket -> 903.756 adet, %99,2, ~23.498 kg', () => {
  const p = doldur(KUTULAR.marlboroPaket);
  assert.equal(p.ozet.toplamAdet, 903756);
  assert.ok(
    Math.abs(p.ozet.toplamAgirlik - 23498) < 1,
    'agirlik ~23.498 kg olmali, bulunan: ' + p.ozet.toplamAgirlik
  );
  assert.ok(
    Math.abs(p.ozet.hacimDoluluk - 99.2) < 0.15,
    'doluluk %99,2 olmali, bulunan: ' + p.ozet.hacimDoluluk.toFixed(2)
  );
});

test('Euro Palet (Yüklü) -> 34 adet, sinirlayan AGIRLIK', () => {
  const p = doldur(KUTULAR.euroPaletYuklu);
  assert.equal(p.ozet.toplamAdet, 34); // 24.000 / 700 = 34,28 -> 34
  assert.equal(p.ozet.toplamAgirlik, 34 * 700); // 23.800 kg

  const kap = Yerlesim.tekKutuKapasitesi(ARAC_14M, KUTULAR.euroPaletYuklu);
  assert.equal(kap.sinirlayan, 'agirlik');
});

test('Euro Palet (Boş) -> 612 adet, %90,2, 15.300 kg', () => {
  const p = doldur(KUTULAR.euroPaletBos);
  assert.equal(p.ozet.toplamAdet, 612);
  assert.equal(p.ozet.toplamAgirlik, 612 * 25); // 15.300 kg
  assert.ok(
    Math.abs(p.ozet.hacimDoluluk - 90.2) < 0.1,
    'doluluk %90,2 olmali, bulunan: ' + p.ozet.hacimDoluluk.toFixed(2)
  );
});

test('Standart Koli Orta -> 840 adet, %86,0, 12.600 kg', () => {
  const p = doldur(KUTULAR.koliOrta);
  assert.equal(p.ozet.toplamAdet, 840);
  assert.equal(p.ozet.toplamAgirlik, 840 * 15); // 12.600 kg
  assert.ok(Math.abs(p.ozet.hacimDoluluk - 86.0) < 0.1);
});

test('Standart Koli Küçük -> 2.520 adet, %96,8, 20.160 kg', () => {
  const p = doldur(KUTULAR.koliKucuk);
  assert.equal(p.ozet.toplamAdet, 2520);
  assert.equal(p.ozet.toplamAgirlik, 2520 * 8); // 20.160 kg
  assert.ok(Math.abs(p.ozet.hacimDoluluk - 96.8) < 0.1);
});

// ============================================================================
//  2. GOSTERGELER  (rehber, bolum 12: 1.440 / %96,2 / 20.160 / 13,80 m / 2,70 m / %49)
// ============================================================================

test('Gostergeler: kullanilan uzunluk 13,80 m - yuk yuksekligi 2,70 m - agirlik merkezi %49', () => {
  const o = doldur(KUTULAR.marlboroKoli).ozet;
  assert.equal(o.kullanilanUzunluk, 13800); // 24 x 575
  assert.equal(o.bosUzunluk, 200); // arkada kalan
  assert.equal(o.yukYuksekligi, 2700); // 6 x 450 = tavana dayaniyor
  assert.equal(o.bosYukseklik, 0);
  assert.ok(
    Math.abs(o.agirlikMerkezi - 49) < 0.5,
    'agirlik merkezi ~%49 olmali, bulunan: %' + o.agirlikMerkezi.toFixed(1)
  );
});

// ============================================================================
//  3. GEOMETRI DOGRULAMASI - tasan 0, ic ice gecen 0
// ============================================================================

test('1.440 kutunun hicbiri arac disina tasmiyor', () => {
  const p = doldur(KUTULAR.marlboroKoli);
  const kutular = Yerlesim.kutulariAc(p.bloklar);
  assert.equal(kutular.length, 1440);

  let tasan = 0;
  for (const k of kutular) {
    if (
      k.x < 0 ||
      k.y < 0 ||
      k.z < 0 ||
      k.x + k.u > ARAC_14M.uzunluk + 1e-9 ||
      k.y + k.g > ARAC_14M.genislik + 1e-9 ||
      k.z + k.yuk > ARAC_14M.yukseklik + 1e-9
    ) {
      tasan++;
    }
  }
  assert.equal(tasan, 0, tasan + ' kutu arac disina tasiyor');
});

test('1.440 kutunun hicbiri birbirinin icine gecmiyor', () => {
  const p = doldur(KUTULAR.marlboroKoli);
  const kutular = Yerlesim.kutulariAc(p.bloklar);

  // Kaba kuvvet O(n^2) 1440 kutu icin ~1 milyon karsilastirma - sorun degil
  let cakisan = 0;
  for (let i = 0; i < kutular.length; i++) {
    const a = kutular[i];
    for (let j = i + 1; j < kutular.length; j++) {
      const b = kutular[j];
      const cakisiyor =
        a.x < b.x + b.u - 1e-9 &&
        b.x < a.x + a.u - 1e-9 &&
        a.y < b.y + b.g - 1e-9 &&
        b.y < a.y + a.g - 1e-9 &&
        a.z < b.z + b.yuk - 1e-9 &&
        b.z < a.z + a.yuk - 1e-9;
      if (cakisiyor) cakisan++;
    }
  }
  assert.equal(cakisan, 0, cakisan + ' kutu cifti ic ice geciyor');
});

test('Karisik yukte de tasma ve cakisma yok', () => {
  const p = Yerlesim.planla(ARAC_14M, [
    { kutu: KUTULAR.marlboroKoli, adet: 400 },
    { kutu: KUTULAR.koliOrta, adet: 200 },
    { kutu: KUTULAR.koliKucuk, maks: true },
  ]);
  const kutular = Yerlesim.kutulariAc(p.bloklar);

  let tasan = 0;
  for (const k of kutular) {
    if (
      k.x < 0 ||
      k.y < 0 ||
      k.z < 0 ||
      k.x + k.u > ARAC_14M.uzunluk + 1e-9 ||
      k.y + k.g > ARAC_14M.genislik + 1e-9 ||
      k.z + k.yuk > ARAC_14M.yukseklik + 1e-9
    ) {
      tasan++;
    }
  }
  assert.equal(tasan, 0, tasan + ' kutu arac disina tasiyor');

  // Cakisma: izgara adimli oldugu icin blok bazinda kontrol yeterli degil,
  // tek tek bakiyoruz. Kutu sayisi binlerce oldugu icin kaba kuvvet yerine
  // izgara (spatial hash) kullaniyoruz.
  const kova = new Map();
  const KOVA = 1000; // mm
  let cakisan = 0;
  for (const k of kutular) {
    const x0 = Math.floor(k.x / KOVA);
    const y0 = Math.floor(k.y / KOVA);
    const z0 = Math.floor(k.z / KOVA);
    const x1 = Math.floor((k.x + k.u - 1e-6) / KOVA);
    const y1 = Math.floor((k.y + k.g - 1e-6) / KOVA);
    const z1 = Math.floor((k.z + k.yuk - 1e-6) / KOVA);
    const komsular = new Set();
    for (let a = x0; a <= x1; a++) {
      for (let b = y0; b <= y1; b++) {
        for (let c = z0; c <= z1; c++) {
          const anahtar = a + ',' + b + ',' + c;
          const liste = kova.get(anahtar);
          if (liste) for (const d of liste) komsular.add(d);
          if (!liste) kova.set(anahtar, [k]);
          else liste.push(k);
        }
      }
    }
    for (const o of komsular) {
      const cakisiyor =
        k.x < o.x + o.u - 1e-9 &&
        o.x < k.x + k.u - 1e-9 &&
        k.y < o.y + o.g - 1e-9 &&
        o.y < k.y + k.g - 1e-9 &&
        k.z < o.z + o.yuk - 1e-9 &&
        o.z < k.z + k.yuk - 1e-9;
      if (cakisiyor) cakisan++;
    }
  }
  assert.equal(cakisan, 0, cakisan + ' kutu cifti ic ice geciyor');
});

// ============================================================================
//  4. IKI ASAMALI ONCELIK  (orijinal surumdeki hatanin testi)
// ============================================================================

test('400 koli + 200 orta koli + sigdigi kadar kucuk koli -> sigmayan YOK', () => {
  const p = Yerlesim.planla(ARAC_14M, [
    { kutu: KUTULAR.marlboroKoli, adet: 400 },
    { kutu: KUTULAR.koliOrta, adet: 200 },
    { kutu: KUTULAR.koliKucuk, maks: true },
  ]);

  assert.deepEqual(p.sigmayanlar, [], 'sigmayan kalem olmamali');

  const sayac = {};
  for (const b of p.bloklar) {
    sayac[b.kutuId] = (sayac[b.kutuId] || 0) + b.adet;
  }
  assert.equal(sayac['marlboro-koli'], 400, 'tam 400 koli yerlesmeli');
  assert.equal(sayac['koli-orta'], 200, 'tam 200 orta koli yerlesmeli');

  // Rehber bu yuk icin 1.098 kucuk koli soyluyor. Bizim motor 1.159 buluyor
  // (daha iyi). Ileride bu sayinin ALTINA dusmemeli - regresyon kilidi.
  assert.ok(
    sayac['koli-kucuk'] >= 1098,
    'kucuk koli en az 1.098 olmali, bulunan: ' + sayac['koli-kucuk']
  );
});

test('Adedi belli kalem, tek basina en verimli kutu yuzunden ezilmiyor', () => {
  // Kucuk koli tek basina 2.520 sigiyor (en verimli). Adedi belli 400 koli
  // ONCE yerlesmeli, kucuk koli arta kalani doldurmali.
  const p = Yerlesim.planla(ARAC_14M, [
    { kutu: KUTULAR.marlboroKoli, adet: 400 },
    { kutu: KUTULAR.koliKucuk, maks: true },
  ]);
  const koli = p.bloklar
    .filter((b) => b.kutuId === 'marlboro-koli')
    .reduce((t, b) => t + b.adet, 0);
  assert.equal(koli, 400);
  assert.deepEqual(p.sigmayanlar, []);
});

// ============================================================================
//  5. HIZ
// ============================================================================

test('903.756 paketlik plan 50 ms altinda biter', () => {
  const basla = process.hrtime.bigint();
  const p = doldur(KUTULAR.marlboroPaket);
  const gecenMs = Number(process.hrtime.bigint() - basla) / 1e6;

  assert.equal(p.ozet.toplamAdet, 903756);
  assert.ok(gecenMs < 50, 'sure ' + gecenMs.toFixed(2) + ' ms - cok yavas');
});

// ============================================================================
//  6. STRATEJI KARSILASTIRMASI  (rehber, bolum 12)
//     Akilli Blok 1.440 - Enine 1.368 (-%5,0) - Dik 1.364 (-%5,3)
// ============================================================================

test('Karsilastirma: Akilli 1.440, Enine 1.368, Dik 1.364', () => {
  const sonuclar = Yerlesim.hepsiniHesapla(ARAC_14M, [
    { kutu: KUTULAR.marlboroKoli, maks: true },
  ]);
  const bul = (id) => sonuclar.find((s) => s.id === id);

  assert.equal(bul('akilli').adet, 1440);
  assert.equal(bul('enine').adet, 1368);
  assert.equal(bul('dik').adet, 1364);

  assert.equal(bul('akilli').enIyi, true, 'Akilli Blok en iyi olmali');
  assert.ok(
    Math.abs(bul('enine').fark - -5.0) < 0.1,
    'Enine farki -%5,0 olmali, bulunan: ' + bul('enine').fark.toFixed(1)
  );
  assert.ok(
    Math.abs(bul('dik').fark - -5.3) < 0.1,
    'Dik farki -%5,3 olmali, bulunan: ' + bul('dik').fark.toFixed(1)
  );
});

// ============================================================================
//  7. KURALLAR: istif siniri, yatirilamaz, agirlik siniri, pay
// ============================================================================

test('maksIstif = 1 ise ustune yuk konmaz', () => {
  const kutu = Object.assign({}, KUTULAR.koliOrta, {
    id: 'tek-kat',
    maksIstif: 1,
  });
  const p = doldur(kutu);

  // Tek kat: her blogun nz'si 1 olmali
  for (const b of p.bloklar) {
    assert.equal(b.nz, 1, 'nz 1 olmali, bulunan: ' + b.nz);
  }
  // Hicbir kutu zemin disinda olmamali
  const kutular = Yerlesim.kutulariAc(p.bloklar);
  for (const k of kutular) assert.equal(k.z, 0, 'kutu zeminde olmali');
});

test('maksIstif = 3 ise en fazla 3 kat', () => {
  const kutu = Object.assign({}, KUTULAR.koliKucuk, {
    id: 'uc-kat',
    maksIstif: 3,
  });
  const p = doldur(kutu);
  for (const b of p.bloklar) assert.ok(b.nz <= 3, 'nz 3ten buyuk: ' + b.nz);
});

test('yatirilabilir = false ise kutu hep dik durur', () => {
  const kutu = Object.assign({}, KUTULAR.koliOrta, {
    id: 'yatirilamaz',
    yatirilabilir: false,
    uzunluk: 600,
    genislik: 400,
    yukseklik: 500, // ucu de farkli olsun ki test anlamli olsun
  });
  const p = doldur(kutu);
  for (const b of p.bloklar) {
    assert.equal(b.ky, 500, 'dikey eksende kutunun yuksekligi olmali');
  }
});

test('Agirlik siniri kapatilirsa sadece hacme bakar', () => {
  // Hacim olarak 840 sigan ama 100 kg olan bir kutu: agirlik gercekten baglayici.
  // 24.000 / 100 = 240 adet.
  const agir = Object.assign({}, KUTULAR.koliOrta, { id: 'agir', agirlik: 100 });

  const sinirli = doldur(agir, { agirlikSiniri: true });
  const sinirsiz = doldur(agir, { agirlikSiniri: false });

  assert.equal(sinirli.ozet.toplamAdet, 240, 'sinirli: 24.000/100 = 240');
  assert.equal(sinirli.ozet.toplamAgirlik, 24000, 'kapasite tam dolmali');

  assert.equal(sinirsiz.ozet.toplamAdet, 840, 'sinirsiz: hacim kapasitesi 840');
  assert.ok(sinirsiz.ozet.toplamAgirlik > 24000, 'sinirsizda kapasite asilmali');
});

test('Sinirlayan etken dogru bildirilir (hacim / agirlik)', () => {
  const kap = (kutu) => Yerlesim.tekKutuKapasitesi(ARAC_14M, kutu).sinirlayan;

  // Rehber bolum 6.4: sadece Yuklu Palet agirlikla sinirli, gerisi hacimle
  assert.equal(kap(KUTULAR.euroPaletYuklu), 'agirlik');
  assert.equal(kap(KUTULAR.marlboroKoli), 'hacim');
  assert.equal(kap(KUTULAR.marlboroKarton), 'hacim');
  assert.equal(kap(KUTULAR.marlboroPaket), 'hacim'); // agirliga cok yakin ama hacim
  assert.equal(kap(KUTULAR.euroPaletBos), 'hacim');
  assert.equal(kap(KUTULAR.koliOrta), 'hacim');
  assert.equal(kap(KUTULAR.koliKucuk), 'hacim');
});

test('Kutular arasi pay adedi dusurur', () => {
  const paysiz = doldur(KUTULAR.koliOrta, { pay: 0 });
  const payli = doldur(KUTULAR.koliOrta, { pay: 20 });
  assert.equal(paysiz.ozet.toplamAdet, 840);
  assert.ok(
    payli.ozet.toplamAdet < paysiz.ozet.toplamAdet,
    'payli plan daha az kutu almali'
  );
  // Payli planda cizim olcusu hala gercek kutu olcusu olmali
  for (const b of payli.bloklar) {
    const olculer = [b.ku, b.kg, b.ky].sort((a, c) => a - c);
    assert.deepEqual(olculer, [400, 400, 600]);
  }
});

// ============================================================================
//  8. BLOK BOLME  (rehber, bolum 8.5)
// ============================================================================

test('Adet tam izgaraya denk gelmezse blok parcalara bolunur, toplam korunur', () => {
  const p = Yerlesim.planla(ARAC_14M, [
    { kutu: KUTULAR.marlboroKoli, adet: 100 },
  ]);
  const toplam = p.bloklar.reduce((t, b) => t + b.adet, 0);
  assert.equal(toplam, 100, 'toplam tam 100 olmali');
  assert.deepEqual(p.sigmayanlar, []);

  // Her parca duzgun bir izgara olmali (nx, ny, nz carpimi = adet)
  for (const b of p.bloklar) {
    assert.equal(b.nx * b.ny * b.nz, b.adet);
  }

  // Rehberdeki ornek BIREBIR: 1x5x11 = 55  +  1x4x11 = 44  +  1x1x1 = 1
  const izgaralar = p.bloklar.map((b) => [b.nx, b.ny, b.nz]);
  assert.deepEqual(izgaralar, [
    [1, 5, 11],
    [1, 4, 11],
    [1, 1, 1],
  ]);
});

test('Blok bolmede de cakisma yok (100, 137, 999 adet)', () => {
  for (const istenen of [100, 137, 999]) {
    const p = Yerlesim.planla(ARAC_14M, [
      { kutu: KUTULAR.marlboroKoli, adet: istenen },
    ]);
    assert.equal(
      p.bloklar.reduce((t, b) => t + b.adet, 0),
      istenen,
      istenen + ' adet icin toplam yanlis'
    );

    const kutular = Yerlesim.kutulariAc(p.bloklar);
    let cakisan = 0;
    for (let i = 0; i < kutular.length; i++) {
      for (let j = i + 1; j < kutular.length; j++) {
        const a = kutular[i];
        const b = kutular[j];
        if (
          a.x < b.x + b.u - 1e-9 &&
          b.x < a.x + a.u - 1e-9 &&
          a.y < b.y + b.g - 1e-9 &&
          b.y < a.y + a.g - 1e-9 &&
          a.z < b.z + b.yuk - 1e-9 &&
          b.z < a.z + a.yuk - 1e-9
        ) {
          cakisan++;
        }
      }
    }
    assert.equal(cakisan, 0, istenen + ' adette ' + cakisan + ' cakisma');
  }
});

// ============================================================================
//  9. SIGMAYANLAR
// ============================================================================

test('Sigmayan varsa dogru bildirilir', () => {
  const p = Yerlesim.planla(ARAC_14M, [
    { kutu: KUTULAR.marlboroKoli, adet: 5000 }, // 1.440 sigiyor
  ]);
  assert.equal(p.sigmayanlar.length, 1);
  const s = p.sigmayanlar[0];
  assert.equal(s.kutuId, 'marlboro-koli');
  assert.equal(s.istenen, 5000);
  assert.ok(s.yerlesen > 0 && s.yerlesen < 5000);
  assert.equal(s.kalan, 5000 - s.yerlesen);
});

// ============================================================================
//  10. SINIR DURUMLARI  (cokmemesi gerekir)
// ============================================================================

test('Bos/gecersiz girdilerde cokmez, bos plan doner', () => {
  const bosArac = Yerlesim.planla({ uzunluk: 0, genislik: 0, yukseklik: 0 }, []);
  assert.equal(bosArac.ozet.toplamAdet, 0);
  assert.deepEqual(bosArac.bloklar, []);

  const kalemsiz = Yerlesim.planla(ARAC_14M, []);
  assert.equal(kalemsiz.ozet.toplamAdet, 0);

  const bozukKutu = Yerlesim.planla(ARAC_14M, [
    { kutu: { id: 'x', uzunluk: 0, genislik: 0, yukseklik: 0 }, maks: true },
  ]);
  assert.equal(bozukKutu.ozet.toplamAdet, 0);

  assert.equal(Yerlesim.planla(null, null).ozet.toplamAdet, 0);
});

test('Araca hic sigmayacak kadar buyuk kutu -> 0 adet, cokmez', () => {
  const dev = {
    id: 'dev',
    ad: 'Dev',
    uzunluk: 20000,
    genislik: 5000,
    yukseklik: 5000,
    agirlik: 1,
  };
  const p = Yerlesim.planla(ARAC_14M, [{ kutu: dev, adet: 1 }]);
  assert.equal(p.ozet.toplamAdet, 0);
  assert.equal(p.sigmayanlar.length, 1);
  assert.equal(p.sigmayanlar[0].kalan, 1);
});

test('Agirligi 0 olan kutu kapasite hesabini bozmaz', () => {
  const hafif = Object.assign({}, KUTULAR.koliOrta, { id: 'hafif', agirlik: 0 });
  const p = doldur(hafif);
  assert.equal(p.ozet.toplamAdet, 840);
  assert.equal(p.ozet.toplamAgirlik, 0);
  assert.equal(p.ozet.agirlikMerkezi, 0); // agirlik yoksa merkez tanimsiz -> 0
});
