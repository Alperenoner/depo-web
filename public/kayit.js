// ============================================================================
//  Kayit sayfasi mantigi
//
//  Buradaki kontroller yalnizca KOLAYLIK icindir - kullanici sunucuya
//  gidip donmeden hatasini gorsun diye. Asil dogrulama sunucuda
//  (dogrula.kayit); tarayiciya guvenilmez.
// ============================================================================

(function () {
  'use strict';

  const form = document.getElementById('form');
  const dugme = document.getElementById('dugme');
  const uyari = document.getElementById('uyari');

  const alan = {
    adSoyad: document.getElementById('adSoyad'),
    eposta: document.getElementById('eposta'),
    telefon: document.getElementById('telefon'),
    sifre: document.getElementById('sifre'),
    sifreTekrar: document.getElementById('sifreTekrar'),
    davetKodu: document.getElementById('davetKodu'),
  };

  // Sunucudaki karsiligi: dogrula.SINIR.sifreEnAz
  const EN_KISA_SIFRE = 10;

  function uyariGoster(mesaj, odak) {
    uyari.textContent = mesaj;
    uyari.hidden = false;
    if (odak) odak.focus();
  }

  function uyariGizle() {
    uyari.hidden = true;
  }

  // --- Referans numarasi alani ---------------------------------------------
  //  Kullanici nasil yazarsa yazsin (kucuk harf, cizgisiz, bosluklu) alan
  //  kendini DEPO-XXXX-XXXX bicimine getirir. Sunucu da ayni temizligi
  //  yapiyor; buradaki amac kisinin dogru yazdigini GORMESI.
  alan.davetKodu.addEventListener('input', () => {
    const secim = alan.davetKodu.selectionStart === alan.davetKodu.value.length;
    let ham = alan.davetKodu.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (ham.startsWith('DEPO')) ham = ham.slice(4);
    ham = ham.slice(0, 8);

    let bicimli = 'DEPO';
    if (ham.length) bicimli += '-' + ham.slice(0, 4);
    if (ham.length > 4) bicimli += '-' + ham.slice(4);

    alan.davetKodu.value = ham.length ? bicimli : '';
    // Imlec sondaydiysa sonda kalsin (araya yazmaya calisani zorlamayalim)
    if (secim) {
      const son = alan.davetKodu.value.length;
      alan.davetKodu.setSelectionRange(son, son);
    }
  });

  form.addEventListener('submit', async (olay) => {
    olay.preventDefault();
    uyariGizle();

    const deger = {
      adSoyad: alan.adSoyad.value.trim(),
      eposta: alan.eposta.value.trim(),
      telefon: alan.telefon.value.trim(),
      sifre: alan.sifre.value,
      sifreTekrar: alan.sifreTekrar.value,
      davetKodu: alan.davetKodu.value.trim(),
    };

    if (!deger.adSoyad.includes(' ')) {
      return uyariGoster('Ad ve soyadını birlikte yaz.', alan.adSoyad);
    }
    if (!deger.eposta) return uyariGoster('E-posta adresini yaz.', alan.eposta);
    if (!deger.telefon) return uyariGoster('Telefon numaranı yaz.', alan.telefon);
    if (deger.sifre.length < EN_KISA_SIFRE) {
      return uyariGoster(
        'Şifre en az ' + EN_KISA_SIFRE + ' karakter olmalı.',
        alan.sifre
      );
    }
    if (deger.sifre !== deger.sifreTekrar) {
      return uyariGoster('Şifreler birbirini tutmuyor.', alan.sifreTekrar);
    }
    if (!deger.davetKodu) {
      return uyariGoster('Referans numaranı yaz.', alan.davetKodu);
    }

    dugme.disabled = true;
    dugme.textContent = 'Hesap açılıyor...';

    try {
      const cevap = await fetch('/api/kayit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deger),
      });

      const govde = await cevap.json().catch(() => ({}));

      // Sunucu kaydi acinca oturumu da aciyor - dogrudan uygulamaya gir
      if (cevap.ok && govde.girisli) {
        location.replace('/');
        return;
      }

      uyariGoster(govde.hata || 'Hesap oluşturulamadı.');
      alan.sifre.value = '';
      alan.sifreTekrar.value = '';
    } catch (hata) {
      uyariGoster('Sunucuya ulaşılamadı. Bağlantını kontrol et.');
    } finally {
      dugme.disabled = false;
      dugme.textContent = 'Hesabı Oluştur';
    }
  });

  alan.adSoyad.focus();
})();
