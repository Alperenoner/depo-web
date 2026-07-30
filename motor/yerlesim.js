// ============================================================================
//  YERLESTIRME MOTORU
//  ---------------------------------------------------------------------------
//  Bu dosya EKRANI HIC BILMEZ. Girdi: "su arac + su kutular".
//  Cikti: "su bloklar". Boylece 2B ve 3B gorunumler birbirinden bagimsiz
//  calisip ayni sonucu gosterir; biri degisince digeri bozulmaz.
//
//  Hem tarayicida hem Node.js'te calisir (en altta iki ortama da veriliyor).
//
//  KOORDINAT SISTEMI (hepsi mm):
//    x -> tirin UZUNLUGU boyunca (0 = kabin tarafi, U = kapi)
//    y -> tirin GENISLIGI boyunca (0 = sol, G = sag)
//    z -> YUKSEKLIK             (0 = zemin, Y = tavan)
//
//  TEMEL FIKIR: kutu degil BLOK.
//    Blok = ayni yonde dizilmis nx x ny x nz ozdes kutudan olusan duzgun izgara.
//    900 bin paketi tek blokla anlatabildigimiz icin hesap milisaniyede biter.
//
//  ALAN ADLARI (karismasin diye):
//    Bosluk : {x, y, z, u, g, yuk}   x/y/z = konum, u/g/yuk = olcu
//    Durus  : {du, dg, dy}           o duruşta x/y/z eksenindeki kutu olcusu
// ============================================================================

(function (kok) {
  'use strict';

  // --------------------------------------------------------------------------
  //  Sabitler
  // --------------------------------------------------------------------------

  /** Bir boslugun kenari bundan kucukse "kirinti" sayilir ve atilir (mm). */
  const KIRINTI_ESIGI = 1;

  /** Sonsuz donguye karsi guvenlik freni. Normalde asla dolmaz. */
  const AZAMI_TUR = 200000;

  /** Kullanilabilir dizilis stratejileri. Yeni eklemek icin buraya bir satir yaz. */
  const STRATEJILER = [
    {
      id: 'yatay',
      ad: 'Yatay Diziliş',
      aciklama: 'Kutular yatık durur — en kısa kenar yukarı bakar, ' +
                'taban alanı büyür, daha çok kat çıkar',
      yonelim: 'yatay',
      puan: 'hacim',
    },
    {
      id: 'dikey',
      ad: 'Dikey Diziliş',
      aciklama: 'Kutular ayakta durur — en uzun kenar yukarı bakar',
      yonelim: 'dikey',
      puan: 'hacim',
    },
    {
      id: 'optimum',
      ad: 'Optimum Diziliş',
      aciklama: 'Bütün duruş ve puanlama birleşimlerini dener, en çok kutu ' +
                'yerleştireni seçer',
      yonelim: 'optimum',
      puan: 'hacim',
    },
  ];

  /**
   * OPTIMUM stratejinin denedigi birlesimler.
   * 'optimum' yok - yoksa kendini cagirir.
   */
  const OPTIMUM_ADAYLAR = [
    { yonelim: 'hepsi', puan: 'hacim' },
    { yonelim: 'hepsi', puan: 'adet' },
    { yonelim: 'yatay', puan: 'hacim' },
    { yonelim: 'yatay', puan: 'adet' },
    { yonelim: 'dikey', puan: 'hacim' },
    { yonelim: 'dikey', puan: 'adet' },
    { yonelim: 'boyuna', puan: 'hacim' },
    { yonelim: 'enine', puan: 'hacim' },
    { yonelim: 'dik', puan: 'hacim' },
  ];

  // --------------------------------------------------------------------------
  //  Kucuk yardimcilar
  // --------------------------------------------------------------------------

  function sayi(deger, varsayilan) {
    const n = Number(deger);
    return Number.isFinite(n) ? n : varsayilan;
  }

  function tamPozitif(deger) {
    const n = Math.floor(sayi(deger, 0));
    return n > 0 ? n : 0;
  }

  // --------------------------------------------------------------------------
  //  DURUSLAR (yonelimler)
  //  Bir kutunun u x g x y olcusunun 6 permutasyonu vardir.
  //  yatirilabilir = false ise sadece 2 durus denenir: dikey eksen sabit
  //  kalir (kutunun yuksekligi hep yukari bakar), yatayda 90 derece doner.
  // --------------------------------------------------------------------------

  function duruslariUret(kutu) {
    const U = kutu.uzunluk;
    const G = kutu.genislik;
    const Y = kutu.yukseklik;

    // Durusun adi, dikey eksende hangi olcunun durduguna gore verilir.
    const hepsi = [
      { du: U, dg: G, dy: Y, ad: 'Normal' },
      { du: G, dg: U, dy: Y, ad: 'Normal 90°' },
      { du: U, dg: Y, dy: G, ad: 'Yan yatık' },
      { du: Y, dg: U, dy: G, ad: 'Yan yatık 90°' },
      { du: G, dg: Y, dy: U, ad: 'Dikine' },
      { du: Y, dg: G, dy: U, ad: 'Dikine 90°' },
    ];

    // Kup gibi kutularda ayni olcuyu veren duruslari tekillestir.
    const gorulen = new Set();
    const tekil = [];
    for (const d of hepsi) {
      const anahtar = d.du + 'x' + d.dg + 'x' + d.dy;
      if (gorulen.has(anahtar)) continue;
      gorulen.add(anahtar);
      tekil.push(d);
    }
    return tekil;
  }

  /**
   * Stratejinin yonelim kuralina gore duruslari suzer.
   * Suzgec hicbir durus birakmazsa, kutu hic yerlesemez duruma dusmesin diye
   * izin verilen tam listeye geri donulur.
   */
  function duruslariSuz(duruslar, kutu, yonelimKurali) {
    // 1) Kutunun kendi kurali: yatirilamiyorsa dikey eksen kutunun yuksekligi.
    let izinli = duruslar;
    if (kutu.yatirilabilir === false) {
      izinli = duruslar.filter((d) => d.dy === kutu.yukseklik);
    }
    if (izinli.length === 0) izinli = duruslar;

    // 2) Strateji kurali
    const enUzun = Math.max(kutu.uzunluk, kutu.genislik, kutu.yukseklik);
    const enKisa = Math.min(kutu.uzunluk, kutu.genislik, kutu.yukseklik);
    let suzulmus = izinli;

    if (yonelimKurali === 'yatay') {
      // YATAY: kutu mumkun oldugunca yatik dursun -> dikey eksende EN KISA kenar.
      // Taban alani buyur, yuk yuksekligi duser, daha cok kat cikar.
      suzulmus = izinli.filter((d) => d.dy === enKisa);
    } else if (yonelimKurali === 'dikey') {
      // DIKEY: kutu mumkun oldugunca ayakta dursun -> dikey eksende EN UZUN kenar.
      suzulmus = izinli.filter((d) => d.dy === enUzun);
    } else if (yonelimKurali === 'boyuna') {
      suzulmus = izinli.filter((d) => d.du === enUzun);
    } else if (yonelimKurali === 'enine') {
      suzulmus = izinli.filter((d) => d.dg === enUzun);
    } else if (yonelimKurali === 'dik') {
      // "Yatirmadan" = kutuyu hic yan yatirma, yuksekligi hep yukari baksin
      suzulmus = izinli.filter((d) => d.dy === kutu.yukseklik);
    }

    return suzulmus.length > 0 ? suzulmus : izinli;
  }

  // --------------------------------------------------------------------------
  //  BOSLUK LISTESI
  //  Boşluklar en ALTTAN, en ONDEN baslayacak sekilde sirali tutulur
  //  (z -> x -> y). Gercek yukleme sirasi budur.
  // --------------------------------------------------------------------------

  function bosluklariSirala(bosluklar) {
    bosluklar.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
  }

  /** Bu boslugu hicbir kutu kullanamaz mi? O zaman kirintidir, atilir. */
  function kirintiMi(bosluk, enKucukKenar) {
    if (bosluk.u < KIRINTI_ESIGI) return true;
    if (bosluk.g < KIRINTI_ESIGI) return true;
    if (bosluk.yuk < KIRINTI_ESIGI) return true;
    // Hicbir kutunun en kucuk kenari sigmiyorsa da kirintidir
    const e = enKucukKenar - 1e-9;
    return bosluk.u < e || bosluk.g < e || bosluk.yuk < e;
  }

  // --------------------------------------------------------------------------
  //  BLOK BOLME (artan kutular)
  //  Istenen adet tam bir izgaraya denk gelmezse gercek yuklemede oldugu gibi
  //  davranir: once TAM KESITLER, sonra artanlar son sutuna dizilir.
  //
  //  Ornek: kapasite nx>=2, ny=5, nz=11 iken 100 kutu istendi:
  //    1x5x11 = 55  +  1x4x11 = 44  +  1x1x1 = 1  ->  100
  // --------------------------------------------------------------------------

  /**
   * @returns {{parcalar, kullanilanU, ekBosluklar}}
   *   parcalar    : [{ex, ey, ez, nx, ny, nz, adet}] - bosluga GORELI konum
   *   kullanilanU : x ekseninde tuketilen uzunluk (sinir kutusu)
   *   ekBosluklar : sinir kutusunun icinde bos kalan yerler (goreli konum)
   */
  function blogaBol(istenen, nx, ny, nz, du, dg, dy, ustuKullanilabilir) {
    const parcalar = [];
    const ekBosluklar = [];

    const kesit = ny * nz; // bir x-diliminde kac kutu var
    const tamKesit = Math.floor(istenen / kesit);
    const kalan = istenen - tamKesit * kesit;

    if (tamKesit > 0) {
      parcalar.push({
        ex: 0,
        ey: 0,
        ez: 0,
        nx: tamKesit,
        ny: ny,
        nz: nz,
        adet: tamKesit * kesit,
      });
    }

    let kullanilanU = tamKesit * du;

    if (kalan > 0) {
      const exKismi = tamKesit * du;
      const tamSutun = Math.floor(kalan / nz); // kac tam sutun (y yonunde)
      const kalan2 = kalan - tamSutun * nz; // en son sutunda kac kat

      if (tamSutun > 0) {
        parcalar.push({
          ex: exKismi,
          ey: 0,
          ez: 0,
          nx: 1,
          ny: tamSutun,
          nz: nz,
          adet: tamSutun * nz,
        });
      }

      let yBosBaslangic = tamSutun * dg;

      if (kalan2 > 0) {
        parcalar.push({
          ex: exKismi,
          ey: tamSutun * dg,
          ez: 0,
          nx: 1,
          ny: 1,
          nz: kalan2,
          adet: kalan2,
        });
        // Yarim kalan sutunun USTUNDEKI bosluk (istif izin veriyorsa)
        if (ustuKullanilabilir && nz - kalan2 > 0) {
          ekBosluklar.push({
            ex: exKismi,
            ey: tamSutun * dg,
            ez: kalan2 * dy,
            u: du,
            g: dg,
            yuk: (nz - kalan2) * dy,
          });
        }
        yBosBaslangic = (tamSutun + 1) * dg;
      }

      // Yarim kalan dilimin geri kalan y bolgesi
      const gKalan = ny * dg - yBosBaslangic;
      if (gKalan > 0) {
        ekBosluklar.push({
          ex: exKismi,
          ey: yBosBaslangic,
          ez: 0,
          u: du,
          g: gKalan,
          yuk: nz * dy,
        });
      }

      kullanilanU += du; // yarim dilim de bir tam dilim yer kaplar
    }

    return { parcalar, kullanilanU, ekBosluklar };
  }

  // --------------------------------------------------------------------------
  //  Bir boslugu en iyi dolduran (kalem, durus) ikilisini bulur
  // --------------------------------------------------------------------------

  function enIyiyiBul(bosluk, asama, ayar, maksAgirlik, toplamAgirlik) {
    let enIyi = null;

    for (const h of asama) {
      if (h.kalanAdet <= 0) continue;

      // Agirlik kapasitesinden kac tane sigar?
      let agirlikSiniriAdet = Infinity;
      if (ayar.agirlikSiniri && maksAgirlik > 0 && h.kutu.agirlik > 0) {
        const kalanKapasite = maksAgirlik - toplamAgirlik;
        if (kalanKapasite <= 0) continue;
        agirlikSiniriAdet = Math.floor(kalanKapasite / h.kutu.agirlik);
        if (agirlikSiniriAdet <= 0) continue;
      }

      for (const d of h.duruslar) {
        const nx = Math.floor(bosluk.u / d.du);
        const ny = Math.floor(bosluk.g / d.dg);
        let nz = Math.floor(bosluk.yuk / d.dy);
        if (nx <= 0 || ny <= 0 || nz <= 0) continue;

        // Istif siniri: 0 = sinirsiz
        if (h.kutu.maksIstif > 0) nz = Math.min(nz, h.kutu.maksIstif);
        if (nz <= 0) continue;

        // Uc kuralla kirp: kalan siparis / istif / agirlik
        let adet = nx * ny * nz;
        if (h.kalanAdet !== Infinity) adet = Math.min(adet, h.kalanAdet);
        adet = Math.min(adet, agirlikSiniriAdet);
        if (adet <= 0) continue;

        // Puan: hacim mi adet mi
        const puan = ayar.puan === 'adet' ? adet : adet * h.hacim;

        // Israf: sinir kutusu hacmi - yerlesen net kutu hacmi
        const kullanilanU = Math.ceil(adet / (ny * nz)) * d.du;
        const sinirHacmi = kullanilanU * (ny * d.dg) * (nz * d.dy);
        const israf = sinirHacmi - adet * h.hacim;

        // Esitlikte: daha yuksek istif -> sonra daha az israf
        const dahaIyi =
          enIyi === null ||
          puan > enIyi.puan + 1e-9 ||
          (Math.abs(puan - enIyi.puan) < 1e-9 &&
            (nz > enIyi.nz ||
              (nz === enIyi.nz && israf < enIyi.israf - 1e-9)));

        if (dahaIyi) {
          enIyi = { hazir: h, durus: d, nx, ny, nz, adet, puan, israf };
        }
      }
    }

    return enIyi;
  }

  // --------------------------------------------------------------------------
  //  ANA HESAP
  // --------------------------------------------------------------------------

  /**
   * @param {Object} arac      {uzunluk, genislik, yukseklik, maksAgirlik}
   * @param {Array}  kalemler  [{kutu, adet, maks}]
   *   kutu: {id, ad, uzunluk, genislik, yukseklik, agirlik, renk,
   *          yatirilabilir, maksIstif, icerik, not}
   *   adet: tam sayi (0 ise ve maks yoksa bu kalem atlanir)
   *   maks: true ise "sigdigi kadar"
   * @param {Object} secenekler {yonelim, puan, pay, agirlikSiniri}
   */
  function planla(arac, kalemler, secenekler) {
    // OPTIMUM: tek bir kural degil, aramadir. Butun aday birlesimleri dener,
    // en iyisini dondurur. Adaylarin icinde 'optimum' YOK -> ozyineleme olmaz.
    if (secenekler && secenekler.yonelim === 'optimum') {
      return enIyiyiSec(arac, kalemler, secenekler);
    }

    const ayar = Object.assign(
      {
        yonelim: 'hepsi', // hepsi | yatay | dikey | boyuna | enine | dik
        puan: 'hacim', // hacim | adet
        pay: 0, // kutular arasi pay (mm)
        agirlikSiniri: true, // false ise sadece hacme bakar
      },
      secenekler || {}
    );

    const U = sayi(arac && arac.uzunluk, 0);
    const G = sayi(arac && arac.genislik, 0);
    const Y = sayi(arac && arac.yukseklik, 0);
    const maksAgirlik = sayi(arac && arac.maksAgirlik, 0);
    const pay = Math.max(0, sayi(ayar.pay, 0));

    const bosSonuc = () => ({
      bloklar: [],
      ozet: ozetHesapla([], U, G, Y, maksAgirlik),
      sigmayanlar: [],
      ayar,
    });

    if (U <= 0 || G <= 0 || Y <= 0) return bosSonuc();

    // ---- Kalemleri hazirla ------------------------------------------------
    const hazir = [];
    for (const kalem of kalemler || []) {
      const k = kalem && kalem.kutu;
      if (!k) continue;

      const u = sayi(k.uzunluk, 0);
      const g = sayi(k.genislik, 0);
      const y = sayi(k.yukseklik, 0);
      if (u <= 0 || g <= 0 || y <= 0) continue;

      const maks = kalem.maks === true;
      const istenen = tamPozitif(kalem.adet);
      if (!maks && istenen === 0) continue; // ne adet ne sonsuz -> atla

      const kutu = {
        id: k.id,
        ad: k.ad || 'Kutu',
        uzunluk: u,
        genislik: g,
        yukseklik: y,
        agirlik: Math.max(0, sayi(k.agirlik, 0)),
        renk: k.renk || '#888888',
        yatirilabilir: k.yatirilabilir !== false,
        maksIstif: tamPozitif(k.maksIstif), // 0 = sinirsiz
        icerik: k.icerik || '',
        not: k.not || '',
      };

      // Payli olculer: her kutunun cevresine pay eklenir
      const duruslar = duruslariSuz(
        duruslariUret(kutu),
        kutu,
        ayar.yonelim
      ).map((d) => ({
        du: d.du + pay,
        dg: d.dg + pay,
        dy: d.dy + pay,
        ad: d.ad,
      }));

      hazir.push({
        kutu,
        duruslar,
        maks,
        istenen,
        kalanAdet: maks ? Infinity : istenen,
        yerlesen: 0,
        hacim: u * g * y, // NET kutu hacmi (pay dahil DEGIL)
      });
    }

    if (hazir.length === 0) return bosSonuc();

    // Kirinti esigi icin en kucuk kenar
    let enKucukKenar = Infinity;
    for (const h of hazir) {
      for (const d of h.duruslar) {
        enKucukKenar = Math.min(enKucukKenar, d.du, d.dg, d.dy);
      }
    }

    // ---- Durum ------------------------------------------------------------
    const bosluklar = [{ x: 0, y: 0, z: 0, u: U, g: G, yuk: Y }];
    const bloklar = [];
    let toplamAgirlik = 0;
    let tur = 0;

    // ---- IKI ASAMALI ONCELIK ---------------------------------------------
    //  Adedi belli kalemler AYRI BIR ASAMADA ve ONCE yerlesir; ancak onlar
    //  bitince "sigdigi kadar" (sonsuz) kalemleri devreye girer.
    //
    //  DIKKAT: Bu kural sart. Tek listede sadece siralama yapilirsa puanlama
    //  onu ezer ve motor butun tiri en verimli kutuyla doldurup adedi belli
    //  kalemleri "sigmadi" ilan eder. (Orijinal surumdeki hata buydu.)
    const asamalar = [
      hazir.filter((h) => !h.maks), // 1. asama: adedi belli
      hazir.filter((h) => h.maks), // 2. asama: sigdigi kadar
    ];

    for (const asama of asamalar) {
      if (asama.length === 0) continue;

      while (bosluklar.length > 0) {
        if (++tur > AZAMI_TUR) break;

        // Bu asamada yerlestirilecek bir sey kaldi mi?
        if (!asama.some((h) => h.kalanAdet > 0)) break;

        bosluklariSirala(bosluklar);
        const bosluk = bosluklar[0];

        const enIyi = enIyiyiBul(bosluk, asama, ayar, maksAgirlik, toplamAgirlik);

        if (!enIyi) {
          // Bu boslukta hicbir sey yerlesemiyor -> at, sonrakine gec
          bosluklar.shift();
          continue;
        }

        const h = enIyi.hazir;
        const d = enIyi.durus;
        const ustuKullanilabilir = h.kutu.maksIstif !== 1;

        // ---- Blogu (gerekiyorsa parcalara bolerek) yerlestir --------------
        const bolum = blogaBol(
          enIyi.adet,
          enIyi.nx,
          enIyi.ny,
          enIyi.nz,
          d.du,
          d.dg,
          d.dy,
          ustuKullanilabilir
        );

        for (const p of bolum.parcalar) {
          bloklar.push({
            kutuId: h.kutu.id,
            kutu: h.kutu,
            durusAd: d.ad,
            // Cizimde kullanilacak PAYSIZ kutu olcusu
            ku: d.du - pay,
            kg: d.dg - pay,
            ky: d.dy - pay,
            // Izgara adimi (pay dahil)
            adimU: d.du,
            adimG: d.dg,
            adimY: d.dy,
            x: bosluk.x + p.ex,
            y: bosluk.y + p.ey,
            z: bosluk.z + p.ez,
            nx: p.nx,
            ny: p.ny,
            nz: p.nz,
            adet: p.adet,
            agirlik: p.adet * h.kutu.agirlik,
            hacim: p.adet * h.hacim,
          });
        }

        h.yerlesen += enIyi.adet;
        if (h.kalanAdet !== Infinity) h.kalanAdet -= enIyi.adet;
        toplamAgirlik += enIyi.adet * h.kutu.agirlik;

        // ---- Boslugu bol (GIYOTIN KESIM) ---------------------------------
        //  Kullanilan sinir kutusu cikarilir, kalan yer uc parcaya bolunur:
        //  ustu, yani, onu. Ucu de birbiriyle cakismaz.
        const kU = bolum.kullanilanU;
        const kG = enIyi.ny * d.dg;
        const kY = enIyi.nz * d.dy;

        bosluklar.shift(); // kullanilan bosluk listeden cikar

        const yeniler = [];

        // 1) USTU - kutunun maksIstif = 1 ise HIC EKLENMEZ (ustune yuk konmaz)
        if (ustuKullanilabilir) {
          yeniler.push({
            x: bosluk.x,
            y: bosluk.y,
            z: bosluk.z + kY,
            u: kU,
            g: kG,
            yuk: bosluk.yuk - kY,
          });
        }

        // 2) YANI - kullanilan ayak izinin y yonundeki artigi, tam yukseklik
        yeniler.push({
          x: bosluk.x,
          y: bosluk.y + kG,
          z: bosluk.z,
          u: kU,
          g: bosluk.g - kG,
          yuk: bosluk.yuk,
        });

        // 3) ONU - x yonundeki artik, tam genislik ve tam yukseklik
        yeniler.push({
          x: bosluk.x + kU,
          y: bosluk.y,
          z: bosluk.z,
          u: bosluk.u - kU,
          g: bosluk.g,
          yuk: bosluk.yuk,
        });

        // 4) Blok bolmeden artan IC bosluklar
        for (const eb of bolum.ekBosluklar) {
          yeniler.push({
            x: bosluk.x + eb.ex,
            y: bosluk.y + eb.ey,
            z: bosluk.z + eb.ez,
            u: eb.u,
            g: eb.g,
            yuk: eb.yuk,
          });
        }

        for (const yb of yeniler) {
          if (yb.u > 0 && yb.g > 0 && yb.yuk > 0 && !kirintiMi(yb, enKucukKenar)) {
            bosluklar.push(yb);
          }
        }
      }
    }

    // ---- Sigmayanlar ------------------------------------------------------
    const sigmayanlar = [];
    for (const h of hazir) {
      if (!h.maks && h.yerlesen < h.istenen) {
        sigmayanlar.push({
          kutuId: h.kutu.id,
          ad: h.kutu.ad,
          istenen: h.istenen,
          yerlesen: h.yerlesen,
          kalan: h.istenen - h.yerlesen,
        });
      }
    }

    return {
      bloklar,
      ozet: ozetHesapla(bloklar, U, G, Y, maksAgirlik),
      sigmayanlar,
      ayar,
    };
  }

  // --------------------------------------------------------------------------
  //  OZET  (ustteki 6 gostergenin kaynagi)
  // --------------------------------------------------------------------------

  function ozetHesapla(bloklar, U, G, Y, maksAgirlik) {
    const kasaHacmi = U * G * Y;
    let toplamAdet = 0;
    let toplamHacim = 0;
    let toplamAgirlik = 0;
    let kullanilanUzunluk = 0;
    let yukYuksekligi = 0;
    let momentX = 0;

    for (const b of bloklar) {
      toplamAdet += b.adet;
      toplamHacim += b.hacim;
      toplamAgirlik += b.agirlik;

      const bitisX = b.x + b.nx * b.adimU;
      const bitisZ = b.z + b.nz * b.adimY;
      if (bitisX > kullanilanUzunluk) kullanilanUzunluk = bitisX;
      if (bitisZ > yukYuksekligi) yukYuksekligi = bitisZ;

      // Blogun agirlik merkezi x'i = ortasi
      momentX += b.agirlik * (b.x + (b.nx * b.adimU) / 2);
    }

    const agirlikMerkeziMm = toplamAgirlik > 0 ? momentX / toplamAgirlik : 0;

    return {
      toplamAdet,
      blokSayisi: bloklar.length,
      hacimDoluluk: kasaHacmi > 0 ? (toplamHacim / kasaHacmi) * 100 : 0,
      toplamHacim,
      kasaHacmi,
      toplamAgirlik,
      agirlikYuzde: maksAgirlik > 0 ? (toplamAgirlik / maksAgirlik) * 100 : 0,
      kullanilanUzunluk,
      bosUzunluk: Math.max(0, U - kullanilanUzunluk),
      yukYuksekligi,
      bosYukseklik: Math.max(0, Y - yukYuksekligi),
      agirlikMerkezi: U > 0 ? (agirlikMerkeziMm / U) * 100 : 0,
      agirlikMerkeziMm,
      maksAgirlik,
    };
  }

  // --------------------------------------------------------------------------
  //  OPTIMUM SECIM
  //
  //  Sira onemli: once "istenen adetler sigdi mi", sonra "kac kutu girdi",
  //  en son "hacim ne kadar doldu". Boylece adedi belli bir yuk varken
  //  bir kismini disarida birakan ama hacmi daha iyi dolduran plan
  //  secilmez - kullanicinin asil derdi yukun sigmasi.
  // --------------------------------------------------------------------------

  function sigmayanToplami(plan) {
    let t = 0;
    for (const s of plan.sigmayanlar) t += s.kalan;
    return t;
  }

  /** a, b'den daha iyi mi? */
  function dahaIyi(a, b) {
    if (!b) return true;
    const ak = sigmayanToplami(a);
    const bk = sigmayanToplami(b);
    if (ak !== bk) return ak < bk; // az sigmayan kazanir
    if (a.ozet.toplamAdet !== b.ozet.toplamAdet) {
      return a.ozet.toplamAdet > b.ozet.toplamAdet; // cok kutu kazanir
    }
    if (a.ozet.hacimDoluluk !== b.ozet.hacimDoluluk) {
      return a.ozet.hacimDoluluk > b.ozet.hacimDoluluk;
    }
    // Esitse daha az blok = elle yuklemesi daha kolay
    return a.ozet.blokSayisi < b.ozet.blokSayisi;
  }

  function enIyiyiSec(arac, kalemler, ekAyar) {
    let enIyi = null;
    let enIyiAday = null;

    for (const aday of OPTIMUM_ADAYLAR) {
      const plan = planla(arac, kalemler, Object.assign({}, ekAyar, aday));
      if (dahaIyi(plan, enIyi)) {
        enIyi = plan;
        enIyiAday = aday;
      }
    }

    if (!enIyi) return planla(arac, kalemler, Object.assign({}, ekAyar, { yonelim: 'hepsi' }));

    // Hangi birlesimin kazandigi arayuzde gosterilebilsin
    enIyi.ayar = Object.assign({}, enIyi.ayar, {
      yonelim: 'optimum',
      secilenYonelim: enIyiAday.yonelim,
      secilenPuan: enIyiAday.puan,
      denenenAdaySayisi: OPTIMUM_ADAYLAR.length,
    });
    return enIyi;
  }

  // --------------------------------------------------------------------------
  //  Butun stratejileri hesapla (karsilastirma sekmesi icin)
  // --------------------------------------------------------------------------

  function hepsiniHesapla(arac, kalemler, ekAyar) {
    const sonuclar = [];
    for (const s of STRATEJILER) {
      const secenekler = Object.assign({}, ekAyar || {}, {
        yonelim: s.yonelim,
        puan: s.puan,
      });
      const plan = planla(arac, kalemler, secenekler);
      sonuclar.push({
        id: s.id,
        ad: s.ad,
        aciklama: s.aciklama,
        plan,
        adet: plan.ozet.toplamAdet,
        doluluk: plan.ozet.hacimDoluluk,
        agirlik: plan.ozet.toplamAgirlik,
      });
    }

    // En iyiyi isaretle, digerlerinin yuzde farkini yaz
    let enIyiAdet = 0;
    for (const s of sonuclar) if (s.adet > enIyiAdet) enIyiAdet = s.adet;
    for (const s of sonuclar) {
      s.enIyi = enIyiAdet > 0 && s.adet === enIyiAdet;
      s.fark = enIyiAdet > 0 ? ((s.adet - enIyiAdet) / enIyiAdet) * 100 : 0;
    }
    return sonuclar;
  }

  // --------------------------------------------------------------------------
  //  Bloklari tek tek kutuya ac (cizim ve dogrulama testleri icin)
  // --------------------------------------------------------------------------

  function kutulariAc(bloklar) {
    const kutular = [];
    for (const b of bloklar) {
      for (let i = 0; i < b.nx; i++) {
        for (let j = 0; j < b.ny; j++) {
          for (let k = 0; k < b.nz; k++) {
            kutular.push({
              kutuId: b.kutuId,
              x: b.x + i * b.adimU,
              y: b.y + j * b.adimG,
              z: b.z + k * b.adimY,
              u: b.ku,
              g: b.kg,
              yuk: b.ky,
            });
          }
        }
      }
    }
    return kutular;
  }

  // --------------------------------------------------------------------------
  //  Bir kutunun bu araca kac tane sigdigi (katalogdaki canli hesap icin)
  // --------------------------------------------------------------------------

  function tekKutuKapasitesi(arac, kutu, secenekler) {
    const plan = planla(arac, [{ kutu, maks: true }], secenekler);
    const o = plan.ozet;

    // Sinirlayan etken AGIRLIK mi?
    // Kural: bir tane DAHA koysam kapasiteyi asiyor muyum.
    // (Katalogdaki  ⚖  isareti bunu gosterir - hacim degil, agirlik doldu.)
    const agirlikDoldu =
      o.maksAgirlik > 0 &&
      kutu.agirlik > 0 &&
      o.toplamAgirlik + Number(kutu.agirlik) > o.maksAgirlik;

    return {
      adet: o.toplamAdet,
      doluluk: o.hacimDoluluk,
      agirlik: o.toplamAgirlik,
      sinirlayan: agirlikDoldu ? 'agirlik' : 'hacim',
    };
  }

  // --------------------------------------------------------------------------
  //  Disa acilan arayuz
  // --------------------------------------------------------------------------

  const Yerlesim = {
    STRATEJILER,
    planla,
    hepsiniHesapla,
    kutulariAc,
    tekKutuKapasitesi,
    duruslariUret,
    ozetHesapla,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Yerlesim; // Node.js
  }
  kok.Yerlesim = Yerlesim; // tarayici
})(typeof globalThis !== 'undefined' ? globalThis : this);
