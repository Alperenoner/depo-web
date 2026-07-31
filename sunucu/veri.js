// ============================================================================
//  VERI KATMANI
//  Veritabani ile konusan tek yer. server.js SQL yazmaz, buradaki
//  fonksiyonlari cagirir.
//
//  Veritabani alan adlari snake_case (maks_agirlik), arayuz camelCase
//  (maksAgirlik) kullanir. Cevirme burada yapilir.
//
//  HER HESABIN KENDI VERISI VAR (31 Tem 2026). Bu yuzden veriye dokunan
//  her fonksiyonun ILK parametresi `kullaniciId`. Kural tek istisnasiz:
//  hicbir sorgu `where kullanici_id` suzgeci olmadan calismaz. Unutulan bir
//  suzgec, bir kullaniciya baskasinin katalogunu gosterir.
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

async function ayarlariOku(kullaniciId) {
  const { rows } = await sorgu(
    'select baslik, alt_baslik from ayarlar where kullanici_id = $1',
    [kullaniciId]
  );
  // Yeni hesabin daha hic ayar satiri yoktur - varsayilanlarla baslar.
  if (rows.length === 0) return { baslik: 'DEPOLAMA', altBaslik: 'Tır Yükleme Planlayıcı' };
  return { baslik: rows[0].baslik, altBaslik: rows[0].alt_baslik };
}

async function ayarlariYaz(kullaniciId, ayarlar) {
  await sorgu(
    `insert into ayarlar (kullanici_id, baslik, alt_baslik, guncellendi)
     values ($1, $2, $3, now())
     on conflict (kullanici_id) do update
       set baslik = $2, alt_baslik = $3, guncellendi = now()`,
    [kullaniciId, ayarlar.baslik, ayarlar.altBaslik]
  );
}

// ---------------------------------------------------------------------------
//  ARACLAR
// ---------------------------------------------------------------------------

async function araclariOku(kullaniciId) {
  const { rows } = await sorgu(
    'select * from araclar where kullanici_id = $1 order by sira, olusturuldu',
    [kullaniciId]
  );
  return rows.map(aracCevir);
}

async function aktifAracOku(kullaniciId) {
  const { rows } = await sorgu(
    'select * from araclar where kullanici_id = $1 and aktif limit 1',
    [kullaniciId]
  );
  return rows.length ? aracCevir(rows[0]) : null;
}

/**
 * Araci ekler veya gunceller. aktifYap = true ise KENDI araclarindan
 * digerlerinin aktifligi kalkar (baskasininkine dokunmaz).
 *
 * BASKASININ kaydinin uzerine yazilmak istenirse null doner. id'ler tablo
 * genelinde benzersiz; suzgec olmasa "on conflict do update" baska bir
 * hesabin aracini sessizce degistirirdi.
 *
 * @returns {Promise<object|null>} null = kayit baskasina ait
 */
async function aracKaydet(kullaniciId, arac, aktifYap) {
  return islem(async (baglanti) => {
    const { rows } = await baglanti.query(
      `insert into araclar
         (id, kullanici_id, ad, uzunluk, genislik, yukseklik, maks_agirlik, sablon)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (id) do update set
         ad = $3, uzunluk = $4, genislik = $5,
         yukseklik = $6, maks_agirlik = $7, sablon = $8
       where araclar.kullanici_id = $2
       returning *`,
      [
        arac.id,
        kullaniciId,
        arac.ad,
        arac.uzunluk,
        arac.genislik,
        arac.yukseklik,
        arac.maksAgirlik,
        arac.sablon === true,
      ]
    );

    // Catisma vardi ama satir bizim degil -> hicbir sey donmez
    if (rows.length === 0) return null;

    if (aktifYap) {
      // Once kendi araclarimizi pasife al, sonra bunu aktif yap.
      // (araclar_tek_aktif_kullanici indeksi hesap basina tek aktife izin verir)
      await baglanti.query(
        'update araclar set aktif = false where kullanici_id = $1 and aktif',
        [kullaniciId]
      );
      await baglanti.query(
        'update araclar set aktif = true where id = $1 and kullanici_id = $2',
        [arac.id, kullaniciId]
      );
      const taze = await baglanti.query('select * from araclar where id = $1', [arac.id]);
      return aracCevir(taze.rows[0]);
    }

    return aracCevir(rows[0]);
  });
}

async function aracSil(kullaniciId, id) {
  const { rowCount } = await sorgu(
    'delete from araclar where id = $1 and kullanici_id = $2',
    [id, kullaniciId]
  );
  return rowCount > 0;
}

async function aracAktifYap(kullaniciId, id) {
  return islem(async (baglanti) => {
    const { rowCount } = await baglanti.query(
      'select 1 from araclar where id = $1 and kullanici_id = $2',
      [id, kullaniciId]
    );
    if (rowCount === 0) return false;
    await baglanti.query(
      'update araclar set aktif = false where kullanici_id = $1 and aktif',
      [kullaniciId]
    );
    await baglanti.query(
      'update araclar set aktif = true where id = $1 and kullanici_id = $2',
      [id, kullaniciId]
    );
    return true;
  });
}

// ---------------------------------------------------------------------------
//  KUTULAR
// ---------------------------------------------------------------------------

async function kutulariOku(kullaniciId) {
  const { rows } = await sorgu(
    'select * from kutular where kullanici_id = $1 order by sira, olusturuldu',
    [kullaniciId]
  );
  return rows.map(kutuCevir);
}

async function kutuSayisi(kullaniciId) {
  const { rows } = await sorgu(
    'select count(*)::int as n from kutular where kullanici_id = $1',
    [kullaniciId]
  );
  return rows[0].n;
}

/** @returns {Promise<object|null>} null = kayit baskasina ait (bkz. aracKaydet) */
async function kutuKaydet(kullaniciId, kutu) {
  const { rows } = await sorgu(
    `insert into kutular
       (id, kullanici_id, ad, grup, uzunluk, genislik, yukseklik, agirlik, renk,
        yatirilabilir, maks_istif, icerik, aciklama, material, format)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     on conflict (id) do update set
       ad = $3, grup = $4, uzunluk = $5, genislik = $6, yukseklik = $7,
       agirlik = $8, renk = $9, yatirilabilir = $10, maks_istif = $11,
       icerik = $12, aciklama = $13, material = $14, format = $15
     where kutular.kullanici_id = $2
     returning *`,
    [
      kutu.id,
      kullaniciId,
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
  return rows.length ? kutuCevir(rows[0]) : null;
}

async function kutuSil(kullaniciId, id) {
  const { rowCount } = await sorgu(
    'delete from kutular where id = $1 and kullanici_id = $2',
    [id, kullaniciId]
  );
  return rowCount > 0;
}

// ---------------------------------------------------------------------------
//  PLANLAR
// ---------------------------------------------------------------------------

async function planlariOku(kullaniciId) {
  const { rows } = await sorgu(
    'select * from planlar where kullanici_id = $1 order by tarih desc',
    [kullaniciId]
  );
  return rows.map(planCevir);
}

async function planSayisi(kullaniciId) {
  const { rows } = await sorgu(
    'select count(*)::int as n from planlar where kullanici_id = $1',
    [kullaniciId]
  );
  return rows[0].n;
}

/** @returns {Promise<object|null>} null = kayit baskasina ait (bkz. aracKaydet) */
async function planKaydet(kullaniciId, plan) {
  const { rows } = await sorgu(
    `insert into planlar
       (id, kullanici_id, ad, arac, strateji, kalemler, ayarlar, ozet, aciklama, tarih)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
     on conflict (id) do update set
       ad = $3, arac = $4, strateji = $5, kalemler = $6,
       ayarlar = $7, ozet = $8, aciklama = $9, tarih = now()
     where planlar.kullanici_id = $2
     returning *`,
    [
      plan.id,
      kullaniciId,
      plan.ad,
      JSON.stringify(plan.arac),
      plan.strateji,
      JSON.stringify(plan.kalemler),
      JSON.stringify(plan.ayarlar),
      JSON.stringify(plan.ozet),
      plan.aciklama,
    ]
  );
  return rows.length ? planCevir(rows[0]) : null;
}

async function planSil(kullaniciId, id) {
  const { rowCount } = await sorgu(
    'delete from planlar where id = $1 and kullanici_id = $2',
    [id, kullaniciId]
  );
  return rowCount > 0;
}

// ---------------------------------------------------------------------------
//  YONETICI
// ---------------------------------------------------------------------------

//  30 Tem 2026'ya kadar TEK hesap vardi (yonetici.id hep 1). Artik birden
//  fazla kullanici olabiliyor; hepsi ayni yetkiye sahip - rol/izin ayrimi YOK,
//  giris yapan herkes her seyi gorur ve degistirebilir.

const YONETICI_ALANLARI =
  'id, kullanici, tuz, ozet, ad, eposta, telefon, kurucu, yetkili, aktif';

/**
 * Hesabi KULLANICI ADINDAN ya da E-POSTADAN bulur. Buyuk/kucuk harf ayrimi yok.
 *
 * Siteden kayit olanlarin kullanici adi zaten e-postalarinin aynisi; e-posta
 * ayrica sorulmasa da olurdu. Ama kisi sonradan arayuzden kullanici adini
 * degistirebiliyor - o an e-postasiyla giris yapamaz hale gelirdi. Iki alani
 * da kabul etmek bunu onler.
 */
async function yoneticiOku(kullanici) {
  const { rows } = await sorgu(
    `select ${YONETICI_ALANLARI} from yonetici
      where lower(kullanici) = lower($1)
         or (eposta <> '' and lower(eposta) = lower($1))`,
    [String(kullanici ?? '')]
  );
  return rows.length ? rows[0] : null;
}

async function yoneticiOkuId(id) {
  const { rows } = await sorgu(
    `select ${YONETICI_ALANLARI} from yonetici where id = $1`,
    [id]
  );
  return rows.length ? rows[0] : null;
}

/** Hic hesap var mi? (sunucu acilisindaki kontrol) */
async function yoneticiSayisi() {
  const { rows } = await sorgu('select count(*)::int as n from yonetici');
  return rows[0].n;
}

/**
 * Kullanici listesi - yetkililerin gordugu ekran.
 *
 * Kayit formunda ad soyad / e-posta / telefon topluyoruz; bu liste onlari
 * GOSTEREN tek yer. Son gorulme `oturumlar` tablosundan geliyor: ayrica
 * kolon tutmaya gerek yok, bilgi zaten orada.
 *
 * Sifre alanlari (tuz, ozet) BURADA YOK - disari cikmasinlar.
 */
async function yoneticiListesi() {
  const { rows } = await sorgu(
    `select y.id, y.kullanici, y.ad, y.eposta, y.telefon,
            y.kurucu, y.yetkili, y.aktif, y.davet_kodu, y.guncellendi,
            (select max(o.son_gorulme) from oturumlar o
              where o.kullanici_id = y.id) as son_gorulme,
            (select count(*) from kutular k where k.kullanici_id = y.id)::int as kutu,
            (select count(*) from planlar p where p.kullanici_id = y.id)::int as plan
       from yonetici y
      order by y.kurucu desc, y.yetkili desc, y.id`
  );
  return rows.map((s) => ({
    id: s.id,
    kullanici: s.kullanici,
    ad: s.ad,
    eposta: s.eposta,
    telefon: s.telefon,
    kurucu: s.kurucu === true,
    yetkili: s.yetkili === true,
    aktif: s.aktif === true,
    davetKodu: s.davet_kodu,
    sonGorulme: s.son_gorulme,
    kutu: s.kutu,
    plan: s.plan,
  }));
}

/** Yonetici yetkisini verir/alir. Kurucuya dokunmaz - cagiran taraf da bakar. */
async function yoneticiYetkiVer(id, yetkili) {
  const { rows } = await sorgu(
    `update yonetici set yetkili = $2, guncellendi = now()
      where id = $1 and not kurucu
      returning ${YONETICI_ALANLARI}`,
    [id, yetkili === true]
  );
  return rows.length ? rows[0] : null;
}

/**
 * Hesabi askiya alir / geri acar.
 *
 * Silmenin aksine GERI ALINABILIR: silme `on delete cascade` yuzunden
 * kisinin butun araclarini, kutularini ve planlarini da goturuyor.
 * Askiya alinan hesabin verisi oldugu gibi duruyor, yalnizca giris kapali.
 */
async function yoneticiAktifYap(id, aktif) {
  const { rows } = await sorgu(
    `update yonetici set aktif = $2, guncellendi = now()
      where id = $1 and not kurucu
      returning ${YONETICI_ALANLARI}`,
    [id, aktif === true]
  );
  if (rows.length === 0) return null;

  // Askiya alinan kisi ACIK oturumuyla calismaya devam etmesin
  if (aktif !== true) {
    await sorgu('delete from oturumlar where kullanici_id = $1', [id]);
  }
  return rows[0];
}

/**
 * Yeni hesap ekler. Ayni kullanici adi varsa (buyuk/kucuk harf farki dahil)
 * benzersiz indeks yuzunden hata firlatir - cagiran taraf yakalar.
 */
async function yoneticiEkle({ kullanici, tuz, ozet, ad, kurucu, yetkili }) {
  const { rows } = await sorgu(
    `insert into yonetici (kullanici, tuz, ozet, ad, kurucu, yetkili, guncellendi)
     values ($1, $2, $3, $4, $5, $6, now())
     returning ${YONETICI_ALANLARI}`,
    // Kurucu her zaman yetkilidir; ayrica yetki vermeye gerek kalmasin.
    [kullanici, tuz, ozet, ad || '', kurucu === true, yetkili === true || kurucu === true]
  );
  return rows[0];
}

async function yoneticiSil(id) {
  const { rowCount } = await sorgu('delete from yonetici where id = $1', [id]);
  return rowCount > 0;
}

/** Var olan hesabin sifresini (ve istenirse kullanici adini) gunceller. */
async function yoneticiGuncelle(id, { kullanici, tuz, ozet }) {
  const { rows } = await sorgu(
    `update yonetici
        set kullanici = $2, tuz = $3, ozet = $4, guncellendi = now()
      where id = $1
      returning ${YONETICI_ALANLARI}`,
    [id, kullanici, tuz, ozet]
  );
  return rows.length ? rows[0] : null;
}

// ---------------------------------------------------------------------------
//  DAVETLER (referans numaralari)
//  Kodu yalnizca kurucu uretir; kayit olan kisi kodu formda yazar.
// ---------------------------------------------------------------------------

async function davetEkle({ kod, etiket, olusturanId, sonKullanma }) {
  const { rows } = await sorgu(
    `insert into davetler (kod, etiket, olusturan_id, son_kullanma)
     values ($1, $2, $3, $4)
     returning kod, etiket, olusturuldu, son_kullanma, kullanildi`,
    [kod, etiket || '', olusturanId, sonKullanma]
  );
  return rows[0];
}

/** Butun kodlar, yenisi ustte. `kullanan` = kodu harcayan kisinin adi. */
async function davetleriListele() {
  const { rows } = await sorgu(
    `select d.kod, d.etiket, d.olusturuldu, d.son_kullanma, d.kullanildi,
            y.ad as kullanan_ad, y.eposta as kullanan_eposta
       from davetler d
       left join yonetici y on y.id = d.kullanan_id
      order by d.olusturuldu desc`
  );
  return rows.map((s) => ({
    kod: s.kod,
    etiket: s.etiket,
    olusturuldu: s.olusturuldu,
    sonKullanma: s.son_kullanma,
    kullanildi: s.kullanildi,
    // Hesap silinmisse kullanan_id null'a duser; kod yine "kullanilmis" kalir
    kullanan: s.kullanildi ? s.kullanan_ad || s.kullanan_eposta || 'silinmiş hesap' : null,
  }));
}

/** Yalnizca HENUZ KULLANILMAMIS kodu siler. @returns silindi mi */
async function davetSil(kod) {
  const { rowCount } = await sorgu(
    'delete from davetler where kod = $1 and kullanildi is null',
    [kod]
  );
  return rowCount > 0;
}

/**
 * KAYIT: davet kodunu harcayip yeni hesabi acar. Tek islem (transaction)
 * icinde yapilir - kod ya harcanir ve hesap acilir, ya da hicbiri olur.
 *
 * Koddaki satir `for update` ile KILITLENIR: ayni kod iki kisi tarafindan
 * ayni anda gonderilirse ikincisi birincinin bitmesini bekler ve kodu
 * kullanilmis bulur. Kilit olmasa ikisi de gecerli gorup iki hesap acardi.
 *
 * @returns {Promise<{hesap}|{hata:'kod'|'sure'|'eposta'}>}
 */
async function kayitOlustur({ adSoyad, eposta, telefon, tuz, ozet, davetKodu }) {
  try {
    return await islem(async (baglanti) => {
      const { rows: kodlar } = await baglanti.query(
        'select kod, son_kullanma, kullanildi from davetler where kod = $1 for update',
        [davetKodu]
      );

      // Yok / harcanmis / suresi gecmis: hepsi ayni sonuc, ayri mesajlar.
      if (kodlar.length === 0 || kodlar[0].kullanildi) return { hata: 'kod' };
      if (new Date(kodlar[0].son_kullanma).getTime() < Date.now()) {
        return { hata: 'sure' };
      }

      const { rowCount: cakisma } = await baglanti.query(
        `select 1 from yonetici
          where lower(eposta) = lower($1) or lower(kullanici) = lower($1)`,
        [eposta]
      );
      if (cakisma > 0) return { hata: 'eposta' };

      // Kullanici adi = e-posta. Giris e-posta ile yapiliyor; ayrica bir
      // kullanici adi sormuyoruz (kayit formu zaten uzun).
      const { rows } = await baglanti.query(
        `insert into yonetici
           (kullanici, tuz, ozet, ad, eposta, telefon, davet_kodu, guncellendi)
         values ($1, $2, $3, $4, $1, $5, $6, now())
         returning ${YONETICI_ALANLARI}`,
        [eposta, tuz, ozet, adSoyad, telefon, davetKodu]
      );
      const hesap = rows[0];

      await baglanti.query(
        'update davetler set kullanildi = now(), kullanan_id = $2 where kod = $1',
        [davetKodu, hesap.id]
      );

      return { hesap };
    });
  } catch (hata) {
    // 23505 = benzersiz kisit. Yukaridaki cakisma kontrolunden SONRA, ayni
    // e-postayla iki kayit ayni anda gelirse buraya duser - veritabani son
    // sozu soyluyor, kullaniciya yine anlasilir mesaj gidiyor.
    if (hata && hata.code === '23505') return { hata: 'eposta' };
    throw hata;
  }
}

// ---------------------------------------------------------------------------
//  SIFRE SIFIRLAMA KODLARI
//
//  Kayit disari acildiktan sonra sifresini unutan kullaniciyi kurtarmanin
//  tek yolu kurucunun terminaline gitmesiydi. Artik yetkili bir kod uretip
//  kisiye kendisi veriyor (telefon/WhatsApp), kisi kodu sifre sifirlama
//  sayfasina yaziyor. E-posta gerekmiyor - proje tek bagimlilikla calisiyor.
// ---------------------------------------------------------------------------

async function sifirlamaEkle({ kod, kullaniciId, olusturanId, sonKullanma }) {
  // Ayni kisiye ikinci kod uretilirse eskisi ise yaramasin: kafa karisikligi
  // olmasin ve elde dolasan gecerli kod sayisi bir taneyle sinirli kalsin.
  await sorgu(
    'delete from sifirlamalar where kullanici_id = $1 and kullanildi is null',
    [kullaniciId]
  );
  const { rows } = await sorgu(
    `insert into sifirlamalar (kod, kullanici_id, olusturan_id, son_kullanma)
     values ($1, $2, $3, $4)
     returning kod, olusturuldu, son_kullanma`,
    [kod, kullaniciId, olusturanId, sonKullanma]
  );
  return rows[0];
}

/**
 * Kodu harcayip sifreyi degistirir. Davet koduyla ayni desen: tek islem,
 * satir `for update` ile kilitli.
 *
 * @returns {Promise<{hesap}|{hata:'kod'|'sure'|'askida'}>}
 */
async function sifreSifirla({ kod, tuz, ozet }) {
  return islem(async (baglanti) => {
    const { rows: kodlar } = await baglanti.query(
      'select kullanici_id, son_kullanma, kullanildi from sifirlamalar where kod = $1 for update',
      [kod]
    );

    if (kodlar.length === 0 || kodlar[0].kullanildi) return { hata: 'kod' };
    if (new Date(kodlar[0].son_kullanma).getTime() < Date.now()) return { hata: 'sure' };

    const kullaniciId = kodlar[0].kullanici_id;

    // Askiya alinmis hesabin sifresi sifirlanip iceri girilemez
    const { rows: hesaplar } = await baglanti.query(
      'select aktif from yonetici where id = $1',
      [kullaniciId]
    );
    if (hesaplar.length === 0) return { hata: 'kod' };
    if (hesaplar[0].aktif !== true) return { hata: 'askida' };

    const { rows } = await baglanti.query(
      `update yonetici set tuz = $2, ozet = $3, guncellendi = now()
        where id = $1
        returning ${YONETICI_ALANLARI}`,
      [kullaniciId, tuz, ozet]
    );

    await baglanti.query(
      'update sifirlamalar set kullanildi = now() where kod = $1', [kod]
    );

    // Sifre degisti: eski oturumlar kapansin. Sifreyi unutma sebebi hesabin
    // baskasinin eline gecmesi olabilir - acik oturum varsa o da dusmeli.
    await baglanti.query('delete from oturumlar where kullanici_id = $1', [kullaniciId]);

    return { hesap: rows[0] };
  });
}

/** Bir kullanicinin BEKLEYEN (kullanilmamis, suresi gecmemis) kodu. */
async function sifirlamaBekleyen(kullaniciId) {
  const { rows } = await sorgu(
    `select kod, son_kullanma from sifirlamalar
      where kullanici_id = $1 and kullanildi is null and son_kullanma > now()
      order by olusturuldu desc limit 1`,
    [kullaniciId]
  );
  return rows.length ? { kod: rows[0].kod, sonKullanma: rows[0].son_kullanma } : null;
}

// ---------------------------------------------------------------------------
//  YEDEKLER
//  Her yazma isleminde butun verinin kopyasi alinir, son 40 tanesi tutulur.
// ---------------------------------------------------------------------------

async function tumVeriyiTopla(kullaniciId) {
  const [ayarlar, araclar, kutular, planlar] = await Promise.all([
    ayarlariOku(kullaniciId),
    araclariOku(kullaniciId),
    kutulariOku(kullaniciId),
    planlariOku(kullaniciId),
  ]);
  return { ayarlar, araclar, kutular, planlar };
}

async function yedekAl(kullaniciId, sebep) {
  const icerik = await tumVeriyiTopla(kullaniciId);
  await sorgu(
    'insert into yedekler (kullanici_id, sebep, icerik) values ($1, $2, $3)',
    [kullaniciId, String(sebep || '').slice(0, 120), JSON.stringify(icerik)]
  );
  // Eskileri sil - HER HESABIN son YEDEK_LIMIT tanesi kalsin. Limit hesap
  // basina: yoksa cok calisan bir kullanici digerlerinin yedeklerini silerdi.
  await sorgu(
    `delete from yedekler
      where kullanici_id = $1
        and id not in (select id from yedekler
                        where kullanici_id = $1
                        order by tarih desc limit $2)`,
    [kullaniciId, YEDEK_LIMIT]
  );
}

async function yedekleriListele(kullaniciId) {
  const { rows } = await sorgu(
    'select id, tarih, sebep from yedekler where kullanici_id = $1 order by tarih desc',
    [kullaniciId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
//  Arayuzun tek seferde ihtiyac duydugu her sey
// ---------------------------------------------------------------------------

async function panoVerisi(kullaniciId) {
  const [ayarlar, araclar, kutular, planlar, hesap] = await Promise.all([
    ayarlariOku(kullaniciId),
    araclariOku(kullaniciId),
    kutulariOku(kullaniciId),
    planlariOku(kullaniciId),
    yoneticiOkuId(kullaniciId),
  ]);

  return {
    // Giren kisi kim? Arayuz hem adini gosteriyor hem de "Davet Kodları"
    // dugmesini buna bakarak aciyor (yalnizca kurucuda).
    // Sifre/tuz ASLA disari cikmaz - yalnizca su uc alan.
    ben: hesap
      ? {
          kullanici: hesap.kullanici,
          ad: hesap.ad,
          kurucu: hesap.kurucu === true,
          yetkili: hesap.yetkili === true,
        }
      : null,
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
  yoneticiOkuId,
  yoneticiSayisi,
  yoneticiListesi,
  yoneticiEkle,
  yoneticiGuncelle,
  yoneticiSil,
  yoneticiYetkiVer,
  yoneticiAktifYap,
  davetEkle,
  davetleriListele,
  davetSil,
  kayitOlustur,
  sifirlamaEkle,
  sifirlamaBekleyen,
  sifreSifirla,
  yedekAl,
  yedekleriListele,
  tumVeriyiTopla,
  panoVerisi,
};
