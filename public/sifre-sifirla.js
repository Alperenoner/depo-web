// ============================================================================
//  Sifre sifirlama sayfasi
//
//  Kodu yetkili biri uretip kullaniciya kendisi veriyor - e-posta gonderen
//  bir servis yok. Buradaki kontroller yalnizca KOLAYLIK; asil dogrulama
//  sunucuda (dogrula.sifreSifirla).
// ============================================================================

(function () {
  'use strict';

  const form = document.getElementById('form');
  const dugme = document.getElementById('dugme');
  const uyari = document.getElementById('uyari');
  const kod = document.getElementById('kod');
  const yeni = document.getElementById('yeni');
  const yeniTekrar = document.getElementById('yeniTekrar');

  const EN_KISA_SIFRE = 10;
  const ON_EK = 'SIFRE';

  function uyariGoster(mesaj, odak) {
    uyari.textContent = mesaj;
    uyari.hidden = false;
    if (odak) odak.focus();
  }

  // Kod alani kendini duzeltiyor - kayit sayfasindakinin ayni davranisi,
  // yalnizca on eki farkli (SIFRE, DEPO degil: iki kod karismasin).
  kod.addEventListener('input', () => {
    const sondaydi = kod.selectionStart === kod.value.length;
    let ham = kod.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (ham.startsWith(ON_EK)) ham = ham.slice(ON_EK.length);
    ham = ham.slice(0, 8);

    let bicimli = ON_EK;
    if (ham.length) bicimli += '-' + ham.slice(0, 4);
    if (ham.length > 4) bicimli += '-' + ham.slice(4);

    kod.value = ham.length ? bicimli : '';
    if (sondaydi) {
      const son = kod.value.length;
      kod.setSelectionRange(son, son);
    }
  });

  form.addEventListener('submit', async (olay) => {
    olay.preventDefault();
    uyari.hidden = true;

    if (!kod.value.trim()) return uyariGoster('Sıfırlama kodunu yaz.', kod);
    if (yeni.value.length < EN_KISA_SIFRE) {
      return uyariGoster(
        'Yeni şifre en az ' + EN_KISA_SIFRE + ' karakter olmalı.', yeni
      );
    }
    if (yeni.value !== yeniTekrar.value) {
      return uyariGoster('Şifreler birbirini tutmuyor.', yeniTekrar);
    }

    dugme.disabled = true;
    dugme.textContent = 'Değiştiriliyor...';

    try {
      const cevap = await fetch('/api/sifre-sifirla', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kod: kod.value.trim(),
          yeni: yeni.value,
          yeniTekrar: yeniTekrar.value,
        }),
      });

      const govde = await cevap.json().catch(() => ({}));

      // Sunucu sifreyi degistirip oturumu da aciyor - dogrudan uygulamaya gir
      if (cevap.ok && govde.girisli) {
        location.replace('/');
        return;
      }

      uyariGoster(govde.hata || 'Şifre değiştirilemedi.');
      yeni.value = '';
      yeniTekrar.value = '';
    } catch (hata) {
      uyariGoster('Sunucuya ulaşılamadı. Bağlantını kontrol et.');
    } finally {
      dugme.disabled = false;
      dugme.textContent = 'Şifreyi Değiştir';
    }
  });

  kod.focus();
})();
