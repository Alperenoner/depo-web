/* ==========================================================================
   DEPOLAMA - 3B gorunum  (FAZ 4)

   three.js sahnesi. cizim.js gibi bu dosya da PLANI ALIR, CIZER; hangi
   sekmenin acik oldugunu, hangi kipin secildigini bilmez - onlar uygulama.js'te.

   ---- Eksen cevrimi -------------------------------------------------------
   Motorun sistemi:  x = uzunluk, y = genislik, z = yukseklik  (mm)
   three.js'te Y YUKARI bakar, o yuzden:

       three.x = x (uzunluk)   three.y = z (yukseklik)   three.z = y (genislik)

   Ayrica mm degerleri three icin fazla buyuk (14000); sahne METRE ile kurulur
   (OLCEK = 0.001). Kamera yakin/uzak duzlemleri ve isik mesafeleri boylece
   makul sayilarda kaliyor.

   ---- Iki kip -------------------------------------------------------------
   30.000 kutuya kadar her kutu ayri cizilir (InstancedMesh). Ustunde bloklar
   tek parca cizilip yuzlerine izgara dokusu basilir - ekran karti 900.000
   kutu cizmek zorunda kalmaz, kutular yine tek tek gorunur.
   ========================================================================== */

(function (kok) {
  'use strict';

  // Bu sinirin ustunde blok kipine gecilir (rehber 8.7).
  const TEK_TEK_SINIR = 30000;

  // mm -> metre. Sahne metre ile calisir.
  const OLCEK = 0.001;

  // Kutular arasinda birakilan gorsel bosluk: komsu kutular ayirt edilsin.
  // Gercek olcuyu degistirmez, yalnizca cizimde kutu biraz kucuk gosterilir.
  const KUTU_BOSLUK = 0.985;

  // Izgara dokusunun tek hucresi kac piksel. Buyudukce cizgi keskinlesir ama
  // bellek artar; 64 gozle bakildiginda yeterli.
  const DOKU_HUCRE = 64;

  // ===========================================================================
  //  SAF YARDIMCILAR  (three.js gerekmez - Node testleri bunlari cagiriyor)
  // ===========================================================================

  /** Kac kutu varsa hangi kip kullanilir? */
  function kipSec(toplamAdet) {
    return Number(toplamAdet) > TEK_TEK_SINIR ? 'blok' : 'tek';
  }

  /**
   * Blok kipinde izgara dokusunun her yuzde kac kez tekrarlanacagi.
   *
   * three.js BoxGeometry'de malzeme sirasi: [+x, -x, +y, -y, +z, -z].
   * Eksen cevrimi yuzunden (three.y = yukseklik, three.z = genislik):
   *
   *   +x / -x  yuzu  ->  genislik x yukseklik  ->  (ny, nz)
   *   +y / -y  yuzu  ->  uzunluk  x genislik   ->  (nx, ny)
   *   +z / -z  yuzu  ->  uzunluk  x yukseklik  ->  (nx, nz)
   *
   * Yanlis tekrar sayisi dokuyu kutu izgarasindan kaydirir; goze carpmaz ama
   * sayilar tutmaz. Rehber 8.7 bu ucunu ayri ayri yaziyor, test de oyle.
   *
   * @returns {Array<[number, number]>} 6 yuz icin [tekrarU, tekrarV]
   */
  function yuzTekrarlari(b) {
    const nx = Math.max(1, b.nx | 0);
    const ny = Math.max(1, b.ny | 0);
    const nz = Math.max(1, b.nz | 0);
    return [
      [ny, nz], // +x
      [ny, nz], // -x
      [nx, ny], // +y (ust)
      [nx, ny], // -y (alt)
      [nx, nz], // +z
      [nx, nz], // -z
    ];
  }

  /**
   * Kutu renginde hafif oynama: komsu kutular ayirt edilsin.
   * Konuma bagli, rastgele DEGIL - ayni plan her cizimde ayni gorunur.
   * @returns {number} 0.90 .. 1.10 arasi carpan
   */
  function renkOynamasi(i, j, k) {
    const h = (i * 7 + j * 13 + k * 29) % 9; // 0..8
    return 0.92 + h * 0.02; // 0.92 .. 1.08
  }

  // ===========================================================================
  //  SAHNE DURUMU
  // ===========================================================================

  // Sahne bir kez kurulur, plan degistikce yalnizca icerigi yenilenir.
  let S = null;

  function destekliyorMu() {
    return typeof THREE !== 'undefined' && typeof THREE.WebGLRenderer === 'function';
  }

  /** WebGL gercekten calisiyor mu? (kutuphane yuklu olsa da baglam acilmayabilir) */
  function webglVarMi() {
    try {
      const t = document.createElement('canvas');
      return !!(t.getContext('webgl2') || t.getContext('webgl'));
    } catch (h) {
      return false;
    }
  }

  // ===========================================================================
  //  KURULUM
  // ===========================================================================

  /**
   * @param {HTMLElement} kapsayici  tuvalin konacagi kutu
   * @param {HTMLElement} balon      hover bilgi baloncugu (mutlak konumlu)
   * @returns {boolean} kurulabildi mi
   */
  function kur(kapsayici, balon) {
    if (S) return true;
    if (!destekliyorMu() || !webglVarMi()) return false;

    const gen = Math.max(1, kapsayici.clientWidth);
    const yuk = Math.max(1, kapsayici.clientHeight);

    const cizer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    cizer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    cizer.setSize(gen, yuk);
    // Kesit yuksekligi malzeme bazli kirpma kullaniyor
    cizer.localClippingEnabled = true;
    kapsayici.appendChild(cizer.domElement);

    const sahne = new THREE.Scene();
    sahne.background = new THREE.Color(0x14161a); // stil.css --zemin

    const kamera = new THREE.PerspectiveCamera(45, gen / yuk, 0.05, 500);

    const kontrol = new THREE.OrbitControls(kamera, cizer.domElement);
    kontrol.enableDamping = true;
    kontrol.dampingFactor = 0.08;
    // Zeminin altina gecmek yonu kaybettiriyor
    kontrol.maxPolarAngle = Math.PI / 2 - 0.02;

    // ---- isik ----
    // Yonlu isik golge vermiyor (golge haritasi 900.000 kutuda pahali);
    // yerine iki taraftan dolgu + ortam isigi. Kutu yuzleri boylece
    // birbirinden ayrilir ama hicbir yuz tamamen karanlik kalmaz.
    sahne.add(new THREE.AmbientLight(0xffffff, 0.55));
    const ana = new THREE.DirectionalLight(0xffffff, 0.75);
    ana.position.set(1, 2, 1.5);
    sahne.add(ana);
    const dolgu = new THREE.DirectionalLight(0xffffff, 0.35);
    dolgu.position.set(-1.2, 0.6, -1);
    sahne.add(dolgu);

    const icerik = new THREE.Group();
    sahne.add(icerik);

    // Kesit duzlemi: y (yukseklik) bundan buyuk olan her sey kirpilir.
    // Baslangicta cok yukarida -> hicbir sey kirpilmiyor.
    const kesitDuzlemi = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);

    S = {
      kapsayici, balon, cizer, sahne, kamera, kontrol, icerik, kesitDuzlemi,
      enFazlaAniz: cizer.capabilities.getMaxAnisotropy(),
      isinlayici: new THREE.Raycaster(),
      fare: new THREE.Vector2(),
      fareVar: false,
      // Cizilen plandan tasinan bilgiler
      kip: 'tek',
      kutuBilgisi: [],   // InstancedMesh instanceId -> {ad, x, y, z}
      arac: null,
      toplamOrnek: 0,
      duvarlar: null,
      animasyon: null,   // {baslangic, sure}
      calisiyor: false,
      // Cizim ancak gerektiginde yapilir; damping ve animasyon surerken devam
      kareIstegi: 0,
    };

    kontrol.addEventListener('change', kareIstek);
    cizer.domElement.addEventListener('pointermove', fareHareketi);
    cizer.domElement.addEventListener('pointerleave', () => {
      S.fareVar = false;
      if (S.balon) S.balon.hidden = true;
    });

    return true;
  }

  // ===========================================================================
  //  ICERIK: PLANI SAHNEYE KUR
  // ===========================================================================

  /** Onceki cizimi tamamen temizler - GPU belleği birikmesin. */
  function icerigiBosalt() {
    const g = S.icerik;
    while (g.children.length) {
      const c = g.children.pop();
      g.remove(c);
      if (c.geometry) c.geometry.dispose();
      const m = c.material;
      if (Array.isArray(m)) {
        for (const x of m) { if (x.map) x.map.dispose(); x.dispose(); }
      } else if (m) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
    S.kutuBilgisi = [];
    S.toplamOrnek = 0;
    S.duvarlar = null;
  }

  /**
   * @param {Object} plan  Yerlesim.planla() sonucu
   * @param {Object} arac  {uzunluk, genislik, yukseklik} (mm)
   * @param {Object} [ayar] {duvarlar: boolean}
   */
  function ciz(plan, arac, ayar) {
    if (!S) return false;

    // Tuval HER cizimde kapsayicinin guncel olcusune ayarlanir.
    //
    // Sahne ilk kurulurken kapsayici gizli olabiliyor (#sonuc arac/yuk yokken
    // `hidden`), o zaman clientWidth 0 gelip tuval 1x1 kaliyordu ve bir daha
    // duzelmiyordu: yuk minicik bir kosede ciziliyor, hazir acilar da yanlis
    // cerceveliyordu (aspect 1 sanildigi icin).
    olcuDegisti();

    icerigiBosalt();

    const U = Number(arac && arac.uzunluk) || 0;
    const G = Number(arac && arac.genislik) || 0;
    const Y = Number(arac && arac.yukseklik) || 0;
    if (U <= 0 || G <= 0 || Y <= 0) { kareIstek(); return false; }

    S.arac = { U, G, Y };
    const bloklar = (plan && plan.bloklar) || [];
    const toplam = (plan && plan.ozet && plan.ozet.toplamAdet) || 0;
    S.kip = kipSec(toplam);

    // Arac uzunluk/genislikte ORTALANIR, taban y=0'da kalir. Boylece
    // OrbitControls'un hedefi kasanin ortasi olur ve dondurme dogal gelir.
    const kaydirX = -(U * OLCEK) / 2;
    const kaydirZ = -(G * OLCEK) / 2;

    kasayiCiz(U, G, Y, kaydirX, kaydirZ, !ayar || ayar.duvarlar !== false);

    if (S.kip === 'tek') tekTekCiz(bloklar, kaydirX, kaydirZ);
    else blokCiz(bloklar, kaydirX, kaydirZ);

    // Kamera ilk cizimde yerlesir; sonraki cizimlerde kullanicinin acisi korunur
    if (!S.kameraYerlesti) {
      aci('serbest');
      S.kameraYerlesti = true;
    } else {
      S.kontrol.target.set(0, (Y * OLCEK) / 2, 0);
      S.kontrol.update();
    }

    kareIstek();
    return true;
  }

  /** Kasa: taban izgarasi + tel kafes duvarlar. */
  function kasayiCiz(U, G, Y, kaydirX, kaydirZ, duvarGoster) {
    const u = U * OLCEK, g = G * OLCEK, y = Y * OLCEK;

    // Taban
    const taban = new THREE.Mesh(
      new THREE.PlaneGeometry(u, g),
      new THREE.MeshBasicMaterial({ color: 0x23272f, side: THREE.DoubleSide })
    );
    taban.rotation.x = -Math.PI / 2;
    taban.position.set(0, 0, 0);
    S.icerik.add(taban);

    if (!duvarGoster) return;

    // Tel kafes kasa: yuk icini gormeyi engellemesin
    const kutu = new THREE.BoxGeometry(u, y, g);
    const kenarlar = new THREE.LineSegments(
      new THREE.EdgesGeometry(kutu),
      new THREE.LineBasicMaterial({ color: 0x4a9eff, transparent: true, opacity: 0.55 })
    );
    kenarlar.position.set(0, y / 2, 0);
    S.icerik.add(kenarlar);
    kutu.dispose();

    S.duvarlar = kenarlar;

    // Aracin ONU (x=0 tarafi) belli olsun: o yuze hafif dolgu
    const on = new THREE.Mesh(
      new THREE.PlaneGeometry(g, y),
      new THREE.MeshBasicMaterial({
        color: 0x4a9eff, transparent: true, opacity: 0.07, side: THREE.DoubleSide,
      })
    );
    on.rotation.y = Math.PI / 2;
    on.position.set(-u / 2, y / 2, 0);
    S.icerik.add(on);
  }

  // ---------------------------------------------------------------- tek tek

  function tekTekCiz(bloklar, kaydirX, kaydirZ) {
    // Kac ornek olacak? (sinir asilirsa blok kipine dusuluyor, yine de guvenlik)
    let adet = 0;
    for (const b of bloklar) adet += b.nx * b.ny * b.nz;
    if (adet === 0) return;
    adet = Math.min(adet, TEK_TEK_SINIR);

    const geo = new THREE.BoxGeometry(1, 1, 1); // birim kup, olcek matriste
    const mal = new THREE.MeshLambertMaterial({
      clippingPlanes: [S.kesitDuzlemi],
      clipShadows: false,
    });

    const oberk = new THREE.InstancedMesh(geo, mal, adet);
    oberk.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const m = new THREE.Matrix4();
    const renk = new THREE.Color();
    const bilgi = [];

    // Yukleme animasyonu ONDEN arkaya oynuyor: ornekler x sirasinda dizilmeli,
    // cunku animasyon InstancedMesh.count'u artirarak calisiyor.
    const sirali = bloklar.slice().sort((p, q) => p.x - q.x || p.z - q.z || p.y - q.y);

    let n = 0;
    for (const b of sirali) {
      const temel = new THREE.Color((b.kutu && b.kutu.renk) || '#888888');
      const ad = (b.kutu && b.kutu.ad) || b.kutuId;

      for (let i = 0; i < b.nx && n < adet; i++) {
        for (let k = 0; k < b.nz && n < adet; k++) {
          for (let j = 0; j < b.ny && n < adet; j++) {
            const x = b.x + i * b.adimU;
            const y = b.y + j * b.adimG;
            const z = b.z + k * b.adimY;

            // Kutunun MERKEZI (three ekseninde)
            m.makeScale(
              b.ku * OLCEK * KUTU_BOSLUK,
              b.ky * OLCEK * KUTU_BOSLUK,
              b.kg * OLCEK * KUTU_BOSLUK
            );
            m.setPosition(
              kaydirX + (x + b.ku / 2) * OLCEK,
              (z + b.ky / 2) * OLCEK,
              kaydirZ + (y + b.kg / 2) * OLCEK
            );
            oberk.setMatrixAt(n, m);

            const c = renkOynamasi(i, j, k);
            renk.setRGB(
              Math.min(1, temel.r * c),
              Math.min(1, temel.g * c),
              Math.min(1, temel.b * c)
            );
            oberk.setColorAt(n, renk);

            bilgi.push({ ad, x, y, z, ku: b.ku, kg: b.kg, ky: b.ky });
            n++;
          }
        }
      }
    }

    oberk.count = n;
    oberk.instanceMatrix.needsUpdate = true;
    if (oberk.instanceColor) oberk.instanceColor.needsUpdate = true;

    S.icerik.add(oberk);
    S.oberk = oberk;
    S.kutuBilgisi = bilgi;
    S.toplamOrnek = n;
  }

  // ------------------------------------------------------------------ blok

  /**
   * Izgara dokusu: beyaz zemin + koyu cizgiler. Malzemenin rengi bunu
   * carpiyor, yani doku tek ve renk bloktan geliyor.
   */
  let izgaraDokusuOnbellek = null;

  function izgaraDokusu() {
    if (izgaraDokusuOnbellek) return izgaraDokusuOnbellek;

    const t = document.createElement('canvas');
    t.width = DOKU_HUCRE;
    t.height = DOKU_HUCRE;
    const c = t.getContext('2d');
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, DOKU_HUCRE, DOKU_HUCRE);
    // Sag ve alt kenara cizgi: tekrar edince surekli izgara olur
    c.strokeStyle = 'rgb(0 0 0 / 0.55)';
    c.lineWidth = Math.max(2, DOKU_HUCRE / 16);
    c.beginPath();
    c.moveTo(DOKU_HUCRE - 1, 0); c.lineTo(DOKU_HUCRE - 1, DOKU_HUCRE);
    c.moveTo(0, DOKU_HUCRE - 1); c.lineTo(DOKU_HUCRE, DOKU_HUCRE - 1);
    c.stroke();

    izgaraDokusuOnbellek = new THREE.CanvasTexture(t);
    return izgaraDokusuOnbellek;
  }

  /**
   * Bir yuz icin doku kopyasi.
   *
   * MIPMAP KAPALI + ANIZOTROPIK SUZGEC — rehber 8.7'deki hata:
   * doku yuzlerce kez tekrarlandiginda ekran karti mipmap'in en kucuk
   * seviyesini (neredeyse duz beyaz ortalama) seciyor ve izgara tamamen
   * kayboluyor; yuk duz bir kutle gibi gorunuyordu. Mipmap kapatilip
   * anizotropik suzgec eklenince cizgiler yakinlastikca belirginlesiyor.
   */
  function yuzDokusu(tekrarU, tekrarV) {
    const d = izgaraDokusu().clone();
    d.needsUpdate = true;
    d.wrapS = THREE.RepeatWrapping;
    d.wrapT = THREE.RepeatWrapping;
    d.repeat.set(tekrarU, tekrarV);
    d.generateMipmaps = false;
    d.minFilter = THREE.LinearFilter;
    d.magFilter = THREE.LinearFilter;
    d.anisotropy = S.enFazlaAniz;
    return d;
  }

  function blokCiz(bloklar, kaydirX, kaydirZ) {
    // Onden arkaya: animasyon bloklari bu sirada gosteriyor
    const sirali = bloklar.slice().sort((p, q) => p.x - q.x || p.z - q.z || p.y - q.y);

    for (const b of sirali) {
      const uzun = b.nx * b.adimU;
      const genis = b.ny * b.adimG;
      const yuksek = b.nz * b.adimY;

      const geo = new THREE.BoxGeometry(uzun * OLCEK, yuksek * OLCEK, genis * OLCEK);
      const renk = new THREE.Color((b.kutu && b.kutu.renk) || '#888888');

      // Her yuze kendi tekrar sayisiyla doku
      const malzemeler = yuzTekrarlari(b).map(([tu, tv]) => new THREE.MeshLambertMaterial({
        color: renk,
        map: yuzDokusu(tu, tv),
        clippingPlanes: [S.kesitDuzlemi],
      }));

      const kutu = new THREE.Mesh(geo, malzemeler);
      kutu.position.set(
        kaydirX + (b.x + uzun / 2) * OLCEK,
        (b.z + yuksek / 2) * OLCEK,
        kaydirZ + (b.y + genis / 2) * OLCEK
      );
      kutu.userData = {
        ad: (b.kutu && b.kutu.ad) || b.kutuId,
        adet: b.adet,
        nx: b.nx, ny: b.ny, nz: b.nz,
        x: b.x, y: b.y, z: b.z,
      };
      S.icerik.add(kutu);
    }
  }

  // ===========================================================================
  //  KAMERA ACILARI
  // ===========================================================================

  // Hazir acilarin bakis yonleri: hedeften KAMERAYA dogru vektor.
  // Tam tepeden bakista z'ye ufak bir deger veriliyor, yoksa bakis yonu
  // "yukari" vektoruyle cakisip kamera yonunu kaybediyor.
  const ACILAR = {
    ustten: [0, 1, 0.0001],
    yandan: [0, 0, 1],
    arkadan: [1, 0, 0],
    serbest: [-0.55, 0.5, 0.67], // onden, soldan, yukaridan
  };

  /**
   * Verilen bakis yonunde aracin TAMAMININ cerceveye sigmasi icin kamera
   * konumu.
   *
   * Kasanin 8 kosesi kameranin kendi eksenlerine (sag / ust / ileri)
   * izdusuruluyor ve en genis sapmalar bulunuyor. Neden boyle:
   *  - Eksene bakan olculeri (uzunluk x yukseklik gibi) kullanmak yalnizca
   *    tam karsidan bakista dogru; egik acida kutu kosesi cerceveden tasiyor.
   *  - Cevreleyen KUREYE sigdirmak her acida dogru ama 14 m'lik ince bir
   *    kasada gereginden cok uzaklastiriyor, yuk minicik kaliyor.
   * Kose izdusumu ikisinin arasinda: her acida tam ve sikı cerceve.
   */
  function konumHesapla(yonDizi) {
    const { U, G, Y } = S.arac;
    const u = U * OLCEK, g = G * OLCEK, y = Y * OLCEK;

    const hedef = new THREE.Vector3(0, y / 2, 0);
    const ileri = new THREE.Vector3(yonDizi[0], yonDizi[1], yonDizi[2]).normalize();

    // Kamera eksenleri
    const yukariKaba = Math.abs(ileri.y) > 0.999
      ? new THREE.Vector3(0, 0, -1)
      : new THREE.Vector3(0, 1, 0);
    const sag = new THREE.Vector3().crossVectors(yukariKaba, ileri).normalize();
    const ust = new THREE.Vector3().crossVectors(ileri, sag).normalize();

    const dikeyGorus = (S.kamera.fov * Math.PI) / 180;
    const yatayGorus = 2 * Math.atan(Math.tan(dikeyGorus / 2) * S.kamera.aspect);

    let enSag = 0, enUst = 0, enIleri = 0;
    const kose = new THREE.Vector3();
    for (const sx of [-1, 1]) {
      for (const sy of [0, 1]) {
        for (const sz of [-1, 1]) {
          kose.set((sx * u) / 2, sy * y, (sz * g) / 2).sub(hedef);
          enSag = Math.max(enSag, Math.abs(kose.dot(sag)));
          enUst = Math.max(enUst, Math.abs(kose.dot(ust)));
          enIleri = Math.max(enIleri, kose.dot(ileri));
        }
      }
    }

    // Kenarlarda %6 pay + one dogru tasan koseyi de gecmek icin enIleri
    const d = Math.max(
      enSag / Math.tan(yatayGorus / 2),
      enUst / Math.tan(dikeyGorus / 2)
    ) * 1.06 + enIleri;

    return { hedef, konum: hedef.clone().add(ileri.multiplyScalar(d)) };
  }

  function aci(ad) {
    if (!S || !S.arac) return;
    const yon = ACILAR[ad] || ACILAR.serbest;
    const { hedef, konum } = konumHesapla(yon);

    S.kamera.position.copy(konum);
    S.kamera.lookAt(hedef);
    S.kontrol.target.copy(hedef);
    S.kontrol.update();
    kareIstek();
  }

  // ===========================================================================
  //  KESIT YUKSEKLIGI
  // ===========================================================================

  /**
   * @param {number} oran 0..1 — 1 ise hicbir sey kirpilmaz
   */
  function kesit(oran) {
    if (!S || !S.arac) return;
    const y = S.arac.Y * OLCEK;
    // 1 (tam) durumunda duzlemi tavanin uzerine cikar: kirpma tamamen kalksin
    S.kesitDuzlemi.constant = oran >= 1 ? 1e6 : y * oran;
    kareIstek();
  }

  // ===========================================================================
  //  YUKLEME ANIMASYONU
  // ===========================================================================

  /** Yuku onden arkaya sirayla gosterir. */
  function animasyonBaslat(sureMs) {
    if (!S) return;
    S.animasyon = { baslangic: performance.now(), sure: Math.max(300, sureMs || 2600) };
    kareIstek();
  }

  function animasyonuUygula() {
    const a = S.animasyon;
    if (!a) return false;

    const gecen = performance.now() - a.baslangic;
    const oran = Math.min(1, gecen / a.sure);

    if (S.kip === 'tek' && S.oberk) {
      S.oberk.count = Math.max(1, Math.round(S.toplamOrnek * oran));
    } else {
      // Blok kipinde blok blok gorunur
      const kutular = S.icerik.children.filter((c) => c.userData && c.userData.ad);
      const gorunecek = Math.round(kutular.length * oran);
      kutular.forEach((c, i) => { c.visible = i < gorunecek; });
    }

    if (oran >= 1) {
      S.animasyon = null;
      // Animasyon bitince her sey gorunur kalsin
      if (S.kip === 'tek' && S.oberk) S.oberk.count = S.toplamOrnek;
      else {
        for (const c of S.icerik.children) {
          if (c.userData && c.userData.ad) c.visible = true;
        }
      }
      return false;
    }
    return true;
  }

  // ===========================================================================
  //  HOVER BALONU
  // ===========================================================================

  function fareHareketi(olay) {
    if (!S) return;
    const k = S.cizer.domElement.getBoundingClientRect();
    S.fare.x = ((olay.clientX - k.left) / k.width) * 2 - 1;
    S.fare.y = -((olay.clientY - k.top) / k.height) * 2 + 1;
    S.fareVar = true;
    S.fareEkran = { x: olay.clientX - k.left, y: olay.clientY - k.top };
    kareIstek();
  }

  function balonuGuncelle() {
    if (!S.balon) return;
    if (!S.fareVar) { S.balon.hidden = true; return; }

    S.isinlayici.setFromCamera(S.fare, S.kamera);
    const hedefler = S.icerik.children.filter((c) => c.isInstancedMesh ||
                                                    (c.userData && c.userData.ad));
    const kesisim = S.isinlayici.intersectObjects(hedefler, false);

    if (kesisim.length === 0) { S.balon.hidden = true; return; }

    const v = kesisim[0];
    let metin = '';

    if (v.object.isInstancedMesh && v.instanceId !== undefined) {
      const b = S.kutuBilgisi[v.instanceId];
      if (!b) { S.balon.hidden = true; return; }
      metin = b.ad + '\n' +
              (b.ku / 10) + '×' + (b.kg / 10) + '×' + (b.ky / 10) + ' cm\n' +
              'konum ' + (b.x / 1000).toFixed(2) + ' m · ' +
              'yükseklik ' + (b.z / 1000).toFixed(2) + ' m';
    } else {
      const d = v.object.userData;
      metin = d.ad + '\n' +
              d.nx + '×' + d.ny + '×' + d.nz + ' = ' + d.adet + ' kutu\n' +
              'konum ' + (d.x / 1000).toFixed(2) + ' m';
    }

    S.balon.textContent = metin;
    S.balon.hidden = false;
    // Balon imlecin sag altina; kenardan tasarsa sola gecer
    const bg = S.balon.offsetWidth || 160;
    const sol = S.fareEkran.x + bg + 24 > S.cizer.domElement.clientWidth
      ? S.fareEkran.x - bg - 14
      : S.fareEkran.x + 14;
    S.balon.style.left = Math.max(0, sol) + 'px';
    S.balon.style.top = (S.fareEkran.y + 14) + 'px';
  }

  // ===========================================================================
  //  CIZIM DONGUSU
  //
  //  Surekli donmuyor: yalnizca bir sey degistiginde kare istenir. Damping
  //  ve animasyon surerken kendini yeniden planlar. Sekme gizlendiginde
  //  durdur() cagriliyor - arka planda bosa GPU yakmasin.
  // ===========================================================================

  function kareIstek() {
    if (!S || !S.calisiyor || S.kareIstegi) return;
    S.kareIstegi = requestAnimationFrame(kare);
  }

  function kare() {
    if (!S) return;
    S.kareIstegi = 0;

    const animSuruyor = animasyonuUygula();
    const dampingSuruyor = S.kontrol.update(); // degisiklik varsa true
    balonuGuncelle();
    S.cizer.render(S.sahne, S.kamera);

    if (animSuruyor || dampingSuruyor) kareIstek();
  }

  function basla() {
    if (!S) return;
    S.calisiyor = true;
    olcuDegisti();
    kareIstek();
  }

  function durdur() {
    if (!S) return;
    S.calisiyor = false;
    if (S.kareIstegi) cancelAnimationFrame(S.kareIstegi);
    S.kareIstegi = 0;
    if (S.balon) S.balon.hidden = true;
  }

  function olcuDegisti() {
    if (!S) return;
    const gen = Math.max(1, S.kapsayici.clientWidth);
    const yuk = Math.max(1, S.kapsayici.clientHeight);
    S.cizer.setSize(gen, yuk);
    S.kamera.aspect = gen / yuk;
    S.kamera.updateProjectionMatrix();
    kareIstek();
  }

  function duvarlariGoster(evet) {
    if (!S || !S.duvarlar) return;
    S.duvarlar.visible = !!evet;
    kareIstek();
  }

  /** Arayuzun gostermek/denemek icin sordugu ozet. */
  function durum() {
    if (!S) return { kuruldu: false };
    return {
      kuruldu: true,
      kip: S.kip,
      ornekSayisi: S.toplamOrnek,
      nesneSayisi: S.icerik.children.length,
      calisiyor: S.calisiyor,
      enFazlaAniz: S.enFazlaAniz,
    };
  }

  // ===========================================================================
  //  DISA ACILAN ARAYUZ
  // ===========================================================================

  kok.Uc = {
    TEK_TEK_SINIR,
    kipSec,
    yuzTekrarlari,
    renkOynamasi,
    destekliyorMu,
    webglVarMi,
    kur,
    ciz,
    aci,
    kesit,
    animasyonBaslat,
    duvarlariGoster,
    basla,
    durdur,
    olcuDegisti,
    durum,
  };

  // Saf yardimcilar (kipSec, yuzTekrarlari, renkOynamasi) three.js istemiyor;
  // Node testleri bunlari dogrudan cagiriyor.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = kok.Uc;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
