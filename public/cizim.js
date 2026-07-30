/* ==========================================================================
   DEPOLAMA - 2B cizimler  (FAZ 3b)

   Iki gorunum var, ikisi de duz 2B canvas - three.js FAZ 4'te gelecek:

     kusbakisi(...)  yukaridan bakis. Ekran X = arac uzunlugu, Y = genislik.
     yandan(...)     yandan kesit.   Ekran X = arac uzunlugu, Y = yukseklik.

   Motorun koordinat sistemi:  x = uzunluk, y = genislik, z = yukseklik (mm).
   Cizim de mm ile calisir, ekrana yazarken cm/m'ye cevrilir.

   Bu dosya DURUM TUTMAZ. Plani alir, tuvale cizer, biter. Katman secimi gibi
   secimler uygulama.js'te durur ve parametre olarak gelir.
   ========================================================================== */

(function (kok) {
  'use strict';

  // Tuvalin kenarlarinda birakilan bosluk (CSS pikseli) - olcu cizgileri
  // ve "ON" etiketi buraya siginiyor.
  // Alt bosluk iki olcu cizgisi tasiyor (toplam uzunluk + dolu uzunluk).
  const KENAR = { sol: 58, sag: 20, ust: 18, alt: 50 };

  // Cizim alani bundan daha uzun olmasin: kisa ve genis bir kasada
  // (orn. 400 x 240 cm) en-boy orani korunurken tuval ekrandan tasiyordu.
  const EN_FAZLA_YUK = 460;

  // Bir kutunun kenari bu esikten kucukse tek tek cizmek anlamsiz: pikseller
  // birbirine giriyor, gorunen sey yine dolu bir dikdortgen oluyor - ama
  // 900.000 kez fillRect cagirmak tarayiciyi kilitliyor. O yuzden blok
  // TEK PARCA boyanir. Rehberdeki "3 piksel esigi" budur.
  const ESIK_PX = 3;

  // Kutu kenar cizgisi ancak bu boydan sonra bir sey anlatiyor.
  const CIZGI_ESIK_PX = 5;

  const YAZI = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, ' +
               'Arial, sans-serif';
  const YAZI_KALIN = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", ' +
                     'Roboto, Arial, sans-serif';

  // ------------------------------------------------------------------- renk
  //
  // Palet stil.css'teki :root degiskenlerinden okunur - renkleri burada
  // ikinci kez yazmak iki dosyanin zamanla ayrismasi demek olurdu.

  let R = null;

  function renkler() {
    if (R) return R;
    const s = getComputedStyle(document.documentElement);
    const al = (ad, yedek) => s.getPropertyValue(ad).trim() || yedek;
    R = {
      zemin: al('--zemin', '#14161a'),
      yuzey: al('--yuzey', '#1d2026'),
      yuzey2: al('--yuzey2', '#23272f'),
      kenar: al('--kenar', '#2c313a'),
      yazi: al('--yazi', '#e6e8eb'),
      soluk: al('--soluk', '#8b929d'),
      vurgu: al('--vurgu', '#4a9eff'),
      sari: al('--sari', '#ffd43b'),
    };
    return R;
  }

  // ------------------------------------------------------------------ birim

  const cmYaz = (mm) => (Number(mm || 0) / 10).toLocaleString('tr-TR', {
    minimumFractionDigits: 0, maximumFractionDigits: 1,
  });

  const metreYaz = (mm) => (Number(mm || 0) / 1000).toLocaleString('tr-TR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }) + ' m';

  // ===========================================================================
  //  SAHNE KURULUMU
  // ===========================================================================

  /**
   * Tuvali kapsayicisinin genisligine gore boyutlar, retina icin olceklendirir
   * ve mm -> ekran pikseli cevrimini hazirlar.
   *
   * @param {HTMLCanvasElement} tuval
   * @param {number} enMm   yatay eksende cizilecek olcu (arac uzunlugu)
   * @param {number} boyMm  dusey eksende cizilecek olcu (genislik / yukseklik)
   * @returns {Object|null} kapsayici henuz gorunmuyorsa null
   */
  function sahneKur(tuval, enMm, boyMm) {
    const kapsayici = tuval.parentElement;
    // clientWidth ic dolguyu (padding) da sayiyor; onu cikarmazsak tuval
    // sarmalindan dolgu kadar tasar ve sag kenari kirpilir.
    let cssGen = 0;
    if (kapsayici) {
      const bicim = getComputedStyle(kapsayici);
      cssGen = kapsayici.clientWidth -
               parseFloat(bicim.paddingLeft || 0) -
               parseFloat(bicim.paddingRight || 0);
    }

    // Gizli sekmedeki tuvalin genisligi 0'dir - cizmenin anlami yok.
    // Alt sinir kenar bosluklarina bagli: daha darda cizim alani negatife
    // duser ve olcek bozulur.
    if (cssGen < KENAR.sol + KENAR.sag + 40 || enMm <= 0 || boyMm <= 0) return null;

    const alan = cssGen - KENAR.sol - KENAR.sag;
    let olcek = alan / enMm;
    if (boyMm * olcek > EN_FAZLA_YUK) olcek = EN_FAZLA_YUK / boyMm;

    const cizimGen = enMm * olcek;
    const cizimYuk = boyMm * olcek;

    // Yuksekligi kisilmisse cizim daralir; ortala.
    const sol = KENAR.sol + (alan - cizimGen) / 2;
    const ust = KENAR.ust;
    const cssYuk = Math.round(cizimYuk + KENAR.ust + KENAR.alt);

    const dpr = window.devicePixelRatio || 1;
    tuval.width = Math.round(cssGen * dpr);
    tuval.height = Math.round(cssYuk * dpr);
    tuval.style.width = cssGen + 'px';
    tuval.style.height = cssYuk + 'px';

    const c = tuval.getContext('2d');
    // Bundan sonra her sey CSS pikseliyle cizilir, retina ayrintisi burada kalir.
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, cssGen, cssYuk);
    c.font = YAZI;

    return {
      c, olcek, sol, ust, cizimGen, cizimYuk, cssGen, cssYuk,
      px: (x) => sol + x * olcek,
      // Dusey eksen: kusbakisinda yukaridan asagi (genislik), yandan
      // gorunumde asagidan yukari (yukseklik) - ikisi ayri kurulur.
      pyInen: (v) => ust + v * olcek,
      pyCikan: (v) => ust + cizimYuk - v * olcek,
    };
  }

  // ===========================================================================
  //  CIZIM PARCALARI
  // ===========================================================================

  /** Kasa dikdortgeni: ic yuzey + kenar. */
  function kasaCiz(s, renk) {
    const { c } = s;
    c.fillStyle = renk.zemin;
    c.fillRect(s.sol, s.ust, s.cizimGen, s.cizimYuk);
    c.strokeStyle = renk.kenar;
    c.lineWidth = 1;
    c.strokeRect(s.sol + 0.5, s.ust + 0.5, s.cizimGen - 1, s.cizimYuk - 1);
  }

  /** Tek kutu. Cizgi ancak yeterince buyukse cekilir. */
  function kutuCiz(c, x, y, g, y2, renk, cizgili) {
    c.fillStyle = renk;
    c.fillRect(x, y, g, y2);
    if (!cizgili) return;
    c.strokeStyle = 'rgb(0 0 0 / 0.45)';
    c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, g - 1, y2 - 1);
  }

  /** Esik altinda kalan blok: tek parca + belirgin kenar. */
  function blokTekParca(c, x, y, g, y2, renk) {
    c.fillStyle = renk;
    c.fillRect(x, y, g, y2);
    c.strokeStyle = 'rgb(0 0 0 / 0.55)';
    c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, Math.max(0, g - 1), Math.max(0, y2 - 1));
  }

  /** Yatay olcu cizgisi: iki ucta tirnak, ortada zemine oturan etiket. */
  function olcuYatay(s, x1, x2, y, metin, renk, vurgulu) {
    const { c } = s;
    const R2 = renkler();
    c.strokeStyle = renk || R2.kenar;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x1 + 0.5, y - 4); c.lineTo(x1 + 0.5, y + 4);
    c.moveTo(x2 - 0.5, y - 4); c.lineTo(x2 - 0.5, y + 4);
    c.moveTo(x1, y + 0.5); c.lineTo(x2, y + 0.5);
    c.stroke();
    etiket(c, metin, (x1 + x2) / 2, y, vurgulu ? R2.yazi : R2.soluk, vurgulu);
  }

  /** Dusey olcu cizgisi. Yazi 90 derece dondurulur. */
  function olcuDikey(s, y1, y2, x, metin, renk, vurgulu) {
    const { c } = s;
    const R2 = renkler();
    c.strokeStyle = renk || R2.kenar;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x - 4, y1 + 0.5); c.lineTo(x + 4, y1 + 0.5);
    c.moveTo(x - 4, y2 - 0.5); c.lineTo(x + 4, y2 - 0.5);
    c.moveTo(x + 0.5, y1); c.lineTo(x + 0.5, y2);
    c.stroke();

    c.save();
    c.translate(x, (y1 + y2) / 2);
    c.rotate(-Math.PI / 2);
    etiket(c, metin, 0, 0, vurgulu ? R2.yazi : R2.soluk, vurgulu);
    c.restore();
  }

  /** Cizgiyi keserek zemine oturan kucuk yazi. */
  function etiket(c, metin, x, y, yaziRenk, kalin) {
    const R2 = renkler();
    c.font = kalin ? YAZI_KALIN : YAZI;
    const g = c.measureText(metin).width;
    c.fillStyle = R2.zemin;
    c.fillRect(x - g / 2 - 4, y - 7, g + 8, 14);
    c.fillStyle = yaziRenk;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(metin, x, y);
    c.font = YAZI;
  }

  /** Kesikli cizgi (kullanilan uzunluk, yuk yuksekligi). */
  function kesikli(c, x1, y1, x2, y2, renk) {
    c.save();
    c.setLineDash([4, 4]);
    c.strokeStyle = renk;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
    c.restore();
  }

  /** Bos kalan bolgeye taranmis gorunum - "burada yuk yok" demek icin. */
  function tarama(c, x, y, g, yuk, renk) {
    if (g <= 0 || yuk <= 0) return;
    c.save();
    c.beginPath();
    c.rect(x, y, g, yuk);
    c.clip();
    c.strokeStyle = renk;
    c.lineWidth = 1;
    c.globalAlpha = 0.5;
    c.beginPath();
    for (let i = -yuk; i < g + yuk; i += 9) {
      c.moveTo(x + i, y + yuk);
      c.lineTo(x + i + yuk, y);
    }
    c.stroke();
    c.restore();
  }

  // ===========================================================================
  //  KATMANLAR
  // ===========================================================================

  /**
   * Yuktaki farkli kat yuksekliklerini (kutu tabani z degerlerini) sirali
   * dondurur. Katman kaydiricisinin kaynagi budur.
   *
   * Ayni z'de baslayan kutular tek katman sayilir; farkli yuksekliklerde
   * kutular varsa katman sayisi kutu cesidinden bagimsiz olarak artar.
   */
  function katmanlar(bloklar) {
    const kume = new Set();
    for (const b of bloklar || []) {
      for (let k = 0; k < b.nz; k++) kume.add(b.z + k * b.adimY);
    }
    return Array.from(kume).sort((a, b) => a - b);
  }

  /**
   * Blogun verilen kesit yuksekliginde hangi kati gorunuyor?
   * @returns {number} kat indisi (0..nz-1), kesit blogu kesmiyorsa -1
   */
  function katmanKati(b, z) {
    if (z < b.z) return -1;
    const k = Math.floor((z - b.z) / b.adimY);
    if (k < 0 || k >= b.nz) return -1;
    // Izgara adimi kutudan buyuk olabilir (kutular arasi pay): kesit paya
    // denk geliyorsa o katta kutu yok.
    if (z >= b.z + k * b.adimY + b.ky) return -1;
    return k;
  }

  // ===========================================================================
  //  KUSBAKISI
  // ===========================================================================

  /**
   * @param {HTMLCanvasElement} tuval
   * @param {Object} plan   Yerlesim.planla() sonucu
   * @param {Object} arac   {uzunluk, genislik, yukseklik} (mm)
   * @param {Object} ayar   {kesitZ: number|null}  null = butun katmanlar
   * @returns {boolean} cizildi mi
   */
  function kusbakisi(tuval, plan, arac, ayar) {
    const renk = renkler();
    const U = Number(arac && arac.uzunluk) || 0;
    const G = Number(arac && arac.genislik) || 0;

    const s = sahneKur(tuval, U, G);
    if (!s) return false;

    const kesitZ = ayar && ayar.kesitZ !== undefined ? ayar.kesitZ : null;
    kasaCiz(s, renk);

    // ---- kutular ---------------------------------------------------------
    //
    // Bloklar z'ye gore artan sirada cizilir: ustteki kat alttakini kapatir,
    // yukaridan bakinca gozun gordugu sey de bu.
    //
    // Bir blogun ayni (i,j) sutunundaki butun kutular AYNI ayak izine sahip;
    // yukaridan bakinca sadece en ustteki gorunur. O yuzden nz kadar degil,
    // sutun basina TEK kutu cizilir - 1.440 kutuluk yukte 1.440 yerine 240
    // dikdortgen.
    const sirali = (plan.bloklar || []).slice().sort((a, b) => a.z - b.z);

    for (const b of sirali) {
      // Katman secilmisse: bu blogun o kesitte kutusu var mi?
      if (kesitZ !== null && katmanKati(b, kesitZ) < 0) continue;

      const kutuRenk = (b.kutu && b.kutu.renk) || '#888888';
      const pxU = b.ku * s.olcek;
      const pxG = b.kg * s.olcek;

      // 3 piksel esigi: tek tek cizmek gorseli degistirmiyor, sadece yaviyor
      if (pxU < ESIK_PX || pxG < ESIK_PX) {
        blokTekParca(
          s.c,
          s.px(b.x), s.pyInen(b.y),
          b.nx * b.adimU * s.olcek, b.ny * b.adimG * s.olcek,
          kutuRenk
        );
        continue;
      }

      const cizgili = pxU >= CIZGI_ESIK_PX && pxG >= CIZGI_ESIK_PX;
      for (let i = 0; i < b.nx; i++) {
        const x = s.px(b.x + i * b.adimU);
        for (let j = 0; j < b.ny; j++) {
          kutuCiz(s.c, x, s.pyInen(b.y + j * b.adimG), pxU, pxG, kutuRenk, cizgili);
        }
      }
    }

    // ---- bos kalan arka bolge -------------------------------------------
    const o = plan.ozet || {};
    const kullanilan = Number(o.kullanilanUzunluk) || 0;

    if (kesitZ === null && kullanilan > 0 && U - kullanilan > 1) {
      tarama(
        s.c, s.px(kullanilan), s.pyInen(0),
        (U - kullanilan) * s.olcek, s.cizimYuk, renk.kenar
      );
      kesikli(s.c, s.px(kullanilan), s.ust, s.px(kullanilan),
              s.ust + s.cizimYuk, renk.sari);
    }

    // ---- ON isareti ------------------------------------------------------
    s.c.save();
    s.c.font = YAZI_KALIN;
    s.c.fillStyle = renk.soluk;
    s.c.textAlign = 'left';
    s.c.textBaseline = 'top';
    s.c.fillText('ÖN ▸', s.sol + 4, s.ust - 15);
    s.c.restore();

    // ---- olcu cizgileri --------------------------------------------------
    const altY = s.ust + s.cizimYuk + 20;
    olcuYatay(s, s.sol, s.sol + s.cizimGen, altY, metreYaz(U) + ' iç uzunluk', renk.kenar);

    if (kesitZ === null && kullanilan > 0 && kullanilan < U) {
      olcuYatay(s, s.sol, s.px(kullanilan), altY + 17,
                'dolu ' + metreYaz(kullanilan), renk.sari, true);
    }

    olcuDikey(s, s.ust, s.ust + s.cizimYuk, s.sol - 22,
              metreYaz(G) + ' genişlik', renk.kenar);

    return true;
  }

  // ===========================================================================
  //  YANDAN KESIT
  // ===========================================================================

  /**
   * @param {HTMLCanvasElement} tuval
   * @param {Object} plan
   * @param {Object} arac  {uzunluk, genislik, yukseklik} (mm)
   * @returns {boolean} cizildi mi
   */
  function yandan(tuval, plan, arac) {
    const renk = renkler();
    const U = Number(arac && arac.uzunluk) || 0;
    const Y = Number(arac && arac.yukseklik) || 0;

    const s = sahneKur(tuval, U, Y);
    if (!s) return false;

    kasaCiz(s, renk);

    // ---- kutular ---------------------------------------------------------
    //
    // Yandan bakiyoruz: genislik ekseni (y) derinlik oluyor. y'si buyuk olan
    // blok arkada kalir, once o cizilir; on siradaki (y=0) en son cizilip
    // ustune biner.
    //
    // Bir blogun ayni (i,k) sirasindaki kutular derinlikte ust uste; yandan
    // bakinca sadece en ondeki (j=0) gorunur - o yuzden ny kadar degil,
    // sira basina TEK kutu cizilir.
    const sirali = (plan.bloklar || []).slice().sort((a, b) => b.y - a.y);

    for (const b of sirali) {
      const kutuRenk = (b.kutu && b.kutu.renk) || '#888888';
      const pxU = b.ku * s.olcek;
      const pxY = b.ky * s.olcek;

      if (pxU < ESIK_PX || pxY < ESIK_PX) {
        const yukseklikMm = b.nz * b.adimY;
        blokTekParca(
          s.c,
          s.px(b.x), s.pyCikan(b.z + yukseklikMm),
          b.nx * b.adimU * s.olcek, yukseklikMm * s.olcek,
          kutuRenk
        );
        continue;
      }

      const cizgili = pxU >= CIZGI_ESIK_PX && pxY >= CIZGI_ESIK_PX;
      for (let i = 0; i < b.nx; i++) {
        const x = s.px(b.x + i * b.adimU);
        for (let k = 0; k < b.nz; k++) {
          // pyCikan kutunun TABANINI degil tepesini istiyor: canvas y'si
          // asagi dogru buyuyor, dikdortgen sol-UST kosesinden ciziliyor.
          kutuCiz(s.c, x, s.pyCikan(b.z + k * b.adimY + b.ky), pxU, pxY,
                  kutuRenk, cizgili);
        }
      }
    }

    // ---- yuk yuksekligi + tavan boslugu ---------------------------------
    const o = plan.ozet || {};
    const yukY = Number(o.yukYuksekligi) || 0;
    const bosY = Math.max(0, Y - yukY);
    const kullanilan = Number(o.kullanilanUzunluk) || 0;

    if (yukY > 0 && bosY > 1) {
      // Tavan boslugu: yukun bittigi yerden tavana kadar taranir
      tarama(s.c, s.sol, s.ust, s.cizimGen, s.pyCikan(yukY) - s.ust, renk.kenar);
      kesikli(s.c, s.sol, s.pyCikan(yukY), s.sol + s.cizimGen,
              s.pyCikan(yukY), renk.vurgu);
    }

    if (kullanilan > 0 && U - kullanilan > 1) {
      kesikli(s.c, s.px(kullanilan), s.ust, s.px(kullanilan),
              s.ust + s.cizimYuk, renk.sari);
    }

    // ---- olcu cizgileri --------------------------------------------------
    const altY = s.ust + s.cizimYuk + 20;
    olcuYatay(s, s.sol, s.sol + s.cizimGen, altY, metreYaz(U) + ' iç uzunluk', renk.kenar);

    if (kullanilan > 0 && kullanilan < U) {
      olcuYatay(s, s.sol, s.px(kullanilan), altY + 17,
                'dolu ' + metreYaz(kullanilan), renk.sari, true);
    }

    // Solda toplam ic yukseklik, sagda yuk yuksekligi ve tavan boslugu
    olcuDikey(s, s.ust, s.ust + s.cizimYuk, s.sol - 22,
              metreYaz(Y) + ' iç yükseklik', renk.kenar);

    if (yukY > 0) {
      const sagX = s.sol + s.cizimGen + 9;
      olcuDikey(s, s.pyCikan(yukY), s.ust + s.cizimYuk, sagX,
                'yük ' + metreYaz(yukY), renk.vurgu, true);
      if (bosY > 1) {
        olcuDikey(s, s.ust, s.pyCikan(yukY), sagX,
                  'tavan ' + metreYaz(bosY), renk.soluk);
      }
    }

    return true;
  }

  // ===========================================================================
  //  DISA ACILAN ARAYUZ
  // ===========================================================================

  kok.Cizim = { kusbakisi, yandan, katmanlar, katmanKati, cmYaz, metreYaz };

  // Katman mantigi ve birim cevrimi DOM'a bagli degil - Node testleri bunlari
  // dogrudan cagiriyor. Cizim fonksiyonlari tuval istedigi icin testte yok.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = kok.Cizim;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
