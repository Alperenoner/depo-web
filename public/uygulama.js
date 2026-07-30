/* ==========================================================================
   DEPOLAMA - arayuz mantigi  (FAZ 3a)

   Sorumlulugu: form -> motor -> gostergeler. Cizim YOK (FAZ 3b-3d).

   Iki kural:
   1) HAZIR OLCU YOKTUR. Arac ve kutu olculeri tamamen kullanicidan gelir,
      placeholder'da bile ornek sayi yazmaz - sadece birim (cm).
      Agirlik arayuzden tamamen kaldirildi: bu surum hacim/adet planlamasi
      yapiyor. Sunucuya 0 gidiyor, motorun kapasite kontrolu devre disi.
   2) BUTUN HESAP TARAYICIDA. Olcu degistirince sunucuya gidilmez, motor
      dogrudan cagrilir; sunucu sadece kalici kayit tutar.
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
    sinirlar: {},
    // Yuk listesi: [{kutuId, adet:number|null, maks:boolean}]
    kalemler: [],
    // agirlikSiniri yok: agirlik arayuzden kaldirildi, maksAgirlik=0 gittigi
    // icin motorun kapasite kontrolu kendiliginden devre disi kaliyor.
    ayar: { strateji: 'optimum', pay: 0 },
    plan: null,
  };

  // Yeni kutulara sirayla atanan renkler (kullanici sonra degistirebilir)
  const RENKLER = [
    '#4a9eff', '#51cf66', '#ffd43b', '#ff8787', '#a78bfa',
    '#38d9a9', '#ffa94d', '#f783ac', '#74c0fc', '#c0eb75',
  ];

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

  // ------------------------------------------------------------ birim cevrim
  //
  // ARAYUZ SANTIMETRE gosterir/alir, ICERIDE HER SEY MILIMETRE kalir.
  //
  // Neden mm iceride: motorun giyotin kesim matematigi tam sayi izgaraya
  // dayaniyor. Cekirdegi ondalikli birime cevirmek yuvarlama hatasi sokar ve
  // dogrulanmis sayilari (1.440 koli, %96,2) bozar. O yuzden cevrim SADECE
  // form sinirinda yapilir - veritabani, motor ve sunucu dogrulamasi mm.

  const mmYap = (cm) => (cm === null ? null : Math.round(cm * 10));
  const cmYap = (mm) => Number(mm || 0) / 10;

  /** mm -> santimetre metni. Gereksiz sifir yazmaz: 2480 -> "248", 242 -> "24,2" */
  const cmYaz = (mm) => cmYap(mm).toLocaleString('tr-TR', {
    minimumFractionDigits: 0, maximumFractionDigits: 1,
  });

  /** Form alanina yazilacak cm degeri (nokta ondalikli, input[number] icin). */
  const cmAlan = (mm) => String(cmYap(mm));

  const olcuMetni = (mmU, mmG, mmY) =>
    cmYaz(mmU) + ' × ' + cmYaz(mmG) + ' × ' + cmYaz(mmY) + ' cm';

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
    D.sinirlar = v.sinirlar || {};

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
      ? 'Motora giden: ' + u + ' × ' + g + ' × ' + y + ' mm' +
        '  (' + metre(u) + ' × ' + metre(g) + ' × ' + metre(y) + ' m)'
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
        o.textContent = k.ad + '  (' + cmYaz(k.uzunluk) + '×' + cmYaz(k.genislik) +
                        '×' + cmYaz(k.yukseklik) + ' cm)';
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

  function kutuFormuAc(mevcut) {
    const f = kutuAlanlari();
    $('kutuId').value = mevcut ? mevcut.id : '';
    $('kutuFormBaslik').textContent = mevcut ? 'Kutuyu Düzenle' : 'Yeni Kutu';

    f.ad.value = mevcut ? mevcut.ad : '';
    $('kutuGrup').value = mevcut ? (mevcut.grup || '') : '';
    // Kayitli deger mm; forma cm olarak yazilir
    f.uzunluk.value = mevcut ? cmAlan(mevcut.uzunluk) : '';
    f.genislik.value = mevcut ? cmAlan(mevcut.genislik) : '';
    f.yukseklik.value = mevcut ? cmAlan(mevcut.yukseklik) : '';
    $('kutuMaksIstif').value = mevcut ? mevcut.maksIstif : 0;
    $('kutuYatirilabilir').checked = mevcut ? !!mevcut.yatirilabilir : true;
    // Renk tek istisna: yeni kutuya sirayla bir renk atanir
    $('kutuRenk').value = mevcut
      ? (mevcut.renk || RENKLER[0])
      : RENKLER[D.kutular.length % RENKLER.length];

    $('kutuHata').textContent = '';
    gorunur($('kutuPerde'), true);
    kutuFormDenetle();
    f.ad.focus();
  }

  function kutuFormDenetle() {
    const f = kutuAlanlari();
    const s = D.sinirlar;
    const kenar = s.kutuKenar || [1, 40000];
    const u = mmYap(sayiOku(f.uzunluk));
    const g = mmYap(sayiOku(f.genislik));
    const y = mmYap(sayiOku(f.yukseklik));

    const tamam =
      f.ad.value.trim() !== '' &&
      aralikta(u, kenar[0], kenar[1]) &&
      aralikta(g, kenar[0], kenar[1]) &&
      aralikta(y, kenar[0], kenar[1]);
    $('kutuKaydet').disabled = !tamam;

    $('kutuYansi').textContent = (u && g && y)
      ? 'Motora giden: ' + u + ' × ' + g + ' × ' + y + ' mm'
      : '';
  }

  async function kutuGonder(olay) {
    olay.preventDefault();
    const f = kutuAlanlari();
    const govde = {
      id: $('kutuId').value || undefined,
      ad: f.ad.value.trim(),
      grup: $('kutuGrup').value.trim(),
      // cm -> mm
      uzunluk: mmYap(sayiOku(f.uzunluk)),
      genislik: mmYap(sayiOku(f.genislik)),
      yukseklik: mmYap(sayiOku(f.yukseklik)),
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

  function kalemEkleDugmesi() {
    const id = $('kutuSec').value;
    if (!id) return;
    if (D.kalemler.some((k) => k.kutuId === id)) return; // ayni kutu iki kez olmasin
    const azami = D.sinirlar.kalemAzami || 60;
    if (D.kalemler.length >= azami) return;
    D.kalemler.push({ kutuId: id, adet: null, maks: true });
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
      ad.title = kutu.ad + ' — ' + olcuMetni(kutu.uzunluk, kutu.genislik, kutu.yukseklik);
      sat.appendChild(ad);

      // Adet alani
      const adet = document.createElement('input');
      adet.type = 'number';
      adet.min = '1';
      adet.step = '1';
      adet.placeholder = 'adet';
      adet.value = kalem.adet === null ? '' : kalem.adet;
      adet.disabled = kalem.maks;
      adet.addEventListener('input', () => {
        const n = sayiOku(adet);
        kalem.adet = n !== null && n > 0 ? Math.floor(n) : null;
        hesapla();
      });
      sat.appendChild(adet);

      // Sonsuz dugmesi - "sigdigi kadar"
      const sonsuz = document.createElement('button');
      sonsuz.type = 'button';
      sonsuz.className = 'ikincil ufak' + (kalem.maks ? ' sonsuz-acik' : '');
      sonsuz.textContent = '∞';
      sonsuz.title = kalem.maks
        ? 'Sığdığı kadar yerleştiriliyor — kapatmak için tıkla'
        : 'Sığdığı kadar yerleştir';
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

  function hesapla() {
    const arac = D.aracAktif;
    const kalemler = D.kalemler
      .map((k) => {
        const kutu = D.kutular.find((x) => x.id === k.kutuId);
        if (!kutu) return null;
        // maks isaretliyse adet yok sayilir ("sigdigi kadar")
        return k.maks ? { kutu, maks: true } : { kutu, adet: k.adet || 0 };
      })
      .filter(Boolean)
      // Adedi 0 olan kalem motoru mesgul etmesin
      .filter((k) => k.maks || k.adet > 0);

    // Arac yoksa ya da yuk yoksa hesap yapilmaz
    if (!arac || kalemler.length === 0) {
      D.plan = null;
      gostergeleriBosalt();
      gorunur($('sonuc'), false);
      gorunur($('baslangic'), true);
      $('uyariYer').innerHTML = '';
      $('baslangicBaslik').textContent = !arac
        ? 'Araç ölçülerini gir'
        : 'Yük listesine kutu ekle';
      $('baslangicMetin').textContent = !arac
        ? 'Sol panelden aracı oluştur, sonra kutu tanımlayıp yük listesine ekle. Hesap sen yazarken anında yapılır.'
        : 'Aracın hazır. Şimdi bir kutu seçip Ekle’ye bas — sayılar anında görünecek.';
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
    gostergeYaz($('gUzunluk'), metre(o.kullanilanUzunluk) + ' m',
      'arkada ' + metre(o.bosUzunluk) + ' m boş', '');

    // 4) Yuk yuksekligi
    gostergeYaz($('gYukseklik'), metre(o.yukYuksekligi) + ' m',
      'tavana ' + metre(o.bosYukseklik) + ' m', '');
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
      hucre(cmYaz(b.ku) + '×' + cmYaz(b.kg) + '×' + cmYaz(b.ky) + '  ' + b.durusAd);
      hucre(metre(b.x) + ' m');

      govde.appendChild(tr);
    }
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
    // Pay cm girilir, motora mm gider
    $('pay').addEventListener('input', () => {
      const mm = mmYap(sayiOku($('pay')));
      const ust = (D.sinirlar.pay || [0, 500])[1];
      D.ayar.pay = mm === null ? 0 : Math.min(Math.max(mm, 0), ust);
      hesapla();
    });
    // -- cikis --
    $('cikis').addEventListener('click', async () => {
      await fetch('/api/cikis', { method: 'POST' });
      location.replace('/giris');
    });

    // -- pencereler: Esc kapatir, perdeye tiklamak kapatir --
    document.addEventListener('keydown', (o) => {
      if (o.key !== 'Escape') return;
      gorunur($('aracPerde'), false);
      gorunur($('kutuPerde'), false);
    });
    for (const id of ['aracPerde', 'kutuPerde']) {
      $(id).addEventListener('click', (o) => {
        if (o.target === $(id)) gorunur($(id), false);
      });
    }
  }

  // ===========================================================================
  //  BASLAT
  // ===========================================================================

  async function baslat() {
    if (typeof Yerlesim === 'undefined') {
      document.body.innerHTML =
        '<p style="padding:40px;color:#ff6b6b">Motor (yerlesim.js) yüklenemedi.</p>';
      return;
    }
    olaylariBagla();
    stratejileriCiz();
    gostergeleriBosalt();
    try {
      await veriYukle();
    } catch (h) {
      $('uyariYer').innerHTML =
        '<div class="uyari">Veri yüklenemedi: ' + h.message + '</div>';
    }
  }

  baslat();
})();
