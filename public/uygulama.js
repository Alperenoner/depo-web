/* ==========================================================================
   DEPOLAMA - arayuz mantigi  (FAZ 3a + 3b)

   Sorumlulugu: form -> motor -> gostergeler -> cizim.
   Cizgi ciken isler cizim.js'te; burada sadece hangi sekmenin gorundugu ve
   hangi katmanin secildigi tutulur.

   Uc kural:
   1) HAZIR OLCU YOKTUR. Arac ve kutu olculeri tamamen kullanicidan gelir,
      placeholder'da bile ornek sayi yazmaz - sadece birim (MM / CM).
      Agirlik arayuzden tamamen kaldirildi: bu surum hacim/adet planlamasi
      yapiyor. Sunucuya 0 gidiyor, motorun kapasite kontrolu devre disi.
   2) BUTUN HESAP TARAYICIDA. Olcu degistirince sunucuya gidilmez, motor
      dogrudan cagrilir; sunucu sadece kalici kayit tutar.
   3) IKI BIRIM VAR: KUTU olculeri MM, ARAC olculeri CM, arac icindeki
      KONUM M. Ayrintili gerekce asagida "birim cevrim" bolumunde.
   ========================================================================== */

(function () {
  'use strict';

  // ------------------------------------------------------------------ durum

  const D = {
    ayarlar: {},
    aracAktif: null,
    araclar: [],
    aracSablonlari: [],
    kutular: [],
    planlar: [],
    sinirlar: {},
    // Format secenekleri sunucudan gelir (dogrula.js FORMATLAR) - elle yazilmaz
    formatlar: [],
    // Yuk listesi: [{kutuId, adet:number|null, maks:boolean}]
    kalemler: [],
    // agirlikSiniri yok: agirlik arayuzden kaldirildi, maksAgirlik=0 gittigi
    // icin motorun kapasite kontrolu kendiliginden devre disi kaliyor.
    ayar: { strateji: 'optimum', pay: 0 },
    plan: null,

    // ---- FAZ 3b: gorunum durumu ----
    // Varsayilan sekme 3B (rehberdeki sira); WebGL yoksa baslat() kusbakisina
    // dusuruyor - ilk acilista bos bir hata ekrani karsilamasin.
    sekme: 'ucboyut',
    ucKuruldu: false,
    // Plandaki farkli kat yukseklikleri (mm), artan sirada
    katmanlar: [],
    // 0 = butun katmanlar; 1..n = katmanlar[indis-1]
    katmanIndis: 0,
  };

  // Yeni kutulara sirayla atanan renkler (kullanici sonra degistirebilir)
  const RENKLER = [
    '#4a9eff', '#51cf66', '#ffd43b', '#ff8787', '#a78bfa',
    '#38d9a9', '#ffa94d', '#f783ac', '#74c0fc', '#c0eb75',
  ];

  // 3boyut.js yuklenmediyse uygulamanin kalani calismaya DEVAM ETSIN.
  // Motor ve cizim onsart ama 3B degil; bu vekil sayesinde her cagri yerinde
  // sessizce hicbir sey yapiyor ve 3B sekmesi sebebini yaziyor.
  const Uc = (typeof globalThis !== 'undefined' && globalThis.Uc) || {
    destekliyorMu: () => false,
    webglVarMi: () => false,
    kur: () => false,
    ciz: () => false,
    aci() {}, kesit() {}, animasyonBaslat() {}, duvarlariGoster() {},
    numaralariGoster() {},
    basla() {}, durdur() {}, olcuDegisti() {},
    durum: () => ({ kuruldu: false, kip: 'tek', ornekSayisi: 0 }),
  };

  // ------------------------------------------------------------- kisayollar

  const $ = (id) => document.getElementById(id);
  const gorunur = (el, evet) => { el.hidden = !evet; };

  const sayiYaz = (n, basamak) =>
    Number(n || 0).toLocaleString('tr-TR', {
      minimumFractionDigits: basamak || 0,
      maximumFractionDigits: basamak || 0,
    });

  const metre = (mm) => (Number(mm || 0) / 1000).toLocaleString('tr-TR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

  /** Veritabanindan gelen zaman damgasi -> "30.07.2026 13:45" */
  const tarihYaz = (deger) => {
    if (!deger) return '—';
    const t = new Date(deger);
    if (Number.isNaN(t.getTime())) return '—';
    return t.toLocaleDateString('tr-TR') + ' ' +
           t.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  };

  // ------------------------------------------------------------ birim cevrim
  //
  // ICERIDE HER SEY MILIMETRE. Veritabani, motor ve sunucu dogrulamasi mm
  // tam sayi ile calisir - motorun giyotin kesim matematigi tam sayi izgaraya
  // dayaniyor, ondalikli birime cevirmek yuvarlama hatasi sokar ve
  // dogrulanmis sayilari (1.440 koli, %96,2) bozar.
  //
  // ARAYUZDE IKI BIRIM VAR, karistirmamak icin kural tek cumle:
  //
  //   ARACA ait olcu   -> CM (santimetre)   ornek: 1400 × 248 × 270
  //   KUTUYA ait olcu  -> MM (milimetre)    ornek: 575 × 450 × 242
  //   Arac icindeki KONUM -> M (metre)      ornek: 0,00 – 13,80 m
  //
  // Neden ayri: kutu olculeri katalogda mm ile geliyor (575 × 450 × 242 gibi),
  // cm'ye cevirip 57,5 yazmak zorunda kalmak hataya davetiye - kullanici mm
  // degerini cm alanina yazdiginda kutu 10 kat buyuyor ve "hicbir kutu
  // sigmiyor" haline dusuyordu. Arac olcusu ise metre/santimetre konusulur
  // (14 m dorse), orada cm dogru birim.
  //
  // Cevrim SADECE form sinirinda yapilir. Kutu tarafinda artik cevrim YOK:
  // girilen sayi dogrudan mm.

  const mmYap = (cm) => (cm === null ? null : Math.round(cm * 10));
  const cmYap = (mm) => Number(mm || 0) / 10;

  /** mm -> santimetre metni. Gereksiz sifir yazmaz: 2480 -> "248", 242 -> "24,2" */
  const cmYaz = (mm) => cmYap(mm).toLocaleString('tr-TR', {
    minimumFractionDigits: 0, maximumFractionDigits: 1,
  });

  /** Form alanina yazilacak cm degeri (nokta ondalikli, input[number] icin). */
  const cmAlan = (mm) => String(cmYap(mm));

  /** mm -> milimetre metni (kutu olculeri). Binlik ayraci: 40000 -> "40.000" */
  const mmYaz = (mm) => Number(mm || 0).toLocaleString('tr-TR', {
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });

  /** ARAC olcusu - santimetre */
  const olcuMetni = (mmU, mmG, mmY) =>
    cmYaz(mmU) + ' × ' + cmYaz(mmG) + ' × ' + cmYaz(mmY) + ' CM';

  /** KUTU olcusu - milimetre */
  const kutuOlcuMetni = (mmU, mmG, mmY) =>
    mmYaz(mmU) + ' × ' + mmYaz(mmG) + ' × ' + mmYaz(mmY) + ' MM';

  /** Bos string / null -> null; aksi halde sayi. */
  const sayiOku = (el) => {
    const s = String(el.value).trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const aralikta = (n, alt, ust) => n !== null && n >= alt && n <= ust;

  // ===========================================================================
  //  VERI YUKLEME
  // ===========================================================================

  async function veriYukle() {
    const cevap = await fetch('/api/veri');
    if (cevap.status === 401) { location.replace('/giris'); return; }
    if (!cevap.ok) throw new Error('Veri okunamadı.');

    const v = await cevap.json();
    D.ayarlar = v.ayarlar || {};
    D.aracAktif = v.aracAktif || null;
    D.araclar = v.araclar || [];
    D.aracSablonlari = v.aracSablonlari || [];
    D.kutular = v.kutular || [];
    D.planlar = v.planlar || [];
    D.sinirlar = v.sinirlar || {};
    D.formatlar = v.formatlar || [];

    $('baslik').textContent = D.ayarlar.baslik || 'DEPOLAMA';
    $('altBaslik').textContent = D.ayarlar.altBaslik || '';
    document.title = (D.ayarlar.baslik || 'DEPOLAMA') + ' — ' +
                     (D.ayarlar.altBaslik || '');

    // Katalogdan silinmis kutular yuk listesinde kalmasin
    D.kalemler = D.kalemler.filter((k) => D.kutular.some((x) => x.id === k.kutuId));

    araciCiz();
    katalogCiz();
    kalemleriCiz();
    hesapla();

    // Acik duran liste pencereleri de tazelenmeli - kutu silindikten sonra
    // katalog eski satiri gostermeye devam etmesin.
    if (!$('katalogPerde').hidden) katalogPenceresiCiz();
    if (!$('planPerde').hidden) planlariCiz();
  }

  // ===========================================================================
  //  ARAC BOLUMU
  // ===========================================================================

  function araciCiz() {
    const varMi = D.araclar.length > 0;
    gorunur($('aracYok'), !varMi);
    gorunur($('aracVar'), varMi);
    if (!varMi) return;

    // Aktif arac secimi
    const sec = $('aracSec');
    sec.innerHTML = '';
    for (const a of D.araclar) {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = a.ad;
      if (D.aracAktif && a.id === D.aracAktif.id) o.selected = true;
      sec.appendChild(o);
    }

    // Sablon listesi - kullanici kendisi biriktirir, hazir gelmez
    const sablonVar = D.aracSablonlari.length > 0;
    gorunur($('sablonSatir'), sablonVar);
    if (sablonVar) {
      const ss = $('sablonSec');
      ss.innerHTML = '<option value="">— şablondan yeni araç —</option>';
      for (const a of D.aracSablonlari) {
        const o = document.createElement('option');
        o.value = a.id;
        o.textContent = a.ad + '  (' + olcuMetni(a.uzunluk, a.genislik, a.yukseklik) + ')';
        ss.appendChild(o);
      }
      ss.value = '';
    }

    const a = D.aracAktif;
    $('aracOzet').innerHTML = a
      ? '<div class="ad"></div><div class="olcu"></div>'
      : '<div class="olcu">Aktif araç seçili değil.</div>';
    if (a) {
      $('aracOzet').querySelector('.ad').textContent = a.ad;
      $('aracOzet').querySelector('.olcu').textContent =
        olcuMetni(a.uzunluk, a.genislik, a.yukseklik);
    }
  }

  // ---- arac penceresi ----

  const aracAlanlari = () => ({
    ad: $('aracAd'),
    uzunluk: $('aracUzunluk'),
    genislik: $('aracGenislik'),
    yukseklik: $('aracYukseklik'),
  });

  function aracFormuAc(mevcut, onDolgu) {
    const f = aracAlanlari();
    $('aracId').value = mevcut ? mevcut.id : '';
    $('aracFormBaslik').textContent = mevcut ? 'Aracı Düzenle' : 'Yeni Araç';

    // Kayitli deger mm; forma cm olarak yazilir
    const k = mevcut || onDolgu || null;
    f.ad.value = mevcut ? mevcut.ad : '';
    f.uzunluk.value = k ? cmAlan(k.uzunluk) : '';
    f.genislik.value = k ? cmAlan(k.genislik) : '';
    f.yukseklik.value = k ? cmAlan(k.yukseklik) : '';
    $('aracSablon').checked = mevcut ? !!mevcut.sablon : false;

    $('aracHata').textContent = '';
    gorunur($('aracPerde'), true);
    aracFormDenetle();
    f.ad.focus();
  }

  /**
   * Alanlar bosken Kaydet pasif - hesap hic baslamaz.
   * Girdi cm; sunucunun mm sinirlariyla karsilastirmak icin once mm'ye cevrilir
   * (sinirlar tek yerde, sunucuda yasar).
   */
  function aracFormDenetle() {
    const f = aracAlanlari();
    const s = D.sinirlar;
    const u = mmYap(sayiOku(f.uzunluk));
    const g = mmYap(sayiOku(f.genislik));
    const y = mmYap(sayiOku(f.yukseklik));
    const sinir = (ad, varsayilan) => s[ad] || varsayilan;

    const tamam =
      f.ad.value.trim() !== '' &&
      aralikta(u, ...sinir('aracUzunluk', [1, 40000])) &&
      aralikta(g, ...sinir('aracGenislik', [1, 6000])) &&
      aralikta(y, ...sinir('aracYukseklik', [1, 6000]));
    $('aracKaydet').disabled = !tamam;

    // Girilen cm'nin mm karsiligini goster - yanlis birim girisi hemen belli olsun
    $('aracYansi').textContent = (u && g && y)
      ? 'Motora giden: ' + mmYaz(u) + ' × ' + mmYaz(g) + ' × ' + mmYaz(y) +
        ' MM  (' + metre(u) + ' × ' + metre(g) + ' × ' + metre(y) + ' M)'
      : '';
  }

  async function aracGonder(olay) {
    olay.preventDefault();
    const f = aracAlanlari();
    const govde = {
      id: $('aracId').value || undefined,
      ad: f.ad.value.trim(),
      // cm -> mm (veritabani ve motor mm ile calisir)
      uzunluk: mmYap(sayiOku(f.uzunluk)),
      genislik: mmYap(sayiOku(f.genislik)),
      yukseklik: mmYap(sayiOku(f.yukseklik)),
      // Agirlik arayuzden kaldirildi. Sunucu bu alani zorunlu tuttugu icin
      // 0 gonderiyoruz - 0 = "kapasite siniri yok" demek (motor da boyle sayar).
      maksAgirlik: 0,
      sablon: $('aracSablon').checked,
    };

    $('aracKaydet').disabled = true;
    try {
      const c = await fetch('/api/arac', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(govde),
      });
      const s = await c.json();
      if (!c.ok) throw new Error(s.hata || 'Kaydedilemedi.');
      gorunur($('aracPerde'), false);
      await veriYukle();
    } catch (h) {
      $('aracHata').textContent = h.message;
      $('aracKaydet').disabled = false;
    }
  }

  async function aracSilDugmesi() {
    const a = D.aracAktif;
    if (!a) return;
    if (!window.confirm('"' + a.ad + '" aracı silinsin mi?')) return;
    const c = await fetch('/api/arac/' + encodeURIComponent(a.id), { method: 'DELETE' });
    if (c.ok) await veriYukle();
  }

  async function aracAktifDegistir() {
    const id = $('aracSec').value;
    if (!id) return;
    const c = await fetch('/api/arac-aktif/' + encodeURIComponent(id), { method: 'POST' });
    if (c.ok) await veriYukle();
  }

  // ===========================================================================
  //  KUTU KATALOGU  (FAZ 3a: sadece ekleme/duzenleme. Tam katalog penceresi 3c)
  // ===========================================================================

  function katalogCiz() {
    const varMi = D.kutular.length > 0;
    gorunur($('katalogYok'), !varMi);
    gorunur($('katalogVar'), varMi);
    if (!varMi) return;

    const sec = $('kutuSec');
    const oncekiDeger = sec.value;
    sec.innerHTML = '';

    // Gruplara ayir - gruplari kullanici kendisi yaratir
    const gruplar = new Map();
    for (const k of D.kutular) {
      const g = (k.grup || '').trim() || 'Diğer';
      if (!gruplar.has(g)) gruplar.set(g, []);
      gruplar.get(g).push(k);
    }

    const tekGrup = gruplar.size === 1;
    for (const [ad, liste] of gruplar) {
      const hedef = tekGrup ? sec : document.createElement('optgroup');
      if (!tekGrup) hedef.label = ad;
      for (const k of liste) {
        const o = document.createElement('option');
        o.value = k.id;
        o.textContent = k.ad + '  (' +
                        kutuOlcuMetni(k.uzunluk, k.genislik, k.yukseklik) + ')';
        hedef.appendChild(o);
      }
      if (!tekGrup) sec.appendChild(hedef);
    }

    if (oncekiDeger && D.kutular.some((k) => k.id === oncekiDeger)) {
      sec.value = oncekiDeger;
    }
  }

  const kutuAlanlari = () => ({
    ad: $('kutuAd'),
    uzunluk: $('kutuUzunluk'),
    genislik: $('kutuGenislik'),
    yukseklik: $('kutuYukseklik'),
  });

  /**
   * @param {Object|null} mevcut  duzenlenecek/kopyalanacak kutu
   * @param {string} [baslik]     pencere basligi; verilmezse kipe gore secilir
   *
   * Cogaltma da bu formu kullanir: `mevcut` kopyalanmis olculerle gelir ama
   * `id` bos birakilir - sunucu bos id'yi yeni kayit sayar.
   */
  function kutuFormuAc(mevcut, baslik) {
    const f = kutuAlanlari();
    $('kutuId').value = mevcut ? (mevcut.id || '') : '';
    $('kutuFormBaslik').textContent =
      baslik || (mevcut && mevcut.id ? 'Kutuyu Düzenle' : 'Yeni Kutu');

    f.ad.value = mevcut ? mevcut.ad : '';
    $('kutuGrup').value = mevcut ? (mevcut.grup || '') : '';
    $('kutuMaterial').value = mevcut ? (mevcut.material || '') : '';
    formatSecenekleriniCiz(mevcut ? (mevcut.format || '') : '');
    // Kayitli deger zaten mm, kutu formu da mm - cevrim yok
    f.uzunluk.value = mevcut ? String(mevcut.uzunluk) : '';
    f.genislik.value = mevcut ? String(mevcut.genislik) : '';
    f.yukseklik.value = mevcut ? String(mevcut.yukseklik) : '';
    $('kutuMaksIstif').value = mevcut ? mevcut.maksIstif : 0;
    $('kutuYatirilabilir').checked = mevcut ? !!mevcut.yatirilabilir : true;
    // Renk tek istisna: yeni kutuya sirayla bir renk atanir
    $('kutuRenk').value = mevcut && mevcut.renk
      ? mevcut.renk
      : RENKLER[D.kutular.length % RENKLER.length];

    $('kutuHata').textContent = '';
    gorunur($('kutuPerde'), true);
    kutuFormDenetle();
    f.ad.focus();
  }

  /**
   * Format acilir listesini SUNUCUDAN gelen liste ile doldurur.
   * Secenekler burada elle yazilmaz: dogrula.js'teki FORMATLAR tek kaynak,
   * sunucu onu /api/veri ile gonderiyor. Elle yazsaydik biri degistiginde
   * digeri sessizce eskir - strateji listesinde tam bu olmustu (FAZ 3c).
   *
   * Kayitli kutunun formati listede yoksa (liste sonradan degismisse) o deger
   * yine de gosterilir, "artik gecerli degil" notuyla - sessizce silinmesin.
   */
  function formatSecenekleriniCiz(secili) {
    const sec = $('kutuFormat');
    sec.innerHTML = '';

    const bos = document.createElement('option');
    bos.value = '';
    bos.textContent = '— format yok —';
    sec.appendChild(bos);

    for (const f of D.formatlar) {
      const o = document.createElement('option');
      o.value = f;
      o.textContent = f;
      sec.appendChild(o);
    }

    if (secili && !D.formatlar.includes(secili)) {
      const o = document.createElement('option');
      o.value = secili;
      o.textContent = secili + '  (artık listede yok)';
      sec.appendChild(o);
    }

    sec.value = secili || '';
  }

  function kutuFormDenetle() {
    const f = kutuAlanlari();
    const s = D.sinirlar;
    const kenar = s.kutuKenar || [1, 40000];
    // Girilen sayi DOGRUDAN mm - kutu formunda cevrim yok
    const u = sayiOku(f.uzunluk);
    const g = sayiOku(f.genislik);
    const y = sayiOku(f.yukseklik);

    const tamam =
      f.ad.value.trim() !== '' &&
      aralikta(u, kenar[0], kenar[1]) &&
      aralikta(g, kenar[0], kenar[1]) &&
      aralikta(y, kenar[0], kenar[1]);
    $('kutuKaydet').disabled = !tamam;

    // Yansima artik CM karsiligini gosteriyor: girilen sayi zaten mm, onu
    // tekrar yazmanin bilgisi yok. Yanlis birim girisi burada yakalanir -
    // 57,5 yerine 575 yazildiginda "5.750 MM = 575 CM" satiri gozune batar.
    $('kutuYansi').textContent = (u && g && y)
      ? kutuOlcuMetni(u, g, y) + '  =  ' + olcuMetni(u, g, y)
      : '';
  }

  async function kutuGonder(olay) {
    olay.preventDefault();
    const f = kutuAlanlari();
    const govde = {
      id: $('kutuId').value || undefined,
      ad: f.ad.value.trim(),
      grup: $('kutuGrup').value.trim(),
      material: $('kutuMaterial').value.trim(),
      format: $('kutuFormat').value,
      // Form zaten mm veriyor - cevrim yok
      uzunluk: sayiOku(f.uzunluk),
      genislik: sayiOku(f.genislik),
      yukseklik: sayiOku(f.yukseklik),
      // Agirlik arayuzden kaldirildi - sunucu zorunlu tuttugu icin 0
      agirlik: 0,
      renk: $('kutuRenk').value,
      yatirilabilir: $('kutuYatirilabilir').checked,
      maksIstif: sayiOku($('kutuMaksIstif')) ?? 0,
    };

    $('kutuKaydet').disabled = true;
    try {
      const c = await fetch('/api/kutu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(govde),
      });
      const s = await c.json();
      if (!c.ok) throw new Error(s.hata || 'Kaydedilemedi.');
      gorunur($('kutuPerde'), false);
      const yeniId = s.kutu && s.kutu.id;
      await veriYukle();
      // Yeni tanimlanan kutu secili gelsin - hemen eklenebilsin
      if (yeniId) $('kutuSec').value = yeniId;
    } catch (h) {
      $('kutuHata').textContent = h.message;
      $('kutuKaydet').disabled = false;
    }
  }

  // ===========================================================================
  //  YUK LISTESI
  // ===========================================================================

  // ---------------------------------------------------------------- QTY
  //
  //  Kullanici QTY[TH] yazar, QTY = QTY[TH] / 10 olarak hesaplanir ve motora
  //  giden kutu adedi QTY'dir. QTY[TH] yalnizca giris kolayligi.
  //
  //  10'a TAM bolunmeyen deger gecersiz sayilir: o kalem hesaba katilmaz ve
  //  kirmizi uyari cikar. Sessizce yuvarlamak yanlis olurdu - 255 yazan biri
  //  25 mi 26 mi koli istedigini bilmiyoruz, tahmin etmek yerine soruyoruz.

  const QTY_BOLEN = 10;

  /** @returns {{adet: number|null, hata: string}} */
  function qtyHesapla(qtyTh) {
    if (qtyTh === null || qtyTh === '') return { adet: null, hata: '' };
    const n = Number(qtyTh);
    if (!Number.isFinite(n) || n <= 0) return { adet: null, hata: '' };
    if (!Number.isInteger(n)) {
      return { adet: null, hata: 'QTY[TH] tam sayı olmalı' };
    }
    if (n % QTY_BOLEN !== 0) {
      return {
        adet: null,
        hata: QTY_BOLEN + '\u2019a tam bölünmüyor (' + sayiYaz(n) + ' / ' +
              QTY_BOLEN + ' = ' + (n / QTY_BOLEN).toLocaleString('tr-TR') + ')',
      };
    }
    return { adet: n / QTY_BOLEN, hata: '' };
  }

  function kalemEkleDugmesi() {
    const id = $('kutuSec').value;
    if (!id) return;
    if (D.kalemler.some((k) => k.kutuId === id)) return; // ayni kutu iki kez olmasin
    const azami = D.sinirlar.kalemAzami || 60;
    if (D.kalemler.length >= azami) return;
    // maks:false ile eklenir - OTOMATIK DOLDURMA YOK.
    // Onceden maks:true idi ve kutu eklenir eklenmez arac "sigdigi kadar"
    // doluyordu; kullanici daha adedi yazmadan 1.440 kutuluk plan cikiyordu.
    // Artik QTY[TH] girilene kadar hesap yapilmaz.
    D.kalemler.push({ kutuId: id, qtyTh: null, adet: null, maks: false });
    kalemleriCiz();
    hesapla();
  }

  function kalemleriCiz() {
    const yer = $('kalemler');
    yer.innerHTML = '';
    $('kalemSayi').textContent = String(D.kalemler.length);
    gorunur($('kalemBosNot'), D.kalemler.length === 0);

    D.kalemler.forEach((kalem, i) => {
      const kutu = D.kutular.find((k) => k.id === kalem.kutuId);
      if (!kutu) return;

      const sat = document.createElement('div');
      sat.className = 'kalem';

      const ad = document.createElement('div');
      ad.className = 'ad';
      const benek = document.createElement('span');
      benek.className = 'benek';
      benek.style.background = kutu.renk || '#888';
      ad.appendChild(benek);
      ad.appendChild(document.createTextNode(kutu.ad));
      ad.title = kutu.ad + ' — ' +
                 kutuOlcuMetni(kutu.uzunluk, kutu.genislik, kutu.yukseklik);
      sat.appendChild(ad);

      // Sonsuz dugmesi - "sigdigi kadar"
      const sonsuz = document.createElement('button');
      sonsuz.type = 'button';
      sonsuz.className = 'ikincil ufak' + (kalem.maks ? ' sonsuz-acik' : '');
      sonsuz.textContent = '∞';
      sonsuz.title = kalem.maks
        ? 'Sığdığı kadar yerleştiriliyor — kapatmak için tıkla'
        : 'Sığdığı kadar yerleştir (QTY yerine)';
      sonsuz.addEventListener('click', () => {
        kalem.maks = !kalem.maks;
        kalemleriCiz();
        hesapla();
      });
      sat.appendChild(sonsuz);

      // Kaldir
      const sil = document.createElement('button');
      sil.type = 'button';
      sil.className = 'ikincil ufak tehlike';
      sil.textContent = '✕';
      sil.title = 'Listeden çıkar';
      sil.addEventListener('click', () => {
        D.kalemler.splice(i, 1);
        kalemleriCiz();
        hesapla();
      });
      sat.appendChild(sil);

      // ---- ikinci satir: QTY[TH] -> QTY ----
      // Tek satira sigmiyor (sol panel 340 px), o yuzden alt satira aliniyor.
      const sayilar = document.createElement('div');
      sayilar.className = 'sayilar';

      const etiketTh = document.createElement('label');
      etiketTh.className = 'qty-etiket';
      etiketTh.textContent = 'QTY[TH]';

      const qtyTh = document.createElement('input');
      qtyTh.type = 'number';
      qtyTh.min = '0';
      qtyTh.step = String(QTY_BOLEN); // ok tuslari 10'ar 10'ar gitsin
      qtyTh.value = kalem.qtyTh === null || kalem.qtyTh === undefined ? '' : kalem.qtyTh;
      qtyTh.disabled = kalem.maks;
      etiketTh.appendChild(qtyTh);
      sayilar.appendChild(etiketTh);

      const etiketQty = document.createElement('label');
      etiketQty.className = 'qty-etiket';
      etiketQty.textContent = 'QTY';

      // QTY yazilamaz - QTY[TH]'den hesaplanir. readonly (disabled degil) ki
      // deger secilip kopyalanabilsin.
      const qty = document.createElement('input');
      qty.type = 'text';
      qty.className = 'qty-cikti';
      qty.readOnly = true;
      qty.tabIndex = -1;
      qty.title = 'QTY[TH] ÷ ' + QTY_BOLEN + ' — motora giden kutu adedi';
      etiketQty.appendChild(qty);
      sayilar.appendChild(etiketQty);

      const uyari = document.createElement('div');
      uyari.className = 'qty-uyari';

      /** QTY ciktisini ve uyariyi kalemin guncel haline gore tazeler. */
      const qtyYansit = () => {
        const s = qtyHesapla(kalem.qtyTh);
        kalem.adet = s.adet;
        qty.value = kalem.maks
          ? '∞'
          : (s.adet === null ? '—' : sayiYaz(s.adet));
        qty.classList.toggle('bos', kalem.maks || s.adet === null);
        uyari.textContent = kalem.maks ? '' : s.hata;
        gorunur(uyari, !kalem.maks && s.hata !== '');
        qtyTh.classList.toggle('hatali', !kalem.maks && s.hata !== '');
      };

      qtyTh.addEventListener('input', () => {
        const n = sayiOku(qtyTh);
        kalem.qtyTh = n;
        qtyYansit();
        hesapla();
      });

      qtyYansit();
      sat.appendChild(sayilar);
      sat.appendChild(uyari);

      yer.appendChild(sat);
    });
  }

  // ===========================================================================
  //  STRATEJI + AYARLAR
  // ===========================================================================

  function stratejileriCiz() {
    const sec = $('stratejiSec');
    sec.innerHTML = '';
    for (const s of Yerlesim.STRATEJILER) {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.ad;
      sec.appendChild(o);
    }
    sec.value = D.ayar.strateji;
    stratejiAciklamaYaz();
  }

  function stratejiAciklamaYaz() {
    const s = Yerlesim.STRATEJILER.find((x) => x.id === D.ayar.strateji);
    let metin = s ? s.aciklama : '';

    // Optimum bir arama - hangi durusu sectigini soylemek gerekiyor,
    // yoksa kullanici neden o sonucu aldigini bilemez.
    const a = D.plan && D.plan.ayar;
    if (s && s.id === 'optimum' && a && a.secilenYonelim) {
      const adlar = {
        hepsi: 'serbest (bütün duruşlar)',
        yatay: 'yatay',
        dikey: 'dikey',
        boyuna: 'boyuna',
        enine: 'enine',
        dik: 'yatırmadan',
      };
      metin += '. ' + a.denenenAdaySayisi + ' birleşim denendi, seçilen: ' +
               (adlar[a.secilenYonelim] || a.secilenYonelim) +
               (a.secilenPuan === 'adet' ? ' · adet ağırlıklı' : ' · hacim ağırlıklı');
    }
    $('stratejiAciklama').textContent = metin;
  }

  // ===========================================================================
  //  HESAP  (tarayicida, sunucuya gitmeden)
  // ===========================================================================

  /**
   * Yuk listesini motorun bekledigi bicime cevirir.
   * Karsilastirma sekmesi de ayni listeyi kullaniyor - iki yerde ayri
   * kurulursa biri unutulur ve sekmeler farkli sonuc gosterir.
   */
  function motorKalemleri() {
    return D.kalemler
      .map((k) => {
        const kutu = D.kutular.find((x) => x.id === k.kutuId);
        if (!kutu) return null;
        // maks isaretliyse adet yok sayilir ("sigdigi kadar")
        return k.maks ? { kutu, maks: true } : { kutu, adet: k.adet || 0 };
      })
      .filter(Boolean)
      // Adedi 0 olan kalem motoru mesgul etmesin
      .filter((k) => k.maks || k.adet > 0);
  }

  function hesapla() {
    const arac = D.aracAktif;
    const kalemler = motorKalemleri();

    // Arac yoksa ya da yuk yoksa hesap yapilmaz
    if (!arac || kalemler.length === 0) {
      D.plan = null;
      gostergeleriBosalt();
      gorunur($('sonuc'), false);
      gorunur($('baslangic'), true);
      $('uyariYer').innerHTML = '';

      // Uc ayri durum: arac yok / liste bos / listede kutu var ama QTY yok.
      // Ucuncusu artik NORMAL bir durum: kutu eklemek tek basina hesap
      // baslatmiyor, QTY[TH] girilmesi bekleniyor.
      const listeDolu = D.kalemler.length > 0;
      $('baslangicBaslik').textContent = !arac
        ? 'Araç ölçülerini gir'
        : listeDolu ? 'QTY[TH] gir' : 'Yük listesine kutu ekle';
      $('baslangicMetin').textContent = !arac
        ? 'Sol panelden aracı oluştur, sonra kutu tanımlayıp yük listesine ekle. Hesap sen yazarken anında yapılır.'
        : listeDolu
          ? 'Yük listesindeki kutunun QTY[TH] alanına bir sayı yaz — QTY (kutu adedi) 10’a bölünerek bulunur ve hesap anında yapılır. “Sığdığı kadar” istiyorsan ∞ düğmesine bas.'
          : 'Aracın hazır. Şimdi bir kutu seçip Ekle’ye bas.';
      planKaydetDenetle(); // plan yoksa "kaydet" kapali kalmali
      return;
    }

    const s = Yerlesim.STRATEJILER.find((x) => x.id === D.ayar.strateji) ||
              Yerlesim.STRATEJILER[0];

    D.plan = Yerlesim.planla(arac, kalemler, {
      yonelim: s.yonelim,
      puan: s.puan,
      pay: D.ayar.pay,
    });

    gorunur($('baslangic'), false);
    gorunur($('sonuc'), true);
    gostergeleriYaz(D.plan.ozet);
    uyariYaz(D.plan.sigmayanlar);
    bloklariYaz(D.plan.bloklar);
    katmanlariYenile();
    cizimYenile();
    planKaydetDenetle();
    // Acik olan sekme yenilenmeli; kapalilar sekmeSec'te hesaplanacak
    if (D.sekme === 'karsilastirma') karsilastirmaCiz();
    if (D.sekme === 'liste') listeCiz();
    if (D.sekme === 'ucboyut') ucboyutuCiz();
    // Optimum hangi durusu sectigi plana bagli - her hesaptan sonra yenilenir
    stratejiAciklamaYaz();
  }

  // ---- 6 gosterge ----

  function sinif(el, ad) {
    el.className = 'gosterge' + (ad ? ' ' + ad : '');
  }

  function gostergeYaz(el, deger, not, renk) {
    el.querySelector('.deger').textContent = deger;
    el.querySelector('.not').textContent = not || '';
    sinif(el, renk);
  }

  function gostergeleriBosalt() {
    const bos = [
      [$('gAdet'), 'araç ve yük bekleniyor'],
      [$('gDoluluk'), ''],
      [$('gUzunluk'), ''],
      [$('gYukseklik'), ''],
    ];
    for (const [el, not] of bos) gostergeYaz(el, '—', not, 'bos');
  }

  function gostergeleriYaz(o) {
    // 1) Yerlesen kutu
    gostergeYaz($('gAdet'), sayiYaz(o.toplamAdet),
      sayiYaz(o.blokSayisi) + ' blok halinde', '');

    // 2) Hacim doluluğu - %85+ yesil, %60+ sari
    const d = o.hacimDoluluk;
    gostergeYaz($('gDoluluk'), '%' + sayiYaz(d, 1),
      sayiYaz(o.toplamHacim / 1e9, 2) + ' / ' + sayiYaz(o.kasaHacmi / 1e9, 2) + ' m³',
      d >= 85 ? 'iyi' : d >= 60 ? 'orta' : '');

    // 3) Kullanilan uzunluk
    gostergeYaz($('gUzunluk'), metre(o.kullanilanUzunluk) + ' M',
      'arkada ' + metre(o.bosUzunluk) + ' M boş', '');

    // 4) Yuk yuksekligi
    gostergeYaz($('gYukseklik'), metre(o.yukYuksekligi) + ' M',
      'tavana ' + metre(o.bosYukseklik) + ' M', '');
  }

  // ---- sigmayan uyarisi ----

  function uyariYaz(sigmayanlar) {
    const yer = $('uyariYer');
    yer.innerHTML = '';
    if (!sigmayanlar || sigmayanlar.length === 0) return;

    const kutu = document.createElement('div');
    kutu.className = 'uyari';
    const toplam = sigmayanlar.reduce((t, s) => t + s.kalan, 0);
    const bas = document.createElement('strong');
    bas.textContent = sayiYaz(toplam) + ' kutu sığmadı.';
    kutu.appendChild(bas);

    const ul = document.createElement('ul');
    for (const s of sigmayanlar) {
      const li = document.createElement('li');
      li.textContent = s.ad + ': ' + sayiYaz(s.istenen) + ' istendi, ' +
                       sayiYaz(s.yerlesen) + ' yerleşti, ' +
                       sayiYaz(s.kalan) + ' kaldı';
      ul.appendChild(li);
    }
    kutu.appendChild(ul);
    yer.appendChild(kutu);
  }

  // ---- blok tablosu ----

  function bloklariYaz(bloklar) {
    const govde = $('blokGovde');
    govde.innerHTML = '';

    for (const b of bloklar) {
      const tr = document.createElement('tr');

      const ad = document.createElement('td');
      const sarmal = document.createElement('div');
      sarmal.className = 'kutu-ad';
      const benek = document.createElement('span');
      benek.className = 'benek';
      benek.style.background = (b.kutu && b.kutu.renk) || '#888';
      sarmal.appendChild(benek);
      sarmal.appendChild(document.createTextNode((b.kutu && b.kutu.ad) || b.kutuId));
      ad.appendChild(sarmal);
      tr.appendChild(ad);

      const hucre = (metinDeger) => {
        const td = document.createElement('td');
        td.textContent = metinDeger;
        tr.appendChild(td);
      };

      hucre(b.nx + ' × ' + b.ny + ' × ' + b.nz);
      hucre(sayiYaz(b.adet));
      hucre(mmYaz(b.ku) + '×' + mmYaz(b.kg) + '×' + mmYaz(b.ky) + '  ' + b.durusAd);
      hucre(metre(b.x) + ' M');

      govde.appendChild(tr);
    }
  }

  // ===========================================================================
  //  SEKMELER + 2B CIZIMLER  (FAZ 3b)
  //
  //  FAZ 3c (katalog / plan kaydet) ve 3d (karsilastirma / yukleme listesi)
  //  bu tabloya yeni satir ekleyerek genisleyecek.
  // ===========================================================================

  const PANELLER = {
    ucboyut: 'panelUcboyut',
    kusbakisi: 'panelKusbakisi',
    yandan: 'panelYandan',
    karsilastirma: 'panelKarsilastirma',
    liste: 'panelListe',
    bloklar: 'panelBloklar',
  };

  // Klavye: sekmeler 1..6, pencereler K ve P. Sira sekme cubugundakiyle ayni.
  const SEKME_SIRASI = ['ucboyut', 'kusbakisi', 'yandan', 'karsilastirma',
                        'liste', 'bloklar'];

  function sekmeSec(ad) {
    if (!PANELLER[ad]) return;
    D.sekme = ad;

    for (const dugme of document.querySelectorAll('.sekme')) {
      const etkin = dugme.dataset.sekme === ad;
      dugme.classList.toggle('etkin', etkin);
      dugme.setAttribute('aria-selected', etkin ? 'true' : 'false');
    }
    for (const anahtar of Object.keys(PANELLER)) {
      gorunur($(PANELLER[anahtar]), anahtar === ad);
    }

    // Sekme adresi URL'de dursun: sayfa yenilenince ayni sekme acilir,
    // baglanti paylasilabilir. Gecmise yeni kayit EKLEMEZ - geri tusu
    // sekmeler arasinda dolasmaya donmesin.
    try {
      const adres = new URL(location.href);
      adres.searchParams.set('sekme', ad);
      history.replaceState(null, '', adres);
    } catch (h) { /* dosya:// gibi ortamlarda onemsiz */ }

    // Gizli tuvalin kapsayicisinin genisligi 0'dir, o yuzden gizliyken
    // cizilemez. Sekme goruntuye gelince cizim burada yapilir.
    cizimYenile();
    // Karsilastirma pahali (11 yerlesim hesabi) - yalnizca gorunurken
    if (ad === 'karsilastirma') karsilastirmaCiz();
    if (ad === 'liste') listeCiz();

    // 3B sahnesi arka planda bosa GPU yakmasin: gorunurken doner, gizlenince
    // durur. Gizliyken kapsayicinin olcusu 0 oldugu icin zaten cizilemez.
    if (ad === 'ucboyut') ucboyutuAc();
    else Uc.durdur();
  }

  // ---- katman kaydiricisi ----

  function katmanlariYenile() {
    D.katmanlar = D.plan ? Cizim.katmanlar(D.plan.bloklar) : [];

    const kaydirici = $('katmanKaydirici');
    const n = D.katmanlar.length;
    kaydirici.max = String(n);
    // Yeni plan daha az katmanliysa secim tasabilir - "Tumu"ye don
    if (D.katmanIndis > n) D.katmanIndis = 0;
    kaydirici.value = String(D.katmanIndis);
    kaydirici.disabled = n === 0;

    katmanEtiketYaz();
  }

  function katmanEtiketYaz() {
    const el = $('katmanEtiket');
    const n = D.katmanlar.length;

    if (n === 0) { el.textContent = 'katman yok'; return; }
    if (D.katmanIndis === 0) {
      el.textContent = 'Tümü — ' + n + ' katman';
      return;
    }

    // Kesitin kapladigi yukseklik araligi: kesiti kesen kutularin en tepesi.
    // Ayni katta farkli boyda kutular olabilir, o yuzden tek tek bakiliyor.
    const z = D.katmanlar[D.katmanIndis - 1];
    let tepe = z;
    for (const b of D.plan.bloklar) {
      const k = Cizim.katmanKati(b, z);
      if (k >= 0) tepe = Math.max(tepe, b.z + k * b.adimY + b.ky);
    }

    el.textContent = 'Katman ' + D.katmanIndis + ' / ' + n + ' · ' +
                     cmYaz(z) + '–' + cmYaz(tepe) + ' CM';
  }

  // ---- cizim ----
  //
  // Kaydirici surukleme ve pencere boyutlandirma saniyede onlarca olay
  // uretiyor; her birinde yeniden cizmek gereksiz. Kare basina bir cizim.

  let cizimBekliyor = false;

  function cizimYenile() {
    if (cizimBekliyor) return;
    cizimBekliyor = true;
    requestAnimationFrame(() => {
      cizimBekliyor = false;
      cizimHemen();
    });
  }

  function cizimHemen(kagit) {
    if (!D.plan || !D.aracAktif) return;

    if (D.sekme === 'kusbakisi') {
      const kesitZ = D.katmanIndis > 0 ? D.katmanlar[D.katmanIndis - 1] : null;
      Cizim.kusbakisi($('tuvalKus'), D.plan, D.aracAktif, { kesitZ, kagit: !!kagit });
    } else if (D.sekme === 'yandan') {
      Cizim.yandan($('tuvalYan'), D.plan, D.aracAktif, { kagit: !!kagit });
    }
    // karsilastirma / liste / bloklar sekmeleri HTML - cizim gerekmiyor
  }

  // ===========================================================================
  //  SIFRE DEGISTIRME  (FAZ 8)
  //
  //  Kurulumdaki sifre zayif ve `npm run db:kur` MEVCUT hesabin sifresini
  //  degistirmiyor ("zaten var" deyip geciyor). Yani internete acmadan once
  //  sifreyi degistirmenin tek yolu bu pencere.
  // ===========================================================================

  // Sunucu en az 6 karakter kabul ediyor (dogrula.sifreDegistir); arayuz
  // internete acilacak bir site icin bilerek DAHA KATI davraniyor. Sunucu
  // yine kendi kuralini uyguluyor, burasi yalnizca kullaniciyi zorluyor.
  const SIFRE_ENAZ = 10;

  function sifreFormuAc() {
    for (const id of ['sifreEski', 'sifreYeni', 'sifreYeni2', 'sifreKullanici']) {
      $(id).value = '';
    }
    $('sifreHata').textContent = '';
    gorunur($('sifrePerde'), true);
    sifreDenetle();
    $('sifreEski').focus();
  }

  function sifreDenetle() {
    const eski = $('sifreEski').value;
    const yeni = $('sifreYeni').value;
    const yeni2 = $('sifreYeni2').value;

    let olcut = '';
    let tamam = false;

    if (yeni.length === 0) {
      olcut = 'Yeni şifre en az ' + SIFRE_ENAZ + ' karakter olmalı.';
    } else if (yeni.length < SIFRE_ENAZ) {
      olcut = yeni.length + ' karakter — en az ' + SIFRE_ENAZ + ' olmalı.';
    } else if (yeni === eski) {
      olcut = 'Yeni şifre eskisiyle aynı olamaz.';
    } else if (yeni2.length === 0) {
      olcut = 'Yeni şifreyi bir daha yaz.';
    } else if (yeni !== yeni2) {
      olcut = 'İki yeni şifre birbirini tutmuyor.';
    } else if (eski.length === 0) {
      olcut = 'Mevcut şifreyi de girmen gerekiyor.';
    } else {
      olcut = 'Uygun (' + yeni.length + ' karakter).';
      tamam = true;
    }

    $('sifreOlcut').textContent = olcut;
    $('sifreKaydet').disabled = !tamam;
  }

  async function sifreGonder(olay) {
    olay.preventDefault();
    $('sifreKaydet').disabled = true;
    $('sifreHata').textContent = '';

    try {
      const c = await fetch('/api/sifre', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eski: $('sifreEski').value,
          yeni: $('sifreYeni').value,
          yeniTekrar: $('sifreYeni2').value,
          kullanici: $('sifreKullanici').value.trim(),
        }),
      });
      const cevap = await c.json();
      if (!c.ok) throw new Error(cevap.hata || 'Şifre değiştirilemedi.');

      gorunur($('sifrePerde'), false);
      // Alanlari bosalt: sifre DOM'da asili kalmasin
      for (const id of ['sifreEski', 'sifreYeni', 'sifreYeni2']) $(id).value = '';
      uyariGoster('Şifre değiştirildi. Kullanıcı adı: ' + cevap.kullanici, 'iyi');
    } catch (h) {
      $('sifreHata').textContent = h.message;
      sifreDenetle();
    }
  }

  /** Ana alanin ustunde kisa bir bildirim. */
  function uyariGoster(metin, tur) {
    const yer = $('uyariYer');
    const kutu = document.createElement('div');
    kutu.className = 'uyari' + (tur === 'iyi' ? ' iyi' : '');
    kutu.textContent = metin;
    yer.appendChild(kutu);
    setTimeout(() => kutu.remove(), 6000);
  }

  // ===========================================================================
  //  3B GORUNUM  (FAZ 4)
  //
  //  Butun three.js isi 3boyut.js'te. Buradaki sorumluluk: sahneyi ilk
  //  gorunuste kurmak, plan degisince yeniden cizdirmek, sekme gizlenince
  //  durdurmak. Kutuphane ya da WebGL yoksa sekme calisir ama sahne yerine
  //  aciklama gosterir - arayuzun kalani etkilenmez.
  // ===========================================================================

  function ucboyutuAc() {
    const hata = $('ucHata');

    if (!Uc.destekliyorMu() || !Uc.webglVarMi()) {
      hata.textContent = !Uc.destekliyorMu()
        ? '3B kütüphanesi (vendor/three.min.js) yüklenemedi.'
        : 'Bu tarayıcıda WebGL kapalı ya da desteklenmiyor — 3B görünüm çizilemiyor. Diğer sekmeler çalışır.';
      gorunur(hata, true);
      return;
    }

    if (!D.ucKuruldu) {
      D.ucKuruldu = Uc.kur($('ucSahne'), $('ucBalon'));
      if (!D.ucKuruldu) {
        hata.textContent = '3B sahne kurulamadı.';
        gorunur(hata, true);
        return;
      }
    }

    gorunur(hata, false);
    Uc.basla();
    ucboyutuCiz();
  }

  function ucboyutuCiz() {
    if (!D.ucKuruldu || D.sekme !== 'ucboyut') return;
    if (!D.plan || !D.aracAktif) return;

    Uc.ciz(D.plan, D.aracAktif, {
      duvarlar: $('ucDuvarlar').checked,
      numaralar: $('ucNumara').checked,
    });
    // Kesit kaydiricisi kullanicinin biraktigi yerde kalsin
    Uc.kesit(Number($('ucKesit').value) / 100);

    const d = Uc.durum();
    $('ucKip').textContent = d.kip === 'blok'
      ? 'Blok kipi — ' + sayiYaz(D.plan.ozet.toplamAdet) + ' kutu, ızgara dokusu'
      : 'Tek tek kip — ' + sayiYaz(d.ornekSayisi) + ' kutu ayrı çizildi';

    ucNumaraNotYaz();
  }

  /**
   * Blok sayisi etiket sinirini asarsa yalnizca ilk N blok numaralanir.
   * Kullanici eksik numarayi hata sanmasin diye sebebi yaziliyor.
   */
  function ucNumaraNotYaz() {
    const not = $('ucNumaraNot');
    const d = Uc.durum();
    const kirpildi = $('ucNumara').checked && d.numaraKirpildi;
    gorunur(not, kirpildi);
    if (kirpildi) {
      not.textContent = 'ilk ' + sayiYaz(d.numaraSayisi) + ' blok numaralandı (' +
                        sayiYaz(D.plan.ozet.blokSayisi) + ' blok var)';
    }
  }

  // ===========================================================================
  //  KARSILASTIRMA  (FAZ 3d)
  //
  //  Uc dizilisi ayni yukle hesaplar ve yan yana koyar. Pahali bir is:
  //  hepsiniHesapla 3 strateji calistiriyor, biri optimum oldugu icin toplam
  //  11 yerlesim hesabi. O yuzden yalnizca sekme gorunurken cagriliyor.
  // ===========================================================================

  function karsilastirmaCiz() {
    const yer = $('karsilastirmaKartlar');
    yer.innerHTML = '';

    if (!D.plan || !D.aracAktif) return;

    const kalemler = motorKalemleri();
    if (kalemler.length === 0) return;

    const sonuclar = Yerlesim.hepsiniHesapla(D.aracAktif, kalemler, {
      pay: D.ayar.pay,
    });

    for (const s of sonuclar) {
      const kart = document.createElement('button');
      kart.type = 'button';
      kart.className = 'kart' + (s.id === D.ayar.strateji ? ' secili' : '');
      kart.title = s.aciklama;

      const ad = document.createElement('div');
      ad.className = 'kart-ad';
      ad.appendChild(document.createTextNode(s.ad));
      if (s.enIyi) {
        const rozet = document.createElement('span');
        rozet.className = 'rozet';
        rozet.textContent = 'EN İYİ';
        ad.appendChild(rozet);
      }
      if (s.id === D.ayar.strateji) {
        const rozet = document.createElement('span');
        rozet.className = 'rozet simdiki';
        rozet.textContent = 'SEÇİLİ';
        ad.appendChild(rozet);
      }
      kart.appendChild(ad);

      const buyuk = document.createElement('div');
      buyuk.className = 'buyuk';
      buyuk.textContent = sayiYaz(s.adet);
      kart.appendChild(buyuk);

      const buyukAlt = document.createElement('div');
      buyukAlt.className = 'buyuk-alt';
      buyukAlt.textContent = 'kutu yerleşti';
      kart.appendChild(buyukAlt);

      const dl = document.createElement('dl');
      const satir = (etiket, deger, sinifAd) => {
        const dt = document.createElement('dt');
        dt.textContent = etiket;
        const dd = document.createElement('dd');
        dd.textContent = deger;
        if (sinifAd) dd.className = sinifAd;
        dl.appendChild(dt);
        dl.appendChild(dd);
      };

      satir('Hacim doluluğu', '%' + sayiYaz(s.doluluk, 1));
      satir('Blok sayısı', sayiYaz(s.plan.ozet.blokSayisi));
      satir('Kullanılan uzunluk', metre(s.plan.ozet.kullanilanUzunluk) + ' M');

      // En iyiye gore fark
      satir(
        'En iyiye göre',
        s.enIyi ? 'en iyi' : '%' + sayiYaz(s.fark, 1),
        s.enIyi ? 'fark esit' : 'fark eksi'
      );

      const sigmayan = (s.plan.sigmayanlar || [])
        .reduce((t, x) => t + x.kalan, 0);
      if (sigmayan > 0) satir('Sığmayan', sayiYaz(sigmayan) + ' kutu', 'sigmayan');

      kart.appendChild(dl);

      // Karta tiklamak o dizilisi secer - butun gorunumler yenilenir
      kart.addEventListener('click', () => {
        if (s.id === D.ayar.strateji) return;
        D.ayar.strateji = s.id;
        $('stratejiSec').value = s.id;
        stratejiAciklamaYaz();
        hesapla();
        karsilastirmaCiz();
      });

      yer.appendChild(kart);
    }
  }

  // ===========================================================================
  //  YUKLEME LISTESI  (FAZ 3d)
  //
  //  Depoda elde tutulacak kagit. Sira aracin ONUNDEN arkaya: once x'e, esitse
  //  y'ye, sonra z'ye gore. Motorun blok sirasi yerlestirme sirasidir ama
  //  yukleyen kisi icin anlamli olan konum sirasi.
  // ===========================================================================

  function listeCiz() {
    const govde = $('listeGovde');
    const alt = $('listeAlt');
    govde.innerHTML = '';
    alt.innerHTML = '';
    $('listeBaslik').innerHTML = '';

    if (!D.plan || !D.aracAktif) return;

    const o = D.plan.ozet;
    const a = D.aracAktif;
    const st = Yerlesim.STRATEJILER.find((x) => x.id === D.ayar.strateji);

    // ---- yazdirma basligi ----
    const bas = $('listeBaslik');
    const satirlar = [
      ['Araç', a.ad + ' · ' + olcuMetni(a.uzunluk, a.genislik, a.yukseklik)],
      ['Diziliş', st ? st.ad : D.ayar.strateji],
      ['Toplam', sayiYaz(o.toplamAdet) + ' kutu · ' +
                 sayiYaz(o.blokSayisi) + ' blok · %' + sayiYaz(o.hacimDoluluk, 1) +
                 ' doluluk'],
      ['Yük', metre(o.kullanilanUzunluk) + ' M uzunluk · ' +
              metre(o.yukYuksekligi) + ' M yükseklik'],
      ['Tarih', tarihYaz(new Date())],
    ];
    if (D.ayar.pay > 0) {
      satirlar.splice(2, 0, ['Kutular arası pay', mmYaz(D.ayar.pay) + ' MM']);
    }
    for (const [etiket, deger] of satirlar) {
      const sat = document.createElement('div');
      sat.className = 'satir';
      const e = document.createElement('span');
      e.textContent = etiket + ':';
      const d = document.createElement('strong');
      d.textContent = deger;
      sat.appendChild(e);
      sat.appendChild(d);
      bas.appendChild(sat);
    }

    // ---- satirlar ----
    // Sira motordan geliyor, burada hesaplanmiyor: 3B'deki numara etiketleri
    // (FAZ 9) ayni fonksiyonu cagiriyor, iki numara ayrisamaz.
    const sirali = Yerlesim.yuklemeSirasi(D.plan.bloklar);

    sirali.forEach((b, i) => {
      const tr = document.createElement('tr');

      const hucre = (metinDeger) => {
        const td = document.createElement('td');
        td.textContent = metinDeger;
        tr.appendChild(td);
      };

      hucre(String(i + 1));

      const adHucre = document.createElement('td');
      const sarmal = document.createElement('div');
      sarmal.className = 'kutu-ad';
      const benek = document.createElement('span');
      benek.className = 'benek';
      benek.style.background = (b.kutu && b.kutu.renk) || '#888';
      sarmal.appendChild(benek);
      sarmal.appendChild(document.createTextNode((b.kutu && b.kutu.ad) || b.kutuId));
      adHucre.appendChild(sarmal);
      tr.appendChild(adHucre);

      hucre(sayiYaz(b.adet));
      hucre(b.nx + ' × ' + b.ny + ' × ' + b.nz);
      hucre(mmYaz(b.ku) + '×' + mmYaz(b.kg) + '×' + mmYaz(b.ky) + ' ' + b.durusAd);
      // Blogun kapladigi uzunluk araligi - yukleyen kisi nereye koyacagini bilsin
      hucre(metre(b.x) + ' – ' + metre(b.x + b.nx * b.adimU));

      govde.appendChild(tr);
    });

    // ---- toplam ----
    if (sirali.length) {
      const tr = document.createElement('tr');
      const bosluk = document.createElement('td');
      bosluk.colSpan = 2;
      bosluk.textContent = 'TOPLAM (' + sayiYaz(sirali.length) + ' blok)';
      tr.appendChild(bosluk);
      const toplam = document.createElement('td');
      toplam.textContent = sayiYaz(o.toplamAdet);
      tr.appendChild(toplam);
      const kalan = document.createElement('td');
      kalan.colSpan = 3;
      kalan.textContent = '';
      tr.appendChild(kalan);
      alt.appendChild(tr);
    }
  }

  // ===========================================================================
  //  KATALOG PENCERESI  (FAZ 3c)
  //
  //  Katalog BOS BASLAR ve boyle kalir - hazir kutu olcusu gelmez.
  //  "Sigar" sutunu sunucuya gitmeden hesaplanir; motor tarayicida.
  // ===========================================================================

  function katalogAc() {
    // Iki liste penceresi ayni z-katmaninda; ikisi birden acilirsa perdeler
    // ust uste biniyor ve hangisinin ustte oldugu HTML sirasina kaliyor.
    gorunur($('planPerde'), false);
    gorunur($('katalogPerde'), true);
    katalogPenceresiCiz();
  }

  function katalogPenceresiCiz() {
    const govde = $('katalogGovde');
    govde.innerHTML = '';

    const varMi = D.kutular.length > 0;
    $('katalogSayi').textContent = String(D.kutular.length);
    gorunur($('katalogBosNot'), !varMi);
    gorunur($('katalogTabloYer'), varMi);

    const arac = D.aracAktif;
    $('katalogAracNot').textContent = arac
      ? 'Aktif araç: ' + arac.ad + ' (' +
        olcuMetni(arac.uzunluk, arac.genislik, arac.yukseklik) + ').'
      : 'Aktif araç yok — kaç sığdığı hesaplanamıyor.';

    if (!varMi) return;

    const s = Yerlesim.STRATEJILER.find((x) => x.id === D.ayar.strateji) ||
              Yerlesim.STRATEJILER[0];

    for (const k of D.kutular) {
      const tr = document.createElement('tr');

      // --- ad + renk benegi ---
      const adHucre = document.createElement('td');
      const sarmal = document.createElement('div');
      sarmal.className = 'kutu-ad';
      const benek = document.createElement('span');
      benek.className = 'benek';
      benek.style.background = k.renk || '#888';
      sarmal.appendChild(benek);
      sarmal.appendChild(document.createTextNode(k.ad));
      adHucre.appendChild(sarmal);
      tr.appendChild(adHucre);

      const hucre = (metinDeger, sinifAd) => {
        const td = document.createElement('td');
        td.textContent = metinDeger;
        if (sinifAd) td.className = sinifAd;
        tr.appendChild(td);
        return td;
      };

      hucre(k.grup || '—', k.grup ? '' : 'isaret');
      hucre(k.material || '—', k.material ? '' : 'isaret');
      hucre(k.format || '—', k.format ? '' : 'isaret');
      hucre(mmYaz(k.uzunluk) + '×' + mmYaz(k.genislik) + '×' + mmYaz(k.yukseklik));
      // maksIstif 0 = sinirsiz
      hucre(k.maksIstif ? String(k.maksIstif) : '∞', k.maksIstif ? '' : 'isaret');
      hucre(k.yatirilabilir ? 'evet' : 'hayır', k.yatirilabilir ? '' : 'isaret');

      // --- kac sigar (canli hesap) ---
      if (!arac) {
        hucre('—', 'yok');
        hucre('—', 'yok');
      } else {
        const kap = Yerlesim.tekKutuKapasitesi(arac, k, {
          yonelim: s.yonelim,
          puan: s.puan,
          pay: D.ayar.pay,
        });
        hucre(sayiYaz(kap.adet), 'sigar' + (kap.adet === 0 ? ' sifir' : ''));
        hucre('%' + sayiYaz(kap.doluluk, 1));
      }

      // --- eylemler ---
      const eylem = document.createElement('td');
      eylem.className = 'eylem';

      const dugme = (metinDeger, baslikMetni, isle, ekSinif) => {
        const b = document.createElement('button');
        b.className = 'ikincil ufak' + (ekSinif ? ' ' + ekSinif : '');
        b.textContent = metinDeger;
        b.title = baslikMetni;
        b.addEventListener('click', isle);
        eylem.appendChild(b);
      };

      const listede = D.kalemler.some((x) => x.kutuId === k.id);
      const ekleDugme = document.createElement('button');
      ekleDugme.className = 'ufak' + (listede ? ' ikincil' : '');
      ekleDugme.textContent = listede ? 'listede' : '+ yük';
      ekleDugme.title = listede
        ? 'Bu kutu zaten yük listesinde'
        : 'Yük listesine ekle';
      ekleDugme.disabled = listede;
      ekleDugme.addEventListener('click', () => {
        $('kutuSec').value = k.id;
        kalemEkleDugmesi();
        katalogPenceresiCiz(); // "listede" durumu guncellensin
      });
      eylem.appendChild(ekleDugme);

      dugme('Düzenle', 'Ölçü ve rengi değiştir', () => kutuFormuAc(k));
      dugme('⧉', 'Çoğalt — ölçüleri kopyalayıp yeni kutu tanımla', () => {
        kutuFormuAc(
          Object.assign({}, k, { id: '', ad: k.ad + ' (kopya)' }),
          'Kutuyu Çoğalt'
        );
      });
      dugme('Sil', 'Kutuyu katalogdan sil', () => kutuSilDugmesi(k), 'tehlike');

      tr.appendChild(eylem);
      govde.appendChild(tr);
    }
  }

  async function kutuSilDugmesi(k) {
    const listede = D.kalemler.some((x) => x.kutuId === k.id);
    const uyari = listede
      ? '\n\nBu kutu yük listesinde — oradan da çıkarılacak.'
      : '';
    if (!window.confirm('"' + k.ad + '" kutusu katalogdan silinsin mi?' + uyari)) {
      return;
    }
    const c = await fetch('/api/kutu/' + encodeURIComponent(k.id), { method: 'DELETE' });
    if (c.ok) {
      // veriYukle kalemleri de suzuyor (silinmis kutu listede kalmaz)
      await veriYukle();
    }
  }

  // ===========================================================================
  //  PLANLAR PENCERESI  (FAZ 3c)
  //
  //  Saklanan sey planin TARIFI: arac olculeri, yuk listesi, dizilis, pay.
  //  Yerlesim sonucu saklanmaz - yuklerken motor yeniden hesaplar. Boylece
  //  motor iyilestikce eski planlar da daha iyi sonuc verir.
  // ===========================================================================

  function planlariAc() {
    gorunur($('katalogPerde'), false); // bkz. katalogAc - perdeler ust uste binmesin
    gorunur($('planPerde'), true);
    $('planHata').textContent = '';
    planUyariTemizle();
    planKaydetDenetle();
    planlariCiz();
  }

  function planUyariTemizle() {
    const eski = $('planPerde').querySelector('.plan-uyari');
    if (eski) eski.remove();
  }

  /** Kaydetmek icin ad ve hesaplanmis bir plan sart. */
  function planKaydetDenetle() {
    const adVar = $('planAd').value.trim() !== '';
    $('planKaydet').disabled = !adVar || !D.plan || D.kalemler.length === 0;
  }

  function planlariCiz() {
    const govde = $('planGovde');
    govde.innerHTML = '';

    const varMi = D.planlar.length > 0;
    $('planSayi').textContent = String(D.planlar.length);
    gorunur($('planBosNot'), !varMi);
    gorunur($('planTabloYer'), varMi);
    if (!varMi) return;

    for (const p of D.planlar) {
      const tr = document.createElement('tr');

      const hucre = (metinDeger, sinifAd) => {
        const td = document.createElement('td');
        td.textContent = metinDeger;
        if (sinifAd) td.className = sinifAd;
        tr.appendChild(td);
        return td;
      };

      const adHucre = hucre(p.ad);
      if (p.aciklama) adHucre.title = p.aciklama;

      const a = p.arac || {};
      hucre(cmYaz(a.uzunluk) + '×' + cmYaz(a.genislik) + '×' + cmYaz(a.yukseklik));
      hucre(String((p.kalemler || []).length));

      const st = Yerlesim.STRATEJILER.find((x) => x.id === p.strateji);
      hucre(st ? st.ad : (p.strateji || '—'), st ? '' : 'isaret');

      // Kayitli ozet sadece bilgi: yuklerken yeniden hesaplanacak
      hucre(sayiYaz((p.ozet || {}).adet || 0));
      hucre(tarihYaz(p.tarih), 'isaret');

      const eylem = document.createElement('td');
      eylem.className = 'eylem';

      const yukle = document.createElement('button');
      yukle.className = 'ufak';
      yukle.textContent = 'Yükle';
      yukle.addEventListener('click', () => planYukle(p));
      eylem.appendChild(yukle);

      const sil = document.createElement('button');
      sil.className = 'ikincil ufak tehlike';
      sil.textContent = 'Sil';
      sil.addEventListener('click', () => planSilDugmesi(p));
      eylem.appendChild(sil);

      tr.appendChild(eylem);
      govde.appendChild(tr);
    }
  }

  async function planKaydetDugmesi() {
    // Dugme zaten kapali olmali; yine de arac olmadan govde kurulamaz
    if (!D.plan || !D.aracAktif) return;

    const govde = {
      ad: $('planAd').value.trim(),
      aciklama: $('planNot').value.trim(),
      // Aktif aracin OLCULERI saklanir, id'si degil: arac sonradan silinse
      // ya da olculeri degistirilse plan yine de anlamli kalsin.
      arac: {
        ad: D.aracAktif.ad,
        uzunluk: D.aracAktif.uzunluk,
        genislik: D.aracAktif.genislik,
        yukseklik: D.aracAktif.yukseklik,
        maksAgirlik: 0,
      },
      strateji: D.ayar.strateji,
      kalemler: D.kalemler.map((k) => ({
        kutuId: k.kutuId,
        adet: k.maks ? 0 : (k.adet || 0),
        maks: !!k.maks,
      })),
      ayarlar: { pay: D.ayar.pay },
      // Ozet yalnizca listede gostermek icin - kaynak dogru degil, tarif dogru
      ozet: {
        adet: D.plan.ozet.toplamAdet,
        doluluk: D.plan.ozet.hacimDoluluk,
        agirlik: 0,
      },
    };

    $('planKaydet').disabled = true;
    $('planHata').textContent = '';
    try {
      const c = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(govde),
      });
      const cevap = await c.json();
      if (!c.ok) throw new Error(cevap.hata || 'Plan kaydedilemedi.');
      $('planAd').value = '';
      $('planNot').value = '';
      await veriYukle();
      planlariCiz();
    } catch (h) {
      $('planHata').textContent = h.message;
    }
    planKaydetDenetle();
  }

  async function planSilDugmesi(p) {
    if (!window.confirm('"' + p.ad + '" planı silinsin mi?')) return;
    const c = await fetch('/api/plan/' + encodeURIComponent(p.id), { method: 'DELETE' });
    if (c.ok) {
      await veriYukle();
      planlariCiz();
    }
  }

  /**
   * Plan tarifini arayuze geri kurar.
   *
   * Arac konusu: plan olcuyu saklar, id'yi saklamaz. Ayni olculu kayitli bir
   * arac varsa o aktif edilir. Yoksa KENDILIGINDEN ARAC OLUSTURULMAZ - hazir
   * veri uretmemek kurali burada da gecerli; kullaniciya dugme sunulur.
   */
  async function planYukle(p) {
    planUyariTemizle();

    // 1) Yuk listesi - katalogdan silinmis kutular alinamaz
    const gelen = [];
    const eksikler = [];
    for (const k of p.kalemler || []) {
      if (D.kutular.some((x) => x.id === k.kutuId)) {
        // Planda yalnizca `adet` saklanir (motorun bildigi tek sayi).
        // QTY[TH] ondan geri uretiliyor - plan semasi degistirilmedi,
        // eski kayitlar da sorunsuz aciliyor.
        const adet = k.maks ? null : (k.adet || null);
        gelen.push({
          kutuId: k.kutuId,
          qtyTh: adet === null ? null : adet * QTY_BOLEN,
          adet,
          maks: !!k.maks,
        });
      } else {
        eksikler.push(k.kutuId);
      }
    }

    D.kalemler = gelen;

    // 2) Dizilis ve pay
    if (Yerlesim.STRATEJILER.some((x) => x.id === p.strateji)) {
      D.ayar.strateji = p.strateji;
      $('stratejiSec').value = p.strateji;
    }
    D.ayar.pay = (p.ayarlar || {}).pay || 0;
    $('pay').value = D.ayar.pay ? String(D.ayar.pay) : '';

    // 3) Arac - olcusu tutan kayitli arac var mi?
    const pa = p.arac || {};
    const esles = D.araclar.find((a) =>
      a.uzunluk === pa.uzunluk &&
      a.genislik === pa.genislik &&
      a.yukseklik === pa.yukseklik);

    if (esles && (!D.aracAktif || D.aracAktif.id !== esles.id)) {
      const c = await fetch('/api/arac-aktif/' + encodeURIComponent(esles.id),
                            { method: 'POST' });
      if (c.ok) await veriYukle();
    }

    kalemleriCiz();
    stratejiAciklamaYaz();
    hesapla();
    planlariCiz();

    // 4) Eksik kalanlari kullaniciya soyle - sessizce yutmak en kotusu
    const notlar = [];
    if (!esles) {
      notlar.push('Bu planın aracı (' +
        olcuMetni(pa.uzunluk, pa.genislik, pa.yukseklik) +
        ') kayıtlı araçlar arasında yok.');
    }
    if (eksikler.length) {
      notlar.push(eksikler.length + ' kutu katalogda bulunamadı, ' +
        'yük listesine eklenemedi.');
    }
    if (notlar.length) planUyariGoster(notlar, esles ? null : pa);
  }

  /** @param {Object|null} aracKur  verilirse "araci olustur" dugmesi cikar */
  function planUyariGoster(notlar, aracKur) {
    const kutu = document.createElement('div');
    kutu.className = 'plan-uyari';
    kutu.textContent = notlar.join(' ');

    if (aracKur) {
      const b = document.createElement('button');
      b.className = 'ufak';
      b.textContent = 'Bu aracı oluştur ve aktif yap';
      b.addEventListener('click', async () => {
        b.disabled = true;
        const c = await fetch('/api/arac', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ad: aracKur.ad || 'Plandan gelen araç',
            uzunluk: aracKur.uzunluk,
            genislik: aracKur.genislik,
            yukseklik: aracKur.yukseklik,
            // Sunucu kaydedilen araci her zaman aktif yapiyor (server.js)
            maksAgirlik: 0,
          }),
        });
        if (c.ok) {
          await veriYukle();
          planUyariTemizle();
          planlariCiz();
        } else {
          b.disabled = false;
        }
      });
      kutu.appendChild(b);
    }

    const pencere = $('planPerde').querySelector('.pencere');
    pencere.insertBefore(kutu, pencere.querySelector('.plan-kaydet'));
  }

  // ===========================================================================
  //  OLAYLAR
  // ===========================================================================

  function olaylariBagla() {
    // -- arac --
    $('aracYeniBos').addEventListener('click', () => aracFormuAc(null));
    $('aracYeni').addEventListener('click', () => aracFormuAc(null));
    $('aracDuzenle').addEventListener('click', () => {
      if (D.aracAktif) aracFormuAc(D.aracAktif);
    });
    $('aracSil').addEventListener('click', aracSilDugmesi);
    $('aracSec').addEventListener('change', aracAktifDegistir);

    // Sablon secmek YENI arac formunu o olculerle doldurur - aninda
    // degistirmez, cunku olcu kullanicinin onayindan gecmeli.
    $('sablonSec').addEventListener('change', () => {
      const id = $('sablonSec').value;
      const s = D.aracSablonlari.find((a) => a.id === id);
      $('sablonSec').value = '';
      if (s) aracFormuAc(null, s);
    });

    $('aracForm').addEventListener('submit', aracGonder);
    $('aracVazgec').addEventListener('click', () => gorunur($('aracPerde'), false));
    for (const el of Object.values(aracAlanlari())) {
      el.addEventListener('input', aracFormDenetle);
    }

    // -- kutu --
    $('kutuYeniBos').addEventListener('click', () => kutuFormuAc(null));
    $('kutuYeni').addEventListener('click', () => kutuFormuAc(null));
    $('kutuForm').addEventListener('submit', kutuGonder);
    $('kutuVazgec').addEventListener('click', () => gorunur($('kutuPerde'), false));
    for (const el of Object.values(kutuAlanlari())) {
      el.addEventListener('input', kutuFormDenetle);
    }

    // -- yuk listesi --
    $('kalemEkle').addEventListener('click', kalemEkleDugmesi);

    // -- strateji --
    $('stratejiSec').addEventListener('change', () => {
      D.ayar.strateji = $('stratejiSec').value;
      stratejiAciklamaYaz();
      hesapla();
    });

    // -- ayarlar --
    // Pay MM girilir, motora oldugu gibi gider. Pay bir KUTU olcusudur
    // (kutular arasindaki bosluk), o yuzden kutu formuyla ayni birimde.
    $('pay').addEventListener('input', () => {
      const mm = sayiOku($('pay'));
      const ust = (D.sinirlar.pay || [0, 500])[1];
      D.ayar.pay = mm === null ? 0 : Math.min(Math.max(Math.round(mm), 0), ust);
      hesapla();
    });
    // -- sekmeler --
    for (const dugme of document.querySelectorAll('.sekme')) {
      dugme.addEventListener('click', () => sekmeSec(dugme.dataset.sekme));
    }

    // -- katman kaydiricisi --
    $('katmanKaydirici').addEventListener('input', () => {
      D.katmanIndis = Number($('katmanKaydirici').value) || 0;
      katmanEtiketYaz();
      cizimYenile();
    });

    $('katmanSifirla').addEventListener('click', () => {
      D.katmanIndis = 0;
      $('katmanKaydirici').value = '0';
      katmanEtiketYaz();
      cizimYenile();
    });

    // Ana alanin genisligi cizimin olcegini belirliyor - degisince yenilenmeli.
    // 3B sahnenin de kendi tuvalini yeniden boyutlamasi gerekiyor.
    const olcuDegisti = () => { cizimYenile(); Uc.olcuDegisti(); };
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(olcuDegisti).observe(document.querySelector('.alan'));
    } else {
      window.addEventListener('resize', olcuDegisti);
    }

    // -- cikis --
    $('cikis').addEventListener('click', async () => {
      await fetch('/api/cikis', { method: 'POST' });
      location.replace('/giris');
    });

    // -- 3B kontrolleri --
    for (const dugme of document.querySelectorAll('[data-aci]')) {
      dugme.addEventListener('click', () => Uc.aci(dugme.dataset.aci));
    }
    $('ucAnimasyon').addEventListener('click', () => Uc.animasyonBaslat());
    $('ucKesit').addEventListener('input',
      () => Uc.kesit(Number($('ucKesit').value) / 100));
    $('ucDuvarlar').addEventListener('change',
      () => Uc.duvarlariGoster($('ucDuvarlar').checked));
    $('ucNumara').addEventListener('change', () => {
      // Yeniden cizim YOK: etiketler ilk acilista uretilip sonra
      // gorunurluk degistiriliyor - kameranin acisi bozulmasin.
      Uc.numaralariGoster($('ucNumara').checked);
      ucNumaraNotYaz();
    });

    // -- yazdirma --
    // Ekrandaki her seyi degil ACIK SEKMEYI basar (bkz. stil.css @media print)
    $('yazdir').addEventListener('click', () => window.print());

    // Tuval bir BITMAP: @media print kurallari icine islemiyor, koyu zemin
    // oldugu gibi kagida gidiyordu. Basmadan once beyaz paletle yeniden
    // cizilir, bittikten sonra ekran paletine dondurulur.
    window.addEventListener('beforeprint', () => cizimHemen(true));
    window.addEventListener('afterprint', () => cizimHemen(false));

    // -- katalog penceresi --
    $('katalogAc').addEventListener('click', katalogAc);
    $('katalogKapat').addEventListener('click',
      () => gorunur($('katalogPerde'), false));
    $('katalogYeniKutu').addEventListener('click', () => kutuFormuAc(null));

    // -- sifre penceresi --
    $('sifreAc').addEventListener('click', sifreFormuAc);
    $('sifreVazgec').addEventListener('click', () => gorunur($('sifrePerde'), false));
    $('sifreForm').addEventListener('submit', sifreGonder);
    for (const id of ['sifreEski', 'sifreYeni', 'sifreYeni2']) {
      $(id).addEventListener('input', sifreDenetle);
    }

    // -- planlar penceresi --
    $('planlarAc').addEventListener('click', planlariAc);
    $('planKapat').addEventListener('click', () => gorunur($('planPerde'), false));
    $('planKaydet').addEventListener('click', planKaydetDugmesi);
    $('planAd').addEventListener('input', planKaydetDenetle);

    // -- pencereler: Esc kapatir, perdeye tiklamak kapatir --
    //
    // Esc en ustteki pencereyi kapatir: form pencereleri liste pencerelerinin
    // ustunde duruyor (.perde.ust), o yuzden once onlara bakilir. Yoksa
    // katalogdan kutu formu acipEsc'e basinca ikisi birden kapaniyor.
    const FORM_PERDELERI = ['aracPerde', 'kutuPerde', 'sifrePerde'];
    const LISTE_PERDELERI = ['katalogPerde', 'planPerde'];

    document.addEventListener('keydown', (o) => {
      if (o.key !== 'Escape') return;
      const acikForm = FORM_PERDELERI.filter((id) => !$(id).hidden);
      if (acikForm.length) {
        for (const id of acikForm) gorunur($(id), false);
        return;
      }
      for (const id of LISTE_PERDELERI) gorunur($(id), false);
    });

    // -- klavye kisayollari --
    //
    // 1..5 sekmeler, K katalog, P planlar, Esc kapat (yukarida).
    // Kullanici bir alana YAZARKEN devre disi - yoksa kutu adina "1" yazmak
    // sekme degistiriyor. Degistirici tuslu birlesimler de es gecilir
    // (Cmd+P yazicinin kendisi, Ctrl+1 tarayici sekmesi).
    document.addEventListener('keydown', (o) => {
      if (o.ctrlKey || o.metaKey || o.altKey) return;

      const hedef = o.target;
      const etiket = hedef && hedef.tagName;
      if (etiket === 'INPUT' || etiket === 'SELECT' || etiket === 'TEXTAREA' ||
          (hedef && hedef.isContentEditable)) {
        return;
      }

      // Bir pencere acikken sekme gezmek anlamsiz
      const pencereAcik = FORM_PERDELERI.concat(LISTE_PERDELERI)
        .some((id) => !$(id).hidden);

      if (o.key >= '1' && o.key <= String(SEKME_SIRASI.length)) {
        if (pencereAcik || $('sonuc').hidden) return;
        sekmeSec(SEKME_SIRASI[Number(o.key) - 1]);
        o.preventDefault();
        return;
      }

      const harf = o.key.toLowerCase();
      if (harf === 'k' && !pencereAcik) { katalogAc(); o.preventDefault(); }
      else if (harf === 'p' && !pencereAcik) { planlariAc(); o.preventDefault(); }
    });

    for (const id of FORM_PERDELERI.concat(LISTE_PERDELERI)) {
      $(id).addEventListener('click', (o) => {
        if (o.target === $(id)) gorunur($(id), false);
      });
    }
  }

  // ===========================================================================
  //  BASLAT
  // ===========================================================================

  async function baslat() {
    // 3boyut.js eksikse uygulama CALISMAYA DEVAM EDER, yalnizca 3B sekmesi
    // aciklama gosterir - motor ve cizim onsart, o ikisi yoksa duruyoruz.
    if (typeof Yerlesim === 'undefined' || typeof Cizim === 'undefined') {
      const eksik = typeof Yerlesim === 'undefined' ? 'Motor (yerlesim.js)'
                                                    : 'Çizim (cizim.js)';
      document.body.innerHTML =
        '<p style="padding:40px;color:#ff6b6b">' + eksik + ' yüklenemedi.</p>';
      return;
    }
    olaylariBagla();
    stratejileriCiz();
    gostergeleriBosalt();

    // 3B kurulamiyorsa varsayilan sekme kusbakisi olsun: kullaniciyi bos bir
    // hata ekraniyla karsilamak yerine calisan gorunume dusuruyoruz.
    // (3B sekmesi yine tiklanabilir, sebebini orada yaziyor.)
    let ilkSekme = Uc.destekliyorMu() && Uc.webglVarMi() ? 'ucboyut' : 'kusbakisi';

    // ?sekme=... ile gelen adres o sekmeyi acar (sekmeSec URL'e kendisi yaziyor,
    // yani sayfa yenilenince kullanicinin kaldigi sekme geri gelir).
    // veriYukle'den ONCE cagriliyor: hesapla() dogru sekmeyi cizsin.
    try {
      const istenen = new URL(location.href).searchParams.get('sekme');
      if (istenen && PANELLER[istenen]) ilkSekme = istenen;
    } catch (h) { /* adres cozulemezse varsayilan sekme kalir */ }

    sekmeSec(ilkSekme);

    try {
      await veriYukle();
    } catch (h) {
      $('uyariYer').innerHTML =
        '<div class="uyari">Veri yüklenemedi: ' + h.message + '</div>';
    }
  }

  baslat();
})();
