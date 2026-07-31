# DEPOLAMA — Tır Yükleme Planlayıcı

Bir tırın içine kutuları en verimli nasıl dizeceğini hesaplayan ve sonucu 2 boyutlu
(kuşbakışı, yandan kesit) ve 3 boyutlu gösteren web uygulaması.

**Hiçbir çerçeve kullanılmadı** — Express yok, React yok, paketleyici yok, ORM yok.
Tek çalışma zamanı bağımlılığı Postgres sürücüsü. Bütün HTTP yolları, tuvale çizilen
her piksel ve yerleştirme motorunun tamamı elle yazıldı.

**[Canlı site](https://depo-test-deniz-zkbp.onrender.com)** · giriş gerekir —
uygulama gerçek yük verisi tuttuğu için herkese açık değil. Hesaplar kullanıcılar
tarafından açılıyor ama yalnızca yöneticinin verdiği **tek kullanımlık referans
numarasıyla**. Aşağıdaki ekran görüntüleri arayüzün tamamını gösteriyor.

> English README: **[README.md](README.md)**

---

## Ne yapıyor

Bir dorse ve kutu tipleri tanımlıyorsun, her birinden kaç tane göndereceğini
yazıyorsun; motor dizilişi çıkarıyor — hangi kutu nereye, hangi duruşta, hangi
yükleme sırasıyla.

![3 boyutlu görünüm](docs/gorsel/uc-boyut.png)

*3B görünüm — 3 blok halinde 1.112 kutu, %94,8 hacim doluluğu. Etiketlerdeki
numaralar yükleme sırası.*

![Kuşbakışı](docs/gorsel/kusbakisi.png)

*Kuşbakışı, katman kaydırıcısıyla — kaydırınca bütün istif yerine tek bir katman
görünüyor.*

![Diziliş karşılaştırması](docs/gorsel/karsilastirma.png)

*Aynı yük üç diziliş mantığıyla birden hesaplanıp yan yana konuyor, en iyisi
işaretleniyor.*

---

## İşin ilginç yanı: kutu değil, blok

Düz yaklaşım kutuları teker teker yerleştirir. 900.000 paketi böyle yüklemek
900.000 yerleştirme kararı demek.

Bu motor hiç kutu yerleştirmiyor. **Blok** yerleştiriyor — aynı duruşta dizilmiş
`nx × ny × nz` özdeş kutudan oluşan düzgün ızgara. Tek blok 900.000 kutuyu
anlatabildiği için plan milisaniyede bitiyor, 3B sahne de bir milyon değil birkaç
tane mesh çiziyor.

Döngü şöyle:

1. Boş alanların listesi tutuluyor; başlangıçta liste tek elemanlı: boş dorse.
2. Her kutu tipi için farklı duruşlar üretiliyor — `uzunluk × genişlik × yükseklik`
   ölçüsünün 6 permütasyonu, tekilleştirilmiş hâlde (küp gibi bir kutuda 6 değil 1
   duruş çıkar). Kutu "yatırılamaz" işaretliyse yalnızca 2 duruş denenir.
3. Her (boşluk, duruş) çifti için ızgara olarak kaç kutu sığdığı hesaplanıp
   puanlanıyor — stratejiye göre hacme veya adede ağırlık vererek.
4. En iyi blok yerleştiriliyor, artan yer yeni boşluklara bölünüyor, 1 mm'den ince
   kırıntılar atılıyor, döngü başa dönüyor.

Üç diziliş sunuluyor: **yatay** (en kısa kenar yukarı — daha çok kat çıkar),
**dikey** (en uzun kenar yukarı) ve **optimum** — 9 duruş/puanlama birleşimini
deneyip en çok kutu yerleştireni seçiyor. Her değişiklikte üçü birden
hesaplandığı için karşılaştırma sekmesi bedava geliyor.

`motor/yerlesim.js` ekranı hiç bilmiyor. Girdisi `{araç, kutular}`, çıktısı
`{bloklar}`. 2B ile 3B görünümün birbiriyle çelişmesi bu yüzden imkânsız — ikisi de
tek bir sonucun üzerine geçirilmiş birer çizici. Aynı dosya tarayıcıda da Node'da
da değişmeden çalışıyor; test takımını mümkün kılan da bu.

---

## Tek kullanıcılı bir aracı çok kullanıcılıya çevirmek

Uygulama tek kişi için yazılmıştı. Dışarıdan kullanıcı kabul etmesi gerektiğinde
asıl mesele kayıt formu değildi — **veritabanındaki her satır herkese aitti.**

Sıra önemliydi. Önce kayıt açılsaydı, kaydolan ilk yabancı bütün kataloğu görür ve
silebilirdi. Bu yüzden önce sahiplik, en son kayıt sayfası yapıldı.

**Sahiplik.** İçerik tablolarının hepsine `kullanici_id` eklendi ve veri
katmanındaki her fonksiyonun ilk parametresi bu oldu; hiçbir sorgu
`where kullanici_id` süzgeci olmadan çalışmıyor. İnce nokta upsert'te: id'ler
tablo genelinde benzersiz ve istemciden geliyor, o yüzden
`on conflict (id) do update` bir sahiplik koşulu taşıyor. Olmasa, başkasının
id'sini gönderen biri o kaydın üzerine yazardı. Eşleşmezse sıfır satır dönüyor ve
uç **404** veriyor — "böyle bir kayıt yok" ile bilerek ayırt edilemez, ki başka
bir kullanıcının verisinin varlığı bile sızmasın.

Göç kolonu `default 1` ile ekledi (mevcut satırları kurucuya verdi) ve ardından
**default'u düşürdü**: artık her insert sahibini açıkça yazmak zorunda, sessizce
tek bir hesaba düşemiyor.

**Referans numaraları.** `DEPO-7K4M-92XQ` — tek kullanımlık, 14 gün, yalnızca
yönetici üretiyor ve elden veriyor. Alfabe tam 32 karakter, `0/O` ve `1/I` çıkarıldı:
kodlar telefonda okunuyor ve `256 % 32 == 0` olduğu için `bayt % 32` her karakteri
eşit olasılıkla seçiyor. Daha kısa bir alfabe dağılımı bozar ve kodu tahmin
edilebilir kılardı; uzunluğu bir test kilitliyor. Harcama tek transaction içinde,
satır `select … for update` ile tutuluyor — aynı kod iki kişiye gönderilse iki
hesap açılamıyor.

**Rol iki boolean, bir tane değil.** `yetkili` *bu kişi siteyi yönetebilir mi*
sorusunun cevabı ve verilip geri alınabiliyor. `kurucu` ise *bu hesaba
dokunulabilir mi* sorusunun cevabı — ve cevap hiçbir zaman evet değil. Yönetici
başkasını yükseltebilir, hesap askıya alabilir, şifre sıfırlayabilir; ama kurucuyu
düşüremez, askıya alamaz, şifresini sıfırlayamaz — yoksa güvendiğin biri seni
kendi sitenden kilitleyebilirdi. Kimse kendi hesabına da müdahale edemiyor: son
yöneticinin kendini düşürmesi siteyi yönetilemez bırakırdı.

**E-posta servisi olmadan kurtarma.** SMTP eklemek ikinci bir bağımlılık, bir API
anahtarı ve yeni bir hata sınıfı demekti. Onun yerine aynı kod düzeni şifre
sıfırlamayı da karşılıyor: yönetici `SIFRE-…` kodu üretiyor, elden veriyor,
kullanıcı kullanıyor. Ön eki davet kodundan bilerek farklı — yanlış forma
yapıştırılan kod sessizce yanlış okunmak yerine reddediliyor. Sıfırlama, o hesabın
bütün oturumlarını kapatıyor: şifreyi unutmakla hesabın elden çıkması birbirine
çok benziyor.

**Silmek yerine askıya almak.** Hesap silmek araçlarını, kutularını ve planlarını
da götürüyor. Gerçek bir silme için doğru, "bu kişinin erişimi kesilsin" için
yanlış. `aktif` eklendi: giriş reddediliyor, oturumları düşüyor, verisi duruyor,
geri alınabiliyor. Kontrol **şifre doğrulamasından sonra** yapılıyor, ki "bu hesap
askıda" bilgisi şifreyi bilmeyene sızmasın.

**Ayakta kalan bir hız sınırlayıcı.** Kaba kuvvet sayacı bir `Map` içindeydi ve
yanına "sunucu yeniden başlarsa sıfırlanır, kabul edilebilir bir ödün" diye not
düşülmüştü. Değilmiş: ücretsiz barındırma katmanı 15 dakika işlem olmazsa uykuya
geçiyor, yani sayaç aşağı yukarı her saat siliniyordu. Artık Postgres'te.

---

## Açıklamayı hak eden kararlar

**Çerçeve yok, tek bağımlılık.** `package.json` içinde tam olarak bir çalışma
zamanı bağımlılığı var: `pg`. `sunucu/server.js` içindeki yönlendirici
`if (yol === ... && yontem === ...)` zincirinden ibaret — 909 satırda statik
dosyalar, oturumlar ve 23 API ucu. Bu boyutta bir uygulamada çerçeve, kaldırdığından
çok kavram eklerdi.

**Plan sonucu değil tarifi saklıyor.** Kaydedilen plan *hangi araç, hangi kutular,
kaç adet, hangi strateji* bilgisini tutuyor — hesaplanmış konumları asla. Plan
yüklenince yerleşim baştan hesaplanıyor. Böylece motor iyileştiğinde geçen sene
kaydedilmiş her plan da bedavaya daha iyi sonuç veriyor.

**İki ayrı birim, bilerek.** Kutular milimetre, araçlar santimetre giriliyor.
Kullanan insanlar bu iki şeyi zaten böyle düşünüyor; tek birime zorlamak alışkanlıkla
kavga etmek olurdu.

**Hiçbir şey hazır gelmiyor.** Araç ve kutu tabloları boş başlıyor. Hazır
"14 m dorse" yok, fabrika kutu ölçüsü yok. Sistemdeki her ölçüyü onu doğrulamış
biri girmiş.

**Güvenlik.** Şifreler kullanıcıya özel tuzla scrypt özeti (N=16384, r=8, p=1) —
düz metin ne saklanıyor ne loglanıyor. Oturumlar Postgres'te tutulan rastgele
jetonlar, böylece yeni sürüm çıkınca kimse dışarı atılmıyor; HttpOnly çerezle
taşınıyor. Aynı IP'den sekiz hatalı giriş 10 dakika kilit getiriyor; sayaç bellekte
değil veritabanında. Var olmayan bir kullanıcıya yapılan giriş denemesinde de sahte
bir özete karşı scrypt çalıştırılıyor, böylece cevap süresi hangi kullanıcı adının
var olduğunu ele vermiyor. Veritabanına
giden TLS sertifikayı doğruluyor (`sslmode=verify-full`, `rejectUnauthorized: false`
yok).

---

## Dosya düzeni

```
motor/yerlesim.js      844 satır   yerleştirme motoru — tarayıcı + Node, DOM bilmez
sunucu/                3.255       HTTP yönlendirici, doğrulama, güvenlik, Postgres
  server.js              909       yönlendirme, statik dosyalar, 23 API ucu
  veri.js                765       veri katmanı — her sorgu tek bir sahibe kısıtlı
  dogrula.js             465       girdi doğrulama, kod çözümleme
  guvenlik.js            355       scrypt, oturumlar, kod üretimi, hız sınırları
  veritabani/sema.sql    384       10 tablo, tekrar çalıştırılabilir
public/                6.274       arayüz
  uygulama.js          2.329       durum, formlar, canlı yeniden hesap, yönetim paneli
  3boyut.js              993       three.js sahnesi, 4 kamera kipi, yükleme animasyonu
  cizim.js               523       2B tuval — kuşbakışı ve yandan kesit
  giris / kayit / sifre-sifirla    giriş, kayıt ve şifre sıfırlama sayfaları
testler/               1.551       104 test, node:test, test çerçevesi yok
```

## Çalıştırmak

```bash
npm install
cp .env.ornek .env        # DATABASE_URL ve SESSION_SECRET doldurulacak
npm run db:kur            # şema + ilk hesap
npm start                 # http://localhost:5180
```

```bash
npm test                  # 104 test
npm run db:dene           # veritabanı bağlantısını dene
npm run db:kullanici -- liste
```

Node 18+ ve bir Postgres veritabanı gerekiyor. [Neon](https://neon.tech)
üzerinde çalışıyor (Postgres 18, Frankfurt), [Render](https://render.com)'a
`render.yaml` ile çıkılıyor.

---

## Durum

Bitti ve yayında. 104 test geçiyor; ayrıca kayıt akışını, sahiplik ayrımını ve rol
kurallarını gerçek sunucu ve veritabanı üzerinde sınayan uçtan uca bir dizi var.
Temmuz 2026'da iki günde yazıldı.

## Lisans

Açık kaynak değildir. Kod **incelenmek için** yayımlandı — okuyun, inceleyin,
sorun. Kullanım, kopyalama veya yeniden dağıtım izne tabidir; bir issue açın ya da
[GitHub](https://github.com/Alperenoner) üzerinden ulaşın.

© 2026 Alperen Öner. Tüm hakları saklıdır.
