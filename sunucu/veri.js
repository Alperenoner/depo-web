// ============================================================================
//  VERI KATMANI
//  Veritabani ile konusan tek yer. server.js SQL yazmaz, buradaki
//  fonksiyonlari cagirir.
//
//  Veritabani alan adlari snake_case (maks_agirlik), arayuz camelCase
//  (maksAgirlik) kullanir. Cevirme burada yapilir.
// ============================================================================

'use strict';

const { sorgu, islem } = require('./veritabani/baglanti');

const YEDEK_LIMIT = 40;

// ---------------------------------------------------------------------------
//  Satir -> arayuz nesnesi cevirmenleri
// ---------------------------------------------------------------------------

function aracCevir(s) {
  if (!s) return null;
  return {
    id: s.id,
    ad: s.ad,
    uzunluk: s.uzunluk,
    genislik: s.genislik,
    yukseklik: s.yukseklik,
    maksAgirlik: s.maks_agirlik,
    sablon: s.sablon,
    aktif: s.aktif,
  };
}

function kutuCevir(s) {
  if (!s) return null;
  return {
    id: s.id,
    ad: s.ad,
    grup: s.grup,
    uzunluk: s.uzunluk,
    genislik: s.genislik,
    yukseklik: s.yukseklik,
    agirlik: Number(s.agirlik), // numeric -> JS sayisi
    renk: s.renk,
    yatirilabilir: s.yatirilabilir,
    maksIstif: s.maks_istif,
    icerik: s.icerik,
    aciklama: s.aciklama,
    material: s.material,
    format: s.format,
  };
}

function planCevir(s) {
  if (!s) return null;
  return {
    id: s.id,
    ad: s.ad,
    arac: s.arac,
    strateji: s.strateji,
    kalemler: s.kalemler,
    ayarlar: s.ayarlar,
    ozet: s.ozet,
    aciklama: s.aciklama,
    tarih: s.tarih,
  };
}

// ---------------------------------------------------------------------------
//  AYARLAR
// ---------------------------------------------------------------------------

async function ayarlariOku() {
  const { rows } = await sorgu('select baslik, alt_baslik from ayarlar where id = 1');
  if (rows.length === 0) return { baslik: 'DEPOLAMA', altBaslik: 'Tır Yükleme Planlayıcı' };
  return { baslik: rows[0].baslik, altBaslik: rows[0].alt_baslik };
}

async function ayarlariYaz(ayarlar) {
  await sorgu(
    `insert into ayarlar (id, baslik, alt_baslik, guncellendi)
     values (1, $1, $2, now())
     on conflict (id) do update
       set baslik = $1, alt_baslik = $2, guncellendi = now()`,
    [ayarlar.baslik, ayarlar.altBaslik]
  );
}

// ---------------------------------------------------------------------------
//  ARACLAR
// ---------------------------------------------------------------------------

async function araclariOku() {
  const { rows } = await sorgu(
    'select * from araclar order by sira, olusturuldu'
  );
  return rows.map(aracCevir);
}

async function aktifAracOku() {
  const { rows } = await sorgu('select * from araclar where aktif limit 1');
  return rows.length ? aracCevir(rows[0]) : null;
}

/**
 * Araci ekler veya gunceller. aktifYap = true ise digerlerinin aktifligi kalkar.
 */
async function aracKaydet(arac, aktifYap) {
  return islem(async (baglanti) => {
    await baglanti.query(
      `insert into araclar
         (id, ad, uzunluk, genislik, yukseklik, maks_agirlik, sablon)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do update set
         ad = $2, uzunluk = $3, genislik = $4,
         yukseklik = $5, maks_agirlik = $6, sablon = $7`,
      [
        arac.id,
        arac.ad,
        arac.uzunluk,
        arac.genislik,
        arac.yukseklik,
        arac.maksAgirlik,
        arac.sablon === true,
      ]
    );

    if (aktifYap) {
      // Once hepsini pasife al, sonra bunu aktif yap.
      // (araclar_tek_aktif indeksi ayni anda iki aktif kayda izin vermez)
      await baglanti.query('update araclar set aktif = false where aktif');
      await baglanti.query('update araclar set aktif = true where id = $1', [arac.id]);
    }

    const { rows } = await baglanti.query('select * from araclar where id = $1', [
      arac.id,
    ]);
    return aracCevir(rows[0]);
  });
}

async function aracSil(id) {
  const { rowCount } = await sorgu('delete from araclar where id = $1', [id]);
  return rowCount > 0;
}

async function aracAktifYap(id) {
  return islem(async (baglanti) => {
    const { rowCount } = await baglanti.query('select 1 from araclar where id = $1', [id]);
    if (rowCount === 0) return false;
    await baglanti.query('update araclar set aktif = false where aktif');
    await baglanti.query('update araclar set aktif = true where id = $1', [id]);
    return true;
  });
}

// ---------------------------------------------------------------------------
//  KUTULAR
// ---------------------------------------------------------------------------

async function kutulariOku() {
  const { rows } = await sorgu('select * from kutular order by sira, olusturuldu');
  return rows.map(kutuCevir);
}

async function kutuSayisi() {
  const { rows } = await sorgu('select count(*)::int as n from kutular');
  return rows[0].n;
}

async function kutuKaydet(kutu) {
  const { rows } = await sorgu(
    `insert into kutular
       (id, ad, grup, uzunluk, genislik, yukseklik, agirlik, renk,
        yatirilabilir, maks_istif, icerik, aciklama, material, format)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     on conflict (id) do update set
       ad = $2, grup = $3, uzunluk = $4, genislik = $5, yukseklik = $6,
       agirlik = $7, renk = $8, yatirilabilir = $9, maks_istif = $10,
       icerik = $11, aciklama = $12, material = $13, format = $14
     returning *`,
    [
      kutu.id,
      kutu.ad,
      kutu.grup,
      kutu.uzunluk,
      kutu.genislik,
      kutu.yukseklik,
      kutu.agirlik,
      kutu.renk,
      kutu.yatirilabilir,
      kutu.maksIstif,
      kutu.icerik,
      kutu.aciklama,
      kutu.material,
      kutu.format,
    ]
  );
  return kutuCevir(rows[0]);
}

async function kutuSil(id) {
  const { rowCount } = await sorgu('delete from kutular where id = $1', [id]);
  return rowCount > 0;
}

// ---------------------------------------------------------------------------
//  PLANLAR
// ---------------------------------------------------------------------------

async function planlariOku() {
  const { rows } = await sorgu('select * from planlar order by tarih desc');
  return rows.map(planCevir);
}

async function planSayisi() {
  const { rows } = await sorgu('select count(*)::int as n from planlar');
  return rows[0].n;
}

async function planKaydet(plan) {
  const { rows } = await sorgu(
    `insert into planlar
       (id, ad, arac, strateji, kalemler, ayarlar, ozet, aciklama, tarih)
     values ($1,$2,$3,$4,$5,$6,$7,$8, now())
     on conflict (id) do update set
       ad = $2, arac = $3, strateji = $4, kalemler = $5,
       ayarlar = $6, ozet = $7, aciklama = $8, tarih = now()
     returning *`,
    [
      plan.id,
      plan.ad,
      JSON.stringify(plan.arac),
      plan.strateji,
      JSON.stringify(plan.kalemler),
      JSON.stringify(plan.ayarlar),
      JSON.stringify(plan.ozet),
      plan.aciklama,
    ]
  );
  return planCevir(rows[0]);
}

async function planSil(id) {
  const { rowCount } = await sorgu('delete from planlar where id = $1', [id]);
  return rowCount > 0;
}

// ---------------------------------------------------------------------------
//  YONETICI
// ---------------------------------------------------------------------------

async function yoneticiOku() {
  const { rows } = await sorgu(
    'select kullanici, tuz, ozet, ad from yonetici where id = 1'
  );
  return rows.length ? rows[0] : null;
}

async function yoneticiYaz({ kullanici, tuz, ozet, ad }) {
  await sorgu(
    `insert into yonetici (id, kullanici, tuz, ozet, ad, guncellendi)
     values (1, $1, $2, $3, $4, now())
     on conflict (id) do update set
       kullanici = $1, tuz = $2, ozet = $3, ad = $4, guncellendi = now()`,
    [kullanici, tuz, ozet, ad || '']
  );
}

// ---------------------------------------------------------------------------
//  YEDEKLER
//  Her yazma isleminde butun verinin kopyasi alinir, son 40 tanesi tutulur.
// ---------------------------------------------------------------------------

async function tumVeriyiTopla() {
  const [ayarlar, araclar, kutular, planlar] = await Promise.all([
    ayarlariOku(),
    araclariOku(),
    kutulariOku(),
    planlariOku(),
  ]);
  return { ayarlar, araclar, kutular, planlar };
}

async function yedekAl(sebep) {
  const icerik = await tumVeriyiTopla();
  await sorgu('insert into yedekler (sebep, icerik) values ($1, $2)', [
    String(sebep || '').slice(0, 120),
    JSON.stringify(icerik),
  ]);
  // Eskileri sil - son YEDEK_LIMIT tanesi kalsin
  await sorgu(
    `delete from yedekler
      where id not in (select id from yedekler order by tarih desc limit $1)`,
    [YEDEK_LIMIT]
  );
}

async function yedekleriListele() {
  const { rows } = await sorgu(
    'select id, tarih, sebep from yedekler order by tarih desc'
  );
  return rows;
}

// ---------------------------------------------------------------------------
//  Arayuzun tek seferde ihtiyac duydugu her sey
// ---------------------------------------------------------------------------

async function panoVerisi() {
  const [ayarlar, araclar, kutular, planlar] = await Promise.all([
    ayarlariOku(),
    araclariOku(),
    kutulariOku(),
    planlariOku(),
  ]);

  return {
    ayarlar,
    // Aktif arac ayri veriliyor ki arayuz aramak zorunda kalmasin.
    // Hicbir arac yoksa null - arayuz "Kayitli arac yok" ekranini gosterir.
    aracAktif: araclar.find((a) => a.aktif) || null,
    araclar,
    aracSablonlari: araclar.filter((a) => a.sablon),
    kutular,
    planlar,
    // Sinirlarin TAMAMI arayuze veriliyor: form dogrulamasi ile sunucu
    // dogrulamasi ayni sayilari kullansin, iki yerde ayri yasamasin.
    // (Sunucu yine de her girdiyi kendisi dogrular - bu sadece kolaylik.)
    sinirlar: require('./dogrula').SINIR,
    // Format secenekleri sunucudan geliyor: arayuz listeyi elle yazmasin,
    // iki taraf ayrisamasin (bkz. dogrula.js FORMATLAR).
    formatlar: require('./dogrula').FORMATLAR,
  };
}

module.exports = {
  YEDEK_LIMIT,
  ayarlariOku,
  ayarlariYaz,
  araclariOku,
  aktifAracOku,
  aracKaydet,
  aracSil,
  aracAktifYap,
  kutulariOku,
  kutuSayisi,
  kutuKaydet,
  kutuSil,
  planlariOku,
  planSayisi,
  planKaydet,
  planSil,
  yoneticiOku,
  yoneticiYaz,
  yedekAl,
  yedekleriListele,
  tumVeriyiTopla,
  panoVerisi,
};
