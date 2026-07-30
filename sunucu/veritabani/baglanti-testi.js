// ============================================================
//  Baglanti testi - `npm run db:dene`
//  Veritabanina ulasip ulasmadigini ve gecikmeyi olcer.
// ============================================================

const { sorgu, havuz } = require('./baglanti');

(async () => {
  console.log('Neon veritabanina baglaniliyor...\n');
  try {
    const basla = Date.now();
    const { rows } = await sorgu(
      'select version() as surum, current_database() as vt, now() as saat'
    );
    const gecikme = Date.now() - basla;

    console.log('BAGLANTI BASARILI');
    console.log('  Veritabani :', rows[0].vt);
    console.log('  Postgres   :', rows[0].surum.split(' ').slice(0, 2).join(' '));
    console.log('  Sunucu saat:', rows[0].saat.toISOString());
    console.log('  Gecikme    :', gecikme, 'ms (ilk baglanti, sonrakiler daha hizli)');

    // Ikinci sorgu: havuz isinmis haldeki gercek gecikme
    const basla2 = Date.now();
    await sorgu('select 1');
    console.log('  Isinmis    :', Date.now() - basla2, 'ms');

    const { rows: tablolar } = await sorgu(
      "select table_name from information_schema.tables where table_schema='public' order by table_name"
    );
    console.log(
      '\n  Mevcut tablolar:',
      tablolar.length ? tablolar.map((t) => t.table_name).join(', ') : '(hic yok - normal, henuz kurulmadi)'
    );
  } catch (hata) {
    console.error('BAGLANTI BASARISIZ');
    console.error('  ', hata.message);
    process.exitCode = 1;
  } finally {
    await havuz.end();
  }
})();
