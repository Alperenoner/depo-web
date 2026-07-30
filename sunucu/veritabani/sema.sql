-- ============================================================================
--  DEPO WEB - Veritabani semasi (Neon Postgres)
--  `npm run db:kur` bu dosyayi calistirir. Tekrar calistirmak zararsizdir
--  (hepsi IF NOT EXISTS).
--
--  ONEMLI: Hicbir tabloya HAZIR OLCU eklenmez. Arac ve kutu listesi BOS
--  baslar; kullanici hepsini elle olusturur.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Genel ayarlar - tek satir (id her zaman 1)
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

-- Ayni anda sadece TEK arac aktif olabilir
create unique index if not exists araclar_tek_aktif
  on araclar (aktif) where aktif;

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
