// ============================================================================
//  SADECE TEST ICIN kutu ve arac olculeri.
//
//  DIKKAT: Bu dosya UYGULAMAYA DAHIL DEGILDIR. Arayuzde hicbir hazir olcu
//  gelmeyecek - araci ve kutulari kullanici elle olusturur. Bu olculer
//  yalnizca motorun dogru hesaplayip hesaplamadigini kanitlamak icin var
//  (rehberdeki dogrulanmis referans sayilarla karsilastirmak icin).
// ============================================================================

const ARAC_14M = {
  ad: '14 m Dorse',
  uzunluk: 14000,
  genislik: 2480,
  yukseklik: 2700,
  maksAgirlik: 24000,
};

const KUTULAR = {
  marlboroKoli: {
    id: 'marlboro-koli',
    ad: 'Marlboro Koli (Master Case)',
    uzunluk: 575,
    genislik: 450,
    yukseklik: 242,
    agirlik: 14,
    renk: '#e03131',
    yatirilabilir: true,
    maksIstif: 0,
  },
  marlboroKarton: {
    id: 'marlboro-karton',
    ad: 'Marlboro Karton (10 paket)',
    uzunluk: 270,
    genislik: 85,
    yukseklik: 55,
    agirlik: 0.28,
    renk: '#f08c00',
    yatirilabilir: true,
    maksIstif: 0,
  },
  marlboroPaket: {
    id: 'marlboro-paket',
    ad: 'Marlboro Paket (King Size)',
    uzunluk: 85,
    genislik: 55,
    yukseklik: 22,
    agirlik: 0.026,
    renk: '#c2255c',
    yatirilabilir: true,
    maksIstif: 0,
  },
  euroPaletYuklu: {
    id: 'euro-palet-yuklu',
    ad: 'Euro Palet (Yüklü)',
    uzunluk: 1200,
    genislik: 800,
    yukseklik: 1800,
    agirlik: 700,
    renk: '#2f9e44',
    yatirilabilir: false, // paleti yan yatiramazsin
    maksIstif: 1, // ustune yuk konmaz
  },
  euroPaletBos: {
    id: 'euro-palet-bos',
    ad: 'Euro Palet (Boş)',
    uzunluk: 1200,
    genislik: 800,
    yukseklik: 144,
    agirlik: 25,
    renk: '#66a80f',
    yatirilabilir: false,
    maksIstif: 0,
  },
  koliOrta: {
    id: 'koli-orta',
    ad: 'Standart Koli Orta',
    uzunluk: 600,
    genislik: 400,
    yukseklik: 400,
    agirlik: 15,
    renk: '#1971c2',
    yatirilabilir: true,
    maksIstif: 0,
  },
  koliKucuk: {
    id: 'koli-kucuk',
    ad: 'Standart Koli Küçük',
    uzunluk: 400,
    genislik: 300,
    yukseklik: 300,
    agirlik: 8,
    renk: '#7048e8',
    yatirilabilir: true,
    maksIstif: 0,
  },
};

module.exports = { ARAC_14M, KUTULAR };
