-- ============================================================================
--  DEPO WEB - Veritabani semasi (Neon Postgres)
--  `npm run db:kur` bu dosyayi calistirir. Tekrar calistirmak zararsizdir
--  (hepsi IF NOT EXISTS).
--
--  ONEMLI: Hicbir tabloya HAZIR OLCU eklenmez. Arac ve kutu listesi BOS
--  baslar; kullanici hepsini elle olusturur.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Genel ayarlar
--  Basta tek satirdi (id her zaman 1). 31 Tem 2026'dan beri HER HESABIN
--  kendi satiri var - bkz. dosyanin sonundaki "HER HESABIN KENDI VERISI".
-- ---------------------------------------------------------------------------
create table if not exists ayarlar (
  id          smallint    primary key default 1 check (id = 1),
  baslik      text        not null default 'DEPOLAMA',
  alt_baslik  text        not null default 'Tır Yükleme Planlayıcı',
  guncellendi timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
--  ARACLAR
--  Kullanicinin olusturdugu butun araclar burada.
--    sablon = true  -> sablon listesinde gorunur (kullanici kendisi biriktirir)
--    aktif  = true  -> su anda plan yapilan arac (en fazla BIR tane)
--  Tablo BOS baslar. Hazir "14 m Dorse" gibi bir kayit YOKTUR.
-- ---------------------------------------------------------------------------
create table if not exists araclar (
  id           text        primary key,
  ad           text        not null,
  uzunluk      integer     not null check (uzunluk      > 0),
  genislik     integer     not null check (genislik     > 0),
  yukseklik    integer     not null check (yukseklik    > 0),
  maks_agirlik integer     not null check (maks_agirlik >= 0),
  sablon       boolean     not null default false,
  aktif        boolean     not null default false,
  sira         integer     not null default 0,
  olusturuldu  timestamptz not null default now()
);

-- Ayni anda sadece TEK arac aktif olabilir. Bu indeks dosyanin sonundaki
-- "HER HESABIN KENDI VERISI" bolumunde kuruluyor: kisit artik butun site
-- icin degil HESAP BASINA gecerli (herkesin kendi aktif araci var).

-- ---------------------------------------------------------------------------
--  KUTULAR (katalog)
--  Tablo BOS baslar. Marlboro veya baska hicbir hazir olcu YOKTUR.
--  Not: "not" SQL'de ayrilmis kelime oldugu icin alan adi "aciklama".
-- ---------------------------------------------------------------------------
create table if not exists kutular (
  id            text          primary key,
  ad            text          not null,
  grup          text          not null default '',
  uzunluk       integer       not null check (uzunluk   > 0),
  genislik      integer       not null check (genislik  > 0),
  yukseklik     integer       not null check (yukseklik > 0),
  agirlik       numeric(14,4) not null default 0 check (agirlik >= 0),
  renk          text          not null default '#888888',
  yatirilabilir boolean       not null default true,
  maks_istif    integer       not null default 0 check (maks_istif >= 0),
  icerik        text          not null default '',
  aciklama      text          not null default '',
  material      text          not null default '',
  format        text          not null default '',
  sira          integer       not null default 0,
  olusturuldu   timestamptz   not null default now()
);

-- material / format 30 Tem 2026'da eklendi. Yukaridaki "create table if not
-- exists" ZATEN VAR OLAN tabloya dokunmaz, o yuzden kolonlar ayrica ekleniyor.
-- Bu iki satir olmadan canli veritabani (Neon) eski semada kalirdi ve kayit
-- "column does not exist" ile patlardi.
alter table kutular add column if not exists material text not null default '';
alter table kutular add column if not exists format   text not null default '';

-- ---------------------------------------------------------------------------
--  PLANLAR
--  DIKKAT: Plan SONUCU degil TARIFI saklar.
--  "hangi arac + hangi kutular + kac adet + hangi dizilis" kaydedilir;
--  plan yuklendiginde yerlesim BASTAN hesaplanir. Boylece motoru
--  iyilestirdigimizde eski planlar da yeni sonuctan faydalanir.
--  ozet alani sadece listede gostermek icin (bilgi amacli).
-- ---------------------------------------------------------------------------
create table if not exists planlar (
  id        text        primary key,
  ad        text        not null,
  arac      jsonb       not null,                -- o anki arac olculeri
  strateji  text        not null default 'akilli',
  kalemler  jsonb       not null,                -- [{kutuId, adet, maks}]
  ayarlar   jsonb       not null default '{}',   -- {pay, agirlikSiniri}
  ozet      jsonb,                               -- {adet, doluluk, agirlik}
  aciklama  text        not null default '',
  tarih     timestamptz not null default now()
);

create index if not exists planlar_tarih on planlar (tarih desc);

-- ---------------------------------------------------------------------------
--  YONETICI - tek satir (id her zaman 1)
--  Duz metin sifre BURADA DURMAZ. Sadece tuz + scrypt ozeti tutulur.
-- ---------------------------------------------------------------------------
create table if not exists yonetici (
  id          smallint    primary key,
  kullanici   text        not null,
  tuz         text        not null,
  ozet        text        not null,
  ad          text        not null default '',
  guncellendi timestamptz not null default now()
);

-- 30 Tem 2026: TEK KULLANICI kisiti kaldirildi.
--
-- Tablo `id smallint primary key default 1 check (id = 1)` ile kurulmustu -
-- yani ikinci bir kullanici EKLENEMIYORDU, veritabani reddediyordu. Ikinci
-- hesap istenince kisit kaldirildi ve id bir diziden (sequence) veriliyor.
--
-- `create table if not exists` var olan tabloya dokunmadigi icin asagidaki
-- satirlar sart: canli veritabanindaki eski kisit ancak boyle kalkiyor.
alter table yonetici drop constraint if exists yonetici_id_check;

create sequence if not exists yonetici_id_seq as smallint owned by yonetici.id;
alter table yonetici alter column id set default nextval('yonetici_id_seq');

-- Diziyi mevcut en buyuk id'nin bir ustune al. is_called=false: bir sonraki
-- nextval tam bu degeri versin. Bos tabloda 1'den baslar.
select setval('yonetici_id_seq',
              coalesce((select max(id) from yonetici), 0) + 1,
              false);

-- Ayni kullanici adindan iki tane olmasin. Kucuk/buyuk harf ayrimi YOK:
-- "Deniz" ile "deniz" ayni hesap sayilir, giriste karisiklik olmasin.
create unique index if not exists yonetici_kullanici_benzersiz
  on yonetici (lower(kullanici));

-- ---------------------------------------------------------------------------
--  OTURUMLAR
--  Veritabaninda tutuluyor ki sunucu yeniden baslayinca (Railway deploy)
--  girisli kullanici disari atilmasin.
-- ---------------------------------------------------------------------------
create table if not exists oturumlar (
  jeton       text        primary key,
  olusturuldu timestamptz not null default now(),
  son_gorulme timestamptz not null default now(),
  ip          text        not null default ''
);

create index if not exists oturumlar_olusturuldu on oturumlar (olusturuldu);

-- Oturum artik HANGI kullaniciya ait oldugunu tasiyor. Sifre degistirme
-- bunu kullaniyor: birden fazla hesap oldugundan "yoneticinin sifresi"
-- diye tek bir sey yok, giris yapan kendi sifresini degistiriyor.
alter table oturumlar add column if not exists kullanici_id smallint;

-- ---------------------------------------------------------------------------
--  YEDEKLER
--  Her yazma isleminde butun verinin bir kopyasi alinir, son 40 tanesi
--  tutulur. (Orijinal surumdeki data/yedekler klasorunun karsiligi.)
-- ---------------------------------------------------------------------------
create table if not exists yedekler (
  id      bigserial   primary key,
  tarih   timestamptz not null default now(),
  sebep   text        not null default '',
  icerik  jsonb       not null
);

create index if not exists yedekler_tarih on yedekler (tarih desc);

-- ===========================================================================
--  HER HESABIN KENDI VERISI          (31 Tem 2026)
--
--  O gune kadar veri ORTAKTI: giris yapan herkes ayni araclari, kutulari ve
--  planlari goruyordu. Iki kisiydik, sorun degildi. Davet koduyla disaridan
--  kayit acilinca ortak veri kabul edilemez hale geldi - kayit olan yabanci
--  butun katalogu gorur ve silebilirdi.
--
--  Artik her satir BIR hesaba ait. Asagisi var olan canli veritabanini bu
--  duzene tasir; `create table if not exists` var olan tabloya dokunmadigi
--  icin bu bolum sart.
--
--  GOC: kolon `default 1` ile eklenir, yani o ana kadarki BUTUN VERI id=1
--  olan hesaba (kurucu) gecer. Sonra default DUSURULUR: bundan sonra her
--  insert sahibini acikca yazmak zorunda. Boyle olmazsa kullaniciyi
--  gecirmeyi unutan bir hata sessizce kurucunun verisine yazardi.
-- ===========================================================================

alter table araclar add column if not exists kullanici_id smallint not null default 1;
alter table kutular add column if not exists kullanici_id smallint not null default 1;
alter table planlar add column if not exists kullanici_id smallint not null default 1;
alter table yedekler add column if not exists kullanici_id smallint not null default 1;

alter table araclar alter column kullanici_id drop default;
alter table kutular alter column kullanici_id drop default;
alter table planlar alter column kullanici_id drop default;
alter table yedekler alter column kullanici_id drop default;

create index if not exists araclar_kullanici on araclar (kullanici_id);
create index if not exists kutular_kullanici on kutular (kullanici_id);
create index if not exists planlar_kullanici on planlar (kullanici_id, tarih desc);
create index if not exists yedekler_kullanici on yedekler (kullanici_id, tarih desc);

-- ayarlar: tek satirlik tablodan hesap basina satira.
-- id'nin `check (id = 1)` kisiti kalkiyor ve yonetici tablosunda yaptigimiz
-- gibi id bir diziden veriliyor. Asil anahtar artik kullanici_id.
alter table ayarlar add column if not exists kullanici_id smallint;
update ayarlar set kullanici_id = 1 where kullanici_id is null;
alter table ayarlar drop constraint if exists ayarlar_id_check;

create sequence if not exists ayarlar_id_seq as smallint owned by ayarlar.id;
alter table ayarlar alter column id set default nextval('ayarlar_id_seq');
select setval('ayarlar_id_seq',
              coalesce((select max(id) from ayarlar), 0) + 1,
              false);

create unique index if not exists ayarlar_kullanici on ayarlar (kullanici_id);

-- Aktif arac kisiti artik HESAP BASINA. Eski indeks butun tabloda tek aktif
-- araca izin veriyordu: iki kisi ayni anda plan yapamazdi, biri arac secince
-- digerininki pasife duserdi.
drop index if exists araclar_tek_aktif;
create unique index if not exists araclar_tek_aktif_kullanici
  on araclar (kullanici_id) where aktif;

-- Hesap silinince verisi de gitsin.
--
-- SADECE TEMIZLIK DEGIL, GUVENLIK: yonetici id'si bir diziden geliyor ve
-- dizi her aciliste `max(id) + 1`'e cekiliyor. Son hesap silinirse ayni id
-- bir sonraki kayitta TEKRAR verilir - artik kaydi silinen kisinin verisi
-- yeni ve alakasiz bir hesaba acilirdi. Cascade bu ihtimali kokten kaldirir.
--
-- Once sahipsiz oturumlari at, yoksa asagidaki kisit kurulamaz.
-- kullanici_id'si NULL olan oturumlar cok kullanici gelmeden ONCE acilmisti;
-- veri artik hesaba bagli oldugu icin "kim oldugu belirsiz" oturum
-- calistirilamaz - sahipleri yeniden giris yapar.
delete from oturumlar
 where kullanici_id is null
    or kullanici_id not in (select id from yonetici);

-- Postgres'te `add constraint if not exists` yok, o yuzden dongu.
do $$
declare t text;
begin
  foreach t in array array['araclar','kutular','planlar','yedekler','ayarlar','oturumlar']
  loop
    if not exists (select 1 from pg_constraint where conname = t || '_kullanici_fk') then
      execute format(
        'alter table %I add constraint %I foreign key (kullanici_id)
           references yonetici (id) on delete cascade', t, t || '_kullanici_fk');
    end if;
  end loop;
end $$;

-- ===========================================================================
--  KAYIT OLMA + DAVET (REFERANS) KODU          (31 Tem 2026)
--
--  O gune kadar hesaplari yalnizca ben terminalden aciyordum
--  (`npm run db:kullanici -- ekle`). Artik kullanici siteden kendisi kayit
--  oluyor - ama herkese acik degil: elinde GECERLI BIR REFERANS NUMARASI
--  olmasi lazim ve o numarayi yalnizca kurucu uretip veriyor.
-- ===========================================================================

-- Kurucu = sitenin sahibi. Bkz. asagidaki "ROLLER" bolumu: yetki artik
-- `yetkili` kolonunda, `kurucu` yalnizca DOKUNULAMAZLIK isareti.
alter table yonetici add column if not exists kurucu boolean not null default false;

-- Kayit formundan gelen iletisim bilgileri.
--   ad         -> ad soyad (kolon zaten vardi, bos duruyordu; artik dolduruluyor)
--   kullanici  -> kayitta E-POSTANIN AYNISI yazilir (giris e-posta ile)
alter table yonetici add column if not exists telefon    text not null default '';
alter table yonetici add column if not exists eposta     text not null default '';
alter table yonetici add column if not exists davet_kodu text;

-- Ayni e-posta iki hesapta olmasin. Kismi indeks: terminalden acilmis eski
-- hesaplarin e-postasi bos ('') ve bos degerler birbiriyle catismamali.
create unique index if not exists yonetici_eposta_benzersiz
  on yonetici (lower(eposta)) where eposta <> '';

-- Var olan veritabaninda kurucuyu isaretle: en dusuk id'li hesap (benim).
-- `not exists` sarti yuzunden yalnizca BIR KEZ calisir - kurucu sonradan
-- elle degistirilirse sunucu her aciliste geri almaz.
update yonetici set kurucu = true
 where id = (select min(id) from yonetici)
   and not exists (select 1 from yonetici where kurucu);

-- ---------------------------------------------------------------------------
--  DAVETLER (referans numaralari)
--
--  Kod TEK KULLANIMLIK ve SURELI. Duz metin duruyor (sifreler gibi
--  ozetlenmiyor): kurucu uretilmis kodu listeden tekrar okuyup verebilsin.
--  Riski dusuk - kodun tek yetkisi bos bir hesap acmak, bir kez.
-- ---------------------------------------------------------------------------
create table if not exists davetler (
  kod          text        primary key,
  etiket       text        not null default '',   -- "Ahmet Bey / X Lojistik"
  olusturan_id smallint    references yonetici (id) on delete set null,
  olusturuldu  timestamptz not null default now(),
  son_kullanma timestamptz not null,
  kullanildi   timestamptz,                        -- doluysa kod harcanmis
  kullanan_id  smallint    references yonetici (id) on delete set null
);

create index if not exists davetler_olusturuldu on davetler (olusturuldu desc);

-- ===========================================================================
--  ROLLER, ASKIYA ALMA, SIFRE SIFIRLAMA, KALICI IP SAYACI   (31 Tem 2026)
--
--  Kayit disari acilinca uc sey eksik kaldi:
--    1. Sifresini unutan kullaniciyi kurtarmanin tek yolu kurucunun
--       terminaline gitmesiydi.
--    2. Kim kayit oldugu hicbir ekranda gorunmuyordu.
--    3. Birini durdurmanin tek yolu SILMEKTI - verisi de gidiyordu.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  YETKI
--
--  Iki ayri kavram, bilerek iki kolon:
--
--    yetkili -> yonetici yetkisi. VERILEBILIR ve GERI ALINABILIR. Yetkili
--               olan herkes ayni seyleri yapar: davet kodu uretir,
--               kullanicilari gorur, askiya alir, sifre sifirlama kodu
--               uretir, baskasina yetki verir.
--
--    kurucu  -> sitenin sahibi. DOKUNULAMAZ: yetkisi alinamaz, askiya
--               alinamaz, silinemez - yetki verdigi biri onu kendi
--               sitesinden kilitleyemesin diye. Tek satir.
--
--  Yetki kontrolu her yerde `yetkili` uzerinden yapilir; kurucuya goc
--  sirasinda zaten true veriliyor. `kurucu` kolonu KALDI cunku eski surum
--  onu okuyor - boylece bu sema eski kodu bozmadan calisabiliyor.
-- ---------------------------------------------------------------------------
alter table yonetici add column if not exists yetkili boolean not null default false;

update yonetici set yetkili = true where kurucu and not yetkili;

-- Askiya alma: hesap durur, verisi durur, giris kabul edilmez.
-- Silmenin aksine GERI ALINABILIR (silme, cascade ile veriyi de goturuyor).
alter table yonetici add column if not exists aktif boolean not null default true;

-- ---------------------------------------------------------------------------
--  SIFRE SIFIRLAMA KODLARI
--
--  Neden e-posta degil: proje tek bagimlilikla calisiyor (`pg`) ve disari
--  mail atmak icin baska bir servise baglanmak gerekirdi. Davet kodu
--  duzeni zaten elimizde - ayni sey: yetkili kod uretir, kisiye kendi
--  verir (telefon/WhatsApp), kisi kodu sifre sifirlama sayfasina yazar.
--
--  Davetten farki: bu kod BELLI BIR HESABA bagli ve omru kisa.
-- ---------------------------------------------------------------------------
create table if not exists sifirlamalar (
  kod          text        primary key,
  kullanici_id smallint    not null references yonetici (id) on delete cascade,
  olusturan_id smallint    references yonetici (id) on delete set null,
  olusturuldu  timestamptz not null default now(),
  son_kullanma timestamptz not null,
  kullanildi   timestamptz
);

create index if not exists sifirlamalar_kullanici on sifirlamalar (kullanici_id);

-- ---------------------------------------------------------------------------
--  IP SAYACLARI  (kaba kuvvet + kayit sikligi)
--
--  Eskiden ikisi de BELLEKTEKI bir Map'te duruyordu ve sunucu yeniden
--  baslayinca sifirlaniyordu. Site giris arkasindayken kabul edilebilir bir
--  odundu; kayit uctan disari acilinca degil:
--
--  Render ucretsiz katmani 15 dakika trafik almazsa UYUYOR. Yani sayac
--  neredeyse her saat sifirlaniyordu - koruma var saniliyordu ama
--  barindirma bicimi onu surekli siliyordu.
--
--  tur: 'giris' (hatali deneme, kilitle) | 'kayit' (basarili kayit, sayaç)
-- ---------------------------------------------------------------------------
create table if not exists ip_sayaclari (
  ip            text        not null,
  tur           text        not null,
  sayi          integer     not null default 0,
  pencere_bitis timestamptz,
  kilit_bitis   timestamptz,
  guncellendi   timestamptz not null default now(),
  primary key (ip, tur)
);

create index if not exists ip_sayaclari_guncellendi on ip_sayaclari (guncellendi);
