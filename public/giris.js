// ============================================================================
//  Giris sayfasi mantigi
// ============================================================================

(function () {
  'use strict';

  const form = document.getElementById('form');
  const kullanici = document.getElementById('kullanici');
  const sifre = document.getElementById('sifre');
  const dugme = document.getElementById('dugme');
  const uyari = document.getElementById('uyari');

  function uyariGoster(mesaj) {
    uyari.textContent = mesaj;
    uyari.hidden = false;
  }

  function uyariGizle() {
    uyari.hidden = true;
  }

  form.addEventListener('submit', async (olay) => {
    olay.preventDefault();
    uyariGizle();

    if (!kullanici.value.trim() || !sifre.value) {
      uyariGoster('Kullanıcı adı ve şifre gerekli.');
      return;
    }

    dugme.disabled = true;
    dugme.textContent = 'Kontrol ediliyor...';

    try {
      const cevap = await fetch('/api/giris', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kullanici: kullanici.value.trim(),
          sifre: sifre.value,
        }),
      });

      const govde = await cevap.json().catch(() => ({}));

      if (cevap.ok && govde.girisli) {
        // Adres cubugundaki ?devam= varsa oraya, yoksa ana sayfaya
        const parametreler = new URLSearchParams(location.search);
        const devam = parametreler.get('devam');
        location.replace(devam && devam.startsWith('/') ? devam : '/');
        return;
      }

      uyariGoster(govde.hata || 'Giriş yapılamadı.');
      sifre.value = '';
      sifre.focus();
    } catch (hata) {
      uyariGoster('Sunucuya ulaşılamadı. Bağlantını kontrol et.');
    } finally {
      dugme.disabled = false;
      dugme.textContent = 'Giriş Yap';
    }
  });

  kullanici.focus();
})();
